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
import { DashboardView } from '../../dashboard/view';
import { TasksView } from '../../tasks/render';
import { BookmarksView } from '../../bookmarks/view';
import { SettingsView } from '../../settings/view';
import { FocusView } from '../../focus/view';
import { createDanData, danDueTodayCount } from './seed';

// The signed-in header's exact glyphs (main.ts) — copied, not imported, because
// main.ts exports nothing; these must never drift from the real ones.
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
  /** Update the frame's URL bar, mirroring deviceFrame's live URL. */
  setUrl(path: string): void;
  destroy(): void;
}

const TAB_URL: Record<string, string> = {
  dashboard: 'dashboard',
  tasks: 'tasks',
  focus: 'focus',
  bookmarks: 'links',
  settings: 'settings',
};

export async function buildDemoShell(): Promise<DemoShell> {
  const data = await createDanData();

  const root = el('div', { class: 'lp-frame lp-demoshell' });
  const bar = el('div', { class: 'lp-frame-bar' });
  const urlEl = el('div', { class: 'lp-frame-url', text: 'cobalt.app/dashboard' });
  bar.append(
    el('span', { class: 'lp-dot r' }),
    el('span', { class: 'lp-dot y' }),
    el('span', { class: 'lp-dot g' }),
    urlEl
  );

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

  // --- Below: sidebar + tab panels (replica of renderApp's .app-below) ----
  const below = el('div', { class: 'app-below' });
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
    email: 'dan@heschel.org',
    onNameChange: () => {},
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
      if (TAB_URL[id]) urlEl.textContent = `cobalt.app/${TAB_URL[id]}`;
    }
  );
  gearBtn.addEventListener('click', () => controller.goToTab('settings'));

  below.append(sidebar, tabsHost);
  body.append(header, below);
  root.append(bar, body);

  return {
    root,
    body,
    data,
    tabs: controller,
    setNav: (open) => below.classList.toggle('nav-open', open),
    navOpen: () => below.classList.contains('nav-open'),
    navBtn: (id) => navBtns.get(id)!,
    chrome: { menu: menuBtn, bell: bellBtn, gear: gearBtn },
    setUrl: (path) => (urlEl.textContent = `cobalt.app/${path}`),
    destroy: () => {
      // FocusView owns timers + window listeners that outlive the DOM; teardown
      // silences them (persist is a no-op in sample mode, so nothing is saved).
      focusView.teardown();
      root.remove();
    },
  };
}
