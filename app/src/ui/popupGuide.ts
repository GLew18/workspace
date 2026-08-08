// WorkSpace: the pop-up blocker fix-it guide.
//
// WHY THIS EXISTS: "Open all" opens links with window.open, and Chrome's pop-up
// blocker allows exactly ONE per click, so with pop-ups blocked the button
// appears to open a single tab and looks broken (Gabe hit this live, 8/7/26).
// The extension path dodges the blocker entirely, but a student without the
// extension needs the site permission flipped, and nobody knows that setting
// exists. This guide shows the three-step fix: the icon left of the URL, the
// "Pop-ups and redirects" toggle, reload.
//
// The scenes copy CHROME'S OWN dark UI (from Gabe's screenshot): its grays, its
// blue toggles, its site-info panel. Only the instructional overlays (cursor,
// highlight ring) are WorkSpace gold. Player chrome and launcher reuse the
// notification fix-it guides' classes (.ngd*, .notify-howto in settings.css),
// so the two guide systems look like one product.

import { el } from '../util/dom';

// ---- palette: Chrome's dark theme, lifted from the screenshot ----------------
const CBG = '#202124'; // browser chrome background
const OMNI = '#292a2d'; // the omnibox pill
const PANEL = '#2b2d30'; // the site-info panel
const LINE = '#3c4043';
const TXT = '#e8eaed';
const DIM = '#9aa0a6';
const BLUE = '#a8c7fa'; // Chrome's toggle-on blue
const OFFP = '#5f6368'; // toggle-off pill
const WARN = '#f28b82'; // the "not secure" warning red
const GOLD = '#e6a817'; // WorkSpace's instructional overlay color only

// Timing classes: .c cursor glide, .r click ripple, .pu pulse, and the toggle
// pair .tk/.tp (knob slides right, pill turns Chrome-blue at the click beat).
const SCENE_CSS = `
  .gdsvg .c{animation:kC 6s ease-in-out infinite}
  @keyframes kC{0%,18%{transform:translate(var(--x0),var(--y0))}42%,100%{transform:translate(var(--x1),var(--y1))}}
  .gdsvg .r{opacity:0;transform-box:fill-box;transform-origin:center;animation:kR 6s infinite}
  @keyframes kR{0%,46%{opacity:0;transform:scale(.3)}52%{opacity:.5;transform:scale(.7)}62%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .tk{animation:kK 6s infinite}
  @keyframes kK{0%,54%{transform:translateX(0)}60%,100%{transform:translateX(12px)}}
  .gdsvg .tp{animation:kP 6s infinite}
  @keyframes kP{0%,54%{fill:${OFFP}}60%,100%{fill:${BLUE}}}
  .gdsvg .pu{animation:kU 1.8s ease-in-out infinite}
  @keyframes kU{0%,100%{opacity:.35}50%{opacity:1}}`;

const scene = (inner: string): string =>
  `<svg class="gdsvg" viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" role="img">` +
  `<style>${SCENE_CSS}</style><rect width="460" height="260" rx="12" fill="${CBG}"/>${inner}</svg>`;

const T = (x: number, y: number, s: number, f: string, t: string, w = 500, a = 'start'): string =>
  `<text x="${x}" y="${y}" font-size="${s}" fill="${f}" font-weight="${w}" text-anchor="${a}" font-family="Inter,system-ui,sans-serif">${t}</text>`;

