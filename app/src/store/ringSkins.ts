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
// itself ("ring-fg"); focus/view.ts animates both.
//
// EVERY SKIN IS A BUNDLE OF THREE (Gabe, 10/10): the work look the Shop shows,
// a hotter LAST-FIVE-MINUTES look, and a calm REST look for Pomodoro breaks.
// The two alternates are extra arcs ("ring-alt") that cross-fade in over the
// work arc when the ring is marked .urgent or .rest (ui/ringSkins.css). Only the
// work look is ever shown in the Shop; the full set is in labs/ringLab.ts.

export interface RingSkin {
  id: string;
  name: string;
  price: number;
}

/** In price order. Ids carry a "ring-" prefix: the owned list is shared with
 *  every other Shop item. */
export const RING_SKINS: RingSkin[] = [
  // ONE neon (Gabe, 10/10). It keeps the cyan id so anyone who bought it still
  // owns it; Green, Pink and Orange were retired and replaced one-for-one by
  // Forest, Sakura and Thunderstorm so the Shop's rows stay full.
  { id: 'ring-neon-cyan', name: 'Neon', price: 450 },
  { id: 'ring-aurora', name: 'Aurora', price: 540 },
  { id: 'ring-rainbow', name: 'Rainbow', price: 630 },
  { id: 'ring-gold', name: 'Gold', price: 720 },
  { id: 'ring-gems', name: 'Gem-Studded', price: 930 },
  // Skins with a living scene INSIDE the ring come last and cost the most, in
  // Gabe's order (10/10): Ember < Forest < Thunderstorm < Sakura < Ocean < Space.
  { id: 'ring-ember', name: 'Ember', price: 1020 },
  { id: 'ring-forest', name: 'Forest', price: 1060 },
  { id: 'ring-storm', name: 'Thunderstorm', price: 1100 },
  { id: 'ring-sakura', name: 'Sakura', price: 1160 },
  { id: 'ring-ocean', name: 'Ocean', price: 1220 },
  { id: 'ring-space', name: 'Outer Space', price: 1290 },
];

export const ringSkinById = (id: string | undefined): RingSkin | undefined => RING_SKINS.find((s) => s.id === id);

/** [work, last five minutes, rest] tube colors. */
const NEON: Record<string, [string, string, string]> = {
  'ring-neon-cyan': ['#2ef2ff', '#ff3355', '#7dffb0'],
};

