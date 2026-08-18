// Cobalt: landing / welcome screen (the signed-out front door).
//
// A fixed nav bar (always solid, so the brand is always on screen) links to
// every section below. The showcase runs the REAL app views live against a
// throwaway in-memory sandbox (see sandbox.ts): the "how it works" section
// pairs the pitch with a live Dashboard, and "see it in action" lets visitors
// actually play with the Tasks and Bookmarks tabs — click, edit, check off,
// add — plus a genuinely ticking Focus session. Nothing persists; every
// visitor gets the same pristine sample. The personalization section is a
// static (non-interactive) juxtaposition of three students' task lists built
// from the SAME real app CSS classes, and "Cobalt vs Schoology" makes the
// pitch explicit.

import { el } from '../util/dom';
import { createWordmark } from '../ui/laurel';
import type { Data } from '../db';
import { createSandbox } from './sandbox';
import { buildFocusDemo } from './focusDemo';
import { TasksView } from '../tasks/render';
import { BookmarksView } from '../bookmarks/view';
import { priorityDef } from '../tasks/priorities';
import type { Priority } from '../types';

export interface LandingOpts {
  /** Fired by "Try now" — wired to Google sign-in by main.ts. */
  onTryNow: () => void;
  /** "Log in" — same auth screen, different intent.
   *  Optional: falls back to onTryNow when the caller doesn't distinguish them. */
  onLogIn?: () => void;
}

// #region Nav + shared scroll helpers ---------------------------------------------
// ONE list of {id, label} drives the nav bar AND the footer, so they can never
// drift out of sync with each other or with the sections they point at.
const NAV_LINKS: Array<{ id: string; label: string }> = [
  // 'video' = the LIVE hero demo (the glow frame carries the id); 'demo' stays
  // the mp4 film section, still hidden until the file exists. More tabs to
  // come (Gabe, 8/17).
  { id: 'video', label: 'Video demo' },
  { id: 'play', label: 'Try it' },
  { id: 'yours', label: 'Make it yours' },
  { id: 'compare', label: 'Why Cobalt' },
  { id: 'caps', label: 'Capabilities' },
  { id: 'demo', label: 'Full demo film' },
];

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function scrollToSection(root: HTMLElement, id: string): void {
  root.querySelector(`#${id}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

/** The fixed nav: wordmark (→ top) · section links (center) · Log in + Get
 *  started (right). Buttons, not `<a href="#…">`, so clicking never touches the
 *  URL hash. Always solid (Gabe, 8/13): the bar keeps its contrast even over
 *  the hero, no transparent-then-solid scroll trick. */
function navBar(opts: LandingOpts, root: HTMLElement): HTMLElement {
  const nav = el('nav', { class: 'lp-nav' });

  const brand = el('button', { class: 'lp-nav-brand', 'aria-label': 'Cobalt, back to top' });
  brand.append(createWordmark().el);
  brand.addEventListener('click', () => window.scrollTo({ top: 0, behavior: reducedMotion() ? 'auto' : 'smooth' }));

  const links = el('div', { class: 'lp-nav-links' });
  for (const l of NAV_LINKS) {
    const b = el('button', { class: 'lp-nav-link', text: l.label }) as HTMLButtonElement;
    b.dataset.target = l.id;
    // The Demo link stays hidden until the film actually exists (see demoSection:
    // a public page must never navigate to a "coming soon" slot — council verdict
    // 8/13, unanimous across three reviewers).
    if (l.id === 'demo') b.hidden = true;
    b.addEventListener('click', () => scrollToSection(root, l.id));
    links.append(b);
  }

  const actions = el('div', { class: 'lp-nav-actions' });
  const login = el('button', { class: 'lp-nav-login', text: 'Log in' });
  login.addEventListener('click', opts.onLogIn ?? opts.onTryNow);
  const cta = el('button', { class: 'lp-nav-cta', text: 'Get started free' });
  cta.addEventListener('click', opts.onTryNow);
  actions.append(login, cta);

  nav.append(brand, links, actions);
  return nav;
}

/** Active-link tracking: whichever id'd section currently owns the vertical
 *  middle band of the viewport gets `.active`. The observer dies naturally with
 *  the DOM (no window-level listeners), same as setupReveal below. */
function setupNav(nav: HTMLElement, root: HTMLElement): void {
  if (!('IntersectionObserver' in window)) return;
  const links = [...nav.querySelectorAll<HTMLElement>('.lp-nav-link')];
  const sections = NAV_LINKS.map((l) => root.querySelector(`#${l.id}`)).filter((s): s is Element => !!s);
  if (!sections.length) return;
  // Track every section's intersection state so we can tell "scrolled above all
  // tracked sections" (hero text) apart from "moved to another section" — in the
  // former case no tab should stay lit.
  const inBand = new Set<string>();
  const activeIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        if (e.isIntersecting) inBand.add(e.target.id);
        else inBand.delete(e.target.id);
        if (e.isIntersecting) links.forEach((b) => b.classList.toggle('active', b.dataset.target === e.target.id));
      }
      if (!inBand.size) links.forEach((b) => b.classList.remove('active'));
    },
    { rootMargin: '-40% 0px -55% 0px', threshold: 0 }
  );
  sections.forEach((s) => activeIO.observe(s));
}
// #endregion

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
    id: 'focus',
    label: 'Focus',
    emoji: '🎯',
    kind: 'focus',
    urlPath: 'focus',
    title: 'Your unwavering focus, finally possible',
    blurb: 'A deep-work timer that pulls in what you’re working on and counts down while you go. Complete with a simple ring style, instant add & trim buttons, and music curated specifically for focus so you can get things done without distraction.',
    bullets: ['A live, ticking countdown', 'Check tasks off as you go', 'Built-in focus music'],
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
];

