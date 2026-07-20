// WorkSpace — landing / welcome screen (the signed-out front door).
//
// The showcase runs the REAL app views live against a throwaway in-memory sandbox
// (see sandbox.ts): the "how it works" section pairs the pitch with a live
// Dashboard, and "see it in action" lets visitors actually play with the Tasks and
// Bookmarks tabs — click, edit, check off, add — plus a genuinely ticking Focus
// session. Nothing persists; every visitor gets the same pristine sample.

import { el } from '../util/dom';
import { createWordmark } from '../ui/laurel';
import type { Data } from '../db';
import { createSandbox } from './sandbox';
import { buildFocusDemo } from './focusDemo';
import { TasksView } from '../tasks/render';
import { BookmarksView } from '../bookmarks/view';
import { DashboardView } from '../dashboard/view';

export interface LandingOpts {
  /** Fired by "Try now" — wired to Google sign-in by main.ts. */
  onTryNow: () => void;
}

// #region Feature showcase data -------------------------------------------------
interface Feature {
  id: string;
  label: string;
  emoji: string;
  kind: 'tasks' | 'focus' | 'bookmarks';
  urlPath: string;
  title: string;
  blurb: string;
  bullets: string[];
}

const FEATURES: Feature[] = [
  {
    id: 'tasks',
    label: 'Tasks',
    emoji: '✅',
    kind: 'tasks',
    urlPath: 'tasks',
    title: 'Your assignments, finally organized',
    blurb: 'Every Schoology assignment, test, and quiz, auto-imported, translated and grouped by when it’s due. Check off, add, or edit tasks, view descriptions, set priorities, and attach links, with instant navigation to Schoology.',
    bullets: ['Quizzes, tests & exams auto-detected', 'Double-click to edit anything', 'Priorities, attachments, description & Schoology navigation'],
  },
  {
    id: 'bookmarks',
    label: 'Bookmarks',
    emoji: '🔖',
    kind: 'bookmarks',
    urlPath: 'links',
    title: 'Your websites, one click away',
    blurb: 'Keep your most-used sites in tidy, intelligent cards that fetch each site’s icon automatically. Add as many links as you want, color-code them into groups, and pull any of them up with live search. Every card launches its site instantly with a single click.',
    bullets: ['Unlimited links with live search', 'Rich, colorful cards', 'Add, edit & group with ease'],
  },
  {
    id: 'focus',
    label: 'Focus',
    emoji: '🎯',
    kind: 'focus',
    urlPath: 'focus',
    title: 'Your unwavering focus, finally possible',
    blurb: 'A deep-work timer that pulls in what you’re working on and counts down while you go. Complete with a simple ring style, instant add & trim buttons, and music curated specifically for focus so you can get things done without distraction.',
    bullets: ['A live, ticking countdown', 'Check tasks off as you go', 'Built-in focus music'],
  },
];

// word → weight (5 = biggest). Every entry must grammatically complete the frame
// "the capacity to ___ your Schoology assignments" (e.g. "stay on top of", not
// "never miss a deadline"). Drives the packed word-cloud sizing.
const CLOUD: Array<[string, number]> = [
  ['organize', 5], ['manage', 5], ['focus on', 5], ['prioritize', 4], ['import', 4],
  ['check off', 4], ['stay on top of', 4], ['take control of', 4], ['knock out', 4],
  ['master', 4], ['catch every test among', 4], ['breeze through', 3], ['color-code', 3], ['duplicate', 3], ['rename', 3],
  ['edit', 3], ['translate', 3], ['group', 3], ['sort', 3], ['track', 3], ['customize', 3],
  ['attach links to', 3], ['keep tabs on', 2], ['set reminders for', 2],
  ['never lose track of', 2], ['own', 2], ['conquer', 2],
];

