// WorkSpace wordmark — the "o" in "Work" is a gold computer monitor.
//
// Plain row: "W" + [monitor] + "rkSpace". The monitor is a fixed brand gold
// (no longer tied to task-completion). The hollow screen doubles as the "O" and
// is sized/positioned to line up with the surrounding caps (top ≈ cap height,
// bottom ≈ baseline). Below it: a short, subtly-trapezoidal keyboard with many
// dot-keys (recreating Gabe's reference icon).

// #region Keyboard geometry — math that draws the trapezoid + its rows of keys
/** A circle as an SVG sub-path (used as an even-odd "hole" in the keyboard). */
function circ(cx: number, cy: number, r: number): string {
  return `M${cx - r} ${cy} a${r} ${r} 0 1 0 ${2 * r} 0 a${r} ${r} 0 1 0 ${-2 * r} 0 Z`;
}

const KB_TOP_Y = 75;
const KB_BOT_Y = 94;
const KB_TOP_HALF = 27; // half-width at the top edge
const KB_BOT_HALF = 37; // half-width at the bottom edge (subtle outward flare)
const CX = 50;

const kbHalfAt = (y: number): number =>
  KB_TOP_HALF + (KB_BOT_HALF - KB_TOP_HALF) * ((y - KB_TOP_Y) / (KB_BOT_Y - KB_TOP_Y));

/** Keyboard = a short, subtle trapezoid with many dot-holes (even-odd → holes). */
function keyboardPath(): string {
  let d =
    `M${CX - KB_TOP_HALF} ${KB_TOP_Y} L${CX + KB_TOP_HALF} ${KB_TOP_Y}` +
    ` L${CX + KB_BOT_HALF} ${KB_BOT_Y} L${CX - KB_BOT_HALF} ${KB_BOT_Y} Z`;
  const rows: Array<[number, number]> = [
    [79, 7],
    [83, 8],
    [87, 9],
    [91, 10],
  ];
  for (const [y, n] of rows) {
    const half = kbHalfAt(y) - 4.5; // inset from the slanted edges
    for (let i = 0; i < n; i++) {
      const x = CX - half + 2 * half * (i / (n - 1));
      d += ' ' + circ(x, y, 1.4);
    }
  }
  return d;
}
// #endregion

// #region Monitor markup — the gold computer SVG that stands in for the "o"
// Screen frame (hollow rounded rect) + neck + the generated keyboard. Uses
// currentColor so the CSS in components.css controls size, position, and color.
const MONITOR_SVG = `<svg class="ws-mon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <rect x="16" y="10" width="68" height="54" rx="12" fill="none" stroke="currentColor" stroke-width="9"/>
  <path d="M44 64 L56 64 L60 75 L40 75 Z" fill="currentColor"/>
  <path fill-rule="evenodd" fill="currentColor" d="${keyboardPath()}"/>
</svg>`;
// #endregion

// #region Public API — createWordmark() builds the header logo element
export interface Wordmark {
  el: HTMLElement;
}

export function createWordmark(): Wordmark {
  const root = document.createElement('span');
  root.className = 'ws-mark';
  root.innerHTML = `<span class="ws-mark-text">W</span>${MONITOR_SVG}<span class="ws-mark-text">rkSpace</span>`;
  return { el: root };
}
// #endregion
