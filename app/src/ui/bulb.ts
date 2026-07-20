// WorkSpace — minimalist lightbulb logo.
//
// Brightness reflects the share of today's tasks completed: dim & mundane at 0%,
// bright & luminescent at 100%. Used in the header and on the Dashboard so they
// always correspond. (A richer animation comes later in the styling pass.)

export interface Bulb {
  el: HTMLElement;
  update: (pct: number) => void;
}

const BULB_PATH =
  'M12 2.5a6.5 6.5 0 0 0-4 11.65c.72.57 1.2 1.4 1.32 2.3l.1.55h5.16l.1-.55c.12-.9.6-1.73 1.32-2.3A6.5 6.5 0 0 0 12 2.5z';

export function createBulb(size = 26): Bulb {
  const wrap = document.createElement('span');
  wrap.className = 'ws-bulb';
  wrap.style.width = `${size}px`;
  wrap.style.height = `${size}px`;
  wrap.innerHTML = `<svg viewBox="0 0 24 24" width="${size}" height="${size}" fill="none">
    <path class="bulb-fill" d="${BULB_PATH}"/>
    <path class="bulb-outline" d="${BULB_PATH}" stroke-width="1.5" stroke-linejoin="round"/>
    <path class="bulb-base" d="M9.5 19h5M10.5 21h3" stroke-width="1.5" stroke-linecap="round"/>
  </svg>`;

  const fill = wrap.querySelector('.bulb-fill') as SVGPathElement;
  const outline = wrap.querySelector('.bulb-outline') as SVGPathElement;

  const update = (pct: number): void => {
    const p = Math.max(0, Math.min(1, pct));
    // Glass fills with warm light; opacity ramps from a faint glow to full.
    fill.style.fill = `rgba(255, 214, 102, ${(0.08 + 0.9 * p).toFixed(3)})`;
    // Outline brightens from neutral grey to warm gold.
    const o = 0.4 + 0.6 * p;
    outline.style.stroke =
      p > 0.05 ? `rgba(255, 224, 150, ${o.toFixed(3)})` : 'rgba(255,255,255,0.45)';
    // Halo grows with progress.
    wrap.style.filter = `drop-shadow(0 0 ${(1 + 16 * p).toFixed(1)}px rgba(255, 196, 74, ${(0.12 + 0.7 * p).toFixed(3)}))`;
  };

  update(0);
  return { el: wrap, update };
}