// word → weight (5 = biggest). Every entry must grammatically complete the frame
// "the capacity to ___ your Schoology assignments" (e.g. "stay on top of", not
// "never miss a deadline"). Drives the packed word-cloud sizing.
// Almost every entry names a real, checkable Cobalt feature (auto-import,
// auto-translate, quick-add parsing, bulk check-off, folders, calendar views,
// focus sessions, reminders); only a couple of vague crowd-pleasers remain for
// flavor ("knock out", "stay on top of", "conquer").
const CLOUD: Array<[string, number]> = [
  ['organize', 5], ['manage', 5], ['focus on', 5], ['auto-import', 5],
  ['prioritize', 4], ['check off', 4], ['auto-translate', 4], ['bulk-complete', 4],
  ['catch every test among', 4], ['stay on top of', 3], ['color-code', 3], ['duplicate', 3],
  ['edit', 3], ['group', 3], ['sort', 3], ['customize', 3], ['knock out', 3],
  ['attach links to', 3], ['file into project folders', 3], ['see a month view of', 3],
  ['pull into focus sessions', 3], ['turn one typed line into', 3], ['rename', 3], ['track', 3],
  ['set reminders for', 2], ['reorder by hand', 2], ['range-select', 2], ['pin', 2],
  ['conquer', 2],
];

// Deterministic palette + font mix for the cloud — chosen to feel like a classic
// multilingual "welcome" cloud: many typefaces, many hues, tightly packed.
// Hues lightened 8/13: the old set was picked for a white page and four of them
// sat near 3:1 on this navy, below the 4.5:1 floor for text this small.
const CLOUD_COLORS = ['#4a9ab0', '#d1567f', '#e0913d', '#95a84e', '#8a6bbf', '#e0685f', '#5aa87f', '#c98f45', '#8b9cc0', '#cf5a2a'];
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
// #endregion

// #region Personalization showcase data -------------------------------------------
// Three students' task lists over the exact SAME four assignments. Titles,
// courses, due dates and times, day-group headers and the QUIZ badge are
// identical on every card. What differs is only what a student actually shapes:
// course colors, priorities, folders, attachments, whether translation is on,
// and WHICH OPTIONAL CONTROLS SIT ON THE ROW — a hierarchy from untouched
// defaults to fully organized.
//
// That last one changed on 8/13, when the real row stopped showing all seven
// controls to everyone: ↗, ⓘ and priority are permanent, a control auto-appears
// once the task has content behind it, anything else waits behind "⋯" until it
// is pinned. So card 1 is simply what the rules give you, card 2 has a single
// pin, card 3 has pinned the lot. (Still no preset names and no fabricated
// minimal/power modes, and still no checked rows, since a checked task glides
// away in the real app.)
interface ShowTask {
  id: string;
  title: string;
  /** SHORT names on purpose (Gabe, 8/13): three narrow columns leave the bottom
   *  row no room, and students rename courses to shorthand anyway. */
  course: 'Eng' | 'Ivrit' | 'Math' | 'Sci';
  /** Real meta format (formatMetaDate + fmtTime): "Thu 8/14 10:15am". Identical everywhere. */
  due: string;
  translated?: string;
  quiz?: boolean;
}

const SHOW_TASKS: Record<string, ShowTask> = {
  dikduk: { id: 'dikduk', title: 'דקדוק worksheet', course: 'Ivrit', due: 'Thu 8/14 8:00am', translated: 'Grammar worksheet' },
  vocab: { id: 'vocab', title: 'Vocabulary quiz: unit 7', course: 'Eng', due: 'Thu 8/14 10:15am', quiz: true },
  lab: { id: 'lab', title: 'Lab report: photosynthesis', course: 'Sci', due: 'Fri 8/15 3:00pm' },
  pset: { id: 'pset', title: 'Problem set 12', course: 'Math', due: 'Fri 8/15 11:59pm' },
};

/** The card's content layout, mirroring the Tasks tab's real structure:
 *  optional "Folders" label + open folders (each grouping its own tasks under
 *  date headers, exactly like the app), then the loose list under date headers. */
type CardBlock =
  | { kind: 'label' }
  | { kind: 'header'; text: string; tone?: 'orange' }
  | { kind: 'row'; task: string }
  | { kind: 'folder'; name: string; color: string; blocks: CardBlock[] };

interface StudentSetup {
  courseColors: Record<ShowTask['course'], string>;
  priorities: Record<string, Priority>;
  /** taskId → attachment count (shows as the 📎 superscript). */
  attachments: Record<string, number>;
  /** taskId → folder color (tints the row's folder button, like the real app). */
  folderColorOf: Record<string, string>;
  /** Rows drawn mid-multi-select (.task-item.selected, the real Tasks-tab class).
   *  Purely a visible selection: no bulk-action bar, nothing is being changed. */
  selectedIds?: string[];
  /** Card 1 only: the Hebrew row shows NO translation and its 🌐 sits inactive,
   *  so the three cards read as a progression into the feature. */
  hideTranslation?: boolean;
  /** Optional controls this student has PINNED onto every row, mirroring the real
   *  `tasks.pinnedActions` pref. Empty/absent means the row shows only what the
   *  auto-promote rules give it. ('translate' is never listed: it can only appear
   *  where a translation exists, so pinning it would be a no-op.) */
  pinned?: ('attach' | 'folder' | 'duplicate')[];
  blocks: CardBlock[];
}

