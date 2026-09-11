// The Cobalt Plus upgrade screen: a full-screen overlay (backdrop + centered
// card) that presents the paid tier. It is only the SCREEN and three ways to
// open it (Settings sidebar button, ?plus=<feature> on load, window.__cobaltPlus);
// the periodic prompt and the greyed-out-control trigger come later.
//
// The tone follows the paywall teardown Gabe watched: it should feel like a
// safety net, not a sales pitch. The headline reframes "should I pay?" into
// "do I want this feature?", the timeline says out loud when the reminder and
// the first charge happen, and the primary button starts a trial rather than
// asking for a subscription.
//
// Mounted on <body>, not #root, so it works on the sign-in page and over any
// tab. One instance at a time. Closes on Escape, backdrop click, and "Not now",
// through the app's shared fadeRemove() so it leaves the way every dialog does.

import { el, escapeCloses, fadeRemove } from '../util/dom';
import { STONE_SVG, createWordmark } from '../ui/laurel';

// #region Placeholder content: swap these when the real tier is decided
/** The checklist. PLACEHOLDER names until the real Cobalt Plus feature set is
 *  final; the screen prints them verbatim, so this array is the one place to
 *  edit. Order is display order, except that a triggering feature (the one the
 *  user clicked on) is moved to the top and emphasised. */
export const PLUS_FEATURES: readonly string[] = [
  'Feature placeholder one',
  'Feature placeholder two',
  'Feature placeholder three',
  'Feature placeholder four',
  'Feature placeholder five',
  'Feature placeholder six',
];

/** PLACEHOLDER pricing. Not decided; "$X a month" is printed as-is. */
export const PLUS_PRICE_TEXT = '$X a month';
/** PLACEHOLDER trial length in days. Drives the "Day N" labels on the timeline. */
export const PLUS_TRIAL_DAYS = 7;
/** PLACEHOLDER: the day of the trial on which the reminder goes out. */
export const PLUS_REMINDER_DAY = 5;
// #endregion

// #region Icons (inline, stroke = currentColor)
const ICON_CHECK =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12.5l4.2 4.2L19 7"/></svg>';
const ICON_UNLOCK =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="4" y="11" width="16" height="10" rx="2"/><path d="M8 11V7a4 4 0 0 1 7.6-1.7"/></svg>';
const ICON_BELL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const ICON_CARD =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="M3 10h18"/><path d="M7 15h4"/></svg>';
const ICON_PLUS =
  '<svg viewBox="0 0 24 24" width="19" height="19" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 8v8"/><path d="M8 12h8"/></svg>';
// #endregion

// #region openPlusScreen()
export interface PlusScreenOpts {
  /** The feature the user was reaching for, if any. Goes into the headline and
   *  to the top of the checklist. */
  feature?: string;
  /** What the primary button does. Checkout is not built yet, so by default the
   *  button only closes the screen; the real flow plugs in here. */
  onStart?: () => void;
}

// The open instance, if any. One at a time: a second call while one is on
// screen (or still fading out) is ignored rather than stacked.
let current: HTMLElement | null = null;
// Its close path, so the outside world (sign-out in main.ts) can shut the
// screen through the same code the buttons use.
let currentClose: (() => void) | null = null;

/** Close the open screen, if any, the way Escape would. Safe to call when
 *  nothing is open. Used by sign-out: the screen lives on <body>, so a #root
 *  re-render alone would leave it (and the scroll lock) behind. */
export function closePlusScreen(): void {
  currentClose?.();
}

