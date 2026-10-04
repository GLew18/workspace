// Cobalt: Store — Cobalt Gem Alternatives artwork.
//
// SAME SLOT AS THE DEFAULT STONE, EXACTLY (Gabe, 9/30/26: the alternatives were
// drawn as plain circles and read as a different size/shape/tilt than the real
// gem). Every item now uses the IDENTICAL clip shape (a rounded square, not a
// circle — ui/laurel.ts's STONE_SVG, `rect x9 y9 82x82 rx31`) and the IDENTICAL
// transform group (`rotate(-8 50 50) ... scale(0.92) ...`) as the default
// stone, so swapping one in changes nothing about size, tilt, or silhouette —
// only what's drawn inside.
//
// Every id inside an item's SVG is PREFIXED with the item's own id, because the
// store grid renders all 15 on one page at once — url(#...) resolves to the
// first id match in the WHOLE document, which is harmless for the single
// always-identical default stone but would silently make every alternative
// render as whichever one happens to come first in the DOM otherwise.
//
// ANIMATED FROM ~100 GEMS UP (Gabe, 9/30/26: "I think that would look really
// cool"): Pearl and up get a subtle looping animation (shimmer/twinkle/
// spin/glow — classes defined in ui/gemAnim.css), the cheaper 7 stay static.
//
// PRICES ONLY EVER RISE down the list (Gabe, 10/3), so the array order IS the
// price order; Diamond was cut to 400 to sit under the Moon/Earth/Sun run.
//
// The original 15 items: Gabe's own list (donut, basketball, soccer ball, bowling ball,
// apple, earth, sun, moon) plus 7 more circular objects drafted to round it
// out, priced by a mix of how good the icon looks and how rare or valuable the
// real thing is — his own instruction, so this pricing is a judgment call, not
// a spec. "We'll add more" per Gabe — this is a starting set, not a ceiling.

export interface GemAlt {
  id: string;
  name: string;
  price: number;
  svg: string;
}

// The exact clip + transform from ui/laurel.ts's STONE_SVG, reproduced here
// (not imported — it's markup, not a function) so every alternative sits in
// the identical slot.
const T = 'rotate(-8 50 50) translate(50 50) scale(0.92) translate(-50 -50)';
const wrap = (id: string, inner: string, outer?: Outer): string =>
  `<svg class="ws-mon" viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-gem="${id}"${outer ? ' style="overflow:visible"' : ''}>` +
  `<defs><clipPath id="${id}-clip"><rect x="9" y="9" width="82" height="82" rx="31" ry="31"/></clipPath></defs>` +
  (outer?.back ? `<g transform="${T}">${outer.back}</g>` : '') +
  `<g transform="${T}" clip-path="url(#${id}-clip)">` +
  inner +
  `</g>` +
  (outer?.front ? `<g transform="${T}">${outer.front}</g>` : '') +
  `</svg>`;

/** THE OUTER TIER (Gabe, 10/3): Saturn and up keep the IDENTICAL stone (same
 *  clip, tilt, size) and add one signature element OUTSIDE it, drawn in the same
 *  tilted frame but unclipped. `back` paints behind the stone, `front` over it.
 *  Hard limit: nothing may reach the C or the b of the wordmark, so every extra
 *  stays within x 6..94 of the 100-wide box (the stone itself spans ~12..88). */
interface Outer {
  back?: string;
  front?: string;
}

/** Shared body shading: a radial-gradient fill over the SAME 82x82 rect the
 *  clip cuts to shape, plus a soft highlight — every item reads as a rounded
 *  3D object without redrawing shading each time. */
function body(id: string, c0: string, c1: string, c2: string): string {
  return (
    `<defs><radialGradient id="${id}-b" cx="36%" cy="30%" r="80%">` +
    `<stop offset="0%" stop-color="${c0}"/><stop offset="55%" stop-color="${c1}"/><stop offset="100%" stop-color="${c2}"/>` +
    `</radialGradient></defs>` +
    `<rect x="9" y="9" width="82" height="82" fill="url(#${id}-b)"/>` +
    `<ellipse cx="38" cy="32" rx="12" ry="7" fill="#fff" opacity="0.32"/>`
  );
}

/** The full soccer-ball panel pattern, edge to edge (Gabe, 10/2: the first
 *  version only drew the middle few panels and left the rim plain white). A
 *  center pentagon, five pentagons around it squashed toward the rim so the
 *  ball reads as a sphere, every seam between the white hexagons, and seams
 *  running off the edge where the clip cuts the outer panels. */
