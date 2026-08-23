// Cobalt: picking a colour for a new course.
//
// THE PROBLEM (Gabe, 8/22). A course's colour is how a student recognises a class
// without reading — on the task row, the calendar chip, the folder icon. Every new
// course used to be born the same flat grey (Settings) or the same brand blue
// (onboarding), so the second course a student made was already indistinguishable
// from the first until they went and changed it by hand.
//
// THE RULE. The first colours must be unmistakable from each other; after that they
// have to get gradually closer, because a colour wheel does not have thirty
// unmistakable points on it. Being honest about that is the design: the early
// courses, which is most students, get maximum separation, and the tail degrades
// smoothly instead of falling off a cliff or repeating.
//
// HOW. Two phases.
//
//   1. ANCHORS — the first three are hand-picked: yellow, then red, then blue.
//      Pure taste, and deliberately not left to the optimiser: measured in Lab the
//      farthest thing from yellow is a blue, so an unguided search would give
//      yellow → blue → red, and Gabe wants red second. An anchor is only used if it
//      is still genuinely far from what exists, so a student who hand-picked a red
//      does not get another one.
//
//   2. MAX-MIN SEARCH — every colour after that is the candidate, from a grid of
//      hues crossed with three lightness rings, whose NEAREST existing colour is as
//      far away as possible. Distance is CIE76 ΔE in Lab, not a hue angle, because
//      hue degrees are not evenly visible: 30° of green looks like one colour and
//      30° of orange looks like three.
//
// What that produces, from empty, is: yellow, red, blue, green, violet, teal,
// yellow-green, indigo, magenta, orange-red… — exactly the "completely contrasting,
// then gradually more similar" curve, arrived at rather than hard-coded. Once hue
// alone runs out the search starts spending the lightness rings instead, which is
// how it keeps finding separation after the wheel is full.
//
// The checks this is held to live next door, in colors.audit.mjs.
// Run them from app/ with:  node src/courses/colors.audit.mjs

/** The first three, in order. See phase 1 above. */
const ANCHORS = ['#f2c531', '#ef4444', '#4a9eff'];

/**
 * How far an anchor must be from every existing colour to still be worth using.
 * Below this it would be a near-repeat, so the search takes over instead.
 * ΔE 40 is comfortably past "obviously a different colour".
 */
const ANCHOR_FLOOR = 40;

/** A colour with less saturation than this has no meaningful hue (the old grey
 *  default, black, white), so it cannot crowd the wheel and is left out of the
 *  comparison set — but it is still avoided as a candidate, being unusable. */
const MIN_SAT = 0.12;

/** The three lightness/saturation rings the search may spend, in order of
 *  preference. Ring 0 is the app's normal chip weight; the other two are only
 *  reached once hue alone has stopped separating anything. */
const RINGS: Array<{ s: number; l: number }> = [
  { s: 0.72, l: 0.62 },
  { s: 0.58, l: 0.44 },
  { s: 0.85, l: 0.76 },
];

/** Hue step of the candidate grid. 6° is finer than anyone can name and keeps the
 *  search at 60 × 3 = 180 candidates, which is nothing. */
const HUE_STEP = 6;

// #region colour maths
export interface Rgb {
  r: number;
  g: number;
  b: number;
}

/** '#rgb' or '#rrggbb' → 0-255 channels, or null if it is not a hex colour. */
export function parseHex(hex: string): Rgb | null {
  const m = /^#?([0-9a-f]{3}|[0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return null;
  let h = m[1];
  if (h.length === 3) h = h[0] + h[0] + h[1] + h[1] + h[2] + h[2];
  return {
    r: parseInt(h.slice(0, 2), 16),
    g: parseInt(h.slice(2, 4), 16),
    b: parseInt(h.slice(4, 6), 16),
  };
}

/** Saturation in the HSL sense, 0-1. Used only to spot colours with no hue. */
export function saturationOf(rgb: Rgb): number {
  const r = rgb.r / 255;
  const g = rgb.g / 255;
  const b = rgb.b / 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  if (max === min) return 0;
  const l = (max + min) / 2;
  return l > 0.5 ? (max - min) / (2 - max - min) : (max - min) / (max + min);
}

