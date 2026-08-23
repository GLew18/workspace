// Cobalt: first-run onboarding deck.
//
// Ported from the onb-A prototype (app/public/onb-A.html). Six full-screen
// slides over the branded gradient field, with a progress rail that only ever
// climbs:
//
//   1. WELCOME:  the app mark, the wordmark, one button.
//   2. IMPORT:   what the product actually does, shown rather than described.
//   3. CONNECT:  the Schoology mark + the iCal link. Pressing Connect plays the
//                scan animation IN PLACE (it is not a separate slide), then the
//                button becomes Continue. There is deliberately NO skip: a
//                student who skips forgets, opens an empty app, and concludes
//                the product is bad. The connection IS the product.
//   4. COURSES:  the Settings ▸ Courses editor, verbatim (same classes, from
//                settings.css), because onboarding is where courses are BORN
//                and Settings is where they're edited later.
//   5. NAME:     pre-filled from the signed-in account's email, so the student
//                confirms a guess instead of answering a blank prompt.
//   6. PAYOFF:   everything commits here, the first sync runs live, and the
//                real imported assignments are listed (not a teaser count).
//
// WHERE AUTH SITS: main.ts signs the user in BEFORE calling this (it passes
// `user.email`), so the prototype's sign-in slide has no equivalent here. By the
// time this runs, the account already exists. That is also why the name screen
// can pre-fill: the email is already known.
//
// Contract (unchanged from the previous card version): saves profile/account with
// onboarded: true + markOnboardedLocally(), saves profile/schoology when a link is
// given, runs the first sync, then calls onDone(name).

import type { Data } from '../db';
import { el, textInput } from '../util/dom';
import { attachColorPicker } from '../ui/colorPicker';
import { capitalizeName, nameFromEmail } from '../util/names';
import { runSync, fetchIcal } from '../schoology/sync';
import { replaceCourses, getCourseColor } from '../courses/registry';
import { recommendedSet } from '../courses/recommend';
import { nextCourseColor } from '../courses/colors';
import { BADGE_ASSESSMENT_RE, isSchoologyIcalUrl, parseIcal, taskEvents } from '../schoology/ical';
import { detectSchoologyExtension, requestSgyData } from '../schoology/extension';
import { todayStr } from '../util/dates';
import { genId } from '../util/ids';
import { openIcalGuide } from './icalGuide';
import { buildLanguagePicker } from '../settings/languagePicker';
import { normalizePrefs } from '../prefs';
import { signOut } from '../auth'; // TEMPORARY: powers the "‹ Landing page" escape hatch
import type { CourseConfig, Task } from '../types';

interface OnboardingOpts {
  data: Data;
  email: string;
  fallbackName: string;
  onDone: (displayName: string) => void;
}

/** The real Schoology mark, so the connect step shows the service by its own logo. */
const SGY_LOGO =
  '<svg viewBox="0 0 100 100" xmlns="http://www.w3.org/2000/svg" role="img" aria-label="Schoology">' +
  '<circle cx="50" cy="50" r="47" fill="#fff"/>' +
  '<circle cx="50" cy="50" r="42.5" fill="none" stroke="#4BAFE8" stroke-width="9"/>' +
  '<text x="50" y="51" text-anchor="middle" dominant-baseline="central" ' +
  'font-family="Inter, Helvetica, Arial, sans-serif" font-size="56" font-weight="700" fill="#38383B">S</text>' +
  '</svg>';

// Link validation: isSchoologyIcalUrl (schoology/ical.ts), the same strict check
// Settings and the extension use. Any-URL was not enough: a YouTube link is a
// perfectly valid URL and a perfectly useless calendar feed.


/**
 * The student's REAL courses, or nothing.
 *
 * The iCal feed carries no course field at all (verified against Heschel's feed:
 * UID, DTSTART, SUMMARY, DESCRIPTION, URL, and nothing else), so the only honest
 * source is the companion extension, which reads the course names off the
 * student's own logged-in Schoology pages. No extension, no Chrome, or nothing
 * scraped yet returns an empty list, and the courses screen then shows an empty
 * editor instead of a fabricated schedule.
 */
