// WorkSpace — Focus sessions (spec §8). Single-shot deep-work countdown tied to tasks.

import type { Data } from '../db';
import type { Task, TaskMap, TaskFolder } from '../types';
import { getTaskFolders, saveTaskFolders, makeFolder, FOLDERS_EVENT } from '../tasks/folders';
import { makeResizeGrip, restoreSavedHeight } from '../util/resize';
import { el, textInput, copyTextMetrics, autoWidthToText, enterConfirms } from '../util/dom';
import { makeWheel } from './wheel';
import { genId } from '../util/ids';
import { sortTasks, makeTask } from '../tasks/store';
import { getCourseColor, matchCourseStrict } from '../courses/registry';
import { armAudioContext, formatClock } from './timer';
import { playEndSound, DEFAULT_END_SOUND, DEFAULT_END_VOLUME, type EndSoundHandle } from './sounds';
import { MusicEngine, type Track } from './music';
import { MUSIC_GENRES, LIBRARY_TRACKS, tracksForGenre, libraryTrack, type LibraryTrack } from './library';
import { majorArtists, minorArtistTracks, hasMinorArtists, tracksForArtist } from './artists';
import { loadPlaylists, playlistEmoji, type CustomPlaylist } from './playlists';
import type { MusicCollKind } from './persist'; // shared with FocusState

/** Where the focus-music MP3s are hosted. DEV: '' → the "/music-lib/…" paths are served
 *  by the Vite middleware from the local Music Database folder. PRODUCTION: set
 *  VITE_MUSIC_BASE_URL in .env.local to the online base (e.g. a Firebase Storage bucket
 *  URL, no trailing slash) — it's prepended to every track path so the deployed site can
 *  reach the files it can't bundle. */
// PROD-gated on purpose: once VITE_MUSIC_BASE_URL exists in .env.local, Vite loads it
// in dev too — but dev must keep the local middleware (works offline, no bucket CORS
// needed), so the base URL is only applied in production builds.
const MUSIC_BASE_URL = import.meta.env.PROD
  ? ((import.meta.env.VITE_MUSIC_BASE_URL as string | undefined) || '').replace(/\/+$/, '')
  : '';

/** Sum a playlist's track lengths, in seconds. */
function totalSeconds(tracks: LibraryTrack[]): number {
  return tracks.reduce((s, t) => s + (t.duration || 0), 0);
}

/** The same intrinsic-edit gate the Tasks tab enforces (see tasks/render.ts
 *  editingUnlocked): title/course edits here write through to the real task, so
 *  they honor the same Settings ▸ Tasks "Edit task details" switch — one lock,
 *  both tabs. Checking off, folders, and reordering stay free. */
function taskEditUnlocked(): boolean {
  if (getPrefs().tasks.allowEdit) return true;
  const t = el('div', { class: 'toast', text: '✏️ Editing is off. Turn it on with “Edit task details” in Settings ▸ Tasks.' });
  document.body.append(t);
  void t.offsetHeight;
  t.classList.add('show');
  window.setTimeout(() => {
    t.classList.remove('show');
    window.setTimeout(() => t.remove(), 350);
  }, 2600);
  return false;
}
/** Browse-list order for genre/artist rows: most songs first; equal counts break
 *  by total run time. So a 5-song 13m list outranks a 4-song 35m one, which
 *  outranks a 4-song 13m one. */
