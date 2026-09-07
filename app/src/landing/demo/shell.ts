// Cobalt: the hero demo's miniature app shell.
//
// A faithful replica of the signed-in chrome (main.ts renderApp: header,
// hamburger, slide-out sidebar, tab panels) wrapped in a browser frame, with the
// REAL views mounted over Dan's sandbox (seed.ts). renderApp itself is all
// closure-local and tied to auth/scheduling/side effects, so the chrome is
// replicated here with the SAME classes and the SAME svgs — components.css does
// the rest, which is what keeps this pixel-identical to the app.
//
// Containment: the shell body is position:relative + overflow:hidden, and the
// header/sidebar (position sticky/fixed in the real app) are re-anchored
// absolute within it via the .lp-demoshell CSS scope. Views that take a sample
// host get the shell body, so their popups/toasts stay inside the "screen".
//
// Phase B drives this shell with the ghost cursor; the shell itself has no
// animation logic. It IS clickable by the script (and inert to visitors: the
// hero stage carries pointer-events:none against real mice, while synthetic
// events dispatched by the cursor land normally).

import type { Data } from '../../db';
import { el } from '../../util/dom';
import { createWordmark } from '../../ui/laurel';
import { mountTabs, type TabController } from '../../ui/tabs';
import { dropSelections } from '../../ui/selbar';
import { DashboardView } from '../../dashboard/view';
import { TasksView } from '../../tasks/render';
import { BookmarksView } from '../../bookmarks/view';
import { SettingsView } from '../../settings/view';
import { FocusView } from '../../focus/view';
import { createDanData, danDueTodayCount } from './seed';

// The signed-in header's exact glyphs (main.ts) — copied, not imported, because
// main.ts exports nothing; these must never drift from the real ones.
// Chrome's PiP title-bar glyphs, redrawn: the ⓘ page-info mark and the back-to-tab
// control (a window with the corner "return" arrow). Line icons in currentColor.
const PIP_INFO_SVG =
  '<svg viewBox="0 0 24 24" width="15" height="15" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
  '<circle cx="12" cy="12" r="9"/><path d="M12 11.2v5.2M12 7.8h.01"/></svg>';
// (Redrawn 9/3/26, Gabe: the first one "looks a little twisted". This is the
// picture-in-picture mark itself — a window, the small inset screen at its bottom
// right, and an arrow from it toward the top-left — three shapes that never cross.)
const PIP_BACK_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
  '<rect x="3" y="5" width="18" height="14" rx="2"/><rect x="12.5" y="11.5" width="6.5" height="4.5" rx="0.6" fill="currentColor" stroke="none"/><path d="M11 11L7 7"/><path d="M7 11V7h4"/></svg>';

// The ✕ is drawn too, not typed (visual auditor, 9/3/26): a 13px text "✕" has about
// 10×9px of ink beside an icon with 13×11, and the pair read as two sizes.
const PIP_X_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="1.9" stroke-linecap="round" aria-hidden="true">' +
  '<path d="M6 6l12 12M18 6L6 18"/></svg>';

const MENU_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
const BULB_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>';
const BELL_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
const GEAR_SVG =
  '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';

export interface DemoShell {
  /** The framed screen (append this to the hero stage). */
  root: HTMLElement;
  /** The shell's "viewport" — sample host for every view's popups/toasts, and
   *  the coordinate space the ghost cursor lives in. */
  body: HTMLElement;
  data: Data;
  tabs: TabController;
  /** Open/close the sidebar exactly like the real hamburger does. */
  setNav(open: boolean): void;
  navOpen(): boolean;
  /** The sidebar's nav buttons by tab id (the cursor clicks these). */
  navBtn(id: string): HTMLElement;
  /** The header's hamburger / bell / gear (cursor targets). */
  chrome: { menu: HTMLElement; bell: HTMLElement; gear: HTMLElement };
  destroy(): void;
}

