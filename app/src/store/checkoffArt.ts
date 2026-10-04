// Cobalt: Store — checkoff animation catalog, in price order.
//
// Started with 2 (Gabe, 9/29/26), 5 more approved 9/30/26, reworked and
// re-priced 10/2–10/3. Gabe's pricing rule: checkbox animations are the cheap
// tier (Ripple < Starburst < Confetti < Smoke Puff < Bubbles < Sparkler, then Gem
// Burst), whole-row animations cost more (Highlighter, Light Sweep, Gold Break), and the
// wild ones that use the checkbox AND the row cost the most, ranked by
// intensity. Preview art only — the real effects live in
// store/checkoffEffects.ts.

export interface CheckoffEffect {
  id: string;
  name: string;
  price: number;
  /** Card-preview icon only, not the real effect. */
  svg: string;
}

export const CHECKOFF_EFFECTS: CheckoffEffect[] = [
  {
    id: 'ripple',
    name: 'Ripple',
    price: 120,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<circle cx="50" cy="50" r="38" fill="none" stroke="#7db4ff" stroke-width="2.5" opacity="0.3"/>` +
      `<circle cx="50" cy="50" r="25" fill="none" stroke="#7db4ff" stroke-width="3" opacity="0.55"/>` +
      `<circle cx="50" cy="50" r="12" fill="none" stroke="#7db4ff" stroke-width="4" opacity="0.85"/>` +
      `</svg>`,
  },
  {
    id: 'starburst',
    name: 'Starburst Pulse',
    price: 150,
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
    id: 'confetti',
    name: 'Confetti',
    price: 180,
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
    id: 'smokepuff',
    name: 'Smoke Puff',
    price: 210,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<circle cx="42" cy="60" r="16" fill="#b8bec8" opacity="0.5"/>` +
      `<circle cx="58" cy="54" r="13" fill="#ced3db" opacity="0.55"/>` +
      `<circle cx="48" cy="42" r="11" fill="#e4e7ec" opacity="0.6"/>` +
      `<circle cx="62" cy="34" r="7" fill="#eef0f3" opacity="0.55"/>` +
      `</svg>`,
  },
  {
    id: 'bubbles',
    name: 'Bubbles',
    price: 235,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<circle cx="40" cy="64" r="16" fill="#7db4ff" fill-opacity="0.12" stroke="#9fd0ff" stroke-width="2.5"/>` +
      `<circle cx="64" cy="40" r="11" fill="#7db4ff" fill-opacity="0.12" stroke="#9fd0ff" stroke-width="2.2"/>` +
      `<circle cx="44" cy="28" r="6" fill="#7db4ff" fill-opacity="0.12" stroke="#9fd0ff" stroke-width="2"/>` +
      `<circle cx="34" cy="58" r="3.5" fill="#fff" opacity="0.8"/><circle cx="60" cy="36" r="2.4" fill="#fff" opacity="0.8"/>` +
      `</svg>`,
  },
  {
    id: 'sparkler',
    name: 'Sparkler',
    price: 260,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<circle cx="50" cy="64" r="12" fill="#fff1b8" opacity="0.9"/>` +
      `<g stroke-linecap="round" stroke-width="3">` +
      [[-62, 34, '#ffd25b'], [-88, 40, '#ffffff'], [-115, 32, '#ffd25b'], [-40, 26, '#fff1b8'], [-140, 26, '#fff1b8'], [-75, 22, '#ffffff'], [-102, 20, '#ffd25b']]
        .map(([a, r, c]) => {
          const t = ((a as number) * Math.PI) / 180;
          return `<line x1="${(50 + Math.cos(t) * 14).toFixed(1)}" y1="${(64 + Math.sin(t) * 14).toFixed(1)}" x2="${(50 + Math.cos(t) * (r as number)).toFixed(1)}" y2="${(64 + Math.sin(t) * (r as number)).toFixed(1)}" stroke="${c}"/>`;
        })
        .join('') +
      `</g><circle cx="50" cy="64" r="5" fill="#fff"/>` +
      `</svg>`,
  },
  {
    id: 'gemburst',
    name: 'Gem Burst',
    price: 300,
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
    id: 'highlighter',
    name: 'Highlighter',
    price: 400,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<rect x="14" y="44" width="62" height="16" rx="3" fill="#ffe24d" opacity="0.55"/>` +
      `<line x1="14" y1="52" x2="76" y2="52" stroke="#fff" stroke-width="3" stroke-linecap="round"/>` +
      `<g transform="rotate(35 76 46)"><rect x="70" y="16" width="13" height="34" rx="2.5" fill="#ffd25b"/>` +
      `<rect x="70" y="16" width="13" height="9" rx="2.5" fill="#3a3f4a"/><polygon points="71,50 82,50 79,58 74,58" fill="#ffe24d"/></g>` +
      `</svg>`,
  },
  {
    id: 'lightsweep',
    name: 'Light Sweep',
    price: 450,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<rect x="10" y="10" width="80" height="80" rx="14" fill="#1c2430"/>` +
      `<polygon points="20,90 40,10 56,10 36,90" fill="#fff" opacity="0.85"/>` +
      `<circle cx="60" cy="34" r="4" fill="#fff"/>` +
      `</svg>`,
  },
  {
    id: 'goldflash',
    name: 'Gold Break',
    price: 530,
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
    id: 'rocket',
    name: 'Rocket',
    price: 680,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<path d="M14,62 H58" stroke="#c6cdd6" stroke-width="3" stroke-linecap="round" opacity="0.8"/>` +
      `<g transform="translate(52 46) rotate(-28)">` +
      `<path d="M0,8 Q-12,12 0,16 Q-5,12 0,8 Z" fill="#ffb347"/>` +
      `<path d="M4,5 L-2,0 L2,9 Z M4,19 L-2,24 L2,15 Z" fill="#e5484d"/>` +
      `<path d="M0,7 H24 Q36,7 37,12 Q36,17 24,17 H0 Z" fill="#e9eef5"/>` +
      `<path d="M27,7.4 Q36,8 37,12 Q36,16 27,16.6 Q30,12 27,7.4 Z" fill="#e5484d"/>` +
      `<circle cx="17" cy="12" r="3.2" fill="#5a9bef"/></g>` +
      `<g fill="#ffd25b"><circle cx="82" cy="18" r="2.5"/><circle cx="90" cy="28" r="2"/><circle cx="74" cy="10" r="2"/></g>` +
      `</svg>`,
  },
  {
    id: 'lightning',
    name: 'Lightning Strike',
    price: 750,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<path d="M58,6 L34,52 H50 L40,94 L70,40 H53 L66,6 Z" fill="#eaf4ff" stroke="#7db4ff" stroke-width="3" stroke-linejoin="round"/>` +
      `<circle cx="40" cy="92" r="7" fill="#7db4ff" opacity="0.5"/>` +
      `</svg>`,
  },
  {
    id: 'wildfire',
    name: 'Wildfire',
    price: 830,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<path d="M50,92 C26,92 20,70 30,54 C34,64 40,64 40,56 C40,40 52,30 50,10 C66,22 80,44 76,66 C74,82 64,92 50,92 Z" fill="#ff7a1f"/>` +
      `<path d="M50,92 C38,92 34,80 40,70 C44,76 48,74 48,68 C48,58 56,52 56,42 C66,54 70,66 66,78 C64,86 58,92 50,92 Z" fill="#ffd25b"/>` +
      `<circle cx="24" cy="30" r="2.5" fill="#ffcf6a"/><circle cx="80" cy="20" r="2" fill="#ffcf6a"/>` +
      `</svg>`,
  },
  {
    id: 'blackhole',
    name: 'Black Hole',
    price: 900,
    svg:
      `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
      `<defs><radialGradient id="co-bh" cx="50%" cy="50%" r="50%"><stop offset="0.38" stop-color="#000"/><stop offset="0.5" stop-color="#ffb35a"/><stop offset="0.62" stop-color="#a45cff"/><stop offset="0.8" stop-color="#5a9bef" stop-opacity="0.5"/><stop offset="1" stop-color="#5a9bef" stop-opacity="0"/></radialGradient></defs>` +
      `<ellipse cx="50" cy="50" rx="44" ry="44" fill="url(#co-bh)"/>` +
      `<ellipse cx="50" cy="50" rx="42" ry="10" fill="none" stroke="#ffd27a" stroke-width="2.5" opacity="0.85" transform="rotate(-18 50 50)"/>` +
      `<circle cx="50" cy="50" r="15" fill="#000"/>` +
      `</svg>`,
  },
];

export const checkoffEffectById = (id: string): CheckoffEffect | undefined =>
  CHECKOFF_EFFECTS.find((e) => e.id === id);