function sortCollections<T>(items: T[], tracksOf: (x: T) => LibraryTrack[]): { item: T; tracks: LibraryTrack[] }[] {
  return items
    .map((item) => ({ item, tracks: tracksOf(item) }))
    .sort((a, b) => b.tracks.length - a.tracks.length || totalSeconds(b.tracks) - totalSeconds(a.tracks));
}
/** Filled folder glyph, tinted with the folder's color (focus folders + import rows). */
const FOCUS_FOLDER_SVG = (color: string) =>
  `<svg class="focus-folder-ico" viewBox="0 0 24 24" fill="${color}"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
/** Outline folder glyph for the per-todo 🗀 button (currentColor). */
const FOCUS_FOLDER_BTN_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

/** Saved height of the in-session music menu's song list (drag-resizable). Lives
 *  at module scope because the menu is rebuilt from scratch on every redraw. */
const MENU_TRACKS_H_KEY = 'focus:menuTracksHeight';
/** Same, for the "Switch playlist" browser (all genres/artists/playlists). */
const MENU_BROWSE_H_KEY = 'focus:menuBrowseHeight';

/** Compact playlist run time: "2h 5m", "1h", "48m", "9m". Empty when unknown (0). */
function fmtPlaylistLen(sec: number): string {
  if (!sec) return '';
  const totalMin = Math.max(1, Math.round(sec / 60));
  const h = Math.floor(totalMin / 60);
  const m = totalMin % 60;
  if (h > 0) return m > 0 ? `${h}h ${m}m` : `${h}h`;
  return `${m}m`;
}
import { parseFocusInput, parseDateTime } from '../tasks/parser';
import { formatMetaDate, formatTimeOfDay } from '../util/dates';
import { recordManualLabelForTask } from '../schoology/extension';
import { getPrefs } from '../prefs';
import { sendNotification, normalizeNotifySettings } from '../notify/notify';
import {
  type FocusTodo,
  type FocusState,
  saveFocusState,
  loadFocusState,
  clearFocusState,
  declineSavedSession,
  getTabId,
  ownsSession,
  focusStateKey,
} from './persist';

// Default session-length presets, in minutes. Their labels are DERIVED by
// presetLabel() (below), so defaults and user-saved "+ Preset" buttons always share
// one format — "2h 30m", never "2.5h".
const PRESET_MINS = [45, 60, 90, 120, 150, 180];

/** A user-saved session-length preset (created via "+ Preset" on the setup screen). */
interface CustomPreset {
  key: string; // 'preset_' + genId(), also its id in the focus collection
  seconds: number;
}

/** Compact label for a custom preset: "1h 30m", "25m", "1h 5m 30s", "45s". */
function presetLabel(totalSeconds: number): string {
  const h = Math.floor(totalSeconds / 3600);
  const m = Math.floor((totalSeconds % 3600) / 60);
  const s = totalSeconds % 60;
  const parts: string[] = [];
  if (h) parts.push(`${h}h`);
  if (m) parts.push(`${m}m`);
  if (s) parts.push(`${s}s`);
  return parts.join(' ') || '0s';
}

// The endless number wheels (session length + add/trim pickers) live in ./wheel —
// shared with the landing demo, so every carousel in the app behaves identically.

// Inspiring, work-fueling one-liners — every one should actually push you to focus
// and get things done, not just sound edgy. One is picked per session and persisted
// so it survives a refresh. Rendered uppercase by .focus-quote CSS; stored uppercase.
const QUOTES = [
  // Focus + attention
  'WHERE FOCUS GOES, ENERGY FLOWS',
  'ONE TASK. FULL FOCUS. NOTHING ELSE.',
  'FOCUS IS THE ART OF KNOWING WHAT TO IGNORE',
  'YOUR ATTENTION IS YOUR SUPERPOWER. AIM IT HERE',
  'DISTRACTION IS A DECISION. CHOOSE THE WORK.',
  'DEEP WORK IS A SUPERPOWER. USE YOURS.',
  'GUARD THIS HOUR. IT IS BUILDING YOUR FUTURE',
  // Starting + momentum
  'START NOW. PERFECT LATER.',
  'THE HARDEST PART IS STARTING, AND YOU ALREADY HAVE',
  'MOMENTUM IS BUILT ONE FOCUSED MINUTE AT A TIME',
  'A YEAR FROM NOW YOU WILL WISH YOU STARTED TODAY',
  'THE SECRET OF GETTING AHEAD IS GETTING STARTED',
  "DON'T WAIT FOR MOTIVATION. BUILD MOMENTUM.",
  'BEGIN. EVERYTHING AFTER IS EASIER.',
  // Execution + done
  'DONE IS BETTER THAN PERFECT',
  'IDEAS ARE CHEAP. EXECUTION IS EVERYTHING.',
  'PROGRESS OVER PERFECTION',
  'STOP PLANNING. START DOING.',
  "IT ALWAYS SEEMS IMPOSSIBLE UNTIL IT'S DONE",
  'WELL DONE IS BETTER THAN WELL SAID',
  "THE WORK WON'T DO ITSELF",
  'FINISH WHAT YOU START',
  // Discipline + consistency
  "DISCIPLINE IS DOING IT WHEN YOU DON'T FEEL LIKE IT",
  'DISCIPLINE IS FREEDOM',
  'CONSISTENCY BEATS INTENSITY',
  'SMALL STEPS DAILY BEAT GIANT LEAPS SOMEDAY',
  'MOTIVATION GETS YOU STARTED. DISCIPLINE KEEPS YOU GOING.',
  'QUALITY IS NOT AN ACT. IT IS A HABIT.',
  "SHOW UP, ESPECIALLY WHEN YOU DON'T WANT TO",
  'DISCIPLINE WEIGHS OUNCES. REGRET WEIGHS TONS.',
  // Effort
  "HARD WORK BEATS TALENT WHEN TALENT DOESN'T WORK HARD",
  'OUTWORK YESTERDAY',
  'SUFFER NOW. WIN LATER.',
  'PAIN IS TEMPORARY. PRIDE IS FOREVER.',
  'WINNERS WORK. WISHERS WAIT.',
  'SWEAT IN SILENCE. LET RESULTS MAKE THE NOISE.',
  "DON'T STOP WHEN YOU'RE TIRED. STOP WHEN YOU'RE DONE.",
  'BE THE HARDEST WORKER IN THE ROOM',
  'THERE IS NO SUBSTITUTE FOR HARD WORK',
  'NOTHING WORTH HAVING COMES EASY',
  // Future self + stakes
  'YOUR FUTURE SELF IS BEING BUILT RIGHT NOW',
  'FUTURE YOU IS COUNTING ON PRESENT YOU',
  'EVERY FOCUSED HOUR COMPOUNDS',
  'BE THE REASON YOUR FUTURE SELF SUCCEEDS',
  "TODAY'S WORK IS A GIFT TO WHO YOU'RE BECOMING",
  'YOU ARE BUILDING A REPUTATION WITH YOURSELF',
  'EVERY REP IS A DEPOSIT IN YOUR FUTURE',
  // Growth + challenge
  "IF IT DOESN'T CHALLENGE YOU, IT DOESN'T CHANGE YOU",
  'GROWTH LIVES OUTSIDE YOUR COMFORT ZONE',
  "DON'T LIMIT YOUR CHALLENGES. CHALLENGE YOUR LIMITS.",
  'THE STRUGGLE IS WHERE STRENGTH IS BUILT',
  'FALL SEVEN TIMES. STAND EIGHT.',
  "YOU DON'T HAVE TO BE GREAT TO START, BUT YOU HAVE TO START TO BE GREAT",
  'THE PAIN YOU FEEL TODAY IS THE STRENGTH YOU FEEL TOMORROW',
  'COMFORT IS THE ENEMY OF PROGRESS',
  // Time + now
  'THE BEST TIME TO START WAS YESTERDAY. THE NEXT BEST IS NOW.',
  'THIS HOUR WILL NEVER COME AGAIN. USE IT.',
  'MAKE THIS MINUTE COUNT',
  'WIN THE NEXT MINUTE',
  'THE FUTURE DEPENDS ON WHAT YOU DO TODAY',
  // Mindset + resilience
  'THE BODY ACHIEVES WHAT THE MIND BELIEVES',
  "NOBODY IS COMING TO SAVE YOU, AND THAT'S YOUR POWER",
  'WHEN YOU FEEL LIKE QUITTING, REMEMBER WHY YOU STARTED',
  "DON'T NEGOTIATE WITH THE PART OF YOU THAT WANTS TO QUIT",
  'PROVE IT TO YOURSELF',
  "YOU HAVEN'T COME THIS FAR TO QUIT",
  "DON'T WISH IT WERE EASIER. BECOME BETTER.",
  'ONE MORE PAGE. ONE MORE PROBLEM. ONE MORE MINUTE.',
  'SUCCESS IS RENTED. PAY YOUR RENT TODAY.',
  'CHAMPIONS ARE MADE WHEN NO ONE IS WATCHING',
  // Identity + becoming
  'DO THE THING. BECOME THE PERSON.',
  "BECOME SOMEONE YOU'RE PROUD OF",
  'WORK IN SILENCE. LET SUCCESS SPEAK.',
  "BE SO GOOD THEY CAN'T IGNORE YOU",
  'THE GAP BETWEEN WHO YOU ARE AND WHO YOU COULD BE IS CLOSED BY WORK',
  'BUILD WHILE THEY SLEEP',
  "CREATE, DON'T CONSUME",
  'EMBRACE THE STRUGGLE',
  'WHILE THEY REST, YOU RISE',
  'ROMANTICIZE THE GRIND',
  'THE DIFFERENCE IS DISCIPLINE',
  'MAKE SACRIFICE YOUR ADVANTAGE',
  'AMATEURS WAIT FOR INSPIRATION. PROS GET TO WORK.',
  'DOUBT KILLS MORE DREAMS THAN FAILURE EVER WILL',
  'STOP TALKING. START PROVING.',
  'YOU VS. YOU: THE ONLY MATCH THAT MATTERS',
  'YOUR ONLY LIMIT IS THE ONE YOU ACCEPT',
  'GREATNESS IS EARNED, NEVER GIVEN',
];

// Ring radius in the 280×280 viewBox. A touch larger than the timer numerals so
// there's clear breathing room between the gold arc and the centered countdown.
const RING_R = 130;
const RING_C = 2 * Math.PI * RING_R;

// Sessions cap at 12 hours. The carousel enforces it (12h forces minutes to 00),
// and the in-session "add time" buttons clamp to it too.
const MAX_FOCUS_MINUTES = 12 * 60;
const MAX_FOCUS_SECONDS = MAX_FOCUS_MINUTES * 60;

export class FocusView {
  private data: Data;
  private panel!: HTMLElement;

  // setup ("creation") state — the draft you assemble before starting. Deliberately
  // SEPARATE from the running session (below), so adding a task to one never shows in
  // the other, and starting a session resets these without touching the live session.
  private todos: FocusTodo[] = [];
  private selectedSeconds = 60 * 60; // session length in seconds (default 1h)
  private selectedMusic: string | null = tracksForGenre(MUSIC_GENRES[0].id)[0]?.id ?? null;
  private customPresets: CustomPreset[] = []; // user-saved lengths ("+ Preset"), persisted
  private initFocusWheels?: (tries?: number) => void; // positions the length carousel after mount
  // Active-session state — owned by the running overlay/widget, snapshotted at start.
  private sessionTodos: FocusTodo[] = [];
  private sessionMusic: string | null = null; // the session's currently-playing track
  // Task linking: the import window snapshot + redrawers for whatever's on screen,
  // kept in step with the Tasks tab via a single data.watchTasks subscription.
  private importTasks: Task[] = [];
  private refreshImportBody?: () => void;
  private redrawTodos?: () => void; // redraws the SETUP list
  private redrawSessionTodos: (() => void) | null = null; // redraws the active session's list
  private watchingTasks = false;
  private musicVolume = 50; // live session music volume (0–100), driven by the in-session slider
  private playlist: Track[] = [];
  // The active music collection driving the session playlist — a genre, an artist,
  // "various" (the pooled small artists), or the user's favorites.
  private musicColl: { kind: MusicCollKind; key: string } = { kind: 'genre', key: MUSIC_GENRES[0].id };
  private favorites = new Set<string>(); // favorited library-track ids (persisted)
  private customPlaylists: CustomPlaylist[] = []; // user-made playlists (built in Settings)
  private engine: MusicEngine | null = null;
  // A playlist picked in the SETUP browser while a session is running. The setup
  // screen must never hijack live music, so the pick is parked here and applied
  // the moment the session ends (it becomes the next session's draft).
  private pendingSel: { kind: MusicCollKind; key: string; index: number } | null = null;
  // FOCUS folders (independent from Tasks-tab folders): the setup list's and the
  // running session's, snapshotted at start exactly like the todos themselves.
  // ONE folder list, shared with the Tasks tab (profile 'taskFolders'). Focus no
  // longer keeps its own 'ffold_' namespace: creating, renaming, recoloring or
  // filing a todo here IS the same action in Tasks, and vice versa (per Gabe).
  private taskFolders: TaskFolder[] = [];
  private openFocusFolders = new Set<string>(); // expanded folder rows (view state)

  // timer state
  private endTimeMs = 0;
  private totalSeconds = 0;
  private paused = false;
  private pausedRemainingSec: number | null = null;
  private quote = '';
  private interval: number | null = null;
  private ringRaf = 0; // rAF that decreases the ring continuously (not per-second)
  // Which window owns the ticker/ring. Chrome throttles a HIDDEN tab's timers to as
  // little as once per minute (and stops its rAF completely) — and the main tab is
  // hidden exactly when the detached PiP mini player is in use. So the clock runs in
  // the PiP window while it's open (it's visible → never throttled), and these track
  // the owner so stop/cancel hits the right window after pip↔tab transitions.
  private tickerWin: Window = window;
  private ringWin: Window = window;

  // DOM
  private overlay: HTMLElement | null = null;
  private widget: HTMLElement | null = null;
  private pipWindow: Window | null = null; // the detached Document-Picture-in-Picture mini player, if open
  private ringEl: SVGCircleElement | null = null;
  private ringWrap: HTMLElement | null = null;
  private timeText: HTMLElement | null = null;
  private endTimeEl: HTMLElement | null = null; // "⏰ Ends 2:34 PM" line beneath the ring
  private pauseBtn: HTMLElement | null = null; // active screen's Pause/Resume (overlay or widget)
  private musicNameEl: HTMLElement | null = null;
  private musicPlayBtn: HTMLElement | null = null;
  private redrawMusicMenu: (() => void) | null = null; // refreshes the 🎵 menu's rows/highlight
  private redrawSetupMusic: (() => void) | null = null; // refreshes the setup music browser
  private musicResumeHandler: ((e: PointerEvent) => void) | null = null; // one-shot autoplay-block retry
  private musicPlaying = true;
  private musicPlayingAtPause = false; // was the track playing when the SESSION was paused?
  /** The todo being ⋮⋮-dragged: its flat index + the group it belongs to (folder
   *  id, or '' when loose). The group is what keeps a drag inside its own list. */
  private dragFrom: { index: number; group: string } | null = null;
  private originalTitle = ''; // restored when the session ends
  private endCue: EndSoundHandle | null = null; // the in-flight completion cue — stopped if the session is restored mid-ring
  private endSoundKey = DEFAULT_END_SOUND; // user's chosen completion sound (Settings)
  private endSoundVolume = DEFAULT_END_VOLUME; // user's chosen completion volume (Settings)
  private endSoundEnabled = true; // Settings ▸ Focus ▸ End Sound master switch
  private wakeLock: WakeLockSentinel | null = null; // Screen Wake Lock while a session runs

  constructor(data: Data) {
    this.data = data;
    // Cross-tab session coordination (ownership handoffs, signpost toasts).
    // Removed in teardown() so re-sign-ins don't stack listeners.
    window.addEventListener('storage', this.onStorage);
    // Tasks→Focus sync subscribes HERE, not in mount(). A session restored at
    // boot (or run from the mini player) never mounts the Focus tab, so a
    // mount-time subscription left those sessions deaf to Tasks-tab edits —
    // titles/courses edited in Tasks silently didn't reach a running session.
    this.ensureTaskWatch();
    void this.refreshFolders(); // shared folder list, needed even without a mount
    // Folders written anywhere (Tasks tab, or another focus screen) → re-read.
    window.addEventListener(FOLDERS_EVENT, () => {
      void this.refreshFolders().then(() => {
        this.redrawTodos?.();
        this.redrawSessionTodos?.();
      });
    });
  }

  /** Subscribe once to task updates, so the import window and every linked todo
   *  (setup draft + live session) follow the Tasks tab. Idempotent. */
  private ensureTaskWatch(): void {
    if (this.watchingTasks) return;
    this.watchingTasks = true;
    this.data.watchTasks((u) => this.onTasksUpdate(u.tasks));
  }

  async mount(panel: HTMLElement): Promise<void> {
    this.panel = panel;
    this.ensureTaskWatch(); // no-op after the constructor; kept for safety on re-mount
    await this.refreshFolders(); // the folder list is shared with Tasks — load it before drawing
    this.playlist = await this.buildPlaylist();
    void this.loadEndSound();
    // An active session is shown as an overlay on <body> (see bootRestore), which
    // survives tab switches on its own — so the panel just renders the setup screen.
    this.renderSetup();
  }

  /** Read the user's chosen completion sound (Settings → Focus). Re-read on each
   *  mount/start so a change in Settings applies to the next session. */
  private async loadEndSound(): Promise<void> {
    try {
      const s = await this.data.getProfile<{ key: string; volume?: number; enabled?: boolean }>('focusEndSound');
      this.endSoundKey = s?.key || DEFAULT_END_SOUND;
      this.endSoundVolume = s?.volume ?? DEFAULT_END_VOLUME;
      this.endSoundEnabled = s?.enabled ?? true;
    } catch {
      this.endSoundKey = DEFAULT_END_SOUND;
      this.endSoundVolume = DEFAULT_END_VOLUME;
      this.endSoundEnabled = true;
    }
  }

  /** Screen Wake Lock (Settings ▸ Focus ▸ Keep screen awake): best-effort — the
   *  lock auto-releases when the tab is hidden; we just acquire/release around a
   *  session. Unsupported browsers silently skip it. */
  private async acquireWakeLock(): Promise<void> {
    if (!getPrefs().focus.keepAwake) return;
    try {
      this.wakeLock = (await navigator.wakeLock?.request('screen')) ?? null;
    } catch {
      this.wakeLock = null; // denied / unsupported — never an error the user sees
    }
  }

  private releaseWakeLock(): void {
    void this.wakeLock?.release().catch(() => {});
    this.wakeLock = null;
  }

  /**
   * Called once at app boot. If this tab had an active session (e.g. the page was
   * reloaded mid-session), recompute remaining time and restore the overlay
   * immediately — no need to open the Focus tab first.
   */
  async bootRestore(): Promise<void> {
    const saved = loadFocusState();
    if (!saved?.sessionActive) return;
    const remaining = saved.paused
      ? saved.pausedRemainingSec ?? 0
      : Math.round((saved.endTimeMs - Date.now()) / 1000);
    if (remaining <= 0) {
      // Finished while you were away → end it properly (sound + toast), not silently.
      await this.loadEndSound();
      this.finishElapsedSession(saved);
      return;
    }
    this.playlist = await this.buildPlaylist();
    await this.loadEndSound();
    if (saved.suspended) {
      // Suspended by sign-out: NEVER auto-restore — ask first, and ONLY in the tab
      // the session lived in. Other tabs stay silent (it isn't running anywhere).
      // Asked ONCE: a ✕ on that toast is a "no" that outlives the page (Gabe, 8/9).
      if (ownsSession(saved) && !saved.declined) this.showSessionToast('restore');
    } else if (ownsSession(saved)) {
      // This tab's own session (mid-session reload): bring it right back.
      this.restore(saved);
    } else {
      // Another tab owns it — it stays there. This tab just gets the signpost.
      this.showSessionToast('enter');
    }
  }

  /**
   * The persistent session toast. Two flavors:
   *  - 'restore' — a suspended (signed-out) session: "Restore ongoing focus session".
   *    Has a ✕ (it's a question); stays until answered.
   *  - 'enter' — a session running in ANOTHER tab: "Enter focus session". No ✕ and
   *    no timeout — it stays as long as the session lives elsewhere (the storage
   *    listener removes it when that session ends, or swaps roles on adoption).
   */
  private showSessionToast(kind: 'restore' | 'enter'): void {
    document.getElementById('focus-end-toast')?.remove();
    document.getElementById('focus-session-toast')?.remove();
    const saved = loadFocusState();
    if (!saved?.sessionActive) return;
    const remaining = saved.paused
      ? saved.pausedRemainingSec ?? 0
      : Math.round((saved.endTimeMs - Date.now()) / 1000);

    // `focus-session-mini` = the compact variant (these two toasts stay understated).
    const toast = el('div', { class: 'focus-end-toast focus-session-mini' });
    toast.id = 'focus-session-toast';
    toast.dataset.kind = kind;
    toast.append(el('div', { class: 'focus-end-toast-icon', text: kind === 'restore' ? '⏳' : '🎯' }));
    const body = el('div', { class: 'focus-end-toast-body' });
    // ONE line each: the restore toast folds the time-left into its header (question
    // in brand gold, the time in brand gray), and the mini CSS widens so nothing wraps.
    const title = el('div', { class: 'focus-end-toast-title' });
    if (kind === 'restore') {
      title.append(
        el('span', { text: 'RESTORE FOCUS SESSION?' }),
        el('span', { class: 'focus-end-toast-time', text: ` · ${this.clock(remaining)} LEFT` })
      );
    } else {
      title.textContent = 'FOCUS SESSION';
    }
    body.append(title);
    toast.append(body);

    const action = el('button', {
      class: 'focus-end-toast-retrieve',
      // "Switch … to this tab" — explicit that the session MOVES here (never duplicated).
      text: kind === 'restore' ? 'Restore' : 'Switch Focus to this tab',
    });
    action.addEventListener('click', () => {
      toast.remove();
      this.adoptSession(); // reads the FRESH state (the owner may have ticked on)
    });
    toast.append(action);

    if (kind === 'restore') {
      const close = el('button', { class: 'focus-end-toast-close', text: '✕', title: 'Dismiss' });
      close.addEventListener('click', () => {
        // Persist the "no". Closing the node alone left the saved session
        // suspended-and-unanswered, so the toast returned on every later load.
        declineSavedSession();
        toast.classList.remove('show');
        setTimeout(() => toast.remove(), 400);
      });
      toast.append(close);
    }

    document.body.append(toast);
    requestAnimationFrame(() => toast.classList.add('show'));
    // Deliberately NO auto-dismiss: both toasts represent a standing fact.
  }

  /** Take ownership of the persisted session and run it in THIS tab. Writing the
   *  new ownerTab fires the 'storage' event in the previous owner, which quietly
   *  drops its copy of the UI — one session, one tab, always. */
  private adoptSession(): void {
    if (this.overlay || this.widget) return; // never stack two sessions here
    const s = loadFocusState();
    if (!s?.sessionActive) return;
    const remaining = s.paused ? s.pausedRemainingSec ?? 0 : Math.round((s.endTimeMs - Date.now()) / 1000);
    if (remaining <= 0) {
      this.finishElapsedSession(s); // ran out before this tab adopted it → end it properly
      return;
    }
    s.ownerTab = getTabId();
    s.suspended = false;
    saveFocusState(s); // announce the takeover before building the UI
    this.restore(s);
  }

  /** Bring the end-toast's snapshot back to life (the manual-End undo). */
  private retrieveSession(s: FocusState, resumeRunning: boolean): void {
    if (this.overlay || this.widget) return; // a session is already up — never stack two
    // The session is coming BACK — a still-ringing completion cue would be a lie.
    this.endCue?.stop();
    this.endCue = null;
    const remaining = s.paused ? s.pausedRemainingSec ?? 0 : Math.round((s.endTimeMs - Date.now()) / 1000);
    if (remaining <= 0) {
      this.finishElapsedSession(s); // its leftover time elapsed → end it properly
      return;
    }
    s.ownerTab = getTabId(); // this tab owns the resurrected session
    s.suspended = false;
    saveFocusState(s);
    this.restore(s);
    if (resumeRunning && this.paused) this.togglePause();
  }

  /** A restored session whose timer already ran out while you were away: END it
   *  properly — play the end sound + show the "complete" toast (+ fire the completion
   *  notification) instead of silently dropping it, exactly as if the app had stayed
   *  open to the finish. NOTE: the sound only actually sounds when audio is already
   *  unlocked from an earlier gesture — a cold page-load can't autoplay — but a restore
   *  from a click (the Restore/Enter toast) provides that gesture; the toast always shows. */
  private finishElapsedSession(saved: FocusState): void {
    clearFocusState();
    const done = (saved.todos ?? []).filter((t) => t.done).length;
    const total = (saved.todos ?? []).length;
    const minutes = Math.max(0, Math.round((saved.totalSeconds ?? 0) / 60));
    if (this.endSoundEnabled) this.endCue = playEndSound(this.endSoundKey, this.endSoundVolume);
    void this.notify('⏰ Focus session complete!', `${minutes} min focused • ${done}/${total} tasks done`);
    this.showEndToast(true, minutes, done, total);
  }

  // --- playlist -----------------------------------------------------------

  /** Map a library track (src/focus/library.ts) into the engine's Track shape. */
  private libraryToTrack(lt: LibraryTrack): Track {
    // gainDb (LUFS normalization) → linear multiplier the engine applies per track.
    // src: in dev, lt.src is "/music-lib/…" served by the Vite middleware. In production
    // the MP3s are hosted online (e.g. Firebase Storage); set VITE_MUSIC_BASE_URL to that
    // base and it's prepended here. Empty by default → unchanged local behavior.
    return { key: lt.id, label: lt.title, emoji: lt.emoji, src: MUSIC_BASE_URL + lt.src, volume: this.musicVolume, gain: Math.pow(10, lt.gainDb / 20) };
  }

  /** The active playlist = the current genre's tracks (curated NN order) followed by
   *  any custom tracks the user added. */
  private async buildPlaylist(): Promise<Track[]> {
    const focus = await this.data.getFocusAll<any>();
    const custom: Track[] = Object.entries(focus)
      .filter(([k]) => k.startsWith('track_'))
      .map(([, v]) => v as Track)
      .filter((t) => t.src); // drop any stale tracks from the old YouTube schema
    // Piggyback on the same read: the user's saved "+ Preset" lengths live in this
    // collection too (preset_* keys), so load them here instead of re-fetching.
    this.customPresets = Object.entries(focus)
      .filter(([k]) => k.startsWith('preset_'))
      .map(([, v]) => v as CustomPreset)
      .filter((p) => typeof p.seconds === 'number' && p.seconds > 0);
    // Favorited track ids live in a single 'favorites' record; playlists in 'playlist_*'.
    this.favorites = new Set<string>((focus['favorites'] as { ids?: string[] } | undefined)?.ids ?? []);
    this.customPlaylists = loadPlaylists(focus);
    const lib = this.collectionTracks().map((lt) => this.libraryToTrack(lt));
    return [...lib, ...custom];
  }

  /** A custom playlist's tracks (its stored ids → library tracks, in order). */
  private playlistTracks(id: string): LibraryTrack[] {
    const pl = this.customPlaylists.find((p) => p.id === id);
    if (!pl) return [];
    return pl.trackIds.map((tid) => libraryTrack(tid)).filter((t): t is LibraryTrack => !!t);
  }

  /** Re-read favorites + custom playlists from storage (they can change mid-session). */
  private async refreshMusicLibrary(): Promise<void> {
    const focus = await this.data.getFocusAll<Record<string, unknown>>();
    this.favorites = new Set<string>((focus['favorites'] as { ids?: string[] } | undefined)?.ids ?? []);
    this.customPlaylists = loadPlaylists(focus);
  }

  /** Favorited library tracks, in library order. */
  private favoriteTracks(): LibraryTrack[] {
    return LIBRARY_TRACKS.filter((t) => this.favorites.has(t.id));
  }

  /** Add/remove a track from favorites and persist. Refreshes any open music UI. */
  private async toggleFavorite(id: string): Promise<void> {
    if (this.favorites.has(id)) this.favorites.delete(id);
    else this.favorites.add(id);
    await this.data.putFocus('favorites', { ids: [...this.favorites] });
    // If the favorites playlist is active, its contents changed — rebuild it.
    if (this.musicColl.kind === 'favorites') this.playlist = await this.buildPlaylist();
    this.redrawMusicMenu?.();
    this.redrawSetupMusic?.();
  }

  /** The library tracks of the active collection (genre / artist / various / favorites). */
  private collectionTracks(): LibraryTrack[] {
    if (this.musicColl.kind === 'favorites') return this.favoriteTracks();
    if (this.musicColl.kind === 'playlist') return this.playlistTracks(this.musicColl.key);
    if (this.musicColl.kind === 'various') return minorArtistTracks();
    if (this.musicColl.kind === 'artist') return tracksForArtist(this.musicColl.key);
    return tracksForGenre(this.musicColl.key);
  }

  /** Display name of the active collection (e.g. "Classical Piano", "Chopin", "Favorites"). */
  private collLabel(): string {
    if (this.musicColl.kind === 'favorites') return 'Favorites';
    if (this.musicColl.kind === 'playlist') return this.customPlaylists.find((p) => p.id === this.musicColl.key)?.name ?? 'Playlist';
    if (this.musicColl.kind === 'various') return 'Various';
    if (this.musicColl.kind === 'artist') return this.musicColl.key;
    return MUSIC_GENRES.find((g) => g.id === this.musicColl.key)?.label ?? 'Music';
  }

  /** Is a session currently running in THIS tab (full overlay, widget, or PiP)? */
  private sessionLive(): boolean {
    return this.overlay !== null || this.widget !== null || this.pipWindow !== null;
  }

  /** SETUP-SIDE selection (browser single-click / song-window click): choose what
   *  the NEXT session plays. Never touches a live session — while one runs, the
   *  pick is parked in pendingSel and applied when the session ends. With no
   *  session it only updates draft state: no engine, and no persist() — persisting
   *  here wrote a phantom sessionActive record that a later boot mistook for a
   *  finished session. */
  private async selectDraftCollection(kind: MusicCollKind, key: string, startIndex = 0): Promise<void> {
    if (this.sessionLive()) {
      this.pendingSel = { kind, key, index: startIndex };
      this.redrawSetupMusic?.();
      return;
    }
    this.musicColl = { kind, key };
    this.playlist = await this.buildPlaylist();
    const idx = Math.max(0, Math.min(startIndex, this.playlist.length - 1));
    this.selectedMusic = this.playlist[idx]?.key ?? null;
    this.refreshMusicName();
    this.redrawSetupMusic?.();
  }

  /** IN-SESSION selection (the 🎵 menu): switch the LIVE playlist and keep playing.
   *  Only reachable from the running session's own UI. */
  private async selectCollection(kind: MusicCollKind, key: string, startIndex = 0): Promise<void> {
    this.musicColl = { kind, key };
    this.playlist = await this.buildPlaylist();
    const idx = Math.max(0, Math.min(startIndex, this.playlist.length - 1));
    this.selectedMusic = this.playlist[idx]?.key ?? null;
    if (this.engine) {
      // Session already running → switch the live playlist and keep playing.
      this.sessionMusic = this.selectedMusic;
      this.musicPlaying = true;
      void this.engine.setPlaylist(this.playlist, idx);
      this.engine.setVolume(this.musicVolume);
    }
    this.persist();
    this.refreshMusicName();
    this.redrawMusicMenu?.();
    this.syncMusicPlayIcon();
  }

  /** Jump to a track index within the CURRENT playlist (the in-session menu). */
  private playIndex(i: number): void {
    if (!this.engine) this.ensureMusic(i);
    else {
      this.musicPlaying = true;
      this.engine.jumpTo(i);
    }
    this.redrawMusicMenu?.();
    this.syncMusicPlayIcon();
  }

  /** A window (modal) listing every song in a collection. Clicking a song makes the
   *  collection active and starts at that song. (Double-click a row in the browser.) */
  private openSongWindow(kind: MusicCollKind, key: string): void {
    const tracksFor = (): LibraryTrack[] =>
      kind === 'favorites'
        ? this.favoriteTracks()
        : kind === 'playlist'
          ? this.playlistTracks(key)
          : kind === 'various'
            ? minorArtistTracks()
            : kind === 'artist'
              ? tracksForArtist(key)
              : tracksForGenre(key);
    const label =
      kind === 'favorites'
        ? 'Favorites'
        : kind === 'playlist'
          ? this.customPlaylists.find((p) => p.id === key)?.name ?? 'Playlist'
          : kind === 'various'
            ? 'Various'
            : kind === 'artist'
              ? key
              : MUSIC_GENRES.find((g) => g.id === key)?.label ?? key;

    const back = el('div', { class: 'focus-songwin-backdrop' });
    const win = el('div', { class: 'focus-songwin' });
    const close = (): void => back.remove();

    const head = el('div', { class: 'focus-songwin-head' });
    const titles = el('div', { class: 'focus-songwin-titles' });
    const sub = el('div', { class: 'focus-songwin-sub' });
    titles.append(el('div', { class: 'focus-songwin-title', text: label }), sub);
    const x = el('button', { class: 'focus-songwin-close', text: '✕', title: 'Close' });
    x.addEventListener('click', close);
    head.append(titles, x);
    win.append(head);

    const list = el('div', { class: 'focus-songwin-list' });
    win.append(list);

    const drawList = (): void => {
      const tracks = tracksFor();
      sub.textContent = `${tracks.length} song${tracks.length === 1 ? '' : 's'}`;
      list.replaceChildren();
      if (!tracks.length) {
        list.append(el('div', { class: 'focus-music-hint', text: 'No favorites yet. Tap a ♡ to add songs.' }));
        return;
      }
      tracks.forEach((lt, i) => {
        const row = el('div', { class: `focus-songwin-row${this.selectedMusic === lt.id ? ' active' : ''}` });
        row.append(
          el('span', { class: 'focus-songwin-emoji', text: lt.emoji }),
          el('span', { class: 'focus-songwin-name', text: lt.title }),
          el('span', { class: 'focus-songwin-artist', text: lt.authorsShort.join(', ') }),
          this.favHeart(lt.id, () => drawList())
        );
        row.addEventListener('click', () => {
          // Setup-origin window → DRAFT pick (starting at this song); a live
          // session keeps playing untouched.
          void this.selectDraftCollection(kind, key, i).then(() => this.redrawSetupMusic?.());
          close();
        });
        list.append(row);
      });
    };
    drawList();

    back.append(win);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    enterConfirms(back, () => null); // stacked-popup guard (see util/dom.ts)
    document.body.append(back);
  }

  /** A heart toggle button for a track. `onChange` runs after the favorite flips
   *  (e.g. to re-render a favorites list). Clicking it never triggers the row. */
  private favHeart(id: string, onChange?: () => void): HTMLElement {
    const on = this.favorites.has(id);
    const btn = el('button', { class: `focus-fav${on ? ' on' : ''}`, text: on ? '♥' : '♡', title: 'Favorite', 'aria-label': 'Favorite' });
    btn.addEventListener('click', (e) => {
      e.stopPropagation();
      void this.toggleFavorite(id).then(() => onChange?.());
    });
    return btn;
  }

  // --- setup screen -------------------------------------------------------

  private renderSetup(): void {
    if (!this.panel) return; // tab not mounted yet; it will render setup on open
    this.panel.replaceChildren();
    const wrap = el('div', { class: 'focus-setup' });

    // Duration — quick presets on top, an hours:minutes:seconds carousel below for
    // fine-tuning. The carousel is the source of truth; presets just scroll it.
    wrap.append(el('div', { class: 'focus-label', text: 'Session length' }));
    const presetRow = el('div', { class: 'focus-presets' });
    const lenErr = el('div', { class: 'focus-field-error' });
    const showSecs = getPrefs().focus.showSeconds; // "Show seconds" pref → seconds wheel

    const HOURS = Array.from({ length: 13 }, (_, i) => i); // 0–12 (the 12-hour cap)
    const MINUTES = Array.from({ length: 60 }, (_, i) => i); // 00–59
    const SECONDS = Array.from({ length: 60 }, (_, i) => i); // 00–59

    // Bump guard: never a 0-length session (00:00:00 → 00:00:05), and 12h is the hard
    // cap (any minutes/seconds past 12h roll back to 00). Both animate the wheels.
    let bumping = false;
    let bumpMin = 0;
    let bumpSec = 0;
    const syncFromCarousel = () => {
      const h = hoursWheel.value();
      let m = minsWheel.value();
      let s = showSecs ? secsWheel.value() : 0; // seconds ignored when the wheel is hidden
      if (!bumping) {
        let bump = false;
        if (h === 0 && m === 0 && s === 0) {
          // Minimum session: 5s when seconds show, else 1 minute.
          bumpMin = showSecs ? 0 : 1;
          bumpSec = showSecs ? 5 : 0;
          bump = true;
        } else if (h === 12 && (m !== 0 || s !== 0)) {
          bumpMin = 0;
          bumpSec = 0; // 12h cap
          bump = true;
        }
        if (bump) {
          bumping = true;
          minsWheel.animateTo(bumpMin);
          secsWheel.animateTo(bumpSec);
          window.setTimeout(() => (bumping = false), 480);
          m = bumpMin;
          s = bumpSec;
        }
      } else {
        m = bumpMin; // hold the corrected values while the bump animates
        s = bumpSec;
      }
      this.selectedSeconds = Math.min(MAX_FOCUS_SECONDS, h * 3600 + m * 60 + s);
      lenErr.textContent = '';
      // Each preset button carries its length in data-seconds (defaults AND custom
      // ones), so highlighting works regardless of how many presets exist.
      [...presetRow.children].forEach((btn) =>
        (btn as HTMLElement).classList.toggle(
          'active',
          Number((btn as HTMLElement).dataset.seconds) === this.selectedSeconds
        )
      );
    };

    const hoursWheel = makeWheel(HOURS, syncFromCarousel);
    const minsWheel = makeWheel(MINUTES, syncFromCarousel);
    const secsWheel = makeWheel(SECONDS, syncFromCarousel);

    const wheelCol = (label: string, wheel: HTMLElement) => {
      const col = el('div', { class: 'focus-wheel-col' });
      col.append(wheel, el('div', { class: 'focus-wheel-label', text: label }));
      return col;
    };
    const carousel = el('div', { class: 'focus-carousel' });
    const cols = [wheelCol('Hour', hoursWheel.wheel), wheelCol('Min', minsWheel.wheel)];
    if (showSecs) cols.push(wheelCol('Sec', secsWheel.wheel)); // hidden when "Show seconds" is off
    carousel.append(...cols, el('div', { class: 'focus-carousel-window' }));

    // Presets = the built-in defaults + the user's saved "+ Preset" lengths, merged
    // and sorted by duration so customs slot in where they belong (1h15m between 1h
    // and 1.5h, not tacked on the end). Clicking any of them spins the carousel there.
    const jumpTo = (seconds: number) => {
      hoursWheel.scrollTo(Math.floor(seconds / 3600));
      minsWheel.scrollTo(Math.floor((seconds % 3600) / 60));
      secsWheel.scrollTo(seconds % 60);
      syncFromCarousel();
    };
    const drawPresets = () => {
      presetRow.replaceChildren();
      const all = [
        ...PRESET_MINS.map((mins) => ({ label: presetLabel(mins * 60), seconds: mins * 60, key: '' })),
        ...this.customPresets.map((c) => ({ label: presetLabel(c.seconds), seconds: c.seconds, key: c.key })),
      ].sort((a, b) => a.seconds - b.seconds);
      for (const p of all) {
        const btn = el('button', { class: `focus-preset${p.key ? ' custom' : ''}`, text: p.label });
        btn.dataset.seconds = String(p.seconds);
        btn.addEventListener('click', () => jumpTo(p.seconds));
        if (p.key) {
          // User-made presets get a small × to remove them (defaults are permanent).
          const del = el('span', { class: 'focus-preset-del', text: '×', title: 'Remove preset' });
          del.addEventListener('click', (e) => {
            e.stopPropagation(); // removing must not also jump the carousel
            this.customPresets = this.customPresets.filter((c) => c.key !== p.key);
            void this.data.removeFocus(p.key);
            drawPresets();
          });
          btn.append(del);
        }
        if (p.seconds === this.selectedSeconds) btn.classList.add('active');
        presetRow.append(btn);
      }
    };
    drawPresets();

    // "+ Preset" (under the carousel): saves the currently-dialed time as a new
    // preset button above. If that exact time is already a preset, it's a no-op —
    // the existing button is already lit as active.
    const addPreset = el('button', { class: 'focus-add-preset', text: '+ Preset' });
    addPreset.addEventListener('click', async () => {
      const seconds = this.selectedSeconds;
      const exists =
        PRESET_MINS.some((mins) => mins * 60 === seconds) ||
        this.customPresets.some((c) => c.seconds === seconds);
      if (seconds < 1 || exists) return;
      const preset: CustomPreset = { key: 'preset_' + genId(), seconds };
      this.customPresets = [...this.customPresets, preset];
      await this.data.putFocus(preset.key, preset); // persists across reloads/devices
      drawPresets();
    });

    wrap.append(presetRow, carousel, addPreset, lenErr);
    // Stash the wheel initializer; it runs after the panel is appended (below), so
    // the wheels are already in the live DOM and scrollable — no 00:00 flash.
    this.initFocusWheels = () => {
      const apply = () => {
        const total = this.selectedSeconds;
        hoursWheel.scrollTo(Math.floor(total / 3600));
        minsWheel.scrollTo(Math.floor((total % 3600) / 60));
        secsWheel.scrollTo(total % 60);
      };
      // Position the wheels the moment they're actually visible & laid out — robust
      // to the async mount, when scrollHeight isn't ready for many frames.
      const io = new IntersectionObserver((entries) => {
        if (entries.some((e) => e.isIntersecting && e.boundingClientRect.height > 0)) {
          apply();
          io.disconnect();
        }
      });
      io.observe(hoursWheel.wheel);
      apply(); // best-effort immediate (no flash when already laid out)
    };

    // What will you work on? — assembled checklist + free-text add + task import.
    wrap.append(el('div', { class: 'focus-label', text: 'What are you working on?' }));

    // The assembled checklist for this session.
    const todoList = el('div', { class: 'focus-todo-list' });
    // The Import-Tasks dropdown is built below (shared with the active session);
    // declared here so removing a todo can refresh its imported-state marks.
    let importUI: { button: HTMLElement; panel: HTMLElement; refresh: () => void } | null = null;
    const drawTodos = () => {
      todoList.replaceChildren();
      const buildRow = (t: FocusTodo): HTMLElement => {
        const row = el('div', { class: 'focus-todo-row' });
        // Double-click the title or course to edit; "+ title" / "+ course" add when empty.
        row.append(this.buildTodoLabel(t, drawTodos));
        // 🗀 — group this todo into a FOCUS folder (independent of Tasks folders).
        const fold = el('button', { class: 'focus-todo-fold', title: 'Add to folder' });
        fold.innerHTML = FOCUS_FOLDER_BTN_SVG;
        const inFolder = this.taskFolders.find((f) => f.id === t.folderId);
        if (inFolder) fold.style.color = inFolder.color;
        fold.addEventListener('click', () => this.openFocusFolderPicker(t, this.taskFolders, drawTodos));
        // Takes it out of THIS session only. Every todo now has a real task behind
        // it, and dropping a task from a session is not the same as deleting it —
        // so the task itself is never touched here. Delete it in the Tasks tab.
        const del = el('button', { class: 'focus-todo-del', text: '✕', title: 'Remove from this session' });
        del.addEventListener('click', () => {
          this.todos.splice(this.todos.indexOf(t), 1);
          drawTodos();
          importUI?.refresh();
        });
        row.append(fold, del);
        return row;
      };
      const { blocks, loose } = this.groupTodosByFolder(this.todos, this.taskFolders);
      for (const { folder, members } of blocks) {
        const open = this.openFocusFolders.has(folder.id);
        const box = el('div', { class: `focus-folder${open ? ' open' : ''}`, 'data-folder-id': folder.id });
        const head = el('button', { class: 'focus-folder-head' });
        head.innerHTML = FOCUS_FOLDER_SVG(folder.color);
        const nameEl = el('span', { class: 'focus-folder-name', text: folder.name });
        // Renaming here renames the SHARED folder — it shows up in Tasks too.
        nameEl.addEventListener('dblclick', (e) => {
          e.stopPropagation();
          this.inlineTodoEdit(nameEl, folder.name, 'folder name', (v) => {
            if (!v) return;
            folder.name = v;
            void saveTaskFolders(this.data, this.taskFolders);
          }, drawTodos);
        });
        // Click the folder ICON to recolor — the identical hidden native color input
        // the Tasks tab uses: the glyph previews live while you drag, the pick saves
        // on close. Folders are shared, so the new color IS the color over there.
        const colorIn = this.folderColorInput(folder, head, drawTodos);
        head.append(
          nameEl,
          el('span', { class: 'focus-folder-count', text: `${members.filter((m) => m.done).length}/${members.length}` }),
          el('span', { class: 'focus-folder-arrow', text: '▶' }),
          colorIn
        );
        head.addEventListener('click', (e) => {
          if (head.querySelector('.inline-edit-block')) return; // rename in progress → head inert
          const t = e.target as HTMLElement;
          if (t.closest('.focus-folder-name')) return;
          if (t.closest('.focus-folder-ico')) {
            colorIn.click(); // the icon IS the color well (same gesture as Tasks)
            return;
          }
          if (open) this.openFocusFolders.delete(folder.id);
          else this.openFocusFolders.add(folder.id);
          drawTodos();
        });
        // ONE meaning for ✕ on this screen (per Gabe): take it out of THIS session.
        // Same icon, same promise — on a folder that's the whole folder and every
        // task in it, and nothing more. It does NOT unfile the tasks (the 🗀 picker's
        // "Remove from folder" does that) and it does NOT delete the shared folder,
        // which may hold tasks that were never imported here. Both survive untouched
        // in the Tasks tab; only this session forgets them.
        const kill = el('button', { class: 'focus-todo-del', text: '✕', title: 'Remove from this session' });
        kill.addEventListener('click', (e) => {
          e.stopPropagation();
          for (const m of members) {
            const i = this.todos.indexOf(m);
            if (i >= 0) this.todos.splice(i, 1);
          }
          drawTodos();
          importUI?.refresh(); // those tasks are importable again — re-mark the list
        });
        const headWrap = el('div', { class: 'focus-folder-headrow' });
        headWrap.append(head, kill);
        box.append(headWrap);
        if (open) {
          const body = el('div', { class: 'focus-folder-body' });
          for (const m of members) body.append(buildRow(m));
          box.append(body);
        }
        todoList.append(box);
      }
      for (const t of loose) todoList.append(buildRow(t));
    };
    this.redrawTodos = drawTodos; // so external task edits can refresh this list

    // Free-text add: text input + gold "+".
    const addRow = el('div', { class: 'focus-add-todo' });
    const todoInput = textInput({
      class: 'focus-todo-input',
      placeholder: 'Add a task…',
    });
    const addTodoBtn = el('button', { class: 'focus-add-btn', text: '+', title: 'Add task' });
    const addFreeText = () => {
      const v = todoInput.value.trim();
      if (!v) return;
      // Creates the real Tasks-tab task too — see addTypedTodo.
      this.addTypedTodo(this.todos, v);
      todoInput.value = '';
      todoInput.focus();
      drawTodos();
    };
    todoInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addFreeText();
    });
    addTodoBtn.addEventListener('click', addFreeText);
    addRow.append(todoInput, addTodoBtn);

    // Import Tasks — reusable dropdown (shared with the active session screen).
    importUI = this.buildImportUI(() => this.todos, drawTodos);
    // Assembled tasks sit ABOVE the import controls, so it's clear what's already
    // in the session vs. what can still be imported below.
    wrap.append(addRow, todoList, importUI.button, importUI.panel);

    // Music
    wrap.append(el('div', { class: 'focus-label', text: 'Focus music' }));
    const musicList = el('div', { class: 'focus-music-list' });
    const drawMusic = () => {
      musicList.replaceChildren();
      const subhead = (text: string) => el('div', { class: 'focus-music-subhead', text });

      // A selectable collection (genre or artist): single-click selects it as the
      // session playlist; double-click opens the song window listing every track.
      const collRow = (kind: MusicCollKind, key: string, emoji: string, name: string, tracks: LibraryTrack[]) => {
        // Highlight the DRAFT selection: a mid-session pick parked in pendingSel
        // wins over the (live) musicColl, so the setup list always shows what the
        // NEXT session will play.
        const sel = this.pendingSel ?? this.musicColl;
        const active = sel.kind === kind && sel.key === key && (this.pendingSel !== null || this.selectedMusic !== null);
        const b = el('button', { class: `focus-music-coll${active ? ' active' : ''}`, title: 'Click to select · double-click to see songs' });
        const len = fmtPlaylistLen(totalSeconds(tracks));
        b.append(
          el('span', { class: 'focus-music-opt-emoji', text: emoji }),
          el('span', { class: 'focus-music-coll-name', text: name }),
          el('span', { class: 'focus-music-genre-count', text: `${tracks.length}${len ? ` · ${len}` : ''}` })
        );
        b.addEventListener('click', () => void this.selectDraftCollection(kind, key).then(drawMusic));
        b.addEventListener('dblclick', () => this.openSongWindow(kind, key));
        return b;
      };

      // None
      const noneRow = el('button', { class: `focus-music-opt${this.selectedMusic === null && !this.pendingSel ? ' active' : ''}` });
      noneRow.append(el('span', { class: 'focus-music-opt-emoji', text: '🔇' }), el('span', { class: 'focus-music-opt-label', text: 'None' }));
      noneRow.addEventListener('click', () => {
        this.pendingSel = null; // draft-only: also discards any parked mid-session pick
        this.selectedMusic = null;
        drawMusic();
      });
      musicList.append(noneRow);

      // Favorites (built by tapping hearts in a song window / the in-session menu)
      musicList.append(subhead('Favorites'));
      musicList.append(collRow('favorites', 'favorites', '❤️', 'Favorites', this.favoriteTracks()));

      // Genres (most songs first, then longest run time)
      musicList.append(subhead('Genres'));
      for (const { item: g, tracks } of sortCollections([...MUSIC_GENRES], (g) => tracksForGenre(g.id))) {
        musicList.append(collRow('genre', g.id, g.emoji, g.label, tracks));
      }

      // Artists — a row each for artists with 4+ songs; everyone with ≤3 is pooled
      // into a single "Various" collection so the list stays tidy.
      musicList.append(subhead('Artists'));
      for (const { item: a, tracks } of sortCollections(majorArtists(), (a) => tracksForArtist(a.name)))
        musicList.append(collRow('artist', a.name, '🎼', a.name, tracks));
      if (hasMinorArtists()) musicList.append(collRow('various', 'various', '🎭', 'Various', minorArtistTracks()));

      // Custom — user-made playlists, built in Settings from library tracks.
      // (Pasted-URL tracks used to be listed here too; the box that created them
      // is gone, so the rows are gone with it. Library only.)
      musicList.append(subhead('Custom'));
      for (const pl of this.customPlaylists) musicList.append(collRow('playlist', pl.id, playlistEmoji(pl), pl.name, this.playlistTracks(pl.id)));
      if (!this.customPlaylists.length) {
        musicList.append(el('div', { class: 'focus-music-hint', text: 'Create custom playlists in settings.' }));
      }
    };
    drawMusic();
    this.redrawSetupMusic = drawMusic; // the song window refreshes this after a pick

    // NO "add audio file URL" box (Gabe, 8/8): the built-in library is the only
    // source of focus music. The pasted-URL track rows in drawMusic went with it,
    // since that box was the only way to create one. Custom PLAYLISTS (built in
    // Settings from library tracks) are unaffected and still listed above.
    //
    // Resizable: the library is 150+ tracks in a 320px window by default — drag
    // the bottom edge down for a proper browsing view. (No fitTo: this list is in
    // normal page flow, so it simply extends the page downward.)
    wrap.append(musicList, makeResizeGrip({ body: musicList, storageKey: 'focus:musicListHeight' }).el);

    // Start. When a session is already running, this screen is inert — you can't
    // start a second one (matches the guard in startSession).
    const start = el('button', { class: 'btn-primary focus-start', text: 'Start focus session' });
    if (this.overlay || this.widget) {
      start.disabled = true;
      start.textContent = 'Session in progress';
      wrap.append(
        start,
        el('div', { class: 'focus-field-error', text: 'A focus session is already running. End it to start a new one.' })
      );
    } else {
      start.addEventListener('click', () => {
        if (this.selectedSeconds < 1) {
          lenErr.textContent = 'Pick a session length.';
          return;
        }
        if (!this.todos.length) {
          todoInput.classList.add('invalid');
          setTimeout(() => todoInput.classList.remove('invalid'), 900);
          return;
        }
        this.startSession();
      });
      wrap.append(start);
    }

    drawTodos();
    this.panel.append(wrap);
    this.initFocusWheels?.(); // carousel is now in the DOM → position it without a flash
  }

  // --- reusable Import-Tasks dropdown -------------------------------------
  //
  // Builds the "Import Tasks" toggle button + its dropdown panel (search, bulk
  // import by course, individual tasks, inline task editing). Used both on the
  // setup screen and inside the active session overlay. `redraw` is the caller's
  // todo-list renderer, invoked whenever the session todos change.
  // --- focus folders (independent from Tasks-tab folders) ------------------

  /** Split a todo list into folder blocks + the loose remainder. Todos pointing
   *  at a deleted focus folder fall back to loose. */
  private groupTodosByFolder(
    todos: FocusTodo[],
    folders: TaskFolder[]
  ): { blocks: { folder: TaskFolder; members: FocusTodo[] }[]; loose: FocusTodo[] } {
    // Only folders that actually hold something in THIS session get a block —
    // the shared list also contains folders whose tasks were never imported.
    // (This replaces the old empty-folder sweep: focus must never delete a
    // shared folder, since its tasks can live entirely outside the session.)
    const blocks = folders
      .map((folder) => ({ folder, members: todos.filter((t) => t.folderId === folder.id) }))
      .filter((b) => b.members.length > 0);
    const shown = new Set(blocks.map((b) => b.folder.id));
    const loose = todos.filter((t) => !t.folderId || !shown.has(t.folderId));
    return { blocks, loose };
  }

  /** Re-read the shared folder list (profile) into the view. */
  private async refreshFolders(): Promise<void> {
    this.taskFolders = await getTaskFolders(this.data);
  }

  /** The folder icon's hidden color well, shared by both Focus folder headers and
   *  copied from the Tasks tab so the gesture is the same in both places: click the
   *  glyph, the OS picker opens, the glyph previews as you drag, the pick saves on
   *  close. The folder list is shared, so recoloring here recolors it in Tasks —
   *  and every row's 🗀 tint follows on the next draw. */
  private folderColorInput(folder: TaskFolder, head: HTMLElement, redraw: () => void): HTMLInputElement {
    const colorIn = el('input', {
      type: 'color',
      class: 'focus-folder-colorin',
      // A folder made before colors (or with junk stored) opens on gold, not on an
      // invalid value the native picker would silently turn black.
      value: /^#[0-9a-f]{6}$/i.test(folder.color) ? folder.color : '#e6a817',
      title: 'Folder color',
    });
    colorIn.addEventListener('click', (e) => e.stopPropagation()); // never toggle the block open/closed
    colorIn.addEventListener('input', () => {
      folder.color = colorIn.value;
      head.querySelector('.focus-folder-ico')?.setAttribute('fill', colorIn.value);
    });
    colorIn.addEventListener('change', () => {
      void saveTaskFolders(this.data, this.taskFolders); // fires FOLDERS_EVENT → Tasks re-reads
      redraw();
    });
    return colorIn;
  }

  /**
   * Add a task typed into a Focus box — and create the REAL task behind it.
   *
   * Focus and Tasks are ONE list (per Gabe): a task added in either place exists
   * in both from the moment it's typed. So this doesn't wait for the todo to be
   * filed in a folder (the old promote-on-file rule) — the task is written right
   * away, which means it outlives the session and can be dated, filed, or
   * completed from either side, and completing it here checks it off there
   * (syncLinkedTask). Course parse words still apply ("write essay mon").
   *
   * Synchronous on purpose: Data.putTask updates its cache and notifies BEFORE
   * the network settles, so the caller can push, redraw, and move on.
   */
  private addTypedTodo(list: FocusTodo[], raw: string): void {
    const { text, course } = parseFocusInput(raw);
    if (!text) return;
    // Only title + course: the Focus box has no date/priority grammar, so the new
    // task lands under "No due date" in Tasks. Its row here shows the dashed
    // "+ due date" pill, so it can be scheduled from Focus without switching tabs.
    const task = makeTask({
      title: text,
      dueDate: '',
      dueTime: '',
      timeLabel: '',
      course,
      priority: 'normal',
    });
    list.push({ id: 'ft_' + genId(), text, done: false, course, taskId: task.id });
    void this.data.putTask(task);
  }

  /** File a focus todo into a shared folder — and make that true in Tasks too.
   *  Normally the todo already has a task behind it (addTypedTodo creates one the
   *  moment you type it), so this just updates that task. The unlinked case is the
   *  legacy fallback below. Pass null to unfile. */
  private async fileTodoInFolder(todo: FocusTodo, folderId: string | null): Promise<void> {
    if (folderId) todo.folderId = folderId;
    else delete todo.folderId;

    if (todo.taskId) {
      const src = this.data.getTasks()[todo.taskId];
      if (src) {
        const next = { ...src };
        if (folderId) next.folderId = folderId;
        else delete next.folderId; // delete, not undefined — Firebase rejects undefined
        await this.data.putTask(next);
      }
      return;
    }
    if (!folderId) return; // unlinked todo leaving a folder: nothing in Tasks to update
    // FALLBACK for todos with no task behind them: sessions saved before Focus
    // started creating tasks on add (addTypedTodo) restore with taskId missing.
    // Promote on file, exactly as before, so their folder membership is real.
    const task = makeTask({
      title: todo.text,
      dueDate: '',
      dueTime: '',
      timeLabel: '',
      course: todo.course || '',
      priority: 'normal',
    });
    task.folderId = folderId;
    todo.taskId = task.id; // links it three ways from now on
    await this.data.putTask(task);
  }

  // NOTE: focus no longer sweeps "empty" folders. Folders are shared with the
  // Tasks tab now, and a folder with no members in THIS session can still hold
  // plenty of tasks — deleting it here would destroy them. Blocks simply stop
  // rendering when the session has nothing in them (see groupTodosByFolder), and
  // genuinely empty folders are dissolved by the Tasks tab's folderMaintenance.

  /** The 🗀 on a focus todo row: join/leave a folder, or create one — all against
   *  the SHARED folder list, so every action here lands in the Tasks tab too. */
  private openFocusFolderPicker(todo: FocusTodo, folders: TaskFolder[], redraw: () => void): void {
    const back = el('div', { class: 'focus-modal-back' });
    const card = el('div', { class: 'focus-modal' });
    card.append(el('div', { class: 'focus-modal-title', text: 'Add to folder' }));
    const wrap = el('div', { class: 'folder-pick' });
    const close = () => back.remove();
    for (const f of folders) {
      const b = el('button', { class: `folder-pick-row${todo.folderId === f.id ? ' on' : ''}` });
      b.innerHTML = FOCUS_FOLDER_SVG(f.color);
      b.append(el('span', { text: f.name }));
      b.addEventListener('click', () => {
        this.openFocusFolders.add(f.id);
        void this.fileTodoInFolder(todo, f.id).then(redraw);
        close();
      });
      wrap.append(b);
    }
    if (todo.folderId) {
      const rm = el('button', { class: 'folder-pick-remove', text: 'Remove from folder' });
      rm.addEventListener('click', () => {
        void this.fileTodoInFolder(todo, null).then(redraw);
        close();
      });
      wrap.append(rm);
    }
    // "+ New folder" row: color well (defaults to the todo's course color, freely
    // editable) + name box — the same creation flow as the Tasks tab's picker,
    // and it creates a REAL shared folder.
    const courseColor = todo.course ? getCourseColor(todo.course) : '#e6a817';
    const colorIn = el('input', {
      type: 'color',
      class: 'folder-pick-color',
      value: /^#[0-9a-f]{6}$/i.test(courseColor) ? courseColor : '#e6a817',
      title: 'Folder color',
    });
    const input = textInput({ class: 'folder-pick-input', placeholder: '+ New folder…' });
    input.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const name = input.value.trim();
      if (!name) return;
      const folder = makeFolder(name, colorIn.value);
      this.taskFolders.push(folder);
      this.openFocusFolders.add(folder.id);
      close();
      void saveTaskFolders(this.data, this.taskFolders)
        .then(() => this.fileTodoInFolder(todo, folder.id))
        .then(redraw);
    });
    const newRow = el('div', { class: 'folder-pick-new' });
    newRow.append(colorIn, input);
    wrap.append(newRow);
    card.append(wrap);
    back.append(card);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    enterConfirms(back, () => null); // stacked-popup guard (see util/dom.ts)
    document.body.append(back);
  }

  private buildImportUI(
    getTodos: () => FocusTodo[],
    redraw: () => void,
    /** Which way this copy of the panel actually grows — see the grip below. The
     *  setup screen scrolls, so its panel opens DOWNWARD; the session's is pinned
     *  inside a height-capped card, so it can only open UPWARD. */
    grows: 'down' | 'up' = 'down'
  ): {
    button: HTMLElement;
    panel: HTMLElement;
    refresh: () => void;
  } {
    const importBtn = el('button', { class: 'focus-import', text: 'Import Tasks' });
    const importPanel = el('div', { class: 'focus-import-panel' });
    // A plain single-line <input> — NOT the wrapping textInput()/textarea. A native
    // input centers its text vertically at the browser level, so it can't render
    // off-center the way a fixed-height textarea can. A search filter is short and
    // ephemeral, so wrapping isn't needed here. .focus-import-search mirrors the
    // "Add a task…" box's look exactly (same padding/border/colors).
    const importSearchInput = el('input', {
      type: 'text',
      class: 'focus-import-search',
      placeholder: 'Search tasks…',
      autocomplete: 'off',
    });
    const importBody = el('div', { class: 'focus-import-body' });

    // RESIZABLE (see util/resize.ts). The grip goes on whichever edge MOVES, and
    // that differs between the two copies of this panel:
    //  • setup screen (grows: 'down') — the screen scrolls, so the panel opens
    //    downward like any dropdown. Grip at the BOTTOM, drag DOWN to grow.
    //  • running session (grows: 'up') — the panel is the last thing in a
    //    height-capped card, so its bottom is pinned: the card fills to its cap and
    //    then the tasks list above yields, i.e. it opens UPWARD. Grip at the TOP,
    //    drag UP to grow. A bottom grip there would sit still while the panel grew.
    const up = grows === 'up';
    const importGrip = makeResizeGrip({
      body: importBody,
      storageKey: 'focus:importHeight',
      fitTo: '.focus-task-panel', // only matches in-session (the setup panel has no such card)
      edge: up ? 'top' : 'bottom',
    });
    importBtn.addEventListener('click', importGrip.refit); // a closed panel can't be measured
    importPanel.append(
      ...(up
        ? [importGrip.el, importSearchInput, importBody] // grip FIRST = top edge
        : [importSearchInput, importBody, importGrip.el]) // grip LAST = bottom edge
    );

    // The open-task snapshot lives on the instance (this.importTasks) and is kept
    // fresh by onTasksUpdate, so Tasks-tab edits show here without reopening.

    const importedTaskIds = () =>
      new Set(getTodos().map((t) => t.taskId).filter(Boolean) as string[]);

    // A task ALWAYS arrives in the folder it lives in over in Tasks — folders are
    // shared, so the same id means the same folder (per Gabe: in a folder there =
    // in that folder here). This holds no matter how it came in: one row, a whole
    // course, or the folder itself. The block is auto-opened so the task lands
    // somewhere visible instead of inside a collapsed folder.
    const addTaskToTodos = (t: Task) => {
      if (t.folderId) this.openFocusFolders.add(t.folderId);
      getTodos().push({
        id: 'ft_' + genId(),
        text: t.title,
        done: false,
        taskId: t.id, // ← the link back to the source task
        course: t.course || '',
        dueDate: t.dueDate || '',
        dueTime: t.dueTime || '',
        schoologyUrl: t.schoologyUrl || '',
        translatedTitle: t.translatedTitle || '',
        translatedLang: t.translatedLang || '',
        ...(t.folderId ? { folderId: t.folderId } : {}),
      });
    };

    const buildTaskRow = (t: Task, already: boolean): HTMLElement => {
      const row = el('div', { class: `focus-import-task${already ? ' imported' : ''}` });
      const main = el('div', { class: 'focus-import-task-main' });

      // Title — double-click to edit (no pen button; editing is double-click only).
      // Both editors here honor the Settings ▸ Tasks edit lock (taskEditUnlocked).
      const titleEl = el('span', { class: 'focus-import-title', text: t.title });
      titleEl.addEventListener('dblclick', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(titleEl, t.title, 'task title', (v) => void this.applyTaskEdit(t.id, { title: v }), drawImportBody);
      });
      main.append(titleEl);

      // Course + due date, the same meta line the Tasks tab shows (priority stays
      // out: it has no chip there either, it only sorts). The date matters here
      // because it is what the ordering below is built on, and a list sorted by a
      // field you can't see reads as randomly ordered.
      const tags = el('div', { class: 'focus-import-tags' });
      const editCourse = (host: HTMLElement, initial: string) => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(
          host,
          initial,
          'course',
          (v) => void this.applyTaskEdit(t.id, { course: v ? matchCourseStrict(v) : '' }),
          drawImportBody
        );
      };
      if (t.course) {
        const chip = el('span', { class: 'course-chip', text: t.course });
        chip.style.color = getCourseColor(t.course);
        chip.addEventListener('dblclick', () => editCourse(chip, t.course));
        tags.append(chip);
      } else {
        const chip = el('span', { class: 'course-chip empty', text: '+ course' });
        chip.addEventListener('click', () => editCourse(chip, ''));
        tags.append(chip);
      }

      // Due date — same classes and same formatter as the Tasks tab, so the two
      // lists read identically. Editable like the title and course above (all
      // three go through applyTaskEdit, which writes the SOURCE task, so a fix
      // made here shows up in Tasks too).
      const editDate = (host: HTMLElement, initial: string) => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(
          host,
          initial,
          'due date',
          (v) => {
            const { date, time } = parseDateTime(v);
            void this.applyTaskEdit(t.id, { dueDate: date, dueTime: time });
          },
          drawImportBody
        );
      };
      tags.append(el('span', { class: 'meta-dot', text: '·' }));
      if (t.dueDate || t.dueTime) {
        const when = [t.dueDate ? formatMetaDate(t.dueDate) : '', t.dueTime ? formatTimeOfDay(t.dueTime) : '']
          .filter(Boolean)
          .join(' ');
        const dateEl = el('span', { class: 'meta-date', text: when });
        dateEl.addEventListener('dblclick', () => editDate(dateEl, when));
        tags.append(dateEl);
      } else {
        // Undated tasks sort LAST, so this row is also the explanation for why
        // they're at the bottom. One click to fix it, same as "+ course".
        const dateEl = el('span', { class: 'meta-date empty', text: '+ due date' });
        dateEl.addEventListener('click', () => editDate(dateEl, ''));
        tags.append(dateEl);
      }
      main.append(tags);
      row.append(main);

      const add = el('button', {
        class: `focus-import-add${already ? ' done' : ''}`,
        text: already ? '✓' : '+',
        title: already ? 'Imported' : 'Import',
      });
      if (!already) {
        add.addEventListener('click', () => {
          addTaskToTodos(t);
          redraw();
          drawImportBody();
        });
      }
      row.append(add);
      return row;
    };

    const drawImportBody = () => {
      importBody.replaceChildren();
      const q = importSearchInput.value.trim().toLowerCase();
      const filtered = this.importTasks.filter(
        (t) => !q || t.title.toLowerCase().includes(q) || t.course.toLowerCase().includes(q)
      );
      if (!filtered.length) {
        importBody.append(
          el('div', {
            class: 'focus-import-empty',
            text: q ? 'No matching tasks.' : 'No active tasks to import.',
          })
        );
        return;
      }

      const imported = importedTaskIds();

      // FOLDERS — bring a whole folder's un-imported tasks into the session.
      {
        const folderRows = this.taskFolders
          .map((tf) => ({
            tf,
            members: filtered.filter((t) => t.folderId === tf.id && !imported.has(t.id)),
          }))
          .filter((x) => x.members.length);
        if (folderRows.length) {
          importBody.append(el('div', { class: 'focus-import-section gold', text: 'Folders' }));
          for (const { tf, members } of folderRows) {
            const row = el('div', { class: 'focus-import-bulk' });
            const label = el('div', { class: 'focus-import-bulk-label' });
            label.innerHTML = FOCUS_FOLDER_SVG(tf.color);
            label.append(el('span', { text: ' ' + tf.name }));
            row.append(label, el('span', { class: 'focus-import-count', text: String(members.length) }));
            const add = el('button', { class: 'focus-import-add', text: '+', title: `Import the ${tf.name} folder` });
            add.addEventListener('click', () => {
              // Nothing folder-specific to do here any more: every member already
              // carries this folder's id, and addTaskToTodos honors it.
              for (const t of members) addTaskToTodos(t);
              redraw();
              drawImportBody();
            });
            row.append(add);
            importBody.append(row);
          }
        }
      }

      // BULK IMPORT — group not-yet-imported tasks by course, one row each.
      const byCourse = new Map<string, Task[]>();
      for (const t of filtered) {
        if (!t.course || imported.has(t.id)) continue;
        (byCourse.get(t.course) ?? byCourse.set(t.course, []).get(t.course)!).push(t);
      }
      if (byCourse.size) {
        importBody.append(el('div', { class: 'focus-import-section gold', text: 'Bulk import' }));
        for (const [course, list] of [...byCourse.entries()].sort((a, b) => a[0].localeCompare(b[0]))) {
          const row = el('div', { class: 'focus-import-bulk' });
          const label = el('div', { class: 'focus-import-bulk-label' });
          const cspan = el('span', { class: 'focus-import-course', text: course });
          cspan.style.color = getCourseColor(course);
          label.append(el('span', { text: 'All ' }), cspan, el('span', { text: ' tasks' }));
          row.append(label, el('span', { class: 'focus-import-count', text: String(list.length) }));
          const add = el('button', { class: 'focus-import-add', text: '+', title: `Import all ${course} tasks` });
          add.addEventListener('click', () => {
            for (const t of list) addTaskToTodos(t);
            redraw();
            drawImportBody();
          });
          row.append(add);
          importBody.append(row);
        }
      }

      // INDIVIDUAL TASKS — ordered soonest-due first, then by priority (undated last),
      // the exact ordering the Tasks tab uses. Neither the date nor the priority is
      // shown here; they only influence the order.
      importBody.append(el('div', { class: 'focus-import-section', text: 'Individual tasks' }));
      // manualFirst: this list has no day headers, so a ⋮⋮ arrangement made in
      // Tasks is honored across dates here rather than only within one. See
      // sortTasks in tasks/store.ts.
      const sorted = sortTasks(filtered, { manualFirst: true });
      for (const t of sorted) importBody.append(buildTaskRow(t, imported.has(t.id)));
    };

    importSearchInput.addEventListener('input', () => drawImportBody());
    importBtn.addEventListener('click', async () => {
      const willOpen = !importPanel.classList.contains('open');
      importPanel.classList.toggle('open', willOpen);
      importBtn.classList.toggle('active', willOpen);
      if (willOpen) {
        this.importTasks = Object.values(await this.data.getTasksAll()).filter((t) => !t.completed);
        this.taskFolders = await getTaskFolders(this.data); // fresh folder list for the Folders section
        drawImportBody();
      }
    });

    // Let onTasksUpdate refresh this (the active) import list when a task changes.
    this.refreshImportBody = drawImportBody;
    return { button: importBtn, panel: importPanel, refresh: drawImportBody };
  }

  // --- session lifecycle --------------------------------------------------

  private startSession(): void {
    if (this.overlay || this.widget) return; // a session is already active — never start a second
    armAudioContext();
    this.requestNotifications();
    void this.loadEndSound(); // pick up any change made in Settings before this session ends
    this.originalTitle = document.title;
    // Hand the assembled setup (tasks + folders + chosen track) to the session…
    this.sessionTodos = this.todos;
    // Folders aren't snapshotted any more — they're the shared Tasks-tab list.
    this.sessionMusic = this.selectedMusic;
    this.totalSeconds = this.selectedSeconds;
    this.endTimeMs = Date.now() + this.totalSeconds * 1000;
    this.paused = false;
    this.pausedRemainingSec = null;
    this.quote = QUOTES[Math.floor(Math.random() * QUOTES.length)];
    this.buildOverlay();
    this.startTicker();
    if (getPrefs().focus.autoStartMusic) this.startMusic();
    void this.acquireWakeLock();
    this.persist();
    // …then reset the "start focus" screen for next time — empty tasks, default length
    // + music. The running session keeps its own snapshot above, untouched.
    this.todos = [];
    this.selectedSeconds = 60 * 60;
    this.selectedMusic = tracksForGenre(MUSIC_GENRES[0].id)[0]?.id ?? null;
    this.renderSetup();
  }

  private restore(s: FocusState): void {
    this.originalTitle = document.title;
    this.sessionTodos = s.todos;
    // s.folders is ignored (legacy): folders now live in the shared profile list.
    this.totalSeconds = s.totalSeconds;
    this.endTimeMs = s.endTimeMs;
    this.quote = s.quote;
    this.sessionMusic = s.selectedMusic;
    this.musicVolume = s.musicVolume ?? 50;
    if (s.musicColl) this.musicColl = { ...s.musicColl }; // resume the exact collection

    const remaining = s.paused
      ? s.pausedRemainingSec ?? 0
      : Math.round((this.endTimeMs - Date.now()) / 1000);
    if (remaining <= 0) {
      clearFocusState();
      this.renderSetup();
      return;
    }
    // EVERY restore — mid-session reload, sign-out Restore, tab adoption, end-undo —
    // lands PAUSED, session and music both. Nothing runs or sounds until the user
    // presses Resume; togglePause then brings the clock AND the music back together.
    this.paused = true;
    this.pausedRemainingSec = remaining;
    // Arm the pause→resume music linkage exactly as a live Pause would have: the
    // track returns with the session iff it was audible when the session was last
    // live (older saved states without the flag: any selected track counts).
    this.musicPlayingAtPause = s.musicWasPlaying ?? !!s.selectedMusic;
    armAudioContext();
    this.buildOverlay();
    this.updateDisplay(remaining);
    document.title = '⏸ PAUSED · Focus';
    void this.resumeMusicForRestore(s.musicIndex);
    void this.acquireWakeLock();
  }

  /** Which genre a library track id belongs to (ids are "<genreId>-NN"). */
  private genreForKey(key: string | null): string | null {
    if (!key) return null;
    return MUSIC_GENRES.find((g) => key.startsWith(g.id + '-'))?.id ?? null;
  }

  /** Resume a restored session's music in the SAME collection it was playing from
   *  (restore() already put the saved musicColl back). Only when the saved track isn't
   *  in that collection anymore — a deleted playlist, an un-favorited track, or a
   *  pre-musicColl saved state — fall back to the track's genre so music still resumes. */
  private async resumeMusicForRestore(musicIndex: number): Promise<void> {
    this.playlist = await this.buildPlaylist();
    if (this.sessionMusic && !this.playlist.some((t) => t.key === this.sessionMusic)) {
      const g = this.genreForKey(this.sessionMusic);
      if (g) {
        this.musicColl = { kind: 'genre', key: g };
        this.playlist = await this.buildPlaylist();
      }
    }
    // Restores land paused (see restore()), so this wires the engine silently: same
    // track, same queue position, working transport — no sound. Read `paused` LIVE
    // rather than assuming: the end-undo flow (retrieveSession resumeRunning) calls
    // togglePause synchronously after restore(), before this async step lands — in
    // that case the session is already running again and music should start.
    this.startMusic(musicIndex, !this.paused);
    // Re-persist now that the engine knows the queue position: storage must reflect
    // the forced pause (frozen remaining) or a second reload would shrink the clock.
    this.persist();
  }

  private currentRemaining(): number {
    if (this.paused) return this.pausedRemainingSec ?? 0;
    return Math.max(0, Math.round((this.endTimeMs - Date.now()) / 1000));
  }

  /** Stop the ticker in WHICHEVER window owns it (a pip-owned interval id means
   *  nothing to the main window's clearInterval, and vice versa). */
  private stopTicker(): void {
    if (this.interval !== null) {
      try {
        this.tickerWin.clearInterval(this.interval);
      } catch {
        /* owning window already closed — its timers died with it */
      }
    }
    this.interval = null;
  }

  private startTicker(): void {
    this.stopTicker();
    // Run the clock in the PiP window while the mini player is detached: the main
    // tab is hidden then, and Chrome throttles hidden tabs' timers (down to once a
    // MINUTE after a few minutes) — the mini's clock would freeze, then lurch, which
    // reads as "pause/timer is broken". The PiP window is visible → never throttled.
    this.tickerWin = this.pipWindow ?? window;
    this.interval = this.tickerWin.setInterval(() => {
      const remaining = this.currentRemaining();
      if (remaining <= 0) {
        this.endSession(true);
        return;
      }
      this.updateDisplay(remaining);
      this.persist();
    }, 500);
    this.updateDisplay(this.currentRemaining());
  }

  /** Drop this tab's copy of the session UI — clock, music, overlay, widget — WITHOUT
   *  touching the persisted state. Used by sign-out (which suspends the state first)
   *  and by the cross-tab handoff (another tab adopted the session). */
  private suspendUI(): void {
    this.stopTicker();
    this.stopRing();
    document.title = this.originalTitle || 'WorkSpace';
    this.engine?.destroy(); // kills the music immediately
    this.engine = null;
    this.overlay?.remove();
    this.overlay = null;
    this.ringEl = null;
    this.ringWrap = null;
    this.timeText = null;
    this.pauseBtn = null;
    this.musicNameEl = null;
    this.musicPlayBtn = null;
    this.redrawMusicMenu = null;
    this.disarmMusicResume();
    this.closePip();
    this.widget?.remove(); // the minimized floating tab
    this.widget = null;
    this.sessionTodos = [];
    this.redrawSessionTodos = null;
  }

  /** Silent teardown for SIGN-OUT: freeze the session (paused, `suspended`) in
   *  storage — the next sign-in shows a "Restore focus session?" toast instead of
   *  auto-restoring — then drop the UI. Unlike endSession: no sound, no toast. */
  teardown(): void {
    const hadSession = !!(this.overlay || this.widget);
    if (hadSession) {
      this.pausedRemainingSec = this.currentRemaining();
      this.paused = true;
      this.persist(true); // suspended: true → blocks any auto-restore
    }
    this.releaseWakeLock();
    this.suspendUI();
    window.removeEventListener('storage', this.onStorage);
    document.getElementById('focus-session-toast')?.remove();
  }

  /** Cross-tab coordination via the localStorage 'storage' event (fires in every
   *  tab EXCEPT the one that wrote — perfect for ownership handoffs). */
  private onStorage = (e: StorageEvent): void => {
    // Compare against THIS ACCOUNT's key: focus state is uid-scoped, so another
    // signed-in account's session in another tab must not steer this one.
    if (e.key !== focusStateKey()) return;
    let s: FocusState | null = null;
    try {
      s = e.newValue ? (JSON.parse(e.newValue) as FocusState) : null;
    } catch {
      return;
    }
    const runningHere = !!(this.overlay || this.widget);
    if (runningHere) {
      // Another tab adopted our session (or it was cleared elsewhere): drop our copy
      // quietly — one session, one tab — and become a signpost instead.
      if (!s?.sessionActive || (s.ownerTab && s.ownerTab !== getTabId())) {
        this.suspendUI();
        if (s?.sessionActive) this.showSessionToast('enter');
      }
      return;
    }
    // Not running here: keep the "Enter focus session" signpost in sync. (The owner
    // persists every tick, so guard against rebuilding the toast on every event.)
    const toast = document.getElementById('focus-session-toast');
    if (s?.sessionActive && !s.suspended && !ownsSession(s)) {
      if (!toast) this.showSessionToast('enter');
    } else if (toast && toast.dataset.kind === 'enter') {
      toast.remove();
    }
  };

  private endSession(completed: boolean): void {
    this.stopTicker();
    this.stopRing();
    document.title = this.originalTitle || 'WorkSpace';
    const done = this.sessionTodos.filter((t) => t.done).length;
    const total = this.sessionTodos.length;
    // Minutes actually focused (elapsed), not the planned length — so a session
    // ended early reports honestly.
    const minutes = Math.max(0, Math.floor((this.totalSeconds - this.currentRemaining()) / 60));

    // Manual ends get an undo window: snapshot the session BEFORE teardown so the
    // toast's Restore button can bring it back. A naturally completed session has
    // nothing left to resume, so it gets no snapshot.
    const retrieveState: FocusState | null = completed
      ? null
      : {
          sessionActive: true,
          paused: true, // retrieveSession() un-pauses it straight back into running
          endTimeMs: 0,
          totalSeconds: this.totalSeconds,
          pausedRemainingSec: this.currentRemaining(),
          todos: [...this.sessionTodos],
          selectedMusic: this.sessionMusic,
          musicVolume: this.musicVolume,
          musicIndex: this.engine?.currentIndex() ?? 0,
          currentTrackKey: this.engine?.currentTrack()?.key ?? null,
          musicColl: { ...this.musicColl },
          musicWasPlaying: this.paused ? this.musicPlayingAtPause : this.musicPlaying,
          quote: this.quote,
          savedAt: Date.now(),
        };

    clearFocusState();
    this.engine?.destroy();
    this.engine = null;
    this.overlay?.remove();
    this.overlay = null;
    this.ringEl = null;
    this.ringWrap = null;
    this.timeText = null;
    this.pauseBtn = null;
    this.musicNameEl = null;
    this.musicPlayBtn = null;
    this.redrawMusicMenu = null;
    this.disarmMusicResume();
    this.closePip();
    this.widget?.remove();
    this.widget = null;

    // A playlist picked in the setup screen DURING the session was deliberately
    // parked (a setup click must never hijack live music) — make it the draft now.
    if (this.pendingSel) {
      const p = this.pendingSel;
      this.pendingSel = null;
      void this.selectDraftCollection(p.kind, p.key, p.index);
    }

    // The completion sound plays whether the timer ran out or the session was ended
    // manually. Keep the handle: restoring the session mid-ring silences it.
    this.releaseWakeLock();
    if (this.endSoundEnabled) this.endCue = playEndSound(this.endSoundKey, this.endSoundVolume);
    if (completed) {
      // A completed session announces via the system notification (Settings ▸
      // Notifications ▸ Focus). The old "session complete" toast duplicated that, so
      // it's been removed — the sound + notification are the completion feedback now.
      void this.notify('⏰ Focus session complete!', `${minutes} min focused • ${done}/${total} tasks done`);
    } else {
      // Manual / early ends get NO notification — so the toast stays for them, mainly
      // to carry the "Restore" undo (a mis-tapped End can be taken back for ~10s).
      this.showEndToast(false, minutes, done, total, retrieveState ? () => this.retrieveSession(retrieveState, true) : undefined);
    }
    this.sessionTodos = [];
    this.redrawSessionTodos = null;
    this.todos = []; // fresh setup next time
    this.renderSetup();
  }

  // --- music --------------------------------------------------------------

  /**
   * Lazily start the music engine MID-SESSION. The transport works even when the
   * session began with "None": the arrows / play button summon a track on demand
   * instead of no-opping. Returns false only when there are no tracks at all.
   */
  private ensureMusic(startIndex = 0): boolean {
    if (this.engine) return true;
    if (!this.playlist.length) return false;
    const idx = Math.max(0, Math.min(startIndex, this.playlist.length - 1));
    this.sessionMusic = this.playlist[idx].key;
    this.startMusic(idx);
    this.refreshMusicName();
    this.persist();
    return !!this.engine;
  }

  /** Stop and fully unload music (the menu's "🔇 None" row). The transport stays —
   *  arrows / play can summon a track again via ensureMusic. */
  private stopMusic(): void {
    this.engine?.destroy();
    this.engine = null;
    this.sessionMusic = null;
    this.musicPlaying = false;
    this.refreshMusicName();
    if (this.musicPlayBtn) this.musicPlayBtn.textContent = '▶';
    this.persist();
  }

  /** autoplay=false wires the engine up (track, queue position, transport) without
   *  making sound — a restored PAUSED session must stay fully silent until the user
   *  presses something. */
  private startMusic(startIndex = 0, autoplay = true): void {
    if (!this.sessionMusic) return;
    const idx = this.playlist.findIndex((t) => t.key === this.sessionMusic);
    if (idx < 0) return;
    this.engine = new MusicEngine();
    this.musicPlaying = autoplay;
    this.engine.setOnIndexChange(() => {
      // The ⏭/⏮ arrows move the engine; keep the session's track key in step so the
      // bar label, persistence, and any rebuilt control reflect the track now playing.
      this.sessionMusic = this.engine?.currentTrack()?.key ?? this.sessionMusic;
      this.persist();
      this.refreshMusicName();
    });
    // If the browser blocks autoplay (a session restored without a click), don't
    // pretend it's playing — show ▶ and resume on the next interaction.
    this.engine.setOnBlocked(() => this.handleMusicBlocked());
    // The <audio> element's real state drives the ⏸/▶ glyph. This is what keeps the
    // button honest on a restored session (the transport is built BEFORE playback
    // starts, so without this it stays ▶ while music plays) — and it also covers
    // OS media keys, which pause the element without touching our buttons.
    this.engine.setOnPlayState((playing) => {
      this.musicPlaying = playing;
      this.syncMusicPlayIcon();
    });
    void this.engine.setPlaylist(this.playlist, startIndex || idx, autoplay);
    this.engine.setVolume(this.musicVolume); // apply the session volume over the track default
  }

  /** Sync the transport play/pause glyph to the true engine state. */
  private syncMusicPlayIcon(): void {
    if (this.musicPlayBtn) this.musicPlayBtn.textContent = this.engine && this.musicPlaying ? '⏸' : '▶';
  }

  /**
   * The browser refused autoplay (a restored session has no user gesture). Reflect
   * the truth — show ▶, not ⏸ — and arm a one-shot listener so music starts the
   * instant the user next interacts anywhere.
   */
  private handleMusicBlocked(): void {
    this.musicPlaying = false;
    this.syncMusicPlayIcon();
    this.redrawMusicMenu?.();
    this.armMusicResume();
  }

  private armMusicResume(): void {
    if (this.musicResumeHandler) return; // already waiting for a gesture
    const resume = (e: PointerEvent): void => {
      // Clicks on the transport itself are handled by its own buttons — ignore them
      // here so we never fight the play/pause button (which fires on the same click).
      if ((e.target as HTMLElement)?.closest?.('.focus-music-panel')) return;
      this.disarmMusicResume();
      if (!this.engine || this.musicPlaying) return;
      this.musicPlaying = true;
      armAudioContext(); // this click is the gesture — wake the context so the gain boost engages
      this.engine.play();
      this.syncMusicPlayIcon();
      this.redrawMusicMenu?.();
    };
    this.musicResumeHandler = resume;
    document.addEventListener('pointerdown', resume, true);
  }

  private disarmMusicResume(): void {
    if (this.musicResumeHandler) {
      document.removeEventListener('pointerdown', this.musicResumeHandler, true);
      this.musicResumeHandler = null;
    }
  }

  // --- overlay UI ---------------------------------------------------------

  private buildOverlay(): void {
    this.overlay?.remove();
    const ov = el('div', { class: 'focus-overlay' });

    // Minimize → floating widget (top-left corner).
    const minBtn = el('button', { class: 'focus-min-btn', title: 'Minimize' });
    minBtn.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 17h12"/></svg>';
    minBtn.addEventListener('click', () => this.minimize());
    ov.append(minBtn);

    // Two-column desktop stage: timer cluster (left) + task panel (right).
    const stage = el('div', { class: 'focus-stage' });
    const left = el('div', { class: 'focus-left' });
    const right = el('div', { class: 'focus-right' });

    // Ring → controls (Pause/End) → ±adjust rows. Controls sit ABOVE the +/- rows.
    // The ring, controls and extend rows are the SAME components the minimized widget
    // reuses (scaled down). The quote is NOT here — it spans the full screen above the
    // stage (below), so it wraps across fewer lines than the narrow left column allowed.
    left.append(this.buildRing());
    left.append(this.buildEndTime());
    left.append(this.buildControls());
    left.append(this.buildExtendRows());

    // --- Task panel (right column) — shared component, also used by the widget ---
    right.append(this.buildTaskPanel());

    stage.append(left, right);
    // Quote spans the full screen above the stage (centered), so the same text wraps
    // across fewer lines than it did inside the narrow left column.
    ov.append(el('div', { class: 'focus-quote', text: this.quote }), stage);

    // Music transport (bottom-right) — always shown ("No music" until a track is added).
    ov.append(this.buildMusicControls());

    document.body.append(ov);
    this.overlay = ov;
    this.updateDisplay(this.currentRemaining());
  }

  /** The "This session" task panel: todo list + free-text add + Import Tasks.
   *  Shared by the overlay (right column) and the minimized widget (stacked
   *  vertically) — only one shows at a time, so they share redrawSessionTodos. */
  private buildTaskPanel(): HTMLElement {
    const taskPanel = el('div', { class: 'focus-task-panel' });
    taskPanel.append(el('div', { class: 'focus-task-head', text: 'This session' }));
    const todoList = el('div', { class: 'focus-overlay-todos' });
    this.drawOverlayTodos(todoList);
    this.redrawSessionTodos = () => this.drawOverlayTodos(todoList); // external edits refresh this list

    // Import-tasks dropdown (declared before the add row, which refreshes it).
    const importUI = this.buildImportUI(
      () => this.sessionTodos,
      () => this.drawOverlayTodos(todoList),
      'up' // pinned at the bottom of the capped session card → it opens upward
    );

    // Mid-session free-text add.
    const addRow = el('div', { class: 'focus-add-todo' });
    const addInput = textInput({
      class: 'focus-todo-input',
      placeholder: 'Add a task…',
    });
    const addBtn = el('button', { class: 'focus-add-btn', text: '+', title: 'Add task' });
    const addNow = () => {
      const v = addInput.value.trim();
      if (!v) return;
      // Same as the setup screen: this also creates the task in Tasks, so a
      // mid-session addition isn't lost when the session ends (see addTypedTodo).
      this.addTypedTodo(this.sessionTodos, v);
      addInput.value = '';
      addInput.focus();
      this.drawOverlayTodos(todoList);
      importUI.refresh();
      this.persist();
    };
    addInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') addNow();
    });
    addBtn.addEventListener('click', addNow);
    addRow.append(addInput, addBtn);

    // Add-a-task sits ABOVE the list (same order as the setup screen) — so the
    // import resize drag moves ONLY the Import button + search + list boundary
    // upward; the add row and the tasks' top edge never budge (per Gabe).
    taskPanel.append(addRow, todoList, importUI.button, importUI.panel);
    return taskPanel;
  }

  /** The ring + centered timer. Shared by the overlay and the minimized widget
   *  (only one shows at a time, so they share this.ringEl/ringWrap/timeText). */
  private buildRing(): HTMLElement {
    const ringWrap = el('div', { class: 'focus-ring-wrap' });
    ringWrap.innerHTML = `
      <svg class="focus-ring" viewBox="0 0 280 280">
        <circle cx="140" cy="140" r="${RING_R}" class="ring-bg"/>
        <circle cx="140" cy="140" r="${RING_R}" class="ring-fg"
          stroke-dasharray="${RING_C}" stroke-dashoffset="0"
          transform="rotate(-90 140 140)"/>
        <circle cx="140" cy="${140 - RING_R}" r="6" class="ring-dot"/>
      </svg>`;
    this.ringEl = ringWrap.querySelector<SVGCircleElement>('.ring-fg');
    this.ringWrap = ringWrap;
    this.timeText = el('div', { class: 'focus-time', text: this.clock(this.currentRemaining()) });
    ringWrap.append(this.timeText);
    this.startRingAnimation(); // drive the arc continuously (smoother than per-second)
    return ringWrap;
  }

  /** Cancel the ring animation in whichever window owns it (see stopTicker). */
  private stopRing(): void {
    try {
      this.ringWin.cancelAnimationFrame(this.ringRaf);
    } catch {
      /* owning window already closed */
    }
  }

  /** Continuously shrink the gold arc using precise (sub-second) remaining time, so
   *  it glides down smoothly instead of stepping once a second. The timer text stays
   *  on whole seconds (updated by the ticker). Runs in the PiP window while the mini
   *  player is detached — a hidden main tab gets NO animation frames at all, which
   *  would freeze the arc solid. */
  private startRingAnimation(): void {
    this.stopRing();
    this.ringWin = this.pipWindow ?? window;
    const step = () => {
      if (!this.ringEl) return; // ring torn down
      const remaining = this.paused
        ? this.pausedRemainingSec ?? 0
        : Math.max(0, (this.endTimeMs - Date.now()) / 1000);
      const frac = this.totalSeconds > 0 ? remaining / this.totalSeconds : 0;
      this.ringEl.style.strokeDashoffset = String(RING_C * (1 - frac));
      if (remaining > 0) this.ringRaf = this.ringWin.requestAnimationFrame(step);
    };
    this.ringRaf = this.ringWin.requestAnimationFrame(step);
  }

  /** "⏰ Ends 2:34 PM" — the wall-clock time the session finishes, shown beneath the
   *  ring. Reused by the overlay and the widget (this.endTimeEl points to whichever is
   *  up). refreshEndTime() keeps it current as the ± buttons change the length. */
  private buildEndTime(): HTMLElement {
    const wrap = el('div', { class: 'focus-endtime' });
    wrap.append(el('span', { class: 'focus-endtime-icon', text: '⏰' }));
    this.endTimeEl = el('span', { class: 'focus-endtime-text' });
    wrap.append(this.endTimeEl);
    this.refreshEndTime();
    return wrap;
  }

  private refreshEndTime(): void {
    if (!this.endTimeEl) return;
    // Running: the fixed end timestamp. Paused: project from "now + remaining".
    const endMs = this.paused ? Date.now() + (this.pausedRemainingSec ?? 0) * 1000 : this.endTimeMs;
    const time = new Date(endMs).toLocaleTimeString([], {
      hour: 'numeric',
      minute: '2-digit',
      hour12: getPrefs().timeFormat === '12h',
    });
    this.endTimeEl.textContent = `Ends ${time}`;
  }

  /** Pause/Resume + End Session. Shared by the overlay and the widget (this.pauseBtn).
   *  stopPropagation keeps clicks from starting a widget drag. */
  private buildControls(): HTMLElement {
    const controls = el('div', { class: 'focus-controls' });
    const pauseBtn = el('button', {
      class: 'focus-ctrl primary',
      text: this.paused ? '▶ Resume' : '⏸ Pause',
    });
    pauseBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.togglePause();
    });
    this.pauseBtn = pauseBtn;
    const endBtn = el('button', { class: 'focus-ctrl danger', text: 'End Session' });
    endBtn.addEventListener('click', (e) => {
      e.stopPropagation();
      this.endSession(false);
    });
    controls.append(pauseBtn, endBtn);
    return controls;
  }

  /** Two rows of quick time adjustments: +2/+5/+10/custom and −2/−5/−10/custom. The
   *  custom (✎) buttons open a popup with H:M:S carousels for a precise amount. */
  private buildExtendRows(): HTMLElement {
    const wrap = el('div', { class: 'focus-extend' });
    const mkRow = (sign: 1 | -1): HTMLElement => {
      const row = el('div', { class: `focus-extend-row ${sign > 0 ? 'add' : 'trim'}` });
      const sym = sign > 0 ? '+' : '−';
      for (const m of [2, 5, 10]) {
        const b = el('button', { class: 'focus-extend-btn', text: `${sym}${m}` });
        b.addEventListener('click', () => this.extend(sign * m * 60)); // minutes → seconds
        row.append(b);
      }
      const custom = el('button', {
        class: 'focus-extend-btn custom',
        text: `${sym}✎`,
        title: sign > 0 ? 'Add a custom amount' : 'Trim a custom amount',
      });
      custom.addEventListener('click', () => this.promptCustomExtend(sign));
      row.append(custom);
      return row;
    };
    wrap.append(mkRow(1), mkRow(-1));
    return wrap;
  }

  /** In-app popup (never native prompt) with H:M:S carousels for a precise custom
   *  add/trim amount. Opened by the +✎ / −✎ buttons. */
  private promptCustomExtend(sign: 1 | -1): void {
    const back = el('div', { class: 'focus-modal-back' });
    const card = el('div', { class: 'focus-modal focus-extend-modal' });
    card.append(el('div', { class: 'focus-modal-title', text: sign > 0 ? 'Add time' : 'Trim time' }));

    const HOURS = Array.from({ length: 13 }, (_, i) => i); // 0–12
    const UNITS = Array.from({ length: 60 }, (_, i) => i); // 00–59
    const hW = makeWheel(HOURS, () => {});
    const mW = makeWheel([...UNITS], () => {});
    const sW = makeWheel([...UNITS], () => {});
    const col = (label: string, wheel: HTMLElement) => {
      const c = el('div', { class: 'focus-wheel-col' });
      c.append(wheel, el('div', { class: 'focus-wheel-label', text: label }));
      return c;
    };
    const carousel = el('div', { class: 'focus-carousel focus-extend-carousel' });
    carousel.append(col('Hour', hW.wheel), col('Min', mW.wheel), col('Sec', sW.wheel), el('div', { class: 'focus-carousel-window' }));
    card.append(carousel);

    const amount = () => hW.value() * 3600 + mW.value() * 60 + sW.value();
    const actions = el('div', { class: 'focus-modal-actions' });
    const cancel = el('button', { class: 'focus-ctrl', text: 'Cancel' });
    const ok = el('button', {
      class: `focus-ctrl ${sign > 0 ? 'gold' : 'danger'}`,
      text: sign > 0 ? 'Add' : 'Trim',
    });
    const close = () => back.remove();
    cancel.addEventListener('click', close);
    ok.addEventListener('click', () => {
      const a = amount();
      if (a > 0) this.extend(sign * a);
      close();
    });
    actions.append(cancel, ok);
    card.append(actions);

    back.append(card);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    enterConfirms(back, () => ok); // Enter = Add/Trim the dialed amount
    document.body.append(back);

    // Default the picker to 5 minutes; position the wheels once the popup is laid out.
    const apply = () => {
      hW.scrollTo(0);
      mW.scrollTo(5);
      sW.scrollTo(0);
    };
    const io = new IntersectionObserver((entries) => {
      if (entries.some((en) => en.isIntersecting && en.boundingClientRect.height > 0)) {
        apply();
        io.disconnect();
      }
    });
    io.observe(hW.wheel);
    apply();
  }

  /** Bottom-right music transport. ALWAYS shown — reads "No music" with a 🎵 glyph
   *  until a track is added, so wiring real music in later is seamless. */
  /**
   * Bottom-right music cluster: ⏮ ⏸/▶ ⏭ transport + a 🎵 button that opens the
   * music MENU (now playing, every track in order, a playlists stub for the coming
   * music database, and the volume slider — moved here from under the bar).
   * The whole transport works even when the session began with "None": arrows and
   * play summon the first track on demand (ensureMusic).
   */
  private buildMusicControls(): HTMLElement {
    const panel = el('div', { class: 'focus-music-panel' });
    // Tiny label so the transport's ⏸ can't be mistaken for the SESSION Pause —
    // these buttons only control the soundtrack.
    panel.append(el('div', { class: 'focus-music-caption', text: 'MUSIC' }));
    const bar = el('div', { class: 'focus-music-bar' });
    const track = this.sessionMusic ? this.playlist.find((t) => t.key === this.sessionMusic) : undefined;

    const prev = el('button', { class: 'focus-music-ctrl', text: '⏮', title: 'Previous' });
    const play = el('button', {
      class: 'focus-music-ctrl play',
      text: track && this.musicPlaying ? '⏸' : '▶',
      title: 'Play / pause',
    });
    const next = el('button', { class: 'focus-music-ctrl', text: '⏭', title: 'Next' });
    const musicBtn = el('button', { class: 'focus-music-ctrl', text: '🎵', title: 'Music menu' });
    this.musicPlayBtn = play;
    // No always-on track label: the current track is shown only inside the 🎵 menu
    // ("Now playing"). refreshMusicName still updates that menu; it no-ops the label.
    this.musicNameEl = null;

    const syncPlayIcon = () => {
      play.textContent = this.engine && this.musicPlaying ? '⏸' : '▶';
    };
    prev.addEventListener('click', () => {
      // From "None", ⏮ starts at the END of the list (it's "previous", after all).
      if (!this.engine) this.ensureMusic(this.playlist.length - 1);
      else this.engine.prev();
      syncPlayIcon();
    });
    next.addEventListener('click', () => {
      if (!this.engine) this.ensureMusic(0);
      else this.engine.next();
      syncPlayIcon();
    });
    play.addEventListener('click', () => {
      if (!this.engine) {
        this.ensureMusic(0); // "None" session → play summons the first track
      } else {
        this.musicPlaying = !this.musicPlaying;
        if (this.musicPlaying) this.engine.play();
        else this.engine.pause();
      }
      syncPlayIcon();
    });
    // Order: ⏮ ⏸/▶ 🎵 ⏭ — the menu button nests inside the transport cluster,
    // between play/pause and the next-arrow. No track label; the panel is right-
    // anchored, so the buttons sit where the label used to be.
    bar.append(prev, play, musicBtn, next);
    panel.append(bar);

    // --- 🎵 menu: the whole music player (queue + inline playlist switcher) ------
    const menu = el('div', { class: 'focus-music-menu' });
    panel.append(menu);

    let mode: 'queue' | 'browse' = 'queue'; // the menu flips between the queue and the playlist picker
    const drawMenu = () => {
      // Preserve the song list's scroll position across the rebuild, so switching a
      // track doesn't snap the list back to the top and lose the song you pressed.
      const savedScroll = menu.querySelector('.focus-menu-tracks')?.scrollTop ?? 0;
      menu.replaceChildren();
      this.engine?.setOnTime(null); // drop the old seek bar's callback; the queue view re-registers a fresh one
      const cur = this.engine?.currentTrack() ?? null;

      if (mode === 'browse') {
        // Inline playlist picker, grouped by subheader (Favorites / Genres / Artists).
        const backBtn = el('button', { class: 'focus-menu-switch' });
        backBtn.append(el('span', { class: 'focus-menu-switch-cta', text: '◂ Back' }));
        backBtn.addEventListener('click', () => {
          mode = 'queue';
          drawMenu();
        });
        menu.append(backBtn);

        const collItem = (parent: HTMLElement, kind: MusicCollKind, key: string, emoji: string, name: string, tracks: LibraryTrack[]) => {
          const on = this.musicColl.kind === kind && (kind === 'favorites' || kind === 'various' || this.musicColl.key === key);
          const row = el('div', { class: `focus-menu-track${on ? ' active' : ''}` });
          const len = fmtPlaylistLen(totalSeconds(tracks));
          row.append(
            el('span', { class: 'focus-menu-emoji', text: emoji }),
            el('span', { class: 'focus-menu-coll-name', text: name }),
            el('span', { class: 'focus-menu-count', text: `${tracks.length}${len ? ` · ${len}` : ''}` })
          );
          row.addEventListener('click', () =>
            void this.selectCollection(kind, key).then(() => {
              mode = 'queue';
              drawMenu();
            })
          );
          parent.append(row);
        };
        // Every section (Favorites/Genres/Artists/Custom) lives in ONE scroller so
        // a single grip below resizes the whole playlist browser — and so there's
        // never a scrollbar inside a scrollbar. The inner boxes stay uncapped.
        const browseWrap = el('div', { class: 'focus-menu-browse-wrap' });
        const section = (title: string): HTMLElement => {
          browseWrap.append(el('div', { class: 'focus-menu-section', text: title }));
          const box = el('div', { class: 'focus-menu-tracks focus-menu-browse' });
          browseWrap.append(box);
          return box;
        };

        collItem(section('Favorites'), 'favorites', 'favorites', '❤️', 'Favorites', this.favoriteTracks());
        const gl = section('Genres');
        for (const { item: g, tracks } of sortCollections([...MUSIC_GENRES], (g) => tracksForGenre(g.id))) {
          collItem(gl, 'genre', g.id, g.emoji, g.label, tracks);
        }
        const al = section('Artists');
        for (const { item: a, tracks } of sortCollections(majorArtists(), (a) => tracksForArtist(a.name)))
          collItem(al, 'artist', a.name, '🎼', a.name, tracks);
        if (hasMinorArtists()) collItem(al, 'various', 'various', '🎭', 'Various', minorArtistTracks());
        if (this.customPlaylists.length) {
          const cl = section('Custom');
          for (const pl of this.customPlaylists) collItem(cl, 'playlist', pl.id, playlistEmoji(pl), pl.name, this.playlistTracks(pl.id));
        }
        // Rebuilt on every redraw, so re-apply the saved height and hang a fresh grip.
        // TOP grip: this menu is pinned ABOVE the music button (bottom: 100% + 10px
        // in focus.css), so its bottom edge can't move — a taller list pushes the
        // menu's TOP edge upward. The growth happens at the top, so that's where the
        // grip belongs; drag UP to grow.
        restoreSavedHeight(browseWrap, MENU_BROWSE_H_KEY);
        menu.append(
          makeResizeGrip({ body: browseWrap, storageKey: MENU_BROWSE_H_KEY, max: 720, edge: 'top' }).el,
          browseWrap
        );
      } else {
        // The active playlist (a "Switch playlist" button) sits ABOVE the now-playing
        // song, then the current playlist's songs in order.
        const switchRow = el('button', { class: 'focus-menu-switch' });
        switchRow.append(
          el('span', { class: 'focus-menu-switch-label', text: this.collLabel() }),
          el('span', { class: 'focus-menu-switch-cta', text: 'Switch ▸' })
        );
        switchRow.addEventListener('click', () => {
          mode = 'browse';
          drawMenu();
        });
        menu.append(switchRow);

        menu.append(el('div', { class: 'focus-menu-section', text: 'Now playing' }));
        const nowWrap = el('div', { class: 'focus-menu-nowplaying' });
        // The current track uses the SAME emoji-span + text layout as the list rows
        // below, so its emoji and title line up with every other song.
        const currentRow = el('div', { class: 'focus-menu-current' });
        currentRow.append(
          el('span', { class: 'focus-menu-emoji', text: cur ? cur.emoji : '🔇' }),
          el('span', { text: cur ? `${cur.label}${this.musicPlaying ? '' : ' (paused)'}` : 'No music' })
        );
        nowWrap.append(currentRow);
        // Seek bar with −10s / +10s skips + current/total time, shown while a track plays.
        if (cur && this.engine) {
          const fmt = (s: number) => {
            const n = Math.max(0, Math.floor(s || 0));
            return `${Math.floor(n / 60)}:${String(n % 60).padStart(2, '0')}`;
          };
          const seekRow = el('div', { class: 'focus-menu-seek' });
          const back = el('button', { class: 'focus-menu-skip', title: 'Back 10 seconds', text: '⏪' });
          const fwd = el('button', { class: 'focus-menu-skip', title: 'Forward 10 seconds', text: '⏩' });
          const curT = el('span', { class: 'focus-menu-time' });
          const durT = el('span', { class: 'focus-menu-time' });
          const slider = el('input', {
            type: 'range', min: '0', max: '100', value: '0', step: '0.1', class: 'focus-seek-slider', title: 'Seek',
          }) as HTMLInputElement;
          const paint = (c: number, d: number) => {
            if (d > 0) {
              slider.max = String(d);
              if (slider.ownerDocument.activeElement !== slider) slider.value = String(c); // don't fight a drag (works in the mini PiP window too)
            }
            curT.textContent = fmt(c);
            durT.textContent = fmt(d);
          };
          const p = this.engine.progress();
          paint(p.cur, p.dur);
          this.engine.setOnTime(paint);
          // While dragging: mute so scrubbing doesn't play sped-up snippets, keep the
          // position + time label following the slider, then unmute on release.
          const startScrub = () => this.engine?.mute(true);
          const endScrub = () => this.engine?.mute(false);
          slider.addEventListener('pointerdown', startScrub);
          slider.addEventListener('input', () => {
            const v = Number(slider.value);
            this.engine?.seekTo(v);
            curT.textContent = fmt(v);
          });
          slider.addEventListener('change', endScrub); // fires on release
          slider.addEventListener('pointerup', endScrub); // belt-and-suspenders
          slider.addEventListener('blur', endScrub);
          back.addEventListener('click', () => this.engine?.seekBy(-10));
          fwd.addEventListener('click', () => this.engine?.seekBy(10));
          seekRow.append(back, curT, slider, durT, fwd);
          nowWrap.append(seekRow);
        }
        menu.append(nowWrap);

        // ⏮/⏭ move within this list; click any song to jump.
        const list = el('div', { class: 'focus-menu-tracks' });
        const trackRow = (emoji: string, label: string, active: boolean, onPick: () => void, favId?: string) => {
          const row = el('div', { class: `focus-menu-track${active ? ' active' : ''}` });
          row.append(el('span', { class: 'focus-menu-emoji', text: emoji }), el('span', { text: label }));
          if (favId) row.append(this.favHeart(favId, () => drawMenu())); // heart on library tracks
          row.addEventListener('click', () => {
            onPick();
            syncPlayIcon();
            drawMenu();
          });
          return row;
        };
        list.append(trackRow('🔇', 'None', !this.engine, () => this.stopMusic()));
        this.playlist.forEach((t, i) => {
          const favId = t.key.startsWith('track_') ? undefined : t.key; // custom tracks aren't favoritable
          list.append(trackRow(t.emoji, t.label, cur?.key === t.key, () => this.playIndex(i), favId));
        });
        // Resizable song list. This menu is rebuilt on every track change, so the
        // saved height is re-applied to the fresh list each draw, and a new grip
        // rides ABOVE it — same reason as the browser above: the menu is pinned at
        // its bottom, so it grows upward and the top edge is the one that moves.
        // (No fitTo: the menu itself is viewport-capped and scrolls.)
        restoreSavedHeight(list, MENU_TRACKS_H_KEY);
        menu.append(makeResizeGrip({ body: list, storageKey: MENU_TRACKS_H_KEY, edge: 'top' }).el, list);
      }

      // Volume (moved here from under the transport). Live, and it sticks across
      // ⏭/⏮ because the engine keeps the override.
      menu.append(el('div', { class: 'focus-menu-section', text: 'Volume' }));
      const volIcon = (v: number) => (v === 0 ? '🔇' : v < 50 ? '🔉' : '🔊');
      const volRow = el('div', { class: 'focus-music-volume' });
      const icon = el('span', { class: 'focus-music-vol-icon', text: volIcon(this.musicVolume) });
      const slider = el('input', {
        type: 'range',
        min: '0',
        max: '100',
        class: 'focus-vol-slider',
        title: 'Music volume',
      }) as HTMLInputElement;
      slider.value = String(this.musicVolume);
      slider.addEventListener('input', () => {
        this.musicVolume = Number(slider.value);
        this.engine?.setVolume(this.musicVolume);
        icon.textContent = volIcon(this.musicVolume);
      });
      volRow.append(icon, slider);
      menu.append(volRow);

      // Restore the list scroll captured above, so the song you tapped stays put.
      const rebuiltList = menu.querySelector('.focus-menu-tracks');
      if (rebuiltList) rebuiltList.scrollTop = savedScroll;
    };
    this.redrawMusicMenu = drawMenu;

    // Use the panel's OWN document for the outside-click listener — that's the main
    // window for the overlay, and the Picture-in-Picture window for the mini player.
    const onDocDown = (e: PointerEvent) => {
      // Self-cleaning: if the overlay/widget (and this panel) is gone, drop the listener.
      if (!panel.isConnected) {
        panel.ownerDocument.removeEventListener('pointerdown', onDocDown);
        return;
      }
      if (!panel.contains(e.target as Node)) closeMenu();
    };
    const openMenu = () => {
      drawMenu();
      // Pull the latest favorites + custom playlists (they may have changed since the
      // session started — e.g. a playlist just made in Settings) and redraw.
      void this.refreshMusicLibrary().then(() => {
        if (menu.classList.contains('open')) drawMenu();
      });
      menu.classList.add('open');
      musicBtn.classList.add('active');
      panel.ownerDocument.addEventListener('pointerdown', onDocDown);
    };
    const closeMenu = () => {
      menu.classList.remove('open');
      musicBtn.classList.remove('active');
      panel.ownerDocument.removeEventListener('pointerdown', onDocDown);
    };
    musicBtn.addEventListener('click', () => {
      if (menu.classList.contains('open')) closeMenu();
      else openMenu();
    });
    return panel;
  }

  /** Refresh the bottom-right track name (and the 🎵 menu, if open) from the
   *  engine's current track — falls back to "No music" once music is stopped. */
  private refreshMusicName(): void {
    this.redrawMusicMenu?.();
    if (!this.musicNameEl) return;
    const t = this.engine?.currentTrack();
    if (!t) {
      this.musicNameEl.replaceChildren(el('span', { text: 'No music' }));
      return;
    }
    this.musicNameEl.replaceChildren(
      el('span', { class: 'focus-music-emoji', text: t.emoji }),
      el('span', { text: t.label })
    );
  }

  private drawOverlayTodos(host: HTMLElement): void {
    host.replaceChildren();
    if (!this.sessionTodos.length) {
      host.append(el('div', { class: 'focus-todos-empty', text: 'No tasks left. Add one below.' }));
      return;
    }
    const buildRow = (todo: FocusTodo, draggable: boolean): HTMLElement => {
      const i = this.sessionTodos.indexOf(todo);
      const row = el('div', { class: `focus-todo-item${todo.done ? ' done' : ''}` });

      if (draggable) {
        const handle = el('button', { class: 'focus-todo-handle', text: '⋮⋮', title: 'Drag to reorder' });
        // The folder id is the drag GROUP: a folder's rows reorder among
        // themselves, the loose rows among themselves, and never across.
        this.makeTodoDraggable(row, handle, host, i, todo.folderId || '');
        row.append(handle);
      }

      const cb = el('button', { class: `task-cb${todo.done ? ' checked' : ''}` });
      cb.innerHTML =
        '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';
      cb.addEventListener('click', () => {
        todo.done = !todo.done;
        void this.syncLinkedTask(todo);
        this.drawOverlayTodos(host);
        this.persist();
      });

      // Double-click the title or course to edit (writes through to the source task
      // if imported); "+ title" / "+ course" appear when a field is empty.
      const label = this.buildTodoLabel(todo, () => {
        this.drawOverlayTodos(host);
        this.persist();
      });

      const actions = el('div', { class: 'focus-todo-actions' });
      if (todo.schoologyUrl) {
        const link = el('a', {
          class: 'focus-todo-iconbtn',
          href: todo.schoologyUrl,
          target: '_blank',
          rel: 'noopener',
          title: 'Open in Schoology',
          text: '↗',
        });
        actions.append(link);
      }
      // 🗀 — regroup mid-session too (focus folders, independent namespace).
      const fold = el('button', { class: 'focus-todo-fold', title: 'Add to folder' });
      fold.innerHTML = FOCUS_FOLDER_BTN_SVG;
      const inFolder = this.taskFolders.find((f) => f.id === todo.folderId);
      if (inFolder) fold.style.color = inFolder.color;
      fold.addEventListener('click', () =>
        this.openFocusFolderPicker(todo, this.taskFolders, () => {
          this.drawOverlayTodos(host);
          this.persist();
        })
      );
      actions.append(fold);
      row.append(cb, label, actions);
      return row;
    };

    const { blocks, loose } = this.groupTodosByFolder(this.sessionTodos, this.taskFolders);
    for (const { folder, members } of blocks) {
      const open = this.openFocusFolders.has(folder.id);
      const box = el('div', { class: `focus-folder${open ? ' open' : ''}`, 'data-folder-id': folder.id });
      const headWrap = el('div', { class: 'focus-folder-headrow' });
      // NO checkbox on a folder (per Gabe) — folders aren't checkable things.
      // The done/total count already says how far along it is.
      const head = el('button', { class: 'focus-folder-head' });
      head.innerHTML = FOCUS_FOLDER_SVG(folder.color);
      const nameEl = el('span', { class: 'focus-folder-name', text: folder.name });
      // Renaming here renames the SHARED folder — it shows up in Tasks too.
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.inlineTodoEdit(nameEl, folder.name, 'folder name', (v) => {
          if (!v) return;
          folder.name = v;
          void saveTaskFolders(this.data, this.taskFolders);
        }, () => this.drawOverlayTodos(host));
      });
      // Same color well as the setup screen and the Tasks tab — click the glyph.
      const colorIn = this.folderColorInput(folder, head, () => this.drawOverlayTodos(host));
      head.append(
        nameEl,
        el('span', { class: 'focus-folder-count', text: `${members.filter((m) => m.done).length}/${members.length}` }),
        el('span', { class: 'focus-folder-arrow', text: '▶' }),
        colorIn
      );
      head.addEventListener('click', (e) => {
        if (head.querySelector('.inline-edit-block')) return; // rename in progress → head inert
        const t = e.target as HTMLElement;
        if (t.closest('.focus-folder-name')) return;
        if (t.closest('.focus-folder-ico')) {
          colorIn.click();
          return;
        }
        if (open) this.openFocusFolders.delete(folder.id);
        else this.openFocusFolders.add(folder.id);
        this.drawOverlayTodos(host);
      });
      headWrap.append(head);
      box.append(headWrap);
      if (open) {
        const body = el('div', { class: 'focus-folder-body' });
        // Checked members sink to the bottom of the folder so the remaining
        // work stays on top (same rule as the loose list below). Unchecked ones
        // are ⋮⋮-draggable WITHIN the folder, exactly as in the Tasks tab.
        for (const m of members.filter((t) => !t.done)) body.append(buildRow(m, true));
        for (const m of members.filter((t) => t.done)) body.append(buildRow(m, false));
        box.append(body);
      }
      host.append(box);
    }
    // In-session rule (per Gabe): checking a todo off doesn't remove it — it
    // MIGRATES to the bottom, keeping what's left to do at the top. The array
    // order is untouched (this is render-time only), so un-checking floats the
    // todo right back to its original spot. Done rows aren't draggable — the
    // bottom zone isn't a list you order, it's where finished things rest.
    // This holds however it got checked — here, or over in the Tasks tab
    // (onTasksUpdate mirrors that check-off onto the todo, and the sink follows).
    for (const todo of loose.filter((t) => !t.done)) host.append(buildRow(todo, true));
    for (const todo of loose.filter((t) => t.done)) host.append(buildRow(todo, false));
  }

  /** Tasks-tab-style inline editor: swap `host` for a text input that commits on
   *  Enter/blur and cancels on Escape, then re-renders the list via `redraw`. */
  private inlineTodoEdit(
    host: HTMLElement,
    initial: string,
    placeholder: string,
    commit: (value: string) => void,
    redraw: () => void
  ): void {
    // The editor hugs its text at the text's own on-screen size — no dilation, no
    // row-wide box (long text still wraps at the row edge via max-width).
    const input = textInput({ class: 'inline-edit-block', value: initial, placeholder });
    copyTextMetrics(input, host);
    host.replaceWith(input);
    autoWidthToText(input);
    // autoWidthToText widens the box to fit the text on each keystroke; re-fit the
    // HEIGHT right AFTER (this listener runs last) so a momentary wrap at the old,
    // narrower width never leaves a blank line under the title.
    input.addEventListener('input', () => input.rewrap());
    // Defer focus past this event's native word-selection (see tasks/render.ts inlineEdit).
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    let done = false;
    const finish = (apply: boolean) => {
      if (done) return;
      done = true;
      if (apply) commit(input.value.trim());
      redraw();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      else if (e.key === 'Escape') finish(false);
      // Editors hosted inside a <button> (folder heads): the spacebar's default
      // action is the BUTTON's activation — the space never types, and the
      // key-release "click" toggles the head, killing the editor mid-word.
      // Take the key over: cancel the activation, insert the space ourselves.
      else if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        input.setRangeText(' ', input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true })); // re-run width/height fitters
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  /** A focus-todo's label: title + course, each double-click-to-edit, with
   *  "+ title" / "+ course" affordances when a field is empty. When `mirror` is
   *  set, edits are written through to the linked source task (used in-session). */
  private buildTodoLabel(todo: FocusTodo, redraw: () => void): HTMLElement {
    const label = el('div', { class: 'focus-todo-label' });

    const commitTitle = (v: string) => {
      todo.text = v;
      // Imported todos write through to the source task (→ Tasks tab + import window).
      if (todo.taskId) void this.applyTaskEdit(todo.taskId, { title: v });
    };
    const commitCourse = (v: string) => {
      const course = v ? matchCourseStrict(v) : '';
      todo.course = course;
      if (todo.taskId) void this.applyTaskEdit(todo.taskId, { course });
    };
    const commitDate = (v: string) => {
      const { date, time } = parseDateTime(v);
      todo.dueDate = date;
      todo.dueTime = time;
      if (todo.taskId) void this.applyTaskEdit(todo.taskId, { dueDate: date, dueTime: time });
    };

    // Every editor below honors the Settings ▸ Tasks edit lock — these write
    // through to the real task, so they're the same gate as the Tasks tab's.
    if (todo.text) {
      const titleEl = el('span', { class: 'focus-todo-text', text: todo.text });
      titleEl.addEventListener('dblclick', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(titleEl, todo.text, 'task title', commitTitle, redraw);
      });
      label.append(titleEl);
    } else {
      const addTitle = el('span', { class: 'focus-todo-text empty', text: '+ title' });
      addTitle.addEventListener('click', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(addTitle, '', 'task title', commitTitle, redraw);
      });
      label.append(addTitle);
    }

    // "Course · date" on ONE line beneath the title. .focus-todo-label is a COLUMN
    // flex (title stacked over its meta), so these two can't be appended straight
    // to it or each would claim its own row. They go in a horizontal meta strip
    // instead, which is also what makes this line match the Tasks tab and the
    // import list character for character.
    const meta = el('div', { class: 'focus-todo-meta' });

    if (todo.course) {
      const chip = el('span', { class: 'course-chip', text: todo.course });
      chip.style.color = getCourseColor(todo.course);
      chip.addEventListener('dblclick', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(chip, todo.course || '', 'course', commitCourse, redraw);
      });
      meta.append(chip);
    } else {
      const chip = el('span', { class: 'course-chip empty', text: '+ course' });
      chip.addEventListener('click', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(chip, '', 'course', commitCourse, redraw);
      });
      meta.append(chip);
    }

    // Due date — identical to the Tasks tab and the import list: same classes,
    // same formatter, same double-click-to-edit, and the edit writes through to
    // the source task, so a date changed in a running session is changed
    // everywhere. One assignment has one due date, no matter which list you are
    // looking at it in.
    meta.append(el('span', { class: 'meta-dot', text: '·' }));
    if (todo.dueDate || todo.dueTime) {
      const when = [
        todo.dueDate ? formatMetaDate(todo.dueDate) : '',
        todo.dueTime ? formatTimeOfDay(todo.dueTime) : '',
      ]
        .filter(Boolean)
        .join(' ');
      const dateEl = el('span', { class: 'meta-date', text: when });
      dateEl.addEventListener('dblclick', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(dateEl, when, 'due date', commitDate, redraw);
      });
      meta.append(dateEl);
    } else {
      const dateEl = el('span', { class: 'meta-date empty', text: '+ due date' });
      dateEl.addEventListener('click', () => {
        if (!taskEditUnlocked()) return;
        this.inlineTodoEdit(dateEl, '', 'due date', commitDate, redraw);
      });
      meta.append(dateEl);
    }
    label.append(meta);

    // English translation carried over from the task (foreign-language titles).
    if (todo.translatedTitle) {
      const tr = el('div', { class: 'focus-todo-translation' });
      tr.append(el('span', { class: 'focus-todo-translation-badge', text: '🌐' }));
      tr.append(el('span', { text: todo.translatedTitle }));
      label.append(tr);
    }
    return label;
  }

  /** Apply a title/course/due-date edit to a source task and persist it. The
   *  data.watchTasks subscription (onTasksUpdate) then propagates it to the Tasks
   *  tab, the import window, and any linked session todo, so all three stay in step. */
  private async applyTaskEdit(
    taskId: string,
    patch: { title?: string; course?: string; dueDate?: string; dueTime?: string }
  ): Promise<void> {
    const tasks = await this.data.getTasksAll();
    const src = tasks[taskId];
    if (!src) return;
    const next: Task = { ...src };
    let changed = false;
    // A title-less focus todo is allowed, but never blank the underlying task.
    if (patch.title !== undefined && patch.title && patch.title !== src.title) {
      next.title = patch.title;
      next._manualTitle = true;
      changed = true;
    }
    if (patch.course !== undefined && patch.course !== src.course) {
      next.course = patch.course;
      next._manualCourse = true;
      changed = true;
      // Same as the Tasks tab: a hand-set course is ground truth, so it goes in the
      // cloud label store where it outranks any later extension scrape.
      void recordManualLabelForTask(this.data, next, patch.course);
    }
    // Date and time move together: parseDateTime returns both from one string, so
    // clearing the time by retyping just a date has to actually clear it. The
    // timeLabel ("morning", "after school") goes too, for the same reason the
    // Tasks tab drops it: an explicit clock time replaces a vague one.
    if (patch.dueDate !== undefined || patch.dueTime !== undefined) {
      const d = patch.dueDate ?? '';
      const tm = patch.dueTime ?? '';
      if (d !== src.dueDate || tm !== src.dueTime) {
        next.dueDate = d;
        next.dueTime = tm;
        next.timeLabel = '';
        next._manualDueDate = true;
        changed = true;
      }
    }
    if (changed) await this.data.putTask(next);
  }

  /** A task changed anywhere (Tasks tab edit or one of our own) → keep the import
   *  snapshot and any linked session todos' title/course/folder/DONE state in step.
   *  Completion travels both ways now (per Gabe): checked in either place means
   *  checked in both, and the Focus row sinks to the bottom exactly as if it had
   *  been checked here. */
  private onTasksUpdate(tasks: TaskMap): void {
    this.importTasks = Object.values(tasks).filter((t) => !t.completed);
    // Folders are shared: a folder created/renamed/recolored in Tasks (or a task
    // filed into one there) must show up here too. Re-read, then redraw.
    void this.refreshFolders().then(() => {
      this.redrawTodos?.();
      this.redrawSessionTodos?.();
    });
    // Membership changes made in Tasks land on the linked todos as well.
    for (const list of [this.todos, this.sessionTodos]) {
      for (const todo of list) {
        if (!todo.taskId) continue;
        const src = tasks[todo.taskId];
        if (!src) continue;
        const srcFolder = src.folderId;
        if ((todo.folderId || '') !== (srcFolder || '')) {
          if (srcFolder) todo.folderId = srcFolder;
          else delete todo.folderId;
        }
      }
    }
    let changed = false;
    // Keep BOTH the setup draft and the active session's linked todos in step with the
    // Tasks tab (the two lists are otherwise independent).
    const sync = (list: FocusTodo[]) => {
      for (const todo of list) {
        if (!todo.taskId) continue;
        const src = tasks[todo.taskId];
        if (!src) continue;
        if (todo.text !== src.title) {
          todo.text = src.title;
          changed = true;
        }
        if ((todo.course || '') !== (src.course || '')) {
          todo.course = src.course || '';
          changed = true;
        }
        // Due date/time follow the task the same way the title and course do, so a
        // date changed in Tasks (or by a Schoology re-sync that moved a deadline)
        // updates the row you're staring at mid-session.
        if ((todo.dueDate || '') !== (src.dueDate || '') || (todo.dueTime || '') !== (src.dueTime || '')) {
          todo.dueDate = src.dueDate || '';
          todo.dueTime = src.dueTime || '';
          changed = true;
        }
        if ((todo.translatedTitle || '') !== (src.translatedTitle || '')) {
          todo.translatedTitle = src.translatedTitle || '';
          todo.translatedLang = src.translatedLang || '';
          changed = true;
        }
        // DONE follows the task, whichever side did the checking. Ticking it off in
        // the Tasks tab checks the Focus row and sinks it to the bottom; un-ticking
        // it there (their Undo) floats it back up. Our own check-off arrives here
        // too — as the same value, so it lands as a no-op instead of a loop.
        if (todo.done !== src.completed) {
          todo.done = src.completed;
          changed = true;
        }
      }
    };
    sync(this.todos);
    sync(this.sessionTodos);
    this.refreshImportBody?.();
    if (changed) {
      this.redrawTodos?.();
      this.redrawSessionTodos?.();
      if (this.interval) this.persist(); // only persist when a session is actually running
    }
  }

  /** Native drag-and-drop reorder, initiated only from the ⋮⋮ handle.
   *
   *  `group` is the row's folder id ('' when loose), and a drop is only accepted
   *  BETWEEN ROWS OF THE SAME GROUP — the Tasks tab's rule, where a folder's rows
   *  carry a folder-scoped group key for exactly this reason. So you can reorder
   *  inside a folder, and reorder the loose list, but dragging can never move a
   *  task out of its folder (that's the 🗀 picker's job, and it has to write
   *  through to the real task — a drag can't imply that). */
  private makeTodoDraggable(
    row: HTMLElement,
    handle: HTMLElement,
    host: HTMLElement,
    index: number,
    group: string
  ): void {
    handle.addEventListener('pointerdown', () => row.setAttribute('draggable', 'true'));
    handle.addEventListener('pointerup', () => row.removeAttribute('draggable'));
    row.addEventListener('dragstart', (e) => {
      this.dragFrom = { index, group };
      row.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', String(index));
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    row.addEventListener('dragend', () => {
      row.classList.remove('dragging');
      row.removeAttribute('draggable');
      this.dragFrom = null;
    });
    row.addEventListener('dragover', (e) => {
      if (this.dragFrom?.group !== group) return; // other group → NOT a drop target
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    row.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this.dragFrom;
      this.dragFrom = null;
      if (!from || from.index === index || from.group !== group) return;
      // The move happens in the FLAT list; the folder grouping is applied at draw
      // time, so reordering two members of one folder lands exactly as it looks.
      const [moved] = this.sessionTodos.splice(from.index, 1);
      this.sessionTodos.splice(index, 0, moved);
      this.drawOverlayTodos(host);
      this.persist();
    });
  }

  /** When a session todo is linked to a task, mirror its completion to the task. */
  private async syncLinkedTask(todo: FocusTodo): Promise<void> {
    if (!todo.taskId) return;
    const tasks = await this.data.getTasksAll();
    const task: Task | undefined = tasks[todo.taskId];
    if (!task) return;
    await this.data.putTask({
      ...task,
      completed: todo.done,
      completedAt: todo.done ? new Date().toISOString() : null,
    });
  }

  /** Countdown text honoring the "Show seconds" pref (ring / tab title / toasts). */
  private clock(sec: number): string {
    return formatClock(sec, getPrefs().focus.showSeconds);
  }

  private updateDisplay(remaining: number): void {
    if (this.timeText) this.timeText.textContent = this.clock(remaining);
    this.refreshEndTime(); // keep "Ends …" in step (tick, and after every ± adjust)
    // The ring's offset is animated continuously by startRingAnimation (rAF).
    // Last-5-minutes urgent state: only the RING fades to red (the timer text stays
    // white). CSS handles the smooth 1s fade both into and out of urgent.
    if (this.ringWrap) this.ringWrap.classList.toggle('urgent', remaining <= 300 && remaining > 0);
    // Live countdown in the tab title (paused title is set in togglePause and held
    // because the ticker is stopped, so we only write the running title here).
    if (!this.paused) document.title = `🎯 ${this.clock(remaining)} · Focus`;
  }

  private togglePause(): void {
    if (this.paused) {
      // resume
      this.endTimeMs = Date.now() + (this.pausedRemainingSec ?? 0) * 1000;
      this.paused = false;
      this.pausedRemainingSec = null;
      // Resume the track WITH the session only if it was playing when we paused. If it
      // was paused independently first (or the user left it alone), leave it as-is —
      // and if the user played it DURING the pause, resuming the session won't touch it.
      if (this.musicPlayingAtPause && !this.musicPlaying) {
        this.engine?.play();
        this.musicPlaying = true;
      }
      this.startTicker();
    } else {
      this.pausedRemainingSec = this.currentRemaining();
      this.paused = true;
      this.stopTicker();
      // Snap the clock to the TRUE remaining right now. In a throttled background tab
      // the display can lag the real time by up to a minute — without this, pressing
      // Pause freezes a stale number and looks like the button did nothing.
      this.updateDisplay(this.pausedRemainingSec);
      // Remember whether the track was playing, then pause it in sync — but only if it
      // was actually playing (a track already paused independently stays paused).
      this.musicPlayingAtPause = this.musicPlaying;
      if (this.musicPlaying) {
        this.engine?.pause();
        this.musicPlaying = false;
      }
      document.title = '⏸ PAUSED · Focus';
    }
    // Keep the bottom-right music button's icon in step with the session (only when
    // a track is actually loaded — otherwise it stays the 🎵 "no music" glyph).
    if (this.musicPlayBtn && this.engine) this.musicPlayBtn.textContent = this.musicPlaying ? '⏸' : '▶';
    // Resume label stays gold (no green) — text-only change, on whichever screen is up.
    if (this.pauseBtn) this.pauseBtn.textContent = this.paused ? '▶ Resume' : '⏸ Pause';
    this.refreshEndTime();
    this.persist();
  }

  // Adjust the running clock. Positive = add time, negative = trim. Remaining is
  // clamped to ≥5s, and totalSeconds (the ring's denominator) grows/shrinks with
  // it so the gold arc stays proportional. Flashes the timer gold (add) or red (trim).
  private extend(deltaSecs: number): void {
    // Clamp to [5s, 12h] — "add time" can't push the session past the 12-hour cap.
    const next = Math.min(MAX_FOCUS_SECONDS, Math.max(5, this.currentRemaining() + deltaSecs));
    this.totalSeconds = Math.min(MAX_FOCUS_SECONDS, Math.max(next, this.totalSeconds + deltaSecs));
    if (this.paused) this.pausedRemainingSec = next;
    else this.endTimeMs = Date.now() + next * 1000;
    this.updateDisplay(next);
    this.flashTime(deltaSecs > 0);
    this.persist();
  }

  /** Brief gold/red pulse on the (single, active) timer text after an add/trim. */
  private flashTime(positive: boolean): void {
    const node = this.timeText;
    if (!node) return;
    const cls = positive ? 'flash-up' : 'flash-down';
    node.classList.remove('flash-up', 'flash-down');
    void node.offsetWidth; // force reflow so the animation restarts
    node.classList.add(cls);
    setTimeout(() => node.classList.remove(cls), 450);
  }

  // --- floating widget ----------------------------------------------------

  private minimize(): void {
    this.overlay?.remove();
    this.overlay = null;
    this.ringEl = null;
    this.ringWrap = null;
    this.timeText = null;
    this.endTimeEl = null;
    this.pauseBtn = null;
    this.musicNameEl = null;
    this.musicPlayBtn = null;
    this.redrawMusicMenu = null;
    // Called straight from the Minimize click, so the user gesture is still live —
    // required for the Document-Picture-in-Picture request inside buildWidget.
    void this.buildWidget();
  }

  /** The minimized screen: a smaller, condensed clone of the overlay's left column.
   *  It REUSES the exact same components (ring, controls, extend rows) so it looks
   *  identical, just scaled down by the .focus-widget CSS. It first tries to detach
   *  into a Document-Picture-in-Picture window — an always-on-top OS window you can
   *  drag ANYWHERE on screen, even outside the browser (like Spotify's mini player).
   *  If that API is unavailable, it falls back to an in-tab draggable float. */
  private async buildWidget(): Promise<void> {
    this.widget?.remove();
    const w = el('div', { class: 'focus-widget' });

    // Maximize → close the float (PiP window or in-tab) and reopen the full overlay.
    const expand = el('button', { class: 'focus-widget-expand', text: '⤢', title: 'Expand' });
    expand.addEventListener('click', (e) => {
      e.stopPropagation();
      this.closePip();
      this.widget?.remove();
      this.widget = null;
      this.buildOverlay();
      if (!this.paused) this.startTicker(); // re-home the clock: its pip-owned interval died with the window
    });

    // Everything the max screen has, stacked vertically: quote → timer + buttons
    // → tasks → music. Same shared components, scaled by the .focus-widget CSS.
    w.append(
      expand,
      el('div', { class: 'focus-quote', text: this.quote }),
      this.buildRing(),
      this.buildEndTime(),
      this.buildControls(),
      this.buildExtendRows(),
      this.buildTaskPanel(),
      this.buildMusicControls()
    );
    this.widget = w;

    // Prefer the detached OS window; fall back to the in-tab float.
    if (await this.openPipWidget(w)) return;
    w.classList.remove('focus-widget-pip');
    this.makeDraggable(w);
    document.body.append(w);
    this.restoreWidgetPos(w);
  }

  /** Move the widget into a Document-Picture-in-Picture window so it floats over
   *  everything and can be positioned anywhere on screen. Returns false (so the
   *  caller uses the in-tab float) when the API is missing or the request is denied. */
  private async openPipWidget(content: HTMLElement): Promise<boolean> {
    const dpip = (window as unknown as { documentPictureInPicture?: { requestWindow(o: { width: number; height: number }): Promise<Window> } }).documentPictureInPicture;
    if (!dpip?.requestWindow) return false;
    try {
      // MEASURE the widget at its PiP size BEFORE opening — a Document-PiP window
      // can't be resized after creation, so we must request the right height up
      // front or the mini player scrolls. Measure it hidden off-screen (its height
      // is fixed by the ring/buttons, independent of width), then request a window
      // ~70px taller to clear the OS title-bar chrome (~56px here) with a margin.
      content.classList.add('focus-widget-pip');
      // Measure at the REAL pip width. Off-screen in the main document, width:100%
      // resolves against the ~full viewport, where the control buttons wrap to
      // FEWER rows than at 300px — so contentH came up short, the window "fit"
      // minus a few px, and the scroller was left with a near-zero range: a
      // full-track thumb that moved nothing (the "dead scrollbar" saga).
      Object.assign(content.style, { position: 'absolute', left: '-9999px', top: '0', visibility: 'hidden', width: '300px' });
      document.body.appendChild(content);
      const contentH = content.offsetHeight || 350;
      Object.assign(content.style, { position: '', left: '', top: '', visibility: '', width: '' });
      content.remove();

      // Fit the closed widget (nothing to scroll → no scrollbar, correct), but cap
      // at the screen: past the cap — or when the music menu grows the content in
      // the unresizable window — there's a REAL range and a short, draggable thumb.
      const winH = Math.min(contentH + 70, Math.round((screen.availHeight || 900) * 0.85));
      const pip = await dpip.requestWindow({ width: 300, height: winH });
      // The PiP window is blank — copy the app's stylesheets so the widget renders
      // with its real theme (colors, ring, buttons, the dark-blue background).
      for (const node of document.querySelectorAll('style, link[rel="stylesheet"]')) {
        pip.document.head.appendChild(node.cloneNode(true));
      }
      pip.document.body.classList.add('focus-pip-body');
      // The mini player deliberately shows NO scrollbar. Chrome's native scrollbar
      // thumb can't be press-and-dragged inside a Document-PiP window (its drag
      // machinery lives in the browser compositor and misbehaves there — a long
      // saga), so rather than ship a bar that lies, the pip hides it entirely and
      // scrolls by WHEEL only (which works natively and is the one gesture users
      // actually use in a window this small). The window is sized to fit the
      // widget anyway, so overflow only exists when the music menu is open.
      // INLINE styles throughout — they beat every cloned rule and :has() quirk.
      const root = pip.document.documentElement;
      root.style.overflow = 'hidden';
      root.style.background = '#070d20';
      pip.document.body.style.cssText = 'margin:0;height:100vh;position:relative;overflow:hidden;';
      const sbHide = pip.document.createElement('style');
      // Only the WINDOW's own scroller hides its bar (locked decision — wheel-only).
      // Inner lists (song list, todos, import panel) keep their gold scrollbars as
      // a position indicator, per Gabe 2026-07-19. Caveat unchanged: no thumb in a
      // Document-PiP window is press-draggable (compositor limitation), so inner
      // bars show WHERE you are; scrolling is still the wheel.
      sbHide.textContent =
        '.focus-pip-scroll::-webkit-scrollbar{display:none}.focus-pip-scroll{scrollbar-width:none}';
      pip.document.head.appendChild(sbHide);
      const scroller = pip.document.createElement('div');
      scroller.className = 'focus-pip-scroll';
      scroller.style.cssText =
        'position:absolute;inset:0;overflow-y:auto;background:linear-gradient(165deg,#0f1c40 0%,#0a1430 55%,#070d20 100%);';
      scroller.appendChild(content); // adopts the live nodes — listeners keep working
      pip.document.body.appendChild(scroller);
      this.pipWindow = pip;
      // Re-home the clock + ring into the PiP window's event loop. The main tab is
      // about to be backgrounded (that's the point of the mini player), and Chrome
      // throttles hidden tabs' timers/rAF — the mini would freeze and lurch.
      if (!this.paused) this.startTicker();
      this.startRingAnimation();
      // User closed the floating window → bring the session back into the tab. Guarded
      // so our own intentional closes (closePip) don't also trigger a rebuild.
      pip.addEventListener('pagehide', () => {
        if (this.pipWindow !== pip) return;
        this.pipWindow = null;
        this.widget = null;
        this.buildOverlay(); // rebuilds the ring (re-homed to this window by buildRing)
        if (!this.paused) this.startTicker(); // the pip-owned interval died with the window
      });
      return true;
    } catch {
      return false; // denied / no gesture — the caller falls back to the in-tab float
    }
  }

  /** Close the detached mini-player window, if any. Clears pipWindow FIRST so the
   *  window's own pagehide handler treats this as an intentional close (no rebuild). */
  private closePip(): void {
    const pip = this.pipWindow;
    this.pipWindow = null;
    if (pip) {
      try {
        pip.close();
      } catch {
        /* already gone */
      }
    }
  }

  /** Restore the widget's last dragged position, clamped into the viewport. */
  private restoreWidgetPos(node: HTMLElement): void {
    try {
      const raw = localStorage.getItem('focusMiniPos');
      if (!raw) return;
      const p = JSON.parse(raw) as { left?: number; top?: number };
      if (typeof p?.left !== 'number' || typeof p?.top !== 'number') return;
      const maxX = Math.max(0, window.innerWidth - node.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - node.offsetHeight);
      node.style.left = `${Math.min(maxX, Math.max(0, p.left))}px`;
      node.style.top = `${Math.min(maxY, Math.max(0, p.top))}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
    } catch {
      /* malformed saved position — ignore, keep the default corner */
    }
  }

  /** Drag the widget anywhere (clamped to the viewport), persisting its position.
   *  Pointerdowns on interactive children don't start a drag; movement only
   *  "activates" past a 4px threshold so taps still register as clicks. */
  private makeDraggable(node: HTMLElement): void {
    let startX = 0;
    let startY = 0;
    let ox = 0;
    let oy = 0;
    let active = false;
    const onMove = (e: PointerEvent) => {
      const dx = e.clientX - startX;
      const dy = e.clientY - startY;
      if (!active && Math.abs(dx) < 4 && Math.abs(dy) < 4) return;
      active = true;
      node.classList.add('dragging');
      const maxX = Math.max(0, window.innerWidth - node.offsetWidth);
      const maxY = Math.max(0, window.innerHeight - node.offsetHeight);
      node.style.left = `${Math.min(maxX, Math.max(0, ox + dx))}px`;
      node.style.top = `${Math.min(maxY, Math.max(0, oy + dy))}px`;
      node.style.right = 'auto';
      node.style.bottom = 'auto';
    };
    const onUp = (e: PointerEvent) => {
      try {
        node.releasePointerCapture(e.pointerId);
      } catch {
        /* capture may not be held */
      }
      node.removeEventListener('pointermove', onMove);
      node.removeEventListener('pointerup', onUp);
      if (active) {
        node.classList.remove('dragging');
        try {
          const r = node.getBoundingClientRect();
          localStorage.setItem('focusMiniPos', JSON.stringify({ left: r.left, top: r.top }));
        } catch {
          /* storage unavailable — position just won't persist */
        }
      }
    };
    const onDown = (e: PointerEvent) => {
      // Interactive + scrollable children handle their own pointer (a carousel wheel
      // must scroll, not drag the widget).
      if ((e.target as HTMLElement).closest('button, input, textarea, select, a, .focus-wheel')) return;
      startX = e.clientX;
      startY = e.clientY;
      const r = node.getBoundingClientRect();
      ox = r.left;
      oy = r.top;
      active = false;
      node.setPointerCapture(e.pointerId);
      node.addEventListener('pointermove', onMove);
      node.addEventListener('pointerup', onUp);
    };
    node.addEventListener('pointerdown', onDown);
  }

  // --- helpers ------------------------------------------------------------

  private persist(suspended = false): void {
    const s: FocusState = {
      sessionActive: true,
      paused: this.paused,
      endTimeMs: this.endTimeMs,
      totalSeconds: this.totalSeconds,
      pausedRemainingSec: this.pausedRemainingSec,
      todos: this.sessionTodos,
      folders: this.taskFolders,
      selectedMusic: this.sessionMusic,
      musicVolume: this.musicVolume,
      musicIndex: this.engine?.currentIndex() ?? 0,
      currentTrackKey: this.engine?.currentTrack()?.key ?? null,
      musicColl: { ...this.musicColl }, // resume the SAME list (artist/playlist/…), not just the track's genre
      // While the session is paused the truth about music lives in musicPlayingAtPause
      // (the track itself is silenced in sync); live sessions read the flag directly.
      musicWasPlaying: this.paused ? this.musicPlayingAtPause : this.musicPlaying,
      quote: this.quote,
      savedAt: Date.now(),
      ownerTab: getTabId(), // one session, one tab — this is the deed of ownership
      suspended, // true only from sign-out teardown → blocks auto-restore
    };
    saveFocusState(s);
  }

  private requestNotifications(): void {
    try {
      if ('Notification' in window && Notification.permission === 'default') {
        void Notification.requestPermission();
      }
    } catch {
      /* ignore */
    }
  }

  /** Fire the "session complete" system notification — but only when the user has
   *  Notifications on AND the "Focus sessions" type enabled (Settings ▸ Notifications).
   *  Routed through sendNotification so it carries the WorkSpace logo like every other
   *  notification (the old bare Notification here had no icon). */
  private async notify(title: string, body: string): Promise<void> {
    try {
      const s = normalizeNotifySettings(await this.data.getProfile('notifications'));
      // Gate on the focus card's OWN channels (the master is a UI select-all, not a
      // gate). Gmail delivers to the account email, which the scheduler installed at
      // boot via setEmailAddress — sendNotification no-ops the email if there is none.
      const popup = s.focusSession.channels.popup;
      const gmail = s.focusSession.channels.gmail;
      if (!popup && !gmail) return;
      sendNotification(title, body, { popup, gmail });

    } catch {
      /* ignore */
    }
  }

  /** Slide-up "session complete" pill (bottom-center). Trophy + label + stats +
   *  dismiss; auto-hides after 10s. Honest label for a session ended early. */
  private showEndToast(
    completed: boolean,
    minutes: number,
    done: number,
    total: number,
    onRetrieve?: () => void
  ): void {
    document.getElementById('focus-end-toast')?.remove();
    const toast = el('div', { class: 'focus-end-toast' });
    toast.id = 'focus-end-toast';

    toast.append(el('div', { class: 'focus-end-toast-icon', text: completed ? '🏆' : '✓' }));

    const body = el('div', { class: 'focus-end-toast-body' });
    body.append(
      el('div', { class: 'focus-end-toast-title', text: completed ? 'SESSION COMPLETE' : 'SESSION ENDED' })
    );
    const sub = el('div', { class: 'focus-end-toast-sub' });
    // Numbers are app-computed (no user text), so innerHTML is safe here.
    sub.innerHTML =
      `<strong>${minutes}m</strong> focused` + (total > 0 ? ` • <strong>${done}/${total}</strong> tasks` : '');
    body.append(sub);
    toast.append(body);

    // Manual ends carry a short-lived undo: Restore lives (and dies) with the toast.
    const retrieve = onRetrieve
      ? el('button', { class: 'focus-end-toast-retrieve', text: 'Restore' })
      : null;
    if (retrieve) toast.append(retrieve);

    const close = el('button', { class: 'focus-end-toast-close', text: '✕', title: 'Dismiss' });
    toast.append(close);

    document.body.append(toast);

    let dismissed = false;
    const dismiss = () => {
      if (dismissed) return;
      dismissed = true;
      toast.classList.remove('show');
      setTimeout(() => toast.remove(), 400); // matches the slide-out transition
    };
    close.addEventListener('click', dismiss);
    retrieve?.addEventListener('click', () => {
      dismiss();
      onRetrieve!();
    });
    // rAF so the off-screen start transform commits before we animate to 0.
    requestAnimationFrame(() => toast.classList.add('show'));
    setTimeout(dismiss, 10000);
  }
}