function soccerPanels(): string {
  const rad = (d: number) => (d * Math.PI) / 180;
  const at = (r: number, deg: number): [number, number] => [50 + r * Math.cos(rad(deg)), 50 + r * Math.sin(rad(deg))];
  const pts = (ps: [number, number][]) => ps.map((p) => `${p[0].toFixed(1)},${p[1].toFixed(1)}`).join(' ');
  const line = (a: [number, number], b: [number, number]) =>
    `<line x1="${a[0].toFixed(1)}" y1="${a[1].toFixed(1)}" x2="${b[0].toFixed(1)}" y2="${b[1].toFixed(1)}"/>`;
  const K = [0, 1, 2, 3, 4];
  const center = K.map((k) => at(12, -90 + 72 * k));
  // Outer pentagon k sits out along center vertex k, one corner pointing back
  // at the middle; its radial depth is compressed (foreshortening).
  const outer = K.map((k) => {
    const th = -90 + 72 * k;
    const c = at(37, th);
    const u = [Math.cos(rad(th)), Math.sin(rad(th))];
    return K.map((j): [number, number] => {
      const ph = rad(th + 180 + 72 * j);
      const ox = 11 * Math.cos(ph), oy = 11 * Math.sin(ph);
      const a = ox * u[0] + oy * u[1]; // radial part, squashed
      const b = -ox * u[1] + oy * u[0]; // tangential part, kept
      return [c[0] + 0.72 * a * u[0] - b * u[1], c[1] + 0.72 * a * u[1] + b * u[0]];
    });
  });
  const dist = (p: [number, number], q: [number, number]) => Math.hypot(p[0] - q[0], p[1] - q[1]);
  let seams = '';
  for (const k of K) {
    const p = outer[k], n = outer[(k + 1) % 5];
    seams += line(center[k], p[0]); // center corner out to the outer pentagon
    // Hexagon side between neighbouring outer pentagons: their closest corners.
    let best: [[number, number], [number, number]] = [p[1], n[1]];
    for (const a of p.slice(1)) for (const b of n.slice(1)) if (dist(a, b) < dist(best[0], best[1])) best = [a, b];
    seams += line(best[0], best[1]);
    // The two far corners keep running off the rim, where the clip cuts them.
    const c = at(37, -90 + 72 * k);
    for (const v of [p[2], p[3]]) {
      const dx = v[0] - c[0], dy = v[1] - c[1], len = Math.hypot(dx, dy);
      seams += line(v, [v[0] + (dx / len) * 22, v[1] + (dy / len) * 22]);
    }
  }
  return (
    `<g stroke="#7d868e" stroke-width="1.3" stroke-linecap="round">${seams}</g>` +
    `<g fill="#1c2126" stroke="#1c2126" stroke-width="1" stroke-linejoin="round">` +
    `<polygon points="${pts(center)}"/>` +
    outer.map((o) => `<polygon points="${pts(o)}"/>`).join('') +
    `</g>` +
    // Sphere shading over the panels too, so the dark rim pieces curve away.
    `<defs><radialGradient id="soccer-shade" cx="38%" cy="32%" r="78%">` +
    `<stop offset="0%" stop-color="#fff" stop-opacity="0.28"/><stop offset="55%" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#000" stop-opacity="0.32"/></radialGradient></defs>` +
    `<rect x="9" y="9" width="82" height="82" fill="url(#soccer-shade)"/>`
  );
}

/** Disco Ball mirror tiles (Gabe, 10/3: the first version's gray lines had so
 *  little contrast it read like a plain ball). A grid of tiles in clearly
 *  different silver shades, separated by DARK grout, curved toward the rim so it
 *  reads as a sphere, */
function discoTiles(): string {
  const shades = ['#ffffff', '#dfe6ee', '#b3bfcc', '#8593a3', '#eef3f8', '#c8d2dc', '#6c7a8b', '#f6f9fc'];
  let tiles = '';
  let flashes = '';
  const N = 8; // tiles per row and column
  const warp = (v: number) => 50 + Math.sin(((v - 50) / 50) * (Math.PI / 2)) * 44; // squeeze toward the rim
  for (let r = 0; r < N; r++) {
    for (let c = 0; c < N; c++) {
      const x0 = warp(6 + (c * 88) / N), x1 = warp(6 + ((c + 1) * 88) / N);
      const y0 = warp(6 + (r * 88) / N), y1 = warp(6 + ((r + 1) * 88) / N);
      const shade = shades[(r * 5 + c * 3 + ((r * c) % 4)) % shades.length];
      const box = `x="${f1(x0 + 0.6)}" y="${f1(y0 + 0.6)}" width="${f1(x1 - x0 - 1.2)}" height="${f1(y1 - y0 - 1.2)}" rx="0.6"`;
      tiles += `<rect ${box} fill="${shade}"/>`;
      // Every few tiles catches the light: a visible flash, staggered across the ball.
      const k = r * N + c;
      if ((k * 7) % 5 === 0) flashes += `<rect class="gem-flash" style="animation-delay:${(k * 173) % 2400}ms" ${box} fill="#fff"/>`;
    }
  }
  return (
    `<rect x="9" y="9" width="82" height="82" fill="#2a323d"/>` + // the grout
    `<g>${tiles}</g>` +
    // sphere shading over the tiles: lit upper left, dark lower right
    `<defs><radialGradient id="discoball-shade" cx="36%" cy="30%" r="80%">` +
    `<stop offset="0%" stop-color="#fff" stop-opacity="0.25"/><stop offset="55%" stop-color="#fff" stop-opacity="0"/>` +
    `<stop offset="100%" stop-color="#0d1219" stop-opacity="0.55"/></radialGradient></defs>` +
    `<rect x="9" y="9" width="82" height="82" fill="url(#discoball-shade)"/>` +
    flashes
  );
}

/** Diamond: a proper brilliant cut (Gabe, 10/3: more detail). Table, crown
 *  facets, girdle, and pavilion facets meeting at the culet, in alternating
 *  ice shades, plus flashes of rainbow "fire" and four-point sparkles. */
