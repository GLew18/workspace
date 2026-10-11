// Cobalt: Focus Ring Skins lab — every ring skin in its three looks side by side
// (Gabe, 10/10): WORK (what the Shop shows), LAST FIVE MINUTES, and REST (the
// Pomodoro break). Draws the REAL markup (src/store/ringSkins.ts) inside the
// REAL ring wrapper with the REAL focus + skin CSS, and marks each wrapper the
// way focus/view.ts does mid-session (.urgent / .rest), so what this page shows
// is what a session shows. A new skin appears here on the next build.
//
// Build:   node scripts/build-lab.mjs rings   (from app/)
// Output:  labs/out/ring-lab.html, published as the Artifact in build-lab.mjs.

import '../src/ui/theme.css';
import '../src/ui/focus.css';
import '../src/ui/ringSkins.css';
import './ringLab.css';
import { RING_SKINS, ringMarkup } from '../src/store/ringSkins';

const R = 130;
const CIRC = 2 * Math.PI * R;

const LOOKS = [
  { cls: '', label: 'Work', time: '16:40', note: 'Shown in the Shop' },
  { cls: 'urgent', label: 'Last 5 minutes', time: '3:12', note: 'Final stretch' },
  { cls: 'rest', label: 'Rest', time: '4:05', note: 'Pomodoro break' },
] as const;

/** One ring in one look, two-thirds through its block like the Shop preview. */
function ring(skin: string | undefined, look: (typeof LOOKS)[number], left: number): HTMLElement {
  const fig = document.createElement('figure');
  fig.className = 'rl-look';
  const wrap = document.createElement('div');
  wrap.className = `focus-ring-wrap${look.cls ? ' ' + look.cls : ''}`;
  const svg = `<svg class="focus-ring" viewBox="0 0 280 280">${ringMarkup(skin, R, CIRC)}</svg>`;
  wrap.innerHTML = svg.replace(/stroke-dashoffset="0"/g, `stroke-dashoffset="${(CIRC * (1 - left)).toFixed(2)}"`);
  const time = document.createElement('div');
  time.className = 'focus-time';
  time.textContent = look.time;
  wrap.append(time);
  const cap = document.createElement('figcaption');
  cap.innerHTML = `<span class="rl-look-name">${look.label}</span><span class="rl-look-note">${look.note}</span>`;
  fig.append(wrap, cap);
  return fig;
}

const root = document.getElementById('lab')!;
root.className = 'rl';
root.innerHTML =
  `<header class="rl-head"><h1>Focus Ring Skins</h1>` +
  `<p>Every skin is a bundle of three looks. The Shop only shows the work look; the other two take over during a session, with the same one-second fade the standard ring uses. The last five minutes wins over rest.</p></header>`;

const skins: Array<[string | undefined, string]> = [[undefined, 'Standard'], ...RING_SKINS.map((s) => [s.id, s.name] as [string, string])];
for (const [id, name] of skins) {
  const sec = document.createElement('section');
  sec.className = 'rl-skin';
  const h = document.createElement('h2');
  h.textContent = name;
  const row = document.createElement('div');
  row.className = 'rl-row';
  // Work two-thirds left, last-five almost empty, rest just begun.
  row.append(ring(id, LOOKS[0], 0.66), ring(id, LOOKS[1], 0.22), ring(id, LOOKS[2], 0.82));
  sec.append(h, row);
  root.append(sec);
}