// Deterministic palette + font mix for the cloud — chosen to feel like a classic
// multilingual "welcome" cloud: many typefaces, many hues, tightly packed.
const CLOUD_COLORS = ['#2c6e7f', '#d1567f', '#e0913d', '#7a8b3a', '#8a6bbf', '#c0453f', '#3a7d5d', '#b0742a', '#5a6b8c', '#cf5a2a'];
const CLOUD_FONTS = [
  'Georgia, serif',
  "'Times New Roman', Times, serif",
  'Impact, Haettenschweiler, sans-serif',
  "'Courier New', monospace",
  "'Palatino Linotype', 'Book Antiqua', serif",
  "'Trebuchet MS', sans-serif",
  'Verdana, Geneva, sans-serif',
  "'Lucida Sans', sans-serif",
];

// Personalization showcase: the SAME three subjects, set up three different ways,
// so visitors see every student tailors names, colors, and parse words to their own
// classes. Parse-word counts vary per card (some overlap, some unique) but every
// list is kept short enough that its chips fit on ONE line at desktop widths — so
// all nine cards are the same height and the three columns end level.
interface PersonaCourse {
  name: string;
  color: string;
  words: string[];
}
const PERSONAS: Array<{ label: string; courses: PersonaCourse[] }> = [
  {
    label: 'Ava',
    courses: [
      { name: 'Hebrew', color: '#70c0e0', words: ['hebrew', 'ivrit'] },
      { name: 'English Language Arts', color: '#e091a8', words: ['ela', 'english'] },
      { name: 'Social Studies', color: '#e05050', words: ['sost', 'history', 'hist'] },
    ],
  },
  {
    label: 'Ben',
    courses: [
      { name: 'Ivrit', color: '#3a7d5d', words: ['ivrit', 'hebrew', 'shiur'] },
      { name: 'English', color: '#e0913d', words: ['eng', 'ela', 'essay'] },
      { name: 'History', color: '#7a8b3a', words: ['hist', 'sost'] },
    ],
  },
  {
    label: 'Maya',
    courses: [
      { name: 'עברית', color: '#2c6e7f', words: ['עברית', 'hebrew'] },
      { name: 'ELA', color: '#d1567f', words: ['english', 'lit'] },
      { name: 'SoSt', color: '#be4b2e', words: ['history', 'ss'] },
    ],
  },
];
// #endregion

// #region Public entry ----------------------------------------------------------
export function renderLanding(opts: LandingOpts): HTMLElement {
  const root = el('div', { class: 'landing' });

  // A soft gold glow that drifts behind the hero — pure decoration.
  root.append(el('div', { class: 'lp-glow' }));

  // TWO independent sandboxes so the "how it works" Dashboard and the "see it in
  // action" demos never share state — checking off / editing a task in one has zero
  // effect on the other.
  const howSandbox = createSandbox();
  const seeSandbox = createSandbox();

  root.append(
    heroSection(opts),
    howItWorksSection(howSandbox),
    featuresSection(seeSandbox),
    personalizeSection(),
    capabilitiesSection(),
    footerSection()
  );

  setupReveal(root);
  return root;
}
// #endregion

// #region Hero ------------------------------------------------------------------
function heroSection(opts: LandingOpts): HTMLElement {
  const sec = el('section', { class: 'lp-hero' });
  const inner = el('div', { class: 'lp-hero-inner lp-reveal' });

  inner.append(el('div', { class: 'lp-eyebrow', text: 'WELCOME TO' }));
  const mark = el('div', { class: 'lp-hero-mark' });
  mark.append(createWordmark().el);
  inner.append(mark);
  inner.append(
    el('p', { class: 'lp-tagline', text: 'The best Schoology alternative for Heschel students' })
  );

  inner.append(ctaButton('Try now', opts.onTryNow));
  inner.append(el('p', { class: 'lp-cta-sub', text: 'Sign in with email or Google — it’s free.' }));

  sec.append(inner);
  const hint = el('div', { class: 'lp-scroll-hint' });
  hint.append(
    el('span', { class: 'lp-scroll-word', text: 'scroll' }),
    el('span', { class: 'lp-scroll-arrow', text: '↓' })
  );
  sec.append(hint);
  return sec;
}
// #endregion

