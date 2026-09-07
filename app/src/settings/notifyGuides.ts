// Cobalt: notification troubleshooting guides.
//
// TWO LISTS since 8/31 — NOTIFY_GUIDES_WINDOWS and NOTIFY_GUIDES_MAC, six each —
// because the fix-it steps live in different settings apps on each OS. The
// overlay in settings/view.ts shows the list for the detected OS (util/os.ts)
// with a Mac/Windows switcher. OS-neutral guides (Cobalt's own switches, the
// browser site permission, chrome://settings, edge cases) are built by FACTORIES,
// once per list: same code both times, so the copies cannot drift, and each
// list's toast mockups + browser chrome follow that list's OS (never the
// viewer's machine — Gabe, 8/31).
//
// Each list is ORDERED BY LIKELIHOOD (the most common blocker first), each a short
// slideshow. Every step is an ANIMATED SVG mockup — a cursor glides to the control,
// a click ripples, and the setting visibly flips — so each slide plays like a tiny
// looping video of exactly what to do, with arrows and highlights. All scenes are
// built from the shared mini-DSL below (window chrome, settings rows, toggles,
// cursor, arrows), so they stay visually consistent and weigh nothing (no assets).
//
// FIDELITY: every Chrome / Windows scene is drawn from Gabe's real screenshots
// (2026-07 — Win11 + current Chrome) so "am I in the right place?" is instant:
//  • the browser chrome has the real ‹ › ⟳ ⌂ nav cluster + the ⓘ site-info icon;
//  • the site-info bubble = Notifications toggle, Sound row, "Reset permissions",
//    Cookies and site data, Site settings;
//  • the Site-settings page = the Permissions list with "Ask (default)"/"Allow"
//    dropdown buttons + the Reset-permissions pill;
//  • Settings ▸ System ▸ Notifications = master/DND rows with icons, On/Off labels
//    and chevrons; the expanded auto-rules panel with "During these times" + times
//    and the full rule checkboxes; the per-app list ("Banners, Sounds");
//  • the per-app Chrome page = banner/center thumbnails + checkboxes + sound toggle;
//  • chrome://settings/content/notifications = Default behavior, How to show
//    requests, and the Not-allowed list with ▸ and ⋮ menus.
// Colors deliberately stay the app's dark/gold theme; STRUCTURE and labels match.
// (Per Gabe: the taskbar moon indicator doesn't show on his machine — DND is found
// via the clock/notification center instead, so no moon-icon slide.)
//
// Everything here is static, trusted markup (no user input), rendered via innerHTML
// by openNotifyGuides() in settings/view.ts.

import { cobaltIconSvg, CHROME_LOGO_INNER } from '../ui/appIcon';

export interface GuideStep {
  caption: string;
  svg: string;
}
export interface Guide {
  title: string;
  tag: string; // likelihood chip — "Most common" … "Rare"
  emoji: string; // shown before the title (index + player header)
  color: string; // likelihood heat color — red (most common) → purple (rare)
  blurb: string;
  steps: GuideStep[];
}

/** Which OS a guide's LIST belongs to. The toast mockups inside a guide follow
 *  the list's OS, not the viewer's machine (Gabe, 8/31): every guide in the
 *  Windows list shows the Windows popup, every guide in the Mac list the Mac
 *  one, so browsing the other OS's guides shows that OS's world consistently. */
type GuideOS = 'mac' | 'windows';

// ---------------------------------------------------------------------------
// Palette (app accents; navy mockup surfaces match the preview stages).
const GOLD = '#7db4ff';
const GREEN = '#27ae60';
const RED = '#ef4444';
const BG = '#0d1936';
const PANEL = '#1a2a4d';
const PANEL2 = '#233a6c';
const LINE = 'rgba(255,255,255,0.14)';
const TXT = 'rgba(255,255,255,0.92)';
const DIM = 'rgba(255,255,255,0.55)';

// Shared animation CSS. One 6s loop: the cursor holds (0–18%), glides (18–42%),
// clicks (~50%, the ripple), and the "result" appears/flips at ~55–60%. An SVG
// <style> is DOCUMENT-scoped while the scene is mounted, so every selector is
// prefixed with the scene's own .gdsvg root — the short class names can never
// leak onto app elements. (Keyframe names kC/kR/… are unique to these scenes.)
const SCENE_CSS = `
  .gdsvg .c{animation:kC 6s ease-in-out infinite}
  @keyframes kC{0%,18%{transform:translate(var(--x0),var(--y0))}42%,100%{transform:translate(var(--x1),var(--y1))}}
  .gdsvg .r{opacity:0;transform-box:fill-box;transform-origin:center;animation:kR 6s infinite}
  @keyframes kR{0%,46%{opacity:0;transform:scale(.3)}52%{opacity:.5;transform:scale(.7)}62%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .af{opacity:0;animation:kA 6s infinite}
  @keyframes kA{0%,54%{opacity:0}60%,100%{opacity:1}}
  .gdsvg .bf{animation:kB 6s infinite}
  @keyframes kB{0%,54%{opacity:1}60%,100%{opacity:0}}
  .gdsvg .tk{animation:kK 6s infinite}
  @keyframes kK{0%,54%{transform:translateX(0)}60%,100%{transform:translateX(13px)}}
  .gdsvg .tko{animation:kKo 6s infinite}
  @keyframes kKo{0%,54%{transform:translateX(0)}60%,100%{transform:translateX(-13px)}}
  .gdsvg .tp{animation:kP 6s infinite}
  @keyframes kP{0%,54%{fill:${PANEL2}}60%,100%{fill:${GOLD}}}
  .gdsvg .tpo{animation:kPo 6s infinite}
  @keyframes kPo{0%,54%{fill:${GOLD}}60%,100%{fill:${PANEL2}}}
  .gdsvg .pu{animation:kU 1.8s ease-in-out infinite}
  @keyframes kU{0%,100%{opacity:.35}50%{opacity:1}}
  /* TWO-CLICK scenes (the macOS Chrome page + Focus slides, 8/31): the cursor
     makes a first click at ~34% (ripple r1, state-1 af1/bf1 flips) then glides
     on and clicks again at ~66% (ripple r2, state-2 af2). Same 6s loop. */
  .gdsvg .c2{animation:kC2 6s ease-in-out infinite}
  @keyframes kC2{0%,10%{transform:translate(var(--x0),var(--y0))}26%,44%{transform:translate(var(--x1),var(--y1))}60%,100%{transform:translate(var(--x2),var(--y2))}}
  .gdsvg .r1{opacity:0;transform-box:fill-box;transform-origin:center;animation:kR1 6s infinite}
  @keyframes kR1{0%,30%{opacity:0;transform:scale(.3)}36%{opacity:.5;transform:scale(.7)}46%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .r2{opacity:0;transform-box:fill-box;transform-origin:center;animation:kR2 6s infinite}
  @keyframes kR2{0%,62%{opacity:0;transform:scale(.3)}68%{opacity:.5;transform:scale(.7)}78%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .af1{opacity:0;animation:kA1 6s infinite}
  @keyframes kA1{0%,36%{opacity:0}42%,100%{opacity:1}}
  .gdsvg .bf1{animation:kB1 6s infinite}
  @keyframes kB1{0%,36%{opacity:1}42%,100%{opacity:0}}
  .gdsvg .af2{opacity:0;animation:kA2 6s infinite}
  @keyframes kA2{0%,68%{opacity:0}74%,100%{opacity:1}}
  .gdsvg .bf2{animation:kB2 6s infinite}
  @keyframes kB2{0%,68%{opacity:1}74%,100%{opacity:0}}
  /* THREE-CLICK scenes (the macOS Chrome page, 8/31): clicks at ~30%, ~58%,
     ~86% of the same 6s loop. States: fa/ga flip at click 1, fb/gb at click 2,
     fc/gc at click 3. */
  .gdsvg .c3{animation:kC3 6s ease-in-out infinite}
  @keyframes kC3{0%,8%{transform:translate(var(--x0),var(--y0))}22%,36%{transform:translate(var(--x1),var(--y1))}50%,64%{transform:translate(var(--x2),var(--y2))}78%,100%{transform:translate(var(--x3),var(--y3))}}
  .gdsvg .q1{opacity:0;transform-box:fill-box;transform-origin:center;animation:kQ1 6s infinite}
  @keyframes kQ1{0%,24%{opacity:0;transform:scale(.3)}30%{opacity:.5;transform:scale(.7)}40%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .q2{opacity:0;transform-box:fill-box;transform-origin:center;animation:kQ2 6s infinite}
  @keyframes kQ2{0%,52%{opacity:0;transform:scale(.3)}58%{opacity:.5;transform:scale(.7)}68%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .q3{opacity:0;transform-box:fill-box;transform-origin:center;animation:kQ3 6s infinite}
  @keyframes kQ3{0%,80%{opacity:0;transform:scale(.3)}86%{opacity:.5;transform:scale(.7)}96%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .fa{opacity:0;animation:kFa 6s infinite}
  @keyframes kFa{0%,28%{opacity:0}34%,100%{opacity:1}}
  .gdsvg .ga{animation:kGa 6s infinite}
  @keyframes kGa{0%,28%{opacity:1}34%,100%{opacity:0}}
  .gdsvg .fb{opacity:0;animation:kFb 6s infinite}
  @keyframes kFb{0%,56%{opacity:0}62%,100%{opacity:1}}
  .gdsvg .gb{animation:kGb 6s infinite}
  @keyframes kGb{0%,56%{opacity:1}62%,100%{opacity:0}}
  .gdsvg .fc{opacity:0;animation:kFc 6s infinite}
  @keyframes kFc{0%,84%{opacity:0}90%,100%{opacity:1}}
  .gdsvg .gc{animation:kGc 6s infinite}
  @keyframes kGc{0%,84%{opacity:1}90%,100%{opacity:0}}
`;

