// Cobalt: Store — badge artwork.
//
// ONE STRUCTURE, FOUR TIERS (Gabe, 10/2/26): every badge is the same medal, a
// flat top that curves down to a point, and only the emblem in the middle
// changes per achievement (a plus for Cobalt Plus, a number for a count, an
// eye for focus). The tier is bronze, silver, gold, or COBALT (the brand's own
// blue, above gold), by how hard the badge is to earn.
//
// A tier is more than a color. Each step up adds components and intensity:
//   bronze  plain medal, faint slow sweep
//   silver  + riveted top band, ring around the emblem, brighter sweep, a sparkle
//   gold    + sparse engraved rays, two blue gems set in the band, warm glow,
//           bright sweep, two sparkles
//   cobalt  blue metal with a platinum rim, a large cobalt gem crowning the band
//           plus diamonds and a gem at the tip, double sweep, pulsing glow,
//           four sparkles
// Kept deliberately less busy than the first draft (Gabe: "a little too
// intricate... a little simpler"): no beaded ring, and rays only from gold up.
//
// Animation (sweep, twinkle, glow) lives in ui/badges.css, tuned per tier there.

export type BadgeTier = 'bronze' | 'silver' | 'gold' | 'cobalt';
export const BADGE_TIERS: BadgeTier[] = ['bronze', 'silver', 'gold', 'cobalt'];

export type BadgeEmblem =
  | { kind: 'plus' }
  | { kind: 'check' }
  | { kind: 'eye' }
  | { kind: 'number'; value: number };

interface Palette {
  light: string;
  mid: string;
  dark: string;
  deep: string;
}

type GemColors = [string, string, string]; // light, mid, dark

interface TierSpec {
  metal: Palette; // the field and disc
  rim: Palette; // the outer rim (cobalt's is platinum)
  face: [string, string]; // the emblem's bright face
  band: boolean;
  rivets: number[]; // x positions in the band
  ring: boolean;
  rays: number;
  gems: { x: number; y: number; r: number; c: GemColors }[];
  sparkles: [number, number, number, number][]; // x, y, radius, delay ms
  sweeps: number;
}

const BRONZE: Palette = { light: '#ecbe8f', mid: '#b8743c', dark: '#6e3d18', deep: '#3a1e0a' };
const SILVER: Palette = { light: '#ffffff', mid: '#c6cdd6', dark: '#6f7a87', deep: '#2f363f' };
const GOLD: Palette = { light: '#fff0b3', mid: '#e3b444', dark: '#8c6414', deep: '#463004' };
const COBALT: Palette = { light: '#bfe0ff', mid: '#3d7fe8', dark: '#173f9e', deep: '#0a1c4d' };
const PLATINUM: Palette = { light: '#f6f9ff', mid: '#bcc8da', dark: '#6b7d96', deep: '#263449' };

const BLUE_GEM: GemColors = ['#d6ecff', '#5a9bef', '#173f9e'];
const DIAMOND: GemColors = ['#ffffff', '#d7e9ff', '#7fa3cf'];

