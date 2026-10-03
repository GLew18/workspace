// Cobalt: Store — checkoff animation catalog.
//
// Started with 2 (Gabe, 9/29/26: "this one's honestly much harder... go with
// this for now"), then 5 more drafted and approved 9/30/26: Gem Burst, Smoke
// Puff, Light Sweep, Starburst Pulse, Ripple. Preview art only — the real
// effect (what actually plays when a task is checked off) lives in
// store/cosmetics.ts.

export interface CheckoffEffect {
  id: string;
  name: string;
  price: number;
  /** Card-preview icon only, not the real effect. */
  svg: string;
}

export const CHECKOFF_EFFECTS: CheckoffEffect[] = [
  {
    id: 'confetti',
    name: 'Confetti',
    price: 120,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<rect x="20" y="24" width="11" height="6" rx="1.5" fill="#7db4ff" transform="rotate(20 25 27)"/>` +
      `<rect x="55" y="16" width="11" height="6" rx="1.5" fill="#ffd25b" transform="rotate(-15 60 19)"/>` +
      `<rect x="66" y="52" width="11" height="6" rx="1.5" fill="#ff6f91" transform="rotate(35 71 55)"/>` +
      `<rect x="22" y="58" width="11" height="6" rx="1.5" fill="#6ee7a0" transform="rotate(-30 27 61)"/>` +
      `<rect x="44" y="70" width="11" height="6" rx="1.5" fill="#c792ff" transform="rotate(10 49 73)"/>` +
      `<circle cx="50" cy="40" r="4.5" fill="#ffd25b"/><circle cx="37" cy="46" r="3.2" fill="#7db4ff"/>` +
      `</svg>`,
  },
  {
    id: 'goldflash',
    name: 'Gold Flash',
    price: 350,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      // A gold ingot with a crack running through it (10/2 redesign).
      `<defs><linearGradient id="co-ingot" x1="0" y1="0" x2="0" y2="1">` +
      `<stop offset="0" stop-color="#f0d48a"/><stop offset="0.5" stop-color="#d2a84c"/><stop offset="1" stop-color="#a97c2a"/></linearGradient></defs>` +
      `<polygon points="22,30 78,30 90,72 10,72" fill="url(#co-ingot)" stroke="#7a520e" stroke-width="2" stroke-linejoin="round"/>` +
      `<polygon points="22,30 78,30 74,38 26,38" fill="#fff6d6" opacity="0.55"/>` +
      `<rect x="30" y="48" width="40" height="4" rx="2" fill="#1d1505" opacity="0.7"/>` +
      `<rect x="36" y="57" width="28" height="3" rx="1.5" fill="#1d1505" opacity="0.5"/>` +
      `<path d="M55,30 L50,42 L57,51 L49,62 L53,72" fill="none" stroke="#2a1b02" stroke-width="2.4" stroke-linejoin="round"/>` +
      `</svg>`,
  },
  {
    id: 'gemburst',
    name: 'Gem Burst',
    price: 200,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      // Faceted gems tumbling down (10/2 redesign: they fall, not burst).
      [
        [50, 14, 1.25, 0],
        [24, 46, 1, -18],
        [72, 52, 1.05, 14],
        [44, 74, 0.85, 8],
      ]
        .map(
          ([x, y, k, r]) =>
            `<g transform="translate(${x} ${y}) rotate(${r}) scale(${k}) translate(-12 -11)">` +
            `<polygon points="6,1 18,1 23,7 1,7" fill="#a8d6ff"/><polygon points="6,1 18,1 15,7 9,7" fill="#eaf5ff"/>` +
            `<polygon points="1,7 23,7 12,21" fill="#6aa8f5"/><polygon points="9,7 15,7 12,21" fill="#a8d6ff"/>` +
            `<polygon points="1,7 9,7 12,21" fill="#2f62c4"/></g>`
        )
        .join('') +
      `</svg>`,
  },
  {
    id: 'smokepuff',
    name: 'Smoke Puff',
    price: 90,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<circle cx="42" cy="60" r="16" fill="#b8bec8" opacity="0.5"/>` +
      `<circle cx="58" cy="54" r="13" fill="#ced3db" opacity="0.55"/>` +
      `<circle cx="48" cy="42" r="11" fill="#e4e7ec" opacity="0.6"/>` +
      `<circle cx="62" cy="34" r="7" fill="#eef0f3" opacity="0.55"/>` +
      `</svg>`,
  },
  {
    id: 'lightsweep',
    name: 'Light Sweep',
    price: 300,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<rect x="10" y="10" width="80" height="80" rx="14" fill="#1c2430"/>` +
      `<polygon points="20,90 40,10 56,10 36,90" fill="#fff" opacity="0.85"/>` +
      `<circle cx="60" cy="34" r="4" fill="#fff"/>` +
      `</svg>`,
  },
  {
    id: 'starburst',
    name: 'Starburst Pulse',
    price: 130,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<g stroke="#ffd25b" stroke-width="3.5" stroke-linecap="round">` +
      Array.from({ length: 8 }, (_, i) => {
        const a = (i / 8) * Math.PI * 2;
        const x1 = 50 + Math.cos(a) * 16,
          y1 = 50 + Math.sin(a) * 16;
        const x2 = 50 + Math.cos(a) * 40,
          y2 = 50 + Math.sin(a) * 40;
        return `<line x1="${x1.toFixed(1)}" y1="${y1.toFixed(1)}" x2="${x2.toFixed(1)}" y2="${y2.toFixed(1)}"/>`;
      }).join('') +
      `</g><circle cx="50" cy="50" r="9" fill="#fff"/>` +
      `</svg>`,
  },
  {
    id: 'ripple',
    name: 'Ripple',
    price: 100,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<circle cx="50" cy="50" r="38" fill="none" stroke="#7db4ff" stroke-width="2.5" opacity="0.3"/>` +
      `<circle cx="50" cy="50" r="25" fill="none" stroke="#7db4ff" stroke-width="3" opacity="0.55"/>` +
      `<circle cx="50" cy="50" r="12" fill="none" stroke="#7db4ff" stroke-width="4" opacity="0.85"/>` +
      `</svg>`,
  },
];

export const checkoffEffectById = (id: string): CheckoffEffect | undefined =>
  CHECKOFF_EFFECTS.find((e) => e.id === id);
