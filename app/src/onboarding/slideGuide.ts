// Cobalt: the animated slideshow engine and player behind onboarding's guides.
//
// Split out of the Schoology iCal-link guide (removed 10/9/26 with the iCal
// import); the Google Calendar guide (gcalGuide.ts) is its user today.
//
// The engine is the notify-guides mini-DSL ported from the onb-A prototype:
// each slide is one self-contained SVG whose <style> runs a 6s loop, so the
// cursor glides, the click ripples, and the result appears, forever, with zero
// JS per frame.

import { el } from '../util/dom';

// Cobalt gold: the instructional layer only (cursor ripple, highlights).
const GOLD = '#7db4ff';

// ---- the mini-DSL ------------------------------------------------------------
// Timing classes: .c cursor glide, .r click ripple, .af appears after the click,
// .bf visible before the click, .pu gentle pulse (highlights and arrows).
const SCENE_CSS = `
  .gdsvg .c{animation:kC 6s ease-in-out infinite}
  @keyframes kC{0%,18%{transform:translate(var(--x0),var(--y0))}42%,100%{transform:translate(var(--x1),var(--y1))}}
  .gdsvg .r{opacity:0;transform-box:fill-box;transform-origin:center;animation:kR 6s infinite}
  @keyframes kR{0%,46%{opacity:0;transform:scale(.3)}52%{opacity:.5;transform:scale(.7)}62%,100%{opacity:0;transform:scale(1.6)}}
  .gdsvg .af{opacity:0;animation:kA 6s infinite}
  @keyframes kA{0%,54%{opacity:0}60%,100%{opacity:1}}
  .gdsvg .bf{animation:kB 6s infinite}
  @keyframes kB{0%,54%{opacity:1}60%,100%{opacity:0}}
  .gdsvg .pu{animation:kU 1.8s ease-in-out infinite}
  @keyframes kU{0%,100%{opacity:.35}50%{opacity:1}}`;

// `page` is the backdrop behind each slide.
export const scene = (inner: string, page = '#f7f8f9'): string =>
  `<svg class="gdsvg" viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" role="img">` +
  `<style>${SCENE_CSS}</style><rect width="460" height="260" rx="12" fill="${page}"/>${inner}</svg>`;

export const T = (x: number, y: number, s: number, f: string, t: string, w = 500, a = 'start'): string =>
  `<text x="${x}" y="${y}" font-size="${s}" fill="${f}" font-weight="${w}" text-anchor="${a}" font-family="Inter,system-ui,sans-serif">${t}</text>`;