const TIERS: Record<BadgeTier, TierSpec> = {
  bronze: {
    metal: BRONZE,
    rim: BRONZE,
    face: [BRONZE.light, BRONZE.mid],
    band: false,
    rivets: [],
    ring: false,
    rays: 0,
    gems: [],
    sparkles: [],
    sweeps: 1,
  },
  silver: {
    metal: SILVER,
    rim: SILVER,
    face: [SILVER.light, SILVER.mid],
    band: true,
    rivets: [33, 50, 67],
    ring: true,
    rays: 0,
    gems: [],
    sparkles: [[83, 14, 4, 0]],
    sweeps: 1,
  },
  gold: {
    metal: GOLD,
    rim: GOLD,
    face: [GOLD.light, GOLD.mid],
    band: true,
    rivets: [41, 50, 59],
    ring: true,
    rays: 16,
    gems: [
      { x: 29, y: 24, r: 3.4, c: BLUE_GEM },
      { x: 71, y: 24, r: 3.4, c: BLUE_GEM },
    ],
    sparkles: [
      [83, 14, 4.5, 0],
      [18, 84, 3.2, 1100],
    ],
    sweeps: 1,
  },
  cobalt: {
    metal: COBALT,
    rim: PLATINUM,
    face: ['#ffffff', '#a9d3ff'],
    band: true,
    rivets: [],
    ring: true,
    rays: 16,
    gems: [
      { x: 50, y: 24, r: 6, c: BLUE_GEM },
      { x: 33, y: 24, r: 3.4, c: DIAMOND },
      { x: 67, y: 24, r: 3.4, c: DIAMOND },
      { x: 50, y: 88, r: 3.2, c: BLUE_GEM },
    ],
    sparkles: [
      [84, 13, 5, 0],
      [16, 30, 3.4, 700],
      [80, 78, 3.6, 1400],
      [26, 90, 3, 2100],
    ],
    sweeps: 2,
  },
};

// Shapes in a 100x120 box. Flat top with softened corners, straight sides,
// then curving in to a point: the medal silhouette.
const OUTER = 'M13,8 H87 Q92,8 92,13 V50 C92,78 74,98 50,113 C26,98 8,78 8,50 V13 Q8,8 13,8 Z';
const BEVEL = 'M19,14 H81 Q85,14 85,18 V50 C85,74 69,91 50,104 C31,91 15,74 15,50 V18 Q15,14 19,14 Z';
const FIELD = 'M22,19 H78 V50 C78,71 64,86 50,97 C36,86 22,71 22,50 Z';
const CX = 50;
const CY = 58;

let seq = 0;

/** The emblem as plain shapes in one color. Drawn three times (shadow,
 *  highlight, face) to read as stamped into the metal. */
function emblemShapes(e: BadgeEmblem, color: string, cut: string): string {
  switch (e.kind) {
    case 'plus':
      return `<path d="M45,41 h10 v12 h12 v10 h-12 v12 h-10 v-12 h-12 v-10 h12 z" fill="${color}" stroke="${color}" stroke-width="2" stroke-linejoin="round"/>`;
    case 'check':
      return `<path d="M37,59 L46,68 L64,47" fill="none" stroke="${color}" stroke-width="8" stroke-linecap="round" stroke-linejoin="round"/>`;
    case 'eye':
      return (
        `<path d="M31,58 Q50,38 69,58 Q50,78 31,58 Z" fill="${color}"/>` +
        `<circle cx="${CX}" cy="${CY}" r="8.5" fill="${cut}"/>` +
        `<circle cx="${CX}" cy="${CY}" r="4.2" fill="${color}"/>`
      );
    case 'number': {
      const s = String(e.value);
      const size = s.length <= 1 ? 30 : s.length === 2 ? 25 : s.length === 3 ? 19 : 15;
      return `<text x="${CX}" y="${CY}" dy="0.36em" text-anchor="middle" font-size="${size}" font-weight="800" letter-spacing="-0.5" font-family="Inter, system-ui, -apple-system, sans-serif" fill="${color}">${s}</text>`;
    }
  }
}

/** A cut gem set into the metal, seen from above: bezel, octagonal crown,
 *  a bright table, facet lines, one highlight. */