/** HSL (h in degrees, s and l in 0-1) → '#rrggbb'. */
export function hslToHex(h: number, s: number, l: number): string {
  const hh = ((h % 360) + 360) % 360;
  const c = (1 - Math.abs(2 * l - 1)) * s;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = l - c / 2;
  let r = 0;
  let g = 0;
  let b = 0;
  if (hh < 60) [r, g, b] = [c, x, 0];
  else if (hh < 120) [r, g, b] = [x, c, 0];
  else if (hh < 180) [r, g, b] = [0, c, x];
  else if (hh < 240) [r, g, b] = [0, x, c];
  else if (hh < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  const to = (v: number): string =>
    Math.round((v + m) * 255)
      .toString(16)
      .padStart(2, '0');
  return `#${to(r)}${to(g)}${to(b)}`;
}

/** sRGB → CIELAB (D65). The standard transform; no shortcuts, because the whole
 *  point of using Lab is that it is the one that matches what an eye reports. */
export function rgbToLab(rgb: Rgb): [number, number, number] {
  const lin = (v: number): number => {
    const c = v / 255;
    return c <= 0.04045 ? c / 12.92 : Math.pow((c + 0.055) / 1.055, 2.4);
  };
  const r = lin(rgb.r);
  const g = lin(rgb.g);
  const b = lin(rgb.b);
  // sRGB D65 matrix
  const x = (r * 0.4124564 + g * 0.3575761 + b * 0.1804375) / 0.95047;
  const y = r * 0.2126729 + g * 0.7151522 + b * 0.072175;
  const z = (r * 0.0193339 + g * 0.119192 + b * 0.9503041) / 1.08883;
  const f = (t: number): number => (t > 0.008856 ? Math.cbrt(t) : 7.787 * t + 16 / 116);
  const fx = f(x);
  const fy = f(y);
  const fz = f(z);
  return [116 * fy - 16, 500 * (fx - fy), 200 * (fy - fz)];
}

/** CIE76 ΔE between two hex colours. Roughly: under 2.3 is imperceptible, ~10 is
 *  "a different shade", 40+ is "a different colour". */
export function deltaE(a: string, b: string): number {
  const ra = parseHex(a);
  const rb = parseHex(b);
  if (!ra || !rb) return Infinity;
  const [l1, a1, b1] = rgbToLab(ra);
  const [l2, a2, b2] = rgbToLab(rb);
  return Math.sqrt((l1 - l2) ** 2 + (a1 - a2) ** 2 + (b1 - b2) ** 2);
}
// #endregion

type Lab = [number, number, number];

/** Squared ΔE. Ranking never needs the square root, and taking it 36,000 times per
 *  click is most of what made the first version of this cost 15ms (see the audit's
 *  cost check, which caught it). */
function distSq(a: Lab, b: Lab): number {
  return (a[0] - b[0]) ** 2 + (a[1] - b[1]) ** 2 + (a[2] - b[2]) ** 2;
}

/** Nearest neighbour, squared. Infinity when there are none, which is what makes
 *  the very first course free to be any colour it likes. */
function nearestSq(c: Lab, others: Lab[]): number {
  let best = Infinity;
  for (let i = 0; i < others.length; i++) {
    const d = distSq(c, others[i]);
    if (d < best) best = d;
  }
  return best;
}

/**
 * The candidate grid, built ONCE. Hue × ring, each with its Lab precomputed, in the
 * order the search should prefer them: ring 0 before ring 1, low hue before high, so
 * a tie is broken the same way every time.
 */
const GRID: Array<{ hex: string; lab: Lab }> = (() => {
  const out: Array<{ hex: string; lab: Lab }> = [];
  for (let ring = 0; ring < RINGS.length; ring++) {
    const { s, l } = RINGS[ring];
    for (let h = 0; h < 360; h += HUE_STEP) {
      const hex = hslToHex(h, s, l);
      out.push({ hex, lab: rgbToLab(parseHex(hex)!) });
    }
  }
  return out;
})();

const ANCHOR_LABS: Lab[] = ANCHORS.map((a) => rgbToLab(parseHex(a)!));

/**
 * The colour a new course should be, given the colours already in use.
 *
 * Deterministic: the same input always gives the same answer, which is what makes
 * it testable and what stops a re-render from reshuffling anyone's palette.
 */
export function nextCourseColor(existing: string[]): string {
  // Colours with no hue cannot crowd the wheel, so they are not competition. They
  // are also usually the old grey placeholder, and matching it would be the exact
  // problem this function exists to solve.
  const used: Lab[] = [];
  for (const raw of existing) {
    if (typeof raw !== 'string') continue;
    const rgb = parseHex(raw.trim());
    if (!rgb || saturationOf(rgb) < MIN_SAT) continue;
    used.push(rgbToLab(rgb));
  }

  // 1. anchors, while they are still far from everything.
  const floorSq = ANCHOR_FLOOR * ANCHOR_FLOOR;
  for (let i = 0; i < ANCHORS.length; i++) {
    if (nearestSq(ANCHOR_LABS[i], used) >= floorSq) return ANCHORS[i];
  }

  // 2. the candidate whose nearest neighbour is furthest away. The grid is already
  //    in preference order, and the comparison is STRICTLY greater, so a tie keeps
  //    the earlier ring and the lower hue and the whole thing stays deterministic.
  //    That is also why the search only reaches for a darker or paler variant once
  //    no hue on the normal ring is any better.
  let best = ANCHORS[0];
  let bestScore = -1;
  for (let i = 0; i < GRID.length; i++) {
    const score = nearestSq(GRID[i].lab, used);
    if (score > bestScore) {
      bestScore = score;
      best = GRID[i].hex;
    }
  }
  return best;
}
