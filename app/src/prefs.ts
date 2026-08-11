// Cobalt: app-wide preferences (the Settings "Preferences" / "Dashboard" /
// "Syncing" / "Import" / Focus toggles).
//
// One profile key ('prefs') holds them all. A module-level cache makes reads
// synchronous everywhere (main.ts loads it once at boot; Settings updates it and
// fires PREFS_EVENT so live views — e.g. the Dashboard — can repaint).

export interface AppPrefs {
  /** '12h' shows 2:30pm; '24h' shows 14:30. (Persisted; display wiring is phased.) */
  timeFormat: '12h' | '24h';
  /** Which tab the app opens to. */
  openTo: 'dashboard' | 'tasks' | 'bookmarks' | 'focus';
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
  };
  focus: {
    /** Persisted; the M:SS vs minutes-only display option is phased. */
    showSeconds: boolean;
    /** Keep the display awake during a session (Screen Wake Lock). */
    keepAwake: boolean;
    /** Start the chosen focus music the moment a session starts. */
    autoStartMusic: boolean;
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
  tasks: { allowEdit: true },
  focus: { showSeconds: true, keepAwake: true, autoStartMusic: true },
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
    openTo: pick(r.openTo, ['dashboard', 'tasks', 'bookmarks', 'focus'] as const, d.openTo),
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
    },
    focus: {
      showSeconds: bool(r.focus?.showSeconds, d.focus.showSeconds),
      keepAwake: bool(r.focus?.keepAwake, d.focus.keepAwake),
      autoStartMusic: bool(r.focus?.autoStartMusic, d.focus.autoStartMusic),
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