// ---------------------------------------------------------------------------
// Mini-DSL — every helper returns an SVG fragment string.

const scene = (inner: string): string =>
  `<svg class="gdsvg" viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" role="img"><style>${SCENE_CSS}</style>` +
  `<rect width="460" height="260" rx="12" fill="${BG}"/>${inner}</svg>`;

const txt = (x: number, y: number, size: number, fill: string, content: string, weight = 500, anchor = 'start'): string =>
  `<text x="${x}" y="${y}" font-size="${size}" fill="${fill}" font-weight="${weight}" text-anchor="${anchor}" font-family="Inter,system-ui,sans-serif">${content}</text>`;

const box = (x: number, y: number, w: number, h: number, fill: string, rx = 8, extra = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${fill}" ${extra}/>`;

/** Animated cursor: waits at (x0,y0), glides to (x1,y1), then a gold click-ripple. */
const cursor = (x0: number, y0: number, x1: number, y1: number): string =>
  `<circle class="r" cx="${x1 + 2}" cy="${y1 + 2}" r="11" fill="${GOLD}"/>` +
  `<g class="c" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px">` +
  `<path d="M0 0 L0 15 L4.2 11.6 L7.2 18 L9.8 16.8 L6.9 10.6 L11.5 10.2 Z" fill="#fff" stroke="#0b142b" stroke-width="1.2"/></g>`;

/** Two-click cursor: waits at (x0,y0), clicks at (x1,y1), then again at (x2,y2).
 *  Pair state changes with af1/bf1 (first click) and af2/bf2 (second). */
const cursor2 = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number): string =>
  `<circle class="r1" cx="${x1 + 2}" cy="${y1 + 2}" r="11" fill="${GOLD}"/>` +
  `<circle class="r2" cx="${x2 + 2}" cy="${y2 + 2}" r="11" fill="${GOLD}"/>` +
  `<g class="c2" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px;--x2:${x2}px;--y2:${y2}px">` +
  `<path d="M0 0 L0 15 L4.2 11.6 L7.2 18 L9.8 16.8 L6.9 10.6 L11.5 10.2 Z" fill="#fff" stroke="#0b142b" stroke-width="1.2"/></g>`;

/** Three-click cursor: waits at (x0,y0), then clicks (x1,y1), (x2,y2), (x3,y3).
 *  Pair state changes with fa/ga, fb/gb, fc/gc. */
const cursor3 = (x0: number, y0: number, x1: number, y1: number, x2: number, y2: number, x3: number, y3: number): string =>
  `<circle class="q1" cx="${x1 + 2}" cy="${y1 + 2}" r="11" fill="${GOLD}"/>` +
  `<circle class="q2" cx="${x2 + 2}" cy="${y2 + 2}" r="11" fill="${GOLD}"/>` +
  `<circle class="q3" cx="${x3 + 2}" cy="${y3 + 2}" r="11" fill="${GOLD}"/>` +
  `<g class="c3" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px;--x2:${x2}px;--y2:${y2}px;--x3:${x3}px;--y3:${y3}px">` +
  `<path d="M0 0 L0 15 L4.2 11.6 L7.2 18 L9.8 16.8 L6.9 10.6 L11.5 10.2 Z" fill="#fff" stroke="#0b142b" stroke-width="1.2"/></g>`;

/** A toggle switch. mode: on | off | turnsOn (flips at the click) | turnsOff. */
const toggle = (x: number, y: number, mode: 'on' | 'off' | 'turnsOn' | 'turnsOff'): string => {
  const pill = (cls: string, fill: string): string => `<rect class="${cls}" x="${x}" y="${y}" width="32" height="18" rx="9" fill="${fill}"/>`;
  const knob = (cls: string, cx: number): string => `<circle class="${cls}" cx="${cx}" cy="${y + 9}" r="7" fill="#fff"/>`;
  if (mode === 'on') return pill('', GOLD) + knob('', x + 23);
  if (mode === 'off') return pill('', PANEL2) + knob('', x + 9);
  if (mode === 'turnsOn') return pill('tp', PANEL2) + knob('tk', x + 9);
  return pill('tpo', GOLD) + knob('tko', x + 23);
};

/** "On"/"Off" state label + toggle, Windows-style (the word sits left of the pill).
 *  turnsOn/turnsOff animate the word along with the pill. */
const onOffToggle = (x: number, y: number, mode: 'on' | 'off' | 'turnsOn' | 'turnsOff'): string => {
  const label = (t: string, fill: string, cls = ''): string =>
    (cls ? `<g class="${cls}">` : '') + txt(x - 8, y + 13, 10, fill, t, 600, 'end') + (cls ? '</g>' : '');
  if (mode === 'on') return label('On', TXT) + toggle(x, y, 'on');
  if (mode === 'off') return label('Off', DIM) + toggle(x, y, 'off');
  if (mode === 'turnsOn') return label('Off', DIM, 'bf') + label('On', TXT, 'af') + toggle(x, y, 'turnsOn');
  return label('On', TXT, 'bf') + label('Off', DIM, 'af') + toggle(x, y, 'turnsOff');
};

/** A checkbox. checks/unchecks animate at the click moment. */
const checkbox = (x: number, y: number, mode: 'checks' | 'unchecks' | 'on' | 'off'): string => {
  const empty = box(x, y, 15, 15, PANEL2, 4, `stroke="${LINE}"`);
  const filled = box(x, y, 15, 15, GOLD, 4) + `<path d="M${x + 3.5} ${y + 8} l3 3 l5.5 -6" stroke="#071433" stroke-width="2" fill="none" stroke-linecap="round"/>`;
  if (mode === 'off') return empty;
  if (mode === 'on') return empty + filled;
  if (mode === 'checks') return empty + `<g class="af">${filled}</g>`;
  return empty + `<g class="bf">${filled}</g>`; // unchecks: the tick fades at the click
};

/** A checkbox whose tick fades in (or out) at a chosen click of a multi-click
 *  scene — pass the state class: af2 (default), bf2, fa/fb/fc, ga/gb/gc. A g*
 *  class means the box starts TICKED and unticks at that click. */
const checkbox2 = (x: number, y: number, cls = 'af2'): string =>
  box(x, y, 15, 15, PANEL2, 4, `stroke="${LINE}"`) +
  `<g class="${cls}">${box(x, y, 15, 15, GOLD, 4)}<path d="M${x + 3.5} ${y + 8} l3 3 l5.5 -6" stroke="#071433" stroke-width="2" fill="none" stroke-linecap="round"/></g>`;

/** A radio button. mode: sel | un | selects (fills at the click) | was (empties). */
const radio = (x: number, y: number, mode: 'sel' | 'un' | 'selects' | 'was'): string => {
  const ring = `<circle cx="${x}" cy="${y}" r="6" fill="none" stroke="${LINE}" stroke-width="1.6"/>`;
  if (mode === 'un') return ring;
  if (mode === 'sel') return ring + `<circle cx="${x}" cy="${y}" r="3.4" fill="${GOLD}"/>`;
  if (mode === 'selects') return ring + `<circle class="af" cx="${x}" cy="${y}" r="3.4" fill="${GOLD}"/>`;
  return ring + `<circle class="bf" cx="${x}" cy="${y}" r="3.4" fill="${DIM}"/>`;
};

/** A "Ask (default) ▾"-style dropdown button (the Site-settings permission pickers). */
const dropBtn = (x: number, y: number, w: number, label: string, fill = DIM): string =>
  box(x, y, w, 22, PANEL2, 6, `stroke="${LINE}"`) +
  txt(x + 10, y + 15, 9.5, fill, label, 600) +
  txt(x + w - 10, y + 15, 8.5, DIM, '▾', 600, 'end');

// --- tiny 14px vector icons for the Windows-settings rows (match the real UI) ---
const I = (x: number, y: number, inner: string): string =>
  `<g transform="translate(${x},${y})" fill="none" stroke="${DIM}" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round">${inner}</g>`;
const icoBell = (x: number, y: number): string =>
  I(x, y, `<path d="M10.6 4.7a3.6 3.6 0 0 0-7.2 0c0 4.1-1.8 5.3-1.8 5.3h10.8s-1.8-1.2-1.8-5.3"/><path d="M8.1 12.4a1.2 1.2 0 0 1-2.2 0"/>`);
/** Do-not-disturb = a bell with z's (the real Win11 glyph — NOT a moon). */
const icoDnd = (x: number, y: number, stroke = DIM): string =>
  `<g transform="translate(${x},${y})" fill="none" stroke="${stroke}" stroke-width="1.5" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M9.2 5.6a2.8 2.8 0 0 0-5.6 0c0 3.2-1.4 4.2-1.4 4.2h8.4S9.2 8.8 9.2 5.6"/><path d="M7.3 12a1 1 0 0 1-1.8 0"/></g>` +
  txt(x + 11.4, y + 4.6, 5.5, stroke, 'zᶻ', 700, 'middle');
const icoPin = (x: number, y: number): string =>
  I(x, y, `<path d="M7 1.6a4.2 4.2 0 0 0-4.2 4.2C2.8 9 7 12.6 7 12.6s4.2-3.6 4.2-6.8A4.2 4.2 0 0 0 7 1.6z"/><circle cx="7" cy="5.8" r="1.5"/>`);
const icoCam = (x: number, y: number): string =>
  I(x, y, `<rect x="1" y="3.8" width="8.2" height="6.4" rx="1.6"/><path d="M9.2 6.6 12.8 4.4v5.2L9.2 7.4"/>`);