function brilliantCut(): string {
  const G = [22, 31, 40.5, 50, 59.5, 69, 78].map((x) => [x, 40] as const); // girdle
  const T = [36, 43, 50, 57, 64].map((x) => [x, 26] as const); // table edge
  const C = [50, 82] as const; // culet
  const pt = (q: readonly number[]) => `${f1(q[0])},${f1(q[1])}`;
  const poly = (ps: (readonly number[])[], fill: string, op: number) =>
    `<polygon points="${ps.map(pt).join(' ')}" fill="${fill}" opacity="${op}"/>`;
  let out = '';
  // pavilion (below the girdle): alternating light/dark wedges to the culet
  const pav = ['#e8f7ff', '#7cc0ec', '#c4e7fb', '#5aa6dc', '#d6effd', '#8acbf1'];
  for (let i = 0; i < G.length - 1; i++) out += poly([G[i], G[i + 1], C], pav[i], 0.92);
  // crown (above the girdle)
  out += poly([G[0], T[0], G[1]], '#cfeeff', 0.95);
  for (let i = 0; i < T.length - 1; i++) {
    out += poly([T[i], T[i + 1], G[i + 2]], i % 2 ? '#a6dafa' : '#f4fbff', 0.95);
    out += poly([T[i], G[i + 1], G[i + 2]], i % 2 ? '#e3f5ff' : '#8fd0f6', 0.95);
  }
  out += poly([T[4], G[6], G[5]], '#7fc4ef', 0.95);
  // table
  out += poly([T[0], T[4], [60, 31], [40, 31]], '#ffffff', 0.9);
  // facet edges
  const edges: string[] = [];
  for (const g of G) edges.push(`M${pt(g)} L${pt(C)}`);
  for (let i = 0; i < T.length; i++) edges.push(`M${pt(T[i])} L${pt(G[i + 1])} M${pt(T[i])} L${pt(G[i + 2] ?? G[6])}`);
  edges.push(`M${pt(G[0])} L${pt(T[0])} L${pt(T[4])} L${pt(G[6])} Z`);
  out += `<path d="${edges.join(' ')}" fill="none" stroke="#ffffff" stroke-width="0.7" stroke-linejoin="round" opacity="0.8"/>`;
  out += `<path d="M${pt(G[0])} L${pt(C)} L${pt(G[6])}" fill="none" stroke="#3f88c4" stroke-width="0.9" stroke-linejoin="round" opacity="0.6"/>`;
  // fire: little flashes of spectral color inside the stone
  out +=
    `<circle class="gem-twinkle" style="animation-delay:0ms" cx="42" cy="52" r="1.8" fill="#ff8fb8"/>` +
    `<circle class="gem-twinkle" style="animation-delay:350ms" cx="58" cy="58" r="1.6" fill="#8ff0b0"/>` +
    `<circle class="gem-twinkle" style="animation-delay:700ms" cx="50" cy="66" r="1.5" fill="#c79bff"/>` +
    `<circle class="gem-twinkle" style="animation-delay:1050ms" cx="62" cy="46" r="1.4" fill="#ffd25b"/>`;
  // four-point sparkles
  const star = (x: number, y: number, r: number, delay: number) =>
    `<path class="gem-sparkle" style="animation-delay:${delay}ms" d="M${x},${y - r} L${x + r * 0.22},${y - r * 0.22} L${x + r},${y} L${x + r * 0.22},${y + r * 0.22} L${x},${y + r} L${x - r * 0.22},${y + r * 0.22} L${x - r},${y} L${x - r * 0.22},${y - r * 0.22} Z" fill="#fff"/>`;
  // Copious, BIG glistening (Gabe, 10/3): a dozen sparkles all over the stone,
  // staggered so several are always flaring at once.
  const glints: [number, number, number, number][] = [
    [40, 26, 11, 0], [70, 32, 9, 300], [28, 46, 8, 650], [62, 50, 10, 950], [48, 66, 9, 200],
    [76, 60, 7, 1250], [22, 66, 7, 500], [54, 18, 7, 1500], [36, 80, 6, 800], [82, 44, 6, 1100],
    [50, 40, 12, 1650], [66, 76, 7, 400],
  ];
  out += glints.map(([x, y, r, d]) => star(x, y, r, d)).join('');
  return out;
}

function item(id: string, name: string, price: number, inner: string, outer?: Outer): GemAlt {
  return { id, name, price, svg: wrap(id, inner, outer) };
}

/** Distance from the stone's center to its rounded-square edge at angle `deg`
 *  (pre-tilt frame), so extras can hug the real silhouette, not a circle. */
function edgeAt(deg: number): number {
  const a = (deg * Math.PI) / 180;
  const inside = (r: number) => {
    const x = Math.abs(Math.cos(a) * r), y = Math.abs(Math.sin(a) * r);
    const qx = Math.max(x - 10, 0), qy = Math.max(y - 10, 0); // 41 half-size − 31 corner radius
    return Math.hypot(qx, qy) <= 31;
  };
  let lo = 0, hi = 60;
  for (let i = 0; i < 24; i++) {
    const mid = (lo + hi) / 2;
    if (inside(mid)) lo = mid;
    else hi = mid;
  }
  return lo;
}
const f1 = (n: number) => n.toFixed(1);

