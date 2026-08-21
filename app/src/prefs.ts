// Cobalt: app-wide preferences (the Settings "Preferences" / "Dashboard" /
// "Syncing" / "Import" / Focus toggles).
//
// One profile key ('prefs') holds them all. A module-level cache makes reads
// synchronous everywhere (main.ts loads it once at boot; Settings updates it and
// fires PREFS_EVENT so live views — e.g. the Dashboard — can repaint).

/** The OPTIONAL task-row controls, i.e. everything that can be demoted into the
 *  row's "…" menu. ↗ Schoology, ⓘ description and the priority arrow are
 *  deliberately NOT here: those three are permanent. The first two are what the
 *  student actually presses, and priority is the only way to set priority now
 *  that the colored strip is dormant, so hiding it would strand the feature. */
import { DEFAULT_TRANSLATE_FROM } from './util/languages';

export type PinnedAction = 'translate' | 'readings' | 'attach' | 'folder' | 'duplicate';
export const PINNABLE: PinnedAction[] = ['translate', 'readings', 'attach', 'folder', 'duplicate'];

export interface AppPrefs {
  /** '12h' shows 2:30pm; '24h' shows 14:30. (Persisted; display wiring is phased.) */
  timeFormat: '12h' | '24h';
  /** Which tab the app opens to (and where the wordmark returns you). Listed in
   *  the app's own nav order: Focus outranks Bookmarks. */
  openTo: 'dashboard' | 'tasks' | 'focus' | 'bookmarks';
  dash: {
    /** Use the display name inside the rotating greeting. */
    greetName: boolean;
    /** Show the daily quote under the greeting. */
    quote: boolean;
    /** Which quote flavor rotates (library in src/quotes.ts; 'mixed' blends all). */
    quoteStyle: 'stoic' | 'modern' | 'literary' | 'science' | 'mixed';
    /** Show the Today's Tasks card. */
    tasksCard: boolean;
    /** Show the weekly Schedule card. */
    scheduleCard: boolean;
  };
  sync: {
    /** Background re-sync while the app is open. */
    auto: boolean;
    intervalMins: 15 | 30 | 60;
    /** Run a sync the moment the app opens. */
    onOpen: boolean;
  };
  importPrefs: {
    assignments: boolean;
    /** Calendar events that look like tests/exams/midterms/finals. */
    assessments: boolean;
    /** Calendar events that look like quizzes. */
    quizzes: boolean;
    /** How far ahead to pull, in days. */
    windowDays: 14 | 30 | 60;
  };
  tasks: {
    /** Allow editing a task's INTRINSIC fields — title, course, due date/time —
     *  from the Tasks tab and Focus. ON by default (Gabe, 8/6/26, reversing the
     *  earlier locked-by-default call: "editing tasks is really important").
     *  The switch stays, so anyone who wants imports frozen can still lock them.
     *  Subjective fields (priority, folders, attachments, done) ignore this and
     *  are always editable. */
    allowEdit: boolean;
    /** Which OPTIONAL row controls the student has pinned to the task row (Gabe,
     *  8/13). Everything not listed here lives behind the row's "…" menu.
     *
     *  Phrased POSITIVELY (a pinned id is present) to match every other pref in
     *  this file, and because the natural default is "nothing pinned": a control
     *  that has real content behind it, an attachment, a folder, a translation,
     *  promotes itself onto the row without ever being listed here. Pinning is
     *  only for forcing an EMPTY control to stay visible. */
    pinnedActions: PinnedAction[];
    /** WHICH LANGUAGES COBALT WILL TRANSLATE A TASK TITLE FROM (Gabe, 8/15).
     *
     *  An allowlist, not a blocklist, and that direction is the whole point. Asking
     *  the detector "is this any language at all" is what turned "huu" into "this
     *  one" (real Swahili, reported at full confidence) and "heybo" into "Hey
     *  there" — short English-ish tokens will always hit a real word somewhere.
     *  Asking "is this one of the languages MY classes are in" removes that entire
     *  class of false positive at once. Anything omitted is simply left alone.
     *
     *  Empty is a legitimate value: it turns translation off. */
    translateFrom: string[];
  };
  sound: {
    /** The app's incidental sounds: today that means the two-note chime when a task
     *  is checked off. ON by default. Deliberately does NOT cover the sounds the
     *  student asked for on purpose (the focus end cue, which has its own switch,
     *  and music), because those are the point rather than background feedback
     *  (Gabe, 8/15). Any future incidental sound belongs behind this same flag. */
    system: boolean;
  };
  focus: {
    /** Persisted; the M:SS vs minutes-only display option is phased. */
    showSeconds: boolean;
    /** Keep the display awake during a session (Screen Wake Lock). */
    keepAwake: boolean;
    /** Start the chosen focus music the moment a session starts. */
    autoStartMusic: boolean;
    /** Reloading the page mid-session KEEPS THE CLOCK RUNNING instead of landing
     *  paused (Gabe, 8/11). Off by default: a reload is usually accidental or a
     *  crash, and coming back to a paused clock loses nothing, whereas silently
     *  resuming could burn minutes the student never meant to spend. Only the
     *  automatic mid-session reload honors it; the sign-out "Restore?" prompt and
     *  a cross-tab handoff still land paused, because those are questions. */
    resumeAfterReload: boolean;
    /**
     * TIME ACCOUNTABILITY (Gabe, 8/20). On, the +/- buttons disappear for the whole
     * session: the length you committed to is the length you serve. The point is to
     * remove the negotiation, so "just five more minutes" and "I'll trim ten off"
     * both stop being available at the moment you most want them.
     *
     * OFF by default, because it takes something away and nobody should meet it
     * without choosing it.
     *
     * It cannot be switched OFF while a session is running. That rule is the entire
     * feature: a lock you can pick the instant it binds is not a lock, it is a
     * suggestion. Turning it ON mid-session is always allowed, since that only ever
     * makes the commitment stricter. See FocusView's accountabilityOn.
     */
    timeAccountability: boolean;
    /**
     * Do finished session todos collect under a "Finished (N)" drawer, or just sit
     * at the bottom of the list? ON by default, which is the behaviour that has
     * always shipped: done work gets out of the way.
     *
     * Off for anyone who would rather see everything at once (Gabe, 8/20). A
     * session list is short, and one student's clutter is another's evidence that
     * the hour went somewhere.
     */
    groupFinished: boolean;
    /** Are Focus todos and Tasks ONE list, or two independent systems?
     *  ON (default): adding a todo in Focus creates the real task, edits and
     *  check-offs travel both ways, and the two tabs are one system.
     *  OFF: the Focus list is private to Focus. Import still works (it copies a
     *  task in), but nothing written in Focus reaches the Tasks tab afterwards. */
    linkTasks: boolean;
  };
  calendar: {
    /** Which layout the Tasks tab opens in. */
    defaultScreen: 'list' | 'calendar';
    /** 0 = Sunday-first, 1 = Monday-first. */
    weekStart: 0 | 1;
    defaultView: 'month' | 'week';
    density: 'comfortable' | 'compact';
    /** Keep checked-off chips visible on the calendar. */
    showCompleted: boolean;
    /** Opening the calendar jumps to the first month holding an active task. */
    jumpToEarliest: boolean;
    /** What the chip strip color encodes. */
    colorBy: 'priority' | 'course';
  };
}

