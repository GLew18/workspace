// Cobalt wordmark: the "o" in "Cobalt" is a round cobalt gem.
//
// Plain row: "C" + [gem] + "balt". The gem replaced the gold computer monitor
// on 8/10/26 (Gabe's call: the stone propagates app-wide). Round cushion cut,
// modeled on a real cobalt-blue sapphire: radial body light, translucent
// facets, an inner glow, a window-light sheen, three specular sparkles. The
// artwork paints itself (hardcoded cobalt fills), so unlike the monitor it
// does not use currentColor; size and position still come from .ws-mon in
// components.css (height 1em, margin 0 -0.05em, translateY(0.09em)).
//
// The gem group carries scale(0.92) and rotate(-8deg) about the viewBox
// center: Gabe's round-2/round-3
// tuning (slightly smaller in the slot). The full design record, including
// the retired monitor option, lives in design/wordmark-cobalt-B-stone.html
// and design/wordmark-cobalt-A-monitor.html.

// #region Gem markup: the cobalt stone SVG that stands in for the "o"
// NOTE on ids: every wordmark instance emits the same defs ids (cb-*). That is
// deliberate: url(#...) resolves to the first match in the document, and all
// instances are identical, so any resolution target renders correctly.
// Exported so the Cobalt Plus screen (plus/view.ts) can paint the same stone as
// its hero at a larger size, instead of copying the artwork.
export const STONE_SVG = `<svg class="ws-mon" viewBox="0 0 100 100" aria-hidden="true" focusable="false">
  <defs>
    <clipPath id="cb-clip"><rect x="9" y="9" width="82" height="82" rx="31" ry="31"/></clipPath>
    <radialGradient id="cb-body" cx="36%" cy="30%" r="88%">
      <stop offset="0%" stop-color="#8cc0ff"/><stop offset="38%" stop-color="#3d7fe8"/>
      <stop offset="68%" stop-color="#0b46b0"/><stop offset="100%" stop-color="#032154"/>
    </radialGradient>
    <radialGradient id="cb-glow" cx="50%" cy="50%" r="50%">
      <stop offset="0%" stop-color="#7db4ff" stop-opacity="0.55"/>
      <stop offset="100%" stop-color="#7db4ff" stop-opacity="0"/>
    </radialGradient>
    <linearGradient id="cb-sheen" x1="0%" y1="0%" x2="70%" y2="70%">
      <stop offset="0%" stop-color="#ffffff" stop-opacity="0.48"/>
      <stop offset="42%" stop-color="#ffffff" stop-opacity="0"/>
    </linearGradient>
  </defs>
  <g transform="rotate(-8 50 50) translate(50 50) scale(0.92) translate(-50 -50)" clip-path="url(#cb-clip)">
    <rect x="9" y="9" width="82" height="82" fill="url(#cb-body)"/>
    <polygon points="38,34 62,34 74,6 26,6"    fill="#ffffff" opacity="0.14"/>
    <polygon points="62,34 70,44 96,30 74,6"   fill="#02174a" opacity="0.24"/>
    <polygon points="70,44 70,58 96,72 96,30"  fill="#ffffff" opacity="0.10"/>
    <polygon points="70,58 62,66 74,96 96,72"  fill="#02174a" opacity="0.38"/>
    <polygon points="62,66 38,66 26,96 74,96"  fill="#02174a" opacity="0.20"/>
    <polygon points="38,66 30,58 4,72 26,96"   fill="#02174a" opacity="0.32"/>
    <polygon points="30,58 30,44 4,30 4,72"    fill="#ffffff" opacity="0.13"/>
    <polygon points="30,44 38,34 26,6 4,30"    fill="#ffffff" opacity="0.22"/>
    <polygon points="38,34 62,34 70,44 70,58 62,66 38,66 30,44" fill="#4a8cf0" opacity="0.50"/>
    <ellipse cx="41" cy="58" rx="16" ry="12" fill="url(#cb-glow)"/>
    <path d="M9,9 h52 q-32,13 -42,46 z" fill="url(#cb-sheen)"/>
    <path d="M36 19 l2.6 4.6 4.6 2.6 -4.6 2.6 -2.6 4.6 -2.6 -4.6 -4.6 -2.6 4.6 -2.6 Z" fill="#ffffff" opacity="0.95"/>
    <circle cx="64" cy="61" r="1.8" fill="#ffffff" opacity="0.6"/>
    <circle cx="57" cy="20" r="1.3" fill="#ffffff" opacity="0.5"/>
  </g>
</svg>`;
// #endregion

// #region Public API: createWordmark() builds the header logo element
export interface Wordmark {
  el: HTMLElement;
}

export function createWordmark(): Wordmark {
  const root = document.createElement('span');
  root.className = 'ws-mark';
  root.innerHTML = `<span class="ws-mark-text">C</span>${STONE_SVG}<span class="ws-mark-text">balt</span>`;
  return { el: root };
}
// #endregion