/** Saturn's ring, split so the far half passes BEHIND the planet and the near
 *  half in FRONT. Tilted steeply (-30° on top of the stone's own -8°) so its
 *  long axis runs corner to corner, where the rounded corners leave room, and
 *  its sideways reach stays clear of the letters. */
function saturnRing(half: 'back' | 'front'): string {
  const ring =
    `<ellipse cx="50" cy="50" rx="52" ry="18" fill="none" stroke="#efdcb0" stroke-width="5.5"/>` +
    `<ellipse cx="50" cy="50" rx="43.5" ry="14.6" fill="none" stroke="#c39a62" stroke-width="3"/>` +
    `<ellipse cx="50" cy="50" rx="52" ry="18" fill="none" stroke="#fffaf0" stroke-width="1.4" opacity="0.7"/>` +
    `<ellipse class="gem-ring-glint" cx="50" cy="50" rx="52" ry="18" fill="none" stroke="#ffffff" stroke-width="4.5" stroke-linecap="round" stroke-dasharray="16 228"/>`;
  if (half === 'back') return `<g transform="rotate(-30 50 50)">${ring}</g>`;
  return (
    `<g transform="rotate(-30 50 50)">` +
    `<defs><clipPath id="saturn-ring-front"><rect x="-10" y="50" width="120" height="60"/></clipPath></defs>` +
    // A dark shadow line under the near half, so it reads where it crosses the planet.
    `<g clip-path="url(#saturn-ring-front)">` +
    `<ellipse cx="50" cy="50" rx="52" ry="18" fill="none" stroke="#5a3d1c" stroke-width="8.5" opacity="0.55"/>${ring}</g></g>`
  );
}

/** The Sun's sketched triangular rays, hugging the stone's real edge. Rays near
 *  the horizontal are shorter, because that is the direction the letters sit. */
function sunRays(): string {
  let out = '';
  let odd = '';
  for (let i = 0; i < 12; i++) {
    const deg = 15 + i * 30;
    const a = (deg * Math.PI) / 180;
    const e = edgeAt(deg);
    const sideness = Math.abs(Math.cos(a)); // 1 = pointing at a letter
    const len = 9 - 3.5 * sideness;
    const base = e - 3; // tucked under the stone so the ray reads as attached
    const half = 4.2;
    const px = -Math.sin(a), py = Math.cos(a);
    const tip = [50 + Math.cos(a) * (e + len), 50 + Math.sin(a) * (e + len)];
    const b1 = [50 + Math.cos(a) * base + px * half, 50 + Math.sin(a) * base + py * half];
    const b2 = [50 + Math.cos(a) * base - px * half, 50 + Math.sin(a) * base - py * half];
    (i % 2 ? (odd += `<polygon points="${f1(tip[0])},${f1(tip[1])} ${f1(b1[0])},${f1(b1[1])} ${f1(b2[0])},${f1(b2[1])}"/>`) : (out += `<polygon points="${f1(tip[0])},${f1(tip[1])} ${f1(b1[0])},${f1(b1[1])} ${f1(b2[0])},${f1(b2[1])}"/>`));
  }
  return (
    `<g fill="#ffb020" stroke="#ff9a1a" stroke-width="1" stroke-linejoin="round">` +
    `<g class="gem-flicker">${out}</g><g class="gem-flicker" style="animation-delay:-0.6s">${odd}</g></g>`
  );
}

/** The black hole's accretion disk: a hot orange band of small, distinguishable
 *  bodies (rocks, sparks, stars) orbiting on a tilted ellipse. The far half is
 *  drawn behind the hole and the near half over it, like the reference. */
function accretionDisk(half: 'back' | 'front'): string {
  const orbit = 'M3,50 A47,11 0 1,1 97,50 A47,11 0 1,1 3,50';
  const colors = ['#ffd27a', '#ff7a1a', '#ffb347', '#ff5a1f', '#fff1c9'];
  let bits = '';
  for (let i = 0; i < 18; i++) {
    const size = 1.1 + ((i * 5) % 4) * 0.4;
    const lane = ((i * 7) % 3) - 1; // three lanes, so it reads as a band
    bits +=
      `<circle cx="0" cy="${lane * 1.6}" r="${f1(size)}" fill="${colors[i % colors.length]}">` +
      `<animateMotion dur="12s" begin="-${f1((i / 18) * 12)}s" repeatCount="indefinite" path="${orbit}"/></circle>`;
  }
  const band =
    `<ellipse cx="50" cy="50" rx="47" ry="11" fill="none" stroke="#ff6a14" stroke-width="5" opacity="0.5"/>` +
    `<ellipse cx="50" cy="50" rx="47" ry="11" fill="none" stroke="#ffb347" stroke-width="1.3"/>`;
  if (half === 'back') return `<g transform="rotate(-20 50 50)">${band}${bits}</g>`;
  return (
    `<g transform="rotate(-20 50 50)">` +
    `<defs><clipPath id="blackhole-disk-front"><rect x="-10" y="50" width="120" height="60"/></clipPath></defs>` +
    `<g clip-path="url(#blackhole-disk-front)">${band}${bits}</g></g>`
  );
}

/** Milky Way spiral arms: two swept arms of soft haze with pink star clusters
 *  along them, slowly turning. Lives inside the stone. */
