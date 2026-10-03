// Cobalt: Store — the checkoff effects themselves, with no app dependencies.
//
// Split out of cosmetics.ts (10/2) so the standalone checkoff test page
// (labs/checkoffLab.ts) can play the EXACT code the app plays, without
// dragging in the database and Gems modules. cosmetics.ts decides WHETHER an
// effect plays (equipped item, non-manual task); this file decides WHAT plays.
//
// TWO FAMILIES (Gabe, 10/2):
// - Checkbox effects (Confetti, Gem Burst, Smoke Puff, Starburst, Ripple) all
//   start from the CENTER of the checkbox. Ripple was the model.
// - Row effects (Gold Flash, Light Sweep) cover everything EXCEPT the checkbox,
//   so the check shows the instant it's pressed, and the crossed-off task is
//   what they reveal. They are the priciest tier.

/** Plays checkoff effect `id` over `row`. Unknown ids do nothing. A new effect
 *  needs a case here and a catalog entry in checkoffArt.ts; the test page picks
 *  it up from the catalog on its next build. */
export function playCheckoffById(id: string, row: HTMLElement): void {
  if (reducedMotion()) return;
  switch (id) {
    case 'confetti':
      return playConfetti(row);
    case 'goldflash':
      return playGoldIngot(row);
    case 'gemburst':
      return playGemFall(row);
    case 'smokepuff':
      return playSmokePuff(row);
    case 'lightsweep':
      return playLightSweep(row);
    case 'starburst':
      return playStarburstPulse(row);
    case 'ripple':
      return playRipple(row);
  }
}

const reducedMotion = () => matchMedia('(prefers-reduced-motion: reduce)').matches;
const rand = (a: number, b: number) => a + Math.random() * (b - a);

/** The checkbox inside a task row, if findable — falls back to the row itself
 *  so a markup change elsewhere can't make these effects throw. */
function checkboxOf(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>('.task-cb') ?? row;
}

/** A zero-size fixed anchor at the CENTER of `anchorEl`, appended to <body> so
 *  particles can fly past the row's bounds, auto-removed after `life` ms. */
function burstAnchor(anchorEl: HTMLElement, className: string, life: number): HTMLElement {
  const r = anchorEl.getBoundingClientRect();
  const burst = document.createElement('div');
  burst.className = className;
  burst.style.cssText = `left:${(r.left + r.width / 2).toFixed(1)}px;top:${(r.top + r.height / 2).toFixed(1)}px;`;
  document.body.append(burst);
  setTimeout(() => burst.remove(), life);
  return burst;
}