export const DEFAULT_PREFS: AppPrefs = {
  timeFormat: '12h',
  openTo: 'dashboard',
  dash: { greetName: true, quote: true, quoteStyle: 'modern', tasksCard: true, scheduleCard: true },
  sync: { auto: true, intervalMins: 30, onOpen: true },
  importPrefs: { assignments: true, assessments: true, quizzes: true, windowDays: 30 },
  tasks: { allowEdit: true, pinnedActions: [], translateFrom: [...DEFAULT_TRANSLATE_FROM] },
  sound: { system: true },
  focus: { showSeconds: true, keepAwake: true, autoStartMusic: true, resumeAfterReload: false, timeAccountability: false, groupFinished: true, linkTasks: true },
  calendar: {
    defaultScreen: 'list',
    weekStart: 0,
    defaultView: 'month',
    density: 'comfortable',
    showCompleted: false,
    jumpToEarliest: false,
    colorBy: 'priority',
  },
};

/** Coerce whatever is stored into a complete, well-typed prefs object. */
export function normalizePrefs(raw: unknown): AppPrefs {
  const r = (raw ?? {}) as Partial<AppPrefs> & Record<string, any>;
  const d = DEFAULT_PREFS;
  const bool = (v: unknown, def: boolean) => (typeof v === 'boolean' ? v : def);
  const pick = <T,>(v: unknown, allowed: readonly T[], def: T): T =>
    allowed.includes(v as T) ? (v as T) : def;
  return {
    timeFormat: pick(r.timeFormat, ['12h', '24h'] as const, d.timeFormat),
    openTo: pick(r.openTo, ['dashboard', 'tasks', 'focus', 'bookmarks'] as const, d.openTo),
    dash: {
      greetName: bool(r.dash?.greetName, d.dash.greetName),
      quote: bool(r.dash?.quote, d.dash.quote),
      quoteStyle: pick(r.dash?.quoteStyle, ['stoic', 'modern', 'literary', 'science', 'mixed'] as const, d.dash.quoteStyle),
      tasksCard: bool(r.dash?.tasksCard, d.dash.tasksCard),
      scheduleCard: bool(r.dash?.scheduleCard, d.dash.scheduleCard),
    },
    sync: {
      auto: bool(r.sync?.auto, d.sync.auto),
      intervalMins: pick(r.sync?.intervalMins, [15, 30, 60] as const, d.sync.intervalMins),
      onOpen: bool(r.sync?.onOpen, d.sync.onOpen),
    },
    importPrefs: {
      assignments: bool(r.importPrefs?.assignments, d.importPrefs.assignments),
      assessments: bool(r.importPrefs?.assessments, d.importPrefs.assessments),
      quizzes: bool(r.importPrefs?.quizzes, d.importPrefs.quizzes),
      windowDays: pick(r.importPrefs?.windowDays, [14, 30, 60] as const, d.importPrefs.windowDays),
    },
    tasks: {
      allowEdit: bool(r.tasks?.allowEdit, d.tasks.allowEdit),
      // Filtered against PINNABLE, so a stale id from an older build (or a hand-
      // edited profile) can never reach the renderer as an unknown control.
      pinnedActions: Array.isArray(r.tasks?.pinnedActions)
        ? (r.tasks!.pinnedActions as unknown[]).filter((a): a is PinnedAction =>
            PINNABLE.includes(a as PinnedAction)
          )
        : [...d.tasks.pinnedActions],
      // An ABSENT key means an older profile that predates the picker → fall back to
      // the defaults. An empty ARRAY is a real choice (translation off) and is kept.
      translateFrom: Array.isArray(r.tasks?.translateFrom)
        ? (r.tasks!.translateFrom as unknown[])
            .filter((c): c is string => typeof c === 'string' && !!c.trim())
            .map((c) => c.toLowerCase().trim())
        // COPIED, not shared. Returning the defaults array by reference would hand
        // every caller the same live array as DEFAULT_PREFS, so one in-place edit
        // anywhere would silently rewrite the defaults for the whole session.
        : [...d.tasks.translateFrom],
    },
    sound: {
      system: bool(r.sound?.system, d.sound.system),
    },
    focus: {
      showSeconds: bool(r.focus?.showSeconds, d.focus.showSeconds),
      keepAwake: bool(r.focus?.keepAwake, d.focus.keepAwake),
      autoStartMusic: bool(r.focus?.autoStartMusic, d.focus.autoStartMusic),
      resumeAfterReload: bool(r.focus?.resumeAfterReload, d.focus.resumeAfterReload),
      timeAccountability: bool(r.focus?.timeAccountability, d.focus.timeAccountability),
      groupFinished: bool(r.focus?.groupFinished, d.focus.groupFinished),
      linkTasks: bool(r.focus?.linkTasks, d.focus.linkTasks),
    },
    calendar: {
      defaultScreen: pick(r.calendar?.defaultScreen, ['list', 'calendar'] as const, d.calendar.defaultScreen),
      weekStart: pick(r.calendar?.weekStart, [0, 1] as const, d.calendar.weekStart),
      defaultView: pick(r.calendar?.defaultView, ['month', 'week'] as const, d.calendar.defaultView),
      density: pick(r.calendar?.density, ['comfortable', 'compact'] as const, d.calendar.density),
      showCompleted: bool(r.calendar?.showCompleted, d.calendar.showCompleted),
      jumpToEarliest: bool(r.calendar?.jumpToEarliest, d.calendar.jumpToEarliest),
      colorBy: pick(r.calendar?.colorBy, ['priority', 'course'] as const, d.calendar.colorBy),
    },
  };
}

/** Fired on window whenever Settings changes a pref; detail = the new AppPrefs. */
export const PREFS_EVENT = 'ws:prefs-changed';

let current: AppPrefs = DEFAULT_PREFS;

/** Synchronous read of the current prefs (cache loaded at boot). */
export const getPrefs = (): AppPrefs => current;

/** Replace the cache (boot load / settings change). Does NOT persist or notify. */
export function setPrefsCache(p: AppPrefs): void {
  current = p;
}