const icoMic = (x: number, y: number): string =>
  I(x, y, `<rect x="5.2" y="1.4" width="3.6" height="6.6" rx="1.8"/><path d="M3.2 6.6a3.8 3.8 0 0 0 7.6 0M7 10.4v2.2"/>`);
const icoMotion = (x: number, y: number): string =>
  I(x, y, `<path d="M3.4 4.4a4.5 4.5 0 0 0 0 5.2M10.6 4.4a4.5 4.5 0 0 1 0 5.2"/>`) + `<circle cx="${x + 7}" cy="${y + 7}" r="1.4" fill="${DIM}"/>`;
const icoCode = (x: number, y: number): string =>
  I(x, y, `<path d="M4.6 4 2 7l2.6 3M9.4 4 12 7l-2.6 3"/>`);
const icoClock = (x: number, y: number): string =>
  I(x, y, `<circle cx="7" cy="7" r="5.6"/><path d="M7 4v3.2l2.1 1.4"/>`);
const icoPrio = (x: number, y: number): string =>
  I(x, y, `<path d="M3.2 3.5v7M7 1.8v10.4M10.8 4.8v4.4"/>`);
const icoTarget = (x: number, y: number): string =>
  I(x, y, `<circle cx="7" cy="7" r="5.6"/><circle cx="7" cy="7" r="2.2"/>`);
/** The Chrome logo, mini (14px): the official geometry from ui/appIcon.ts. */
const icoChrome = (x: number, y: number): string =>
  `<g transform="translate(${x},${y}) scale(${(14 / 48).toFixed(4)})">${CHROME_LOGO_INNER}</g>`;
/** A little app tile with an emoji (Snipping Tool, Settings, …). */
const tileIco = (x: number, y: number, emoji: string): string =>
  box(x, y, 14, 14, PANEL, 4, `stroke="${LINE}"`) + txt(x + 7, y + 11, 8.5, TXT, emoji, 500, 'middle');
/** A settings row with an icon slot (icon drawn at x=38, label indented past it). */
const rowIco = (y: number, icon: string, label: string, control: string, sub = ''): string =>
  box(28, y, 404, 34, PANEL2, 8) +
  icon +
  txt(62, y + (sub ? 17 : 21), 11.5, TXT, label) +
  (sub ? txt(62, y + 29, 8.5, DIM, sub) : '') +
  control;

// (The old flat-primitive mini Cobalt gem lived here until 8/31 — replaced by
// cobaltIcon() below, which nests the REAL app icon from ui/appIcon.ts so the
// slide toasts match the settings preview exactly.)

/** Pulsing highlight rectangle (draws the eye). Gold by default; the duplicate-
 *  Chrome scenes pass RED so the trap row reads as danger, not decoration (8/31). */
const hl = (x: number, y: number, w: number, h: number, color = GOLD): string =>
  `<rect class="pu" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${color}" stroke-width="2"/>`;