/** Turns a physics path into Web Animations keyframes (one every ~25ms). */
function flightFrames(
  dur: number,
  pos: (t: number) => [number, number],
  extra: (t: number) => string = () => '',
  opacity: (t: number) => number = () => 1
): Keyframe[] {
  const n = Math.max(8, Math.ceil(dur / 25));
  return Array.from({ length: n + 1 }, (_, i) => {
    const t = (i / n) * (dur / 1000);
    const [x, y] = pos(t);
    return { transform: `translate(${x.toFixed(1)}px, ${y.toFixed(1)}px) ${extra(t)}`, opacity: opacity(i / n) };
  });
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

/** Where a row effect starts: just past the checkbox, so the check stays visible. */
function rowInset(row: HTMLElement): number {
  const box = checkboxOf(row);
  if (box === row) return 0;
  return Math.max(0, box.getBoundingClientRect().right - row.getBoundingClientRect().left + 6);
}

/** Runs `frame` every animation frame for `dur` ms with t in 0..1, then `done`. */
function runFrames(dur: number, frame: (t: number) => void, done: () => void): void {
  const start = performance.now();
  const tick = (now: number) => {
    const t = Math.min(1, (now - start) / dur);
    frame(t);
    if (t < 1) requestAnimationFrame(tick);
    else done();
  };
  requestAnimationFrame(tick);
}

// --- Gold Flash: the row becomes a gold ingot, cracks, and shatters ----------

/**
 * Gabe, 10/2: "the whole thing turned into a gold ingot for a second with
 * engravings on it", then it literally breaks, and behind it is the crossed-off
 * task. Everything but the checkbox becomes solid gold with the task's text
 * engraved in black; cracks run across it from the checkbox side; it shatters
 * into falling pieces that uncover the real, now crossed-off row.
 */
function playGoldIngot(row: HTMLElement): void {
  const track = rowTracker(row);
  const r0 = row.getBoundingClientRect();
  const inset = rowInset(row);
  const W = r0.width - inset;
  const H = r0.height;
  if (W < 20 || H < 10) return;

  const root = document.createElement('div');
  root.className = 'gems-fx';
  document.body.append(root);
  const place = () => {
    const { rect } = track();
    root.style.cssText = `left:${rect.left + inset}px;top:${rect.top}px;width:${W}px;height:${H}px;`;
  };
  place();

  // The ingot face: the row's own content, engraved into gold.
  const makeIngot = (): HTMLElement => {
    const ingot = document.createElement('div');
    ingot.className = 'gems-ingot';
    const face = row.cloneNode(true) as HTMLElement;
    face.removeAttribute('data-task-id');
    face.className = `${face.className.replace(/\bcompleted\b/, '')} gems-ingot-face`;
    face.style.cssText = `position:absolute;left:${-inset}px;top:0;width:${r0.width}px;height:${H}px;margin:0;`;
    ingot.append(face);
    return ingot;
  };
  const ingot = makeIngot();
  root.append(ingot);
  ingot.animate(
    [
      { opacity: 0, filter: 'brightness(1.9)' },
      { opacity: 1, filter: 'brightness(1.35)', offset: 0.4 },
      { opacity: 1, filter: 'brightness(1)' },
    ],
    { duration: 260, easing: 'ease-out' }
  );
  // One glint across the polished face while it holds.
  ingot.animate([{ backgroundPosition: '170% 0, 0 0' }, { backgroundPosition: '-70% 0, 0 0' }], {
    duration: 520,
    delay: 200,
    easing: 'ease-in-out',
    fill: 'both',
  });

  // Crack geometry. Jagged vertical cracks meet one jagged horizontal crack, so
  // the pieces tile the ingot exactly and every crack is a real piece edge.
  const cols = Math.max(4, Math.min(8, Math.round(W / 70)));
  type P = [number, number];
  const cracks: P[][] = [];
  for (let i = 0; i <= cols; i++) {
    const edge = i === 0 || i === cols;
    const x = edge ? (i === 0 ? 0 : W) : (W * i) / cols + rand(-10, 10);
    const j = (s: number) => (edge ? x : x + rand(-s, s));
    const midY = H * 0.5 + (edge ? 0 : rand(-H * 0.12, H * 0.12));
    cracks.push([
      [j(6), 0],
      [j(9), midY * 0.5],
      [edge ? x : x + rand(-4, 4), midY],
      [j(9), midY + (H - midY) * 0.5],
      [j(6), H],
    ]);
  }
  const shards: P[][] = [];
  for (let c = 0; c < cols; c++) {
    const L = cracks[c];
    const R = cracks[c + 1];
    shards.push([L[0], L[1], L[2], R[2], R[1], R[0]]);
    shards.push([L[2], L[3], L[4], R[4], R[3], R[2]]);
  }

  const NS = 'http://www.w3.org/2000/svg';
  const svg = document.createElementNS(NS, 'svg');
  svg.setAttribute('class', 'gems-ingot-cracks');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  const pathD = (pts: P[]) => 'M' + pts.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' L');
  const crackPaths: { d: string; delay: number }[] = [];
  for (let i = 1; i < cols; i++) crackPaths.push({ d: pathD(cracks[i]), delay: 640 + i * 45 });
  crackPaths.push({ d: pathD(cracks.map((k) => k[2])), delay: 660 });
  for (const { d, delay } of crackPaths) {
    for (const [cls, dx] of [['lit', 0.8], ['dark', 0]] as const) {
      const p = document.createElementNS(NS, 'path');
      p.setAttribute('d', d);
      p.setAttribute('pathLength', '1');
      p.setAttribute('class', `gems-crack-${cls}`);
      if (dx) p.setAttribute('transform', `translate(${dx} ${dx})`);
      svg.append(p);
      p.animate([{ strokeDashoffset: 1 }, { strokeDashoffset: 0 }], {
        duration: 220,
        delay,
        easing: 'ease-out',
        fill: 'both',
      });
    }
  }
  root.append(svg);

  const SHATTER = 1000;
  const END = 1900;
  runFrames(END, (t) => {
    place();
    if (t * END >= SHATTER && ingot.isConnected) shatter();
  }, () => root.remove());

  function shatter(): void {
    ingot.remove();
    svg.remove();
    for (const poly of shards) {
      const piece = makeIngot();
      piece.style.clipPath = `polygon(${poly.map((p) => `${p[0].toFixed(1)}px ${p[1].toFixed(1)}px`).join(',')})`;
      const cx = poly.reduce((s, p) => s + p[0], 0) / poly.length;
      const cy = poly.reduce((s, p) => s + p[1], 0) / poly.length;
      piece.style.transformOrigin = `${cx}px ${cy}px`;
      root.append(piece);
      // Pieces pop up and away from the checkbox side, then fall.
      const vx = rand(-30, 70) + (cx / W) * 90;
      const vy = rand(-170, -60) + (cy > H / 2 ? 60 : 0);
      const spin = rand(-260, 260);
      const dur = rand(700, 880);
      piece.animate(
        flightFrames(
          dur,
          (s) => [vx * s, vy * s + 0.5 * 1500 * s * s],
          (s) => `rotate(${(spin * s).toFixed(1)}deg)`,
          (k) => (k < 0.55 ? 1 : 1 - (k - 0.55) / 0.45)
        ),
        { duration: dur, fill: 'forwards' }
      );
    }
  }
}

