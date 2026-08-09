// WorkSpace — crash-safe focus persistence (spec §8.3). Per-device, localStorage only.
//
// OWNERSHIP: a session belongs to exactly ONE browser tab (ownerTab in the state).
// Other tabs never run it — they show a persistent "Enter focus session" toast, and
// clicking it transfers ownership (the old owner hears the localStorage 'storage'
// event and quietly drops its UI). Sign-out marks the state `suspended`, which
// blocks any auto-restore: the next sign-in offers a "Restore" toast instead.

export const FOCUS_STATE_KEY = 'focus:state:v1';
const KEY = FOCUS_STATE_KEY;
const TAB_ID_KEY = 'focus:tabId';

export interface FocusTodo {
  id: string;
  text: string;
  done: boolean;
  taskId?: string; // links back to a task in users/{uid}/tasks
  // Visual fields stashed at import time so the session keeps its course color /
  // Schoology link even if a later sync re-keys or removes the source task.
  course?: string;
  schoologyUrl?: string;
  /** Due date/time, stashed at import so the session shows the same "course · date"
   *  line as the Tasks tab and the import list. Kept in step by onTasksUpdate. */
  dueDate?: string;
  dueTime?: string;
  // Translation stashed at import so a foreign task keeps its English line in Focus.
  translatedTitle?: string;
  translatedLang?: string;
  /** Folder membership — a SHARED TaskFolder.id, the same value the linked task
   *  carries in Tasks (folders are one list across both tabs; the old
   *  session-scoped FocusFolder namespace is gone). */
  folderId?: string;
}

/** A focus-side folder: groups todos within the setup list / running session.
 *  Independent namespace from Tasks-tab folders — created in the Focus tab, or
 *  spawned automatically when a Tasks-tab folder is imported whole. */
export interface FocusFolder {
  id: string; // 'ffold_<genId>'
  name: string;
  color: string;
  /** Set when this folder mirrors an imported Tasks-tab folder (its id). */
  fromTaskFolder?: string;
}

/** Which kind of music collection is playing (genre / artist / the favorites list /
 *  a custom playlist / the pooled minor-artists list). */
export type MusicCollKind = 'genre' | 'artist' | 'various' | 'favorites' | 'playlist';

export interface FocusState {
  sessionActive: boolean;
  paused: boolean;
  endTimeMs: number;
  totalSeconds: number;
  pausedRemainingSec: number | null;
  todos: FocusTodo[];
  /** Focus folders grouping the session's todos. Optional: older saved states
   *  predate folders and restore with none. */
  folders?: FocusFolder[];
  selectedMusic: string | null; // music collection key ('queens-gambit' | 'none' | custom id)
  musicVolume?: number; // live session music volume (0–100); optional for older saved states
  musicIndex: number;
  currentTrackKey: string | null;
  /** The collection the music was playing FROM (artist / playlist / favorites…), so a
   *  reload resumes the same list — not just the track's genre. Optional: older saved
   *  states predate it and fall back to the genre. */
  musicColl?: { kind: MusicCollKind; key: string };
  /** Was the track audible when the session was last live (or armed to resume with
   *  it)? Restores use this to re-arm the pause→resume music linkage. Optional:
   *  older saved states fall back to "a track was selected". */
  musicWasPlaying?: boolean;
  quote: string;
  savedAt: number;
  /** The one tab this session runs in (see getTabId). Other tabs only offer "Enter". */
  ownerTab?: string;
  /** Set on sign-out: blocks ALL auto-restore — the next sign-in offers "Restore". */
  suspended?: boolean;
}

export function saveFocusState(s: FocusState): void {
  try {
    localStorage.setItem(KEY, JSON.stringify(s));
  } catch {
    /* ignore quota */
  }
}

export function loadFocusState(): FocusState | null {
  try {
    return JSON.parse(localStorage.getItem(KEY) || 'null');
  } catch {
    return null;
  }
}

export function clearFocusState(): void {
  localStorage.removeItem(KEY);
}

/** Stable identity for THIS browser tab (survives reloads via sessionStorage;
 *  every tab gets its own). Ownership of a session = state.ownerTab === getTabId(). */
export function getTabId(): string {
  let id = sessionStorage.getItem(TAB_ID_KEY);
  if (!id) {
    id = 'tab_' + Math.random().toString(36).slice(2, 10);
    sessionStorage.setItem(TAB_ID_KEY, id);
  }
  return id;
}

/** Does the saved session belong to THIS tab? (Old states without ownerTab — from
 *  before ownership existed — are treated as unowned: offered, never auto-run.) */
export function ownsSession(s: FocusState | null): boolean {
  return !!s?.ownerTab && s.ownerTab === getTabId();
}
