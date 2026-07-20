// WorkSpace — shared data types.

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
