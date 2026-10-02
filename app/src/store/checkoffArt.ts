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
    price: 150,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<rect x="15" y="15" width="70" height="70" rx="14" fill="none" stroke="#e8b93a" stroke-width="4"/>` +
      `<path d="M32,52 L45,65 L70,35" fill="none" stroke="#ffd25b" stroke-width="7" stroke-linecap="round" stroke-linejoin="round"/>` +
      `<g stroke="#ffd25b" stroke-width="3" stroke-linecap="round">` +
      `<line x1="50" y1="3" x2="50" y2="11"/><line x1="89" y1="19" x2="82" y2="25"/><line x1="11" y1="19" x2="18" y2="25"/>` +
      `</g></svg>`,
  },
  {
    id: 'gemburst',
    name: 'Gem Burst',
    price: 160,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<polygon points="50,38 58,50 50,62 42,50" fill="#7db4ff" transform="rotate(10 50 50)"/>` +
      `<polygon points="24,22 29,30 24,38 19,30" fill="#9ad8ff"/>` +
      `<polygon points="76,24 81,32 76,40 71,32" fill="#5a9bef"/>` +
      `<polygon points="22,66 27,74 22,82 17,74" fill="#5a9bef"/>` +
      `<polygon points="78,64 83,72 78,80 73,72" fill="#9ad8ff"/>` +
      `<circle cx="50" cy="50" r="3" fill="#fff" opacity="0.8"/>` +
      `</svg>`,
  },
  {
    id: 'smokepuff',
    name: 'Smoke Puff',
    price: 130,
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
    price: 140,
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
    price: 110,
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
