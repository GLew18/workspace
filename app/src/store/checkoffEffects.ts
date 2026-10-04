// Cobalt: Store — the checkoff effects themselves, with no app dependencies.
//
// Split out of cosmetics.ts (10/2) so the standalone checkoff test page
// (labs/checkoffLab.ts) can play the EXACT code the app plays, without
// dragging in the database and Gems modules. cosmetics.ts decides WHETHER an
// effect plays (equipped item, non-manual task); this file decides WHAT plays.
//
// THREE FAMILIES (Gabe, 10/2–10/3), priced in this order:
// - Checkbox effects (Ripple, Bubbles, Starburst, Confetti, Smoke Puff, Sparkler, Gem
//   Burst) start from the CENTER of the checkbox.
// - Row effects (Light Sweep, Highlighter, Gold Break) cover the WHOLE row, priority strip
//   included.
// - Wild effects (Rocket, Lightning Strike, Wildfire, Black Hole) use the
//   checkbox AND the row.
// Row and wild effects keep the checkbox ON TOP of everything they draw: it is
// green and checked from the instant it's pressed and never changes (a checked
// stand-in sits above the effect, see rowStage). The row stays at full strength
// while they play and takes its normal finished look the moment they end.

/** Plays checkoff effect `id` over `row`. Unknown ids do nothing. A new effect
 *  needs a case here and a catalog entry in checkoffArt.ts; the test page picks
 *  it up from the catalog on its next build. */
export function playCheckoffById(id: string, row: HTMLElement): void {
  if (reducedMotion()) return;
  switch (id) {
    case 'ripple':
      return playRipple(row);
    case 'bubbles':
      return playBubbles(row);
    case 'starburst':
      return playStarburstPulse(row);
    case 'confetti':
      return playConfetti(row);
    case 'smokepuff':
      return playSmokePuff(row);
    case 'sparkler':
      return playSparkler(row);
    case 'gemburst':
      return playGemFall(row);
    case 'lightsweep':
      return playLightSweep(row);
    case 'highlighter':
      return playHighlighter(row);
    case 'goldflash': // id kept from the "Gold Flash" days so owners keep it; shown as Gold Break
      return playGoldBreak(row);
    case 'rocket':
      return playRocket(row);
    case 'lightning':
      return playLightning(row);
    case 'wildfire':
      return playWildfire(row);
    case 'blackhole':
      return playBlackHole(row);
  }
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);
const clamp01 = (v: number) => Math.max(0, Math.min(1, v));
const easeInOut = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
type P = [number, number];

/** The checkbox inside a task row, if findable — falls back to the row itself
 *  so a markup change elsewhere can't make these effects throw. */
function checkboxOf(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>('.task-cb') ?? row;
}

const centerOf = (r: DOMRect): P => [r.left + r.width / 2, r.top + r.height / 2];

/** A zero-size fixed anchor at the CENTER of `anchorEl`, appended to <body> so
 *  particles can fly past the row's bounds, auto-removed after `life` ms. */
function burstAnchor(anchorEl: HTMLElement, className: string, life: number): HTMLElement {
  const [x, y] = centerOf(anchorEl.getBoundingClientRect());
  const burst = document.createElement('div');
  burst.className = className;
  burst.style.cssText = `left:${x.toFixed(1)}px;top:${y.toFixed(1)}px;`;
  document.body.append(burst);
  setTimeout(() => burst.remove(), life);
  return burst;
}

