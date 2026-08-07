// WorkSpace — first-run onboarding deck.
//
// Ported from the onb-A prototype (app/public/onb-A.html). Six full-screen
// slides over the branded gradient field, with a progress rail that only ever
// climbs:
//
//   1. WELCOME   — the app mark, the wordmark, one button.
//   2. IMPORT    — what the product actually does, shown rather than described.
//   3. CONNECT   — the Schoology mark + the iCal link. Pressing Connect plays the
//                  scan animation IN PLACE (it is not a separate slide), then the
//                  button becomes Continue. There is deliberately NO skip: a
//                  student who skips forgets, opens an empty app, and concludes
//                  the product is bad. The connection IS the product.
//   4. COURSES   — the Settings ▸ Courses editor, verbatim (same classes, from
//                  settings.css), because onboarding is where courses are BORN
//                  and Settings is where they're edited later.
//   5. NAME      — pre-filled from the signed-in account's email, so the student
//                  confirms a guess instead of answering a blank prompt.
//   6. PAYOFF    — everything commits here, the first sync runs live, and the
//                  real imported assignments are listed (not a teaser count).
//
// WHERE AUTH SITS: main.ts signs the user in BEFORE calling this (it passes
// `user.email`), so the prototype's sign-in slide has no equivalent here — by the
// time this runs, the account already exists. That is also why the name screen
// can pre-fill: the email is already known.
//
// Contract (unchanged from the previous card version): saves profile/account with
// onboarded: true + markOnboardedLocally(), saves profile/schoology when a link is
// given, runs the first sync, then calls onDone(name).

import type { Data } from '../db';
import { el, textInput } from '../util/dom';
import { capitalizeName, nameFromEmail } from '../util/names';
import { runSync } from '../schoology/sync';
import { getCourses, replaceCourses, getCourseColor } from '../courses/registry';
import { BADGE_ASSESSMENT_RE } from '../schoology/ical';
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

/** Soft link check — catches "I pasted my password" mistakes, never blocks a real
 *  feed URL (Schoology's come as webcal://… or https://…/ical/…). */
function looksLikeIcalLink(v: string): boolean {
  return /^(webcal|https?):\/\/\S+/i.test(v.trim());
}

/** Titles shown flying in during the scan — illustrative of ASSIGNMENTS landing,
 *  never course names, because the calendar feed genuinely carries none. That gap
 *  is exactly what makes the courses screen necessary. */
const SCAN_SAMPLE = [
  'Read Ch. 7 & annotate',
  'Unit 5 Test',
  'Finish lab write-up',
  'Essay draft',
  'Problem set 4',
  'השלם את עמוד 16',
];

/**
 * Up to 3 parse-word suggestions for a course name. Ported from the real
 * Settings implementation (settings/view.ts recommendParseWords) so this screen
 * recommends exactly what Settings would:
 *   "English Language Arts" → ela, english, language
 *   "Computer Science"      → cs, computer, science
 *   "Mathematics"           → math, mat
 * The course NAME is never recommended: the parser matches an exact course name
 * outright, so suggesting it would do nothing.
 */
const STOP_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'for', 'to', 'in', 'on', '&']);
function recommendParseWords(name: string, exclude: Set<string>): string[] {
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w && !STOP_WORDS.has(w));
  if (!words.length) return [];

  const candidates: string[] = [];
  if (words.length >= 2) {
    candidates.push(words.map((w) => w[0]).join('')); // acronym, e.g. "ela"
    for (const w of words) if (w.length >= 3) candidates.push(w);
  } else {
    const w = words[0];
    candidates.push(w);
    if (w.length > 4) candidates.push(w.slice(0, 4));
    if (w.length > 3) candidates.push(w.slice(0, 3));
  }

  const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');
  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of candidates) {
    if (w.length < 2 || w === nameKey || seen.has(w) || exclude.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length === 3) break;
  }
  return out;
}

const NEW_COURSE_COLOR = '#e6a817';

