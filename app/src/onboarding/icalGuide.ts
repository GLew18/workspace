// Cobalt: the "where is my iCal link" slideshow.
//
// Four animated slides that walk a student through the REAL route to their
// calendar feed, exactly as it looks in Schoology (from Gabe's screenshots,
// 8/7/26):
//
//   1. Schoology home: hover your name in the top-right corner.
//   2. The dropdown opens: press Settings.
//   3. Account Settings: scroll down a little.
//   4. "Share Your Schoology Calendar": copy the iCal link, paste it back.
//
// FIDELITY RULES (Gabe's explicit calls):
//   - Slides copy Schoology's own light UI, its whites, grays, and blues, NOT
//     Cobalt's dark theme: this is the student's first impression and the
//     guide must look like the page they are about to see. Only the
//     instructional overlays (cursor, highlight, arrows) are Cobalt gold.
//   - Nothing school-specific: no Heschel name, logo, or account details. The
//     guide must read true for any school on Schoology.
//   - Nothing fabricated: every element in the scenes exists in the real
//     Schoology settings page. No invented captions, no fake copy animation
//     (students know how to copy a link; the guide only has to show WHERE it is).
//   - Slides 3 and 4 render the calendar section from ONE shared snippet, so
//     what the scroll reveals in slide 3 is pixel-identical to what slide 4
//     dwells on. Two different-looking versions of the same section would read
//     as two different places.
//
// The engine is the notify-guides mini-DSL ported from the onb-A prototype:
// each slide is one self-contained SVG whose <style> runs a 6s loop, so the
// cursor glides, the click ripples, and the result appears, forever, with zero
// JS per frame.

import { el } from '../util/dom';

// ---- palette: Schoology's, lifted from the screenshots -----------------------
const PAGE = '#f7f8f9'; // the page behind the cards
const CARD = '#ffffff';
const LINE = '#e0e3e6';
const TXT = '#3f4448';
const DIM = '#8b9298';
const LINK = '#1a70b8'; // Schoology's link blue
const PS = '#0079c1'; // the PowerSchool "P"
const HL_ROW = '#e9f2fc'; // the dropdown's hovered-row blue
const BTN = '#31699e'; // the "Save Changes" steel blue
const BADGE = '#e8536f'; // the unread-mail badge + the calendar icon's red band
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

const scene = (inner: string): string =>
  `<svg class="gdsvg" viewBox="0 0 460 260" xmlns="http://www.w3.org/2000/svg" role="img">` +
  `<style>${SCENE_CSS}</style><rect width="460" height="260" rx="12" fill="${PAGE}"/>${inner}</svg>`;

const T = (x: number, y: number, s: number, f: string, t: string, w = 500, a = 'start'): string =>
  `<text x="${x}" y="${y}" font-size="${s}" fill="${f}" font-weight="${w}" text-anchor="${a}" font-family="Inter,system-ui,sans-serif">${t}</text>`;

const B = (x: number, y: number, w: number, h: number, f: string, rx = 8, ex = ''): string =>
  `<rect x="${x}" y="${y}" width="${w}" height="${h}" rx="${rx}" fill="${f}" ${ex}/>`;

const cursor = (x0: number, y0: number, x1: number, y1: number): string =>
  `<circle class="r" cx="${x1 + 2}" cy="${y1 + 2}" r="11" fill="${GOLD}"/>` +
  `<g class="c" style="--x0:${x0}px;--y0:${y0}px;--x1:${x1}px;--y1:${y1}px">` +
  `<path d="M0 0 L0 15 L4.2 11.6 L7.2 18 L9.8 16.8 L6.9 10.6 L11.5 10.2 Z" fill="#fff" stroke="#333a41" stroke-width="1.2"/></g>`;

const hl = (x: number, y: number, w: number, h: number): string =>
  `<rect class="pu" x="${x}" y="${y}" width="${w}" height="${h}" rx="8" fill="none" stroke="${GOLD}" stroke-width="2"/>`;