async function discoverCourses(): Promise<CourseConfig[]> {
  try {
    if (!(await detectSchoologyExtension())) return [];
    const payload = await requestSgyData();
    const names = (payload?.courses ?? []).map((c) => c.name.trim()).filter(Boolean);
    // A section can appear more than once across scraped pages.
    return [...new Set(names)].map((name) => ({
      id: 'course_' + genId(),
      name,
      color: getCourseColor(name),
      parseWords: [],
    }));
  } catch {
    return []; // a scrape problem must never block onboarding
  }
}

export function runOnboarding({ data, email, fallbackName, onDone }: OnboardingOpts): void {
  // Draft state. NOTHING is written until the payoff screen commits it, so a
  // student who closes the tab mid-flow simply starts over rather than landing
  // in a half-configured account.
  const draft = {
    name: capitalizeName(nameFromEmail(email) || fallbackName || ''),
    ical: '',
    connected: false,
    // Courses start EMPTY, and stay empty unless the connection actually finds
    // some (per Gabe). The old code seeded this from getCourses(), which on a
    // fresh account is the generic catalog in courses/maps.ts, so every student
    // was shown English/Math/Science/… as if Cobalt had discovered their real
    // schedule. It had not. Presenting a guess as a finding is the one thing this
    // screen must never do.
    courses: [] as CourseConfig[],
    // Real assignment titles pulled from the student's own feed, shown flying in
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

  function go(i: number): void {
    if (i < 0 || i >= SCREENS.length) return;
    const dir = i >= index ? 1 : -1;
    index = i;
    stageEl.replaceChildren();
    const screen = el('div', { class: `onb-screen${dir < 0 ? ' off-l' : ''}` });
    SCREENS[i].build(screen);
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

  /** Shared: the white Schoology tile. */
  const sgyTile = (big = false): HTMLElement => {
    const tile = el('div', { class: `onb-tile${big ? ' lg' : ''}` });
    tile.innerHTML = SGY_LOGO; // static, authored above, no user input reaches this
    return tile;
  };

  // ------------------------------------------------------------- 1 · welcome
  SCREENS.push({
    build(host) {
      const sc = pane(host);
      const hero = el('div', { class: 'onb-visual onb-hero', style: 'margin-bottom:26px' });
      hero.append(el('div', { class: 'onb-hero-glow' }));
      hero.append(el('img', { class: 'onb-mark', src: '/icons/icon.svg', alt: '' }));
      const wordmark = el('div', { class: 'onb-wordmark rise d1' });
      wordmark.append('C', el('span', { class: 'o', text: 'o' }), 'balt');
      sc.append(
        hero,
        el('div', { class: 'onb-eyebrow rise d1', text: 'welcome to' }),
        wordmark,
        el('p', {
          class: 'onb-sub rise d2',
          style: 'margin-top:16px',
          text: 'Your Schoology, organized. Every assignment in one calm place.',
        })
      );
      const next = cta('Let’s go');
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
          text: 'Cobalt reads your Schoology calendar and turns it into a clean task list. Automatically, forever.',
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
      const sub = el('p', {
        class: 'onb-sub rise d2',
        text: 'Paste your calendar link and every assignment imports itself, automatically, forever.',
      });

      const fieldWrap = el('div', {
        class: 'rise d2',
        style: 'width:100%;max-width:420px;margin-top:22px',
      });
      // The animated walkthrough (icalGuide.ts): Schoology-accurate slides of the
      // REAL route (your name → Settings → scroll → copy). It replaced a text
      // list that described a route Schoology doesn't actually have.
      // THE SAME BUTTON AS SETTINGS' fix-it guides (Gabe, 8/22). Both open an
      // animated walkthrough of a thing the student cannot find, so they should not
      // be two different-looking controls. The play disc and the "4 slides · 15 sec"
      // tail went with the restyle: one centred accent line says it.
      const helpBtn = el('button', {
        class: 'onb-help',
        type: 'button',
        text: 'Can’t find your link? Open the guide →',
      });

      const input = textInput({
        class: 'onb-field',
        placeholder: 'webcal://… or https://…/ical.ics',
        value: draft.ical,
      });
      // Closing the guide (any way) puts the caret back in the link field.
      helpBtn.addEventListener('click', () => openIcalGuide(() => input.focus()));
      const err = el('div', { class: 'onb-err' });
      fieldWrap.append(helpBtn, input, err);

      const btn = cta('Connect');
      sc.append(visual, h1, sub, fieldWrap, btn);

      // TEMPORARY (Gabe, 8/9): a way past the connect step while the rest of
      // onboarding is being built, so testing later screens doesn't require a
      // working Schoology feed every time.
      //
      // This is deliberately NOT a product decision. The header comment above
      // explains why there is no Skip in the real flow: a student who skips
      // forgets, opens an empty app, and concludes Cobalt is broken. The
      // connection IS the product. DELETE THIS BLOCK when the flow is done.
      //
      // It leaves draft.connected false and draft.courses empty, which the later
      // screens already handle honestly ("Your courses" + "add them here").
      const skip = el('button', { class: 'onb-skip', type: 'button', text: 'Skip for now (temporary)' });
      skip.addEventListener('click', () => go(index + 1));
      sc.append(skip);

      const submit = (): void => {
        // Back-navigation: don't replay the scan, just move on.
        if (draft.connected) {
          go(index + 1);
          return;
        }
        const v = input.value.trim();
        if (!v) {
          err.textContent = 'Paste your calendar link to continue.';
          input.focus();
          return;
        }
        if (!isSchoologyIcalUrl(v)) {
          err.textContent =
            'That is not your Schoology calendar link. It looks like webcal://heschel.schoology.com/calendar/feed/ical/…';
          input.focus();
          input.select();
          return;
        }
        const mine = index; // only touch this screen if the student is still on it
        const alive = (): boolean => index === mine;
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        sub.textContent = 'Reading your calendar feed…';

        // THE REAL CONNECTION. This used to validate the URL's shape and then play
        // a canned animation over six invented titles, which meant a student with
        // an empty Schoology watched Cobalt "find" six assignments that do not
        // exist. Now the feed is actually downloaded and parsed, and what flies in
        // is what is genuinely in it.
        void (async () => {
          let titles: string[] = [];
          let total = 0;
          try {
            const text = await fetchIcal(v);
            const today = todayStr();
            // The same rule the importer uses: future items only, no past backlog.
            const upcoming = taskEvents(parseIcal(text)).filter((e) => e.date >= today);
            total = upcoming.length;
            titles = upcoming
              .sort((a, b) => a.date.localeCompare(b.date))
              .slice(0, 6)
              .map((e) => e.summary);
          } catch (e) {
            if (!alive()) return;
            // fetchIcal throws sentences meant for a student, so show them as-is.
            fieldWrap.style.display = '';
            err.textContent = e instanceof Error ? e.message : 'Couldn’t read that link.';
            btn.disabled = false;
            btn.textContent = 'Connect';
            input.focus();
            return;
          }
          if (!alive()) return;

          // The link works. Commit it to the draft and reveal what was found.
          draft.ical = v;
          draft.connected = true;
          draft.found = titles;
          draft.foundCount = total;
          fieldWrap.style.display = 'none';
          stage.classList.add('scanning');
          titles.forEach((t, i) =>
            setTimeout(() => {
              if (!alive()) return;
              chips.append(el('span', { class: 'onb-chip', text: t }));
            }, 350 + i * 230)
          );

          // Real course names, when they exist at all, come from the companion
          // extension: the calendar feed carries none. No extension, or nothing
          // scraped, means the courses screen stays empty rather than inventing.
          void discoverCourses().then((found) => {
            if (found.length) draft.courses = found;
          });

          setTimeout(() => {
            if (!alive()) return;
            stage.classList.remove('scanning');
            stage.classList.add('done');
            sub.textContent = total
              ? `Connected. Found ${total} upcoming assignment${total === 1 ? '' : 's'}.`
              : 'Connected. No upcoming assignments yet, new ones will import automatically.';
            btn.disabled = false;
            btn.textContent = 'Continue';
          }, 350 + titles.length * 230 + 250);
        })();
      };
      btn.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      input.addEventListener('input', () => (err.textContent = ''));
    },
  });

  // ------------------------------------------------------------- 4 · courses
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
            ? 'Pulled from Schoology. Fix anything that looks wrong, and add what’s missing.'
            : 'Your feed carries no course names, so add them here. Change them any time in Settings.',
        })
      );

      // Three chips settling into a stack, in the first three colours a new course
      // is actually given (courses/colors.ts). Screens 1 to 3 all open with
      // something moving; Courses and Languages were the two that just sat there
      // (Gabe, 8/22), and this doubles as a preview of what the colours are FOR.
      // NAMED, not bare colour bars (Gabe, 8/22): a stripe of yellow says nothing,
      // "Math" in yellow says what the colour is for. Shown in the first three
      // colours a new course is actually given, so it is a real preview and not a
      // decoration. The names are generic subjects because the student's own list is
      // right underneath and would only repeat itself.
      const swatches = el('div', { class: 'onb-visual onb-swatches rise d1' });
      const PREVIEW: Array<[string, string]> = [
        ['Math', '#f2c531'],
        ['History', '#ef4444'],
        ['Science', '#4a9eff'],
      ];
      PREVIEW.forEach(([label, c], i) => {
        const chip = el('span', { class: 'onb-swatch', text: label });
        chip.style.setProperty('--c', c);
        chip.style.setProperty('--i', String(i));
        swatches.append(chip);
      });
      sc.append(swatches);

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
      let refocusIdx = -1;
      let firstDraw = true; // the entrance cascade plays once, never on every edit

      const draw = (): void => {
        rows.replaceChildren();
        draft.courses.forEach((c, idx) => {
          const row = el('div', { class: 'course-row' });
          // Rebuilding creates fresh nodes, which would replay the entrance
          // animation on every keystroke. That flicker is the bug; skip it after
          // the first paint.
          if (!firstDraw) {
            row.style.opacity = '1';
            row.style.transform = 'none';
            row.style.animation = 'none';
          }

          const top = el('div', { class: 'course-row-top' });
          const color = el('button', { type: 'button', class: 'course-color', title: 'Course color' });
          attachColorPicker(color, {
            value: () => c.color,
            onChange: (hex) => (c.color = hex), // persisted with the rest of the draft on Continue
          });
          const nameIn = el('input', {
            class: 'course-name',
            value: c.name,
            'aria-label': 'Course name',
          }) as HTMLInputElement;
          const del = el('button', { class: 'course-del', title: 'Remove', text: '✕' });
          top.append(color, nameIn, del);

          const chipRow = el('div', { class: 'parse-chips' });
          for (const w of c.parseWords) {
            const chip = el('span', { class: 'parse-chip', text: w });
            const x = el('button', { class: 'parse-chip-x', text: '×' });
            x.addEventListener('click', () => {
              c.parseWords = c.parseWords.filter((p) => p !== w);
              draw();
            });
            chip.append(x);
            chipRow.append(chip);
          }
          if (newIds.has(c.id)) {
            const used = new Set(draft.courses.flatMap((x) => x.parseWords));
            for (const w of recommendedSet(c.name, used)) {
              const rec = el('button', { class: 'parse-rec', title: `Add “${w}”` });
              rec.append(el('span', { class: 'parse-rec-plus', text: '+' }), el('span', { text: w }));
              rec.addEventListener('click', () => {
                if (!c.parseWords.includes(w)) c.parseWords.push(w);
                refocusIdx = idx;
                draw();
              });
              chipRow.append(rec);
            }
          }
          const wordIn = el('input', { class: 'parse-add', placeholder: '+ parse word' }) as HTMLInputElement;
          chipRow.append(wordIn);
          const perr = el('div', { class: 'parse-error' });

          nameIn.addEventListener('input', () => (c.name = nameIn.value));
          // recommendations follow the name once it settles
          nameIn.addEventListener('change', () => {
            if (newIds.has(c.id)) draw();
          });
          del.addEventListener('click', () => {
            draft.courses.splice(idx, 1);
            newIds.delete(c.id);
            draw();
          });
          wordIn.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter') return;
            const w = wordIn.value.trim().toLowerCase();
            if (!w) return;
            const conflict = draft.courses.find((x) => x !== c && x.parseWords.includes(w));
            if (conflict) {
              perr.textContent = `Already used in "${conflict.name}".`;
              return;
            }
            if (!c.parseWords.includes(w)) c.parseWords.push(w);
            refocusIdx = idx;
            draw();
          });

          row.append(top, chipRow, perr);
          rows.append(row);
          if (refocusIdx === idx) {
            refocusIdx = -1;
            setTimeout(() => wordIn.focus(), 0);
          }
        });
        firstDraw = false;
      };
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
      const h1 = el('h1', { class: 'rise' });
      h1.append('Your ', el('span', { class: 'g', text: 'languages' }));
      // ONE CAPTION, NOT TWO (Gabe, 8/22). The screen's subtitle and the picker's
      // own lead were saying the same sentence twice, at roughly triple the length
      // of every other screen's caption. The subtitle is now as short as theirs, and
      // the picker's lead is suppressed rather than reworded, because with the
      // subtitle above it there is nothing left for it to add.
      sc.append(
        h1,
        el('p', {
          class: 'onb-sub rise d1',
          text: 'Assignments written in these get an English line underneath. Change it any time in Settings.',
        })
      );

      // The globe, drifting through the scripts the picker can read. Screens 1 to 3
      // all open with something moving; this one and Courses were the two that just
      // sat there (Gabe, 8/22).
      const orbit = el('div', { class: 'onb-visual onb-langs rise d1' });
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

  // ---------------------------------------------------------------- 6 · name
  // Pre-filled from the signed-in email (main.ts hands it over), so the student
  // is confirming a guess rather than answering a blank prompt.
  SCREENS.push({
    build(host) {
      const sc = pane(host);
      const h1 = el('h1', { class: 'rise' });
      h1.append('What should we ', el('span', { class: 'g', text: 'call you' }), '?');
      sc.append(
        h1,
        el('p', { class: 'onb-sub rise d1', text: 'This is the name Cobalt greets you with.' })
      );

      const wrap = el('div', { class: 'rise d2', style: 'width:100%;max-width:420px;margin-top:30px' });
      const input = textInput({
        class: 'onb-name-input',
        value: draft.name,
        placeholder: 'Your first name',
        autocomplete: 'given-name',
        spellcheck: false,
      });
      const err = el('div', { class: 'onb-err' });
      wrap.append(input, err);
      sc.append(wrap);

      const next = cta('Continue');
      const submit = (): void => {
        const v = capitalizeName(input.value);
        if (!v) {
          err.textContent = 'Enter a name so Cobalt knows what to call you.';
          input.focus();
          return;
        }
        draft.name = v;
        go(index + 1);
      };
      next.addEventListener('click', submit);
      input.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') submit();
      });
      input.addEventListener('input', () => (err.textContent = ''));
      sc.append(next);
      setTimeout(() => {
        input.focus();
        input.select();
      }, 380); // after the entrance settles
    },
  });

  // ------------------------------------------------- 7 · commit, sync, payoff
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
          if (draft.ical) {
            const url = draft.ical.replace(/^webcal:\/\//i, 'https://');
            await data.setProfile('schoology', { icalUrl: url, lastSyncAt: null });
          }
        }

        let added = 0;
        let failed = false;
        if (draft.ical) {
          try {
            added = (await runSync(data)).added;
          } catch {
            failed = true;
          }
        }

        // --- the payoff -------------------------------------------------------
        sc.replaceChildren();
        sc.append(el('div', { class: 'onb-check', text: '✓' }));
        const h1 = el('h1', { text: `You’re in, ${draft.name}!` });
        sc.append(h1);

        // Every imported assignment, listed. The count in the headline and the
        // rows below it are the SAME data, so the number can never be a claim
        // the list contradicts.
        // Undated tasks sort last, not first: '' would win a plain string compare.
        const imported = (Object.values(data.getTasks()) as Task[])
          .filter((t) => !t.completed)
          .sort((a, b) => (a.dueDate || '9999').localeCompare(b.dueDate || '9999'));

        let subText: string;
        if (failed) subText = 'Couldn’t reach Schoology. Your link is saved, retry from Settings.';
        else if (added > 0) subText = `${added} assignment${added === 1 ? '' : 's'} imported, sorted into your courses.`;
        else if (draft.ical) subText = 'Connected. New assignments will import automatically.';
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

  go(0);
}
