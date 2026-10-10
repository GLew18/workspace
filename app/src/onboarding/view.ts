// Cobalt: first-run onboarding deck.
//
// Seven full-screen slides over the branded gradient field, with a progress rail
// that only ever climbs:
//
//   1. WELCOME:   the app mark, the wordmark, one button.
//   2. IMPORT:    what the product actually does, shown rather than described.
//   3. CONNECT:   pick your school, approve Cobalt on Schoology's own page, and
//                 the real titles fly in (Schoology OAuth, the only way in since
//                 10/9/26). There is deliberately NO real skip: a student who
//                 skips forgets, opens an empty app, and concludes the product is
//                 bad. The connection IS the product. (A temporary testing skip
//                 sits on the screen; see the note there.)
//   4. COURSES:   the Settings ▸ Courses editor, filled from Schoology's sections.
//   5. SCHEDULE:  the student's Google Calendar schedule (secret iCal address),
//                 which feeds the dashboard's Current Schedule card. Skippable.
//   6. LANGUAGES: which languages to translate task titles from.
//   7. PAYOFF:    everything commits here, the first sync runs live, and the
//                 real imported assignments are listed (not a teaser count).
//
// The first name comes from Schoology (preferred name first); without a
// connection it falls back to a guess from the email, then the Google name.
//
// WHERE AUTH SITS: main.ts signs the user in BEFORE calling this, so by the time
// this runs the account already exists.
//
// Contract: saves profile/account with onboarded: true + markOnboardedLocally(),
// runs the first sync, then calls onDone(name).

import type { Data } from '../db';
import { el, textInput } from '../util/dom';
import { STONE_SVG } from '../ui/laurel';
import { capitalizeName, nameFromEmail } from '../util/names';
import { runSync } from '../schoology/sync';
import { replaceCourses, getCourseColor } from '../courses/registry';
import { buildCourseRow } from '../courses/courseRow';
import { nextCourseColor } from '../courses/colors';
import { BADGE_ASSESSMENT_RE } from '../schoology/events';
import {
  startSchoologyConnect,
  finishSchoologyConnectIfReturning,
  fetchSgyApiPayload,
  sgyErrorText,
  buildSchoolPicker,
} from '../schoology/api';
import { todayStr } from '../util/dates';
import { genId } from '../util/ids';
import { openGcalGuide } from './gcalGuide';
import { buildLanguagePicker } from '../settings/languagePicker';
import { normalizePrefs } from '../prefs';
import { signOut } from '../auth'; // TEMPORARY: powers the "‹ Landing page" escape hatch
import type { CourseConfig, Task } from '../types';
import {
  currentCourses,
  dayToShow,
  isGoogleCalendarIcalUrl,
  parseScheduleIcs,
  fetchScheduleIcs,
  refreshFeed,
  saveFeed,
} from '../schedule/feed';
import { formatWallClock } from '../util/dates';

interface OnboardingOpts {
  data: Data;
  email: string;
  fallbackName: string;
  onDone: (displayName: string) => void;
  /** PREVIEW ONLY (onbpreview.html, the audit copy of this flow): hands over a
   *  way to jump between screens and to seed the draft. Real sign-ups omit it. */
  preview?: (ctl: { go: (i: number) => void; count: number; draft: { name: string; courses: CourseConfig[] } }) => void;
}

/** The crown over the welcome slide's gem (Gabe, 10/10): platinum, set with
 *  stones in the gem's own blues. */
const CROWN_SVG =
  '<svg class="onb-crown" viewBox="0 0 100 64" xmlns="http://www.w3.org/2000/svg" aria-hidden="true">' +
  '<defs><linearGradient id="onb-crown-metal" x1="0" y1="0" x2="0" y2="1">' +
  '<stop offset="0" stop-color="#f5f8fc"/><stop offset=".55" stop-color="#c9d5e6"/><stop offset="1" stop-color="#8fa3c0"/>' +
  '</linearGradient></defs>' +
  '<path d="M10 50 L4 14 L28 34 L50 6 L72 34 L96 14 L90 50 Z" fill="url(#onb-crown-metal)" stroke="#6f86a8" stroke-width="2" stroke-linejoin="round"/>' +
  '<rect x="9" y="48" width="82" height="12" rx="4" fill="url(#onb-crown-metal)" stroke="#6f86a8" stroke-width="2"/>' +
  '<circle cx="4" cy="12" r="4.5" fill="#7db4ff"/><circle cx="50" cy="5" r="5" fill="#7db4ff"/><circle cx="96" cy="12" r="4.5" fill="#7db4ff"/>' +
  '<circle cx="30" cy="54" r="3.4" fill="#3d7fe8"/><circle cx="50" cy="54" r="4" fill="#7db4ff"/><circle cx="70" cy="54" r="3.4" fill="#3d7fe8"/>' +
  '</svg>';

/** A calendar page, the schedule screen's source tile: Google-blue header band
 *  and date, no trademark artwork. */
