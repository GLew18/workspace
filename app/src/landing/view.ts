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

/** Sections that belong to ANOTHER nav entry rather than earning one of their own.
 *  The functions strip sits directly under the demo and is part of that beat
 *  (Gabe, 9/2/26), so scrolling into it keeps "Video demo" lit instead of lighting
 *  nothing — without adding a seventh tab to a nav that already has six.
 *  `democtl` came out on 9/3/26 with the temporary player; the gap it used to plug
 *  is now closed by #video's own padding-bottom reaching down to this strip. */
const SECTION_OWNER: Record<string, string> = { functions: 'video' };

const reducedMotion = (): boolean => window.matchMedia?.('(prefers-reduced-motion: reduce)').matches ?? false;

function scrollToSection(root: HTMLElement, id: string): void {
  root.querySelector(`#${id}`)?.scrollIntoView({ behavior: reducedMotion() ? 'auto' : 'smooth', block: 'start' });
}

/** The fixed nav: wordmark (→ top) · section links (center) · Log in + Get
 *  started (right). Buttons, not `<a href="#…">`, so clicking never touches the
 *  URL hash. Always solid (Gabe, 8/13): the bar keeps its contrast even over
 *  the hero, no transparent-then-solid scroll trick. */
/**
 * Marks an element as a beat in the on-load cascade, at position `i` counting
 * from the top of the page (Gabe, 9/4/26 — the Linear effect). The timing lives
 * entirely in landing.css; all this does is number the beats. `flat` drops the
 * blur for elements that already carry a backdrop-filter.
 */
function rise<T extends HTMLElement>(node: T, i: number, flat = false): T {
  node.classList.add('lp-rise');
  if (flat) node.classList.add('lp-rise-flat');
  node.style.setProperty('--rise', String(i));
  return node;
}

function navBar(opts: LandingOpts, root: HTMLElement): HTMLElement {
  const nav = rise(el('nav', { class: 'lp-nav' }), 0, true);

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
  // CTA FIRST, log in second (Gabe, 9/2/26) — the same order everywhere on the page.
  actions.append(cta, login);

  nav.append(brand, links, actions);
  return nav;
}

/** Active-link tracking: whichever id'd section currently owns the vertical
 *  middle band of the viewport gets `.active`. The observer dies naturally with
 *  the DOM (no window-level listeners), same as setupReveal below. */