type Stops = [number, string][];
/** A gradient skin's arc in its three looks, plus the gradient's direction. */
interface ArcPalette {
  work: Stops;
  urgent: Stops;
  rest: Stops;
  dir?: [number, number, number, number];
}
const PALETTES: Record<string, ArcPalette> = {
  'ring-aurora': {
    work: [[0, '#3dffa0'], [0.5, '#2ef2ff'], [1, '#5a7bff']],
    urgent: [[0, '#ffb347'], [0.5, '#ff4d6d'], [1, '#b03cff']],
    rest: [[0, '#e0fff0'], [0.5, '#8affc8'], [1, '#3dd6a0']],
  },
  'ring-rainbow': {
    work: [[0, '#ff4d4d'], [0.17, '#ff9a3c'], [0.33, '#ffe14d'], [0.5, '#4dff88'], [0.67, '#3cc8ff'], [0.83, '#5a7bff'], [1, '#d65cff']],
    urgent: [[0, '#ff2d2d'], [0.33, '#ff6a3c'], [0.66, '#ffb347'], [1, '#ff3d8a']], // the warm half only
    rest: [[0, '#ffd1dc'], [0.25, '#ffe9b8'], [0.5, '#c9ffd9'], [0.75, '#bfe6ff'], [1, '#dcc9ff']], // pastel
  },
  'ring-gold': {
    work: [[0, '#fff0b3'], [0.3, '#e3b444'], [0.55, '#8c6414'], [0.8, '#f2d27a'], [1, '#c9952f']],
    urgent: [[0, '#ffd6c2'], [0.3, '#e3624a'], [0.55, '#8c1a14'], [0.8, '#f28a7a'], [1, '#c9372f']], // ruby gold
    rest: [[0, '#f0fff6'], [0.3, '#9fe0bd'], [0.55, '#2f7a55'], [0.8, '#c2f2d8'], [1, '#5fb88c']], // jade
  },
  'ring-gems': {
    work: [[0, '#fff0b3'], [0.5, '#d9a93c'], [1, '#a97c2a']],
    urgent: [[0, '#ffd6c2'], [0.5, '#d9493c'], [1, '#8c1a14']],
    rest: [[0, '#f0fff6'], [0.5, '#6fcf9a'], [1, '#2f7a55']],
  },
  'ring-ember': {
    work: [[0, '#fff3b0'], [0.35, '#ff9a3c'], [0.7, '#ff4d2e'], [1, '#a3160b']],
    // BLUE FLAME, the hottest fire there is (Gabe, 10/10: the old white-hot red
    // read the same as the work look). Its sparks and glow turn blue with it.
    urgent: [[0, '#ffffff'], [0.3, '#bfe9ff'], [0.65, '#3d8bff'], [1, '#4b1fd6']],
    rest: [[0, '#e6f2ff'], [0.4, '#9db8cf'], [0.75, '#5a6f86'], [1, '#33404f']], // cooling coals
    dir: [0, 0, 0, 280],
  },
  'ring-ocean': {
    work: [[0, '#7ff5e6'], [0.5, '#2bb6d6'], [1, '#1d5fc9']],
    urgent: [[0, '#ffd27f'], [0.5, '#ff6b5c'], [1, '#b0245a']], // sunset on the water
    rest: [[0, '#d9fff4'], [0.5, '#6ff0c0'], [1, '#22b88a']], // lagoon
  },
  'ring-forest': {
    work: [[0, '#d4f7a1'], [0.5, '#5cbf4a'], [1, '#1f6b3a']],
    urgent: [[0, '#ffd36b'], [0.5, '#e8622c'], [1, '#8c1f12']], // autumn
    rest: [[0, '#f2fbff'], [0.5, '#b9e3d0'], [1, '#7fbfa4']], // dawn mist
  },
  'ring-sakura': {
    work: [[0, '#ffe3ef'], [0.5, '#ff8fc0'], [1, '#d94f8c']],
    urgent: [[0, '#ffb3c6'], [0.5, '#e0244f'], [1, '#7a0a2a']], // deep crimson
    rest: [[0, '#fff6fa'], [0.5, '#e6f5e4'], [1, '#a8e0c0']], // pale blossom and new leaves
  },
  'ring-storm': {
    work: [[0, '#c9d6ff'], [0.5, '#6f86c9'], [1, '#3a4a7a']],
    urgent: [[0, '#fffbd1'], [0.5, '#ffd23f'], [1, '#ff4d4d']], // lightning
    rest: [[0, '#e6fbff'], [0.5, '#9fe6ff'], [1, '#6fd6b0']], // clearing sky
  },
  'ring-space': {
    work: [[0, '#ff6fd8'], [0.5, '#7a5cff'], [1, '#2ef2ff']],
    urgent: [[0, '#fff3b0'], [0.5, '#ff7a2a'], [1, '#ff2d55']], // supernova
    rest: [[0, '#c9ffe4'], [0.5, '#4fffb0'], [1, '#2ec8ff']], // aurora borealis
  },
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
    // A neon tube: colored glow, and a hot white core that follows the arc. The
    // three looks are three colors for the same tube (--neon-u / --neon-r).
    const [w, u, rs] = NEON[skin];
    return (
      `<g style="--neon:${w};--neon-w:${w};--neon-u:${u};--neon-r:${rs}">` +
      track +
      arc('ring-fg') +
      arc('ring-follow ring-neon-core') +
      dot +
      `</g>`
    );
  }

  const pal = PALETTES[skin];
  if (!pal) return plain;
  const [x1, y1, x2, y2] = pal.dir ?? [0, 0, 280, 280];
  const grad = (stops: Stops, suffix: string) =>
    `<linearGradient id="${id}-${suffix}" gradientUnits="userSpaceOnUse" x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}">` +
    stops.map(([o, c]) => `<stop offset="${o}" stop-color="${c}"/>`).join('') +
    `</linearGradient>`;
  // The arc's three gradients: -g work, -gu last five minutes, -gr rest.
  const trio = grad(pal.work, 'g') + grad(pal.urgent, 'gu') + grad(pal.rest, 'gr');
  const fgWork = arc('ring-fg', ` style="stroke:url(#${id}-g)"`);
  const alts =
    arc('ring-follow ring-alt ring-alt-u', ` style="stroke:url(#${id}-gu)"`) +
    arc('ring-follow ring-alt ring-alt-r', ` style="stroke:url(#${id}-gr)"`);
  const fg = fgWork + alts;

  switch (skin) {
    case 'ring-aurora':
      return (
        `<defs>${trio}</defs>` +
        track + fg + dot
      );

    case 'ring-rainbow':
      // The full spectrum, slowly cycling its hues (ui/ringSkins.css).
      return (
        `<defs>${trio}</defs>` +
        track + `<g class="ring-rainbow">${fgWork}</g>` + alts + dot
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
        `<defs>${trio}` +
        `<radialGradient id="${id}-heat" cx="50%" cy="95%" r="70%"><stop offset="0" stop-color="#ff7a2a" stop-opacity="0.32"/><stop offset="1" stop-color="#ff7a2a" stop-opacity="0"/></radialGradient>` +
        `<radialGradient id="${id}-heatU" cx="50%" cy="95%" r="80%"><stop offset="0" stop-color="#3d8bff" stop-opacity="0.45"/><stop offset="1" stop-color="#3d8bff" stop-opacity="0"/></radialGradient>` +
        `<clipPath id="${id}-in"><circle cx="${C}" cy="${C}" r="${inner}"/></clipPath></defs>` +
        `<g clip-path="url(#${id}-in)" class="ring-embers"><circle cx="${C}" cy="${C}" r="${inner}" fill="url(#${id}-heat)"/>` +
        `<circle cx="${C}" cy="${C}" r="${inner}" fill="url(#${id}-heatU)" class="ring-heat-u"/>${embers}</g>` +
        track + fg +
        `<circle cx="${C}" cy="${C - r}" r="6" class="ring-dot ring-ember-dot"/>`
      );
    }

    case 'ring-forest': {
      // Fireflies blinking and drifting through the dark inside the ring.
      const rnd = seeded(13);
      const inner = r - 12;
      const flies = Array.from({ length: 16 }, () => {
        const a = rnd() * Math.PI * 2;
        const d = Math.sqrt(rnd()) * inner * 0.85;
        const x = C + Math.cos(a) * d;
        const y = C + Math.sin(a) * d;
        return `<circle class="ring-firefly" cx="${x.toFixed(1)}" cy="${y.toFixed(1)}" r="${(1.2 + rnd() * 1.2).toFixed(1)}" style="animation-delay:${(-rnd() * 5).toFixed(2)}s;animation-duration:${(3.5 + rnd() * 3).toFixed(2)}s"/>`;
      }).join('');
      return (
        `<defs>${trio}` +
        `<radialGradient id="${id}-glade" cx="50%" cy="80%" r="75%"><stop offset="0" stop-color="#2f7a3a" stop-opacity="0.3"/><stop offset="1" stop-color="#2f7a3a" stop-opacity="0"/></radialGradient></defs>` +
        `<circle cx="${C}" cy="${C}" r="${inner}" fill="url(#${id}-glade)"/>` +
        `<g class="ring-fireflies">${flies}</g>` +
        track + fg + dot
      );
    }

    case 'ring-sakura': {
      // Cherry petals falling and turning inside the ring.
      const rnd = seeded(17);
      const inner = r - 10;
      const petals = Array.from({ length: 12 }, () => {
        const x = C - inner * 0.7 + rnd() * inner * 1.4;
        const rot = Math.round(rnd() * 360);
        return (
          `<g class="ring-petal" style="animation-delay:${(-rnd() * 7).toFixed(2)}s;animation-duration:${(5.5 + rnd() * 3).toFixed(2)}s">` +
          `<ellipse cx="${x.toFixed(1)}" cy="${(C - inner * 0.8).toFixed(1)}" rx="3.6" ry="2.2" transform="rotate(${rot} ${x.toFixed(1)} ${(C - inner * 0.8).toFixed(1)})"/></g>`
        );
      }).join('');
      return (
        `<defs>${trio}<clipPath id="${id}-in"><circle cx="${C}" cy="${C}" r="${inner}"/></clipPath></defs>` +
        `<g clip-path="url(#${id}-in)">${petals}</g>` +
        track + fg +
        `<circle cx="${C}" cy="${C - r}" r="6" class="ring-dot ring-blossom"/>`
      );
    }

    case 'ring-storm': {
      // Rain falling inside the ring, and now and then a lightning flash.
      const rnd = seeded(19);
      const inner = r - 10;
      const rain = Array.from({ length: 22 }, () => {
        const x = C - inner + rnd() * inner * 2;
        const y = C - inner + rnd() * inner;
        return `<line class="ring-rain" x1="${x.toFixed(1)}" y1="${y.toFixed(1)}" x2="${(x - 4).toFixed(1)}" y2="${(y + 12).toFixed(1)}" style="animation-delay:${(-rnd() * 1.2).toFixed(2)}s;animation-duration:${(0.8 + rnd() * 0.5).toFixed(2)}s"/>`;
      }).join('');
      return (
        `<defs>${trio}<clipPath id="${id}-in"><circle cx="${C}" cy="${C}" r="${inner}"/></clipPath></defs>` +
        `<g clip-path="url(#${id}-in)"><circle cx="${C}" cy="${C}" r="${inner}" class="ring-flash"/>${rain}</g>` +
        track + fg + dot
      );
    }

    case 'ring-gold':
      return (
        `<defs>${trio}</defs>` +
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
        `<defs>${trio}` +
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
        `<defs>${trio}` +
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
        `<defs>${trio}` +
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