const CAL_ICON =
  '<svg viewBox="0 0 48 48" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Calendar">' +
  '<rect x="4" y="6" width="40" height="38" rx="7" fill="#fff" stroke="#dadce0" stroke-width="2"/>' +
  '<path d="M4 13a7 7 0 0 1 7-7h26a7 7 0 0 1 7 7v4H4z" fill="#4285f4"/>' +
  '<rect x="13" y="2" width="4" height="9" rx="2" fill="#1a5fd0"/><rect x="31" y="2" width="4" height="9" rx="2" fill="#1a5fd0"/>' +
  '<text x="24" y="36" text-anchor="middle" font-family="Inter, Helvetica, Arial, sans-serif" font-size="16" font-weight="700" fill="#1a73e8">31</text>' +
  '</svg>';

/** The real Schoology mark, so the connect step shows the service by its own logo. */
const SGY_LOGO =
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schoology">' +
  '<circle cx="50" cy="50" r="47" fill="#fff"/>' +
  '<circle cx="50" cy="50" r="42.5" fill="none" stroke="#4BAFE8" stroke-width="9"/>' +
  '<text x="50" y="51" text-anchor="middle" dominant-baseline="central" ' +
  'font-family="Inter, Helvetica, Arial, sans-serif" font-size="56" font-weight="700" fill="#38383B">S</text>' +
  '</svg>';

