// Cobalt: app entry point.

// #region Imports — styles + the modules this entry point wires together
import './ui/theme.css';
import './ui/components.css';
import './ui/focus.css';
import './ui/dashboard.css';
import './ui/settings.css';
import './ui/notifylog.css';
import './ui/bookmarks.css';
import './ui/landing.css';
import './ui/auth.css';
import './ui/onboarding.css';

// OFF unless explicitly turned on. Names whatever is making the stray sound on
// reload (see util/soundTrace.ts). Two switches, because the localStorage one alone
// was not reachable (Gabe, 8/15): ?tracesound=1 in the URL works even on a build
// where the console is awkward, and it also sets the flag so it survives reloads —
// which matters, since the sound happens DURING a reload.
//
// Not DEV-gated any more. It is a few hundred bytes, it does nothing unless asked,
// and gating it to dev is what made it unavailable on the build actually being used.
{
  const traceParam = new URLSearchParams(location.search).get('tracesound');
  if (traceParam === '1') localStorage.setItem('cobalt:tracesound', '1');
  if (traceParam === '0') localStorage.removeItem('cobalt:tracesound');
  if (localStorage.getItem('cobalt:tracesound') === '1') {
    void import('./util/soundTrace').then((m) => m.installSoundTrace());
  }
}

import type { AuthUser } from './auth';
import {
  onAuth,
  signInLocal,
  isLocalMode,
  needsEmailVerification,
  resendEmailVerification,
  refreshVerificationState,
  verificationEmailFailed,
  hasPasswordProvider,
  sendSetPasswordEmail,
} from './auth';
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
import { detectExtension } from './bookmarks/shortcuts';
import { runOnboarding } from './onboarding/view';
import { setStorageUser, scopedKey } from './util/userScope';
import { renderLanding } from './landing/view';
import { runSync } from './schoology/sync';
import { detectSchoologyExtension, requestSgyData, applySgyPayload } from './schoology/extension';
import { startNotificationScheduler } from './notify/scheduler';
import { setEmailSink } from './notify/notify';
import { NotificationLogView } from './notify/logView';
import { unreadNotifyCount, NOTIFY_LOG_EVENT } from './notify/log';
import { queueEmail } from './notify/email';
import { enablePush } from './notify/push';
import { capitalizeName } from './util/names';
import { getPrefs, setPrefsCache, normalizePrefs, DEFAULT_PREFS, PREFS_EVENT } from './prefs';
import { openSuggestionBox } from './suggest';
import type { SchoologySettings, TaskMap } from './types';
import { todayStr } from './util/dates';
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