const H_TOMORROW: CardBlock = { kind: 'header', text: 'Tomorrow · Thursday, Aug 14', tone: 'orange' };
const H_FRIDAY: CardBlock = { kind: 'header', text: 'Friday, Aug 15' };

// Row order is identical on every card AND sort-correct for each card's
// priorities (dikduk ≥ vocab, lab ≥ pset within their days; ties break by time).
const STUDENT_SETUPS: StudentSetup[] = [
  // 1 · Untouched: a fresh account. Default course colors (unconfigured courses
  // sit at the catalog gray), every priority at normal, no folders, nothing
  // attached yet. This is literally what day one looks like.
  {
    courseColors: { Eng: '#9ca3af', Ivrit: '#70c0e0', Math: '#9ca3af', Sci: '#9b7ec8' },
    priorities: {},
    attachments: {},
    folderColorOf: {},
    hideTranslation: true,
    blocks: [H_TOMORROW, { kind: 'row', task: 'dikduk' }, { kind: 'row', task: 'vocab' }, H_FRIDAY, { kind: 'row', task: 'lab' }, { kind: 'row', task: 'pset' }],
  },
  // 2 · Settling in: courses recolored, some priority spread, one folder, a
  // first attachment.
  {
    courseColors: { Eng: '#e091a8', Ivrit: '#70c0e0', Math: '#e0913d', Sci: '#9b7ec8' },
    priorities: { dikduk: 'high', pset: 'low' },
    attachments: { lab: 1 },
    folderColorOf: { dikduk: '#60a5fa', vocab: '#60a5fa' },
    // ONE pin, and 📎 is the legible one to choose: it puts the paperclip on EVERY
    // row, including the three with nothing attached, which is exactly what pinning
    // means and cannot be mistaken for the auto-promote rule doing it.
    pinned: ['attach'],
    blocks: [
      { kind: 'label' },
      { kind: 'folder', name: 'Complete today', color: '#60a5fa', blocks: [H_TOMORROW, { kind: 'row', task: 'dikduk' }, { kind: 'row', task: 'vocab' }] },
      H_FRIDAY,
      { kind: 'row', task: 'lab' },
      { kind: 'row', task: 'pset' },
    ],
  },
  // 3 · Fully organized: every course recolored, the full priority range,
  // everything filed into folders, links attached where they help.
  {
    courseColors: { Eng: '#e05050', Ivrit: '#3a7d5d', Math: '#8a6bbf', Sci: '#d1567f' },
    priorities: { dikduk: 'highest', vocab: 'high', lab: 'low', pset: 'lowest' },
    attachments: { vocab: 2, lab: 1, pset: 1 },
    folderColorOf: { vocab: '#e05050', dikduk: '#3a7d5d', lab: '#3a7d5d', pset: '#3a7d5d' },
    // The two bottom rows caught mid-multi-select (Gabe, 8/13) — the busiest card
    // gets one more real thing happening in it.
    selectedIds: ['lab', 'pset'],
    // Everything pinned: the student who wants every tool on every row at all times.
    // This is the far end of the progression, and the only card where a row can be
    // as dense as the app used to be for everyone.
    pinned: ['attach', 'folder', 'duplicate'],
    blocks: [
      { kind: 'label' },
      { kind: 'folder', name: 'Quizzes', color: '#e05050', blocks: [H_TOMORROW, { kind: 'row', task: 'vocab' }] },
      {
        kind: 'folder',
        name: 'Homework',
        color: '#3a7d5d',
        blocks: [H_TOMORROW, { kind: 'row', task: 'dikduk' }, H_FRIDAY, { kind: 'row', task: 'lab' }, { kind: 'row', task: 'pset' }],
      },
    ],
  },
];

