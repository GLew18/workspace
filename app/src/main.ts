// WorkSpace — app entry point.

// #region Imports — styles + the modules this entry point wires together
import './ui/theme.css';
import './ui/components.css';
import './ui/focus.css';
import './ui/dashboard.css';
import './ui/settings.css';
import './ui/bookmarks.css';
import './ui/landing.css';
import './ui/auth.css';

import type { AuthUser } from './auth';
import { onAuth, signInLocal, signOut, isLocalMode } from './auth';
import { openAuthScreen } from './ui/authScreen';
import { Data } from './db';
import { mountTabs, type TabController } from './ui/tabs';
import { DashboardView } from './dashboard/view';
import { TasksView } from './tasks/render';
import { FocusView } from './focus/view';
import { createWordmark } from './ui/laurel';
import { el, textInput } from './util/dom';
import { initRegistry } from './courses/registry';
import { initLearn } from './courses/learn';
import { SettingsView } from './settings/view';
import { BookmarksView } from './bookmarks/view';
import { runOnboarding } from './onboarding/view';
import { renderLanding } from './landing/view';
import { runSync } from './schoology/sync';
import { startNotificationScheduler } from './notify/scheduler';
import { setEmailSink } from './notify/notify';
import { queueEmail } from './notify/email';
import { enablePush } from './notify/push';
import { capitalizeName } from './util/names';
import { getPrefs, setPrefsCache, normalizePrefs, DEFAULT_PREFS, PREFS_EVENT } from './prefs';
import type { SchoologySettings } from './types';
// #endregion

// #region Top-level state — the root element + background-sync timer handle
const root = document.getElementById('root')!;

let autoSyncTimer: number | null = null;
let prefsListener: (() => void) | null = null; // re-arms the sync timer when Settings changes prefs
let stopNotifications: (() => void) | null = null; // assignment-reminder scheduler teardown

// The signed-in session's FocusView — held here so sign-out can tear down any
// running session (music, overlay, minimized widget), which live on <body> and
// would otherwise survive the sign-out and float over the landing page.
let activeFocusView: FocusView | null = null;

/** Glide away any body-mounted toasts (undo toast, focus-end toast): drop their
 *  .show so the CSS slides them down, then remove once the transition is done. */
function dismissBodyToasts(): void {
  document.querySelectorAll<HTMLElement>('.toast, .focus-end-toast').forEach((t) => {
    t.classList.remove('show');
    window.setTimeout(() => t.remove(), 450);
  });
}
// #endregion

// #region renderSignIn() — the signed-out welcome / sign-in screen
function renderSignIn(): void {
  root.replaceChildren();
  // Landing/sign-in scroll the WINDOW normally (full-bleed page, no header bar).
  document.body.classList.remove('app-mode');

  // Local/dev mode keeps the simple name-entry card (used for multi-user testing).
  if (isLocalMode()) {
    const wrap = el('div', { class: 'signin' });
    wrap.append(
      el('img', { src: '/icons/icon.svg', alt: 'WorkSpace' }),
      el('h1', { text: 'WorkSpace' }),
      el('p', { text: 'A space that makes work more convenient and fun.' })
    );
    const input = textInput({ placeholder: 'Your name', autocomplete: 'off' });
    const btn = el('button', { class: 'btn-primary', text: 'Enter WorkSpace' });
    const go = () => signInLocal(input.value);
    btn.addEventListener('click', go);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    wrap.append(
      input,
      btn,
      el('div', {
        class: 'hint',
        text: 'Local mode — no Firebase configured yet, so data stays on this device. Sign in with different names to test multi-user isolation.',
      })
    );
    root.append(wrap);
    return;
  }

  // Production (Firebase) mode: the full landing page. "Try now" opens the
  // sign-in screen (email/password or Google); renderApp() then picks up
  // onboarding for first-time users once auth state changes.
  root.append(
    renderLanding({
      onTryNow: () => openAuthScreen(),
    })
  );
}
// #endregion