// --- Light Sweep: the sweep draws the strikethrough -------------------------

/**
 * Gabe, 10/2: the check shows at once, the light crosses everything else, and
 * "the light sweep itself directs the strikethrough". The real strikethrough is
 * held invisible while a drawn one grows behind the light's leading edge, then
 * the real one takes over the instant the sweep ends, with no gap.
 */
function playLightSweep(row: HTMLElement): void {
  const track = rowTracker(row);
  const inset = rowInset(row);
  const BAND = 90;
  const DUR = 1250;

  const root = document.createElement('div');
  root.className = 'gems-fx gems-sweep-clip';
  const band = document.createElement('div');
  band.className = 'gems-sweep-band';
  root.append(band);
  const strikes = document.createElement('div');
  strikes.className = 'gems-fx';
  strikes.style.cssText = 'left:0;top:0;width:0;height:0;';
  document.body.append(root, strikes);

  const ease = (t: number) => 0.5 - Math.cos(Math.PI * t) / 2;
  let last: HTMLElement | null = null;

  runFrames(
    DUR,
    (t) => {
      const { row: cur, rect } = track();
      if (last && last !== cur) last.classList.remove('gems-strike-hold');
      cur.classList.add('gems-strike-hold');
      last = cur;

      const w = rect.width - inset;
      root.style.cssText = `left:${rect.left + inset}px;top:${rect.top}px;width:${w}px;height:${rect.height}px;`;
      const bx = -BAND + (w + BAND * 2) * ease(t);
      band.style.transform = `translateX(${bx.toFixed(1)}px) skewX(-20deg)`;
      const lightX = rect.left + inset + bx + BAND * 0.5; // the band's bright center

      // One drawn strike per line of the title, grown up to the light.
      const title = cur.querySelector<HTMLElement>('.task-title');
      if (!title) return;
      const range = document.createRange();
      range.selectNodeContents(title);
      const lines = [...range.getClientRects()].filter((r) => r.width > 1);
      const cs = getComputedStyle(title);
      const thick = Math.max(1, Math.round(parseFloat(cs.fontSize) / 12));
      while (strikes.children.length < lines.length) {
        const s = document.createElement('span');
        s.className = 'gems-sweep-strike';
        strikes.append(s);
      }
      lines.forEach((ln, i) => {
        const s = strikes.children[i] as HTMLElement;
        const width = Math.max(0, Math.min(ln.width, lightX - ln.left));
        s.style.cssText =
          `left:${ln.left}px;top:${(ln.top + ln.height * 0.56 - thick / 2).toFixed(1)}px;` +
          `width:${width.toFixed(1)}px;height:${thick}px;background:${cs.color};`;
      });
    },
    () => {
      last?.classList.remove('gems-strike-hold');
      root.remove();
      strikes.remove();
    }
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
