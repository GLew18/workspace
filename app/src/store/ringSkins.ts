// Cobalt: Shop — Focus ring skins.
//
// Gabe, 10/4: skins for the Focus timer ring, the thing a student stares at for
// a whole session. Gradient, neon in several colors, gold, gem-studded, and
// whole themes (outer space, ocean) built from gradients and their own little
// components. Sold in the Shop's Miscellaneous section; equipped skins change
// the REAL ring (focus/view.ts buildRing), in the session, the mini widget and
// the mini player alike.
//
// One markup function serves the real ring and the Shop preview, so the preview
// can never drift from what the student actually gets. Anything that has to
// follow the timer's progress carries class "ring-follow" next to the arc
// itself ("ring-fg"); focus/view.ts animates both. The last-five-minutes red is
// kept for every skin (ui/ringSkins.css): it's a signal, not decoration.

export interface RingSkin {
  id: string;
  name: string;
  price: number;
}

/** In price order. Ids carry a "ring-" prefix: the owned list is shared with
 *  every other Shop item. */
export const RING_SKINS: RingSkin[] = [
  { id: 'ring-neon-cyan', name: 'Neon Cyan', price: 450 },
  { id: 'ring-neon-green', name: 'Neon Green', price: 450 },
  { id: 'ring-neon-pink', name: 'Neon Pink', price: 450 },
  { id: 'ring-neon-orange', name: 'Neon Orange', price: 450 },
  { id: 'ring-aurora', name: 'Aurora', price: 540 },
  { id: 'ring-rainbow', name: 'Rainbow', price: 630 },
  { id: 'ring-gold', name: 'Gold', price: 720 },
  { id: 'ring-gems', name: 'Gem-Studded', price: 930 },
  { id: 'ring-ember', name: 'Ember', price: 1020 },
  { id: 'ring-ocean', name: 'Ocean', price: 1140 },
  { id: 'ring-space', name: 'Outer Space', price: 1290 },
];

export const ringSkinById = (id: string | undefined): RingSkin | undefined => RING_SKINS.find((s) => s.id === id);

const NEON: Record<string, string> = {
  'ring-neon-cyan': '#2ef2ff',
  'ring-neon-green': '#39ff88',
  'ring-neon-pink': '#ff4fd8',
  'ring-neon-orange': '#ff8a2a',
};

const C = 140; // the ring's center in its 280×280 viewBox
let seq = 0;

/** A tiny deterministic random, so a skin's stars and studs sit in the same
 *  places every time it's drawn (no reshuffle when the ring is rebuilt). */
function seeded(seed: number): () => number {
  let s = seed;
  return () => {
    s = (s * 16807) % 2147483647;
    return (s - 1) / 2147483646;
  };
}

/** The ring's full SVG contents for `skin` (undefined = the standard ring).
 *  `r` and `circ` are the ring's radius and circumference. */
