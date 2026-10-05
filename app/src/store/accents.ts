// Cobalt: Shop — accent colors.
//
// Gabe, 10/4: swap Cobalt's blue accent for another color across the app, from
// a fixed set of options (never a free color picker), priced at 400 each (first 1500, cut 10/4). VIOLET IS
// OFF-LIMITS: it is the mark of Cobalt Plus, and an accent that matched it
// would make every ordinary control read as premium.
//
// Applied by overriding the three accent tokens (ui/theme.css: --accent,
// --accent-rgb, --on-accent) on the root, in the app only: the marketing pages
// stay Cobalt blue, like the wordmark's default stone. The override is a
// <style> in <head>, not inline styles, because the Focus mini player copies
// the page's stylesheets into its own window and would miss inline ones.

export interface Accent {
  id: string;
  name: string;
  price: number;
  hex: string;
  /** r, g, b of `hex`, for the translucent tints. */
  rgb: string;
  /** Near-black text for an accent fill, tinted toward the hue. */
  on: string;
}

/** Ids carry an "accent-" prefix: the owned list is shared with every Shop item. */
export const ACCENTS: Accent[] = [
  { id: 'accent-sky', name: 'Sky', price: 400, hex: '#5fd4ee', rgb: '95, 212, 238', on: '#04232b' },
  { id: 'accent-teal', name: 'Teal', price: 400, hex: '#4fd1b5', rgb: '79, 209, 181', on: '#062a22' },
  { id: 'accent-emerald', name: 'Emerald', price: 400, hex: '#5ad37f', rgb: '90, 211, 127', on: '#072a12' },
  { id: 'accent-lime', name: 'Lime', price: 400, hex: '#b6e35a', rgb: '182, 227, 90', on: '#1e2a06' },
  { id: 'accent-gold', name: 'Gold', price: 400, hex: '#f2c14e', rgb: '242, 193, 78', on: '#2b1f03' },
  { id: 'accent-tangerine', name: 'Tangerine', price: 400, hex: '#ff9f5a', rgb: '255, 159, 90', on: '#2e1404' },
  { id: 'accent-coral', name: 'Coral', price: 400, hex: '#ff8a80', rgb: '255, 138, 128', on: '#2e0a0a' },
  { id: 'accent-rose', name: 'Rose', price: 400, hex: '#ff8fc0', rgb: '255, 143, 192', on: '#2e0a1c' },
  { id: 'accent-mint', name: 'Mint', price: 400, hex: '#8ff0c8', rgb: '143, 240, 200', on: '#062a1d' },
  { id: 'accent-lemon', name: 'Lemon', price: 400, hex: '#f2e36a', rgb: '242, 227, 106', on: '#2a2505' },
  { id: 'accent-silver', name: 'Silver', price: 400, hex: '#c9d3e0', rgb: '201, 211, 224', on: '#12161c' },
];

/** The default accent, for previews (matches ui/theme.css). */
export const COBALT_BLUE = '#7db4ff';

export const accentById = (id: string | undefined): Accent | undefined => ACCENTS.find((a) => a.id === id);

/** The accent in force right now: an equipped Shop accent in the app, Cobalt blue
 *  everywhere else. For colors that have to be a literal value (a picker's
 *  starting color, an SVG attribute) rather than var(--accent) (Gabe, 10/4: no
 *  Cobalt-blue remnants once the accent is changed). */
export function currentAccentHex(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent').trim();
  return /^#[0-9a-f]{6}$/i.test(v) ? v : COBALT_BLUE;
}
/** Same, as the "r, g, b" triple the translucent tints use. */
export function currentAccentRgb(): string {
  const v = getComputedStyle(document.documentElement).getPropertyValue('--accent-rgb').trim();
  return /^\d+,\s*\d+,\s*\d+$/.test(v) ? v : '125, 180, 255';
}

const STYLE_ID = 'cobalt-accent';

/** Applies accent `id` app-wide, or restores Cobalt blue for undefined. */
export function applyAccent(id: string | undefined): void {
  const a = accentById(id);
  let style = document.getElementById(STYLE_ID) as HTMLStyleElement | null;
  if (!a) {
    style?.remove();
    return;
  }
  if (!style) {
    style = document.createElement('style');
    style.id = STYLE_ID;
    document.head.append(style);
  }
  // App screens and the mini player only; the landing pages keep the brand blue.
  style.textContent =
    `html:has(body.app-mode), html:has(.focus-pip-body) {` +
    `--accent: ${a.hex}; --accent-rgb: ${a.rgb}; --on-accent: ${a.on}; }`;
}