// #region renderApp() — the signed-in UI: boot data, header, sidebar, tabs, sync
async function renderApp(user: AuthUser): Promise<void> {
  root.replaceChildren();
  root.classList.remove('nav-open');
  // Signed-in shell: the window doesn't scroll — .app-below does (components.css).
  // That caps the scrollbar BENEATH the header instead of slicing through it.
  document.body.classList.add('app-mode');
  // Visible boot state — without it, the gap between the Google popup closing and
  // the first paint is a blank screen that reads as a hang.
  const boot = el('div', { class: 'app-booting' });
  boot.append(el('div', { class: 'app-booting-spinner' }));
  root.append(boot);

  const data = await Data.create(user.uid);
  // These boot reads are independent of each other — run them CONCURRENTLY so
  // sign-in waits one database round-trip, not four sequential ones.
  const [, , , account, rawPrefs] = await Promise.all([
    data.purgeStaleCompleted(), // clear yesterday's completed before anything renders
    initRegistry(data), // load course config (seed defaults on first run)
    initLearn(data), // load the learned course model (Layer 1b)
    // First-run onboarding check: confirm name → connect Schoology, then re-render.
    data.getProfile<{ displayName: string; onboarded: boolean }>('account'),
    data.getProfile('prefs'), // app preferences (Settings) into the sync cache
  ]);
  setPrefsCache(normalizePrefs(rawPrefs));
  root.replaceChildren(); // boot done — drop the spinner
  // Treat the user as onboarded if EITHER the cloud says so OR this browser onboarded
  // them before — so a transient empty account read can't bounce a returning user back
  // through onboarding (which would overwrite their saved profile).
  if (!account?.onboarded && !data.wasOnboardedLocally()) {
    runOnboarding({
      data,
      email: user.email,
      fallbackName: user.displayName,
      onDone: () => void renderApp(user),
    });
    return;
  }
  data.markOnboardedLocally(); // remember across reloads, even for accounts onboarded before this guard existed
  void data.backupAll(); // snapshot the whole account (local + cloud) now that we know it loaded healthy
  const displayName = capitalizeName(account?.displayName || user.displayName);

  // --- Independent full-width header bar (own color; never compressed) ---
  const header = el('div', { class: 'app-header' });

  // The area below the header (sidebar + content). Declared up here so the
  // header's menu button can toggle the sidebar.
  const below = el('div', { class: 'app-below' });
  const toggleNav = () => below.classList.toggle('nav-open');

  // Header left: a menu (hamburger) button that reveals the sidebar, then the
  // wordmark. Clicking the wordmark jumps to the Dashboard.
  const headerLeft = el('div', { class: 'app-header-left' });
  const menuBtn = el('button', { class: 'icon-btn nav-toggle', 'aria-label': 'Menu', title: 'Menu' });
  menuBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
  menuBtn.addEventListener('click', toggleNav);

  const brand = el('div', { class: 'app-brand' });
  const laurel = createWordmark();
  brand.append(laurel.el);
  brand.addEventListener('click', () => controller.goToTab('dashboard')); // logo → Dashboard
  headerLeft.append(menuBtn, brand);

  const userBox = el('div', { class: 'app-user' });
  const nameSpan = el('span', { text: displayName });
  const settingsView = new SettingsView(data, {
    displayName,
    email: user.email,
    onNameChange: (n) => {
      nameSpan.textContent = n;
      dashboardView.setName(n); // keep the greeting in sync
    },
  });
  // Settings sits back in the top-right (gear next to the name), not the sidebar.
  const settingsBtn = el('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings' });
  settingsBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
  settingsBtn.addEventListener('click', () => controller.goToTab('settings'));
  const out = el('button', { text: 'Sign out' });
  out.addEventListener('click', () => void signOut());
  userBox.append(nameSpan, settingsBtn, out);
  header.append(headerLeft, userBox);

  // --- Sidebar: the slide-out nav drawer (Dashboard / Tasks / Focus / Bookmarks) ---
  const sidebar = el('aside', { class: 'ws-sidebar' });
  const NAV_TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'bookmarks', label: 'Bookmarks' },
    { id: 'focus', label: 'Focus' },
  ];
  const navBtns = new Map<string, HTMLElement>();
  for (const it of NAV_TABS) {
    const b = el('button', { class: 'nav-item', text: it.label });
    b.addEventListener('click', () => controller.goToTab(it.id)); // sidebar stays open
    navBtns.set(it.id, b);
    sidebar.append(b);
  }
  // Settings is in the header now, but still register its button so it picks up
  // the "active" highlight when the settings tab is showing.
  navBtns.set('settings', settingsBtn);

  const tabsHost = el('div', { class: 'app' }); // centered content column
  below.append(sidebar, tabsHost);
  root.append(header, below);

  // --- Tabs + their views: each tab's content is built by its own module ---
  let controller: TabController;
  const dashboardView = new DashboardView(data, displayName, (id) => controller.goToTab(id));
  const tasksView = new TasksView(data);
  const focusView = new FocusView(data);
  activeFocusView = focusView; // sign-out tears this down (music, widget, overlay)
  controller = mountTabs(
    tabsHost,
    [
      { id: 'dashboard', label: 'Dashboard', render: (p) => dashboardView.mount(p) },
      { id: 'tasks', label: 'Tasks', render: (p) => tasksView.mount(p) },
      { id: 'focus', label: 'Focus', render: (p) => void focusView.mount(p) },
      { id: 'bookmarks', label: 'Bookmarks', render: (p) => void new BookmarksView(data).mount(p) },
      // Re-mount every visit so unsaved edits revert to the last-saved version.
      { id: 'settings', label: 'Settings', onShow: (p) => void settingsView.mount(p) },
    ],
    (id) => navBtns.forEach((b, k) => b.classList.toggle('active', k === id))
  );

  // Restore an in-progress focus session (e.g. after a mid-session reload),
  // regardless of which tab is showing.
  void focusView.bootRestore();

  // Background sync — driven by Settings ▸ Tasks ▸ Syncing: an on-open sync
  // (optional) plus a background re-sync at the chosen interval while the app
  // stays open. Failures are silent (the next tick / Settings retries). A true
  // server cron for when the app is CLOSED comes with Firebase later.
  const syncIfLinked = async () => {
    const sgy = await data.getProfile<SchoologySettings>('schoology');
    if (sgy?.icalUrl) {
      try {
        await runSync(data);
      } catch {
        /* offline / expired link — user can retry from Settings */
      }
    }
  };
  const armSyncTimer = () => {
    const p = getPrefs().sync;
    if (autoSyncTimer !== null) clearInterval(autoSyncTimer);
    autoSyncTimer = p.auto ? window.setInterval(() => void syncIfLinked(), p.intervalMins * 60_000) : null;
  };
  armSyncTimer();
  if (getPrefs().sync.onOpen) void syncIfLinked();
  // Settings changes re-arm the timer live (interval change, auto-sync on/off).
  if (prefsListener) window.removeEventListener(PREFS_EVENT, prefsListener);
  prefsListener = armSyncTimer;
  window.addEventListener(PREFS_EVENT, prefsListener);

  // Assignment reminders (see src/notify): due-soon + daily-digest notifications
  // while the app is open. Stopped on sign-out, restarted per sign-in. Clicking a
  // notification focuses the window and jumps straight to the Tasks tab.
  stopNotifications?.();
  stopNotifications = startNotificationScheduler(data, {
    onClick: () => controller.goToTab('tasks'),
    email: user.email, // the Gmail channel's ONLY destination — the account email
  });
  // "Also email me" delivery: mirror every notification to an email via the
  // Firestore Trigger Email extension. The scheduler keeps the on/off + address in
  // sync (setEmailPrefs); here we just install the sender. No-op in local mode.
  setEmailSink((to, subject, body) => void queueEmail(to, subject, body));
  // Push notifications (closed-app reminders, via FCM): register this device's
  // token so the Cloud Function can reach it. No-op until a VAPID key is set and
  // the app runs a production build (dev has no service worker).
  void enablePush(data);

  // Open the tab the user chose in Settings ▸ Preferences ("Open WorkSpace to").
  if (getPrefs().openTo !== 'dashboard') controller.goToTab(getPrefs().openTo);

  // Deep link from a service-worker notification click ("/#tasks"): land on Tasks.
  if (location.hash === '#tasks') {
    controller.goToTab('tasks');
    history.replaceState(null, '', location.pathname + location.search);
  }
}
// #endregion