export function ringMarkup(skin: string | undefined, r: number, circ: number): string {
  const id = `rs${++seq}`;
  const arc = (cls: string, extra = '') =>
    `<circle cx="${C}" cy="${C}" r="${r}" class="${cls}" stroke-dasharray="${circ.toFixed(2)}" stroke-dashoffset="0" transform="rotate(-90 ${C} ${C})"${extra}/>`;
  const track = `<circle cx="${C}" cy="${C}" r="${r}" class="ring-bg"/>`;
  const dot = `<circle cx="${C}" cy="${C - r}" r="6" class="ring-dot"/>`;
  const plain = track + arc('ring-fg') + dot;
  if (!skin) return plain;

  if (NEON[skin]) {
    // A neon tube: colored glow, and a hot white core that follows the arc.
    return (
      `<g style="--neon:${NEON[skin]}">` +
      track +
      arc('ring-fg') +
      arc('ring-follow ring-neon-core') +
      dot +
      `</g>`
    );
  }

  const grad = (stops: [number, string][], x1 = 0, y1 = 0, x2 = 280, y2 = 280) =>
    `<linearGradient id="${id}-g" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
    stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
    `</linearGradient>`;
  const fg = arc('ring-fg', ` style="stroke:url(#${id}-g)"`);

  switch (skin) {
    case 'ring-aurora':
      return (
        `<defs>${grad([[0, '#3dffa0'], [0.5, '#2ef2ff'], [1, '#5a7bff']])}</defs>` +
        track + fg + dot
      );

    case 'ring-rainbow':
      // The full spectrum, slowly cycling its hues (ui/ringSkins.css).
      return (
        `<defs>${grad([[0, '#ff4d4d'], [0.17, '#ff9a3c'], [0.33, '#ffe14d'], [0.5, '#4dff88'], [0.67, '#3cc8ff'], [0.83, '#5a7bff'], [1, '#d65cff']])}</defs>` +
        track + `<g class="ring-rainbow">${fg}</g>` + dot
      );

    case 'ring-ember': {
      // A fire-colored arc, a low glow inside, and embers drifting up.
      const rnd = seeded(5);
      const inner = r - 10;
      const embers = Array.from({ length: 14 }, () => {
        const x = C - inner * 0.75 + rnd() * inner * 1.5;
        const rr = 1 + rnd() * 1.8;
        return `<circle class="ring-ember-spark" cx="${x.toFixed(1)}" cy="${C + inner * 0.75}" r="${rr.toFixed(1)}" style="animation-delay:${(-rnd() * 4).toFixed(2)}s;animation-duration:${(2.6 + rnd() * 2).toFixed(2)}s"/>`;
      }).join('');
      return (
        `<defs>${grad([[0, '#fff3b0'], [0.35, '#ff9a3c'], [0.7, '#ff4d2e'], [1, '#a3160b']], 0, 0, 0, 280)}` +
        `<radialGradient id="${id}-heat" cx="50%" cy="95%" r="70%"><stop offset="0" stop-color="#ff7a2a" stop-opacity="0.32"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient>` +
        `<clipPath id="${id}-in"><circle cx="${C}" cy="${C}" r="${inner}"/></clipPath></defs>` +
        `<g clip-path="url(#${id}-in)"><circle cx="${C}" cy="${C}" r="${inner}" fill="url(#${id}-heat)"/>${embers}</g>` +
        track + fg +
        `<circle cx="${C}" cy="${C - r}" r="6" class="ring-dot ring-ember-dot"/>`
      );
    }

    case 'ring-gold':
      return (
        `<defs>${grad([[0, '#fff0b3'], [0.3, '#e3b444'], [0.55, '#8c6414'], [0.8, '#f2d27a'], [1, '#c9952f']])}</defs>` +
        track + fg + dot
      );

    case 'ring-gems': {
      // Gems set all the way round the band; the ones the arc still covers are
      // lit, the ones it has passed go dark (a mask that follows the arc).
      const rnd = seeded(7);
      const colors = ['#7db4ff', '#ff5c7a', '#4fd18b', '#ffd25b', '#c6e4ff'];
      const studs = Array.from({ length: 24 }, (_, i) => {
        const a = (i / 24) * Math.PI * 2 - Math.PI / 2;
        const x = C + Math.cos(a) * r;
        const y = C + Math.sin(a) * r;
        const s = 5.2 + rnd() * 0.8;
        const deg = (a * 180) / Math.PI + 90;
        return (
          `<g transform="translate(${x.toFixed(1)} ${y.toFixed(1)}) rotate(${deg.toFixed(0)})">` +
          `<polygon points="0,${-s} ${s * 0.8},0 0,${s} ${-s * 0.8},0" fill="${colors[i % colors.length]}" stroke="#fff6d6" stroke-width="0.8"/>` +
          `<polygon points="0,${-s} ${s * 0.8},0 0,0" fill="#fff" opacity="0.45"/></g>`
        );
      }).join('');
      return (
        `<defs>${grad([[0, '#fff0b3'], [0.5, '#d9a93c'], [1, '#a97c2a']])}` +
        `<mask id="${id}-lit" maskUnits="userSpaceOnUse" x="0" y="0" width="280" height="280">` +
        arc('ring-follow ring-mask-arc') +
        `</mask></defs>` +
        track + fg +
        `<g class="ring-studs dim">${studs}</g>` +
        `<g class="ring-studs lit" mask="url(#${id}-lit)">${studs}</g>` +
        dot
      );
    }

    case 'ring-ocean': {
      // Deep water inside the ring: two waves rolling past and bubbles rising.
      const rnd = seeded(11);
      const inner = r - 9;
      const wave = (y: number, amp: number, cls: string) => {
        let d = `M ${C - inner * 2} ${y}`;
        for (let x = -inner * 2; x <= inner * 2; x += 40) d += ` q 20 ${-amp} 40 0`;
        return `<path class="${cls}" d="${d} V ${C + inner} H ${C - inner * 2} Z"/>`;
      };
      const bubbles = Array.from({ length: 9 }, () => {
        const x = C - inner * 0.7 + rnd() * inner * 1.4;
        const rr = 2 + rnd() * 3.5;
        return `<circle class="ring-bubble" cx="${x.toFixed(1)}" cy="${C + inner * 0.8}" r="${rr.toFixed(1)}" style="animation-delay:${(-rnd() * 6).toFixed(2)}s;animation-duration:${(4 + rnd() * 3).toFixed(2)}s"/>`;
      }).join('');
      return (
        `<defs>${grad([[0, '#7ff5e6'], [0.5, '#2bb6d6'], [1, '#1d5fc9']])}` +
        `<clipPath id="${id}-in"><circle cx="${C}" cy="${C}" r="${inner}"/></clipPath>` +
        `<linearGradient id="${id}-sea" x1="0" y1="0" x2="0" y2="1"><stop offset="0" stop-color="#2bb6d6" stop-opacity="0.35"/><stop offset="1" stop-color="#0a2a6b" stop-opacity="0.6"/></linearGradient></defs>` +
        `<g clip-path="url(#${id}-in)" class="ring-ocean" style="--sea:url(#${id}-sea)">` +
        `<g class="ring-wave back">${wave(C + inner * 0.32, 10, 'ring-wave-path')}</g>` +
        `<g class="ring-wave front">${wave(C + inner * 0.42, 8, 'ring-wave-path')}</g>` +
        bubbles +
        `</g>` +
        track + fg +
        `<circle cx="${C}" cy="${C - r}" r="7" class="ring-dot ring-pearl"/>`
      );
    }

    case 'ring-space': {
      // A starfield inside the ring, a nebula-colored arc, and a ringed planet
      // where the arc starts.
      const rnd = seeded(3);
      const inner = r - 12;
      const stars = Array.from({ length: 46 }, (_, i) => {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * inner;
        const x = C + Math.cos(a) * d;
        const y = C + Math.sin(a) * d;
        const s = 0.5 + rnd() * 1.3;
        const tw = i % 3 === 0 ? ` class="ring-star tw" style="animation-delay:${(-rnd() * 3).toFixed(2)}s"` : ' class="ring-star"';
        return `<circle cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${s.toFixed(2)}"${tw}/>`;
      }).join('');
      return (
        `<defs>${grad([[0, '#ff6fd8'], [0.5, '#7a5cff'], [1, '#2ef2ff']])}` +
        `<radialGradient id="${id}-neb" cx="35%" cy="40%" r="70%"><stop offset="0" stop-color="#7a5cff" stop-opacity="0.22"/><stop offset="0.6" stop-color="#2ef2ff" stop-opacity="0.06"/><stop offset="1" stop-color="#000" stop-opacity="0"/></radialGradient></defs>` +
        `<circle cx="${C}" cy="${C}" r="${inner}" fill="url(#${id}-neb)"/>` +
        `<g class="ring-stars">${stars}</g>` +
        track + fg +
        `<g class="ring-planet" transform="translate(${C} ${C - r})">` +
        `<circle r="8" fill="#ffb35a"/><circle r="8" fill="url(#${id}-g)" opacity="0.35"/>` +
        `<ellipse rx="13" ry="3.6" fill="none" stroke="#ffe3b0" stroke-width="1.6" transform="rotate(-20)"/></g>`
      );
    }
  }
  return plain;
}
