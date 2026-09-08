// Cobalt: app entry point.

// #region Imports — styles + the modules this entry point wires together
import './ui/theme.css';

/**
 * KEYBOARD OR MOUSE? The focus ring depends on the answer (Gabe, 8/20).
 *
 * :focus-visible is supposed to settle this on its own, and mostly it does, but
 * Chrome hands it out on plain mouse clicks for some elements: an <a> that gets
 * focus from a click has been seen matching it, which is how a ring appeared after
 * clicking a bookmark card. Gabe's requirement is exact, and it is the behaviour
 * the app had before: a ring when you TAB, no ring when you click, ever.
 *
 * So the app records which device you last used, and the CSS asks. Tab (or any
 * arrow / Home / End navigation) turns it on; touching a pointer turns it off.
 * Capture phase, so nothing that stops propagation can hide the answer.
 */
const KEYS = new Set(['Tab', 'ArrowUp', 'ArrowDown', 'ArrowLeft', 'ArrowRight', 'Home', 'End', 'PageUp', 'PageDown']);
addEventListener('keydown', (e) => { if (KEYS.has(e.key)) document.documentElement.dataset.kbd = ''; }, true);
addEventListener('pointerdown', () => { delete document.documentElement.dataset.kbd; }, true);
addEventListener('mousedown', () => { delete document.documentElement.dataset.kbd; }, true);
import { dropSelections } from './ui/selbar';
import { closeAllPopups } from './ui/popup';
import './ui/components.css';
import './ui/colorPicker.css';
import './ui/focus.css';
import './ui/dashboard.css';
import './ui/settings.css';
import './ui/notifylog.css';
import './ui/archive.css';
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