const B = (x: number, y: number, w: number, h: number, f: string, rx = 8, ex = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${ex}/>`;

const cursor = (x0: number, y0: number, x1: number, y1: number): string =>
  `<circle class="r" cx="${x1 + 2}" cy="${y1 + 2}" r="11" fill="${GOLD}"/>` +
  `<g class="c" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px">` +
  `<path d="M0 0 L0 15 L4.2 11.6 L7.2 18 L9.8 16.8 L6.9 10.6 L11.5 10.2 Z" fill="#fff" stroke="#0a0f1e" stroke-width="1.2"/></g>`;

const hl = (x: number, y: number, w: number, h: number): string =>
  `<rect class="pu" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${GOLD}" stroke-width="2"/>`;

/** Chrome's toggle. 'on' static blue, 'off' static gray, 'turnsOn' flips at the
 *  click beat (pill recolors, knob slides). */
function toggle(x: number, y: number, mode: 'on' | 'off' | 'turnsOn'): string {
  const pillFill = mode === 'on' ? BLUE : OFFP;
  const pillCls = mode === 'turnsOn' ? ' class="tp"' : '';
  const knobX = mode === 'on' ? x + 19 : x + 7;
  const knobCls = mode === 'turnsOn' ? ' class="tk"' : '';
  return (
    `<rect${pillCls} x="${x}" y="${y}" width="26" height="14" rx="7" fill="${pillFill}"/>` +
    `<circle${knobCls} cx="${knobX}" cy="${y + 7}" r="5" fill="#fff"/>`
  );
}

/** The site-info panel from the screenshot: title, warning, the two permission
 *  rows, Reset permissions. `popups` picks the Pop-ups row's toggle state. */
function sitePanel(popups: 'off' | 'turnsOn' | 'on'): string {
  return (
    B(120, 16, 225, 228, PANEL, 10, `stroke="${LINE}"`) +
    T(136, 40, 11, TXT, 'localhost:5173', 600) +
    T(326, 41, 11, DIM, '✕', 600) +
    B(132, 52, 201, 1, LINE, 0) +
    // the warning block, compressed to two lines
    T(136, 72, 8.5, WARN, '⚠ Your connection to this site is not secure', 600) +
    T(148, 85, 7.5, DIM, 'You should not enter any sensitive information') +
    B(132, 96, 201, 1, LINE, 0) +
    // permission rows
    T(136, 118, 9.5, TXT, '🔔 Notifications') +
    toggle(305, 109, 'on') +
    T(136, 146, 9.5, TXT, '⧉ Pop-ups and redirects') +
    toggle(305, 137, popups) +
    // reset pill
    B(136, 162, 110, 22, PANEL, 11, `stroke="${DIM}"`) +
    T(191, 177, 8.5, TXT, 'Reset permissions', 500, 'middle') +
    B(132, 196, 201, 1, LINE, 0) +
    T(136, 216, 9, DIM, '🕒 Cookies and site data          ›') +
    T(136, 236, 9, DIM, '⚙ Site settings                        ↗') +
    ''
  );
}

/** The browser's top strip: omnibox with the site-info icon at its left. */
function browserBar(): string {
  return (
    B(14, 14, 432, 30, OMNI, 15, `stroke="${LINE}"`) +
    `<circle cx="34" cy="29" r="8" fill="none" stroke="${DIM}" stroke-width="1.4"/>` +
    T(34, 33, 10, DIM, 'i', 700, 'middle') +
    T(52, 33, 10.5, TXT, 'localhost:5173/...') +
    T(432, 33, 10, DIM, '☆', 500, 'middle')
  );
}

interface Step {
  caption: string;
  svg: string;
}

const STEPS: Step[] = [
  {
    caption:
      'In the address bar, click the little icon just LEFT of the web address. (On some sites it looks like sliders instead of an i.)',
    svg: scene(
      browserBar() +
        // a faint WorkSpace page below, so the scene reads as "your open tab".
        // Deliberately WORDLESS: a lone "W" here just read as a stray letter.
        B(14, 56, 432, 190, '#0d1526', 10) +
        B(40, 120, 380, 26, '#182338', 8) +
        B(40, 156, 380, 26, '#182338', 8) +
        B(40, 192, 180, 26, '#22304f', 8) +
        hl(20, 17, 28, 24) +
        cursor(300, 190, 32, 26)
    ),
  },
  {
    caption: 'A panel opens. Find "Pop-ups and redirects" and turn it ON.',
    svg: scene(browserBar() + sitePanel('turnsOn') + hl(130, 132, 205, 22) + cursor(400, 220, 316, 143)),
  },
  {
    caption: 'Done. Reload the page, then press Open all again: every link opens this time.',
    svg: scene(
      browserBar() +
        sitePanel('on') +
        // Chrome's own "reload to apply" nudge, top right
        B(330, 52, 116, 24, PANEL, 12, `stroke="${LINE}"`) +
        T(388, 68, 8.5, TXT, '↻ Reload this page', 600, 'middle') +
        hl(326, 49, 124, 30)
    ),
  },
];

/** The launcher: same style as the notification fix-it button (.notify-howto). */
export function popupGuideButton(): HTMLButtonElement {
  const btn = el('button', {
    class: 'notify-howto',
    type: 'button',
    text: '“Open all” not deploying multiple tabs? Fix it →',
  }) as HTMLButtonElement;
  btn.addEventListener('click', openPopupBlockerGuide);
  return btn;
}

/** The three-step player, in the fix-it guides' clothes (.ngd* classes). */
export function openPopupBlockerGuide(): void {
  if (document.querySelector('.ngd')) return; // one guide overlay at a time
  const overlay = el('div', { class: 'ngd' });
  const card = el('div', { class: 'ngd-card' });
  let si = 0;

  const close = (): void => {
    overlay.remove();
    document.removeEventListener('keydown', onKey);
  };
  const onKey = (e: KeyboardEvent): void => {
    if (e.key === 'Escape') close();
    else if (e.key === 'ArrowRight') go(1);
    else if (e.key === 'ArrowLeft') go(-1);
  };
  document.addEventListener('keydown', onKey);
  const go = (delta: number): void => {
    si = Math.max(0, Math.min(STEPS.length - 1, si + delta));
    render();
  };

  const render = (): void => {
    card.replaceChildren();
    const closeBtn = el('button', { class: 'ngd-close', text: '✕', 'aria-label': 'Close' });
    closeBtn.addEventListener('click', close);
    const head = el('div', { class: 'ngd-head' });
    head.append(el('div', { class: 'ngd-head-title', text: '🚫 Chrome is blocking the extra tabs' }));
    const stage = el('div', { class: 'ngd-stage' });
    stage.innerHTML = STEPS[si].svg; // trusted static scenes authored above
    const caption = el('div', { class: 'ngd-caption', text: STEPS[si].caption });
    const dots = el('div', { class: 'ngd-dots' });
    STEPS.forEach((_, k) => dots.append(el('span', { class: `ngd-dot${k === si ? ' on' : ''}` })));
    const nav = el('div', { class: 'ngd-nav' });
    const prev = el('button', { class: 'ngd-btn', text: 'Back' }) as HTMLButtonElement;
    prev.style.visibility = si === 0 ? 'hidden' : 'visible';
    prev.addEventListener('click', () => go(-1));
    const next = el('button', {
      class: 'ngd-btn ngd-next',
      text: si === STEPS.length - 1 ? 'Got it' : 'Next',
    }) as HTMLButtonElement;
    next.addEventListener('click', () => {
      if (si < STEPS.length - 1) go(1);
      else close();
    });
    nav.append(prev, next);
    card.append(closeBtn, head, stage, caption, dots, nav);
  };

  overlay.append(card);
  // Deliberately NO backdrop-click close, same as the notification guides: stray
  // clicks while following the steps must never dismiss the guide mid-read.
  render();
  document.body.append(overlay);
}