/** Pulsing gold arrow from (x1,y1) to (x2,y2). */
const arrow = (x1: number, y1: number, x2: number, y2: number): string => {
  const ang = Math.atan2(y2 - y1, x2 - x1);
  const h1x = x2 - 9 * Math.cos(ang - 0.44);
  const h1y = y2 - 9 * Math.sin(ang - 0.44);
  const h2x = x2 - 9 * Math.cos(ang + 0.44);
  const h2y = y2 - 9 * Math.sin(ang + 0.44);
  return (
    `<g class="pu" stroke="${GOLD}" stroke-width="2.4" fill="none" stroke-linecap="round">` +
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/>` +
    `<path d="M${h1x} ${h1y} L${x2} ${y2} L${h2x} ${h2y}"/></g>`
  );
};

/** Refresh (circular arrow) drawn as a VECTOR centered exactly on (x,y) — a font
 *  glyph's box drifts between renderers, which kept its highlight looking off. */
const icoRefresh = (x: number, y: number): string =>
  `<g fill="none" stroke="${DIM}" stroke-width="1.7" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M ${x + 4.2} ${y - 3.5} A 5.5 5.5 0 1 0 ${x + 5.5} ${y}"/>` +
  `<path d="M ${x + 1.7} ${y - 5.6} L ${x + 4.2} ${y - 3.5} L ${x + 4.9} ${y - 6.7}"/>` +
  `</g>`;

/** macOS traffic lights, the REAL colors — the yellow is deliberately yellow,
 *  never the app's blue-leaning accent (Gabe, 8/31). One helper so every scene
 *  puts them at the same spot: (32, 28) inside a window whose frame starts at
 *  (16, 14). */
const trafficDots = (x = 32, y = 28): string =>
  `<circle cx="${x}" cy="${y}" r="3.5" fill="#ff5f57"/><circle cx="${x + 12}" cy="${y}" r="3.5" fill="#febc2e"/><circle cx="${x + 24}" cy="${y}" r="3.5" fill="#28c840"/>`;

/** Browser chrome, matching real Chrome: tab strip, then the ‹ › ⟳ ⌂ nav cluster
 *  (naturally spaced), then the address bar with the ⓘ site-info icon inside it.
 *  The refresh icon is a vector centered at (75, 56) so highlights can target it
 *  exactly. `right` renders inside the bar's right end. `mac` adds the traffic
 *  lights and shifts the tab right, the way Chrome on macOS draws its frame —
 *  the Mac guide list passes it so its slides read as Gabe's own machine. */
const browser = (right = '', url = 'cobaltstudy.com', mac = false): string =>
  box(16, 14, 428, 58, PANEL, 10) +
  (mac ? trafficDots(28, 30) + box(66, 20, 122, 20, PANEL2, 7) + txt(78, 34, 10.5, DIM, 'Cobalt') : box(28, 20, 122, 20, PANEL2, 7) + txt(40, 34, 10.5, DIM, 'Cobalt')) +
  txt(34, 60, 12, DIM, '‹') +
  txt(52, 60, 12, DIM, '›') +
  icoRefresh(75, 56) +
  txt(90, 59, 10, DIM, '⌂') +
  box(102, 46, 330, 20, BG, 10) +
  `<circle cx="118" cy="56" r="6.5" fill="none" stroke="${DIM}" stroke-width="1.4"/>` +
  txt(118, 59.5, 9, DIM, 'i', 700, 'middle') +
  txt(132, 60, 11, TXT, url) +
  right;

/** A settings-style window with a breadcrumb title (drawn for both OSes; the
 *  traffic lights read as macOS there and as decoration on Windows). */
const winSettings = (title: string): string =>
  box(16, 14, 428, 232, PANEL, 10) +
  trafficDots() +
  txt(230, 32, 11.5, DIM, title, 600, 'middle');

/** A settings row: label left, a control fragment already positioned on the right. */
const row = (y: number, label: string, control: string, sub = ''): string =>
  box(28, y, 404, 34, PANEL2, 8) +
  txt(42, y + (sub ? 17 : 21), 11.5, TXT, label) +
  (sub ? txt(42, y + 29, 8.5, DIM, sub) : '') +
  control;

/** Chrome's roundel at any size — the official geometry from ui/appIcon.ts. */
const chromeLogo = (x: number, y: number, size: number): string =>
  `<g transform="translate(${x},${y}) scale(${(size / 48).toFixed(3)})">${CHROME_LOGO_INNER}</g>`;

/** The REAL Cobalt app icon nested into a scene — identical artwork to the
 *  settings preview mock (Gabe, 8/31: the old flat gem read as a cartoon).
 *  Each call gets its own gradient-id suffix so repeats stay well-formed. */
let cobaltIconN = 0;
const cobaltIcon = (x: number, y: number, size: number): string =>
  cobaltIconSvg(`g${cobaltIconN++}`, `x="${x}" y="${y}" width="${size}" height="${size}"`);

/** The notification toast, drawn like the REAL popup of the guide's OS — not a
 *  Cobalt-themed invention (Gabe, 8/31: the fabricated card read as fake next to
 *  the OS-faithful preview stage). Mirrors the HTML mocks in settings/view.ts:
 *  Windows Chrome = dark card, Cobalt icon left, origin line at the bottom;
 *  macOS = translucent gray card, Chrome roundel left, origin under the title,
 *  the Cobalt favicon riding large on the right. `os` is the LIST's OS, never
 *  the viewer's (see GuideOS above). */
const wsToast = (os: GuideOS, x: number, y: number, title: string, msg: string, cls = 'af'): string => {
  const inner =
    os === 'mac'
      ? box(x, y, 216, 54, '#2c2c30', 13, `stroke="rgba(255,255,255,0.16)"`) +
        chromeLogo(x + 9, y + 14, 26) +
        txt(x + 44, y + 17, 9.5, '#f2f2f4', title, 650) +
        txt(x + 44, y + 29, 8, 'rgba(255,255,255,0.55)', 'cobaltstudy.com') +
        txt(x + 44, y + 41, 8.5, 'rgba(255,255,255,0.78)', msg) +
        cobaltIcon(x + 182, y + 14, 26)
      : box(x, y, 210, 54, '#202024', 9, `stroke="rgba(255,255,255,0.18)"`) +
        cobaltIcon(x + 10, y + 13, 28) +
        txt(x + 46, y + 18, 9.5, '#f2f2f4', title, 650) +
        txt(x + 46, y + 31, 8.5, 'rgba(255,255,255,0.72)', msg) +
        txt(x + 46, y + 45, 7.5, 'rgba(255,255,255,0.4)', 'cobaltstudy.com');
  return `<g class="${cls}">${inner}</g>`;
};

/** A Cobalt channel button ([🔔 Popup] style). */
const chanBtn = (x: number, y: number, label: string, state: 'on' | 'off' | 'turnsOn'): string => {
  const w = 64;
  if (state === 'turnsOn') {
    return (
      `<rect class="bf" x="${x}" y="${y}" width="${w}" height="22" rx="8" fill="${PANEL2}" stroke="${LINE}"/>` +
      `<g class="bf">${txt(x + w / 2, y + 15, 10, DIM, label, 600, 'middle')}</g>` +
      `<g class="af"><rect x="${x}" y="${y}" width="${w}" height="22" rx="8" fill="rgba(125, 180, 255,0.14)" stroke="${GOLD}"/>` +
      txt(x + w / 2, y + 15, 10, GOLD, label, 700, 'middle') +
      `</g>`
    );
  }
  const on = state === 'on';
  return (
    `<rect x="${x}" y="${y}" width="${w}" height="22" rx="8" fill="${on ? 'rgba(125, 180, 255,0.14)' : PANEL2}" stroke="${on ? GOLD : LINE}"/>` +
    txt(x + w / 2, y + 15, 10, on ? GOLD : DIM, label, on ? 700 : 600, 'middle')
  );
};

// ---------------------------------------------------------------------------
// The "come back and test" closer — the red guide's Test slide, appended as the
// FINAL step of every other guide so each fix ends with a concrete way to confirm
// it worked. One shared scene per OS; only the caption's lead-in varies per
// guide. The LAST guide has no "next guide" to point at — its closer celebrates.
const testScene = (os: GuideOS, bottomLine: string): string =>
  scene(
    box(30, 60, 190, 34, PANEL2, 9, `stroke="${LINE}"`) +
      txt(125, 81, 11, TXT, 'Test out notification', 600, 'middle') +
      arrow(240, 78, 280, 110) +
      wsToast(os, 235, 120, 'Focus session complete!', '25 min focused • 3/4 tasks done') +
      txt(230, 220, 10.5, DIM, bottomLine, 500, 'middle') +
      hl(24, 54, 202, 46) +
      cursor(90, 200, 120, 76)
  );
const testStep = (os: GuideOS, lead: string, last = false): GuideStep => ({
  caption: `${lead} Head back to Cobalt ▸ Settings ▸ Notifications and press “Test out notification”. ${
    last ? 'You should finally see a popup now.' : 'A popup means you’re fixed. Still nothing means move on to the next guide.'
  }`,
  svg: testScene(os, last ? 'You should finally see the popup now ✓' : 'Popup shows → fixed ✓ · Still nothing → try the next guide'),
});

// ---------------------------------------------------------------------------
// THE GUIDES. Four are OS-NEUTRAL and built by factories, once per list, so the
// Windows and Mac copies come from the SAME code and cannot drift — only their
// toast mockups differ, following the list's OS, and the Mac copies add the
// traffic lights to browser windows. Two guides are Windows-only, two Mac-only.
// Each list is ordered by likelihood, most common blocker first.

const cobaltSwitchesGuide = (os: GuideOS): Guide => ({
    title: 'Check Cobalt’s own switches',
    tag: 'Most common',
    emoji: '⚙️',
    color: '#ef4444',
    blurb: 'The 🔔 Popup button is off for that alert, or for all of them.',
    steps: [
      {
        caption:
          'Each alert only pops up while its 🔔 Popup button is GOLD. Open Settings ▸ Notifications and check the alert you’re missing. Grey means it never fires.',
        svg: scene(
          box(30, 40, 400, 60, PANEL, 10) +
            txt(46, 65, 12.5, TXT, 'Due-soon reminders', 650) +
            txt(46, 82, 9.5, DIM, 'A heads-up before a task is due.') +
            chanBtn(272, 58, '🔔 Popup', 'turnsOn') +
            chanBtn(344, 58, '✉ Gmail', 'off') +
            txt(230, 150, 11, DIM, 'Grey = off · Gold = on', 500, 'middle') +
            wsToast(os, 125, 168, 'Due soon: Science lab', 'Due 3:00 PM (in 1 hour)') +
            hl(266, 52, 76, 34) +
            cursor(120, 190, 300, 74)
        ),
      },
      {
        caption:
          '“All reminders” at the top is a master switch. One press turns Popup gold on EVERY alert below it at once.',
        svg: scene(
          box(30, 30, 400, 52, PANEL, 10) +
            txt(46, 52, 12.5, TXT, 'All reminders', 700) +
            txt(46, 68, 9.5, DIM, 'One press flips every notification below.') +
            chanBtn(272, 45, '🔔 Popup', 'turnsOn') +
            chanBtn(344, 45, '✉ Gmail', 'off') +
            box(30, 100, 400, 40, PANEL, 10) +
            txt(46, 124, 11, TXT, 'Due-soon reminders') +
            `<g class="af">${chanBtn(272, 109, '🔔 Popup', 'on')}</g><g class="bf">${chanBtn(272, 109, '🔔 Popup', 'off')}</g>` +
            box(30, 148, 400, 40, PANEL, 10) +
            txt(46, 172, 11, TXT, 'Daily agenda') +
            `<g class="af">${chanBtn(272, 157, '🔔 Popup', 'on')}</g><g class="bf">${chanBtn(272, 157, '🔔 Popup', 'off')}</g>` +
            box(30, 196, 400, 40, PANEL, 10) +
            txt(46, 220, 11, TXT, 'Focus sessions') +
            `<g class="af">${chanBtn(272, 205, '🔔 Popup', 'on')}</g><g class="bf">${chanBtn(272, 205, '🔔 Popup', 'off')}</g>` +
            hl(266, 39, 76, 34) +
            cursor(150, 180, 300, 60)
        ),
      },
      {
        caption:
          'Press “Test out notification” on any open card. If a popup appears, Cobalt can reach your screen. Recheck each alert’s buttons. If NOTHING appears, work through the next guides: something outside Cobalt is blocking.',
        svg: scene(
          box(30, 60, 190, 34, PANEL2, 9, `stroke="${LINE}"`) +
            txt(125, 81, 11, TXT, 'Test out notification', 600, 'middle') +
            hl(24, 54, 202, 46) +
            cursor(90, 200, 120, 76) +
            arrow(240, 78, 280, 110) +
            wsToast(os, 235, 120, 'Focus session complete!', '25 min focused • 3/4 tasks done') +
            txt(230, 220, 10.5, DIM, 'Popup shows → Cobalt is fine · No popup → keep reading', 500, 'middle')
        ),
      },
      // The "keep Cobalt open in a tab" closer lived here until 8/31 — removed
      // (Gabe): closed-app reminders ship with the cloud update at launch, so a
      // slide teaching around their absence would be stale on day one.
    ],
});

const browserBlockedGuide = (os: GuideOS): Guide => ({
    title: 'Your browser blocked Cobalt',
    tag: 'Very common',
    emoji: '🔕',
    color: '#e85d04',
    blurb: 'One accidental “Block” click silences Cobalt until you undo it here.',
    steps: [
      {
        caption:
          'Look at the RIGHT end of the address bar: a crossed-out bell means the browser is blocking Cobalt’s notifications. (No icon? Continue to the next step anyway.)',
        svg: scene(
          browser(txt(414, 61, 12, TXT, '🔕'), 'cobaltstudy.com', os === 'mac') +
            hl(408, 43, 29, 27) +
            arrow(380, 130, 421, 76) +
            txt(230, 165, 11.5, DIM, 'This icon appears after “Block” was clicked on the permission ask.', 500, 'middle')
        ),
      },
      {
        caption:
          'Click the ⓘ icon at the LEFT end of the web address. In the menu that opens, flip the Notifications switch ON. (“Reset permissions” also works. The site asks fresh on reload.)',
        // TWO clicks (Gabe, 8/31): ⓘ opens the site-info menu, then the
        // Notifications switch flips on.
        svg: scene(
          browser('', 'cobaltstudy.com', os === 'mac') +
            hl(106, 46, 24, 20) +
            `<g class="af1">` +
            box(96, 76, 240, 178, PANEL2, 10, `stroke="${LINE}"`) +
            txt(112, 96, 11, TXT, 'cobaltstudy.com', 650) +
            txt(320, 96, 10, DIM, '✕', 600, 'middle') +
            box(104, 106, 224, 1, LINE, 0) +
            txt(112, 128, 10.5, TXT, '🔔 Notifications') +
            `<g class="bf2">${toggle(288, 118, 'off')}</g><g class="af2">${toggle(288, 118, 'on')}</g>` +
            txt(112, 152, 10.5, TXT, '🔊 Sound') +
            txt(129, 165, 8.5, DIM, 'Automatic (default)') +
            toggle(288, 143, 'on') +
            box(112, 176, 122, 22, PANEL, 7, `stroke="${LINE}"`) +
            txt(173, 191, 9.5, DIM, 'Reset permissions', 500, 'middle') +
            box(104, 208, 224, 1, LINE, 0) +
            txt(112, 228, 10.5, DIM, '🍪 Cookies and site data') +
            txt(320, 228, 10.5, DIM, '›', 600, 'middle') +
            txt(112, 248, 10.5, DIM, '⚙️ Site settings') +
            txt(320, 248, 10.5, DIM, '↗', 600, 'middle') +
            `</g>` +
            // Cursor LAST: SVG paints in document order, so anything drawn before
            // the menu ends up underneath it (the visual auditor caught the
            // pointer vanishing behind the opened panel, 8/31).
            cursor2(180, 245, 118, 58, 296, 122)
        ),
      },
      {
        caption:
          'No Notifications row? Open “Site settings” from that same menu. Under Permissions, find Notifications and switch its dropdown to ALLOW.',
        svg: scene(
          winSettings('cobaltstudy.com - Site settings') +
            txt(30, 58, 10.5, DIM, 'Permissions', 650) +
            box(324, 44, 108, 22, PANEL2, 11, `stroke="${LINE}"`) +
            txt(378, 59, 9, DIM, 'Reset permissions', 500, 'middle') +
            icoPin(38, 77) +
            txt(60, 88, 10.5, TXT, 'Location') +
            dropBtn(312, 74, 120, 'Ask (default)') +
            icoCam(38, 105) +
            txt(60, 116, 10.5, TXT, 'Camera') +
            dropBtn(312, 102, 120, 'Ask (default)') +
            icoMic(38, 133) +
            txt(60, 144, 10.5, TXT, 'Microphone') +
            dropBtn(312, 130, 120, 'Ask (default)') +
            icoMotion(38, 161) +
            txt(60, 172, 10.5, TXT, 'Motion sensors') +
            dropBtn(312, 158, 120, 'Allow (default)') +
            icoBell(38, 189) +
            txt(60, 200, 10.5, TXT, 'Notifications') +
            `<g class="bf">${dropBtn(312, 186, 120, 'Block', RED)}</g><g class="af">${dropBtn(312, 186, 120, 'Allow', GREEN)}</g>` +
            icoCode(38, 217) +
            txt(60, 228, 10.5, TXT, 'JavaScript') +
            dropBtn(312, 214, 120, 'Allow (default)') +
            hl(306, 180, 132, 34) +
            cursor(180, 245, 366, 196)
        ),
      },
      {
        caption:
          'Reload the tab afterwards. Permission changes only apply on a fresh page load.',
        svg: scene(
          browser(txt(414, 61, 12, TXT, '🔔'), 'cobaltstudy.com', os === 'mac') +
            txt(230, 150, 12, TXT, os === 'mac' ? 'Press ⟳ (or ⌘ + R)' : 'Press ⟳ (or Ctrl + R)', 650, 'middle') +
            txt(230, 170, 10.5, DIM, 'The new permission kicks in on the next load.', 500, 'middle') +
            hl(64, 45, 22, 22) +
            cursor(150, 190, 75, 56)
        ),
      },
      testStep(os, 'Permission allowed and the page reloaded?'),
    ],
});

const WIN_DND_GUIDE: Guide = {
    title: 'Windows Do Not Disturb is on',
    tag: 'Common',
    emoji: '🌙',
    // RAINBOW, not the accent (Gabe, 8/11): the guide cards descend
    // red → orange → YELLOW → green → blue → violet, so this one stays yellow
    // even though the brand gold it happens to match was retired. Do not sweep
    // it with the accent.
    color: '#e6a817',
    blurb: 'DND (and Focus sessions) silently swallow every popup, and Windows often turns them on by itself.',
    steps: [
      {
        caption:
          'Click the CLOCK in the bottom-right corner of the taskbar (or press Win + N). That opens this panel. If it says “Do not disturb is on”, click the sleeping-bell (zᶻ) button in the header so it turns OFF.',
        // TWO clicks (Gabe, 8/31): the clock opens the panel, then the sleeping
        // bell turns DND off.
        svg: scene(
          box(16, 224, 428, 26, PANEL, 8) +
            txt(60, 241, 10, DIM, '🌐  📁  🎵') +
            txt(400, 241, 10, TXT, '3:42 PM  ·  7/15/2026', 500, 'middle') +
            hl(348, 227, 104, 21) +
            `<g class="af1">` +
            box(230, 16, 214, 196, PANEL, 12) +
            txt(246, 38, 11.5, TXT, 'Notifications', 650) +
            `<g class="bf2">${box(362, 24, 26, 20, GOLD, 7)}${icoDnd(368, 27, '#071433')}</g>` +
            `<g class="af2">${box(362, 24, 26, 20, PANEL2, 7)}${icoBell(368, 27)}</g>` +
            box(394, 24, 42, 20, PANEL2, 7) +
            txt(415, 37, 8, DIM, 'Clear all', 500, 'middle') +
            // The status card leaves with DND itself at click 2 — a bell reading
            // "off" above text still claiming DND is on read as a contradiction
            // (visual auditor, 8/31).
            `<g class="bf2">` +
            box(244, 52, 186, 54, PANEL2, 8) +
            icoDnd(254, 60) +
            txt(274, 70, 10, TXT, 'Do not disturb is on', 650) +
            txt(256, 84, 8.5, DIM, 'You’ll only see banners for priority') +
            txt(256, 95, 8.5, DIM, 'notifications and alarms.') +
            `</g>` +
            txt(256, 120, 9.5, GOLD, 'Notification settings') +
            box(244, 130, 186, 42, PANEL2, 8) +
            txt(256, 146, 9.5, TXT, '⏰ Due soon: Science lab') +
            txt(256, 160, 8.5, DIM, 'Cobalt · missed while DND was on') +
            box(244, 180, 186, 26, PANEL2, 8) +
            txt(337, 197, 9.5, DIM, 'Wednesday, July 15', 500, 'middle') +
            hl(356, 18, 38, 32) +
            `</g>` +
            cursor2(120, 160, 396, 234, 372, 30)
        ),
      },
      {
        caption:
          'Windows re-arms DND on its own! In Settings ▸ System ▸ Notifications, expand “Turn on do not disturb automatically” and untick the rules, especially full-screen apps, gaming, and duplicated displays.',
        // TWO clicks (Gabe, 8/31): the chevron expands the rules, then one press
        // starts unticking them.
        svg: scene(
          winSettings('System › Notifications') +
            box(28, 42, 404, 26, PANEL2, 8) +
            txt(40, 59, 10.5, TXT, '🕐 Turn on do not disturb automatically') +
            txt(420, 59, 10, DIM, '⌃', 600, 'end') +
            `<g class="af1">` +
            checkbox(40, 78, 'off') +
            txt(62, 89, 10, TXT, 'During these times') +
            txt(70, 111, 9.5, DIM, 'Turn on') +
            box(300, 100, 34, 16, PANEL2, 4, `stroke="${LINE}"`) + txt(317, 111, 8.5, DIM, '11', 500, 'middle') +
            box(338, 100, 34, 16, PANEL2, 4, `stroke="${LINE}"`) + txt(355, 111, 8.5, DIM, '00', 500, 'middle') +
            box(376, 100, 34, 16, PANEL2, 4, `stroke="${LINE}"`) + txt(393, 111, 8.5, DIM, 'PM', 500, 'middle') +
            txt(70, 133, 9.5, DIM, 'Turn off') +
            box(300, 122, 34, 16, PANEL2, 4, `stroke="${LINE}"`) + txt(317, 133, 8.5, DIM, '7', 500, 'middle') +
            box(338, 122, 34, 16, PANEL2, 4, `stroke="${LINE}"`) + txt(355, 133, 8.5, DIM, '00', 500, 'middle') +
            box(376, 122, 34, 16, PANEL2, 4, `stroke="${LINE}"`) + txt(393, 133, 8.5, DIM, 'AM', 500, 'middle') +
            checkbox2(40, 148, 'bf2') +
            txt(62, 159, 9.5, TXT, 'When duplicating your display (priority notification banners are also hidden)') +
            checkbox2(40, 172, 'bf2') +
            txt(62, 183, 9.5, TXT, 'When playing a game') +
            checkbox2(40, 196, 'bf2') +
            txt(62, 207, 9.5, TXT, 'When using an app in full-screen mode (priority notification banners are also hidden)') +
            checkbox(40, 220, 'off') +
            txt(62, 231, 9.5, TXT, 'For the first hour after a Windows feature update') +
            hl(33, 141, 29, 78) +
            `</g>` +
            cursor2(200, 250, 414, 52, 46, 146)
        ),
      },
      {
        caption:
          'Focus sessions block popups too. A running session keeps DND on for its whole length. If the bottom of the clock panel says “Focusing”, press End session (Focus also lives in Settings ▸ System ▸ Notifications ▸ Focus).',
        svg: scene(
          box(230, 30, 214, 200, PANEL, 12) +
            txt(246, 52, 11.5, TXT, 'Notifications', 650) +
            box(244, 66, 186, 100, PANEL2, 8) +
            txt(337, 112, 9.5, DIM, 'No new notifications', 500, 'middle') +
            txt(337, 126, 8.5, DIM, '(they’re muted while focusing)', 500, 'middle') +
            box(244, 176, 186, 40, PANEL2, 8) +
            txt(256, 200, 10.5, TXT, 'Focusing', 650) +
            txt(310, 200, 10, DIM, '24:12') +
            box(348, 183, 74, 26, PANEL, 7, `stroke="${LINE}"`) +
            txt(385, 200, 9, TXT, 'End session', 500, 'middle') +
            hl(342, 178, 86, 36) +
            cursor(140, 120, 384, 194) +
            txt(120, 90, 10.5, DIM, 'Started a Focus', 600, 'middle') +
            txt(120, 106, 10.5, DIM, 'session? It mutes', 500, 'middle') +
            txt(120, 122, 10.5, DIM, 'popups until it ends.', 500, 'middle')
        ),
      },
      testStep('windows', 'DND off and no Focus session running?'),
    ],
};

const WIN_SETTINGS_GUIDE: Guide = {
    title: 'Windows notification settings',
    tag: 'Occasional',
    emoji: '🪟',
    color: '#27ae60',
    blurb: 'Windows can mute everything, mute just your browser, or hide the banners.',
    steps: [
      {
        caption:
          'Open Settings ▸ System ▸ Notifications. The master “Notifications” switch at the very top (“get notifications from apps and other senders”) must be ON (and “Do not disturb”, right under it, OFF).',
        svg: scene(
          winSettings('System › Notifications') +
            rowIco(40, icoBell(38, 50), 'Notifications', onOffToggle(376, 48, 'turnsOn') + txt(430, 62, 10, DIM, '⌄', 600, 'end'), 'Get notifications from apps and other senders') +
            rowIco(78, icoDnd(38, 88), 'Do not disturb', onOffToggle(376, 86, 'off'), 'Notifications will be sent directly to notification center') +
            rowIco(116, icoClock(38, 126), 'Turn on do not disturb automatically', txt(430, 137, 10, DIM, '⌄', 600, 'end')) +
            rowIco(154, icoPrio(38, 164), 'Set priority notifications', txt(430, 175, 10.5, DIM, '›', 600, 'end')) +
            rowIco(192, icoTarget(38, 202), 'Focus', txt(430, 213, 10.5, DIM, '›', 600, 'end'), 'Session duration, hide badges on apps') +
            hl(342, 42, 74, 30) +
            cursor(180, 225, 384, 54)
        ),
      },
      {
        caption:
          'Scroll the same page to “Notifications from apps and other senders”: Google Chrome (or your browser) has its OWN switch. Windows can mute one app while everything else still works.',
        svg: scene(
          winSettings('System › Notifications') +
            txt(28, 56, 10.5, DIM, 'Notifications from apps and other senders', 650) +
            txt(28, 77, 8.5, DIM, 'Sort by:') +
            dropBtn(70, 62, 104, 'Most recent') +
            rowIco(92, icoChrome(38, 102), 'Google Chrome', onOffToggle(376, 100, 'turnsOn') + txt(430, 113, 11, DIM, '›', 600, 'end'), 'Banners, Sounds') +
            rowIco(138, tileIco(38, 148, '✂️'), 'Snipping Tool', onOffToggle(376, 146, 'on') + txt(430, 159, 11, DIM, '›', 600, 'end'), 'Banners, Sounds') +
            rowIco(184, tileIco(38, 194, '⚙️'), 'Settings', onOffToggle(376, 192, 'on') + txt(430, 205, 11, DIM, '›', 600, 'end'), 'Banners, Sounds') +
            hl(342, 94, 74, 30) +
            cursor(180, 235, 384, 106)
        ),
      },
      {
        caption:
          'Click the Google Chrome row itself and tick BOTH boxes: “Show notification banners” (the popup in the corner) and “Show notifications in notification center” (the Win + N list). Without banners, alerts arrive silently.',
        svg: scene(
          winSettings('System › Notifications › Google Chrome') +
            row(38, 'Notifications', onOffToggle(384, 46, 'on')) +
            box(40, 80, 150, 54, PANEL2, 8) +
            box(44, 122, 142, 6, PANEL, 2) +
            box(128, 102, 54, 16, PANEL, 4, `stroke="${LINE}"`) +
            box(40, 80, 150, 54, 'none', 8, `stroke="${LINE}"`) +
            box(240, 80, 150, 54, PANEL2, 8) +
            box(246, 86, 58, 10, PANEL, 3) +
            box(312, 86, 70, 12, PANEL, 3, `stroke="${LINE}"`) +
            box(312, 102, 70, 12, PANEL, 3, `stroke="${LINE}"`) +
            box(240, 80, 150, 54, 'none', 8, `stroke="${LINE}"`) +
            checkbox(40, 142, 'checks') +
            txt(62, 154, 10, TXT, 'Show notification banners') +
            checkbox(240, 142, 'checks') +
            txt(262, 149, 10, TXT, 'Show notifications in') +
            txt(262, 161, 10, TXT, 'notification center') +
            txt(40, 184, 10, TXT, 'Hide content when notifications are on lock screen') +
            onOffToggle(384, 174, 'on') +
            txt(40, 204, 10, TXT, 'Play a sound when a notification arrives') +
            onOffToggle(384, 194, 'on') +
            txt(40, 224, 9.5, DIM, 'Priority of notifications in notification center', 650) +
            radio(48, 238, 'un') +
            txt(58, 242, 9.5, TXT, 'Top') +
            radio(98, 238, 'un') +
            txt(108, 242, 9.5, TXT, 'High') +
            radio(158, 238, 'sel') +
            txt(168, 242, 9.5, TXT, 'Normal') +
            hl(33, 136, 345, 30) +
            cursor(200, 60, 46, 148)
        ),
      },
      testStep('windows', 'Windows switches all back on?'),
    ],
};

const chromeGlobalGuide = (os: GuideOS): Guide => ({
    title: 'Chrome’s global notification setting',
    tag: 'Uncommon',
    emoji: '🌐',
    color: '#4098d7',
    blurb: 'The browser can be set so NO website may send notifications at all.',
    steps: [
      {
        caption:
          'Paste chrome://settings/content/notifications in the address bar. Under “Default behavior”, if “Don’t allow sites to send notifications” is selected, every site, Cobalt included, is silenced. Choose “Sites can ask to send notifications”.',
        svg: scene(
          browser('', 'chrome://settings/content/notifications', os === 'mac') +
            txt(28, 96, 10.5, DIM, 'Default behavior', 650) +
            txt(28, 110, 8.5, DIM, 'Sites automatically follow this setting when you visit them') +
            box(28, 118, 404, 34, PANEL2, 8) +
            radio(46, 135, 'selects') +
            txt(60, 139, 10.5, TXT, '🔔 Sites can ask to send notifications') +
            box(28, 158, 404, 34, PANEL2, 8) +
            radio(46, 175, 'was') +
            txt(60, 179, 10.5, TXT, '🔕 Don’t allow sites to send notifications') +
            hl(22, 112, 416, 46) +
            cursor(200, 230, 46, 138)
        ),
      },
      {
        caption:
          'Scroll to “Customized behaviors” on the same page: the “Not allowed to send notifications” list. If cobaltstudy.com is in it, open its ⋮ menu (far right of the row) and press Allow.',
        svg: scene(
          browser('', 'chrome://settings/content/notifications', os === 'mac') +
            txt(28, 96, 10.5, DIM, 'Customized behaviors', 650) +
            txt(28, 110, 8.5, DIM, 'Sites listed below follow a custom setting instead of the default') +
            txt(28, 130, 10, TXT, 'Not allowed to send notifications') +
            box(384, 116, 48, 20, PANEL2, 10, `stroke="${LINE}"`) +
            txt(408, 130, 9.5, DIM, 'Add', 600, 'middle') +
            box(28, 140, 404, 34, PANEL2, 8) +
            txt(44, 161, 10.5, TXT, '🌐 https://cobaltstudy.com:443') +
            txt(392, 162, 10, DIM, '▸', 600, 'middle') +
            txt(414, 162, 13, DIM, '⋮', 700, 'middle') +
            hl(402, 143, 24, 28) +
            // TWO clicks (Gabe, 8/31): ⋮ opens the row menu, then Allow is
            // pressed — the menu closes and the row reads as allowed.
            `<g class="af1"><g class="bf2">` +
            box(306, 176, 120, 62, PANEL, 9, `stroke="${LINE}"`) +
            txt(320, 196, 10.5, GREEN, 'Allow', 650) +
            txt(320, 214, 10.5, TXT, 'Edit') +
            txt(320, 230, 10.5, TXT, 'Remove') +
            `</g></g>` +
            `<g class="af2">${txt(380, 162, 9.5, GREEN, 'Allowed ✓', 650, 'end')}</g>` +
            // Cursor LAST so it rides above the opened menu (paint order).
            cursor2(200, 220, 414, 157, 318, 190)
        ),
      },
      testStep(os, 'Chrome’s default fixed and Cobalt allowed?'),
    ],
});

const edgeCasesGuide = (os: GuideOS): Guide => ({
    title: 'Still stuck? Edge cases',
    tag: 'Rare',
    emoji: '🧩',
    color: '#9b7ec8',
    blurb:
      os === 'windows'
        ? 'Private windows, other browser profiles, presenting, and battery savers.'
        : 'Private windows and other browser profiles.',
    steps: [
      {
        caption:
          'Notification permission is PER BROWSER PROFILE. If you allowed Cobalt on your school profile, your personal profile is still blocked. Sign into the profile you actually use and allow it there too.',
        svg: scene(
          box(60, 60, 150, 130, PANEL, 12) +
            `<circle cx="135" cy="105" r="24" fill="${GOLD}"/>` +
            txt(135, 112, 16, '#071433', 'G', 800, 'middle') +
            txt(135, 150, 10.5, TXT, 'School profile', 600, 'middle') +
            txt(135, 168, 10, GREEN, '🔔 Allowed ✓', 650, 'middle') +
            box(250, 60, 150, 130, PANEL, 12) +
            `<circle cx="325" cy="105" r="24" fill="${PANEL2}"/>` +
            txt(325, 112, 16, DIM, 'G', 800, 'middle') +
            txt(325, 150, 10.5, TXT, 'Personal profile', 600, 'middle') +
            txt(325, 168, 10, RED, '🔕 Blocked', 650, 'middle') +
            hl(295, 154, 60, 21) +
            txt(230, 225, 10.5, DIM, 'Each profile keeps its own permission. Allow Cobalt in both.', 500, 'middle')
        ),
      },
      {
        caption:
          'Incognito windows never show site notifications. You can tell you’re in one by the “Incognito” chip at the TOP-RIGHT of the toolbar (and the dark “You’ve gone Incognito” new-tab page). Keep Cobalt in a normal window.',
        svg: scene(
          box(16, 20, 428, 200, '#181e2d', 10) +
            (os === 'mac'
              ? trafficDots(28, 36) + box(64, 26, 110, 20, '#1f2430', 7) + txt(78, 40, 10.5, DIM, 'New Tab')
              : box(28, 26, 110, 20, '#1f2430', 7) + txt(42, 40, 10.5, DIM, 'New Tab')) +
            txt(34, 66, 12, DIM, '‹') +
            txt(52, 66, 12, DIM, '›') +
            txt(70, 66, 11, DIM, '⟳') +
            box(84, 52, 248, 20, '#0f1421', 10) +
            box(340, 52, 92, 20, '#1f2430', 10) +
            txt(386, 66, 9.5, TXT, '🕶 Incognito', 600, 'middle') +
            hl(336, 48, 100, 28) +
            txt(230, 122, 26, TXT, '🕶', 500, 'middle') +
            txt(230, 152, 13, TXT, 'You’ve gone Incognito', 650, 'middle') +
            txt(230, 170, 9.5, DIM, 'Sites you visit here can’t send notifications, by design, in every browser.', 500, 'middle') +
            txt(230, 240, 10.5, DIM, 'Open Cobalt in a regular window instead.', 500, 'middle')
        ),
      },
      // Presenting/battery/game modes are the WINDOWS story — on the Mac,
      // mirroring/sharing lives as a slide inside the macOS-settings guide.
      ...(os === 'windows'
        ? [
            {
              caption:
                'While you present or share your screen, Chrome AND Windows both hide notifications automatically, and some battery-saver / gaming modes do too. They come back on their own when you’re done.',
              svg: scene(
                txt(110, 105, 30, TXT, '🖥️', 500, 'middle') +
                  txt(110, 140, 10.5, DIM, 'Presenting / sharing', 600, 'middle') +
                  txt(230, 105, 30, TXT, '🔋', 500, 'middle') +
                  txt(230, 140, 10.5, DIM, 'Battery saver', 600, 'middle') +
                  txt(350, 105, 30, TXT, '🎮', 500, 'middle') +
                  txt(350, 140, 10.5, DIM, 'Game modes', 600, 'middle') +
                  txt(230, 190, 11, TXT, 'All three pause popups temporarily. Nothing to fix,', 500, 'middle') +
                  txt(230, 208, 11, TXT, 'they return when the mode ends.', 500, 'middle')
              ),
            },
          ]
        : []),
      testStep(os, 'Back in a normal window, on the right profile?', true),
    ],
});

export const NOTIFY_GUIDES_WINDOWS: Guide[] = [
  cobaltSwitchesGuide('windows'),
  browserBlockedGuide('windows'),
  WIN_DND_GUIDE,
  WIN_SETTINGS_GUIDE,
  chromeGlobalGuide('windows'),
  edgeCasesGuide('windows'),
];

// ---------------------------------------------------------------------------
// THE MAC GUIDES (8/31) — same slideshow format, drawn for macOS System Settings.
// The four OS-neutral guides come from the factories above with os='mac'.
// FIDELITY: the macOS scenes are drawn from Gabe's own Mac (2026-08, current
// Chrome) — the same debugging session that surfaced the duplicate-Chrome trap,
// plus his Control Center / Focus screenshots from 8/31.

/** The macOS Notifications ▸ Google Chrome page, ONE scene used by BOTH the
 *  "allow + tick the boxes" slide and the duplicate-entry "repeat in every row"
 *  slide — it is the same Settings screen, so the two slides must look
 *  identical (Gabe, 8/31). Drawn from Gabe's real screenshot: Allow toggle up
 *  top, then the three window thumbnails — Desktop, Notification Center, Lock
 *  Screen — each with a checkbox, then the Badge and Sound togglers. (Alert
 *  Style / previews / grouping deliberately left out — not part of the fix.)
 *  THREE clicks (Gabe, 8/31): the Allow switch flips, then one press on a
 *  checkbox ticks all three windows, then one press switches on Badge AND
 *  Sound together. */
const macChromePageScene = (): string => {
  const thumb = (x: number, label: string, sketch: string): string =>
    box(x, 78, 96, 48, PANEL2, 8, `stroke="${LINE}"`) +
    sketch +
    txt(x + 48, 140, 8.5, TXT, label, 500, 'middle') +
    checkbox2(x + 40, 146, 'fb');
  const screen = (x: number): string => box(x + 10, 84, 76, 36, PANEL, 4, `stroke="${LINE}"`);
  const ncLines = (x: number): string =>
    [0, 1, 2, 3].map((i) => box(x + 52, 88 + i * 7, 28, 4, PANEL2, 1.5)).join('');
  const toggleC = (y: number): string =>
    `<g class="gc">${toggle(384, y, 'off')}</g><g class="fc">${toggle(384, y, 'on')}</g>`;
  return scene(
    winSettings('Notifications › Google Chrome') +
      box(28, 40, 404, 30, PANEL2, 8) +
      chromeLogo(38, 47, 16) +
      txt(62, 59, 11, TXT, 'Allow notifications') +
      `<g class="ga">${toggle(384, 46, 'off')}</g><g class="fa">${toggle(384, 46, 'on')}</g>` +
      thumb(52, 'Desktop', screen(52) + box(110, 88, 22, 8, PANEL2, 2, `stroke="${LINE}"`)) +
      thumb(182, 'Notification Center', screen(182) + ncLines(182)) +
      thumb(312, 'Lock Screen', screen(312) + txt(360, 98, 9, DIM, '9:41', 600, 'middle') + box(338, 104, 24, 8, PANEL2, 2, `stroke="${LINE}"`)) +
      hl(44, 134, 380, 32) +
      box(28, 174, 404, 26, PANEL2, 8) +
      txt(42, 191, 10, TXT, 'Badge application icon') +
      toggleC(178) +
      box(28, 206, 404, 26, PANEL2, 8) +
      txt(42, 223, 10, TXT, 'Play sound for notification') +
      toggleC(210) +
      cursor3(210, 238, 396, 46, 90, 144, 396, 182)
  );
};
const MAC_CHROME_PAGE_SCENE = macChromePageScene();

/** Crescent moon (the macOS Focus glyph — on the Mac it IS a moon, unlike the
 *  Win11 sleeping bell above). Scaled from the app's 24-box moon icon. */
const icoMoon = (x: number, y: number, stroke = DIM): string =>
  `<g transform="translate(${x},${y}) scale(0.62)" fill="none" stroke="${stroke}" stroke-width="2" stroke-linecap="round" stroke-linejoin="round">` +
  `<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></g>`;

/** One macOS app-list row: icon + name + "Banners"/"Off" sub + chevron. The
 *  `sub` rides through rowIco; pass extra fragments (a red Off, a toggle) via
 *  `control`. */
const macAppRow = (y: number, icon: string, name: string, sub: string, control = ''): string =>
  rowIco(y, icon, name, txt(430, y + 21, 11, DIM, '›', 600, 'end') + control, sub);

// This guide also owns THE TRAP (8/31): TWO "Google Chrome" rows can appear in
// the app list, one enabled and looking perfect, while macOS consults the other,
// disabled one — every notification silently swallowed, no error anywhere. That
// exact bug cost a full debugging session on Gabe's own Mac; its slides keep the
// RED highlight. It lived as a standalone guide until 8/31, when Gabe folded it
// (and the mirroring guide) back in here so the Mac and Windows lists stay
// six-for-six with matched colors. (The pulsing index ring it carried was
// removed the same day — blue pulsing on the yellow card looked wrong.)
const MAC_SETTINGS_GUIDE: Guide = {
  title: 'macOS notification settings',
  tag: 'Common',
  emoji: '🍎',
  color: '#e6a817',
  blurb: 'macOS keeps its own per-app switch for Chrome, and its app list can hide a second, disabled Chrome entry that swallows everything.',
  steps: [
    {
      caption:
        'Open the Apple menu ▸ System Settings ▸ Notifications. Cobalt notifies through your browser, so under “Application Notifications”, click Google Chrome.',
      svg: scene(
        winSettings('System Settings › Notifications') +
          txt(28, 58, 10.5, DIM, 'Application Notifications', 650) +
          macAppRow(70, icoChrome(38, 80), 'Google Chrome', 'Badges, Sounds, Desktop') +
          macAppRow(108, tileIco(38, 118, '📅'), 'Calendar', 'Banners') +
          macAppRow(146, tileIco(38, 156, '💬'), 'Messages', 'Banners') +
          macAppRow(184, tileIco(38, 194, '🎧'), 'Music', 'Off') +
          hl(22, 64, 416, 46) +
          cursor(200, 240, 230, 87)
      ),
    },
    {
      caption:
        'On Chrome’s page, switch “Allow notifications” on, tick all three boxes — Desktop, Notification Center and Lock Screen — then switch on “Badge application icon” and “Play sound for notification”.',
      svg: MAC_CHROME_PAGE_SCENE,
    },
    // — the duplicate-Chrome trap (see the guide comment above) —
    {
      caption:
        'THE SNEAKY ONE. Scroll the app list in System Settings ▸ Notifications slowly: it can hold TWO Google Chrome rows, and they look identical. macOS delivers through one of them. If that one is off, every popup vanishes silently while the other row looks fine.',
      svg: scene(
        winSettings('System Settings › Notifications') +
          txt(28, 58, 10.5, DIM, 'Application Notifications', 650) +
          macAppRow(70, icoChrome(38, 80), 'Google Chrome', 'Badges, Sounds, Desktop') +
          macAppRow(112, icoChrome(38, 122), 'Google Chrome', ' ', txt(62, 141, 8.5, RED, 'Off')) +
          macAppRow(154, tileIco(38, 164, '📅'), 'Calendar', 'Banners') +
          arrow(370, 216, 330, 152) +
          hl(22, 106, 416, 46, RED) +
          txt(230, 236, 10.5, DIM, 'Two identical rows. macOS may be consulting the OFF one.', 500, 'middle')
      ),
    },
    {
      caption:
        'Open every Google Chrome row you find and do the same in each one: Allow on, all three boxes ticked, Badges and Sounds on. Both entries on is safe. One entry off is enough to silence Cobalt completely.',
      // Deliberately THE SAME scene as the earlier Chrome-page slide — it is the
      // same Settings screen, just reached through the second row (Gabe, 8/31).
      svg: MAC_CHROME_PAGE_SCENE,
    },
    // — mirroring/sharing, the top switch on the same Notifications page —
    {
      caption:
        'On a projector, an external display, or a screen share, macOS hides banners by default. At the very top of System Settings ▸ Notifications, turn on “Show notifications when mirroring or sharing the display”.',
      svg: scene(
        winSettings('System Settings › Notifications') +
          row(44, 'Show notifications when mirroring or sharing the display', toggle(384, 52, 'turnsOn')) +
          txt(28, 108, 10.5, DIM, 'Application Notifications', 650) +
          macAppRow(120, icoChrome(38, 130), 'Google Chrome', 'Badges, Sounds, Desktop') +
          macAppRow(158, tileIco(38, 168, '📅'), 'Calendar', 'Banners') +
          hl(22, 38, 416, 46) +
          cursor(180, 226, 396, 60) +
          txt(230, 226, 10.5, DIM, 'Off, banners pause the moment the screen is mirrored or shared.', 500, 'middle')
      ),
    },
    testStep('mac', 'Every macOS switch on, both Chrome entries included?'),
  ],
};

const MAC_FOCUS_GUIDE: Guide = {
  title: 'macOS Focus is on',
  tag: 'Occasional',
  emoji: '🌙',
  // Green = position 4 of the likelihood rainbow, same slot as the Windows list.
  color: '#27ae60',
  blurb: 'An active Focus (Do Not Disturb) hides banners until it ends, unless Chrome is allowed through it.',
  steps: [
    {
      caption:
        'Look for the moon in the menu bar at the top of the screen — that moon IS the Focus, and while it is there your banners are hidden. Click it, then click Do Not Disturb in the menu that drops down to switch it off.',
      // REDRAWN AGAIN 9/6/26, and this is the route Gabe actually wants taught:
      // the menu-bar MOON, not the Control Center. Two earlier cuts sent the
      // student to Control Center and tried to draw that whole panel — the
      // connectivity card, the quick buttons, the Display slider — which is a lot
      // of furniture to redraw faithfully and none of it is the thing being
      // clicked. The moon drops a small menu that has Do Not Disturb as its first
      // row, so the path is two clicks with almost nothing to misread. His words:
      // "just have them press the moon and this panel sort of comes up. This is
      // easier."
      // Click 1 = the moon. Click 2 = the Do Not Disturb row, which switches off.
      svg: scene(
        box(16, 14, 428, 22, PANEL, 8) +
          txt(30, 29, 10, DIM, 'Chrome   File   Edit   View') +
          // THE MOON, lit while the Focus runs — a filled pill, the way macOS
          // shows an active menu-bar item. It goes quiet at the second click.
          `<g class="bf2">${box(178, 16.5, 28, 17, GOLD, 8)}${icoMoon(185, 17.5, '#071433')}</g>` +
          `<g class="af2">${box(178, 16.5, 28, 17, PANEL, 8)}${icoMoon(185, 17.5)}</g>` +
          txt(392, 29.5, 9, TXT, 'Sun Sep 6', 500, 'end') +
          txt(436, 29.5, 9, TXT, '4:30 PM', 500, 'end') +
          hl(175, 13.5, 34, 23) +
          // The menu that drops from the moon (click 1).
          `<g class="af1">` +
          box(140, 42, 200, 210, PANEL, 10, `stroke="${LINE}"`) +
          txt(152, 58, 10, TXT, 'Focus', 700) +
          // The header's second line reports the Focus's state, so it is half the
          // answer on its own: it flips to "Off" at the same click as the row.
          `<g class="bf2">${txt(152, 70, 7.5, DIM, 'On Until Tomorrow, 9:00 AM', 500)}</g>` +
          `<g class="af2">${txt(152, 70, 7.5, DIM, 'Off', 500)}</g>` +
          `<rect x="150" y="77" width="180" height="1" fill="${LINE}"/>` +
          // THE ROW THE STUDENT CLICKS. Active = a filled disc with the moon
          // knocked out of it, exactly how the running Focus is marked.
          `<g class="bf2"><circle cx="163" cy="90" r="9" fill="#fff"/>${icoMoon(157, 84, GOLD)}</g>` +
          `<g class="af2"><circle cx="163" cy="90" r="9" fill="${PANEL2}"/>${icoMoon(157, 84)}</g>` +
          txt(178, 93, 9, TXT, 'Do Not Disturb', 600) +
          // The duration block belongs to the running Focus, so its highlight
          // drops away with it.
          `<g class="bf2">${box(148, 101, 184, 27, PANEL2, 5)}</g>` +
          txt(178, 112, 8, TXT, 'For 1 hour', 500) +
          txt(178, 123, 8, TXT, 'Until tomorrow morning', 500) +
          `<rect x="150" y="134" width="180" height="1" fill="${LINE}"/>` +
          // The other Focus modes, listed but not the point.
          [
            ['Sleep', 147],
            ['Mindfulness', 163],
            ['Reduce Interruptions', 179],
            ['Night', 195],
            ['DeProcrastination', 211],
          ]
            .map(
              ([label, cy]) =>
                `<circle cx="163" cy="${cy}" r="8" fill="${PANEL2}"/>` +
                `<circle cx="163" cy="${cy}" r="3.4" fill="none" stroke="${DIM}" stroke-width="1.3"/>` +
                txt(178, Number(cy) + 3, 8, TXT, String(label), 500)
            )
            .join('') +
          `<rect x="150" y="223" width="180" height="1" fill="${LINE}"/>` +
          txt(152, 238, 8, DIM, 'Focus Settings…', 500) +
          hl(146, 79, 188, 24) +
          `</g>` +
          cursor2(90, 214, 190, 22, 174, 86) +
          txt(66, 96, 10.5, DIM, 'The moon in the', 600, 'middle') +
          txt(66, 112, 10.5, DIM, 'menu bar means', 500, 'middle') +
          txt(66, 128, 10.5, DIM, 'a Focus is on.', 500, 'middle') +
          txt(390, 120, 10, DIM, 'Banners come', 500, 'middle') +
          txt(390, 134, 10, DIM, 'back the moment', 500, 'middle') +
          txt(390, 148, 10, DIM, 'it is switched off.', 500, 'middle')
      ),
    },
    {
      caption:
        'Prefer to keep the Focus on? Open System Settings ▸ Focus ▸ Do Not Disturb, click Allowed Apps, press Add and pick Google Chrome. Reminders then arrive even during that Focus.',
      // Drawn from Gabe's own Focus › Do Not Disturb screenshot (8/31): the
      // Allow Notifications section with the People/Apps rows, and the picker
      // sheet with its + Add tile. Click 1 opens the sheet, click 2 adds Chrome.
      svg: scene(
        winSettings('Focus › Do Not Disturb') +
          txt(28, 58, 10.5, DIM, 'Allow Notifications', 650) +
          txt(28, 74, 8.5, DIM, 'Notifications from selected people and apps will be allowed, all others will be silenced.') +
          row(84, 'Allowed People', txt(422, 105, 10.5, DIM, '›', 600, 'end'), 'None allowed') +
          row(122, 'Allowed Apps', txt(422, 143, 10.5, DIM, '›', 600, 'end'), 'None allowed') +
          hl(22, 116, 416, 46) +
          `<g class="af1">` +
          box(120, 130, 250, 108, PANEL2, 10, `stroke="${LINE}"`) +
          txt(134, 148, 9.5, TXT, 'Notifications', 650) +
          txt(356, 148, 8.5, DIM, 'Allow Some Apps ▾', 500, 'end') +
          txt(134, 162, 7.5, DIM, 'Apps you select can notify you while this Focus is on.') +
          box(134, 172, 44, 34, PANEL, 8, `stroke="${LINE}"`) +
          txt(156, 187, 11, TXT, '+', 700, 'middle') +
          txt(156, 200, 7, DIM, 'Add', 500, 'middle') +
          `<g class="af2">${box(186, 172, 118, 34, PANEL, 8, `stroke="${GOLD}"`)}${chromeLogo(194, 179, 20)}${txt(220, 193, 9, TXT, 'Google Chrome')}</g>` +
          box(316, 210, 44, 20, GOLD, 7) +
          txt(338, 223.5, 8.5, '#071433', 'Done', 650, 'middle') +
          `</g>` +
          cursor2(200, 238, 396, 136, 154, 186)
      ),
    },
    testStep('mac', 'Focus off, or Chrome allowed through it?'),
  ],
};

// SIX guides, matching the Windows list one-for-one so both index screens share
// the same height and the same red → violet likelihood rainbow (Gabe, 8/31).
// The shared guides are the factories with os='mac': Mac toasts, Mac browser
// chrome, and (for edge cases) no presenting step — mirroring lives inside the
// macOS-settings guide instead.
export const NOTIFY_GUIDES_MAC: Guide[] = [
  cobaltSwitchesGuide('mac'),
  browserBlockedGuide('mac'),
  MAC_SETTINGS_GUIDE, // includes the duplicate-Chrome trap + mirroring slides
  MAC_FOCUS_GUIDE,
  chromeGlobalGuide('mac'),
  edgeCasesGuide('mac'),
];