export const B = (x: number, y: number, w: number, h: number, f: string, rx = 8, ex = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${ex}/>`;

export const cursor = (x0: number, y0: number, x1: number, y1: number): string =>
  `<circle class="r" cx="${x1 + 2}" cy="${y1 + 2}" r="11" fill="${GOLD}"/>` +
  `<g class="c" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px">` +
  `<path d="M0 0 L0 15 L4.2 11.6 L7.2 18 L9.8 16.8 L6.9 10.6 L11.5 10.2 Z" fill="#fff" stroke="#333a41" stroke-width="1.2"/></g>`;

export const hl = (x: number, y: number, w: number, h: number): string =>
  `<rect class="pu" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${GOLD}" stroke-width="2"/>`;

export const arrow = (x1: number, y1: number, x2: number, y2: number): string => {
  const a = Math.atan2(y2 - y1, x2 - x1);
  const h1x = x2 - 9 * Math.cos(a - 0.44),
    h1y = y2 - 9 * Math.sin(a - 0.44);
  const h2x = x2 - 9 * Math.cos(a + 0.44),
    h2y = y2 - 9 * Math.sin(a + 0.44);
  return (
    `<g class="pu" stroke="${GOLD}" stroke-width="2.4" fill="none" stroke-linecap="round">` +
    `<line x1="${x1}" y1="${y1}" x2="${x2}" y2="${y2}"/><path d="M${h1x} ${h1y} L${x2} ${y2} L${h2x} ${h2y}"/></g>`
  );
};

// ---- the slides --------------------------------------------------------------
export interface Slide {
  cap: string;
  svg: string;
}

export interface SlideGuide {
  slides: Slide[];
  /** The dialog's accessible name. */
  label: string;
  title: string;
  sub: string;
}

/** The player. Its caption, dots and footer are the notification fix-it guides'
 *  own (settings/view.ts: .ngd-caption, .ngd-dots, bm-modal-footer with Back /
 *  Next, Gabe 10/10), so every slideshow in Cobalt is driven the same way. */
export function openSlideGuide(guide: SlideGuide, onClose?: () => void): void {
  if (document.querySelector('.onb-sso')) return; // one at a time
  const SLIDES = guide.slides;

  const wrap = el('div', {
    class: 'onb-sso guide-scrim',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': guide.label,
  });
  const card = el('div', { class: 'onb-sso-card guide-sheet' });
  const close = el('button', { class: 'dlg-close onb-sso-close', 'aria-label': 'Close', text: '✕' });
  const title = el('h3', { class: 'onb-sso-title', text: guide.title });
  const sub = el('div', { class: 'onb-sso-sub', text: guide.sub });
  const sceneHost = el('div', { class: 'onb-sso-scene' });
  const cap = el('div', { class: 'ngd-caption onb-sso-cap' });
  const dots = el('div', { class: 'ngd-dots' });
  const nav = el('div', { class: 'bm-modal-footer' });
  const prev = el('button', { class: 'bm-btn', text: 'Back' }) as HTMLButtonElement;
  const next = el('button', { class: 'bm-btn bm-btn-primary' }) as HTMLButtonElement;
  nav.append(prev, el('div', { class: 'bm-modal-spacer' }), next);
  card.append(close, title, sub, sceneHost, cap, dots, nav);
  wrap.append(card);

  let i = 0;
  const dismiss = (): void => {
    wrap.remove();
    onClose?.();
  };

  const draw = (): void => {
    // All strings below are authored in this file; no user input reaches them.
    sceneHost.innerHTML = SLIDES[i].svg;
    cap.innerHTML = `<b>${i + 1}.</b> ${SLIDES[i].cap}`;
    // Hidden, not removed, on the first slide, so Next never shifts (as in the
    // fix-it guides).
    prev.style.visibility = i === 0 ? 'hidden' : 'visible';
    next.textContent = i === SLIDES.length - 1 ? 'Got it' : 'Next';
    dots.replaceChildren(...SLIDES.map((_, d) => el('span', { class: `ngd-dot${d === i ? ' on' : ''}` })));
  };
  // Back had no click handler at all before 10/10, only the ← key worked.
  prev.addEventListener('click', () => {
    i = Math.max(0, i - 1);
    draw();
  });
  next.addEventListener('click', () => {
    if (i < SLIDES.length - 1) {
      i += 1;
      draw();
    } else dismiss();
  });

  close.addEventListener('click', dismiss);
  wrap.addEventListener('click', (e) => {
    if (e.target === wrap) dismiss(); // harmless here: the guide holds no typed state
  });
  const onKey = (e: KeyboardEvent) => {
    if (!wrap.isConnected) {
      document.removeEventListener('keydown', onKey);
      return;
    }
    if (e.key === 'Escape') dismiss();
    else if (e.key === 'ArrowRight') {
      i = Math.min(SLIDES.length - 1, i + 1);
      draw();
    } else if (e.key === 'ArrowLeft') {
      i = Math.max(0, i - 1);
      draw();
    }
  };
  document.addEventListener('keydown', onKey);

  document.body.append(wrap);
  draw();
  // Focus INTO the dialog (same lesson as the confirm popups): Enter must act
  // here, not re-click the button that opened the guide.
  next.focus();
}