// #region How it works (blurb + live Dashboard) ---------------------------------
function howItWorksSection(sandbox: Promise<Data>): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-how lp-reveal' });

  const row = el('div', { class: 'lp-split' });
  const frame = deviceFrame('workspace.app/dashboard');
  // This preview is a static showcase — visitors LOOK at the Dashboard here and
  // PLAY in the "see it in action" section below. Render the real view, then turn
  // the whole frame body into an image (no clicks, no hover, no text selection).
  frame.body.classList.add('lp-frame-static');
  const text = el('div', { class: 'lp-split-text' });
  text.append(
    el('div', { class: 'lp-tag', text: 'HOW IT WORKS' }),
    el('h2', { class: 'lp-h2 lp-h2-left', text: 'One clean space, built from your Schoology feed' }),
    el('p', {
      class: 'lp-lead',
      text: 'WorkSpace reads your Schoology calendar and automatically imports every assignment into one organized place. Stop digging through Schoology; start getting things done with clarity.',
   })
  );
  row.append(scaleToFit(frame.frame, 560), text); // frame LEFT, copy RIGHT
  sec.append(row);

  // Mount the real Dashboard once the sandbox is ready. The frame is static
  // (pointer-events: none), so no click handler can ever fire — pass a no-op.
  sandbox
    .then((data) => {
      frame.body.replaceChildren();
      frame.body.classList.remove('loading');
      new DashboardView(
        data,
        'Gabe',
        () => {}, // unreachable: the static frame swallows all interaction
        true // sample mode → fixed greeting/quote, inert schedule + refresh
      ).mount(frame.body);
    })
    .catch(() => {
      frame.body.classList.remove('loading');
      frame.body.replaceChildren(el('div', { class: 'lp-frame-err', text: 'Preview unavailable' }));
    });

  return sec;
}
// #endregion

// #region See it in action (tabbed live previews) -------------------------------
function featuresSection(sandbox: Promise<Data>): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-features lp-reveal' });
  sec.append(
    el('h2', { class: 'lp-h2', text: 'See it in action' }),
    el('p', { class: 'lp-sub', text: 'A real, playable sample — click around, it’s all live.' })
  );

  const tabs = el('div', { class: 'lp-tabs' });
  const row = el('div', { class: 'lp-split lp-split-reverse' });
  const text = el('div', { class: 'lp-split-text' });
  const frame = deviceFrame('workspace.app/tasks');
  row.append(text, scaleToFit(frame.frame, 560)); // copy LEFT, frame RIGHT

  // Each tab's panel is built + mounted once, then just shown/hidden — so state
  // (an edit in progress, a ticking clock) survives switching away and back.
  const panels = new Map<string, HTMLElement>();
  let current = '';

  const ensurePanel = (f: Feature): HTMLElement => {
    let panel = panels.get(f.id);
    if (panel) return panel;
    panel = el('div', { class: 'lp-tabpanel' });
    panel.style.display = 'none';
    frame.body.append(panel);
    panels.set(f.id, panel);
    if (f.kind === 'focus') {
      panel.append(buildFocusDemo());
    } else {
      // Tasks / Bookmarks are the REAL views over the shared sandbox.
      sandbox
        .then((data) => {
          // Popups mount into the frame body (contained in this "phone"), and the
          // preview's external links stay inert.
          if (f.kind === 'tasks') new TasksView(data, { host: frame.body }).mount(panel!);
          else void new BookmarksView(data, { host: frame.body }).mount(panel!);
          if (current === f.id) revealPanel(); // if still selected, drop the loader
        })
        .catch(() => panel!.append(el('div', { class: 'lp-frame-err', text: 'Preview unavailable' })));
    }
    return panel;
  };

  const revealPanel = () => frame.body.classList.remove('loading');

  const select = (f: Feature, btn: HTMLElement) => {
    current = f.id;
    [...tabs.children].forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    frame.url.textContent = `workspace.app/${f.urlPath}`;
    text.replaceChildren(
      el('h3', { class: 'lp-split-title', text: f.title }),
      el('p', { class: 'lp-lead', text: f.blurb }),
      bulletList(f.bullets)
    );
    const panel = ensurePanel(f);
    panels.forEach((p, id) => (p.style.display = id === f.id ? '' : 'none'));
    // Focus mounts synchronously; the real views may still be loading behind the loader.
    if (f.kind === 'focus' || panel.childElementCount > 0) revealPanel();
    else frame.body.classList.add('loading');
  };

  FEATURES.forEach((f, i) => {
    const btn = el('button', { class: 'lp-tab' });
    btn.append(el('span', { class: 'lp-tab-emoji', text: f.emoji }), el('span', { text: f.label }));
    btn.addEventListener('click', () => select(f, btn));
    tabs.append(btn);
    if (i === 0) queueMicrotask(() => select(f, btn));
  });

  sec.append(tabs, row);
  return sec;
}