function setGem(id: string, g: { x: number; y: number; r: number; c: GemColors }, bezel: string): string {
  const oct = (r: number) =>
    Array.from({ length: 8 }, (_, i) => {
      const a = (i / 8) * Math.PI * 2 + Math.PI / 8;
      return [g.x + Math.cos(a) * r, g.y + Math.sin(a) * r];
    });
  const pts = (ps: number[][]) => ps.map((p) => `${p[0].toFixed(2)},${p[1].toFixed(2)}`).join(' ');
  const outer = oct(g.r);
  const table = oct(g.r * 0.5);
  const facets = outer
    .map((p, i) => `<line x1="${p[0].toFixed(2)}" y1="${p[1].toFixed(2)}" x2="${table[i][0].toFixed(2)}" y2="${table[i][1].toFixed(2)}"/>`)
    .join('');
  return (
    `<radialGradient id="${id}" cx="38%" cy="32%" r="75%">` +
    `<stop offset="0" stop-color="${g.c[0]}"/><stop offset="0.55" stop-color="${g.c[1]}"/><stop offset="1" stop-color="${g.c[2]}"/></radialGradient>` +
    `<circle cx="${g.x}" cy="${g.y}" r="${(g.r + 1.3).toFixed(2)}" fill="${bezel}"/>` +
    `<polygon points="${pts(outer)}" fill="url(#${id})"/>` +
    `<polygon points="${pts(table)}" fill="${g.c[0]}" opacity="0.7"/>` +
    `<g stroke="#fff" stroke-opacity="0.4" stroke-width="0.35">${facets}</g>` +
    `<circle cx="${(g.x - g.r * 0.32).toFixed(2)}" cy="${(g.y - g.r * 0.32).toFixed(2)}" r="${(g.r * 0.2).toFixed(2)}" fill="#fff" opacity="0.9"/>`
  );
}

/** A complete badge as an inline SVG string. Every id is unique per call, so
 *  any number of badges can share one page. */