export function runOnboarding({ data, email, fallbackName, onDone }: OnboardingOpts): void {
  // Draft state. NOTHING is written until the payoff screen commits it, so a
  // student who closes the tab mid-flow simply starts over rather than landing
  // in a half-configured account.
  const draft = {
    name: capitalizeName(nameFromEmail(email) || fallbackName || ''),
    ical: '',
    connected: false,
    // A working copy of the real registry — edited freely here, committed once.
    courses: getCourses().map((c) => ({ ...c, parseWords: [...c.parseWords] })) as CourseConfig[],
  };

  // --- shell ------------------------------------------------------------------
  const deck = el('div', { class: 'onb-deck' });
  deck.append(el('div', { class: 'onb-orb a' }), el('div', { class: 'onb-orb b' }));
  const fill = el('div', { class: 'onb-fill' });
  deck.append(el('div', { class: 'onb-rail' }, [fill]));
  const backBtn = el('button', { class: 'onb-back hide', 'aria-label': 'Back', text: '‹ Back' });
  deck.append(backBtn);
  const stageEl = el('div');
  deck.append(stageEl);
  document.body.append(deck);

  // Per-screen bar targets. The LAST entry is 92, not 100, ON PURPOSE: arriving
  // at the setup screen must not complete the bar — the payoff pushes it to 100
  // so finishing and the reward land as one moment.
  const PCT = [15, 32, 50, 68, 84, 92];
  let lastPct = 15;
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
    tile.innerHTML = SGY_LOGO; // static, authored above — no user input reaches this
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
      wordmark.append('W', el('span', { class: 'o', text: 'o' }), 'rkSpace');
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
          text: 'WorkSpace reads your Schoology calendar and turns it into a clean task list. Automatically, forever.',
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

      const visual = el('div', { class: 'onb-visual rise', style: 'margin-bottom:26px' });
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
      const help = el('details', { class: 'onb-help-wrap' });
      const helpBtn = el('summary', { class: 'onb-help', text: 'Where do I find this link?' });
      const steps = el('ol', { class: 'onb-help-steps' });
      for (const s of [
        'Open Schoology and click Calendar in the left sidebar.',
        'Look for the calendar’s settings or export option.',
        'Choose “Enable iCal feed” and copy the link it shows.',
        'Come back here and paste it below.',
      ]) {
        steps.append(el('li', { text: s }));
      }
      help.append(helpBtn, steps);

      const input = textInput({
        class: 'onb-field',
        placeholder: 'webcal://… or https://…/ical.ics',
        value: draft.ical,
      });
      const err = el('div', { class: 'onb-err' });
      fieldWrap.append(help, input, err);

      const btn = cta('Connect');
      sc.append(visual, h1, sub, fieldWrap, btn);

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
        if (!looksLikeIcalLink(v)) {
          err.textContent = 'That doesn’t look like a link. It should start with webcal:// or https://.';
          input.focus();
          input.select();
          return;
        }
        draft.ical = v;
        draft.connected = true;
        const mine = index; // only touch this screen if the student is still on it
        fieldWrap.style.display = 'none';
        btn.disabled = true;
        btn.textContent = 'Connecting…';
        sub.textContent = 'Reading your calendar feed…';
        stage.classList.add('scanning');
        SCAN_SAMPLE.forEach((t, i) =>
          setTimeout(() => {
            if (index !== mine) return;
            chips.append(el('span', { class: 'onb-chip', text: t }));
          }, 350 + i * 230)
        );
        setTimeout(() => {
          if (index !== mine) return;
          stage.classList.remove('scanning');
          stage.classList.add('done');
          sub.textContent = 'Connected. Your assignments are ready to import.';
          btn.disabled = false;
          btn.textContent = 'Continue';
        }, 350 + SCAN_SAMPLE.length * 230 + 250);
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
      const sc = pane(host, 'wide tight');
      const h1 = el('h1', { class: 'rise' });
      h1.append('Your ', el('span', { class: 'g', text: 'courses' }));
      sc.append(
        h1,
        el('p', {
          class: 'onb-sub rise d1',
          text: 'Your calendar feed has no course names, so name them here.',
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
          const color = el('input', {
            type: 'color',
            class: 'course-color',
            value: c.color,
            title: 'Course color',
          }) as HTMLInputElement;
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
            for (const w of recommendParseWords(c.name, used)) {
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

          color.addEventListener('input', () => (c.color = color.value));
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
          color: NEW_COURSE_COLOR,
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

  // ---------------------------------------------------------------- 5 · name
  // Pre-filled from the signed-in email (main.ts hands it over), so the student
  // is confirming a guess rather than answering a blank prompt.
  SCREENS.push({
    build(host) {
      const sc = pane(host);
      const h1 = el('h1', { class: 'rise' });
      h1.append('What should we ', el('span', { class: 'g', text: 'call you' }), '?');
      sc.append(
        h1,
        el('p', { class: 'onb-sub rise d1', text: 'This is the name WorkSpace greets you with.' })
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
          err.textContent = 'Enter a name so WorkSpace knows what to call you.';
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

        const enter = el('button', { class: 'onb-cta', style: 'margin-top:30px', text: 'Enter WorkSpace' });
        enter.addEventListener('click', () => {
          deck.remove();
          onDone(draft.name);
        });
        sc.append(enter);
        enter.focus();

        fill.style.width = '100%';
        lastPct = 100;

        // confetti — completion and reward land as one moment
        const burst = el('div', { class: 'onb-confetti' });
        const colors = ['#e6a817', '#f2bb33', '#4098d7', '#27ae60', '#fff'];
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