function galaxyArms(): string {
  let arms = '';
  let knots = '';
  for (const start of [0, 180]) {
    const pts: string[] = [];
    for (let k = 0; k <= 20; k++) {
      const t = k / 20;
      const a = ((start + t * 300) * Math.PI) / 180;
      const r = 6 + t * 36;
      pts.push(`${f1(50 + Math.cos(a) * r)},${f1(50 + Math.sin(a) * r)}`);
      if (k % 3 === 1) {
        knots += `<circle cx="${f1(50 + Math.cos(a + 0.12) * (r + 1.5))}" cy="${f1(50 + Math.sin(a + 0.12) * (r + 1.5))}" r="1.3" fill="#ff8fb8" opacity="0.85"/>`;
      }
    }
    const d = `M${pts.join(' L')}`;
    arms +=
      `<path d="${d}" fill="none" stroke="#9fb4ff" stroke-width="9" stroke-linecap="round" opacity="0.28"/>` +
      `<path d="${d}" fill="none" stroke="#e6ecff" stroke-width="3.6" stroke-linecap="round" opacity="0.75"/>` +
      `<path d="${d}" fill="none" stroke="#5a3a3a" stroke-width="1" stroke-linecap="round" opacity="0.45"/>`;
  }
  return `<g class="gem-spin" style="transform-origin:50px 50px; animation-duration:16s">${arms}${knots}</g>`;
}

