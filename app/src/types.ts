// Cobalt: shared data types.

export type Priority = 'highest' | 'high' | 'normal' | 'low' | 'lowest';

export type TaskSource = 'manual' | 'schoology-ical' | 'schoology';

/** A link attachment on a task (URLs only). */
export interface Note {
  id: string; // 'n_' + genId()
  title: string;
  url: string;
}

export interface Task {
  id: string; // 'manual_<genId>' | 'ical_<UID>' | 'sch_<eventId>' | 'dup_<id>'
  title: string;
  dueDate: string; // 'YYYY-MM-DD' | ''
  dueTime: string; // 'HH:MM' (24h) | ''
  timeLabel: string; // free-text time label; shares the slot with dueTime
  course: string; // canonical course name | ''
  source: TaskSource;
  completed: boolean;
  completedAt: string | null; // ISO
  /**
   * RETIRED TO THE TASK ARCHIVES (Gabe, 8/21) — a completed task whose day has
   * passed. Set by Data.archiveStaleCompleted at boot, which is where completed
   * tasks used to be DELETED outright. Nothing in the app hides a task because of
   * this flag (every list already filters on `completed`); it exists so the two
   * counters that measure "today" — the daily lightbulb and the calendar grid —
   * can tell a task finished today apart from one dug out of last month.
   */
  archived?: boolean;
  priority: Priority;
  addedAt: string; // ISO
  /** Manual ⋮⋮ drag position within the task's due-date group. Absent = never
   *  hand-placed; those sort by the natural criteria, below the arranged ones. */
  manualOrder?: number;
  notes: Note[];
  /** Long-form description (e.g. assignment instructions imported from Schoology). */
  details?: string;
  schoologyUrl?: string;
  schoologyEventId?: string;
  // Edit-protection flags: once a user manually edits a field, imports won't overwrite it.
  _manualTitle?: boolean;
  _manualDueDate?: boolean;
  _manualCourse?: boolean;
  _isDuplicate?: boolean;
  /** A re-sync altered this imported task — lists WHAT changed ('name',
   *  'due date', 'due time', 'instructions', 'link'), accumulating across syncs
   *  until the user dismisses the ✱ badge on the task row by clicking it. */
  feedUpdated?: string[];
  /**
   * WHAT THE TASK SAID BEFORE (Gabe, 8/22) — the ghost the ✱ badge opens.
   *
   * `feedUpdated` names the fields a re-sync touched; this holds their VALUES as
   * they stood before it did, so the badge can show a real before/after instead of
   * a list of field names the student has to reconcile from memory. Rendered by
   * tasks/feedDiff.ts.
   *
   * FIRST WRITE WINS, per field, and it is cleared with `feedUpdated` when the
   * student dismisses the badge. So this is always "the version you last
   * acknowledged", not "the version before the most recent sync": three syncs that
   * each nudge a deadline should read "was Monday, now Thursday".
   */
  feedPrev?: {
    title?: string;
    dueDate?: string;
    dueTime?: string;
    details?: string;
    schoologyUrl?: string;
  };
  /** Folder membership (Tasks tab folders — profile 'taskFolders'). A task lives
   *  in at most ONE folder; foldered tasks render inside their folder's section
   *  instead of the main due-date groups. */
  folderId?: string;
  /** Optional AI-picked emoji prefix for the title. */
  emoji?: string;
  /** Cached English translation of a foreign-language title + its detected source
   *  language code (e.g. "iw"). Shown beneath the title everywhere the task
   *  appears (Tasks list, Focus), so translating once carries to every copy. */
  translatedTitle?: string;
  translatedLang?: string;
  /** True once the auto-translate pass has read this title (foreign OR English),
   *  so English/undetectable titles aren't re-checked on every load. Cleared when
   *  the title is edited. */
  translationChecked?: boolean;
  /** User hid the translation line via the 🌐 toggle (default shown). */
  translationHidden?: boolean;
  /** The auto pass declined this title because nothing was SURE enough, rather than
   *  because it read as English. There is a real question here, so the row offers
   *  "Translate from..." on its own instead of waiting to be found in the menu.
   *  See isAmbiguous in util/translate.ts (Gabe, 8/20). */
  translationAmbiguous?: boolean;
  /** This translation is the STUDENT'S pick from the readings menu, not the app's
   *  reading of the title. It outranks the auto pass: a re-scan must never overwrite
   *  an answer a person gave, and the tooltip says whose answer it is. */
  translationChosen?: boolean;
  /** What auto-detect guessed when it was not sure enough to act on it. Kept only to
   *  ORDER the language buttons on an unplaced title, so the likeliest answer is the
   *  first one under the student's thumb. Never displayed as a claim. */
  translationDetected?: string;
  /**
   * LANGUAGES THE PROVIDER HAS ALREADY REFUSED for this exact title (Gabe, 8/21).
   *
   * Asking Google to read a Vietnamese sentence as French returns the sentence back
   * unchanged: that is the engine saying it cannot read this as French. The app was
   * already reporting that in a toast and then offering French again on the next
   * redraw, which is the app admitting a language is not a contender and continuing
   * to present it as one.
   *
   * So the refusal is kept. A code in here is not a ranking penalty, it is an
   * exclusion: that language is not offered for this title again, not even behind
   * "more". Per TITLE, because it is a fact about these words rather than about the
   * language or the student.
   */
  translationRuledOut?: string[];
  /**
   * THE READINGS THAT ACTUALLY WORK, checked before any of them was offered.
   *
   * Language code to the English it produces. Written by the verification pass, which
   * asks the provider to read this title as each candidate language BEFORE the buttons
   * are drawn, and keeps only the ones that came back as English rather than as the
   * title again (Gabe, 8/21). Two things follow from it: a language that cannot read
   * the title is never shown, and pressing one of the buttons that IS shown costs
   * nothing, because the answer is already here.
   */
  translationOptions?: Record<string, string>;
  /** The verification pass has finished for this title, whatever it found. Stops the
   *  work repeating on every render and every reload. */
  /**
   * THE TITLE the verification above was run against, and the ONLY record that it
   * happened.
   *
   * There used to be a separate `translationVerified` boolean beside it, which is one
   * fact stored twice and therefore a fact that can contradict itself: a write that
   * set the flag but not the title left the app believing in a verification it could
   * not place. That happened, in a test, within a day of the field being added
   * (Gabe, 8/21). Set means verified, and what it is set TO says what it covers.
   *
   * The belt to clearTranslation's braces, and the reason it exists is that the
   * braces had already failed twice. Any path that changes a title without clearing
   * the translation state leaves options describing words that are gone; comparing
   * this to the live title catches that at RENDER time, whoever forgot, so the row
   * re-verifies instead of filtering the new title's candidates through the old
   * title's answers and finding nothing (Gabe, 8/21). Also heals tasks already
   * carrying stale state from before this existed.
   */
  translationVerifiedFor?: string;