function bulletList(items: string[]): HTMLElement {
  const ul = el('ul', { class: 'lp-bullets' });
  for (const it of items) {
    const li = el('li');
    li.append(el('span', { class: 'lp-check', text: '✓' }), el('span', { text: it }));
    ul.append(li);
  }
  return ul;
}
// #endregion

// #region Device frame ----------------------------------------------------------
/** A faux browser window (traffic-light dots + URL bar) wrapping a live preview.
 *  Fixed outer size across every tab, so switching previews never resizes the box. */
/** Professional-landing compression: the element keeps its EXACT design layout
 *  at every width. When its column gets narrower than the design width, the
 *  whole element shrinks proportionally (transform: scale) — like a photo —
 *  instead of rewrapping or squeezing its contents. A media query can set
 *  --fit-off: 1 on the target to suspend scaling where a stacked layout
 *  takes over (e.g. the persona row going single-column). */
function scaleToFit(target: HTMLElement, designWidth: number): HTMLElement {
  const wrap = el('div', { class: 'lp-fit' });
  wrap.append(target);
  const apply = () => {
    if (getComputedStyle(target).getPropertyValue('--fit-off').trim() === '1') {
      target.style.transform = '';
      wrap.style.height = '';
      return;
    }
    const w = wrap.clientWidth;
    if (!w) return; // hidden/unmounted — the observer refires when it shows
    const s = Math.min(1, w / designWidth);
    target.style.transform = s < 1 ? `scale(${s})` : '';
    // transform doesn't take layout space — reserve exactly the scaled height.
    wrap.style.height = s < 1 ? `${target.offsetHeight * s}px` : '';
  };
  const ro = new ResizeObserver(apply);
  ro.observe(wrap);
  ro.observe(target); // content height changes too (loading → mounted view)
  return wrap;
}

function deviceFrame(url: string): { frame: HTMLElement; body: HTMLElement; url: HTMLElement } {
  const frame = el('div', { class: 'lp-frame' });
  const bar = el('div', { class: 'lp-frame-bar' });
  bar.append(
    el('span', { class: 'lp-dot r' }),
    el('span', { class: 'lp-dot y' }),
    el('span', { class: 'lp-dot g' })
  );
  const urlEl = el('div', { class: 'lp-frame-url', text: url });
  bar.append(urlEl);
  const body = el('div', { class: 'lp-frame-body loading' });
  body.append(el('div', { class: 'lp-frame-loading', text: 'Loading preview…' }));
  frame.append(bar, body);
  return { frame, body, url: urlEl };
}
// #endregion