// Is the signed-in account's email VERIFIED? Held here (not read per-send) so the
// scheduler can consult it live: verification usually lands mid-session, when the
// student clicks the link in another tab and comes back. Reset on every sign-in,
// flipped true the moment a check confirms it. Gates the Gmail channel — see
// SchedulerOpts.emailVerified.
let accountEmailVerified = false;

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
      el('img', { src: '/icons/icon.svg', alt: 'Cobalt' }),
      el('h1', { text: 'Cobalt' }),
      el('p', { text: 'A space that makes work more convenient and fun.' })
    );
    const input = textInput({ placeholder: 'Your name', autocomplete: 'off' });
    const btn = el('button', { class: 'btn-primary', text: 'Enter Cobalt' });
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
        text: 'Local mode: no Firebase configured yet, so data stays on this device. Sign in with different names to test multi-user isolation.',
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
      // Same screen, different starting mode: "Get started" assumes a new student,
      // "Log in" assumes a returning one. Whether onboarding actually runs is still
      // decided by the account's own `onboarded` flag below, never by this choice.
      onTryNow: () => openAuthScreen('signup'),
      onLogIn: () => openAuthScreen('login'),
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

  // Bind ALL per-account browser storage to this account before anything reads it
  // — focus session, notification log + unread marker, reminder ledger. Must run
  // before bootRestore()/FocusView or a restore could still surface the previously
  // signed-in account's session. The legacy list is the pre-scoping global keys,
  // deleted rather than migrated (see util/userScope.ts).
  setStorageUser(user.uid, [
    'focus:state:v1',
    'notify:log:v1',
    'notify:log:seen:v1',
    'notify:sent:v1',
    'ws:verifyNudgeDismissed',
  ]);

  // Start CLOSED for the new account, then ask. Between these two lines the gmail
  // channel is off, which is the safe direction: a moment of no email beats one
  // email to an unproven address.
  accountEmailVerified = false;
  void refreshVerificationState().then((v) => {
    accountEmailVerified = v;
  });

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
  // wordmark. Clicking the wordmark is "take me home", and home is whatever the
  // student chose in Settings ▸ Preferences ▸ "Open Cobalt to" (Gabe, 8/12): the
  // tab the app boots into is the same tab the logo returns to.
  const headerLeft = el('div', { class: 'app-header-left' });
  const menuBtn = el('button', { class: 'icon-btn nav-toggle', 'aria-label': 'Menu', title: 'Menu' });
  menuBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round"><line x1="4" y1="7" x2="20" y2="7"/><line x1="4" y1="12" x2="20" y2="12"/><line x1="4" y1="17" x2="20" y2="17"/></svg>';
  menuBtn.addEventListener('click', toggleNav);

  const brand = el('div', { class: 'app-brand' });
  const laurel = createWordmark();
  brand.append(laurel.el);
  // Read at CLICK time, not now: changing the setting takes effect immediately,
  // with no reload.
  brand.addEventListener('click', () => controller.goToTab(getPrefs().openTo));
  headerLeft.append(menuBtn, brand);

  const userBox = el('div', { class: 'app-user' });
  const nameSpan = el('span', { class: 'app-user-name', text: displayName });
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

  // 🔔 Notifications — opens the log screen (a tab, like Settings). The dot on the
  // bell counts reminders that arrived since the screen was last opened, so a
  // notification missed while the tab was in the background still gets noticed.
  const bellBtn = el('button', { class: 'icon-btn', 'aria-label': 'Notifications', title: 'Notifications' });
  bellBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
  const bellDot = el('span', { class: 'count-badge bell-dot' });
  bellBtn.append(bellDot);
  const paintBell = (): void => {
    const n = unreadNotifyCount();
    bellDot.textContent = n > 9 ? '9+' : String(n);
    bellDot.classList.toggle('on', n > 0);
  };
  paintBell();
  window.addEventListener(NOTIFY_LOG_EVENT, paintBell);
  bellBtn.addEventListener('click', () => controller.goToTab('notifications'));

  // 💡 Suggestions — one box, straight to Gabe, anonymous (see src/suggest.ts).
  // It passes the CURRENT TAB along, so "the timer thing is confusing" arrives
  // already knowing it came from Focus and the student doesn't have to explain
  // where they were.
  const suggestBtn = el('button', { class: 'icon-btn', 'aria-label': 'Suggest something', title: 'Suggest something' });
  suggestBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M9 18h6"/><path d="M10 22h4"/><path d="M12 2a7 7 0 0 0-4 12.7c.6.5 1 1.3 1 2.1v.2h6v-.2c0-.8.4-1.6 1-2.1A7 7 0 0 0 12 2z"/></svg>';
  suggestBtn.addEventListener('click', () => openSuggestionBox(controller.current()));

  // No sign-out pill up here on purpose (per Gabe): the only way to sign out is
  // Settings → Sign out, behind its confirm dialog. One easy top-bar button made
  // it too casual to leave; this adds the friction back.
  // Icons first, name last (per Gabe): the two controls sit together as a pair on
  // the left, with the name reading as the label at the end of the cluster.
  // 💡 sits FIRST: it is the only one of the three that is not a destination, so
  // putting it left of the bell keeps the two navigating icons adjacent.
  userBox.append(suggestBtn, bellBtn, settingsBtn, nameSpan);
  header.append(headerLeft, userBox);

  // --- Sidebar: the slide-out nav drawer (Dashboard / Tasks / Focus / Bookmarks) ---
  // ORDER IS PRIORITY (Gabe, 8/12): higher up, or further left, means the more
  // important tab. Focus sits above Bookmarks everywhere it appears, so keep this
  // list, the landing showcase and the "Open Cobalt to" segment in step.
  const sidebar = el('aside', { class: 'ws-sidebar' });
  const NAV_TABS = [
    { id: 'dashboard', label: 'Dashboard' },
    { id: 'tasks', label: 'Tasks' },
    { id: 'focus', label: 'Focus' },
    { id: 'bookmarks', label: 'Bookmarks' },
  ];
  const navBtns = new Map<string, HTMLElement>();
  // "Tasks" carries a red count of what's due TODAY (Gabe, 8/10) — the one number
  // worth seeing from any tab. Red, not the bell's gold, because this is a
  // deadline rather than a message. Hidden at zero: an empty badge is noise.
  const tasksCount = el('span', { class: 'count-badge nav-count' });
  for (const it of NAV_TABS) {
    const b = el('button', { class: 'nav-item', text: it.label });
    if (it.id === 'tasks') b.append(tasksCount);
    b.addEventListener('click', () => controller.goToTab(it.id)); // sidebar stays open
    navBtns.set(it.id, b);
    sidebar.append(b);
  }
  const paintTasksCount = (tasks: TaskMap): void => {
    const today = todayStr();
    const n = Object.values(tasks).filter((t) => !t.completed && t.dueDate === today).length;
    tasksCount.textContent = n > 99 ? '99+' : String(n);
    tasksCount.classList.toggle('on', n > 0);
  };
  paintTasksCount(data.getTasks());
  data.watchTasks((u) => paintTasksCount(u.tasks));
  // Settings and the bell live in the header, not the drawer, but both still
  // register so they pick up the "active" highlight when their tab is showing.
  navBtns.set('settings', settingsBtn);
  navBtns.set('notifications', bellBtn);

  const tabsHost = el('div', { class: 'app' }); // centered content column
  below.append(sidebar, tabsHost);
  root.append(header, below);

  // Verify-your-email nudge. Mounted in .app-below, NOT inside .app: the .app
  // column is capped at 1180px on every tab except Settings (which removes the
  // cap), so a banner inside it would change width tab to tab. Out here it always
  // spans the full content area, matching Settings. It shows on every tab, is
  // dismissible, and never blocks anything: this is a study app a friend
  // recommended at lunch, not a bank. See signUpWithEmail for the stake, an
  // unverified password is silently dropped the first time the same student uses
  // "Continue with Google", and verifying is what prevents that.
  void mountVerifyNudge(below, tabsHost);
  // The other half of the same story: the merge has ALREADY happened to this
  // account and took the password with it. Tells them once, instead of leaving
  // them to discover it the next time they try to type a password that no longer
  // exists.
  void mountPasswordDroppedNotice(data, user, below, tabsHost);

  // --- Tabs + their views: each tab's content is built by its own module ---
  let controller: TabController;
  const notifyLogView = new NotificationLogView();
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
      // Same deal: re-mount so the log is current every time the bell is pressed.
      { id: 'notifications', label: 'Notifications', onShow: (p) => notifyLogView.mount(p) },
    ],
    (id) => navBtns.forEach((b, k) => b.classList.toggle('active', k === id))
  );

  // Restore an in-progress focus session (e.g. after a mid-session reload),
  // regardless of which tab is showing.
  void focusView.bootRestore();

  // Warm the extension-detect cache once at boot. "Open all" has to decide
  // synchronously whether tab-grouping is available (awaiting a detect inside the
  // click would spend the user gesture and get the fallback popup-blocked), so it
  // reads this cached answer — which needs to already exist by the first click.
  void detectExtension();

  // Background sync — driven by Settings ▸ Tasks ▸ Syncing: an on-open sync
  // (optional) plus a background re-sync at the chosen interval while the app
  // stays open. Failures are silent (the next tick / Settings retries). A true
  // server cron for when the app is CLOSED comes with Firebase later.
  // Pull the companion extension's Schoology scrape (real course names, and the
  // feed URL itself) into the cloud BEFORE syncing, so a fresh import lands with
  // true courses instead of a guess that has to be corrected afterwards. Silent
  // and optional: no extension, no Chrome, or no Schoology tab → resolves false
  // and the import proceeds exactly as before.
  const pullSchoologyLabels = async (): Promise<void> => {
    try {
      if (!(await detectSchoologyExtension())) return;
      const payload = await requestSgyData();
      if (payload) await applySgyPayload(data, payload);
    } catch {
      /* never let a scrape problem block the normal import */
    }
  };

  const syncIfLinked = async () => {
    // Awaited before the settings read, because applySgyPayload may be what WRITES
    // the feed URL — the extension can discover it, so this is what lets a user be
    // "linked" without ever pasting a URL.
    await pullSchoologyLabels();
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
    // Live, not a snapshot: flips true mid-session when verification lands.
    emailVerified: () => accountEmailVerified,
  });
  // "Also email me" delivery: mirror every notification to an email via the
  // Firestore Trigger Email extension. The scheduler keeps the on/off + address in
  // sync (setEmailPrefs); here we just install the sender. No-op in local mode.
  setEmailSink((to, subject, body) => void queueEmail(to, subject, body));
  // Push notifications (closed-app reminders, via FCM): register this device's
  // token so the Cloud Function can reach it. No-op until a VAPID key is set and
  // the app runs a production build (dev has no service worker).
  void enablePush(data);

  // Open the tab the user chose in Settings ▸ Preferences ("Open Cobalt to").
  if (getPrefs().openTo !== 'dashboard') controller.goToTab(getPrefs().openTo);

  // Deep link from a service-worker notification click ("/#tasks"): land on Tasks.
  if (location.hash === '#tasks') {
    controller.goToTab('tasks');
    history.replaceState(null, '', location.pathname + location.search);
  }
}
// #endregion

