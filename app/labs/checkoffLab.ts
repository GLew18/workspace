// Cobalt: Checkoff Animation Lab — a standalone test page with one mock task
// per Store checkoff animation (Gabe, 10/2: "one mock task per checkoff
// animation and I can just toggle it from completed to uncompleted").
//
// It plays the REAL effect code (src/store/checkoffEffects.ts) over a row with
// the REAL task-row markup and the REAL app CSS, so what it shows is what the
// app shows. It reads the catalog (src/store/checkoffArt.ts), so a new
// animation appears here on the next build with no edit to this file.
//
// Build:   node scripts/build-lab.mjs checkoff   (from app/)
// Output:  labs/out/checkoff-lab.html, published as the Artifact below.
// Artifact: URL is in scripts/build-lab.mjs.

import '../src/ui/theme.css';
import '../src/ui/components.css';
import '../src/ui/checkoff.css';
import './checkoffLab.css';
import { CHECKOFF_EFFECTS } from '../src/store/checkoffArt';
import { playCheckoffById } from '../src/store/checkoffEffects';

// Same check glyph the real row uses (tasks/render.ts CHECK_SVG).
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

const COURSES = [
  ['Accelerated Biology', '#6ee7a0'],
  ['Spanish', '#5bd6e0'],
  ['Geometry', '#ffd25b'],
  ['English', '#ff9fd6'],
  ['History', '#c792ff'],
  ['Chemistry', '#7db4ff'],
] as const;

const TITLES = [
  'Read chapter 4 and answer the review questions',
  'Vocab quiz: el subjuntivo',
  'Proofs worksheet, problems 1-12',
  'Annotate pages 40-62',
  'Primary source analysis: the Federalist No. 10',
  'Lab report: reaction rates',
  'Study guide for Friday',
  'Essay outline',
];

function today(): string {
  const d = new Date();
  return `${d.toLocaleDateString('en-US', { weekday: 'short' })} ${d.getMonth() + 1}/${d.getDate()}`;
}

/** One row, built exactly like the app's (classes and structure copied from a
 *  live render of tasks/render.ts renderTask). */
function buildRow(i: number, done: boolean): HTMLElement {
  const [course, color] = COURSES[i % COURSES.length];
  const row = document.createElement('div');
  row.className = `task-item${done ? ' completed' : ''}`;
  row.dataset.taskId = `lab_${i}`; // row effects follow the re-rendered row by this, as in the app
  row.innerHTML =
    `<div class="task-priority normal" title="Priority: Normal"></div>` +
    `<button class="task-cb${done ? ' checked' : ''}" aria-label="${done ? 'Mark not done' : 'Mark done'}">${CHECK_SVG}</button>` +
    `<div class="task-info"><div class="task-title"></div>` +
    `<div class="task-bottom-row"><div class="task-meta-wrap"><div class="task-meta">` +
    `<span class="course-chip" style="color:${color}">${course}</span><span class="meta-dot">·</span>` +
    `<span class="meta-date">${today()}</span></div></div>` +
    `<div class="task-actions"><button title="Priority" style="color:rgb(240,192,48)">—</button>` +
    `<button class="act-more" title="More">⋯</button></div></div></div>`;
  row.querySelector('.task-title')!.textContent = TITLES[i % TITLES.length];
  return row;
}

function mount(): void {
  const root = document.getElementById('lab')!;
  root.className = 'lab';
  root.innerHTML =
    `<header><h1 class="lab-title">Checkoff Animations</h1>` +
    `<p class="lab-sub">${CHECKOFF_EFFECTS.length} animations. Check a task to play its animation, uncheck it to reset.</p></header>`;
  const grid = document.createElement('div');
  grid.className = 'lab-grid';

  CHECKOFF_EFFECTS.forEach((fx, i) => {
    const card = document.createElement('section');
    card.className = 'lab-card';
    card.innerHTML =
      `<header class="lab-head"><span class="lab-icon">${fx.svg}</span>` +
      `<span class="lab-name"></span><span class="lab-price">${fx.price} Gems</span></header>` +
      `<div class="task-list lab-list"></div>`;
    card.querySelector('.lab-name')!.textContent = fx.name;
    const list = card.querySelector<HTMLElement>('.lab-list')!;

    let done = false;
    const render = () => {
      const row = buildRow(i, done);
      row.querySelector<HTMLElement>('.task-cb')!.addEventListener('click', () => {
        if (!done) playCheckoffById(fx.id, row);
        done = !done;
        // The app re-renders the list in place on every check, replacing the
        // row's node (the reason Gold Flash once looked broken). Do the same
        // here, so an effect that only survives in the lab can't pass.
        render();
      });
      list.replaceChildren(row);
    };
    render();
    grid.append(card);
  });

  root.append(grid);
}

mount();