// #region Capabilities word cloud ----------------------------------------------
function capabilitiesSection(): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-caps lp-reveal' });
  // The section reads as one sentence: "The capacity to [cloud] your Schoology
  // assignments" — every cloud word slots into the blank grammatically.
  sec.append(el('h2', { class: 'lp-h2', text: 'The capacity to' }));

  const cloud = el('div', { class: 'lp-cloud' });
  // Scatter deterministically (no Math.random) for a natural, non-alphabetical mix.
  const order = [...CLOUD].sort((a, b) => ((a[0].length * 7) % 5) - ((b[0].length * 7) % 5));
  order.forEach(([word, weight], i) => {
    const span = el('span', { class: `lp-cloud-word w${weight}`, text: word });
    span.style.color = CLOUD_COLORS[(i * 3) % CLOUD_COLORS.length];
    span.style.fontFamily = CLOUD_FONTS[(i * 5) % CLOUD_FONTS.length];
    cloud.append(span);
  });
  sec.append(cloud);

  const caption = el('p', { class: 'lp-caps-caption' });
  caption.append(
    document.createTextNode('your Schoology assignments '),
    el('strong', { class: 'lp-caps-emph', text: 'is at your fingertips.' })
  );
  sec.append(caption);
  return sec;
}
// #endregion

// #region Personalization showcase ---------------------------------------------
// A wide, side-by-side look at THREE settings tabs — Profile, Courses, Alerts —
// so a visitor sees at a glance how much of WorkSpace bends to them: their name +
// greeting + clock, their own course names/colors/parse-words, and exactly which
// notifications reach them. Static replicas (display-only), built from the same
// UI classes the real settings screens use so they look authentic.
function personalizeSection(): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-personalize lp-reveal' });
  sec.append(
    el('h2', { class: 'lp-h2', text: 'Endless personalization' }),
    el('p', {
      class: 'lp-sub',
      text: 'Make WorkSpace your own — set your name, greeting and clock, rename and recolor every course with your own parse words, and choose exactly which alerts reach you.',
    })
  );
  // ONE settings window whose three columns read as a single screen — no separate
  // card chrome, just hairline dividers. Each column is built from the SAME UI
  // classes the real settings screens use (.srow, .nswitch, .nseg, the course
  // cards, .ncard) so it mirrors the app exactly. Display-only (pointer-events off
  // on the whole panel), so nothing here saves or prompts. No scale-to-fit wrapper:
  // the panel is naturally responsive (columns stack on narrow screens), which also
  // removes the height-mis-reservation that let the word cloud ride up over it.
  const win = el('div', { class: 'lp-settings' });
  const cols = el('div', { class: 'lp-settings-cols' });
  cols.append(
    settingsCol('Profile', profileCol()),
    settingsCol('Courses', coursesCol()),
    settingsCol('Alerts', alertsCol())
  );
  win.append(cols);
  sec.append(win);
  return sec;
}

/** One labelled column inside the single settings window. */
function settingsCol(label: string, items: HTMLElement[]): HTMLElement {
  const col = el('div', { class: 'lp-settings-col' });
  col.append(el('div', { class: 'lp-settings-col-head', text: label }), ...items);
  return col;
}

/** A non-interactive on/off switch identical to the settings `.nswitch`. */
function fauxSwitch(on: boolean): HTMLElement {
  const sw = el('span', { class: 'nswitch' });
  sw.setAttribute('role', 'switch');
  sw.setAttribute('aria-checked', String(on));
  return sw;
}

/** The real settings preference row: title + sub on the left, a control on the right. */
function srow(title: string, sub: string, ctrl: HTMLElement): HTMLElement {
  const row = el('div', { class: 'srow' });
  const main = el('div', { class: 'srow-main' });
  main.append(el('div', { class: 'srow-title', text: title }), el('div', { class: 'srow-sub', text: sub }));
  const c = el('div', { class: 'srow-ctrl' });
  c.append(ctrl);
  row.append(main, c);
  return row;
}

/** The real 12-hour/24-hour segmented control (first option active). */
function twoWaySeg(a: string, b: string): HTMLElement {
  const s = el('div', { class: 'nseg', style: 'grid-template-columns: repeat(2, 1fr)' });
  s.append(el('span', { class: 'nseg-btn active', text: a }), el('span', { class: 'nseg-btn', text: b }));
  return s;
}

/** Profile column — display name + the real preference rows. */
function profileCol(): HTMLElement[] {
  return [
    el('div', { class: 'lp-set-label', text: 'Display name' }),
    el('div', { class: 'settings-input lp-set-input', text: 'Gabe' }),
    srow('Time format', 'How times show across WorkSpace.', twoWaySeg('12-hour', '24-hour')),
    srow('Personalized greeting', 'Use your name in the greeting.', fauxSwitch(true)),
    srow('Daily quote', 'A rotating quote each day.', fauxSwitch(true)),
  ];
}