export function openPlusScreen(opts: PlusScreenOpts = {}): void {
  if (current?.isConnected) return;
  // `current` is dropped the moment a close starts, but the node stays on screen
  // for the fade; a call during those 250ms must not stack a second copy.
  if (document.querySelector('.plus-backdrop')) return;

  const feature = (opts.feature ?? '').trim();
  const returnFocus = document.activeElement as HTMLElement | null;

  // --- Overlay + card ---
  const back = el('div', { class: 'plus-backdrop' });
  const card = el('div', {
    class: 'plus-card',
    role: 'dialog',
    'aria-modal': 'true',
    'aria-labelledby': 'plus-headline',
  });

  // --- Hero: the real product. The gem from the wordmark at hero size with a
  // breathing glow, the wordmark itself with a "Plus" tag, and an empty slot a
  // later feature preview can fill (hidden while empty, see plus.css). ---
  const hero = el('div', { class: 'plus-hero' });
  const gemWrap = el('div', { class: 'plus-gem' });
  gemWrap.append(el('div', { class: 'plus-gem-glow', 'aria-hidden': 'true' }));
  const gem = el('div', { class: 'plus-gem-stone' });
  gem.innerHTML = STONE_SVG;
  gemWrap.append(gem);
  const mark = el('div', { class: 'plus-hero-mark' });
  mark.append(createWordmark().el, el('span', { class: 'plus-tag', text: 'Plus' }));
  const caption = el('div', { class: 'plus-hero-caption', text: 'Everything Cobalt does, without limits.' });
  const preview = el('div', { class: 'plus-hero-preview', 'data-plus-preview': '' });
  hero.append(gemWrap, mark, caption, preview);

  // --- Content column ---
  const body = el('div', { class: 'plus-body' });

  const headline = el('h1', { class: 'plus-headline', id: 'plus-headline' });
  if (feature) {
    headline.append('Unlock ', el('span', { class: 'plus-headline-feature', text: feature }), ' and more with Cobalt Plus');
  } else {
    headline.append('Unlock everything in ', el('span', { class: 'plus-headline-feature', text: 'Cobalt Plus' }));
  }

  // Checklist: the triggering feature first and emphasised, then the rest in
  // their listed order. A feature that is not in PLUS_FEATURES still leads,
  // since it is the one thing the user just asked for.
  const rows = feature
    ? [feature, ...PLUS_FEATURES.filter((f) => f.toLowerCase() !== feature.toLowerCase())]
    : [...PLUS_FEATURES];
  const listLabel = el('div', { class: 'plus-label', text: 'What Cobalt Plus includes' });
  const list = el('ul', { class: 'plus-list' });
  rows.forEach((name, i) => {
    const li = el('li', { class: 'plus-row' });
    li.style.setProperty('--i', String(i));
    if (feature && i === 0) li.classList.add('lead');
    const check = el('span', { class: 'plus-check', 'aria-hidden': 'true' });
    check.innerHTML = ICON_CHECK;
    li.append(check, el('span', { class: 'plus-row-text', text: name }));
    list.append(li);
  });

  // Timeline: what happens next, in order, with the charge date said plainly.
  const tlLabel = el('div', { class: 'plus-label', text: 'What happens next' });
  const tl = el('ol', { class: 'plus-tl' });
  const steps: { when: string; title: string; sub: string; icon: string }[] = [
    { when: 'Today', title: 'Everything unlocks.', sub: 'Every Cobalt Plus feature, straight away.', icon: ICON_UNLOCK },
    {
      when: `Day ${PLUS_REMINDER_DAY}`,
      title: 'We remind you.',
      sub: 'A heads-up before your trial ends, so nothing catches you off guard.',
      icon: ICON_BELL,
    },
    {
      when: `Day ${PLUS_TRIAL_DAYS}`,
      title: `First charge, ${PLUS_PRICE_TEXT}.`,
      sub: 'Cancel any time before this and you pay nothing.',
      icon: ICON_CARD,
    },
  ];
  steps.forEach((s, i) => {
    const li = el('li', { class: 'plus-tl-step' });
    li.style.setProperty('--i', String(i));
    const rail = el('div', { class: 'plus-tl-rail' });
    const icon = el('span', { class: 'plus-tl-icon' });
    icon.innerHTML = s.icon;
    rail.append(icon);
    if (i < steps.length - 1) rail.append(el('span', { class: 'plus-tl-line', 'aria-hidden': 'true' }));
    const text = el('div', { class: 'plus-tl-text' });
    text.append(
      el('div', { class: 'plus-tl-when', text: s.when }),
      el('div', { class: 'plus-tl-title', text: s.title }),
      el('div', { class: 'plus-tl-sub', text: s.sub })
    );
    li.append(rail, text);
    tl.append(li);
  });

  // Actions: "Start", "my" (not "Subscribe", "your"), one line of reassurance,
  // and a quiet way out.
  const actions = el('div', { class: 'plus-actions' });
  const start = el('button', { class: 'plus-start', type: 'button', text: 'Start my Cobalt Plus trial' });
  const reassure = el('div', { class: 'plus-reassure', text: 'Start in 2 clicks, cancel any time.' });
  const notNow = el('button', { class: 'plus-notnow', type: 'button', text: 'Not now' });
  actions.append(start, reassure, notNow);

  body.append(headline, listLabel, list, tlLabel, tl, actions);
  card.append(hero, body);
  back.append(card);

  // --- Scroll lock: the page behind must not scroll under the dialog. Both
  // <html> and <body> are locked (the landing page scrolls the document; the
  // signed-in shell scrolls .app-below, which the wheel guard below covers),
  // and the previous inline values are kept and put back on close. Note that
  // overflow:hidden never stops a programmatic scrollTo(); it stops the user. ---
  const docStyle = document.documentElement.style;
  const bodyStyle = document.body.style;
  const prevDocOverflow = docStyle.overflow;
  const prevBodyOverflow = bodyStyle.overflow;
  // Wheel and touch over the dim, or over a card that has nothing to scroll,
  // go nowhere. Only a card that is genuinely taller than the viewport (a short
  // or narrow window) keeps its own scroll, and overscroll-behavior: contain
  // (plus.css) stops that one from chaining into the page at either end.
  const guardScroll = (e: Event): void => {
    if (card.contains(e.target as Node) && card.scrollHeight > card.clientHeight) return;
    e.preventDefault();
  };

  // --- Close paths (Not now, backdrop click, Escape; Start without onStart;
  // closePlusScreen() from sign-out). All of them come through here, so the
  // lock is always released. ---
  const close = (): void => {
    if (!back.isConnected) return;
    fadeRemove(back);
    if (current === back) current = null;
    if (currentClose === close) currentClose = null;
    back.removeEventListener('wheel', guardScroll);
    back.removeEventListener('touchmove', guardScroll);
    docStyle.overflow = prevDocOverflow;
    bodyStyle.overflow = prevBodyOverflow;
    // Hand focus back to whatever opened us, but only if it is still there.
    if (returnFocus?.isConnected && typeof returnFocus.focus === 'function') returnFocus.focus();
  };
  notNow.addEventListener('click', close);
  start.addEventListener('click', () => {
    if (opts.onStart) opts.onStart();
    else close(); // checkout is not built; see PlusScreenOpts.onStart
  });
  back.addEventListener('click', (e) => {
    if (e.target === back) close(); // the dim, not anything on the card
  });
  escapeCloses(back, close);
  back.addEventListener('wheel', guardScroll, { passive: false });
  back.addEventListener('touchmove', guardScroll, { passive: false });

  document.body.append(back);
  current = back;
  currentClose = close;
  docStyle.overflow = 'hidden';
  bodyStyle.overflow = 'hidden';
  start.focus({ preventScroll: true });
}
// #endregion

// #region Settings sidebar entry
/** The "Cobalt Plus" button for Settings' Premium block (settings/view.ts). */
export function createPlusSidebarButton(): HTMLButtonElement {
  const b = el('button', { class: 'settings-side-btn settings-side-plus', type: 'button' });
  b.innerHTML = ICON_PLUS;
  b.append(el('span', { text: 'Cobalt Plus' }));
  b.addEventListener('click', () => openPlusScreen());
  return b;
}
// #endregion