const arrow = (x1: number, y1: number, x2: number, y2: number): string => {
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

// ---- shared Schoology chrome -------------------------------------------------
/** The white top bar: P | a generic school mark, nav, icons, the profile chip.
 *  `chipHot` outlines the chip the way Schoology does once the menu is open. */
function sgyTopBar(chipHot = false): string {
  return (
    B(0, 0, 460, 44, CARD, 12) +
    B(0, 40, 460, 12, CARD, 0) + // square off the bar's bottom corners
    B(0, 43, 460, 1, LINE, 0) +
    // PowerSchool "P |"
    T(18, 29, 17, PS, 'P', 800) +
    B(34, 14, 1.5, 18, '#c6cdd3', 0) +
    // a deliberately generic school mark: every school's logo sits here
    T(46, 29, 13, TXT, '🏫') +
    T(66, 23, 6.5, '#4a5d78', 'YOUR', 800) +
    T(66, 31, 6.5, '#4a5d78', 'SCHOOL', 800) +
    // nav
    T(128, 27, 10, TXT, 'Courses ⌄', 600) +
    T(190, 27, 10, TXT, 'Groups ⌄', 600) +
    T(248, 27, 10, TXT, 'Resources', 600) +
    // right icons: search, calendar, mail + badge, bell
    T(306, 28, 11, DIM, '🔍') +
    T(328, 28, 11, DIM, '📅') +
    T(350, 28, 11, DIM, '✉') +
    `<circle cx="360" cy="16" r="6" fill="${BADGE}"/>` +
    T(360, 18.5, 6, '#fff', '23', 700, 'middle') +
    T(370, 28, 11, DIM, '🔔') +
    // the profile chip
    B(386, 10, 66, 24, CARD, 6, `stroke="${chipHot ? '#9aa4ad' : LINE}"`) +
    `<circle cx="398" cy="22" r="6" fill="#3f7fbf"/>` +
    T(407, 26, 8.5, TXT, 'You ⌄', 650)
  );
}

/** Faint page content under the bar so the home page reads as Schoology. */
function sgyHomeBody(): string {
  return (
    T(96, 68, 8.5, DIM, 'RECENT ACTIVITY', 600) +
    T(196, 68, 8.5, TXT, 'COURSE DASHBOARD', 700) +
    B(186, 74, 118, 2, '#54585a', 0) +
    B(66, 78, 328, 1, LINE, 0) +
    B(96, 96, 180, 110, CARD, 8, `stroke="${LINE}"`) +
    B(116, 116, 140, 50, '#eceef0', 4) +
    B(116, 176, 96, 8, '#eceef0', 3) +
    B(300, 96, 96, 60, CARD, 8, `stroke="${LINE}"`) +
    T(310, 114, 8, TXT, 'Upcoming Events', 700) +
    B(310, 124, 76, 1, LINE, 0) +
    T(310, 140, 7.5, DIM, 'No upcoming events')
  );
}

/** The Account Settings page frame: the white card + its three tabs. Shared by
 *  slides 3 and 4 so both render the same page. */
function settingsCard(): string {
  return (
    B(40, 16, 380, 228, CARD, 10, `stroke="${LINE}"`) +
    B(52, 26, 84, 20, CARD, 5, `stroke="${LINE}"`) +
    T(94, 40, 8, TXT, 'Account Settings', 700, 'middle') +
    T(174, 40, 8, DIM, 'Notifications', 500, 'middle') +
    T(248, 40, 8, DIM, 'Recycle Bin', 500, 'middle') +
    B(52, 50, 356, 1, LINE, 0)
  );
}

/** "Share Your Schoology Calendar", the section the whole guide exists to find.
 *  ONE definition, rendered by slide 3 (revealed by the scroll) and slide 4
 *  (dwelled on), so the two are pixel-identical. Every element here exists on
 *  the real page: heading, calendar icon, blurb, link label, link, Disable. */
function shareCalSection(): string {
  return (
    T(60, 74, 10.5, TXT, 'Share Your Schoology Calendar', 700) +
    B(60, 82, 336, 1, LINE, 0) +
    // the little calendar icon with its red band
    B(60, 96, 26, 26, CARD, 4, `stroke="${LINE}"`) +
    B(60, 96, 26, 8, BADGE, 4) +
    B(60, 100, 26, 4, BADGE, 0) +
    T(73, 117, 9, TXT, '15', 700, 'middle') +
    T(96, 106, 8, DIM, 'Access your Schoology calendar from a different') +
    T(96, 118, 8, DIM, 'calendar tool (e.g. Outlook, Google Calendar)') +
    T(96, 140, 8.5, TXT, 'Use this iCal link:', 700) +
    B(96, 148, 290, 22, CARD, 4, `stroke="${LINE}"`) +
    T(104, 162, 7.6, LINK, 'webcal://yourschool.schoology.com/calendar/feed/ical/…') +
    B(96, 178, 54, 20, '#eceef0', 4, `stroke="${LINE}"`) +
    T(123, 192, 8, TXT, 'Disable', 600, 'middle')
  );
}

// ---- the slides --------------------------------------------------------------
interface Slide {
  cap: string;
  svg: string;
}

const SLIDES: Slide[] = [
  // 1 · hover your name
  {
    cap: 'Open <b>Schoology</b>. Your name lives in the <b>top right corner</b>. Hover over it.',
    svg: scene(sgyTopBar() + sgyHomeBody() + hl(380, 4, 76, 36) + cursor(200, 160, 412, 20)),
  },
  // 2 · press Settings
  {
    cap: 'A menu drops down. Press <b>Settings</b>.',
    svg: scene(
      sgyTopBar(true) +
        sgyHomeBody() +
        // the dropdown: profile, settings, logout
        B(330, 48, 122, 82, CARD, 8, `stroke="${LINE}"`) +
        T(342, 68, 9, TXT, 'Your Profile') +
        B(332, 78, 118, 24, HL_ROW, 4) +
        T(342, 94, 9, LINK, '<tspan text-decoration="underline">Settings</tspan>', 650) +
        T(342, 118, 9, TXT, 'Logout') +
        hl(328, 76, 126, 28) +
        cursor(412, 20, 380, 90)
    ),
  },
  // 3 · scroll down (Account Info fades out, the calendar section fades in,
  //     simulating the scroll; the section is the SAME snippet slide 4 shows)
  {
    cap: 'You land on <b>Account Settings</b>. Scroll down a little.',
    svg: scene(
      settingsCard() +
        `<g class="bf">${
          T(60, 74, 10.5, TXT, 'Account Info', 700) +
          B(60, 82, 336, 1, LINE, 0) +
          T(60, 102, 8, TXT, 'First Name:') + B(150, 95, 90, 9, '#eceef0', 3) +
          T(60, 122, 8, TXT, 'Last Name:') + B(150, 115, 110, 9, '#eceef0', 3) +
          T(60, 142, 8, TXT, 'Primary Email:') + B(150, 135, 140, 9, '#eceef0', 3) +
          B(150, 156, 150, 18, CARD, 3, `stroke="${LINE}"`) +
          B(60, 190, 86, 22, BTN, 4) +
          T(103, 205, 8.5, '#fff', 'Save Changes', 650, 'middle')
        }</g>` +
        `<g class="af">${shareCalSection()}</g>` +
        arrow(230, 216, 230, 240)
    ),
  },
  // 4 · the link (no copy animation on purpose: students know how to copy;
  //     the guide's only job is showing WHERE the link lives)
  {
    cap: 'There it is: <b>Share Your Schoology Calendar</b>. Copy the <b>iCal link</b> and paste it back in Cobalt.',
    svg: scene(settingsCard() + shareCalSection() + hl(90, 142, 302, 34)),
  },
];

// ---- the player --------------------------------------------------------------
/** Open the slideshow overlay. `onClose` fires on ANY dismissal (✕, Escape,
 *  backdrop, or the final "Got it" button), so the caller can refocus the link
 *  input the student is about to paste into. */
export function openIcalGuide(onClose?: () => void): void {
  if (document.querySelector('.onb-sso')) return; // one at a time

  const wrap = el('div', {
    class: 'onb-sso guide-scrim',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-label': 'Where to find your calendar link',
  });
  const card = el('div', { class: 'onb-sso-card guide-sheet' });
  const close = el('button', { class: 'dlg-close onb-sso-close', 'aria-label': 'Close', text: '✕' });
  const title = el('h3', { class: 'onb-sso-title', text: 'Where your iCal link lives' });
  const sub = el('div', { class: 'onb-sso-sub', text: 'Two clicks and a scroll. About 15 seconds.' });
  const sceneHost = el('div', { class: 'onb-sso-scene' });
  const cap = el('div', { class: 'onb-sso-cap' });
  const nav = el('div', { class: 'onb-sso-nav' });
  const prev = el('button', { class: 'onb-sso-arrow', 'aria-label': 'Previous step', text: '‹' }) as HTMLButtonElement;
  const dots = el('div', { class: 'onb-sso-dots' });
  const count = el('div', { class: 'onb-sso-count' });
  const nextSlot = el('span');
  nav.append(prev, dots, count, nextSlot);
  card.append(close, title, sub, sceneHost, cap, nav);
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
    count.textContent = `${i + 1} / ${SLIDES.length}`;
    prev.disabled = i === 0;
    dots.replaceChildren(
      ...SLIDES.map((_, d) => {
        const dot = el('button', { class: `onb-sso-dot${d === i ? ' on' : ''}`, 'aria-label': `Step ${d + 1}` });
        dot.addEventListener('click', () => {
          i = d;
          draw();
        });
        return dot;
      })
    );
    nextSlot.replaceChildren();
    if (i === SLIDES.length - 1) {
      const done = el('button', { class: 'onb-sso-done bm-btn-primary', text: 'Got it, back to pasting' });
      done.addEventListener('click', dismiss);
      nextSlot.append(done);
    } else {
      const next = el('button', { class: 'onb-sso-arrow', 'aria-label': 'Next step', text: '›' });
      next.addEventListener('click', () => {
        i = Math.min(SLIDES.length - 1, i + 1);
        draw();
      });
      nextSlot.append(next);
    }
  };

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
  (nextSlot.querySelector('button') as HTMLButtonElement | null)?.focus();
}