/** Courses column — the real course-editor cards (name / color / parse chips). */
function coursesCol(): HTMLElement[] {
  return PERSONAS[0].courses.map(courseCard);
}

/** Alerts column — the real notification cards (icon + title/desc + switch). */
function alertsCol(): HTMLElement[] {
  const rows: [string, string, string, boolean][] = [
    ['⏰', 'Due-soon reminders', 'A heads-up before it’s due.', true],
    ['☀️', 'Daily agenda', 'Your morning rundown of today.', true],
    ['🌙', 'Tomorrow preview', 'An evening look at what’s ahead.', false],
  ];
  return rows.map(([icon, title, desc, on]) => {
    const card = el('div', { class: 'ncard' });
    const bar = el('div', { class: 'ncard-bar' });
    const main = el('div', { class: 'ncard-main' });
    main.append(el('div', { class: 'ncard-title', text: title }), el('div', { class: 'ncard-desc', text: desc }));
    bar.append(el('div', { class: 'ncard-ico', text: icon }), main, fauxSwitch(on));
    card.append(bar);
    return card;
  });
}

/** A static replica of the Settings course editor row (see settings/view.ts
 *  courseRow): color swatch + boxed name + ✕, parse-word chips with ×, and the
 *  dashed "+ parse word" field. Purely decorative — nothing here is interactive. */
function courseCard(c: PersonaCourse): HTMLElement {
  const card = el('div', { class: 'lp-course-card' });
  card.style.setProperty('--course', c.color);

  const head = el('div', { class: 'lp-course-head' });
  head.append(
    el('span', { class: 'lp-course-swatch' }),
    el('span', { class: 'lp-course-name', text: c.name }),
    el('span', { class: 'lp-course-x', text: '✕' })
  );
  card.append(head);

  const tags = el('div', { class: 'lp-course-tags' });
  for (const w of c.words) {
    const tag = el('span', { class: 'lp-course-tag', text: w });
    tag.append(el('span', { class: 'lp-course-tag-x', text: '×' }));
    tags.append(tag);
  }
  card.append(tags);

  card.append(el('div', { class: 'lp-course-add', text: '+ parse word' }));
  return card;
}
// #endregion

// #region Shared bits -----------------------------------------------------------
function ctaButton(label: string, onClick: () => void): HTMLElement {
  const btn = el('button', { class: 'lp-cta', text: label });
  btn.addEventListener('click', onClick);
  return btn;
}

function footerSection(): HTMLElement {
  const f = el('footer', { class: 'lp-footer' });
  f.append(el('span', { text: 'WorkSpace · built for Heschel students' }));
  return f;
}

/**
 * Scroll-reveal as progressive enhancement. The hidden start-state is gated behind
 * `.reveal-on` (added only after the observer is wired), so if JS is off, the
 * observer is unsupported, or it never fires, every section stays visible. A canary
 * timeout is the final backstop: the hero is on-screen at load, so if it hasn't
 * revealed shortly after, we assume the observer is dead and reveal everything.
 */
function setupReveal(root: HTMLElement): void {
  const reduceMotion = window.matchMedia?.('(prefers-reduced-motion: reduce)').matches;
  if (!('IntersectionObserver' in window) || reduceMotion) return;

  requestAnimationFrame(() => {
    root.classList.add('reveal-on');
    const targets = [...root.querySelectorAll('.lp-reveal')];
    const io = new IntersectionObserver(
      (entries) => {
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      { threshold: 0.12 }
    );
    targets.forEach((node) => io.observe(node));

    const hero = root.querySelector('.lp-hero-inner');
    window.setTimeout(() => {
      if (hero && !hero.classList.contains('in')) targets.forEach((n) => n.classList.add('in'));
    }, 1500);
  });
}
// #endregion