// The audio doctor: `__audioDoctor.start()` in the console, let the music misbehave,
// then `__audioDoctor.report()`. See src/focus/audiodoctor.ts.
//
// Installed UNCONDITIONALLY, no flag. It adds nothing to the audio graph and starts
// no timer until start() is called, so idle it costs a single window property. A flag
// would only reproduce the problem the trials page had: a diagnostic that exists but
// cannot actually be reached at the moment it is needed.
void import('./focus/audiodoctor').then((m) => m.installAudioDoctor());

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
import { parsePath, setRoute, resetRoute, onNavigate, type Route } from './util/router';
import { DashboardView } from './dashboard/view';
import { TasksView } from './tasks/render';
import { TaskArchiveView } from './tasks/archiveView';
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
import { renderPrivacyPage } from './legal/privacy';
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
  // A path only means something to the signed-in shell, so remember where a cold
  // visitor was pointed (a shared /tasks link) and hand "/" back to the landing —
  // which must never sit at an address naming a tab it isn't showing. Boot only;
  // see the note on pendingRoute.
  if (!capturedBootRoute) {
    capturedBootRoute = true;
    pendingRoute = parsePath();
  }
  stopRouteListener?.();
  stopRouteListener = null;
  routeReady = false;
  resetRoute();
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
    data.archiveStaleCompleted(), // retire yesterday's completed into the Archives before anything renders
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
  const setNav = (open: boolean) => below.classList.toggle('nav-open', open);
  const toggleNav = () => setNav(!below.classList.contains('nav-open'));
  // The drawer overlays the page now rather than pushing it (components.css), so it
  // covers content instead of displacing it — which means it needs the two ways out
  // every overlay is expected to have: click the dimmed area, or press Escape.
  const scrim = el('div', { class: 'ws-scrim' });
  scrim.addEventListener('click', () => setNav(false));
  document.addEventListener('keydown', (e) => {
    if (e.key === 'Escape' && below.classList.contains('nav-open')) setNav(false);
  });

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
    // Settings' side tabs are the app's second path level (/settings/courses).
    // Passed ONLY here: the same class runs inside the landing demo's frame, and
    // without these two it behaves exactly as it always did and leaves the URL be.
    route: {
      section: () => parsePath()?.section ?? null,
      onSection: (slug, replace) => setRoute({ tab: 'settings', section: slug }, replace),
    },
  });
  // Settings sits back in the top-right (gear next to the name), not the sidebar.
  //
  // 18px BOX AND A 2.22 STROKE, where its three neighbours are 20 and 2 (Gabe,
  // 8/26 — "toolbar icons"). Every icon up here is drawn in a 24 box at width=20,
  // which is normally exactly how you keep a set the same size. The gear is the one
  // that doesn't obey: its path fills 22 of the 24 units, where the bell and archive
  // fill 18 and the bulb 14 (measured with getBBox). With the 2px stroke added that
  // put the gear at 20.0 rendered pixels across against the bell's 16.7 — a fifth
  // larger than everything beside it, which is what made it read as the heavy one.
  //
  // BOTH NUMBERS MOVE, AND THAT IS THE POINT. Shrinking the box alone was tried
  // first and the visual pass caught it straight away: stroke-width is in USER
  // units, so an 18px box renders the same `2` as 2 × 18/24 = 1.50 CSS px against
  // its neighbours' 1.67, and the gear stopped being too big by becoming too thin.
  // Scaling the stroke by the same 24/18 puts it back: 2.22 × 18/24 = 1.67 CSS px,
  // identical line weight to the bell, with the drawing 18.2px across against the
  // bell's 18.3. Change one of these two numbers and you have to change the other.
  const settingsBtn = el('button', { class: 'icon-btn', 'aria-label': 'Settings', title: 'Settings' });
  settingsBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="18" height="18" fill="none" stroke="currentColor" stroke-width="2.22" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="3.2"/><path d="M19.4 15a1.65 1.65 0 0 0 .33 1.82l.06.06a2 2 0 1 1-2.83 2.83l-.06-.06a1.65 1.65 0 0 0-1.82-.33 1.65 1.65 0 0 0-1 1.51V21a2 2 0 0 1-4 0v-.09a1.65 1.65 0 0 0-1-1.51 1.65 1.65 0 0 0-1.82.33l-.06.06a2 2 0 1 1-2.83-2.83l.06-.06a1.65 1.65 0 0 0 .33-1.82 1.65 1.65 0 0 0-1.51-1H3a2 2 0 0 1 0-4h.09a1.65 1.65 0 0 0 1.51-1 1.65 1.65 0 0 0-.33-1.82l-.06-.06a2 2 0 1 1 2.83-2.83l.06.06a1.65 1.65 0 0 0 1.82.33H9a1.65 1.65 0 0 0 1-1.51V3a2 2 0 0 1 4 0v.09a1.65 1.65 0 0 0 1 1.51 1.65 1.65 0 0 0 1.82-.33l.06-.06a2 2 0 1 1 2.83 2.83l-.06.06a1.65 1.65 0 0 0-.33 1.82V9a1.65 1.65 0 0 0 1.51 1H21a2 2 0 0 1 0 4h-.09a1.65 1.65 0 0 0-1.51 1z"/></svg>';
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

  // 🗄 Task Archives — everything checked off, with a Restore on every row (see
  // tasks/archiveView.ts). It sits BETWEEN 💡 and 🔔 exactly as Gabe placed it
  // (8/21). No count badge: unlike the bell, a number here would only ever say how
  // much work you have finished, which is not something to be nagged about.
  const archiveBtn = el('button', { class: 'icon-btn', 'aria-label': 'Task Archives', title: 'Task Archives' });
  // The <g> is a half-unit drop, not decoration: the box spans y 3→20 inside a 24
  // square, so its own centre is at 11.5 and it hung half a unit above every icon
  // beside it. Half of 24 units at 20px is 0.42 CSS px, which is nothing on a
  // 1x display and a visible device pixel on the Mac's 2x one.
  archiveBtn.innerHTML =
    '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><g transform="translate(0 .5)"><rect x="3" y="3" width="18" height="4" rx="1"/><path d="M5 7v12a1 1 0 0 0 1 1h12a1 1 0 0 0 1-1V7"/><path d="M10 12h4"/></g></svg>';
  archiveBtn.addEventListener('click', () => controller.goToTab('archive'));

  // No sign-out pill up here on purpose (per Gabe): the only way to sign out is
  // Settings → Sign out, behind its confirm dialog. One easy top-bar button made
  // it too casual to leave; this adds the friction back.
  // Icons first, name last (per Gabe): the two controls sit together as a pair on
  // the left, with the name reading as the label at the end of the cluster.
  // 💡 sits FIRST: it is the only one of the four that is not a destination, so
  // putting it left of the rest keeps the three navigating icons adjacent.
  userBox.append(suggestBtn, archiveBtn, bellBtn, settingsBtn, nameSpan);
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
  navBtns.set('archive', archiveBtn);

  const tabsHost = el('div', { class: 'app' }); // centered content column
  // Scrim BEFORE the sidebar so the sidebar paints over it even at equal stacking.
  below.append(scrim, sidebar, tabsHost);
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
  const archiveView = new TaskArchiveView(data);
  const dashboardView = new DashboardView(data, displayName, (id) => controller.goToTab(id));
  const tasksView = new TasksView(data);
  const focusView = new FocusView(data);
  activeFocusView = focusView; // sign-out tears this down (music, widget, overlay)
  controller = mountTabs(
    tabsHost,
    [
      { id: 'dashboard', label: 'Dashboard', render: (p) => dashboardView.mount(p) },
      // onShow, not a re-mount: the list is expensive and keeps live state. It only
      // re-tests the sticky add bar, which now that every tab opens at its top can
      // be left wearing a pinned shadow at scroll zero (see TasksView.onShow).
      { id: 'tasks', label: 'Tasks', render: (p) => tasksView.mount(p), onShow: () => tasksView.onShow() },
      { id: 'focus', label: 'Focus', render: (p) => void focusView.mount(p) },
      { id: 'bookmarks', label: 'Bookmarks', render: (p) => void new BookmarksView(data).mount(p) },
      // Re-mount every visit so unsaved edits revert to the last-saved version.
      { id: 'settings', label: 'Settings', onShow: (p) => void settingsView.mount(p) },
      // Same deal: re-mount so the log is current every time the bell is pressed.
      { id: 'notifications', label: 'Notifications', onShow: (p) => notifyLogView.mount(p) },
      // …and the archive, which is a live read of the task map: re-mounting means
      // it opens at the top showing whatever was checked off since you last looked.
      { id: 'archive', label: 'Task Archives', onShow: (p) => archiveView.mount(p) },
    ],
    // EVERY tab change, which is the whole point of putting it here (Gabe, 8/16).
    // A selection belongs to the list it was made in, so leaving that list ends it.
    //
    // This lived on each tab's `render` first and appeared to work — once. mountTabs
    // calls `render` for a tab EXACTLY ONCE and shows the cached panel every visit
    // after, so the clear fired on the first trip to each tab and never again. This
    // callback runs on every switch, which is the only hook that is actually true to
    // the name "on change".
    (id) => {
      dropSelections();
      // …and every open popup, for the same reason and on the same hook (Gabe,
      // 8/27). A popup mounts on <body> rather than inside its tab's panel, so
      // nothing about switching tabs removed it: a task's "…" menu opened in Tasks
      // was still sitting over Focus or Bookmarks afterwards. See ui/popup.ts.
      closeAllPopups();
      navBtns.forEach((b, k) => b.classList.toggle('active', k === id));
      // …and the address bar, which is just another thing that has to agree with
      // the tab on screen. Settings refines this to /settings/<section> as soon as
      // it mounts, so writing the bare tab here is only ever momentary.
      if (routeReady && !applyingRoute) setRoute({ tab: id });
    }
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

  // WHERE TO OPEN, in order of who asked most explicitly (see util/router.ts).
  //
  // A path in the bar wins: it is either a link someone followed, a bookmark, or a
  // reload of the tab they were already on, and all three are a specific request.
  // Only when the bar says nothing does the "Open Cobalt to" preference decide.
  const wanted = pendingRoute ?? parsePath();
  pendingRoute = null;
  applyingRoute = true;
  if (wanted) {
    controller.goToTab(wanted.tab);
  } else if (location.hash === '#tasks') {
    // Old service-worker notifications (before their click target became "/tasks")
    // still arrive as a hash. Honour it, then let the route below rewrite the bar.
    controller.goToTab('tasks');
  } else if (getPrefs().openTo !== 'dashboard') {
    controller.goToTab(getPrefs().openTo);
  }
  applyingRoute = false;
  // Straighten the bar to match whatever the above landed on, without leaving the
  // entry it replaced in the history — arriving at /tasks should not put a phantom
  // /dashboard behind the Back button.
  //
  // THE SECTION HAS TO SURVIVE THIS. Settings loads its page asynchronously, so it
  // is still reading the profile when this line runs; writing a bare /settings here
  // would erase the /settings/courses that was asked for, and the section it then
  // read back would be the wrong one.
  const landed = controller.current();
  setRoute(wanted && wanted.tab === landed ? wanted : { tab: landed }, true);
  routeReady = true;

  // Back/forward. Settings re-mounts on every visit and reads its section from the
  // path as it does, so one goToTab covers both levels.
  stopRouteListener?.();
  stopRouteListener = onNavigate((r) => {
    applyingRoute = true;
    controller.goToTab(r?.tab ?? getPrefs().openTo);
    applyingRoute = false;
    // An entry from before sign-in can still be behind us; it says "/" while a tab
    // is plainly on screen. Name what is showing rather than leave the bar lying.
    if (!r) setRoute({ tab: controller.current() }, true);
  });
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

// ROUTING STATE (see util/router.ts).
//
// `pendingRoute` holds a path that arrived while nobody was signed in — someone
// opened a shared /tasks link cold — so the sign-in that follows lands where the
// link pointed instead of on their default tab. Captured once, at boot only: a
// deliberate sign-out later should not silently reopen the last tab of the account
// that just left.
//
// `routeReady` keeps mountTabs' own opening call (it shows the first tab the moment
// the panels exist) from writing a history entry before the real route is decided,
// and `applyingRoute` does the same for a Back/Forward, where the browser has
// already moved and writing again would fight it.
let pendingRoute: Route | null = null;
let capturedBootRoute = false;
let routeReady = false;
let applyingRoute = false;
let stopRouteListener: (() => void) | null = null;

// PRIVACY POLICY: a standalone route, reachable signed in OR signed out, that
// needs no account at all (see legal/privacy.ts). Checked ONCE, here, before
// the auth listener below is even registered, so a Google reviewer — or a
// signed-in student who lands here cold — gets the policy with no Firebase
// call in the way and no risk of renderSignIn()'s resetRoute() rewriting the
// address back to "/" out from under it.
const isPrivacyPath = (): boolean => location.pathname.replace(/\/+$/, '').toLowerCase() === '/privacy';

let currentUid: string | null = null;
if (isPrivacyPath()) {
  document.body.classList.remove('app-mode');
  root.replaceChildren();
  root.append(renderPrivacyPage());
} else {
onAuth((user) => {
  if (user) {
    // A SIGNED-IN USER MAKES THE SIGN-IN SCREEN OBSOLETE, however they got there.
    //
    // The screen closes itself on the paths that know they succeeded (see
    // authScreen.ts), and this is the backstop for the ones that do not: a redirect
    // returning, another tab signing in, a session restoring. It lives on <body>, so
    // re-rendering #root alone would leave it floating over a working app — which is
    // exactly what happened when Google sign-in became a popup (Gabe, 8/16).
    document.querySelector('.auth-overlay')?.remove();
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
}
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