/**
 * The "verify your email" nudge: shown only to accounts that actually have an
 * unverified PASSWORD credential (a Google-only account has no password to lose).
 *
 * Dismissal lasts the session, not forever, so ignoring it once doesn't hide the
 * warning permanently. It also re-checks whenever the tab regains focus, since
 * clicking the link happens in a DIFFERENT tab and `emailVerified` is cached here
 * until we explicitly reload the user.
 */
// Per-account: whether THIS user dismissed the banner. Unscoped, one account
// hiding it hid it for every later account on the browser — including accounts
// that genuinely still need to verify.
const VERIFY_DISMISS_KEY = () => scopedKey('ws:verifyNudgeDismissed');

async function mountVerifyNudge(host: HTMLElement, before: HTMLElement): Promise<void> {
  if (sessionStorage.getItem(VERIFY_DISMISS_KEY()) === '1') return;
  if (!(await needsEmailVerification())) return;

  const bar = el('div', { class: 'verify-bar' });
  const text = el('div', {
    class: 'verify-text',
    // Don't send them to an inbox nothing arrived in: if the automatic sign-up
    // send failed, say that instead (see verificationEmailFailed in auth.ts).
    text: verificationEmailFailed()
      ? 'We couldn’t send your verification email. Send it again so your password keeps working.'
      : 'Verify your email so your password keeps working. Check your inbox for the link.',
  });
  const resend = el('button', { class: 'verify-btn', text: 'Resend email' });
  const dismiss = el('button', { class: 'verify-x', text: '✕', title: 'Hide for now' });

  resend.addEventListener('click', () => {
    resend.disabled = true;
    resend.textContent = 'Sending…';
    void resendEmailVerification()
      .then(() => {
        text.textContent = 'Sent. Click the link in your inbox, then come back to this tab.';
        resend.textContent = 'Sent ✓';
      })
      .catch((err: Error) => {
        text.textContent = err.message;
        resend.disabled = false;
        resend.textContent = 'Resend email';
      });
  });
  // One teardown for every way the bar can go away, so the focus listener below
  // never outlives it. Without this, each sign-in added another listener that
  // stayed subscribed for the life of the page.
  const close = (): void => {
    window.removeEventListener('focus', recheck);
    bar.remove();
  };
  dismiss.addEventListener('click', () => {
    sessionStorage.setItem(VERIFY_DISMISS_KEY(), '1');
    close();
  });

  bar.append(text, resend, dismiss);
  host.insertBefore(bar, before); // above the tab column, inside the scrolling area

  // They click the link in ANOTHER tab, so this one has no way to hear about it.
  // Coming back to this tab is the cue to go ask.
  function recheck(): void {
    if (!bar.isConnected) return;
    void refreshVerificationState().then((verified) => {
      if (!verified) return;
      // Opens the gmail channel in the SAME breath as hiding the banner, so a
      // student who verifies mid-session starts getting emails without a reload.
      accountEmailVerified = true;
      close();
    });
  }
  window.addEventListener('focus', recheck);
}