// #region Auth wiring — render the app on sign-in, the sign-in screen on sign-out
let currentUid: string | null = null;
onAuth((user) => {
  if (user) {
    if (user.uid !== currentUid) {
      currentUid = user.uid;
      void renderApp(user);
    }
  } else {
    currentUid = null;
    if (autoSyncTimer !== null) {
      clearInterval(autoSyncTimer);
      autoSyncTimer = null;
    }
    stopNotifications?.();
    stopNotifications = null;
    // Sign-out hygiene: SUSPEND any focus session (stops music, removes the overlay
    // and the minimized widget — but keeps the persisted state frozen-paused, so it
    // auto-restores on the next sign-in) and glide away any lingering toasts — all
    // of these live on <body>, so re-rendering #root alone wouldn't clear them.
    activeFocusView?.teardown();
    activeFocusView = null;
    dismissBodyToasts();
    // Drop this account's prefs: listener off, cache back to defaults so the next
    // sign-in on this device can't inherit someone else's preferences.
    if (prefsListener) {
      window.removeEventListener(PREFS_EVENT, prefsListener);
      prefsListener = null;
    }
    setPrefsCache(DEFAULT_PREFS);
    renderSignIn();
  }
});
// #endregion

// #region Service worker — production only; dev tears down any stale worker + caches
// Service worker: register ONLY in production. In dev it caused stale, cached
// code to keep running (edits "not showing up"), so dev actively tears down any
// previously-installed worker + caches instead.
if ('serviceWorker' in navigator) {
  if (import.meta.env.PROD) {
    window.addEventListener('load', () => {
      navigator.serviceWorker.register('/sw.js').catch(() => {});
    });
  } else {
    navigator.serviceWorker.getRegistrations().then((regs) => regs.forEach((r) => r.unregister()));
    if ('caches' in window) {
      caches.keys().then((keys) => keys.forEach((k) => caches.delete(k)));
    }
  }
}
// #endregion