export async function buildDemoShell(): Promise<DemoShell> {
  const data = await createDanData();

  // No browser bar (Gabe, 9/1/26): the traffic lights read Mac-only and the
  // cobaltstudy.com URL was fabricated — the frame is just the app now.
  const root = el('div', { class: 'lp-frame lp-demoshell' });

  const body = el('div', { class: 'lp-demoshell-body' });

  // --- Header (replica of main.ts renderApp's) ----------------------------
  const header = el('header', { class: 'app-header' });
  const headerLeft = el('div', { class: 'app-header-left' });
  const menuBtn = el('button', { class: 'icon-btn nav-toggle' });
  menuBtn.innerHTML = MENU_SVG;
  menuBtn.addEventListener('click', () => below.classList.toggle('nav-open')); // real toggleNav
  const brand = el('div', { class: 'app-brand' });
  brand.append(createWordmark().el);
  headerLeft.append(menuBtn, brand);

  const userBox = el('div', { class: 'app-user' });
  const suggestBtn = el('button', { class: 'icon-btn' });
  suggestBtn.innerHTML = BULB_SVG;
  const bellBtn = el('button', { class: 'icon-btn' });
  bellBtn.innerHTML = BELL_SVG;
  const gearBtn = el('button', { class: 'icon-btn' });
  gearBtn.innerHTML = GEAR_SVG;
  userBox.append(suggestBtn, bellBtn, gearBtn, el('span', { class: 'app-user-name', text: 'Dan' }));
  header.append(headerLeft, userBox);

  // --- Below: scrim + sidebar + tab panels (replica of renderApp's .app-below).
  // The drawer OVERLAYS rather than pushes now (main.ts, 9/1), so the shell
  // carries the same scrim: click the dimmed page to close, exactly like the app.
  const below = el('div', { class: 'app-below' });
  const scrim = el('div', { class: 'ws-scrim' });
  scrim.addEventListener('click', () => below.classList.remove('nav-open'));
  const sidebar = el('aside', { class: 'ws-sidebar' });
  const NAV_TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'focus', label: 'Focus' },
    { id: 'bookmarks', label: 'Bookmarks' },
  ];
  const navBtns = new Map<string, HTMLElement>();
  const tasksCount = el('span', { class: 'nav-count count-badge' });
  const n = danDueTodayCount();
  tasksCount.textContent = String(n);
  if (n > 0) tasksCount.classList.add('on');
  for (const it of NAV_TABS) {
    const b = el('button', { class: 'nav-item', text: it.label });
    if (it.id === 'tasks') b.append(tasksCount);
    b.addEventListener('click', () => controller.goToTab(it.id));
    navBtns.set(it.id, b);
    sidebar.append(b);
  }

  const tabsHost = el('div', { class: 'app' });

  // Views: the real ones, over Dan's data, popups hosted inside the shell body.
  const dashboardView = new DashboardView(
    data,
    'Dan',
    (id) => controller.goToTab(id),
    true // sample mode: fixed greeting ("Let's do this, Dan"), inert ↻/links
  );
  // Settings mirrors main.ts exactly: onShow re-mounts each visit, so unsaved
  // edits revert. Scene 5 (create the `cobalt` course) is its one demo consumer.
  const settingsView = new SettingsView(data, {
    displayName: 'Dan',
    email: 'dan@gmail.com',
    onNameChange: () => {},
    host: () => body, // the color card and friends mount INSIDE the frame
  });
  // The REAL FocusView in sample mode: overlay/widget/toasts mount into the
  // shell body, and page-global side effects (tab title, wake lock, persist,
  // PiP, audible music) are all skipped — see the sample gates in focus/view.ts.
  const focusView = new FocusView(data, { host: body });
  const controller: TabController = mountTabs(
    tabsHost,
    [
      { id: 'dashboard', label: 'Dashboard', render: (p) => dashboardView.mount(p) },
      { id: 'tasks', label: 'Tasks', render: (p) => new TasksView(data, { host: body }).mount(p) },
      { id: 'focus', label: 'Focus', render: (p) => void focusView.mount(p) },
      { id: 'bookmarks', label: 'Bookmarks', render: (p) => void new BookmarksView(data, { host: body }).mount(p) },
      { id: 'settings', label: 'Settings', onShow: (p) => void settingsView.mount(p) },
    ],
    (id) => {
      navBtns.forEach((b, k) => b.classList.toggle('active', k === id));
      // The real app drops any live selection when the tab changes (main.ts
      // does exactly this); without it a selection bar floats over Settings.
      dropSelections();
    }
  );
  gearBtn.addEventListener('click', () => controller.goToTab('settings'));

  // Scrim BEFORE the sidebar so the sidebar paints over it (main.ts order).
  below.append(scrim, sidebar, tabsHost);
  body.append(header, below);
  root.append(body);

  // THE MINI PLAYER'S WINDOW (Gabe, 9/3/26). In the real app the minimized session
  // lives in a Document-Picture-in-Picture window: Chrome draws a title bar over it
  // (an ⓘ, the site's origin, a back-to-tab button, a ✕) and the widget fills the
  // window under it. Sample mode never opens a real OS window (openPipWidget bails),
  // so the demo showed the bare in-tab float instead — not what a visitor gets. This
  // dresses the float as that window the instant FocusView appends it. A mutation
  // observer runs before the next paint, so the bare float never shows. The chrome
  // is a fabrication by necessity: it is the browser's, not Cobalt's, and there is no
  // other way to put it inside a frame. Styles: .lp-pip-* in landing.css.
  const dressPip = (w: HTMLElement): void => {
    if (w.closest('.lp-pip-window')) return;
    const win = el('div', { class: 'lp-pip-window' });
    const bar = el('div', { class: 'lp-pip-titlebar' });
    const info = el('span', { class: 'lp-pip-info' });
    info.innerHTML = PIP_INFO_SVG;
    const back = el('span', { class: 'lp-pip-back', title: 'Back to tab' });
    back.innerHTML = PIP_BACK_SVG;
    const x = el('span', { class: 'lp-pip-x', title: 'Close' });
    x.innerHTML = PIP_X_SVG;
    bar.append(info, el('span', { class: 'lp-pip-origin', text: 'cobaltstudy.com' }), el('span', { class: 'lp-pip-spacer' }), back, x);
    w.replaceWith(win);
    w.classList.add('focus-widget-pip'); // the app's own "I am inside the pip window" styling
    win.append(bar, w);
    // FocusView removes the widget itself on expand/dismiss; the window must not be
    // left standing empty behind it.
    new MutationObserver(() => {
      if (w.parentElement !== win) win.remove();
    }).observe(win, { childList: true });
  };
  const pipWatch = new MutationObserver((recs) => {
    for (const r of recs) for (const n of r.addedNodes) if (n instanceof HTMLElement && n.classList.contains('focus-widget')) dressPip(n);
  });
  pipWatch.observe(body, { childList: true });

  return {
    root,
    body,
    data,
    tabs: controller,
    setNav: (open) => below.classList.toggle('nav-open', open),
    navOpen: () => below.classList.contains('nav-open'),
    navBtn: (id) => navBtns.get(id)!,
    chrome: { menu: menuBtn, bell: bellBtn, gear: gearBtn },
    destroy: () => {
      pipWatch.disconnect();
      // FocusView owns timers + window listeners that outlive the DOM; teardown
      // silences them (persist is a no-op in sample mode, so nothing is saved).
      focusView.teardown();
      root.remove();
    },
  };
}