  /**
   * THE SAME TEN FIELDS AGAIN, FOR THE DESCRIPTION (Gabe, 8/22: "extrapolate the
   * whole language system to description as well, same mechanism, everything as
   * title").
   *
   * A foreign-language assignment does not stop being foreign below the title, and
   * the instructions are the part a student actually has to understand. So `details`
   * gets the identical treatment: read automatically, translated underneath, language
   * changeable, refusals remembered, hideable.
   *
   * Named for the field they describe rather than reusing the `translation*` prefix,
   * because that prefix already means "the title's" on every task in every account
   * and renaming it would be a migration that buys nothing. Which set belongs to
   * which text is stated once, in tasks/txSlot.ts, and every piece of the pipeline
   * reads it from there.
   */
  detailsTranslated?: string;
  detailsLang?: string;
  detailsChecked?: boolean;
  detailsHidden?: boolean;
  detailsAmbiguous?: boolean;
  detailsChosen?: boolean;
  detailsDetected?: string;
  detailsRuledOut?: string[];
  detailsOptions?: Record<string, string>;
  detailsVerifiedFor?: string;

  /** User dismissed the QUIZ/TEST pill via its hover ✕ — "test" was just a word
   *  in the title, not an actual assessment. Render-time only; never re-badges. */
  assessmentDismissed?: boolean;
}

/** A Tasks-tab folder: a named, colored group of tasks (membership lives on each
 *  task's `folderId`). Color is auto-set from the creating task's course color.
 *  Stored as profile 'taskFolders' → { list: TaskFolder[] }. */
export interface TaskFolder {
  id: string; // 'fold_<genId>'
  name: string;
  color: string;
}

/** Parser output for the natural-language quick-add box. */
export interface ParsedTask {
  title: string;
  dueDate: string;
  dueTime: string;
  timeLabel: string;
  course: string;
  priority: Priority;
  /** "f:NAME" in the quick-add bar: put the new task in folder NAME (joining it
   *  if it already exists, creating it otherwise). */
  folderName?: string;
}

export interface Profile {
  displayName: string;
  email: string;
  schoolDomain?: string;
  schoologyUserId?: string;
  schoologyIcalUrl?: string;
  createdAt: string; // ISO
}

/** A task map keyed by task id, as stored at users/{uid}/tasks. */
export type TaskMap = Record<string, Task>;

/** A user-configurable course: name, color, and the parse words that map to it. */
export interface CourseConfig {
  id: string; // 'course_' + genId()
  name: string; // canonical/display name
  color: string; // hex
  parseWords: string[]; // lowercased keywords/teacher names/room numbers → this course
}

/** A current/upcoming-week schedule entry (from Schoology "Schedule" calendar posts). */
export interface ScheduleItem {
  id: string; // ical UID-derived
  title: string;
  date: string; // 'YYYY-MM-DD'
  url: string; // deep link to the post on Schoology
}

/** Schoology connection + sync state, stored at profile/schoology. */
export interface SchoologySettings {
  icalUrl: string;
  lastSyncAt: string | null; // ISO
  lastSyncCount?: number;
}