export function badgeSvg(tier: BadgeTier, emblem: BadgeEmblem, label = ''): string {
  const T = TIERS[tier];
  const m = T.metal;
  const r = T.rim;
  const id = `bdg${++seq}`;

  const rays = Array.from({ length: T.rays }, (_, i) => {
    const a = (i / T.rays) * Math.PI * 2;
    const x = CX + Math.cos(a) * 60, y = CY + Math.sin(a) * 60;
    return `<line x1="${CX}" y1="${CY}" x2="${x.toFixed(1)}" y2="${y.toFixed(1)}"/>`;
  }).join('');

  const sparkle = ([x, y, s, delay]: [number, number, number, number]) =>
    `<path class="badge-twinkle" style="animation-delay:${delay}ms;transform-origin:${x}px ${y}px" ` +
    `d="M${x},${y - s} Q${x},${y} ${x + s},${y} Q${x},${y} ${x},${y + s} Q${x},${y} ${x - s},${y} Q${x},${y} ${x},${y - s} Z" fill="#fff"/>`;

  const sweeps = Array.from(
    { length: T.sweeps },
    (_, i) => `<rect class="badge-sweep${i ? ' badge-sweep-2' : ''}" x="-30" y="-10" width="${i ? 12 : 22}" height="140" fill="url(#${id}-sweep)"/>`
  ).join('');

  return (
    `<svg class="cobalt-badge badge-${tier}" viewBox="0 0 100 120" role="img" aria-label="${label || `${tier} badge`}">` +
    `<defs>` +
    `<linearGradient id="${id}-rim" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${r.light}"/><stop offset="0.35" stop-color="${r.mid}"/>` +
    `<stop offset="0.65" stop-color="${r.dark}"/><stop offset="1" stop-color="${r.mid}"/></linearGradient>` +
    `<linearGradient id="${id}-bevel" x1="0" y1="0" x2="1" y2="1">` +
    `<stop offset="0" stop-color="${r.dark}"/><stop offset="0.5" stop-color="${r.mid}"/><stop offset="1" stop-color="${r.light}"/></linearGradient>` +
    `<radialGradient id="${id}-field" cx="42%" cy="35%" r="75%">` +
    `<stop offset="0" stop-color="${m.light}"/><stop offset="0.5" stop-color="${m.mid}"/><stop offset="1" stop-color="${m.dark}"/></radialGradient>` +
    `<radialGradient id="${id}-disc" cx="40%" cy="35%" r="80%">` +
    `<stop offset="0" stop-color="${m.mid}"/><stop offset="1" stop-color="${m.dark}"/></radialGradient>` +
    `<linearGradient id="${id}-face" x1="0" y1="0" x2="0.4" y2="1">` +
    `<stop offset="0" stop-color="${T.face[0]}"/><stop offset="1" stop-color="${T.face[1]}"/></linearGradient>` +
    `<radialGradient id="${id}-rivet" cx="35%" cy="35%" r="70%">` +
    `<stop offset="0" stop-color="${r.light}"/><stop offset="1" stop-color="${r.deep}"/></radialGradient>` +
    `<linearGradient id="${id}-sweep" x1="0" y1="0" x2="1" y2="0">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0"/><stop offset="0.5" stop-color="#fff" stop-opacity="0.8"/>` +
    `<stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<linearGradient id="${id}-gloss" x1="0" y1="0" x2="0" y2="1">` +
    `<stop offset="0" stop-color="#fff" stop-opacity="0.4"/><stop offset="1" stop-color="#fff" stop-opacity="0"/></linearGradient>` +
    `<clipPath id="${id}-outer"><path d="${OUTER}"/></clipPath>` +
    `<clipPath id="${id}-field-clip"><path d="${FIELD}"/></clipPath>` +
    `</defs>` +
    // Drop shadow, then the rim and the recessed bevel inside it.
    `<path d="${OUTER}" transform="translate(0 2.5)" fill="#000" opacity="0.35"/>` +
    `<path d="${OUTER}" fill="url(#${id}-rim)" stroke="${r.deep}" stroke-width="1.2"/>` +
    `<path d="${BEVEL}" fill="url(#${id}-bevel)"/>` +
    // The field, with whatever this tier adds to it.
    `<path d="${FIELD}" fill="url(#${id}-field)" stroke="${m.deep}" stroke-width="0.8"/>` +
    `<g clip-path="url(#${id}-field-clip)">` +
    (T.rays ? `<g stroke="${m.dark}" stroke-width="1.2" opacity="0.22">${rays}</g>` : '') +
    (T.band
      ? `<rect x="22" y="19" width="56" height="10" fill="${m.dark}" opacity="0.45"/>` +
        `<line x1="22" y1="29" x2="78" y2="29" stroke="${m.light}" stroke-width="0.8" opacity="0.7"/>`
      : '') +
    `</g>` +
    T.rivets.map((x) => `<circle cx="${x}" cy="24" r="1.6" fill="url(#${id}-rivet)"/>`).join('') +
    (T.ring ? `<circle cx="${CX}" cy="${CY}" r="25" fill="none" stroke="${m.light}" stroke-width="1.1" opacity="0.75"/>` : '') +
    // The disc sits a shade darker than the field so the emblem's bright face reads.
    `<circle cx="${CX}" cy="${CY}" r="21" fill="url(#${id}-disc)" stroke="${m.deep}" stroke-width="0.9"/>` +
    // The emblem, stamped: shadow below-right, highlight above-left, then the face.
    `<g transform="translate(0.9 1.3)" opacity="0.75">${emblemShapes(emblem, m.deep, m.deep)}</g>` +
    `<g transform="translate(-0.6 -0.7)" opacity="0.6">${emblemShapes(emblem, '#fff', '#fff')}</g>` +
    `<g>${emblemShapes(emblem, `url(#${id}-face)`, m.dark)}</g>` +
    // Set gems (gold and cobalt only).
    T.gems.map((g, i) => setGem(`${id}-gem${i}`, g, r.deep)).join('') +
    // Shine: a fixed top gloss, then the looping light sweep(s), kept inside the medal.
    `<g clip-path="url(#${id}-outer)">` +
    `<ellipse cx="44" cy="10" rx="52" ry="30" fill="url(#${id}-gloss)"/>` +
    // Skew on the wrapper: the CSS animation owns each rect's own transform.
    `<g transform="skewX(-18)">${sweeps}</g>` +
    `</g>` +
    T.sparkles.map(sparkle).join('') +
    `</svg>`
  );
}
