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
// cool"): Pearl through Sun get a subtle looping animation (shimmer/twinkle/
// spin/glow — classes defined in ui/gemAnim.css), the cheaper 7 stay static.
//
// 15 items: Gabe's own list (donut, basketball, soccer ball, bowling ball,
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
const wrap = (id: string, inner: string): string =>
  `<svg class="ws-mon" viewBox="0 0 100 100" aria-hidden="true" focusable="false" data-gem="${id}">` +
  `<defs><clipPath id="${id}-clip"><rect x="9" y="9" width="82" height="82" rx="31" ry="31"/></clipPath></defs>` +
  `<g transform="rotate(-8 50 50) translate(50 50) scale(0.92) translate(-50 -50)" clip-path="url(#${id}-clip)">` +
  inner +
  `</g></svg>`;

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

function item(id: string, name: string, price: number, inner: string): GemAlt {
  return { id, name, price, svg: wrap(id, inner) };
}

export const GEM_ALTS: GemAlt[] = [
  item(
    'donut',
    'Donut',
    40,
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
    35,
    body('gumball', '#ff9fd6', '#ff4fa8', '#b0106b') +
      `<ellipse cx="60" cy="62" rx="7" ry="4" fill="#fff" opacity="0.3"/>` +
      `<circle cx="46" cy="26" r="2.4" fill="#fff" opacity="0.5"/>`
  ),
  item(
    'apple',
    'Apple',
    45,
    body('apple', '#ff8f7a', '#e8402c', '#8f1710') +
      `<path d="M50,16 V70" stroke="#ff6a52" stroke-width="2.5" opacity="0.35"/>` +
      `<path d="M50,14 Q56,6 64,10 Q58,16 50,18 Z" fill="#3fa64a"/>` +
      `<path d="M50,14 Q53,10 56,9" stroke="#2c7a35" stroke-width="1" fill="none" opacity="0.6"/>` +
      `<rect x="48.5" y="8" width="3" height="10" rx="1.4" fill="#6b4321"/>`
  ),
  item(
    'basketball',
    'Basketball',
    60,
    body('basketball', '#ffb066', '#ee7a1f', '#8f4405') +
      `<path d="M50,9 V91 M9,50 H91" stroke="#26160a" stroke-width="2.4"/>` +
      `<path d="M15,20 Q50,50 15,80" fill="none" stroke="#26160a" stroke-width="2.4"/>` +
      `<path d="M85,20 Q50,50 85,80" fill="none" stroke="#26160a" stroke-width="2.4"/>`
  ),
  item(
    'soccer',
    'Soccer Ball',
    60,
    body('soccer', '#ffffff', '#e7ebee', '#9aa4ab') +
      `<polygon points="50,36 60,43 56,55 44,55 40,43" fill="#1c2126"/>` +
      `<polygon points="50,36 44,25 56,25" fill="#1c2126" opacity="0.85"/>` +
      `<polygon points="30,50 40,43 44,55 36,64" fill="#1c2126" opacity="0.85"/>` +
      `<polygon points="70,50 60,43 56,55 64,64" fill="#1c2126" opacity="0.85"/>`
  ),
  item(
    'bowling',
    'Bowling Ball',
    70,
    body('bowling', '#5b6b8c', '#22283a', '#08090f') +
      `<circle cx="46" cy="24" r="3" fill="#05060a"/>` +
      `<circle cx="58" cy="26" r="3" fill="#05060a"/>` +
      `<circle cx="52" cy="34" r="3" fill="#05060a"/>`
  ),
  item(
    'eightball',
    'Eight Ball',
    90,
    body('eightball', '#5a5f66', '#1b1d21', '#000000') +
      `<circle cx="50" cy="52" r="17" fill="#f4efe4"/>` +
      `<text x="50" y="58" font-size="17" font-weight="700" text-anchor="middle" fill="#15181c" font-family="Georgia, serif">8</text>`
  ),

  // --- 150+ gems: animated (Gabe, 9/30/26) ---------------------------------

  item(
    'pearl',
    'Pearl',
    150,
    body('pearl', '#fff9f4', '#f3e6ea', '#cdc5d8') +
      `<ellipse cx="42" cy="34" rx="20" ry="13" fill="#ffd9ec" opacity="0.4"/>` +
      `<ellipse cx="58" cy="56" rx="16" ry="10" fill="#cdeeff" opacity="0.35"/>` +
      `<ellipse cx="46" cy="48" rx="12" ry="22" fill="#ffe9bf" opacity="0.22"/>` +
      `<ellipse class="gem-shimmer" cx="38" cy="30" rx="15" ry="9" fill="#fff" opacity="0.7"/>`
  ),
  item(
    'discoball',
    'Disco Ball',
    180,
    body('discoball', '#eef2f6', '#bcc6d1', '#6b7784') +
      `<g class="gem-spin" style="transform-origin:50px 50px" stroke="#5a636e" stroke-width="0.6" opacity="0.75">` +
      `<path d="M13,50 H87 M50,13 V87 M20,26 L80,74 M20,74 L80,26"/>` +
      `<circle cx="50" cy="50" r="28" fill="none"/><circle cx="50" cy="50" r="16" fill="none"/>` +
      `</g>` +
      `<circle class="gem-twinkle" style="animation-delay:0ms" cx="34" cy="30" r="1.8" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:260ms" cx="66" cy="34" r="1.5" fill="#9ad8ff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:520ms" cx="58" cy="66" r="1.8" fill="#ffd25b"/>` +
      `<circle class="gem-twinkle" style="animation-delay:780ms" cx="30" cy="62" r="1.4" fill="#ff9fd6"/>`
  ),
  item(
    'goldcoin',
    'Gold Coin',
    220,
    body('goldcoin', '#fff3b8', '#e8b93a', '#8a610f') +
      `<circle cx="50" cy="50" r="33" fill="none" stroke="#8a610f" stroke-width="2.5" opacity="0.65"/>` +
      `<circle cx="50" cy="50" r="27" fill="none" stroke="#fff3b8" stroke-width="1" opacity="0.5"/>` +
      `<text x="50" y="58" font-size="26" font-weight="700" text-anchor="middle" fill="#8a610f" font-family="Georgia, serif" opacity="0.85">C</text>` +
      `<ellipse class="gem-shimmer" cx="34" cy="26" rx="20" ry="8" fill="#fff" opacity="0.55" transform="rotate(-30 34 26)"/>`
  ),
  item(
    'crystalball',
    'Crystal Ball',
    200,
    body('crystalball', '#eaf6ff', '#a9d3ee', '#6f8fc9') +
      `<g class="gem-spin" style="transform-origin:50px 50px; animation-duration:9s">` +
      `<path d="M28,60 Q50,40 72,60" fill="none" stroke="#fff" stroke-width="2" opacity="0.55"/>` +
      `<path d="M34,68 Q50,54 66,68" fill="none" stroke="#fff" stroke-width="1.4" opacity="0.4"/>` +
      `<path d="M30,44 Q50,30 70,44" fill="none" stroke="#fff" stroke-width="1.2" opacity="0.3"/>` +
      `</g>` +
      `<ellipse cx="38" cy="30" rx="14" ry="9" fill="#fff" opacity="0.6"/>`
  ),
  item(
    'diamond',
    'Diamond',
    350,
    body('diamond', '#f2fbff', '#c9ecfb', '#8fcdf0') +
      `<polygon points="50,20 68,38 50,80 32,38" fill="#dff3ff" opacity="0.55"/>` +
      `<polygon points="50,20 68,38 50,50" fill="#ffffff" opacity="0.5"/>` +
      `<polygon points="50,20 32,38 50,50" fill="#9fd4f2" opacity="0.55"/>` +
      `<polygon points="68,38 50,80 50,50" fill="#7fc2ea" opacity="0.6"/>` +
      `<polygon points="32,38 50,80 50,50" fill="#bfe6fb" opacity="0.5"/>` +
      `<polygon points="38,32 62,32 50,20" fill="#ffffff" opacity="0.8"/>` +
      `<circle class="gem-twinkle" style="animation-delay:0ms" cx="50" cy="34" r="2.4" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:400ms" cx="40" cy="50" r="1.6" fill="#fff"/>` +
      `<circle class="gem-twinkle" style="animation-delay:800ms" cx="60" cy="56" r="1.6" fill="#fff"/>`
  ),
  item(
    'moon',
    'Moon',
    300,
    `<ellipse class="gem-glow-pulse" cx="50" cy="50" rx="40" ry="40" fill="#d7dbe3" opacity="0.3"/>` +
      body('moon', '#f2f2f0', '#c7c9cf', '#8c8f98') +
      `<circle cx="38" cy="36" r="6" fill="#9a9ca3" opacity="0.6"/>` +
      `<circle cx="60" cy="30" r="4" fill="#9a9ca3" opacity="0.5"/>` +
      `<circle cx="58" cy="58" r="8" fill="#9a9ca3" opacity="0.55"/>` +
      `<circle cx="34" cy="60" r="3.5" fill="#9a9ca3" opacity="0.5"/>` +
      `<circle cx="68" cy="48" r="2.5" fill="#9a9ca3" opacity="0.45"/>`
  ),
  item(
    'earth',
    'Earth',
    400,
    body('earth', '#8fd0ff', '#2f80c9', '#0d3a68') +
      `<ellipse cx="50" cy="13" rx="20" ry="6" fill="#eef7ff" opacity="0.85"/>` +
      `<ellipse cx="50" cy="89" rx="18" ry="5" fill="#eef7ff" opacity="0.75"/>` +
      `<g class="gem-spin" style="transform-origin:50px 50px; animation-duration:14s">` +
      `<path d="M20,40 Q30,32 40,38 Q48,34 46,44 Q38,50 28,48 Q20,46 20,40 Z" fill="#4caf5e"/>` +
      `<path d="M55,55 Q66,50 76,58 Q78,66 68,68 Q56,66 55,55 Z" fill="#4caf5e"/>` +
      `<path d="M48,20 Q56,18 58,26 Q52,28 48,20 Z" fill="#4caf5e" opacity="0.9"/>` +
      `<path d="M62,30 Q70,28 71,35 Q65,37 62,30 Z" fill="#3f9950" opacity="0.85"/>` +
      `<path d="M28,65 Q35,62 37,69 Q31,72 28,65 Z" fill="#3f9950" opacity="0.85"/>` +
      `</g>`
  ),
  item(
    'sun',
    'Sun',
    550,
    `<g class="gem-spin" style="transform-origin:50px 50px; animation-duration:20s">` +
      `<g class="gem-rays-pulse" style="transform-origin:50px 50px" stroke="#ffb64d" stroke-width="3.4" stroke-linecap="round" opacity="0.9">` +
      Array.from({ length: 12 }, (_, i) => {
        const a = (i / 12) * Math.PI * 2;
        const x1 = 50 + Math.cos(a) * 45,
          y1 = 50 + Math.sin(a) * 45;
        const x2 = 50 + Math.cos(a) * 33,
          y2 = 50 + Math.sin(a) * 33;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      }).join('') +
      `</g></g>` +
      body('sun', '#fff4b0', '#ffb020', '#c94e0e')
  ),
];

export const gemAltById = (id: string): GemAlt | undefined => GEM_ALTS.find((g) => g.id === id);