export const GEM_ALTS: GemAlt[] = [
  item(
    'donut',
    'Donut',
    60,
    `<mask id="donut-hole"><rect x="9" y="9" width="82" height="82" fill="#fff"/><circle cx="50" cy="50" r="14" fill="#000"/></mask>` +
      body('donut', '#f6c98a', '#e0a352', '#a3651f') +
      `<g mask="url(#donut-hole)">` +
      `<ellipse cx="50" cy="44" rx="35" ry="29" fill="#ff8fc6" opacity="0.6"/>` +
      `<rect x="30" y="38" width="7" height="3" rx="1.5" fill="#5bd6e0" transform="rotate(20 33 39)"/>` +
      `<rect x="46" y="30" width="7" height="3" rx="1.5" fill="#ffe45b" transform="rotate(-15 49 31)"/>` +
      `<rect x="60" y="40" width="7" height="3" rx="1.5" fill="#7bffb0" transform="rotate(40 63 41)"/>` +
      `<rect x="44" y="58" width="7" height="3" rx="1.5" fill="#ffffff" transform="rotate(-5 47 59)"/>` +
      `</g>`
  ),
  item(
    'gumball',
    'Gumball',
    60,
    body('gumball', '#ff9fd6', '#ff4fa8', '#b0106b') +
      `<ellipse cx="60" cy="62" rx="7" ry="4" fill="#fff" opacity="0.3"/>` +
      `<circle cx="46" cy="26" r="2.4" fill="#fff" opacity="0.5"/>`
  ),
  item(
    'apple',
    'Apple',
    70,
    body('apple', '#ff8f7a', '#e8402c', '#8f1710') +
      `<path d="M50,16 V70" stroke="#ff6a52" stroke-width="2.5" opacity="0.35"/>` +
      `<path d="M50,14 Q56,6 64,10 Q58,16 50,18 Z" fill="#3fa64a"/>` +
      `<path d="M50,14 Q53,10 56,9" stroke="#2c7a35" stroke-width="1" fill="none" opacity="0.6"/>` +
      `<rect x="48.5" y="8" width="3" height="10" rx="1.4" fill="#6b4321"/>`
  ),
  item(
    'tennis',
    'Tennis Ball',
    90,
    body('tennis', '#f4ff9a', '#d4ec2a', '#7f9410') +
      `<path d="M22,12 Q46,50 22,88" fill="none" stroke="#fbfff0" stroke-width="3.6" stroke-linecap="round"/>` +
      `<path d="M78,12 Q54,50 78,88" fill="none" stroke="#fbfff0" stroke-width="3.6" stroke-linecap="round"/>` +
      `<g fill="#f6ffb8" opacity="0.35"><circle cx="40" cy="62" r="1"/><circle cx="60" cy="30" r="1"/><circle cx="54" cy="72" r="0.9"/><circle cx="34" cy="40" r="0.9"/></g>`
  ),
  item(
    'soccer',
    'Soccer Ball',
    90,
    body('soccer', '#ffffff', '#e7ebee', '#9aa4ab') + soccerPanels()
  ),
  item(
    'basketball',
    'Basketball',
    100,
    body('basketball', '#ffb066', '#ee7a1f', '#8f4405') +
      `<path d="M50,9 V91 M9,50 H91" stroke="#26160a" stroke-width="2.4"/>` +
      `<path d="M15,20 Q50,50 15,80" fill="none" stroke="#26160a" stroke-width="2.4"/>` +
      `<path d="M85,20 Q50,50 85,80" fill="none" stroke="#26160a" stroke-width="2.4"/>`
  ),
  item(
    'bowling',
    'Bowling Ball',
    110,
    body('bowling', '#5b6b8c', '#22283a', '#08090f') +
      `<circle cx="46" cy="24" r="3" fill="#05060a"/>` +
      `<circle cx="58" cy="26" r="3" fill="#05060a"/>` +
      `<circle cx="52" cy="34" r="3" fill="#05060a"/>`
  ),
  item(
    'eightball',
    'Eight Ball',
    140,
    body('eightball', '#5a5f66', '#1b1d21', '#000000') +
      `<circle cx="50" cy="52" r="17" fill="#f4efe4"/>` +
      `<text x="50" y="58" font-size="17" font-weight="700" text-anchor="middle" fill="#15181c" font-family="Georgia, serif">8</text>`
  ),

  item(
    'marble',
    'Marble',
    190,
    body('marble', '#e9f6ff', '#9fd2f2', '#3d7fb8') +
      `<path d="M26,66 Q40,34 58,46 Q72,56 66,28" fill="none" stroke="#ff6f91" stroke-width="7" stroke-linecap="round" opacity="0.85"/>` +
      `<path d="M30,70 Q46,44 60,54 Q76,64 72,36" fill="none" stroke="#ffd25b" stroke-width="3.5" stroke-linecap="round" opacity="0.85"/>` +
      `<ellipse cx="38" cy="30" rx="13" ry="7" fill="#fff" opacity="0.55"/>`
  ),

  // --- Pearl and up: animated (Gabe, 9/30/26; prices +50% on 10/3) ---------

  item(
    'pearl',
    'Pearl',
    230,
    body('pearl', '#fffaf4', '#efdde6', '#8f80ab') +
      `<defs>` +
      `<radialGradient id="pearl-rim" cx="50%" cy="50%" r="62%"><stop offset="62%" stop-color="#6d5f8c" stop-opacity="0"/><stop offset="100%" stop-color="#6d5f8c" stop-opacity="0.55"/></radialGradient>` +
      `<linearGradient id="pearl-orient" x1="0%" y1="0%" x2="100%" y2="100%">` +
      `<stop offset="0%" stop-color="#ffb3d9" stop-opacity="0.55"/><stop offset="35%" stop-color="#fff1c4" stop-opacity="0.3"/>` +
      `<stop offset="65%" stop-color="#b8f0e0" stop-opacity="0.35"/><stop offset="100%" stop-color="#a9c4ff" stop-opacity="0.55"/>` +
      `</linearGradient></defs>` +
      // iridescent orient washing across the surface
      `<rect x="9" y="9" width="82" height="82" fill="url(#pearl-orient)"/>` +
      // iridescent sheen bending along the curve: pink up top, sea-green below, gold between
      `<g class="gem-spin" style="transform-origin:50px 50px; animation-duration:6s">` +
      `<path d="M58,13 Q82,20 88,44" fill="none" stroke="#ff9fd0" stroke-width="11" stroke-linecap="round" opacity="0.4"/>` +
      `<path d="M14,58 Q20,82 46,88" fill="none" stroke="#7fe0c8" stroke-width="11" stroke-linecap="round" opacity="0.4"/>` +
      `<path d="M24,74 Q50,92 80,70" fill="none" stroke="#ffe08a" stroke-width="6" stroke-linecap="round" opacity="0.3"/>` +
      `</g>` +
      // depth at the rim
      `<rect x="9" y="9" width="82" height="82" fill="url(#pearl-rim)"/>` +
      // window reflection, lower right, and a pink glint in the shadow side
      `<path d="M64,66 Q72,62 76,70 Q70,76 64,74 Z" fill="#ffffff" opacity="0.55"/>` +
      `<ellipse cx="70" cy="40" rx="5" ry="9" fill="#ffc2e2" opacity="0.45" transform="rotate(25 70 40)"/>` +
      // crisp main highlight with a hot spot
      `<ellipse class="gem-shimmer" cx="37" cy="30" rx="14" ry="8" fill="#fff" opacity="0.8"/>` +
      `<ellipse cx="33" cy="27" rx="5.5" ry="3" fill="#fff"/>` +
      `<circle cx="44" cy="25" r="1.6" fill="#fff"/>`
  ),
  item(
    'discoball',
    'Disco Ball',
    270,
    body('discoball', '#f4f7fb', '#9aa6b4', '#3c4652') +
      discoTiles() +
      `<circle class="gem-twinkle" style="animation-delay:0ms" cx="34" cy="28" r="2.6" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:260ms" cx="68" cy="36" r="2" fill="#9ad8ff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:520ms" cx="58" cy="68" r="2.4" fill="#ffd25b"/>` +
      `<circle class="gem-twinkle" style="animation-delay:780ms" cx="28" cy="60" r="1.8" fill="#ff9fd6"/>` +
      `<circle class="gem-twinkle" style="animation-delay:1040ms" cx="48" cy="46" r="1.6" fill="#fff"/>`
  ),
  item(
    'goldcoin',
    'Gold Coin',
    330,
    body('goldcoin', '#fff3b8', '#e8b93a', '#8a610f') +
      `<circle cx="50" cy="50" r="33" fill="none" stroke="#8a610f" stroke-width="2.5" opacity="0.65"/>` +
      `<circle cx="50" cy="50" r="27" fill="none" stroke="#fff3b8" stroke-width="1" opacity="0.5"/>` +
      `<text x="50" y="58" font-size="26" font-weight="700" text-anchor="middle" fill="#8a610f" font-family="Georgia, serif" opacity="0.85">C</text>` +
      // The light sweep is the coin's own move; the Diamond sparkles instead (Gabe, 10/3).
      `<g transform="skewX(-20)"><rect class="gem-sweep" x="0" y="-10" width="18" height="120" fill="#fff" opacity="0.6"/></g>`
  ),
  item(
    'diamond',
    'Diamond',
    400,
    body('diamond', '#f2fbff', '#bfe6fb', '#6fb4e6') + brilliantCut()
  ),
  item(
    'crystalball',
    'Crystal Ball',
    425,
    // A glass orb with a glowing violet storm swirling inside it (Gabe, 10/3: more detail).
    `<defs><radialGradient id="crystalball-b" cx="50%" cy="54%" r="62%">` +
      `<stop offset="0%" stop-color="#f3e8ff"/><stop offset="22%" stop-color="#b98cff"/>` +
      `<stop offset="55%" stop-color="#5b3fc4"/><stop offset="85%" stop-color="#241a6e"/><stop offset="100%" stop-color="#120c3d"/>` +
      `</radialGradient><radialGradient id="crystalball-rim" cx="50%" cy="50%" r="60%">` +
      `<stop offset="78%" stop-color="#bfe3ff" stop-opacity="0"/><stop offset="94%" stop-color="#bfe3ff" stop-opacity="0.55"/><stop offset="100%" stop-color="#bfe3ff" stop-opacity="0.15"/>` +
      `</radialGradient></defs>` +
      `<rect x="9" y="9" width="82" height="82" fill="url(#crystalball-b)"/>` +
      // swirling mist
      `<g class="gem-spin" style="transform-origin:50px 54px; animation-duration:9s" fill="none" stroke-linecap="round">` +
      `<path d="M50,54 Q66,40 58,28 Q48,18 34,30" stroke="#e7d4ff" stroke-width="5" opacity="0.45"/>` +
      `<path d="M50,54 Q34,68 42,80 Q54,88 68,76" stroke="#9fd8ff" stroke-width="4.5" opacity="0.4"/>` +
      `<path d="M50,54 Q70,62 76,48" stroke="#ff9fe0" stroke-width="3" opacity="0.4"/>` +
      `<path d="M50,54 Q30,46 24,60" stroke="#c4a8ff" stroke-width="3" opacity="0.45"/>` +
      `</g>` +
      // the glowing heart
      `<circle class="gem-glow-pulse" cx="50" cy="54" r="10" fill="#fff6ff"/>` +
      `<circle cx="50" cy="54" r="4" fill="#ffffff" opacity="0.9"/>` +
      // tiny stars caught in the glass
      `<circle class="gem-twinkle" style="animation-delay:0ms" cx="32" cy="46" r="1.2" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:450ms" cx="66" cy="64" r="1.3" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:900ms" cx="60" cy="36" r="1" fill="#e7d4ff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:1300ms" cx="40" cy="72" r="1" fill="#9fd8ff"/>` +
      // glass: rim light, curved window highlight, and a caustic at the bottom
      `<rect x="9" y="9" width="82" height="82" fill="url(#crystalball-rim)"/>` +
      `<path d="M24,40 Q28,24 44,19" fill="none" stroke="#fff" stroke-width="4" stroke-linecap="round" opacity="0.75"/>` +
      `<ellipse cx="36" cy="26" rx="6" ry="3.5" fill="#fff" opacity="0.85" transform="rotate(-30 36 26)"/>` +
      `<path d="M38,84 Q50,88 62,84" fill="none" stroke="#e7d4ff" stroke-width="2.5" stroke-linecap="round" opacity="0.6"/>`
  ),
  item(
    'moon',
    'Moon',
    450,
    body('moon', '#f2f2f0', '#c7c9cf', '#8c8f98') +
      `<circle cx="38" cy="36" r="6" fill="#9a9ca3" opacity="0.6"/>` +
      `<circle cx="60" cy="30" r="4" fill="#9a9ca3" opacity="0.5"/>` +
      `<circle cx="58" cy="58" r="8" fill="#9a9ca3" opacity="0.55"/>` +
      `<circle cx="34" cy="60" r="3.5" fill="#9a9ca3" opacity="0.5"/>` +
      `<circle cx="68" cy="48" r="2.5" fill="#9a9ca3" opacity="0.45"/>` +
      `<circle class="gem-phase" cx="50" cy="50" r="46" fill="#141a28" opacity="0.78"/>`
  ),
  item(
    'earth',
    'Earth',
    600,
    body('earth', '#8fd0ff', '#2f80c9', '#0d3a68') +
      `<ellipse cx="50" cy="13" rx="20" ry="6" fill="#eef7ff" opacity="0.85"/>` +
      `<ellipse cx="50" cy="89" rx="18" ry="5" fill="#eef7ff" opacity="0.75"/>` +
      // Continents hold still (Gabe, 10/3: the spinning looked bad).
      `<g>` +
      `<path d="M20,40 Q30,32 40,38 Q48,34 46,44 Q38,50 28,48 Q20,46 20,40 Z" fill="#4caf5e"/>` +
      `<path d="M55,55 Q66,50 76,58 Q78,66 68,68 Q56,66 55,55 Z" fill="#4caf5e"/>` +
      `<path d="M48,20 Q56,18 58,26 Q52,28 48,20 Z" fill="#4caf5e" opacity="0.9"/>` +
      `<path d="M62,30 Q70,28 71,35 Q65,37 62,30 Z" fill="#3f9950" opacity="0.85"/>` +
      `<path d="M28,65 Q35,62 37,69 Q31,72 28,65 Z" fill="#3f9950" opacity="0.85"/>` +
      `</g>` +
      `<g fill="#ffffff" opacity="0.8">` +
      `<g class="gem-drift"><ellipse cx="30" cy="30" rx="12" ry="3.2"/><ellipse cx="36" cy="27" rx="7" ry="2.6"/><ellipse cx="62" cy="74" rx="10" ry="2.8"/></g>` +
      `<g class="gem-drift" style="animation-delay:-7s"><ellipse cx="48" cy="52" rx="11" ry="3"/><ellipse cx="72" cy="40" rx="8" ry="2.4"/><ellipse cx="22" cy="62" rx="7" ry="2.2"/></g>` +
      `</g>`
  ),

  // --- Saturn and up: the stone plus one signature element OUTSIDE it (Gabe, 10/3) ---

  item(
    'saturn',
    'Saturn',
    1000,
    body('saturn', '#f5d79a', '#d0a060', '#7d5527') +
      `<path d="M9,24 Q50,19 91,24 L91,27 Q50,22 9,27 Z" fill="#fff3d6" opacity="0.35"/>` +
      `<path d="M9,34 Q50,28 91,34 L91,40 Q50,34 9,40 Z" fill="#b8874d" opacity="0.45"/>` +
      `<path d="M9,50 Q50,45 91,50 L91,55 Q50,50 9,55 Z" fill="#a7743d" opacity="0.4"/>` +
      `<path d="M9,66 Q50,62 91,66 L91,70 Q50,66 9,70 Z" fill="#b8874d" opacity="0.4"/>`,
    { back: saturnRing('back'), front: saturnRing('front') }
  ),
  item(
    'sun',
    'Sun',
    1400,
    body('sun', '#fff4b0', '#ffb020', '#c94e0e') +
      `<circle class="gem-glow-pulse" cx="50" cy="50" r="30" fill="#fff6c2"/>` +
      `<circle cx="36" cy="58" r="3" fill="#e0700f" opacity="0.35"/>` +
      `<circle cx="62" cy="40" r="2.2" fill="#e0700f" opacity="0.3"/>`,
    { back: sunRays() }
  ),
  item(
    'blackhole',
    'Black Hole',
    2000,
    `<defs><radialGradient id="blackhole-b" cx="50%" cy="50%" r="62%">` +
      `<stop offset="0%" stop-color="#000"/><stop offset="52%" stop-color="#000"/>` +
      `<stop offset="64%" stop-color="#ff7a1a"/><stop offset="72%" stop-color="#ffb347"/>` +
      `<stop offset="86%" stop-color="#8a2a06"/><stop offset="100%" stop-color="#1a0500"/>` +
      `</radialGradient></defs>` +
      `<rect x="9" y="9" width="82" height="82" fill="url(#blackhole-b)"/>` +
      `<circle class="gem-glow-pulse" cx="50" cy="50" r="24.5" fill="none" stroke="#ffd27a" stroke-width="1.2"/>`,
    { back: accretionDisk('back'), front: accretionDisk('front') }
  ),
  item(
    'milkyway',
    'Milky Way',
    2800,
    `<defs><radialGradient id="milkyway-b" cx="50%" cy="50%" r="70%">` +
      `<stop offset="0%" stop-color="#2a3150"/><stop offset="60%" stop-color="#141a30"/><stop offset="100%" stop-color="#070a16"/>` +
      `</radialGradient><radialGradient id="milkyway-core" cx="50%" cy="50%" r="50%">` +
      `<stop offset="0%" stop-color="#fffbe8"/><stop offset="45%" stop-color="#ffe0a3" stop-opacity="0.9"/><stop offset="100%" stop-color="#ffd08a" stop-opacity="0"/>` +
      `</radialGradient></defs>` +
      `<rect x="9" y="9" width="82" height="82" fill="url(#milkyway-b)"/>` +
      galaxyArms() +
      `<ellipse cx="50" cy="50" rx="13" ry="9" fill="url(#milkyway-core)" transform="rotate(-35 50 50)"/>` +
      `<circle class="gem-twinkle" style="animation-delay:0ms" cx="24" cy="30" r="1" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:500ms" cx="74" cy="72" r="1" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:900ms" cx="70" cy="22" r="0.9" fill="#cfe0ff"/>`,
    {
      // A faint halo past the rounded corners, plus a few loose stars.
      back:
        `<defs><radialGradient id="milkyway-halo"><stop offset="78%" stop-color="#8fa2ec" stop-opacity="0"/>` +
        `<stop offset="90%" stop-color="#8fa2ec" stop-opacity="0.32"/><stop offset="100%" stop-color="#8fa2ec" stop-opacity="0"/></radialGradient></defs>` +
        `<circle cx="50" cy="50" r="47" fill="url(#milkyway-halo)"/>` +
        `<g class="gem-spin" style="transform-origin:50px 50px; animation-duration:16s">` +
        `<circle cx="84" cy="17" r="1.4" fill="#ffc6dc"/><circle cx="16" cy="83" r="1.4" fill="#cfe0ff"/>` +
        `<circle cx="84" cy="83" r="1.1" fill="#fff"/><circle cx="16" cy="17" r="1.1" fill="#fff"/>` +
        `</g>`,
    }
  ),
];

export const gemAltById = (id: string): GemAlt | undefined => GEM_ALTS.find((g) => g.id === id);