function setupNav(nav: HTMLElement, root: HTMLElement): void {
  if (!('IntersectionObserver' in window)) return;
  const links = [...nav.querySelectorAll<HTMLElement>('.lp-nav-link')];
  // The owned sections are watched too, and report as their owner (SECTION_OWNER).
  const watched = [...NAV_LINKS.map((l) => l.id), ...Object.keys(SECTION_OWNER)];
  const sections = watched.map((id) => root.querySelector(`#${id}`)).filter((s): s is Element => !!s);
  if (!sections.length) return;
  // Track every section's intersection state so we can tell "scrolled above all
  // tracked sections" (hero text) apart from "moved to another section" — in the
  // former case no tab should stay lit.
  const inBand = new Set<string>();
  const activeIO = new IntersectionObserver(
    (entries) => {
      for (const e of entries) {
        const owner = SECTION_OWNER[e.target.id] ?? e.target.id;
        if (e.isIntersecting) inBand.add(e.target.id);
        else inBand.delete(e.target.id);
        if (e.isIntersecting) links.forEach((b) => b.classList.toggle('active', b.dataset.target === owner));
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
  { sch: 'Foreign titles remain cryptic', cob: '185 languages translated automatically' },
  { sch: 'No priorities on your work', cob: 'Five priority levels, color-coded on every task' },
  { sch: 'Your study links live somewhere else', cob: 'Attach links to any task and open them in one click' },
  { sch: 'Slow pages, dated design', cob: 'Instant, dark, and clean' },
];
// #endregion

// #region Public entry ----------------------------------------------------------
export function renderLanding(opts: LandingOpts): HTMLElement {
  const root = el('div', { class: 'landing' });
  // The load cascade is pure CSS (see .lp-rise in landing.css), so unlike the
  // scroll reveal it needs no observer and no rAF gate — the class goes on before
  // the page is ever inserted, and each beat starts the moment it is. Reduced
  // motion skips it, and the elements simply render as they always did.
  if (!reducedMotion()) root.classList.add('rise-on');

  const nav = navBar(opts, root);
  root.append(nav);

  // A soft blue glow that drifts behind the hero — pure decoration.
  root.append(el('div', { class: 'lp-glow' }));

  const seeSandbox = createSandbox();

  root.append(
    heroSection(opts),
    functionsSection(),
    demoSection(root),
    featuresSection(seeSandbox),
    setupsSection(),
    compareSection(),
    capabilitiesSection(),
    finalCtaSection(opts),
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
  // NOT a scroll-reveal target any more (Gabe, 9/4/26): the hero is on screen from
  // the first frame, so revealing it as one block on an observer callback was always
  // a load animation wearing a scroll animation's clothes. Its children now run the
  // real load cascade below, one beat each, top to bottom.
  const top = el('div', { class: 'lp-hero-top' });
  const inner = el('div', { class: 'lp-hero-inner' });

  inner.append(
    // "Schoology" carries the accent (Gabe, 8/13), so the one word the visitor is
    // scanning for is the one that reads first. Built from children rather than a
    // text attr because `el`'s `text` sets textContent and would erase the span.
    rise(
      el('h1', { class: 'lp-hero-title' }, [
        'Your ',
        el('span', { class: 'lp-hero-accent', text: 'Schoology' }),
        ', revolutionized',
      ]),
      1
    ),
    rise(
      el('p', {
        class: 'lp-tagline',
        text: 'Cobalt pulls every assignment out of Schoology into one organized list, while adding helpful functions to streamline homework completion.',
      }),
      2
    )
  );

  // Log in + Get started, matching the nav's pairing (Gabe, 8/13).
  const actions = rise(el('div', { class: 'lp-hero-actions' }), 3);
  const login = el('button', { class: 'lp-cta-ghost', text: 'Log in' });
  login.addEventListener('click', opts.onLogIn ?? opts.onTryNow);
  actions.append(ctaButton('Get started free', opts.onTryNow), login); // CTA left (Gabe, 9/2/26)
  inner.append(actions);

  // The byline (Gabe, 8/13): the cheapest real trust signal on the page. A tool
  // by one of their own beats any feature claim for this audience.
  

  // Three quick-glance chips, one per tab: Tasks, Focus, Bookmarks. Each chip wears
  // its tab's OWN emoji from FEATURES above (✅ / 🎯 / 🔖), so the hero and the
  // "see it in action" tabs read as the same three things. (Tasks used a ⚡ here
  // until 8/13, the one chip that didn't match its tab.)
  const chips = rise(el('div', { class: 'lp-hero-chips' }), 5);
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
  //
  // NOT a SCROLL-reveal target (Gabe, 9/3/26: on every reload "its opacity is really
  // low at the beginning and then it becomes more visible"). The scroll-reveal starts
  // each section at opacity 0 and fades it in over 0.7s once it is in view — and the
  // demo is in view from the first frame, so the visitor watched it fade in on a
  // trigger that had already passed.
  //
  // It IS the last beat of the on-load cascade though (Gabe, 9/6/26: "the text fades
  // in but the demo doesn't — have it fade in right after, following the cadence of
  // the text"). Beat 6, straight after the chips, rising from below exactly like the
  // lines above it. The `lp-rise-plain` variant drops the blur the text beats use:
  // a filter that lingers on a live, interactive mini-app is a containing block it
  // does not need, and blurring a moving frame reads as a rendering fault rather
  // than an entrance. Hero only — nothing below it joins the cascade.
  const glow = rise(el('div', { class: 'lp-stage-glow lp-rise-plain', id: 'video' }), 6);
  const stage = el('div', { class: 'lp-hero-stage' });
  glow.append(stage);
  void import('./demo/script')
    .then(({ startHeroDemo }) => {
      startHeroDemo(stage);
    })
    .catch(() => {
      /* demo unavailable — the hero text stands alone, nothing breaks */
    });

  // No scroll hint and no bridge line (Gabe, 8/17): the demo's glowing edge
  // peeking above the fold IS the invitation now.
  sec.append(top, glow);
  return sec;
}
// #endregion

// The "how it works" band (static Dashboard frame + blurb) was REMOVED on 8/17
// (Gabe): the live hero demo made it redundant, and its headline lives on as
// the hero's bridge line.

// #region Functions marquee --------------------------------------------------
/** The features that only exist once Schoology's assignments are inside Cobalt.
 *  Every one is a real, shipped thing the demo above actually performs; none is
 *  aspirational, which is the same rule the capabilities cloud keeps. */
// THE APP'S OWN GLYPHS, not lookalikes (Gabe, 9/2/26: "make sure the icons actually
// match their app counterparts"). Where a feature has a mark in the product, that
// exact mark is used here — the priority arrow from priorities.ts, the folder and
// calendar and archive outlines from the real buttons. Only the three features whose
// control carries no icon of its own (focus sessions, bookmark groups, quick-add) sit
// on the landing's established tab emoji instead.
//
// SVG at 1em, currentColor, so a mark drawn for a 14px row button sits on the same
// baseline as an emoji beside it.
const FN_SVG = (path: string, extra = ''): string =>
  `<svg viewBox="0 0 24 24" width="1em" height="1em" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"${extra}>${path}</svg>`;
const FN_FOLDER = FN_SVG('<path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/>');
const FN_CAL = FN_SVG('<rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/>');
const FN_BELL = FN_SVG('<path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/>');
const FN_ARCHIVE = FN_SVG(
  '<g transform="translate(0 .5)"><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7"/><path d="M10 12h4"/></g>'
);
// ALL ONE COLOUR (Gabe, 9/2/26). The row's 🌐 and 📎 and the tab emoji are full-colour
// glyphs, and mixed in among stroked outlines the strip looked like two icon sets
// pasted together. These are the same marks drawn as line art in currentColor, so the
// whole strip reads as one family. The APP keeps its emoji — this is the landing's
// own treatment, not a change to the product's iconography.
const FN_GLOBE = FN_SVG('<circle cx="12" cy="12" r="9"/><path d="M3 12h18"/><path d="M12 3a15 15 0 0 1 0 18 15 15 0 0 1 0-18z"/>');
const FN_CLIP = FN_SVG(
  '<path d="M21.4 11.05 12.2 20.2a5.5 5.5 0 0 1-7.8-7.8l9.2-9.15a3.7 3.7 0 0 1 5.2 5.2l-9.2 9.2a1.8 1.8 0 0 1-2.6-2.6l8.5-8.5"/>'
);
const FN_TARGET = FN_SVG('<circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.3"/>');
const FN_MARK = FN_SVG('<path d="M19 21l-7-5-7 5V5a2 2 0 0 1 2-2h10a2 2 0 0 1 2 2z"/>');
const FN_KEYS = FN_SVG('<rect x="2" y="6" width="20" height="12" rx="2"/><path d="M6 10h.01M10 10h.01M14 10h.01M18 10h.01M8 14h8"/>');
const FN_PENCIL = FN_SVG('<path d="M12 20h9"/><path d="M16.5 3.5a2.1 2.1 0 0 1 3 3L7 19l-4 1 1-4z"/>');
const FN_BOX_CHECK = FN_SVG('<rect x="3" y="3" width="18" height="18" rx="2"/><path d="M8 12l3 3 5-6"/>');

// Schoology navigation and descriptions were here and came out on 9/2/26 (Gabe):
// opening a link and reading an assignment's instructions are things Schoology
// already does, and this strip is only for what Cobalt adds on top.
const FUNCTIONS: Array<[string, string]> = [
  // The task row's own toolbox first, in the order the row wears it. `↑` and `⎘` stay
  // as characters: they ARE the app's marks, and both already draw in one colour.
  ['↑', 'Subjective priorities'], // the real High arrow (priorities.ts)
  [FN_GLOBE, 'Translation'],
  [FN_CLIP, 'Attachments'],
  [FN_FOLDER, 'Project folders'],
  ['⎘', 'Task duplication'],
  // Bulk check-off and focus music came out on 9/2/26 (Gabe): neither is a feature
  // of its own — one is what a bulk selection is FOR, the other is part of a focus
  // session — and listing a thing beside the thing that contains it pads the count
  // with something that reads as a claim and is really a restatement.
  [FN_BOX_CHECK, 'Bulk selecting'],
  // …then the things a whole tab does.
  [FN_TARGET, 'Focus sessions'],
  [FN_MARK, 'Bookmark groups'],
  [FN_KEYS, 'Bookmark shortcuts'],
  [FN_BELL, 'Notifications'],
  [FN_ARCHIVE, 'Task archives'],
  [FN_CAL, 'Month & week calendars'],
  [FN_PENCIL, 'Quick-add parsing'],
];

/** The gap between pills, and between one set and the next. Must match the `gap`
 *  on .lp-fn-track / .lp-fn-set in landing.css, because the shift below counts it. */
const FN_GAP = 18; // matches .lp-fn-track / .lp-fn-set gap
const FN_DESIGN_W = 1316; // .lp-fn-viewport's width in landing.css: the 1360px column minus 2 × 22px gutters
/** Pixels per second the strip drifts. 20, down from 42 (Gabe, 9/2/26): a logo wall
 *  should read as barely moving, and at 42 the pills went past faster than they
 *  could be read. Speed is what is fixed here, never duration — the strip grows
 *  copies to cover the window, so a fixed duration would mean a wider monitor
 *  scrolled faster. */
const FN_SPEED = 20;

/**
 * The logo-wall move, with Cobalt's own features where the sponsors would go: one
 * strip drifting left forever, wrapping seamlessly.
 *
 * ENOUGH COPIES TO COVER THE WINDOW, and that is not a detail (Gabe, 9/2/26: on a
 * wide Chrome window it "isn't actually scrolling, it's just static"). Two copies
 * are wider than a laptop and narrower than a widescreen, so on a big monitor the
 * strip ran out of pills partway through its slide and the tail of the animation
 * played over empty space — which reads as nothing moving at all. The set is
 * measured after it lays out and copied until the track is at least twice the
 * window wide, so there is always more strip than screen.
 *
 * The seam: the track slides by exactly ONE SET PLUS ONE GAP and then snaps back,
 * at which point copy two is standing precisely where copy one was. That distance
 * is published as a custom property rather than a percentage, because a percentage
 * of the track depends on how many copies there happen to be.
 */
function functionsSection(): HTMLElement {
  // The same h2 every other section uses (Gabe, 9/2/26). It was a small uppercase
  // eyebrow, which is the exact thing removed on 8/13 for looking out of place.
  // ARRIVES WITH THE DEMO, not on a scroll trigger (Gabe, 9/6/26: "make the
  // marquee appear at the same time as the demo"). Same cascade beat (6), so the
  // two land together as one unit — which is what they already are visually, the
  // strip being the list of the things the demo is doing. `lp-rise-plain` for the
  // same reason the stage uses it: the strip is scaled by scaleToFit, and a
  // lingering transform from the entrance would sit under that one.
  // NOT a scroll-reveal target any more: it would have faded in twice.
  const sec = rise(el('section', { class: 'lp-section lp-fn lp-rise-plain', id: 'functions' }), 6);
 

  const viewport = el('div', { class: 'lp-fn-viewport' });
  const track = el('div', { class: 'lp-fn-track' });
  const buildSet = (hidden: boolean): HTMLElement => {
    // Copies are scenery, not content: a screen reader that read the list four
    // times would be describing a rendering trick rather than the feature list.
    const set = el('div', { class: 'lp-fn-set' });
    if (hidden) set.setAttribute('aria-hidden', 'true');
    for (const [icon, label] of FUNCTIONS) {
      const item = el('div', { class: 'lp-fn-item' });
      const ico = el('span', { class: 'lp-fn-ico' });
      // The app's marks are SVG; the rest are single characters. innerHTML only ever
      // sees the constants above, never anything a visitor could supply.
      if (icon.startsWith('<svg')) ico.innerHTML = icon;
      else ico.textContent = icon;
      item.append(ico, el('span', { text: label }));
      set.append(item);
    }
    return set;
  };
  const first = buildSet(false);
  track.append(first);
  viewport.append(track);
  // SCALED, NOT REFLOWED (Gabe, 9/5/26, against Linear's logo strip): the strip is
  // laid out at the page column's full width and then shrinks as one picture when
  // the column is narrower, exactly like the device frames. So a phone shows the
  // same five-or-six pills a desktop does, only smaller, rather than two big ones.
  // FN_DESIGN_W is the .lp-section column: 1360px minus the two 22px gutters.
  sec.append(scaleToFit(viewport, FN_DESIGN_W));

  // Measured, then topped up. Runs again on resize: dragging a window from a laptop
  // width to a second monitor is exactly the case that was broken.
  let copies = 1;
  const fit = (): void => {
    const setW = first.getBoundingClientRect().width;
    if (!setW) return; // not laid out yet (hidden section) — the observer refires
    track.style.setProperty('--lp-fn-shift', `${setW + FN_GAP}px`);
    track.style.setProperty('--lp-fn-dur', `${(setW + FN_GAP) / FN_SPEED}s`);
    // The strip is inside the page column now (Gabe, 9/3/26), so cover THAT width
    // rather than the window's — innerWidth still works (it is never narrower), but
    // it is no longer the thing being covered.
    const cover = viewport.clientWidth || window.innerWidth;
    const want = Math.max(2, Math.ceil((cover * 2) / (setW + FN_GAP)) + 1);
    for (; copies < want; copies++) track.append(buildSet(true));
  };
  // Observed, not a window listener: a `resize` handler holds this closure for the
  // life of the page even after the landing is torn down at sign-in, where a
  // ResizeObserver becomes unreachable along with the nodes it watches (the same
  // reason scaleToFit and fitInto use one). The viewport is what actually changes
  // width when the window does, so watching it covers the laptop-to-monitor case.
  const ro = new ResizeObserver(fit);
  ro.observe(first);
  ro.observe(viewport);
  queueMicrotask(fit);
  return sec;
}
// #endregion

// #region Closing call to action ---------------------------------------------
/** The last thing on the page before the footer. A visitor who has read this far
 *  has run out of page; the one thing left to offer is the way in. */
function finalCtaSection(opts: LandingOpts): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-final lp-reveal', id: 'start' });
  const card = el('div', { class: 'lp-final-card' });
  card.append(
    el('h2', { class: 'lp-final-title', text: 'Stop chasing due dates.' }),
    el('p', {
      class: 'lp-final-sub',
      text: 'One sign-in, and every Schoology assignment lands in a single organized list.',
    })
  );
  const actions = el('div', { class: 'lp-final-actions' });
  const login = el('button', { class: 'lp-cta-ghost', text: 'Log in' });
  login.addEventListener('click', opts.onLogIn ?? opts.onTryNow);
  actions.append(ctaButton('Get started free', opts.onTryNow), login);
  card.append(actions);
  sec.append(card);
  return sec;
}
// #endregion

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

  // No fake browser chrome (Gabe, 9/1/26): traffic lights + a made-up URL read
  // Mac-only and spent height on nothing — every landing frame dropped them.
  const frame = el('div', { class: 'lp-demo-frame' });
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
  frame.append(body);
  sec.append(frame);
  return sec;
}
// #endregion

// #region See it in action (scroll-stacked live previews) -----------------------
/** Each feature gets its own card, sticky-pinned as you scroll past it, so the
 *  next card slides up and covers it completely — no click required to see
 *  what Focus or Bookmarks do (Gabe, 9/5/26: clicking a tab was friction;
 *  scrolling past a card that reveals itself is not). The tab names live on
 *  the cards themselves, bottom-left of the copy column, where the old tab
 *  row's job (saying which feature you are looking at) is done by the card
 *  that is on top. No nav row: it was a second thing to look at. */
function featuresSection(sandbox: Promise<Data>): HTMLElement {
  const sec = el('section', { class: 'lp-section lp-features lp-reveal', id: 'play' });

  // The heading holds its place while the deck runs (Gabe, 9/6/26: "it stays in
  // view as the cards go up"). All of the how — and why the first attempt at it
  // looked wrong — lives on .lp-features .lp-stack-head in landing.css; there is
  // nothing to do here but give it its own box to be pinned.
  // Plural copy: there are three samples down there, not one.
  const head = el('div', { class: 'lp-stack-head' });
  head.append(
    el('h2', { class: 'lp-h2', text: 'See it in action' }),
    el('p', { class: 'lp-sub', text: 'Real, playable samples. Just keep scrolling.' })
  );
  sec.append(head);

  const track = el('div', { class: 'lp-stack-track' });

  FEATURES.forEach((f) => {
    // Cards are DIRECT children of the track, not wrapped: a sticky element is
    // caged by its parent, so a per-card wrapper meant each card got shoved off
    // the moment the next one arrived and the two never overlapped at all (the
    // visual auditor measured 0px of overlap at every scroll sample, 9/5/26).
    // Sharing one parent lets card 1 stay pinned while card 2 rides up over it.
    const card = el('div', { class: 'lp-stack-card lp-reveal' });
    const row = el('div', { class: 'lp-split lp-split-reverse' });
    const text = el('div', { class: 'lp-split-text' });
    const label = el('div', { class: 'lp-stack-label' });
    label.append(el('span', { class: 'lp-tab-emoji', text: f.emoji }), el('span', { text: f.label }));
    text.append(
      el('h3', { class: 'lp-split-title', text: f.title }),
      el('p', { class: 'lp-lead', text: f.blurb }),
      bulletList(f.bullets),
      label // pushed to the column's bottom edge by CSS (margin-top: auto)
    );
    const frame = deviceFrame();
    row.append(text, scaleToFit(frame.frame, 620)); // copy LEFT, frame RIGHT
    card.append(row);
    track.append(card);

    // Mount the real preview once the card is close enough to matter (a generous
    // margin so it's ready well before the sticky card settles into place), then
    // never again — same one-shot-then-cache shape the old click-driven panels used.
    let mounted = false;
    const mountIO = new IntersectionObserver(
      (entries) => {
        if (mounted || !entries.some((e) => e.isIntersecting)) return;
        mounted = true;
        mountIO.disconnect();
        if (f.kind === 'focus') {
          frame.body.append(buildFocusDemo());
          frame.body.classList.remove('loading');
        } else {
          sandbox
            .then((data) => {
              if (f.kind === 'tasks') new TasksView(data, { host: frame.body }).mount(frame.body);
              else void new BookmarksView(data, { host: frame.body }).mount(frame.body);
              frame.body.classList.remove('loading');
            })
            .catch(() => {
              frame.body.append(el('div', { class: 'lp-frame-err', text: 'Preview unavailable' }));
              frame.body.classList.remove('loading');
            });
        }
      },
      { rootMargin: '600px 0px 600px 0px', threshold: 0 }
    );
    mountIO.observe(card);
  });

  sec.append(track);
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

function deviceFrame(): { frame: HTMLElement; body: HTMLElement } {
  // Chrome-free (Gabe, 9/1/26): no traffic lights, no fabricated URL bar — the
  // frame is just a rounded screen holding the live view.
  const frame = el('div', { class: 'lp-frame' });
  const body = el('div', { class: 'lp-frame-body loading' });
  body.append(el('div', { class: 'lp-frame-loading', text: 'Loading preview…' }));
  frame.append(body);
  return { frame, body };
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
  actions.append(cta, login); // CTA left (Gabe, 9/2/26)

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
    let observerFired = false;
    const io = new IntersectionObserver(
      (entries) => {
        observerFired = true;
        for (const e of entries) {
          if (e.isIntersecting) {
            e.target.classList.add('in');
            io.unobserve(e.target);
          }
        }
      },
      // A RATIO CAN'T BE THE TEST, because a section taller than the window can
      // never show 12% of ITSELF (the setups section is 1870px; on a 700px window
      // it tops out at 37%, and a shorter window or a taller section would fall
      // under the bar and never reveal at all). The old canary hid that by
      // revealing everything on a timer regardless. Triggering on the element's
      // top edge crossing 15% up from the bottom of the window instead is the same
      // moment for an ordinary section and is height-proof.
      { threshold: 0, rootMargin: '0px 0px -15% 0px' }
    );
    targets.forEach((node) => io.observe(node));

    // Canary. An IntersectionObserver reports on every target it is handed, in view
    // or not, so a single callback proves it is alive; if none has arrived by 1.5s
    // it is dead and everything is revealed outright rather than left invisible.
    //
    // This used to ask whether `.lp-hero-inner` carried `.in`. No element ever gets
    // that class — the reveal target was its PARENT — so the test was always true
    // and the canary fired on every single load, revealing the entire page 1.5s in
    // whether or not the visitor had scrolled to any of it. The scroll reveal below
    // the fold has therefore not actually run since it was written (found 9/4/26).
    window.setTimeout(() => {
      if (!observerFired) targets.forEach((n) => n.classList.add('in'));
    }, 1500);
  });
}
// #endregion