/**
 * "Your password stopped working" — shown once, after Firebase's provider merge
 * has already deleted an email/password credential.
 *
 * HOW WE KNOW. We can't see the merge happen: it occurs inside the Google popup,
 * and the address isn't known until it returns. So instead every signed-in
 * session records what sign-in methods the account HAS (profile/authMethods).
 * A session that finds `password: true` on record but no password provider on
 * the live account is looking at the aftermath — the credential was there, and
 * now isn't.
 *
 * It lives in its own profile key rather than on `account` because `account` is
 * written whole in two places (onboarding + Settings ▸ name), either of which
 * would silently drop a field added there.
 *
 * WHY BOTHER, since Google still signs them in (Gabe's question, and it's fair):
 * this is not a lockout, it's a silent surprise. Without it they hit a password
 * that simply stops working — on their phone, months later — and reasonably
 * conclude the account is broken or the data is gone. The point is to replace a
 * mystery with a sentence and a way out. It also matters for the student who
 * later LOSES the Google account (graduation, a school workspace closing), for
 * whom the password would have been the way back in.
 */
async function mountPasswordDroppedNotice(
  data: Data,
  user: AuthUser,
  host: HTMLElement,
  before: HTMLElement
): Promise<void> {
  if (isLocalMode()) return;
  const DISMISS = scopedKey('ws:pwDroppedDismissed');
  const record = (await data.getProfile<{ password?: boolean }>('authMethods')) ?? {};
  const live = await hasPasswordProvider();

  // Live truth wins: record it so a LATER session can spot a disappearance.
  if (live !== !!record.password) {
    // Only ever write when it changed, so this isn't a write on every boot.
    await data.setProfile('authMethods', { ...record, password: live });
  }
  // Had one, doesn't now → the merge took it. (The reverse — gaining one — is
  // just them setting a password, which needs no announcement.)
  if (!(record.password === true && !live)) return;
  if (sessionStorage.getItem(DISMISS) === '1') return;

  const bar = el('div', { class: 'verify-bar pw-dropped' });
  const text = el('div', {
    class: 'verify-text',
    text: 'Your password no longer works on this account. Signing in with Google replaced it. Nothing was lost, and Google still signs you in, but set a new password if you want that option back.',
  });
  const act = el('button', { class: 'verify-btn', text: 'Set a password' });
  const dismiss = el('button', { class: 'verify-x', text: '✕', title: 'Hide for now' });

  act.addEventListener('click', () => {
    act.disabled = true;
    act.textContent = 'Sending…';
    // Same Firebase action as a reset (it's the only "choose a password" flow),
    // but worded as SET rather than RESET — there is no existing password to reset,
    // which is exactly what made the old copy read as incoherent. Completing it
    // also marks the address verified.
    void sendSetPasswordEmail(user.email)
      .then(() => {
        text.textContent = `Sent to ${user.email}. Open the link to choose a password. It can take a minute, and it sometimes lands in spam.`;
        act.textContent = 'Sent ✓';
      })
      .catch((err: Error) => {
        text.textContent = err.message;
        act.disabled = false;
        act.textContent = 'Set a password';
      });
  });
  dismiss.addEventListener('click', () => {
    sessionStorage.setItem(DISMISS, '1');
    bar.remove();
  });

  bar.append(text, act, dismiss);
  host.insertBefore(bar, before);
}

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