// Local copies of the real task-row glyphs (tasks/render.ts) — the landing never
// imports render.ts for icons (that would drag the whole Tasks module in).
const LP_SCHOOLOGY_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>';
const LP_FOLDER_BTN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';
const LP_FOLDER_SVG = (color: string) =>
  `<svg class="task-folder-ico" viewBox="0 0 24 24" fill="${color}"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
// #endregion

// #region Cobalt vs Schoology data -----------------------------------------------
// Two self-contained columns (no criteria column, per Gabe 8/13): each cell is a
// full statement, ✗ on the Schoology side, ✓ on the Cobalt side. Claims stay
// checkable against the app — nothing here is aspirational.
const VS_ROWS: Array<{ sch: string; cob: string }> = [
  { sch: 'Assignments scattered across course pages', cob: 'Every assignment in one list, grouped by day' },
  { sch: 'Nothing to check off', cob: 'One-click check-off with a satisfying glide' },
  { sch: 'Deadlines are easy to miss', cob: 'Popup and email reminders, on your schedule' },
  { sch: 'Foreign titles remain cryptic', cob: '200+ languages translated automatically' },
  { sch: 'No priorities on your work', cob: 'Five priority levels, color-coded on every task' },
  { sch: 'Your study links live somewhere else', cob: 'Attach links to any task and open them in one click' },
  { sch: 'Slow pages, dated design', cob: 'Instant, dark, and clean' },
];
// #endregion

// #region Public entry ----------------------------------------------------------
export function renderLanding(opts: LandingOpts): HTMLElement {
  const root = el('div', { class: 'landing' });

  const nav = navBar(opts, root);
  root.append(nav);

  // A soft blue glow that drifts behind the hero — pure decoration.
  root.append(el('div', { class: 'lp-glow' }));

  const seeSandbox = createSandbox();

  root.append(
    heroSection(opts),
    demoSection(root),
    featuresSection(seeSandbox),
    setupsSection(),
    compareSection(),
    capabilitiesSection(),
    footerSection(opts, (id) => scrollToSection(root, id))
  );

  setupReveal(root);
  setupNav(nav, root);
  return root;
}
// #endregion

// #region Hero ------------------------------------------------------------------
// No "WELCOME TO Cobalt" (Gabe, 8/13): real landing pages lead with what the
// product does, not its name — the nav above already carries the wordmark. The
// headline IS the motto.
function heroSection(opts: LandingOpts): HTMLElement {
  const sec = el('section', { class: 'lp-hero' });
  // The Raycast shape (Gabe, 8/17): the motto alone owns the first screen,
  // centered; a long quiet gap; one two-tone bridge line; then the live demo
  // inside its glow frame. No side-by-side, no scroll hint.
  const top = el('div', { class: 'lp-hero-top lp-reveal' });
  const inner = el('div', { class: 'lp-hero-inner' });

  inner.append(
    // "Schoology" carries the accent (Gabe, 8/13), so the one word the visitor is
    // scanning for is the one that reads first. Built from children rather than a
    // text attr because `el`'s `text` sets textContent and would erase the span.
    el('h1', { class: 'lp-hero-title' }, [
      'Your ',
      el('span', { class: 'lp-hero-accent', text: 'Schoology' }),
      ', revolutionized',
    ]),
    el('p', {
      class: 'lp-tagline',
      text: 'Cobalt pulls every assignment out of Schoology into one organized list, while adding helpful functions to streamline homework completion.',
    })
  );

  // Log in + Get started, matching the nav's pairing (Gabe, 8/13).
  const actions = el('div', { class: 'lp-hero-actions' });
  const login = el('button', { class: 'lp-cta-ghost', text: 'Log in' });
  login.addEventListener('click', opts.onLogIn ?? opts.onTryNow);
  actions.append(login, ctaButton('Get started free', opts.onTryNow));
  inner.append(actions);

  // The byline (Gabe, 8/13): the cheapest real trust signal on the page. A tool
  // by one of their own beats any feature claim for this audience.
  inner.append(el('p', { class: 'lp-cta-sub', text: 'Built by a Heschel student, for Heschel students.' }));

  // Three quick-glance chips, one per tab: Tasks, Focus, Bookmarks. Each chip wears
  // its tab's OWN emoji from FEATURES above (✅ / 🎯 / 🔖), so the hero and the
  // "see it in action" tabs read as the same three things. (Tasks used a ⚡ here
  // until 8/13, the one chip that didn't match its tab.)
  const chips = el('div', { class: 'lp-hero-chips' });
  chips.append(
    el('span', { class: 'lp-hero-chip', text: '✅ Auto-import from Schoology' }),
    el('span', { class: 'lp-hero-chip', text: '🎯 Curated focus timer with music' }),
    el('span', { class: 'lp-hero-chip', text: '🔖 Optimized website navigation' })
  );
  inner.append(chips);

  top.append(inner);

  // The hero stage: Dan's live demo (landing/demo/script.ts) — the real app,
  // driven by the ghost cursor, looping — inside the glow frame. The stage
  // reserves its aspect via CSS so nothing reflows when the demo pops in.
  const glow = el('div', { class: 'lp-stage-glow lp-reveal', id: 'video' });
  const stage = el('div', { class: 'lp-hero-stage' });
  glow.append(stage);
  void import('./demo/script')
    .then(({ startHeroDemo, SCENE_NAMES }) => {
      startHeroDemo(stage);
      // Build the chapter bar from the real scene list, YouTube-style. Clicks
      // are handled by the BAR (they seek to the clicked time); segments just
      // carry the fills and the hover tooltips.
      for (const [i, name] of SCENE_NAMES.entries()) {
        const seg = el('div', { class: 'lp-demo-seg', title: `${i + 1} · ${name}` });
        const fill = el('div', { class: 'lp-demo-seg-fill' });
        seg.append(fill);
        segFills.push(fill);
        bar.append(seg);
      }
    })
    .catch(() => {
      /* demo unavailable — the hero text stands alone, nothing breaks */
    });

  // TEMPORARY audit controls (Gabe, 8/17): a YouTube-style player under the
  // demo. A chaptered duration bar (one segment per scene, click = jump
  // there), a playhead + clock in VIDEO-TIME (normalized to ×1 — changing the
  // speed changes how fast the playhead moves, never where a moment lives),
  // pause, and speed. Deliberately bare — removed once the audit pass is done.
  const ctl = el('div', { class: 'lp-demo-ctl' });
  const bar = el('div', { class: 'lp-demo-bar' });
  const knob = el('div', { class: 'lp-demo-knob' });
  const segFills: HTMLElement[] = [];
  const jumpTo = (i: number): void => {
    const w = window as unknown as { __demoRestartFrom?: number; __demoAbort?: () => void; __demoPause?: boolean };
    w.__demoRestartFrom = i;
    w.__demoPause = false;
    pauseBtn.textContent = 'Pause';
    w.__demoAbort?.();
  };
  const row = el('div', { class: 'lp-demo-ctl-row' });
  const pauseBtn = el('button', { class: 'lp-demo-ctl-btn', text: 'Pause' });
  pauseBtn.addEventListener('click', () => {
    const w = window as unknown as { __demoPause?: boolean };
    w.__demoPause = !w.__demoPause;
    pauseBtn.textContent = w.__demoPause ? 'Resume' : 'Pause';
  });
  const speed = el('input', {
    type: 'range',
    min: '0.4',
    max: '2.5',
    step: '0.1',
    value: '1',
  }) as HTMLInputElement;
  const speedLbl = el('span', { class: 'lp-demo-ctl-lbl', text: 'speed ×1.0' });
  speed.addEventListener('input', () => {
    const ui = Number(speed.value);
    // UI reads "×2 = twice as fast"; the cursor multiplies DURATIONS, so invert.
    (window as unknown as { __demoSpeed?: number }).__demoSpeed = 1 / ui;
    speedLbl.textContent = `speed ×${ui.toFixed(1)}`;
  });
  const clock = el('span', { class: 'lp-demo-ctl-lbl lp-demo-clock', text: '0:00 / –:––' });

  // Video-time bookkeeping: per-scene durations start as estimates and are
  // MEASURED as scenes complete, so the bar and total sharpen every loop.
  const fmt = (s: number): string => `${Math.floor(s / 60)}:${String(Math.floor(s % 60)).padStart(2, '0')}`;
  const durations: number[] = []; // learned, video-seconds at ×1
  const EST = 12; // until a scene has been measured once
  const durOf = (i: number): number => durations[i] ?? EST;
  const segCount = (): number => segFills.length || 10;
  const totalOf = (): number => {
    let t = 0;
    for (let i = 0; i < segCount(); i++) t += durOf(i);
    return t;
  };
  let curIdx = -1;
  let inScene = 0; // video-seconds inside the current scene
  let playedNow = 0; // the playhead, refreshed every tick (seeks read it)
  let lastLoop = -1;
  let dragFrac: number | null = null; // knob mid-drag: preview, don't fight it
  let lastTick = performance.now();
  window.setInterval(() => {
    const w = window as unknown as {
      __demoPause?: boolean; __demoScene?: string; __demoSceneIdx?: number; __demoFF?: boolean;
      __demoSpeed?: number; __demoLoopN?: number;
    };
    const now = performance.now();
    const dt = (now - lastTick) / 1000;
    lastTick = now;
    // A fresh loop = a fresh video: the playhead starts over, always.
    if ((w.__demoLoopN ?? 0) !== lastLoop) {
      lastLoop = w.__demoLoopN ?? 0;
      curIdx = -1;
      inScene = 0;
    }
    const idx = w.__demoSceneIdx ?? -1;
    if (idx !== curIdx) {
      // A completed, watched scene teaches the bar its real length.
      if (curIdx >= 0 && idx === curIdx + 1 && inScene > 1) durations[curIdx] = inScene;
      curIdx = idx;
      inScene = 0;
    }
    // Video-time: wall dt × UI speed. Paused or fast-forwarding = frozen.
    if (!w.__demoPause && !w.__demoFF && idx >= 0) inScene += dt * (1 / (w.__demoSpeed ?? 1));
    let played = 0;
    let total = 0;
    for (let i = 0; i < segCount(); i++) {
      const d = durOf(i);
      total += d;
      const f = i < curIdx ? 1 : i === curIdx ? Math.min(1, inScene / d) : 0;
      played += d * f;
      if (segFills[i]) segFills[i].style.width = `${f * 100}%`;
    }
    playedNow = played;
    const frac = dragFrac ?? (total > 0 ? played / total : 0);
    knob.style.left = `${frac * 100}%`;
    const label = seeking ? 'seeking…' : (w.__demoScene ?? 'warming up').replace(/^» /, '» skipping: ');
    clock.textContent = `${fmt(dragFrac !== null ? dragFrac * total : played)} / ${fmt(total)} · ${label}`;
  }, 100);

  // --- Seeking. Forward = accelerate through the live content until the
  // playhead reaches the target. Backward = rebuild to the target's scene,
  // then accelerate to the exact second. (A live app can't run in reverse.)
  let seeking = false;
  let seekTimer = 0;
  const sliderSpeed = (): number => 1 / Number(speed.value);
  const accelerateUntil = (done: () => boolean): void => {
    const w = window as unknown as { __demoSpeed?: number };
    window.clearInterval(seekTimer);
    seeking = true;
    w.__demoSpeed = 0.05; // ~×20: seconds of content per blink
    const t0 = performance.now();
    seekTimer = window.setInterval(() => {
      if (done() || performance.now() - t0 > 15000) {
        window.clearInterval(seekTimer);
        w.__demoSpeed = sliderSpeed(); // hand the tempo back to the slider
        seeking = false;
      }
    }, 80);
  };
  const seekTo = (t: number): void => {
    const total = totalOf();
    t = Math.max(0, Math.min(t, total - 0.5));
    let acc = 0;
    let s = 0;
    while (s < segCount() - 1 && acc + durOf(s) <= t) {
      acc += durOf(s);
      s++;
    }
    const offset = t - acc;
    const w = window as unknown as { __demoPause?: boolean };
    w.__demoPause = false; // seeking implies playing, like YT
    pauseBtn.textContent = 'Pause';
    if (s === curIdx && t >= playedNow) {
      accelerateUntil(() => playedNow >= t); // forward inside this scene
    } else {
      jumpTo(s); // rebuild + instant fast-forward to the scene…
      if (offset > 0.75) accelerateUntil(() => curIdx === s && inScene >= offset); // …then race to the second
    }
  };

  // ±5s hops.
  const back5 = el('button', { class: 'lp-demo-ctl-btn', text: '↺ 5s' });
  back5.addEventListener('click', () => seekTo(playedNow - 5));
  const fwd5 = el('button', { class: 'lp-demo-ctl-btn', text: '5s ↻' });
  fwd5.addEventListener('click', () => seekTo(playedNow + 5));

  // The knob: drag it anywhere on the bar, release to seek (YT's grip).
  bar.append(knob);
  knob.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const r = bar.getBoundingClientRect();
    const move = (ev: PointerEvent): void => {
      dragFrac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
    };
    const up = (ev: PointerEvent): void => {
      window.removeEventListener('pointermove', move);
      window.removeEventListener('pointerup', up);
      const frac = Math.max(0, Math.min(1, (ev.clientX - r.left) / r.width));
      dragFrac = null;
      seekTo(frac * totalOf());
    };
    window.addEventListener('pointermove', move);
    window.addEventListener('pointerup', up);
  });
  // Clicking the bar itself seeks to that TIME (segments keep their tooltips).
  bar.addEventListener('click', (e) => {
    if (e.target === knob) return;
    const r = bar.getBoundingClientRect();
    seekTo(((e.clientX - r.left) / r.width) * totalOf());
  });

  row.append(pauseBtn, back5, fwd5, speed, speedLbl, clock);
  ctl.append(bar, row);

  // No scroll hint and no bridge line (Gabe, 8/17): the demo's glowing edge
  // peeking above the fold IS the invitation now.
  sec.append(top, glow, ctl);
  return sec;
}
// #endregion

// The "how it works" band (static Dashboard frame + blurb) was REMOVED on 8/17
// (Gabe): the live hero demo made it redundant, and its headline lives on as
// the hero's bridge line.

// #region Demo film ---------------------------------------------------------------
/** A framed 16:9 video slot. The WHOLE SECTION (and its nav/footer links) stays
 *  hidden until `/landing-demo.mp4` actually exists in app/public/ — a public
 *  page advertising its own missing film reads pre-launch (council verdict,
 *  8/13; the placeholder inside remains as the film-failed fallback once the
 *  video has started loading). Drop the file in and everything appears, zero
 *  code change: `loadedmetadata` unhides the section and its links. */
function demoSection(root: HTMLElement): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-demo lp-reveal', id: 'demo' });
  sec.hidden = true;
  sec.append(
    el('h2', { class: 'lp-h2', text: 'Cobalt in sixty seconds' }),
    el('p', { class: 'lp-sub', text: 'The whole flow, from Schoology import to a finished focus session.' })
  );

  const frame = el('div', { class: 'lp-demo-frame' });
  const bar = el('div', { class: 'lp-frame-bar' });
  bar.append(
    el('span', { class: 'lp-dot r' }),
    el('span', { class: 'lp-dot y' }),
    el('span', { class: 'lp-dot g' }),
    el('div', { class: 'lp-frame-url', text: 'cobalt.app/demo' })
  );
  const body = el('div', { class: 'lp-demo-body' });

  const ph = el('div', { class: 'lp-demo-ph' });
  ph.append(
    el('div', { class: 'lp-demo-play', text: '▶' }),
    el('div', { class: 'lp-demo-ph-title', text: 'Demo film coming soon' }),
    el('div', {
      class: 'lp-demo-ph-sub',
      text: 'A quick tour of Cobalt is being filmed. Everything below is live right now.',
    })
  );

  const video = el('video', {
    class: 'lp-demo-video',
    controls: true,
    playsinline: true,
    preload: 'metadata',
    hidden: true,
  }) as HTMLVideoElement;
  video.src = '/landing-demo.mp4';
  video.addEventListener('loadedmetadata', () => {
    ph.remove();
    video.hidden = false;
    sec.hidden = false; // the film exists → the section joins the page
    root.querySelectorAll<HTMLElement>('[data-target="demo"]').forEach((b) => (b.hidden = false));
  });
  video.addEventListener('error', () => video.remove()); // no file — section stays hidden

  body.append(ph, video);
  frame.append(bar, body);
  sec.append(frame);
  return sec;
}
// #endregion

// #region See it in action (tabbed live previews) -------------------------------
function featuresSection(sandbox: Promise<Data>): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-features lp-reveal', id: 'play' });
  sec.append(
    el('h2', { class: 'lp-h2', text: 'See it in action' }),
    el('p', { class: 'lp-sub', text: 'A real, playable sample. Click around, it’s all live.' })
  );

  const tabs = el('div', { class: 'lp-tabs' });
  const row = el('div', { class: 'lp-split lp-split-reverse' });
  const text = el('div', { class: 'lp-split-text' });
  const frame = deviceFrame('cobalt.app/tasks');
  row.append(text, scaleToFit(frame.frame, 620)); // copy LEFT, frame RIGHT

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
        .catch(() => {
          panel!.append(el('div', { class: 'lp-frame-err', text: 'Preview unavailable' }));
          revealPanel(); // drop the loader, or the error would sit hidden behind it forever
        });
    }
    return panel;
  };

  const revealPanel = () => frame.body.classList.remove('loading');

  const select = (f: Feature, btn: HTMLElement) => {
    current = f.id;
    [...tabs.children].forEach((c) => c.classList.remove('active'));
    btn.classList.add('active');
    frame.url.textContent = `cobalt.app/${f.urlPath}`;
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
 *  takes over. */
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

// #region Personalization — three students, same assignments ----------------------
function setupsSection(): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-setups-sec lp-reveal', id: 'yours' });
  sec.append(
    el('h2', { class: 'lp-h2', text: 'Endless personalization' }),
    el('p', {
      class: 'lp-sub',
      text: 'The same four assignments on three students’ screens. Course colors, priorities, folders, and attachments are all yours to shape, from day-one defaults to fully organized.',
    })
  );

  const grid = el('div', { class: 'lp-setups' });
  STUDENT_SETUPS.forEach((s, i) => grid.append(setupCard(s, i)));
  sec.append(grid);
  return sec;
}

function setupCard(s: StudentSetup, index: number): HTMLElement {
  const card = el('div', { class: 'lp-setup-card lp-reveal' });
  card.style.transitionDelay = `${index * 70}ms`;
  const body = el('div', { class: 'lp-setup-body' });
  // `inert`, not just pointer-events: the rows are full of real <button>s, and
  // without this every one of them is a keyboard tab stop that does nothing.
  body.setAttribute('inert', '');
  for (const block of s.blocks) body.append(...renderBlock(block, s));
  card.append(body);
  return card;
}

function renderBlock(block: CardBlock, s: StudentSetup): HTMLElement[] {
  switch (block.kind) {
    case 'label':
      return [el('div', { class: 'task-folders-label', text: 'Folders' })];
    case 'header':
      return [el('div', { class: `task-group-header${block.tone ? ` tone-${block.tone}` : ''}`, text: block.text })];
    case 'row':
      return [staticTaskRow(SHOW_TASKS[block.task], s)];
    case 'folder': {
      const folder = el('div', { class: 'task-folder open' });
      const head = el('button', { class: 'task-folder-head' });
      head.append(el('span', { class: 'task-folder-handle', text: '⋮⋮' }));
      head.insertAdjacentHTML('beforeend', LP_FOLDER_SVG(block.color));
      const n = countRows(block.blocks);
      head.append(
        el('span', { class: 'task-folder-name', text: block.name }),
        el('span', { class: 'task-folder-count', text: `${n} task${n === 1 ? '' : 's'}` }),
        el('span', { class: 'task-folder-arrow', text: '▶' })
      );
      const body = el('div', { class: 'task-folder-body' });
      for (const b of block.blocks) body.append(...renderBlock(b, s));
      folder.append(head, body);
      return [folder];
    }
  }
}

function countRows(blocks: CardBlock[]): number {
  return blocks.reduce((n, b) => n + (b.kind === 'row' ? 1 : b.kind === 'folder' ? countRows(b.blocks) : 0), 0);
}

/** One hand-built `.task-item` with the REAL row anatomy, in the real order:
 *  priority strip, ⋮⋮ handle, checkbox, title (+ translation), then the bottom
 *  row of meta (course · date time), the QUIZ badge inside the meta wrap, and
 *  the full action cluster: ↗ ⓘ · 🌐 📎 folder priority ⎘. */
function staticTaskRow(t: ShowTask, s: StudentSetup): HTMLElement {
  // `.selected` is the Tasks tab's OWN multi-select class, so the outline and tint
  // match the real thing exactly rather than being re-invented here.
  const row = el('div', { class: `task-item${s.selectedIds?.includes(t.id) ? ' selected' : ''}` });
  const pri = priorityDef(s.priorities[t.id] ?? 'normal');
  row.append(el('div', { class: `task-priority ${pri.key}` }));
  // No ⋮⋮ grip on these rows (Gabe, 8/13: the bottom rows read smushed at three
  // columns): the grip's 23px is what lets meta + QUIZ badge + all buttons share
  // one line. Same no-grip treatment the Focus import rows already use; the
  // folder heads keep theirs, where space is free.
  row.append(el('button', { class: 'task-cb' }));

  const info = el('div', { class: 'task-info' });
  info.append(el('div', { class: 'task-title', text: t.title }));
  if (t.translated && !s.hideTranslation) {
    const tr = el('div', { class: 'task-translation' });
    tr.append(el('span', { class: 'task-translation-badge', text: '🌐' }), document.createTextNode(t.translated));
    info.append(tr);
  }

  const bottom = el('div', { class: 'task-bottom-row' });
  const metaWrap = el('div', { class: 'task-meta-wrap' });
  const meta = el('div', { class: 'task-meta' });
  const chip = el('span', { class: 'course-chip', text: t.course });
  chip.style.color = s.courseColors[t.course];
  meta.append(chip, el('span', { class: 'meta-dot', text: '·' }), el('span', { class: 'meta-date', text: t.due }));
  metaWrap.append(meta);
  // The assessment badge sits INSIDE the meta wrap, right after the meta line —
  // the real position (tasks/render.ts), not out by the action cluster.
  if (t.quiz) metaWrap.append(el('span', { class: 'task-test-badge', text: 'QUIZ' }));
  bottom.append(metaWrap);

  // Action cluster, mirroring the REAL row's rules (see tasks/render.ts, 8/13):
  //   ALWAYS  [↗ Schoology] [ⓘ] · [priority]        then [⋯] to close it out
  //   AUTO    a control appears when the task has content behind it: a translation,
  //           an attachment, a folder
  //   PINNED  the student forced an empty control to stay put (s.pinned)
  // This is what makes the three cards a real progression: card 1 is what the rules
  // give you untouched, card 3 is someone who has pinned the lot.
  const actions = el('div', { class: 'task-actions' });
  const sgy = el('button', { class: 'act-schoology' });
  sgy.innerHTML = LP_SCHOOLOGY_SVG;
  actions.append(sgy, el('button', { text: 'ⓘ' }), el('span', { class: 'act-sep', text: '·' }));

  const prio = el('button', { text: pri.arrow });
  prio.style.color = pri.color;
  actions.append(prio);

  const pinned = s.pinned ?? [];
  const count = s.attachments[t.id];
  const folderColor = s.folderColorOf[t.id];

  // 🌐 exists only where there IS a translation, so pinning it can't conjure one.
  // On card 1 it stays un-`.active` (the app's own 0.4-opacity "off" look) rather
  // than disappearing, so card 1 reads as an earlier state of the same row.
  if (t.translated) {
    actions.append(el('button', { class: `act-translate${s.hideTranslation ? '' : ' active'}`, text: '🌐' }));
  }
  if (count || pinned.includes('attach')) {
    const attach = el('button', {});
    attach.innerHTML = `📎${count ? `<span class="attach-count">${count}</span>` : ''}`;
    actions.append(attach);
  }
  if (folderColor || pinned.includes('folder')) {
    const fold = el('button', { class: 'act-folder' });
    fold.innerHTML = LP_FOLDER_BTN_SVG;
    if (folderColor) fold.style.color = folderColor;
    actions.append(fold);
  }
  // ⎘ never auto-promotes: nothing about a task makes duplicating it likelier, so
  // it is on the row only when pinned.
  if (pinned.includes('duplicate')) actions.append(el('button', { text: '⎘' }));

  actions.append(el('button', { class: 'act-more', text: '⋯' }));
  bottom.append(actions);

  info.append(bottom);
  row.append(info);
  return row;
}
// #endregion

// #region Cobalt vs Schoology -----------------------------------------------------
function compareSection(): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-compare lp-reveal', id: 'compare' });
  sec.append(
    el('h2', { class: 'lp-h2', text: 'Cobalt vs Schoology' }),
    el('p', { class: 'lp-sub', text: 'Schoology is where teachers post. Cobalt is where students get it done.' })
  );

  const grid = el('div', { class: 'lp-vs' });
  const head = el('div', { class: 'lp-vs-row lp-vs-headrow' });
  const cobHead = el('div', { class: 'lp-vs-cell lp-vs-head cobalt' });
  cobHead.append(createWordmark().el);
  head.append(el('div', { class: 'lp-vs-cell lp-vs-head', text: 'Schoology' }), cobHead);
  grid.append(head);

  VS_ROWS.forEach((r, i) => {
    const row = el('div', { class: 'lp-vs-row lp-reveal' });
    row.style.transitionDelay = `${i * 60}ms`;
    const sch = el('div', { class: 'lp-vs-cell' });
    sch.append(el('span', { class: 'lp-vs-no', text: '✗' }), el('span', { class: 'lp-vs-note', text: r.sch }));
    const cob = el('div', { class: 'lp-vs-cell lp-vs-hi' });
    cob.append(el('span', { class: 'lp-check lp-vs-yes', text: '✓' }), el('span', { class: 'lp-vs-note', text: r.cob }));
    row.append(sch, cob);
    grid.append(row);
  });

  sec.append(grid);
  // The disarming line: Cobalt is a companion, not a replacement. Pre-empts the
  // "is this allowed?" question from parents and school in one sentence.
  sec.append(
    el('p', { class: 'lp-vs-foot', text: 'You will still open Schoology to submit work. Cobalt handles everything before that.' })
  );
  return sec;
}
// #endregion

// #region Capabilities word cloud ----------------------------------------------
function capabilitiesSection(): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-caps lp-reveal', id: 'caps' });
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

// #region Footer + shared bits ----------------------------------------------------
function ctaButton(label: string, onClick: () => void): HTMLElement {
  const btn = el('button', { class: 'lp-cta', text: label });
  btn.addEventListener('click', onClick);
  return btn;
}

/** Wordmark + the same nav links (as a small chip row) + Log in / Get started,
 *  so the footer doubles as a second way to navigate or convert once a visitor
 *  has scrolled all the way down. */
function footerSection(opts: LandingOpts, scrollTo: (id: string) => void): HTMLElement {
  const f = el('footer', { class: 'lp-footer' });
  const top = el('div', { class: 'lp-footer-top' });

  const mark = el('div', { class: 'lp-footer-mark' });
  mark.append(createWordmark().el);

  const links = el('div', { class: 'lp-footer-links' });
  for (const l of NAV_LINKS) {
    const b = el('button', { class: 'lp-footer-link', text: l.label }) as HTMLButtonElement;
    b.dataset.target = l.id; // demoSection unhides all [data-target="demo"] links at once
    if (l.id === 'demo') b.hidden = true;
    b.addEventListener('click', () => scrollTo(l.id));
    links.append(b);
  }

  const actions = el('div', { class: 'lp-footer-actions' });
  const login = el('button', { class: 'lp-footer-login', text: 'Log in' });
  login.addEventListener('click', opts.onLogIn ?? opts.onTryNow);
  const cta = el('button', { class: 'lp-footer-cta', text: 'Get started free' });
  cta.addEventListener('click', opts.onTryNow);
  actions.append(login, cta);

  top.append(mark, links, actions);

  f.append(
    top,
    el('div', { class: 'lp-footer-rule' }),
    el('div', { class: 'lp-footer-base', text: '© 2026 Cobalt · All rights reserved' })
  );
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