/** Turns a physics path into Web Animations keyframes (one every ~25ms). */
function flightFrames(
  dur: number,
  pos: (t: number) => P,
  extra: (t: number) => string = () => '',
  opacity: (k: number) => number = () => 1
): Keyframe[] {
  const n = Math.max(8, Math.ceil(dur / 25));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * (dur / 1000);
    const [x, y] = pos(t);
    return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${extra(t)}`, opacity: opacity(i / n) };
  });
}

/** One free-flying particle: `cls` element at client point (x, y) following
 *  gravity, removed when done. */
function particle(host: HTMLElement, cls: string, x: number, y: number, vx: number, vy: number, g: number, dur: number, fade = 0.5): HTMLElement {
  const p = document.createElement('span');
  p.className = cls;
  p.style.left = `${x.toFixed(1)}px`;
  p.style.top = `${y.toFixed(1)}px`;
  host.append(p);
  p.animate(
    flightFrames(dur, (s) => [vx * s, vy * s + 0.5 * g * s * s], () => '', (k) => (k < fade ? 1 : 1 - (k - fade) / (1 - fade))),
    { duration: dur, fill: 'forwards' }
  ).onfinish = () => p.remove();
  return p;
}

/** Runs `frame` every animation frame for `dur` ms (elapsed ms passed in), then `done`. */
function runFrames(dur: number, frame: (ms: number) => void, done: () => void): void {
  const start = performance.now();
  const tick = (now: number) => {
    const ms = Math.min(dur, now - start);
    frame(ms);
    if (ms < dur) requestAnimationFrame(tick);
    else done();
  };
  requestAnimationFrame(tick);
}

// --- row tracking -----------------------------------------------------------

/**
 * Follows a task row across re-renders. Checking a task re-renders the list in
 * place (a NEW node) and may re-sort it to the bottom of its day group, so a
 * row effect looks the row up fresh every frame, by task id, and moves with it.
 * Our own overlays carry no task id, so they never match.
 */
function rowTracker(row: HTMLElement): () => { row: HTMLElement; rect: DOMRect } {
  let cur = row;
  let rect = row.getBoundingClientRect();
  const id = row.dataset.taskId;
  return () => {
    if (!cur.isConnected && id) {
      let best: HTMLElement | null = null;
      let bestD = Infinity;
      for (const el of document.querySelectorAll<HTMLElement>(`.task-item[data-task-id="${CSS.escape(id)}"]`)) {
        const r = el.getBoundingClientRect();
        if (!r.width) continue;
        const d = Math.abs(r.top - rect.top);
        if (d < bestD) {
          best = el;
          bestD = d;
        }
      }
      if (best) cur = best;
    }
    if (cur.isConnected) rect = cur.getBoundingClientRect();
    return { row: cur, rect };
  };
}

/** What a row or wild effect draws with, refreshed every frame. */
interface Stage {
  row: HTMLElement; // the live row
  rect: DOMRect; // its box
  cb: DOMRect; // its checkbox's box
  layer: HTMLElement; // a fixed overlay exactly over the row
  free: HTMLElement; // a fixed layer at the viewport origin, for things that leave the row
  strikeHeld: boolean; // while true the real strikethrough stays invisible
  /** Reveals the strikethrough, line i up to `reach(line, i)` px. Call each frame. */
  paintStrike: (reach: (l: TitleLine, i: number) => number) => void;
}

/** A finished row's opacity: matches `.task-item.completed` in components.css. */
const DONE_DIM = 0.5;

/** 1 → DONE_DIM as `k` goes 0 → 1: the row graying out gradually. */
const dimAt = (k: number) => 1 - (1 - DONE_DIM) * clamp01(k);

/** How long the checkbox stand-in takes to hand over to the real checkbox. */
const HANDOFF = 220;

interface StageOpts {
  clip?: boolean;
  holdStrike?: boolean;
  /** The row's opacity at `ms`. Defaults to graying out across the whole
   *  effect, so it lands on the finished look exactly as the effect ends. */
  fade?: (ms: number) => number;
  /** The checkbox stand-in's opacity at `ms`. Defaults to `fade`. */
  boxFade?: (ms: number) => number;
}

/**
 * The shared rig for row and wild effects: an overlay that follows the row,
 * a free layer for particles, and a checked stand-in of the checkbox ABOVE
 * everything (Gabe, 10/3: "the checkbox has a greater z-index than the
 * animation"). The row grays out GRADUALLY while the effect plays (Gabe, 10/3:
 * it used to stay bright and then snap to gray at the end), so when the effect
 * ends the row is already in its finished look. Everything is removed after
 * `dur` ms.
 *
 * NOTHING MAY JUMP WHEN IT ENDS (Gabe, 10/3: "at the very end, it abruptly
 * fades out a little more, and the strikethrough moves a little bit"). Two
 * causes, two fixes:
 * - The strikethrough used to be a line we drew at an estimated spot, swapped
 *   for the browser's real one at the end. Now it IS the browser's line: a
 *   copy of the title inside the row, text invisible, revealed by a clip, so
 *   it sits at the exact pixel and dims exactly as the real one does.
 * - The checkbox stand-in lives outside the row, so even at the same opacity
 *   it blends slightly differently from the real checkbox. It now cross-fades
 *   into the real one over the last HANDOFF ms instead of vanishing.
 */
function rowStage(row: HTMLElement, dur: number, opts: StageOpts, frame: (ms: number, s: Stage) => void): void {
  const track = rowTracker(row);
  const fade = opts.fade ?? ((ms: number) => dimAt(ms / dur));
  const boxFade = opts.boxFade ?? fade;
  const layer = document.createElement('div');
  layer.className = `gems-fx${opts.clip ? ' gems-fx-clip' : ''}`;
  const free = document.createElement('div');
  free.className = 'gems-fx gems-fx-free';
  const cbSrc = checkboxOf(row);
  const standin = document.createElement('span');
  standin.className = 'task-cb checked gems-cb-standin';
  standin.innerHTML = cbSrc === row ? '' : cbSrc.innerHTML;
  if (cbSrc === row) standin.hidden = true;
  document.body.append(layer, free, standin);

  // The strikethrough copy, living inside whichever row node is current.
  let strikeCopy: HTMLElement | null = null;
  const paintStrike = (reach: (l: TitleLine, i: number) => number) => {
    const cur = s.row;
    const title = cur.querySelector<HTMLElement>('.task-title:not(.gems-strike-copy)');
    if (!title) return;
    if (!strikeCopy || strikeCopy.parentElement !== cur) {
      strikeCopy?.remove();
      strikeCopy = title.cloneNode(true) as HTMLElement;
      strikeCopy.classList.add('gems-strike-copy');
      strikeCopy.setAttribute('aria-hidden', 'true');
      cur.append(strikeCopy);
    }
    const rr = cur.getBoundingClientRect();
    const tr = title.getBoundingClientRect();
    strikeCopy.style.left = `${(tr.left - rr.left - cur.clientLeft).toFixed(2)}px`;
    strikeCopy.style.top = `${(tr.top - rr.top - cur.clientTop).toFixed(2)}px`;
    strikeCopy.style.width = `${tr.width.toFixed(2)}px`;
    strikeCopy.style.setProperty('--gems-strike-color', getComputedStyle(title).color);
    const path = titleLines(cur)
      .map((l, i) => {
        const w = Math.max(0, Math.min(l.right - l.left, reach(l, i)));
        if (w <= 0) return '';
        const x = l.left - tr.left;
        const y = l.top - tr.top - 2;
        return `M${x.toFixed(1)} ${y.toFixed(1)} h${w.toFixed(1)} v${(l.bottom - l.top + 4).toFixed(1)} h${(-w).toFixed(1)} Z`;
      })
      .join(' ');
    strikeCopy.style.clipPath = path ? `path('${path}')` : 'inset(50%)';
  };

  const first = track();
  const s: Stage = {
    row: first.row,
    rect: first.rect,
    cb: checkboxOf(row).getBoundingClientRect(),
    layer,
    free,
    strikeHeld: !!opts.holdStrike,
    paintStrike,
  };
  let held: HTMLElement | null = null;
  const release = () => {
    held?.classList.remove('gems-row-hold', 'gems-strike-hold');
    held?.style.removeProperty('--gems-fade');
  };

  let now = 0;
  const place = () => {
    const { row: cur, rect } = track();
    if (held !== cur) {
      release();
      held = cur;
    }
    cur.classList.add('gems-row-hold');
    cur.style.setProperty('--gems-fade', fade(now).toFixed(3));
    cur.classList.toggle('gems-strike-hold', s.strikeHeld);
    const handoff = clamp01((now - (dur - HANDOFF)) / HANDOFF);
    standin.style.opacity = (boxFade(now) * (1 - handoff)).toFixed(3);
    s.row = cur;
    s.rect = rect;
    s.cb = checkboxOf(cur).getBoundingClientRect();
    layer.style.left = `${rect.left}px`;
    layer.style.top = `${rect.top}px`;
    layer.style.width = `${rect.width}px`;
    layer.style.height = `${rect.height}px`;
    standin.style.left = `${s.cb.left}px`;
    standin.style.top = `${s.cb.top}px`;
  };
  place();
  frame(0, s);
  runFrames(
    dur,
    (ms) => {
      now = ms;
      place();
      frame(ms, s);
    },
    () => {
      release();
      strikeCopy?.remove();
      standin.remove();
      // Particles still in flight (a last ember, a wisp of smoke) finish on
      // their own instead of blinking out with the layer.
      settleThenRemove(layer);
      settleThenRemove(free);
    }
  );
}

/** Removes `el` once its finite animations (its own and its children's) end. */
function settleThenRemove(el: HTMLElement): void {
  const running = el
    .getAnimations({ subtree: true })
    .filter((a) => a.playState !== 'finished' && a.effect?.getComputedTiming().endTime !== Infinity);
  if (!running.length) return el.remove();
  void Promise.all(running.map((a) => a.finished.catch(() => undefined))).then(() => el.remove());
  setTimeout(() => el.remove(), 3000); // never leave one behind
}

/** A copy of the row as it looked BEFORE the check (no strikethrough, no dim),
 *  laid over the real one. Effects that reveal the finished task cut it away. */
function rowCover(row: HTMLElement): HTMLElement {
  const c = row.cloneNode(true) as HTMLElement;
  c.removeAttribute('data-task-id');
  c.classList.remove('completed', 'selected', 'gems-row-hold', 'gems-strike-hold');
  c.classList.add('gems-cover');
  c.querySelector('.gems-strike-copy')?.remove();
  return c;
}

interface TitleLine {
  left: number;
  right: number;
  top: number;
  bottom: number;
  y: number; // roughly where the strikethrough runs (the Rocket flies along it)
  thick: number; // about the strikethrough's thickness (Highlighter sizes its mark from it)
}

/** Each line of the row's title, in client coordinates. */
function titleLines(row: HTMLElement): TitleLine[] {
  const title = row.querySelector<HTMLElement>('.task-title:not(.gems-strike-copy)');
  if (!title) return [];
  const range = document.createRange();
  range.selectNodeContents(title);
  const thick = Math.max(1, Math.round(parseFloat(getComputedStyle(title).fontSize) / 12));
  // getClientRects can split one visual line into several boxes; merge by line.
  const lines: TitleLine[] = [];
  for (const r of range.getClientRects()) {
    if (r.width < 1) continue;
    const y = r.top + r.height * 0.56;
    const same = lines.find((l) => Math.abs(l.y - y) < r.height / 2);
    if (same) {
      same.left = Math.min(same.left, r.left);
      same.right = Math.max(same.right, r.right);
      same.top = Math.min(same.top, r.top);
      same.bottom = Math.max(same.bottom, r.bottom);
    } else lines.push({ left: r.left, right: r.right, top: r.top, bottom: r.bottom, y, thick });
  }
  return lines;
}

// --- Light Sweep: the sweep draws the strikethrough -------------------------

/**
 * The check shows at once; a light band crosses the WHOLE row, strip included,
 * and the strikethrough grows right behind it (Gabe, 10/2), at the original
 * quicker pace (Gabe, 10/3: the 1.25s version was too slow).
 */
function playLightSweep(row: HTMLElement): void {
  const BAND = 90;
  let band: HTMLElement | null = null;
  // The row grays out in step with the light crossing it.
  rowStage(row, 900, { clip: true, holdStrike: true, fade: (ms) => dimAt(easeInOut(ms / 900)) }, (ms, s) => {
    if (!band) {
      band = document.createElement('div');
      band.className = 'gems-sweep-band';
      s.layer.append(band);
    }
    const w = s.rect.width;
    const bx = -BAND + (w + BAND * 2) * easeInOut(ms / 900);
    band.style.transform = `translateX(${bx.toFixed(1)}px) skewX(-20deg)`;
    const lightX = s.rect.left + bx + BAND * 0.5;
    s.paintStrike((l) => lightX - l.left);
  });
}

// --- Highlighter: a marker swipes the title, then strikes it --------------------

/**
 * A yellow highlighter swipes across each line of the title, left to right,
 * the strikethrough is drawn through it right behind, and the highlight fades
 * as the row grays out (Gabe, 10/3: added to fill the row tier).
 */
function playHighlighter(row: HTMLElement): void {
  // Highlight FIRST, then cross off (Gabe, 10/3): the swipe is ~95% done
  // before the strike even starts, then the highlight fades as the row grays.
  const SWIPE = 560;
  const STRIKE_AT = SWIPE * 0.95;
  const STRIKE = 380;
  const DUR = STRIKE_AT + STRIKE + 450;
  const marks: HTMLElement[] = [];
  rowStage(row, DUR, { holdStrike: true }, (ms, s) => {
    const lines = titleLines(s.row);
    while (marks.length < lines.length) {
      const m = document.createElement('span');
      m.className = 'gems-highlight';
      s.free.prepend(m); // under the drawn strikes
      marks.push(m);
    }
    const n = Math.max(1, lines.length);
    const fadeOut = 1 - clamp01((ms - (STRIKE_AT + STRIKE)) / 450);
    lines.forEach((ln, i) => {
      const k = easeInOut(clamp01((ms - (i * SWIPE) / n) / (SWIPE / n)));
      const h = Math.round(ln.thick * 12);
      marks[i].style.cssText =
        `left:${(ln.left - 3).toFixed(1)}px;top:${(ln.y - h * 0.58).toFixed(1)}px;` +
        `width:${((ln.right - ln.left + 6) * k).toFixed(1)}px;height:${h}px;opacity:${fadeOut.toFixed(3)};`;
    });
    s.paintStrike((l, i) => (l.right - l.left) * easeInOut(clamp01((ms - STRIKE_AT - (i * STRIKE) / n) / (STRIKE / n))));
  });
}

// --- Gold Break: the row becomes a gold ingot and shatters ------------------

/**
 * The whole row, strip to edge, turns into a solid gold ingot with the task
 * engraved in black, cracks almost at once, and shatters into falling pieces
 * that uncover the crossed-off task (Gabe, 10/2–10/3: no glint, minimal pause
 * between the gold forming and the break).
 */
function playGoldBreak(row: HTMLElement): void {
  const r0 = row.getBoundingClientRect();
  const W = r0.width;
  const H = r0.height;
  if (W < 20 || H < 10) return;
  const makeIngot = (): HTMLElement => {
    const ingot = document.createElement('div');
    ingot.className = 'gems-ingot';
    const face = rowCover(row);
    face.classList.add('gems-ingot-face');
    ingot.append(face);
    return ingot;
  };

  // Jagged vertical cracks meet one jagged horizontal crack, so the pieces tile
  // the ingot exactly and every crack is a real piece edge.
  const cols = Math.max(4, Math.min(8, Math.round(W / 70)));
  const cracks: P[][] = [];
  for (let i = 0; i <= cols; i++) {
    const edge = i === 0 || i === cols;
    const x = edge ? (i === 0 ? 0 : W) : (W * i) / cols + rand(-10, 10);
    const j = (sp: number) => (edge ? x : x + rand(-sp, sp));
    const midY = H * 0.5 + (edge ? 0 : rand(-H * 0.12, H * 0.12));
    cracks.push([[j(6), 0], [j(9), midY * 0.5], [edge ? x : x + rand(-4, 4), midY], [j(9), midY + (H - midY) * 0.5], [j(6), H]]);
  }
  const shards: P[][] = [];
  for (let c = 0; c < cols; c++) {
    const L = cracks[c];
    const R = cracks[c + 1];
    shards.push([L[0], L[1], L[2], R[2], R[1], R[0]]);
    shards.push([L[2], L[3], L[4], R[4], R[3], R[2]]);
  }

  const FORM = 170;
  const SHATTER = 400;
  let ingot: HTMLElement | null = null;
  let svg: SVGSVGElement | null = null;
  let broken = false;

  // The row grays out at once under the gold, so it's already finished when
  // the pieces fall away; the checkbox on top dims as the ingot breaks.
  const goldOpts: StageOpts = { fade: () => DONE_DIM, boxFade: (ms) => dimAt((ms - SHATTER) / 250) };
  rowStage(row, SHATTER + 950, goldOpts, (ms, s) => {
    if (!ingot) {
      ingot = makeIngot();
      s.layer.append(ingot);
      ingot.animate(
        [
          { opacity: 0, filter: 'brightness(1.9)' },
          { opacity: 1, filter: 'brightness(1.3)', offset: 0.5 },
          { opacity: 1, filter: 'brightness(1)' },
        ],
        { duration: FORM, easing: 'ease-out' }
      );
      svg = crackSvg(W, H, cracks, cols, FORM + 10);
      s.layer.append(svg);
    }
    if (!broken && ms >= SHATTER) {
      broken = true;
      ingot.remove();
      svg?.remove();
      for (const poly of shards) {
        const piece = makeIngot();
        piece.style.clipPath = `polygon(${poly.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(',')})`;
        const cx = poly.reduce((a, p) => a + p[0], 0) / poly.length;
        const cy = poly.reduce((a, p) => a + p[1], 0) / poly.length;
        piece.style.transformOrigin = `${cx}px ${cy}px`;
        s.layer.append(piece);
        // Pieces pop up and away from the checkbox side, then fall.
        const vx = rand(-30, 70) + (cx / W) * 90;
        const vy = rand(-170, -60) + (cy > H / 2 ? 60 : 0);
        const spin = rand(-260, 260);
        const dur = rand(700, 880);
        piece.animate(
          flightFrames(dur, (t) => [vx * t, vy * t + 0.5 * 1500 * t * t], (t) => `rotate(${(spin * t).toFixed(1)}deg)`, (k) =>
            k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45
          ),
          { duration: dur, fill: 'forwards' }
        );
      }
    }
  });
}

/** The cracks across the ingot, each drawn on quickly from the checkbox side. */
function crackSvg(W: number, H: number, cracks: P[][], cols: number, start: number): SVGSVGElement {
  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'gems-ingot-cracks');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const d = (pts: P[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const paths: { d: string; delay: number }[] = [];
  for (let i = 1; i < cols; i++) paths.push({ d: d(cracks[i]), delay: start + i * 18 });
  paths.push({ d: d(cracks.map((k) => k[2])), delay: start + 10 });
  for (const pth of paths) {
    for (const [cls, off] of [['lit', 0.8], ['dark', 0]] as const) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', pth.d);
      p.setAttribute('pathLength', '1');
      p.setAttribute('class', `gems-crack-${cls}`);
      if (off) p.setAttribute('transform', `translate(${off} ${off})`);
      svg.append(p);
      p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], { duration: 120, delay: pth.delay, easing: 'ease-out', fill: 'both' });
    }
  }
  return svg;
}

// --- Rocket: a tiny rocket whose exhaust trail IS the strikethrough ----------

const ROCKET_SVG =
  `<svg viewBox="0 0 40 20" aria-hidden="true">` +
  `<path class="gems-rocket-flame" d="M9,6 Q-2,10 9,14 Q5,10 9,6 Z" fill="#ffb347"/>` +
  `<path d="M9,10 Q6,10 4,10" stroke="#fff3c4" stroke-width="2" stroke-linecap="round"/>` +
  `<path d="M12,4 L7,1 L10,7 Z M12,16 L7,19 L10,13 Z" fill="#e5484d"/>` +
  `<path d="M9,6 H28 Q38,6 39,10 Q38,14 28,14 H9 Z" fill="#e9eef5" stroke="#1f2633" stroke-width="0.9"/>` +
  `<path d="M30,6.3 Q38,7 39,10 Q38,13 30,13.7 Q33,10 30,6.3 Z" fill="#e5484d"/>` +
  `<circle cx="22" cy="10" r="2.6" fill="#5a9bef" stroke="#2f62c4" stroke-width="0.8"/>` +
  `<path d="M9,12.5 H28" stroke="#b9c3d0" stroke-width="1"/>` +
  `</svg>`;

const FIREWORK_COLORS = ['#ffd25b', '#ff6f91', '#7db4ff', '#6ee7a0', '#ffffff', '#c792ff'];

/**
 * A tiny rocket launches from the checkbox, flies along the title so its trail
 * becomes the strikethrough, climbs off the end of the row and bursts into a
 * firework.
 */
function playRocket(row: HTMLElement): void {
  const START = 90; // let the list re-render first, so the path is measured on the real row
  const FLY = 1050;
  const CLIMB = 260;
  const BOOM = START + FLY + CLIMB;
  let rocket: HTMLElement | null = null;
  let path: P[] = [];
  let lens: number[] = [];
  let total = 0;
  let lines: TitleLine[] = [];
  let lineStart: number[] = []; // distance along the path where each title line begins
  let lastPuff = 0;
  let boomed = false;

  ensureSmokeFilter();
  rowStage(row, BOOM + 1000, { holdStrike: true, fade: (ms) => dimAt(ms / BOOM) }, (ms, s) => {
    if (ms < START) return;
    if (!rocket) {
      lines = titleLines(s.row);
      const [cx, cy] = centerOf(s.cb);
      path = [[cx, cy]];
      lineStart = [];
      for (const l of lines) {
        path.push([l.left - 4, l.y]);
        lineStart.push(-1); // filled below
        path.push([l.right + 4, l.y]);
      }
      const end = path[path.length - 1] ?? [cx, cy];
      path.push([Math.min(end[0] + 40, s.rect.right + 30), end[1] - 6]);
      lens = [0];
      for (let i = 1; i < path.length; i++) lens.push(lens[i - 1] + Math.hypot(path[i][0] - path[i - 1][0], path[i][1] - path[i - 1][1]));
      total = lens[lens.length - 1];
      lines.forEach((_, i) => (lineStart[i] = lens[1 + i * 2]));
      rocket = document.createElement('span');
      rocket.className = 'gems-rocket';
      rocket.innerHTML = ROCKET_SVG;
      s.free.append(rocket);
    }
    const t = ms - START;
    let x: number, y: number, ang: number;
    if (t <= FLY) {
      // Along the path, a quick launch then a steady run.
      const k = t / FLY;
      const d = total * (k < 0.15 ? (k / 0.15) ** 2 * 0.1 : 0.1 + ((k - 0.15) / 0.85) * 0.9);
      let i = 1;
      while (i < lens.length - 1 && lens[i] < d) i++;
      const seg = Math.max(1e-6, lens[i] - lens[i - 1]);
      const f = clamp01((d - lens[i - 1]) / seg);
      x = path[i - 1][0] + (path[i][0] - path[i - 1][0]) * f;
      y = path[i - 1][1] + (path[i][1] - path[i - 1][1]) * f;
      ang = Math.atan2(path[i][1] - path[i - 1][1], path[i][0] - path[i - 1][0]);
      // The trail: each line is struck up to the rocket's tail.
      // (Line i's path segment starts 4px left of the text; the tail trails the nose by ~14px.)
      s.paintStrike((_l, li) => d - lineStart[li] - 22);
    } else {
      // Off the end of the row, curving up into the sky.
      const end = path[path.length - 1];
      const k = clamp01((t - FLY) / CLIMB);
      x = end[0] + 70 * k;
      y = end[1] - 90 * k * k;
      ang = Math.atan2(-180 * k, 70);
      s.paintStrike((l) => l.right - l.left);
    }
    if (!boomed) {
      rocket!.style.transform = `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) rotate(${ang.toFixed(3)}rad)`;
      if (ms - lastPuff > 45) {
        lastPuff = ms;
        const tx = x - Math.cos(ang) * 20;
        const ty = y - Math.sin(ang) * 20;
        smokeWisp(s.free, tx, ty, rand(7, 12), rand(450, 650), rand(-8, 8), rand(4, 14));
      }
    }
    if (!boomed && ms >= BOOM) {
      boomed = true;
      rocket!.remove();
      const flash = document.createElement('span');
      flash.className = 'gems-boom-flash';
      flash.style.left = `${x}px`;
      flash.style.top = `${y}px`;
      s.free.append(flash);
      for (let i = 0; i < 30; i++) {
        const a = (i / 30) * Math.PI * 2 + rand(-0.1, 0.1);
        const v = rand(90, 190);
        const p = particle(s.free, 'gems-firework-spark', x, y, Math.cos(a) * v, Math.sin(a) * v, 260, rand(700, 950), 0.35);
        p.style.background = FIREWORK_COLORS[i % FIREWORK_COLORS.length];
        p.style.color = p.style.background;
      }
    }
  });
}

// --- Lightning Strike --------------------------------------------------------

/** A jagged polyline from a to b by midpoint displacement. */
function bolt(a: P, b: P, rough: number, depth = 5): P[] {
  if (depth === 0) return [a, b];
  const mid: P = [(a[0] + b[0]) / 2 + rand(-rough, rough), (a[1] + b[1]) / 2 + rand(-rough, rough) * 0.4];
  return [...bolt(a, mid, rough / 2, depth - 1), ...bolt(mid, b, rough / 2, depth - 1).slice(1)];
}
const polyD = (pts: P[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');

/**
 * A bolt strikes the checkbox from above, electricity arcs across the row, and
 * the row flashes white; the strikethrough snaps on with the flash, and sparks
 * rain off the row.
 */
function playLightning(row: HTMLElement): void {
  const NS = 'http://www.w3.org/2000/svg';
  const FLASH = 430;
  let sky: SVGSVGElement | null = null;
  let arcs: SVGSVGElement | null = null;
  let glow: HTMLElement | null = null;
  let flash: HTMLElement | null = null;
  let lastArc = -100;
  let lastBolt = -100;
  let rained = false;
  const svgPath = (d: string, cls: string) => {
    const p = document.createElementNS(NS, 'path');
    p.setAttribute('d', d);
    p.setAttribute('class', cls);
    return p;
  };

  rowStage(row, 1300, { holdStrike: true, fade: (ms) => dimAt((ms - FLASH) / 600) }, (ms, s) => {
    const [cx, cy] = centerOf(s.cb);
    if (!sky) {
      sky = document.createElementNS(NS, 'svg');
      sky.setAttribute('class', 'gems-bolt-sky');
      arcs = document.createElementNS(NS, 'svg');
      arcs.setAttribute('class', 'gems-bolt-arcs');
      glow = document.createElement('span');
      glow.className = 'gems-bolt-impact';
      flash = document.createElement('div');
      flash.className = 'gems-bolt-flash';
      const clip = document.createElement('div');
      clip.className = 'gems-fx-cliphost';
      clip.append(flash, arcs);
      s.layer.append(clip);
      s.free.append(sky, glow);
      sky.animate([{ opacity: 0 }, { opacity: 1, offset: 0.08 }, { opacity: 0.25, offset: 0.3 }, { opacity: 1, offset: 0.45 }, { opacity: 0.6, offset: 0.7 }, { opacity: 0 }], {
        duration: 380,
        fill: 'forwards',
      });
      glow.animate(
        [
          { transform: 'translate(-50%,-50%) scale(0.2)', opacity: 0 },
          { transform: 'translate(-50%,-50%) scale(1)', opacity: 1, offset: 0.2 },
          { transform: 'translate(-50%,-50%) scale(1.6)', opacity: 0 },
        ],
        { duration: 560, fill: 'forwards' }
      );
      // A burst of sparks at the point of impact.
      for (let i = 0; i < 12; i++) {
        const a = rand(0, Math.PI * 2);
        const v = rand(120, 260);
        particle(s.free, 'gems-bolt-spark', cx, cy, Math.cos(a) * v, Math.sin(a) * v - 60, 700, rand(300, 500), 0.3);
      }
    }
    // The bolt from the sky, re-forked once so it crackles.
    if (ms < 380 && ms - lastBolt > 150) {
      lastBolt = ms;
      const top = Math.max(0, cy - 230);
      sky.replaceChildren();
      const main = bolt([cx + rand(-50, 50), top], [cx, cy], 46);
      const forks = [0.35, 0.6].map((f) => {
        const a = main[Math.floor(main.length * f)];
        return bolt(a, [a[0] + rand(-60, 60), a[1] + rand(25, 60)], 18, 4);
      });
      for (const pts of [main, ...forks]) {
        sky.append(svgPath(polyD(pts), 'gems-bolt-glow'), svgPath(polyD(pts), 'gems-bolt-core'));
      }
    }
    glow!.style.left = `${cx}px`;
    glow!.style.top = `${cy}px`;
    // Electricity crawling across the row, re-drawn every few frames.
    const W = s.rect.width;
    const H = s.rect.height;
    arcs!.setAttribute('viewBox', `0 0 ${W} ${H}`);
    if (ms > 90 && ms < 720 && ms - lastArc > 45) {
      lastArc = ms;
      arcs!.replaceChildren();
      const ox = cx - s.rect.left;
      const oy = cy - s.rect.top;
      const n = ms < FLASH ? 3 : 2;
      for (let i = 0; i < n; i++) {
        const pts = bolt([ox, oy], [rand(W * 0.35, W - 6), rand(4, H - 4)], 16, 4);
        arcs!.append(svgPath(polyD(pts), 'gems-arc-glow'), svgPath(polyD(pts), 'gems-arc-core'));
      }
    } else if (ms >= 720) arcs!.replaceChildren();
    // The row lights up with the strike, then FLASHES as the strikethrough lands.
    const pulse = ms < 120 ? 0 : ms < 260 ? 0.3 * (1 - (ms - 120) / 140) : 0;
    const big = ms < FLASH ? 0 : 0.9 * Math.max(0, 1 - (ms - FLASH) / 330);
    flash!.style.opacity = String(Math.max(pulse, big));
    if (ms >= FLASH) s.strikeHeld = false;
    if (!rained && ms >= FLASH) {
      rained = true;
      for (let i = 0; i < 14; i++) {
        particle(s.free, 'gems-bolt-spark', s.rect.left + rand(20, W - 10), s.rect.top + rand(4, H - 4), rand(-40, 40), rand(-90, 10), 650, rand(450, 750), 0.4);
      }
    }
  });
}

// --- Wildfire: a flame front burns across the row ---------------------------

/**
 * A spark at the checkbox lights a fire that burns across the row with embers
 * rising off it; behind the flame line the task is already crossed off, the
 * burn drawing the strikethrough as it goes.
 */
function playWildfire(row: HTMLElement): void {
  const IGNITE = 120;
  const BURN = 1050;
  const DIE = 280;
  const FLAMES = 8;
  let cover: HTMLElement | null = null;
  let edge: HTMLElement | null = null;
  let scorch: HTMLElement | null = null;
  const flames: { el: HTMLElement; y: number; h: number; w: number; jx: number }[] = [];
  let lastEmber = 0;

  ensureSmokeFilter();
  rowStage(row, IGNITE + BURN + DIE + 700, { clip: true, holdStrike: true, fade: (ms) => dimAt((ms - IGNITE) / (BURN + DIE)) }, (ms, s) => {
    const [cx, cy] = centerOf(s.cb);
    const W = s.rect.width;
    const H = s.rect.height;
    if (!cover) {
      cover = rowCover(row);
      scorch = document.createElement('div');
      scorch.className = 'gems-fire-scorch';
      edge = document.createElement('div');
      edge.className = 'gems-fire-edge';
      s.layer.append(scorch, cover, edge);
      const flare = document.createElement('span');
      flare.className = 'gems-fire-flare';
      flare.style.left = `${cx}px`;
      flare.style.top = `${cy}px`;
      s.free.append(flare);
      flare.animate(
        [
          { transform: 'translate(-50%,-50%) scale(0.2)', opacity: 0 },
          { transform: 'translate(-50%,-50%) scale(1.2)', opacity: 1, offset: 0.4 },
          { transform: 'translate(-50%,-50%) scale(0.6)', opacity: 0 },
        ],
        { duration: 320, fill: 'forwards' }
      ).onfinish = () => flare.remove();
      for (let i = 0; i < FLAMES; i++) {
        const el = document.createElement('span');
        el.className = `gems-flame${i % 3 === 0 ? ' back' : ''}`;
        el.style.animationDelay = `${-rand(0, 400)}ms`;
        el.style.animationDuration = `${rand(180, 300)}ms`;
        // A ragged wall of short tongues along the fire line, not one tall column.
        const h = rand(H * 0.3, H * 0.5) * (i % 3 === 0 ? 1.35 : 1);
        flames.push({ el, y: (H * (i + 0.7)) / FLAMES + rand(-3, 3), h, w: h * rand(0.55, 0.75), jx: rand(-12, 6) });
        s.free.append(el);
      }
    }
    // Where the fire line is, in row coordinates.
    const startX = cx - s.rect.left;
    const k = clamp01((ms - IGNITE) / BURN);
    const front = startX + (W + 16 - startX) * (k < 0.5 ? 2 * k * k : 1 - (-2 * k + 2) ** 2 / 2) * 0.35 + (W + 16 - startX) * k * 0.65;
    cover.style.clipPath = `inset(0 0 0 ${Math.max(0, front).toFixed(1)}px round var(--radius))`;
    edge!.style.left = `${(front - 22).toFixed(1)}px`;
    edge!.style.opacity = String(ms < IGNITE ? ms / IGNITE : k < 1 ? 1 : Math.max(0, 1 - (ms - IGNITE - BURN) / DIE));
    scorch!.style.width = `${Math.max(0, front).toFixed(1)}px`;
    scorch!.style.opacity = String(Math.max(0, 1 - Math.max(0, ms - IGNITE - BURN) / (DIE + 500)));
    const frontX = s.rect.left + front;
    s.paintStrike((l) => frontX - 6 - l.left);
    // Flames ride the fire line, growing in, dying out at the far edge.
    const size = ms < IGNITE ? ms / IGNITE : k < 1 ? 1 : Math.max(0, 1 - (ms - IGNITE - BURN) / DIE);
    for (const f of flames) {
      const h = f.h * size;
      f.el.style.width = `${(f.w * Math.max(size, 0.01)).toFixed(1)}px`;
      f.el.style.height = `${h.toFixed(1)}px`;
      f.el.style.left = `${(Math.min(frontX, s.rect.right) + f.jx - (f.w * size) / 2).toFixed(1)}px`;
      f.el.style.top = `${(s.rect.top + f.y - h * 0.85).toFixed(1)}px`;
    }
    // Embers and a little smoke off the fire line.
    if (size > 0.2 && ms - lastEmber > 28) {
      lastEmber = ms;
      for (let i = 0; i < 2; i++) {
        particle(s.free, 'gems-ember', Math.min(frontX, s.rect.right) + rand(-8, 4), s.rect.top + rand(0, H), rand(-25, 25), rand(-120, -50), -40, rand(600, 1000), 0.3);
      }
      if (Math.random() < 0.35) smokeWisp(s.free, Math.min(frontX, s.rect.right) - rand(4, 14), s.rect.top + rand(0, H * 0.4), rand(10, 18), rand(800, 1100), rand(-10, 10), rand(30, 55), true);
    }
  });
}

// --- Black Hole: the task is pulled in, then comes back crossed off ----------

/**
 * A black hole opens behind the checkbox and eats the task: the title's
 * letters spiral in, the rest of the row is dragged after them, then the card
 * itself is stretched into it. It collapses and detonates in a multicolor
 * shockwave that shakes the list, and the crossed-off task is back.
 *
 * Gabe, 10/3: slower, a bigger hole, let it swallow EVERYTHING before it goes
 * off, and make the ending far bigger than a ripple: it's the priciest effect.
 */
function playBlackHole(row: HTMLElement): void {
  const PULL = 120; // let the list re-render first
  const SPREAD = 650; // nearest letter falls first, the farthest this much later
  const FALL = 900; // one letter's fall
  const REST_AT = 520;
  const REST_DUR = 950;
  const CARD_AT = 1480;
  const CARD_DUR = 470;
  const COLLAPSE = 2050;
  const END = COLLAPSE + 1050;
  let cover: HTMLElement | null = null;
  let hole: HTMLElement | null = null;
  let pulled = false;
  let swallowed = false;
  let collapsed = false;

  // The real row stays hidden while the cover is eaten (so nothing shows
  // through), and is back in its finished gray the moment the hole goes off.
  const opts: StageOpts = { fade: (ms) => (ms < COLLAPSE ? 0 : DONE_DIM), boxFade: (ms) => dimAt((ms - COLLAPSE) / 400) };
  rowStage(row, END, opts, (ms, s) => {
    const [hx, hy] = centerOf(s.cb);
    if (!cover) {
      cover = rowCover(row);
      s.layer.append(cover);
      const D = Math.max(76, Math.min(130, s.rect.height * 2.1));
      hole = document.createElement('div');
      hole.className = 'gems-bh';
      hole.style.width = hole.style.height = `${D}px`;
      hole.innerHTML = `<span class="gems-bh-glow"></span><span class="gems-bh-ring"></span><span class="gems-bh-core"></span>`;
      s.free.append(hole);
      hole.animate(
        [
          { transform: 'translate(-50%,-50%) scale(0)' },
          { transform: 'translate(-50%,-50%) scale(1.05)', offset: 450 / COLLAPSE },
          { transform: 'translate(-50%,-50%) scale(1.2)', offset: (COLLAPSE - 230) / COLLAPSE },
          { transform: 'translate(-50%,-50%) scale(1.4)', offset: (COLLAPSE - 120) / COLLAPSE },
          { transform: 'translate(-50%,-50%) scale(0)' },
        ],
        { duration: COLLAPSE, easing: 'ease-in-out', fill: 'forwards' }
      );
      // The card darkens as the hole drinks the light out of it.
      cover.animate([{ filter: 'brightness(1)' }, { filter: 'brightness(0.45)' }], { duration: 1200, delay: 300, fill: 'both' });
    }
    hole!.style.left = `${hx}px`;
    hole!.style.top = `${hy}px`;

    if (!pulled && ms >= PULL) {
      pulled = true;
      // Each title letter, lifted out at its exact spot, then spiralled in.
      const title = cover.querySelector<HTMLElement>('.task-title');
      const text = title?.firstChild;
      if (title && text && text.nodeType === Node.TEXT_NODE) {
        // Copied out now: a computed style is live, and the title is hidden below.
        const live = getComputedStyle(title);
        const cs = {
          fontFamily: live.fontFamily,
          fontSize: live.fontSize,
          fontWeight: live.fontWeight,
          letterSpacing: live.letterSpacing,
          color: live.color,
        };
        const range = document.createRange();
        const letters: { ch: string; r: DOMRect }[] = [];
        const str = text.textContent ?? '';
        for (let i = 0; i < str.length; i++) {
          if (!str[i].trim()) continue;
          range.setStart(text, i);
          range.setEnd(text, i + 1);
          const r = range.getBoundingClientRect();
          if (r.width) letters.push({ ch: str[i], r });
        }
        title.style.color = 'transparent';
        const maxR = Math.max(1, ...letters.map((l) => Math.hypot(l.r.left - hx, l.r.top - hy)));
        for (const l of letters) {
          const span = document.createElement('span');
          span.className = 'gems-bh-letter';
          span.textContent = l.ch;
          span.style.cssText =
            `left:${l.r.left}px;top:${l.r.top}px;font-family:${cs.fontFamily};font-size:${cs.fontSize};` +
            `font-weight:${cs.fontWeight};letter-spacing:${cs.letterSpacing};color:${cs.color};line-height:${l.r.height}px;`;
          s.free.append(span);
          const lx = l.r.left + l.r.width / 2;
          const ly = l.r.top + l.r.height / 2;
          const r0 = Math.hypot(lx - hx, ly - hy);
          const a0 = Math.atan2(ly - hy, lx - hx);
          const spin = -3.4;
          const n = 30;
          span.animate(
            Array.from({ length: n + 1 }, (_, i) => {
              const k = (i / n) ** 1.7; // a slow drift that accelerates as it falls in
              const r = r0 * (1 - k);
              const a = a0 + spin * k;
              return {
                transform:
                  `translate(${(hx + r * Math.cos(a) - lx).toFixed(1)}px, ${(hy + r * Math.sin(a) - ly).toFixed(1)}px) ` +
                  `rotate(${(spin * k * 57).toFixed(0)}deg) scale(${(1 - 0.92 * k).toFixed(3)}, ${(1 - 0.75 * k).toFixed(3)})`,
                opacity: k > 0.88 ? (1 - k) / 0.12 : 1,
              };
            }),
            { duration: FALL, delay: (r0 / maxR) * SPREAD, fill: 'both' }
          );
        }
      }
      // The rest of the row (course, date, buttons) is dragged in after them.
      const rest = cover.querySelector<HTMLElement>('.task-bottom-row');
      if (rest) {
        const rr = rest.getBoundingClientRect();
        const dx = hx - (rr.left + rr.width / 2);
        const dy = hy - (rr.top + rr.height / 2);
        rest.animate(
          [
            { transform: 'translate(0,0) scale(1) skewX(0deg)', opacity: 1 },
            { transform: `translate(${dx * 0.25}px, ${dy * 0.25}px) scale(0.8, 0.65) skewX(16deg)`, opacity: 1, offset: 0.45 },
            { transform: `translate(${dx}px, ${dy}px) scale(0.04) skewX(45deg) rotate(-40deg)`, opacity: 0 },
          ],
          { duration: REST_DUR, delay: REST_AT - PULL, easing: 'ease-in', fill: 'both' }
        );
      }
    }

    // Last, the emptied card itself is stretched into the hole.
    if (!swallowed && ms >= CARD_AT) {
      swallowed = true;
      cover.style.transformOrigin = `${hx - s.rect.left}px ${hy - s.rect.top}px`;
      cover.animate(
        [
          { transform: 'scale(1) rotate(0deg)', opacity: 1 },
          { transform: 'scale(0.55, 0.3) rotate(-14deg)', opacity: 0.9, offset: 0.5 },
          { transform: 'scale(0.02, 0.01) rotate(-40deg)', opacity: 0 },
        ],
        { duration: CARD_DUR, easing: 'ease-in', fill: 'forwards' }
      );
    }

    if (!collapsed && ms >= COLLAPSE) {
      collapsed = true;
      cover.remove();
      detonate(s, hx, hy);
    }
  });
}

const BH_COLORS = ['#ffd27a', '#ff7a3d', '#ff6f91', '#c792ff', '#7db4ff', '#6ee7a0', '#ffffff'];

/** The Black Hole's ending: a white-hot core, three multicolor shockwave rings,
 *  a spray of colored sparks, a color wash over the row, and a shake. */
function detonate(s: Stage, x: number, y: number): void {
  const at = (cls: string) => {
    const el = document.createElement('span');
    el.className = cls;
    el.style.left = `${x}px`;
    el.style.top = `${y}px`;
    s.free.append(el);
    return el;
  };
  at('gems-bh-core-flash').animate(
    [
      { transform: 'translate(-50%,-50%) scale(0.2)', opacity: 1 },
      { transform: 'translate(-50%,-50%) scale(2.6)', opacity: 0.9, offset: 0.3 },
      { transform: 'translate(-50%,-50%) scale(3.4)', opacity: 0 },
    ],
    { duration: 520, easing: 'ease-out', fill: 'forwards' }
  );
  [
    { cls: 'gems-bh-wave', delay: 0, scale: 13, dur: 820 },
    { cls: 'gems-bh-wave thin', delay: 90, scale: 10, dur: 760 },
    { cls: 'gems-bh-wave warm', delay: 180, scale: 7.5, dur: 700 },
  ].forEach((w) => {
    at(w.cls).animate(
      [
        { transform: 'translate(-50%,-50%) scale(0.3) rotate(0deg)', opacity: 1 },
        { transform: `translate(-50%,-50%) scale(${w.scale}) rotate(120deg)`, opacity: 0 },
      ],
      { duration: w.dur, delay: w.delay, easing: 'cubic-bezier(.15,.7,.3,1)', fill: 'both' }
    );
  });
  for (let i = 0; i < 48; i++) {
    const a = (i / 48) * Math.PI * 2 + rand(-0.08, 0.08);
    const v = rand(170, 400);
    const p = particle(s.free, 'gems-firework-spark', x, y, Math.cos(a) * v, Math.sin(a) * v, 220, rand(650, 1050), 0.4);
    p.style.background = p.style.color = BH_COLORS[i % BH_COLORS.length];
  }
  // A wash of color across the row from the blast point.
  const wash = document.createElement('div');
  wash.className = 'gems-bh-wash';
  wash.style.setProperty('--bx', `${x - s.rect.left}px`);
  wash.style.setProperty('--by', `${y - s.rect.top}px`);
  const clip = document.createElement('div');
  clip.className = 'gems-fx-cliphost';
  clip.append(wash);
  s.layer.append(clip);
  wash.animate([{ opacity: 0.85 }, { opacity: 0 }], { duration: 600, easing: 'ease-out', fill: 'forwards' });
  // The task pops back out, and the whole list takes the hit.
  s.row.classList.remove('gems-pop');
  void s.row.offsetWidth;
  s.row.classList.add('gems-pop');
  const popped = s.row;
  setTimeout(() => popped.classList.remove('gems-pop'), 700);
  const host = s.row.parentElement ?? s.row;
  host.animate(
    [
      { translate: '0 0' },
      { translate: '-7px 3px' },
      { translate: '6px -4px' },
      { translate: '-5px 2px' },
      { translate: '4px -2px' },
      { translate: '-2px 1px' },
      { translate: '1px 0' },
      { translate: '0 0' },
    ],
    { duration: 460, easing: 'ease-out' }
  );
}

// --- checkbox effects ---------------------------------------------------------

const CONFETTI_COLORS = ['#7db4ff', '#ffd25b', '#ff6f91', '#6ee7a0', '#c792ff'];

function playConfetti(row: HTMLElement): void {
  const burst = burstAnchor(checkboxOf(row), 'gems-confetti-burst', 900);
  for (let i = 0; i < 16; i++) {
    const piece = document.createElement('span');
    piece.className = 'gems-confetti-piece';
    const angle = Math.random() * 360 - 180;
    const dist = 40 + Math.random() * 55;
    const rad = (angle * Math.PI) / 180;
    piece.style.setProperty('--dx', `${(Math.cos(rad) * dist).toFixed(1)}px`);
    piece.style.setProperty('--dy', `${(Math.sin(rad) * dist - 18).toFixed(1)}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 480 - 240)}deg`);
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;
    burst.append(piece);
  }
}

/** A sparkler: a fountain of hot sparks sprays up out of the checkbox and
 *  arcs back down, with a flickering glow at its heart (Gabe, 10/3: the
 *  checkbox tier's top step, a little more intense than Smoke Puff). */
function playSparkler(row: HTMLElement): void {
  const box = checkboxOf(row);
  const burst = burstAnchor(box, 'gems-confetti-burst', 1700);
  const core = document.createElement('span');
  core.className = 'gems-sparkler-core';
  burst.append(core);
  core.animate(
    [
      { transform: 'translate(-50%,-50%) scale(0.3)', opacity: 0 },
      { transform: 'translate(-50%,-50%) scale(1.1)', opacity: 1, offset: 0.1 },
      { transform: 'translate(-50%,-50%) scale(0.85)', opacity: 0.8, offset: 0.3 },
      { transform: 'translate(-50%,-50%) scale(1.15)', opacity: 1, offset: 0.5 },
      { transform: 'translate(-50%,-50%) scale(0.9)', opacity: 0.8, offset: 0.75 },
      { transform: 'translate(-50%,-50%) scale(0.2)', opacity: 0 },
    ],
    { duration: 950, fill: 'forwards' }
  );
  let last = -20;
  runFrames(
    800,
    (ms) => {
      if (ms - last < 16) return;
      last = ms;
      for (let i = 0; i < 3; i++) {
        const a = -Math.PI / 2 + rand(-1.25, 1.25);
        const v = rand(130, 300);
        const vx = Math.cos(a) * v;
        const vy = Math.sin(a) * v;
        const p = particle(burst, `gems-spark${Math.random() < 0.35 ? ' white' : ''}`, 0, 0, vx, vy, 720, rand(320, 620), 0.45);
        p.style.setProperty('--tilt', `${Math.atan2(vy, vx)}rad`);
      }
    },
    () => {}
  );
}

// Faceted gem, four shades of brand blue: crown, table, pavilion, highlight.
const GEM_SHADES = [
  ['#eaf5ff', '#a8d6ff', '#6aa8f5', '#2f62c4'],
  ['#f2f9ff', '#bfe3ff', '#7db4ff', '#3a6fd0'],
  ['#e2f0ff', '#93c6ff', '#5a9bef', '#25539f'],
];
const gemSvg = ([c0, c1, c2, c3]: string[]) =>
  `<svg viewBox="0 0 24 22" aria-hidden="true">` +
  `<polygon points="6,1 18,1 23,7 1,7" fill="${c1}"/>` +
  `<polygon points="6,1 18,1 15,7 9,7" fill="${c0}"/>` +
  `<polygon points="1,7 23,7 12,21" fill="${c2}"/>` +
  `<polygon points="9,7 15,7 12,21" fill="${c1}"/>` +
  `<polygon points="1,7 9,7 12,21" fill="${c3}"/>` +
  `<polygon points="7.5,2 10.5,2 9,5" fill="#fff" opacity="0.85"/>` +
  `<polygon points="1,7 6,1 18,1 23,7 12,21" fill="none" stroke="#fff" stroke-opacity="0.45" stroke-width="0.6" stroke-linejoin="round"/>` +
  `</svg>`;

/** Gabe, 10/2: real-looking gems, much bigger than confetti, that pop out of
 *  the checkbox and FALL to the bottom of the screen. */
function playGemFall(row: HTMLElement): void {
  const cb = checkboxOf(row).getBoundingClientRect();
  const startY = cb.top + cb.height / 2;
  const fall = window.innerHeight - startY + 50; // until fully off the bottom
  const G = 1500;
  let longest = 0;
  const burst = burstAnchor(checkboxOf(row), 'gems-confetti-burst', 4000);
  for (let i = 0; i < 12; i++) {
    const gem = document.createElement('span');
    gem.className = 'gems-fall-gem';
    const size = Math.round(rand(16, 30));
    gem.style.width = `${size}px`;
    gem.style.height = `${Math.round(size * 0.92)}px`;
    gem.style.marginLeft = `${-size / 2}px`;
    gem.style.marginTop = `${-size / 2}px`;
    gem.style.animationDelay = `${Math.round(rand(0, 400))}ms`;
    gem.innerHTML = gemSvg(GEM_SHADES[i % GEM_SHADES.length]);
    burst.append(gem);
    const vx = rand(-170, 170);
    const vy = rand(-430, -230);
    const spin = rand(-420, 420);
    const t = (-vy + Math.sqrt(vy * vy + 2 * G * fall)) / G;
    const dur = t * 1000;
    const delay = rand(0, 90);
    longest = Math.max(longest, dur + delay);
    gem.animate(
      flightFrames(dur, (s) => [vx * s, vy * s + 0.5 * G * s * s], (s) => `rotate(${(spin * s).toFixed(1)}deg)`),
      { duration: dur, delay, fill: 'both' }
    );
  }
  setTimeout(() => burst.remove(), longest + 100);
}

/** Wispy displacement filter that turns soft blobs into smoke. Added once. */
function ensureSmokeFilter(): void {
  if (document.getElementById('gems-smoke-filter')) return;
  const holder = document.createElement('div');
  holder.style.cssText = 'position:absolute;width:0;height:0;overflow:hidden;';
  holder.innerHTML =
    `<svg width="0" height="0" aria-hidden="true"><filter id="gems-smoke-filter" x="-60%" y="-60%" width="220%" height="220%">` +
    `<feTurbulence type="fractalNoise" baseFrequency="0.05" numOctaves="3" seed="4" result="noise"/>` +
    `<feDisplacementMap in="SourceGraphic" in2="noise" scale="18" xChannelSelector="R" yChannelSelector="G"/>` +
    `<feGaussianBlur stdDeviation="0.7"/></filter></svg>`;
  document.body.append(holder);
}

/** One rising smoke wisp at client point (x, y), used by Rocket and Wildfire. */
function smokeWisp(host: HTMLElement, x: number, y: number, size: number, dur: number, drift: number, rise: number, dark = false): void {
  const p = document.createElement('span');
  p.className = `gems-smoke-puff${dark ? ' dark' : ''}`;
  p.style.cssText = `left:${x}px;top:${y}px;width:${size}px;height:${size}px;margin-left:${-size / 2}px;margin-top:${-size / 2}px;`;
  host.append(p);
  p.animate(
    [
      { transform: 'scale(0.4)', opacity: 0 },
      { transform: `translate(${drift * 0.3}px, ${-rise * 0.2}px) scale(1)`, opacity: 0.75, offset: 0.15 },
      { transform: `translate(${drift}px, ${-rise}px) scale(2.2)`, opacity: 0 },
    ],
    { duration: dur, easing: 'ease-out', fill: 'forwards' }
  ).onfinish = () => p.remove();
}

/** Gabe, 10/2: more like real smoke, more detail, lasts longer. A low burst of
 *  billows at the checkbox, then wisps that curl upward, swell, and thin out. */
function playSmokePuff(row: HTMLElement): void {
  ensureSmokeFilter();
  const burst = burstAnchor(checkboxOf(row), 'gems-confetti-burst', 2900);
  const puff = (base: boolean, i: number) => {
    const p = document.createElement('span');
    p.className = `gems-smoke-puff${i % 3 === 0 ? ' dark' : ''}`;
    const size = Math.round(base ? rand(20, 30) : rand(22, 42));
    p.style.width = p.style.height = `${size}px`;
    p.style.marginLeft = p.style.marginTop = `${-size / 2}px`;
    burst.append(p);
    const dx = base ? rand(-38, 38) : rand(-22, 22);
    const rise = base ? rand(4, 18) : rand(55, 115);
    const curl = rand(-26, 26);
    const dur = base ? rand(1300, 1700) : rand(1900, 2500);
    p.animate(
      [
        { transform: 'translate(0,0) scale(0.25) rotate(0deg)', opacity: 0 },
        { transform: `translate(${dx * 0.5}px,${-rise * 0.15}px) scale(0.8) rotate(${curl * 0.5}deg)`, opacity: 0.9, offset: 0.12 },
        { transform: `translate(${dx + curl * 0.5}px,${-rise * 0.6}px) scale(1.5) rotate(${curl * 2}deg)`, opacity: 0.55, offset: 0.55 },
        { transform: `translate(${dx + curl}px,${-rise}px) scale(${rand(1.9, 2.6).toFixed(2)}) rotate(${curl * 3}deg)`, opacity: 0 },
      ],
      { duration: dur, delay: base ? rand(0, 80) : rand(60, 360), easing: 'cubic-bezier(.2,.6,.35,1)', fill: 'both' }
    );
  };
  for (let i = 0; i < 6; i++) puff(true, i);
  for (let i = 0; i < 10; i++) puff(false, i);
}

/** Bubbles drift up out of the checkbox, wobbling, and pop one by one
 *  (Gabe, 10/3: added to fill the checkbox tier, between Ripple and Starburst). */
function playBubbles(row: HTMLElement): void {
  const burst = burstAnchor(checkboxOf(row), 'gems-confetti-burst', 1900);
  for (let i = 0; i < 9; i++) {
    const b = document.createElement('span');
    b.className = 'gems-bubble';
    const size = Math.round(rand(7, 17));
    b.style.width = b.style.height = `${size}px`;
    b.style.marginLeft = b.style.marginTop = `${-size / 2}px`;
    burst.append(b);
    const dx = rand(-34, 34);
    const rise = rand(40, 95);
    const wob = rand(6, 12) * (Math.random() < 0.5 ? -1 : 1);
    const dur = rand(900, 1500);
    b.animate(
      [
        { transform: 'translate(0,0) scale(0.2)', opacity: 0 },
        { transform: `translate(${dx * 0.3 + wob}px,${-rise * 0.3}px) scale(1)`, opacity: 1, offset: 0.25 },
        { transform: `translate(${dx * 0.7 - wob}px,${-rise * 0.7}px) scale(1)`, opacity: 1, offset: 0.7 },
        { transform: `translate(${dx}px,${-rise}px) scale(1)`, opacity: 1, offset: 0.9 },
        // the pop
        { transform: `translate(${dx}px,${-rise}px) scale(1.6)`, opacity: 0 },
      ],
      { duration: dur, delay: rand(0, 220), easing: 'ease-out', fill: 'both' }
    );
  }
}

/** A quick radial pop of light rays from the checkbox center. */
function playStarburstPulse(row: HTMLElement): void {
  const burst = burstAnchor(checkboxOf(row), 'gems-starburst-burst', 500);
  for (let i = 0; i < 10; i++) {
    const ray = document.createElement('span');
    ray.className = 'gems-starburst-ray';
    ray.style.setProperty('--angle', `${Math.round((i / 10) * 360)}deg`);
    ray.style.animationDelay = `${Math.round(Math.random() * 40)}ms`;
    burst.append(ray);
  }
}

/** A soft ring expands outward from the checkbox and fades, like a drop in
 *  water — calmer than the others on purpose (Gabe, 9/30/26's draft list). */
function playRipple(row: HTMLElement): void {
  const burst = burstAnchor(checkboxOf(row), 'gems-ripple-burst', 700);
  const ring = document.createElement('span');
  ring.className = 'gems-ripple-ring';
  burst.append(ring);
}