export function runOnboarding({ data, email, fallbackName, onDone, preview }: OnboardingOpts): void {
  // Draft state. NOTHING is written until the payoff screen commits it, so a
  // student who closes the tab mid-flow simply starts over rather than landing
  // in a half-configured account.
  const draft = {
    // NO NAME SCREEN (Gabe, 10/8): fewest steps. A direct Schoology connection
    // overwrites this with the student's real first name; otherwise it stays the
    // guess from their email or Google account.
    name: capitalizeName(nameFromEmail(email) || fallbackName || ''),
    connected: false,
    // Courses start EMPTY, and stay empty unless the connection actually finds
    // some (per Gabe). The old code seeded this from getCourses(), which on a
    // fresh account is the generic catalog in courses/maps.ts, so every student
    // was shown English/Math/Science/… as if Cobalt had discovered their real
    // schedule. It had not. Presenting a guess as a finding is the one thing this
    // screen must never do.
    courses: [] as CourseConfig[],
    /** Where the course list came from, for the courses screen's subtitle. */
    coursesFrom: '' as '' | 'schoology' | 'schedule',
    /** Connected through Schoology's own approve screen (the real API). */
    apiConnected: false,
    /** The Google Calendar schedule address, once it has been read successfully. */
    schedule: '',
    // Real assignment titles pulled from the student's own Schoology, shown flying in
    // during the scan. Empty feed means an empty animation, honestly.
    found: [] as string[],
    foundCount: 0,
    // EMPTY, and asked for rather than assumed (Gabe, 8/22). New accounts used to
    // inherit four default languages nobody chose, which is the same "presenting a
    // guess as a finding" the courses screen exists to avoid — and translation is
    // personal in a way a course list is not. Screen 5 asks; whatever is here at the
    // payoff is what gets written.
    languages: [] as string[],
  };

  // --- shell ------------------------------------------------------------------
  const deck = el('div', { class: 'onb-deck' });
  deck.append(el('div', { class: 'onb-orb a' }), el('div', { class: 'onb-orb b' }));
  const fill = el('div', { class: 'onb-fill' });
  deck.append(el('div', { class: 'onb-rail' }, [fill]));
  const backBtn = el('button', { class: 'onb-back hide', 'aria-label': 'Back', text: '‹ Back' });
  deck.append(backBtn);
  // TEMPORARY (Gabe, 8/7): an escape hatch on screen 1 back to the landing page,
  // purely so onboarding can be re-entered quickly while it's being built. It
  // signs out (the landing page is what a signed-out visitor sees) and reloads.
  // It sits in the Back button's slot and only ever shows where Back cannot, so
  // the two never collide. DELETE THIS BLOCK when the flow is done.
  const exitBtn = el('button', { class: 'onb-back onb-exit', text: '‹ Landing page' });
  exitBtn.addEventListener('click', () => {
    void signOut().then(() => location.reload());
  });
  deck.append(exitBtn);
  const stageEl = el('div');
  deck.append(stageEl);
  document.body.append(deck);

  // Per-screen bar targets. The LAST entry is 92, not 100, ON PURPOSE: arriving
  // at the setup screen must not complete the bar. The payoff pushes it to 100
  // so finishing and the reward land as one moment.
  const PCT = [14, 28, 42, 56, 70, 84, 92];
  // Seeded from PCT[0], not a hand-typed number: the bar RATCHETS (Math.max below),
  // so a seed above the first target would make screen 1 open already overshot and
  // the deck would silently be one screen's worth of progress ahead of itself.
  let lastPct = PCT[0];
  let index = 0;

  type Screen = { build: (host: HTMLElement) => void; enter?: (host: HTMLElement) => void };
  const SCREENS: Screen[] = [];

  // BACK FROM SCHOOLOGY'S APPROVE SCREEN (?sgy=return). The redirect reloaded the
  // page, so the deck restarts; this sends it straight back to the Connect screen,
  // which finishes the connection and plays the reveal. Nothing typed before
  // Connect is lost: the screens ahead of it take no input.
  let sgyResumePending = new URLSearchParams(location.search).get('sgy') === 'return';
  let connectAt = 0;

  function go(i: number): void {
    if (i < 0 || i >= SCREENS.length) return;
    const dir = i >= index ? 1 : -1;
    index = i;
    stageEl.replaceChildren();
    const screen = el('div', { class: `onb-screen${dir < 0 ? ' off-l' : ''}` });
    SCREENS[i].build(screen);
    // BUTTON LOW, CONTENT HIGH (Gabe, 10/10): every screen's picture and heading sit
    // near the top and its main button near the bottom, so both land at about the
    // same height from step to step. A spacer before the button takes the slack.
    // The payoff screen keeps its centred layout (its button arrives later).
    const sc = screen.querySelector<HTMLElement>(':scope > .onb-sc');
    const mainBtn = sc?.querySelector(':scope > .onb-cta');
    if (sc && mainBtn && sc.id !== 'onbSetup' && !sc.classList.contains('centered')) {
      sc.classList.add('stacked');
      mainBtn.before(el('div', { class: 'onb-push' }));
    }
    stageEl.append(screen);
    // setTimeout, not rAF: rAF never fires in a hidden/uncomposited tab, which
    // would freeze the entrance and the bar. One tick is enough for the
    // transition to see the initial state first.
    setTimeout(() => {
      screen.classList.add('on');
      lastPct = Math.max(lastPct, PCT[i]);
      fill.style.width = `${lastPct}%`;
    }, 30);
    backBtn.classList.toggle('hide', i === 0 || i === SCREENS.length - 1);
    exitBtn.classList.toggle('hide', i !== 0); // TEMPORARY: screen 1 only
    SCREENS[i].enter?.(screen);
  }
  backBtn.addEventListener('click', () => go(index - 1));

  /** Shared: the centered pane every screen lives in. */
  const pane = (host: HTMLElement, extra = ''): HTMLElement => {
    const sc = el('div', { class: `onb-sc${extra ? ' ' + extra : ''}` });
    host.append(sc);
    return sc;
  };

  /** Shared: a gold primary button. */
  const cta = (label: string): HTMLButtonElement =>
    el('button', { class: 'onb-cta rise d3', text: label }) as HTMLButtonElement;

  /** The Connect screen's caption once Schoology has answered. */
  const connectedLine = (total: number): string =>
    total
      ? `Connected. Found ${total} upcoming assignment${total === 1 ? '' : 's'}.`
      : 'Connected. No upcoming assignments yet, new ones will import automatically.';

  /** Shared: the white Schoology tile. */
  const sgyTile = (big = false): HTMLElement => {
    const tile = el('div', { class: `onb-tile${big ? ' lg' : ''}` });
    tile.innerHTML = SGY_LOGO; // static, authored above, no user input reaches this
    return tile;
  };

  // ------------------------------------------------------------- 1 · welcome
  SCREENS.push({
    build(host) {
      // THE FIRST SLIDE MIRRORS THE LAST (Gabe, 10/10): the same centred layout and
      // button height as the payoff, with the crowned Cobalt gem where the payoff
      // has its check. The two ends are deliberate exceptions to "button low".
      const sc = pane(host, 'centered');
      const mark = el('div', { class: 'onb-crowned' });
      // Static markup authored in this file and laurel.ts; no user input.
      mark.innerHTML = CROWN_SVG + `<div class="onb-crowned-gem">${STONE_SVG}</div>`;
      const h1 = el('h1', { class: 'rise d1' });
      h1.append('Welcome to ', el('span', { class: 'g', text: 'Cobalt' }));
      sc.append(
        mark,
        h1,
        el('p', {
          class: 'onb-sub rise d2',
          text: 'Your Schoology, organized. Everything you need in one calm place.',
        })
      );
      const next = cta('Let’s go');
      next.style.marginTop = '30px'; // the payoff's own gap above Enter Cobalt
      next.addEventListener('click', () => go(index + 1));
      sc.append(next);
    },
  });

  // --------------------------------------------------------- 2 · auto-import
  SCREENS.push({
    build(host) {
      const sc = pane(host);
      const visual = el('div', { class: 'onb-visual rise' });
      const card = el('div', { class: 'onb-vcard' });
      const imp = el('div', { class: 'onb-imp' });
      const lane = el('div', { class: 'onb-lane' });
      lane.append(
        el('div', { class: 'onb-fly f1' }),
        el('div', { class: 'onb-fly f2' }),
        el('div', { class: 'onb-fly f3' })
      );
      const mini = el('div', { class: 'onb-mini' });
      for (const [title, course, color] of [
        ['Read Ch. 7 & annotate', 'English', '#e091a8'],
        ['Unit 5 Test', 'Math', '#f0c040'],
        ['Finish lab write-up', 'Science', '#9b7ec8'],
      ] as const) {
        const row = el('div', { class: 'onb-mini-task' });
        row.append(
          el('span', { class: 'cb' }),
          el('span', { class: 'nm', text: title }),
          el('span', { class: 'crs', style: `color:${color}`, text: course })
        );
        mini.append(row);
      }
      imp.append(sgyTile(), lane, mini);
      card.append(imp);
      visual.append(card);

      const h1 = el('h1', { class: 'rise d1' });
      h1.append('Every assignment ', el('span', { class: 'g', text: 'imports itself' }));
      sc.append(
        visual,
        h1,
        el('p', {
          class: 'onb-sub rise d2',
          text: 'Cobalt reads your Schoology and turns it into a clean task list. Automatically, forever.',
        })
      );
      const next = cta('Continue');
      next.addEventListener('click', () => go(index + 1));
      sc.append(next);
    },
  });

  // ------------------------------------------------------------- 3 · connect
  // The scan plays IN PLACE rather than on its own slide: pressing Connect hides
  // the link field, sweeps the Schoology mark, flies assignment chips in, then
  // turns the same button into Continue.
  connectAt = SCREENS.length;
  SCREENS.push({
    build(host) {
      const sc = pane(host);

      // 18, not 0: zeroing this had the Schoology tile sitting right on top of the
      // headline (Gabe, 8/22). It was zeroed to stop the screen overshooting a height
      // the deck no longer measures per-screen, so the reason is gone and the space
      // comes back. Still under the 34px default, because Connect is the tallest
      // screen and the deck's floor is set by it.
      const visual = el('div', { class: 'onb-visual rise', style: 'margin-bottom:18px' });
      const stage = el('div', { class: 'onb-stage' });
      const chips = el('div', { class: 'onb-chips' });
      stage.append(sgyTile(true), el('div', { class: 'onb-beam' }), chips);
      visual.append(stage);

      const h1 = el('h1', { class: 'rise d1' });
      h1.append('Connect ', el('span', { class: 'g', text: 'Schoology' }));
      // No caption until Schoology has answered (Gabe, 10/9); reveal() fills it in.
      const sub = el('p', { class: 'onb-sub rise d2', style: 'display:none' });

      // CONNECT WITH SCHOOLOGY (Gabe, 10/7/26), the ONLY way in since 10/9/26: the
      // real connection, through the school's own Schoology approve screen. No card,
      // no pill, no other routes (Gabe, 10/8/26): the heading and caption already
      // say what this is, so the screen is just the school search.
      const btn = cta('Continue');
      const apiCard = el('div', { class: 'rise d2', style: 'width:100%;max-width:420px;margin-top:18px' });
      const apiStatus = el('div', { class: 'onb-route-status' });
      const startApi = (host: string): void => {
        picker.setBusy(true);
        apiStatus.textContent = 'Opening Schoology…';
        // Leaves the page on success; Schoology sends the student back here.
        startSchoologyConnect(host).catch((e) => {
          picker.setBusy(false);
          apiStatus.textContent = sgyErrorText(e);
        });
      };
      // One tap per school (Gabe, 10/8/26): no address to type for a listed school.
      const picker = buildSchoolPicker({ inputClass: 'onb-field', btnClass: 'onb-route-btn', onPick: startApi });
      apiCard.append(picker.el, apiStatus);

      if (draft.connected) {
        // Back-navigation after connecting: no replay, just the result and Continue.
        stage.classList.add('done');
        sub.textContent = connectedLine(draft.foundCount);
        sub.style.display = '';
        sc.append(visual, h1, sub, btn);
      } else {
        // btn stays in the screen, hidden: reveal() turns it into Continue.
        btn.style.display = 'none';
        sc.append(visual, h1, sub, apiCard, btn);
      }

      // AUDIT PREVIEW ONLY (Gabe, 10/9): a way past Connect so the later screens
      // can be reviewed without a Schoology login. Never in the real app: a student
      // who skips forgets, opens an empty app, and concludes Cobalt is useless. The
      // connection IS the product, so getting into Cobalt means Schoology is connected.
      if (preview) {
        const skip = el('button', { class: 'onb-skip', type: 'button', text: 'Skip for now (preview only)' });
        skip.addEventListener('click', () => go(index + 1));
        sc.append(skip);
      }

      // The payoff: the picker folds away, the Schoology mark sweeps, the real
      // titles fly in, and the hidden button appears as Continue.
      const mine = index; // only touch this screen if the student is still on it
      const alive = (): boolean => index === mine;
      function reveal(titles: string[], total: number): void {
        draft.connected = true;
        draft.found = titles;
        draft.foundCount = total;
        apiCard.style.display = 'none';
        btn.style.display = '';
        btn.disabled = true;
        stage.classList.add('scanning');
        titles.forEach((t, i) =>
          setTimeout(() => {
            if (!alive()) return;
            chips.append(el('span', { class: 'onb-chip', text: t }));
          }, 350 + i * 230)
        );
        setTimeout(() => {
          if (!alive()) return;
          stage.classList.remove('scanning');
          stage.classList.add('done');
          sub.textContent = connectedLine(total);
          sub.style.display = '';
          btn.disabled = false;
        }, 350 + titles.length * 230 + 250);
      }
      btn.addEventListener('click', () => {
        if (draft.connected) go(index + 1);
      });

      // Finishing a Schoology approval (see sgyResumePending above): real titles fly
      // in, and the courses screen is filled from the student's real sections.
      if (sgyResumePending) {
        sgyResumePending = false;
        picker.setBusy(true);
        apiStatus.textContent = 'Finishing the connection…';
        void (async () => {
          try {
            const st = await finishSchoologyConnectIfReturning();
            if (!st) throw new Error('That Schoology connection expired. Try connecting again.');
            if (st.firstName) draft.name = capitalizeName(st.firstName);
            if (alive()) apiStatus.textContent = 'Connected. Reading your assignments…';
            const p = await fetchSgyApiPayload();
            if (!alive()) return;
            const names = [...new Set((p?.courses ?? []).map((c) => c.name.trim()).filter(Boolean))];
            if (names.length) {
              draft.courses = names.map((name) => ({ id: 'course_' + genId(), name, color: getCourseColor(name), parseWords: [] }));
              draft.coursesFrom = 'schoology';
            }
            draft.apiConnected = true;
            const today = todayStr();
            const upcoming = (p?.assignments ?? [])
              .filter((a) => a.date >= today)
              .sort((a, b) => a.date.localeCompare(b.date));
            reveal(
              upcoming.slice(0, 6).map((a) => a.title),
              upcoming.length
            );
          } catch (e) {
            if (!alive()) return;
            picker.setBusy(false);
            apiStatus.textContent = sgyErrorText(e);
          }
        })();
      }
    },
  });

  // ------------------------------------------------------------- 3b · courses
  // BEFORE the schedule screen (Gabe, 10/8). Courses a schedule calendar names
  // that this list lacks are still added when that screen connects, after this one.
  // The Settings ▸ Courses editor, verbatim: same classes, same markup, so what
  // a student builds here is exactly what they'll edit in Settings later.
  SCREENS.push({
    build(host) {
      const sc = pane(host, 'tight');
      const h1 = el('h1', { class: 'rise' });
      const discovered = draft.courses.length > 0; // filled only by a real scrape
      h1.append(discovered ? 'We found your ' : 'Your ', el('span', { class: 'g', text: 'courses' }));
      // Two honest subtitles: one for "we really did find these", one for "we have
      // nothing, so this is yours to type". Never claim a discovery that didn't
      // happen.
      sc.append(
        h1,
        el('p', {
          class: 'onb-sub rise d1',
          text: discovered
            ? `Pulled from ${draft.coursesFrom === 'schedule' ? 'your schedule' : 'Schoology'}. Fix anything that looks wrong, and add parse words for easy navigation.`
            : 'Add your courses here. Change them any time in Settings.',
        })
      );

      // The pin-free wrapper exists so the list can scroll inside itself.
      const wrap = el('div', { class: 'onb-courses-wrap rise d2' });
      const rows = el('div', { class: 'settings-courses' });
      wrap.append(rows);
      sc.append(wrap);

      const addWrap = el('div', { class: 'rise d2', style: 'width:100%' });
      const addBtn = el('button', { class: 'settings-add', text: '+ Add course' });
      addWrap.append(addBtn);
      sc.append(addWrap);

      const newIds = new Set<string>(); // courses added HERE show gold recommendations
      const refocus = { id: null as string | null };
      let firstDraw = true; // the entrance cascade plays once, never on every edit

      // THE SETTINGS ROW, SHARED (courses/courseRow.ts): one builder for both
      // screens, so a course looks and behaves identically here and in Settings.
      // Nothing is saved from here; the payoff screen commits the whole draft.
      const draw = (): void => {
        rows.replaceChildren();
        for (const c of draft.courses) {
          const row = buildCourseRow(c, {
            all: () => draft.courses,
            isNew: (id) => newIds.has(id),
            onSave: () => {},
            onRemove: () => {
              draft.courses = draft.courses.filter((x) => x.id !== c.id);
              newIds.delete(c.id);
            },
            redraw: draw,
            refocus,
          });
          // Rebuilding creates fresh nodes, which would replay the entrance
          // animation on every keystroke. That flicker is the bug; skip it after
          // the first paint.
          if (!firstDraw) {
            row.style.opacity = '1';
            row.style.transform = 'none';
            row.style.animation = 'none';
          }
          rows.append(row);
        }
        firstDraw = false;
        requestAnimationFrame(moreBelow);
      };
      // SCROLL CUE (Gabe, 10/9: "not so obvious that this is scrollable"): a thin
      // visible scrollbar plus a deeper fade at the bottom while rows remain below.
      // The fade lifts once the last row is in view, so it never dims what you edit.
      const moreBelow = (): void => {
        rows.classList.toggle('more-below', rows.scrollHeight - rows.scrollTop - rows.clientHeight > 4);
      };
      rows.addEventListener('scroll', moreBelow, { passive: true });
      draw();

      addBtn.addEventListener('click', () => {
        const c: CourseConfig = {
          id: 'course_onb_' + Math.random().toString(36).slice(2, 9),
          name: 'New course',
          // Same rule as Settings: every course is born a colour nothing else here
          // is wearing (courses/colors.ts). Onboarding is where a student makes
          // four or five of these in a row, so it is where it matters most.
          color: nextCourseColor(draft.courses.map((x) => x.color)),
          parseWords: [],
        };
        draft.courses.push(c);
        newIds.add(c.id);
        draw();
        // The list scrolls internally, so a new row can land below the fold.
        // Bring it into view BEFORE focusing so the caret is never off-screen.
        const lastRow = rows.querySelector('.course-row:last-child');
        lastRow?.scrollIntoView({ block: 'nearest' });
        const nameField = lastRow?.querySelector('.course-name') as HTMLInputElement | null;
        nameField?.focus();
        nameField?.select();
      });

      const next = cta('Continue');
      next.addEventListener('click', () => go(index + 1));
      sc.append(next);
    },
  });

  // ------------------------------------------------------------- 4 · schedule
  // The student's timetable, from their own Google Calendar (schedule/feed.ts).
  // The calendar is private, so the student pastes its "secret address"; the
  // address is read for real before it is accepted, and the next school day is
  // shown back as proof. Skippable, unlike Schoology: not every school publishes
  // a schedule calendar, and Cobalt works without it.
  SCREENS.push({
    build(host) {
      const sc = pane(host);
      // CALENDAR → COBALT (Gabe, 10/9): every other screen opens on a picture, so
      // this one gets the auto-import screen's motion: periods flying from a
      // calendar into the Cobalt mark.
      const visual = el('div', { class: 'onb-visual rise' });
      const card = el('div', { class: 'onb-vcard' });
      const imp = el('div', { class: 'onb-imp onb-imp-cal' });
      const lane = el('div', { class: 'onb-lane' });
      lane.append(
        el('div', { class: 'onb-fly f1' }),
        el('div', { class: 'onb-fly f2' }),
        el('div', { class: 'onb-fly f3' })
      );
      const cal = el('div', { class: 'onb-tile onb-tile-lg' });
      cal.innerHTML = CAL_ICON; // static, authored above, no user input reaches this
      const gem = el('div', { class: 'onb-tile onb-tile-lg onb-tile-gem' });
      gem.append(el('img', { src: '/icons/icon.svg', alt: '' }));
      imp.append(cal, lane, gem);
      card.append(imp);
      visual.append(card);
      sc.append(visual);

      const h1 = el('h1', { class: 'rise d1' });
      h1.append('Add your ', el('span', { class: 'g', text: 'schedule' }));
      const sub = el('p', {
        class: 'onb-sub rise d2',
        text: 'If your school puts your classes on Google Calendar, Cobalt shows your day on the dashboard: every period, room and teacher.',
      });
      sc.append(h1, sub);

      // THE SAME SHAPE AS THE SCHOOLOGY LINK SCREEN (Gabe, 10/8): one guide button,
      // then the field. The four-line list of steps it replaced said less than the
      // animated walkthrough (gcalGuide.ts) shows.
      const helpBtn = el('button', {
        class: 'onb-help',
        type: 'button',
        text: 'Where do I find this? Open the guide →',
      });
      const fieldWrap = el('div', { class: 'rise d2', style: 'width:100%;max-width:420px;margin-top:14px' });
      const input = textInput({
        class: 'onb-field',
        placeholder: 'https://calendar.google.com/calendar/ical/…/basic.ics',
        value: draft.schedule,
      });
      // Closing the guide (any way) puts the caret back in the address field.
      helpBtn.addEventListener('click', () => openGcalGuide(() => input.focus()));
      const err = el('div', { class: 'onb-err' });
      const preview = el('div', { class: 'onb-sched' });
      fieldWrap.append(helpBtn, input, err);
      sc.append(fieldWrap, preview);

      const btn = cta(draft.schedule ? 'Continue' : 'Connect');
      const skip = el('button', { class: 'onb-skip', type: 'button', text: 'Skip, my school doesn’t use this' });
      sc.append(btn, skip);
      skip.addEventListener('click', () => go(index + 1));

      /** The next school day, as proof the address works. */
      const showDay = (blocks: ReturnType<typeof parseScheduleIcs>): void => {
        const day = dayToShow(blocks);
        preview.replaceChildren();
        if (!day) return;
        for (const b of day.blocks.filter((x) => x.isClass).slice(0, 5)) {
          const row = el('div', { class: 'onb-sched-row' });
          row.append(
            el('span', { class: 'onb-sched-time', text: formatWallClock(b.start) }),
            el('span', { class: 'onb-sched-name', text: b.name }),
            el('span', { class: 'onb-sched-room', text: b.room })
          );
          preview.append(row);
        }
      };

      const submit = (): void => {
        if (draft.schedule) {
          go(index + 1);
          return;
        }
        const v = input.value.trim();
        if (!isGoogleCalendarIcalUrl(v)) {
          err.textContent = 'That isn’t a Google Calendar secret address. It starts with https://calendar.google.com/calendar/ical/';
          input.focus();
          return;
        }
        const mine = index;
        btn.disabled = true;
        btn.textContent = 'Reading…';
        void (async () => {
          try {
            const blocks = parseScheduleIcs(await fetchScheduleIcs(v));
            void refreshFeed(v).catch(() => {}); // warm the dashboard's cache
            if (index !== mine) return;
            draft.schedule = v;
            // The schedule names every course exactly: add any the list lacks.
            const have = new Set(draft.courses.map((c) => c.name.toLowerCase()));
            for (const name of currentCourses(blocks)) {
              if (have.has(name.toLowerCase())) continue;
              draft.courses.push({
                id: 'course_onb_' + Math.random().toString(36).slice(2, 9),
                name,
                color: nextCourseColor(draft.courses.map((x) => x.color)),
                parseWords: [],
              });
              have.add(name.toLowerCase());
              if (!draft.coursesFrom) draft.coursesFrom = 'schedule';
            }
            fieldWrap.style.display = 'none';
            sub.textContent = 'Connected. Here’s your next school day:';
            showDay(blocks);
            btn.disabled = false;
            btn.textContent = 'Continue';
            skip.remove();
          } catch (e) {
            if (index !== mine) return;
            err.textContent = e instanceof Error ? e.message : 'Couldn’t read that calendar.';
            btn.disabled = false;
            btn.textContent = 'Connect';
          }
        })();
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      input.addEventListener('input', () => (err.textContent = ''));
    },
  });

  // ----------------------------------------------------------- 5 · languages
  // THE SETTINGS PICKER, VERBATIM (Gabe, 8/22) — same builder, same markup, same
  // classes, exactly as the courses screen borrows the Settings courses editor. The
  // reason this screen exists at all is reach: translation is a substantial part of
  // Cobalt and it is highly personal, but it lived behind Settings, and students
  // rarely open Settings. Asking here is how the feature gets found.
  //
  // Two is the ask because two is what the free tier gives. Nothing is REQUIRED:
  // Continue is live from the first frame, an empty list is a real answer, and the
  // subtitle says where to change it later. An onboarding step that refuses to let
  // you past is a worse first impression than a feature you discover a week in.
  SCREENS.push({
    build(host) {
      const sc = pane(host, 'tight');
      // The globe, drifting through the scripts the picker can read. Screens 1 to 3
      // all open with something moving; this one and Courses were the two that just
      // sat there (Gabe, 8/22). Above the heading, like every other screen's picture (10/9).
      const orbit = el('div', { class: 'onb-visual onb-langs rise' });
      const GLYPHS = ['あ', 'ע', 'ñ', 'ت', 'Я', '中', 'Ω', 'ह'];
      GLYPHS.forEach((ch, i) => {
        const g = el('span', { class: 'onb-lang-glyph', text: ch });
        // Spread around the ring, each drifting on its own clock so the group never
        // pulses in unison.
        g.style.setProperty('--i', String(i));
        g.style.setProperty('--n', String(GLYPHS.length));
        orbit.append(g);
      });
      orbit.append(el('span', { class: 'onb-lang-core', text: '🌐' }));
      sc.append(orbit);

      const h1 = el('h1', { class: 'rise d1' });
      h1.append('Your ', el('span', { class: 'g', text: 'languages' }));
      // ONE CAPTION, NOT TWO (Gabe, 8/22). The screen's subtitle and the picker's
      // own lead were saying the same sentence twice, at roughly triple the length
      // of every other screen's caption. The subtitle is now as short as theirs, and
      // the picker's lead is suppressed rather than reworded, because with the
      // subtitle above it there is nothing left for it to add.
      sc.append(
        h1,
        el('p', {
          class: 'onb-sub rise d2',
          text: 'Assignments written in these get an English line underneath. Change it any time in Settings.',
        })
      );


      // onb-lang-wrap carries the stacking order (see the CSS): the results list has
      // to open OVER the Continue button below it, and z-index inside the picker
      // cannot do that on its own.
      const wrap = el('div', { class: 'onb-lang-wrap rise d2', style: 'width:100%' });
      wrap.append(
        buildLanguagePicker({
          get: () => draft.languages,
          set: (codes) => {
            draft.languages = codes;
          },
          lead: '', // the subtitle above already said it
          placeholder: 'Search 185 languages…',
          emptyText: 'Nothing picked yet.',
          // TWO, which is what the free tier gives.
          max: 2,
        })
      );
      sc.append(wrap);

      const next = cta('Continue');
      next.addEventListener('click', () => go(index + 1));
      sc.append(next);
    },
  });

  // ------------------------------------------------- 6 · commit, sync, payoff
  let committed = false;
  SCREENS.push({
    build(host) {
      const sc = pane(host);
      sc.id = 'onbSetup';
      sc.append(
        el('div', { class: 'onb-spin' }),
        el('h1', { text: 'Setting things up…' }),
        el('p', {
          class: 'onb-sub',
          text: draft.connected
            ? 'Importing your assignments from Schoology.'
            : 'Saving your courses and preferences.',
        })
      );
    },
    enter(host) {
      void (async () => {
        const sc = host.querySelector('.onb-sc') as HTMLElement;

        // Commit the account FIRST. From this moment onboarding can never be
        // lost, even if the tab closes mid-sync.
        if (!committed) {
          committed = true;
          await data.setProfile('account', { displayName: draft.name, onboarded: true });
          data.markOnboardedLocally(); // survives a transient blank read
          await replaceCourses(draft.courses);
          // Merged onto the stored prefs rather than written as a bare object: a
          // fresh account has none yet, and normalizePrefs is what fills in every
          // other default so this write cannot flatten them.
          const prefs = normalizePrefs(await data.getProfile('prefs'));
          prefs.tasks.translateFrom = draft.languages;
          await data.setProfile('prefs', prefs);
          if (draft.schedule) await saveFeed(data, draft.schedule);
        }

        let added = 0;
        let failed = false;
        // A Schoology connection with nothing upcoming has nothing to import, and the
        // sync would read that as "no source" and report a failure that isn't one.
        if (draft.apiConnected && draft.foundCount > 0) {
          try {
            added = (await runSync(data)).added;
          } catch {
            failed = true;
          }
        }

        // --- the payoff -------------------------------------------------------
        sc.replaceChildren();
        sc.append(el('div', { class: 'onb-check', text: '✓' }));
        // The name in the accent blue, like every other heading's key word (10/10).
        const h1 = el('h1');
        if (draft.name) h1.append('You’re in, ', el('span', { class: 'g', text: draft.name }), '!');
        else h1.append('You’re ', el('span', { class: 'g', text: 'in' }), '!');
        sc.append(h1);

        // Every imported assignment, listed. The count in the headline and the
        // rows below it are the SAME data, so the number can never be a claim
        // the list contradicts.
        // Undated tasks sort last, not first: '' would win a plain string compare.
        const imported = (Object.values(data.getTasks()) as Task[])
          .filter((t) => !t.completed)
          .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

        let subText: string;
        if (failed) subText = 'Couldn’t reach Schoology. You’re connected, retry from Settings.';
        else if (added > 0) subText = `${added} assignment${added === 1 ? '' : 's'} imported, sorted into your courses.`;
        else if (draft.apiConnected) subText = 'Connected. New assignments will import automatically.';
        else subText = 'Your courses are saved and ready.';
        sc.append(el('p', { class: 'onb-sub', text: subText }));

        if (imported.length) {
          const wrap = el('div', { class: 'onb-imp-wrap' });
          const list = el('div', { class: 'onb-imp-rows' });
          for (const t of imported) {
            const row = el('div', { class: 'onb-imp-row' });
            row.append(el('span', { class: 'onb-imp-title', text: t.title }));
            const assess = BADGE_ASSESSMENT_RE.exec(t.title);
            if (assess) {
              const word = assess[1].toLowerCase();
              const label = (word === 'quizzes' ? 'quiz' : word.replace(/s$/, '')).toUpperCase();
              row.append(el('span', { class: 'badge', text: label }));
            }
            if (t.course) {
              row.append(
                el('span', {
                  class: 'course',
                  style: `color:${getCourseColor(t.course)}`,
                  text: t.course,
                })
              );
            }
            list.append(row);
          }
          wrap.append(list);
          sc.append(wrap);
        }

        const enter = el('button', { class: 'onb-cta', style: 'margin-top:30px', text: 'Enter Cobalt' });
        enter.addEventListener('click', () => {
          deck.remove();
          onDone(draft.name);
        });
        sc.append(enter);
        enter.focus();

        fill.style.width = '100%';
        lastPct = 100;

        // confetti: completion and reward land as one moment
        const burst = el('div', { class: 'onb-confetti' });
        const colors = ['#7db4ff', '#f2bb33', '#4098d7', '#27ae60', '#fff'];
        for (let i = 0; i < 28; i++) {
          const p = el('i');
          p.style.setProperty('--x', `${4 + Math.random() * 92}%`);
          p.style.setProperty('--d', `${Math.random() * 0.5}s`);
          p.style.setProperty('--r', `${Math.floor(Math.random() * 360)}deg`);
          p.style.setProperty('--c', colors[i % colors.length]);
          burst.append(p);
        }
        host.append(burst);
        setTimeout(() => burst.remove(), 3600); // sweep up after the fall
      })();
    },
  });

  go(sgyResumePending ? connectAt : 0);
  preview?.({ go, count: SCREENS.length, draft });
}
