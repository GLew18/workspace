// Cobalt: Tasks-tab folders (the "big project" Folders feature).
//
// A folder is a named, colored group of tasks. Membership lives on each task's
// `folderId` (one folder per task); the folder records themselves live in ONE
// profile key ('taskFolders'), like courses and bookmarks groups do. Folders
// render in their own section ABOVE the due-date groups, and a folder dissolves
// the moment every task inside it is completed (or when it has no members left).

import type { Data } from '../db';
import type { Task, TaskFolder, TaskMap } from '../types';
import { genId } from '../util/ids';

const KEY = 'taskFolders';

/** Read the folder list ({ list } wrapper, tolerant of missing/broken data). */
export async function getTaskFolders(data: Data): Promise<TaskFolder[]> {
  const raw = await data.getProfile<{ list?: TaskFolder[] }>(KEY);
  return (raw?.list ?? []).filter(
    (f) => f && typeof f.id === 'string' && typeof f.name === 'string'
  );
}

/** Fired after ANY folder write. Folders are shared between the Tasks tab and
 *  Focus, so each view re-reads on this instead of polling (a profile read is a
 *  network round-trip — see Data.getProfile). */
export const FOLDERS_EVENT = 'ws:folders-changed';

/** Persist the full folder list, then tell every view to re-read. */
export async function saveTaskFolders(data: Data, list: TaskFolder[]): Promise<void> {
  await data.setProfile(KEY, { list });
  window.dispatchEvent(new CustomEvent(FOLDERS_EVENT));
}

/**
 * Persist a change WITHOUT clobbering folders this view has never seen.
 *
 * Both the Tasks tab and Focus write the whole array, and each keeps its own
 * copy — so a view holding a stale list would erase any folder created in the
 * other one (this really happened: a Tasks-side dissolve wiped a folder Focus
 * had just made). Re-read first, apply the delta BY ID, then save.
 */
export async function mutateTaskFolders(
  data: Data,
  removeIds: string[],
  add: TaskFolder[] = []
): Promise<TaskFolder[]> {
  const fresh = await getTaskFolders(data);
  const gone = new Set(removeIds);
  const next = fresh.filter((f) => !gone.has(f.id));
  for (const f of add) if (!next.some((x) => x.id === f.id)) next.push(f);
  await saveTaskFolders(data, next);
  return next;
}

/**
 * Persist a FIELD CHANGE on one existing folder, without clobbering folders this
 * view has never seen.
 *
 * mutateTaskFolders cannot do this job: it only adds folders that are missing and
 * removes them by id, so an edit to a folder already in the stored list would be
 * silently dropped. Same re-read-first discipline, applied to a patch instead.
 *
 * The reason this exists rather than another `saveTaskFolders(data, this.folders)`:
 * the Tasks tab and Focus are BOTH mounted for the whole session (main.ts), each
 * holding its own copy of the list and resyncing only on an async FOLDERS_EVENT.
 * Writing a view's whole array persists whatever that copy last saw, so a folder
 * created in Focus a moment earlier is erased by an unrelated edit in Tasks. That
 * is not hypothetical — see the note on mutateTaskFolders.
 *
 * Returns the fresh, patched list. A no-op (unknown id) still returns the fresh
 * list, so the caller can adopt it either way.
 */
export async function patchTaskFolder(
  data: Data,
  id: string,
  patch: Partial<Omit<TaskFolder, 'id'>>
): Promise<TaskFolder[]> {
  const fresh = await getTaskFolders(data);
  const hit = fresh.find((f) => f.id === id);
  if (!hit) return fresh;
  Object.assign(hit, patch);
  await saveTaskFolders(data, fresh);
  return fresh;
}

/**
 * Move `fromId` into `toId`'s slot and persist the new order. Folder order IS
 * the array order, so this is a splice.
 *
 * Re-reads first for the same reason mutateTaskFolders does: this view's copy of
 * the list may not know about a folder Focus just created, and writing a stale
 * array back would erase it. Returns the fresh, reordered list.
 */
export async function reorderTaskFolders(
  data: Data,
  fromId: string,
  toId: string
): Promise<TaskFolder[]> {
  const list = await getTaskFolders(data);
  const fi = list.findIndex((f) => f.id === fromId);
  const ti = list.findIndex((f) => f.id === toId);
  if (fi < 0 || ti < 0 || fi === ti) return list;
  list.splice(ti, 0, ...list.splice(fi, 1));
  await saveTaskFolders(data, list);
  return list;
}

/** Canonical form for comparing folder names. The quick-add bar's "f:" token is
 *  ONE WORD, so a multi-word folder is typed with a hyphen ("f:AP-Bio") — this
 *  makes that land in the existing "AP Bio" instead of creating a near-duplicate.
 *  Comparison only; the stored name keeps whatever the user actually typed. */
export function normFolder(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

/** Create a folder (color comes from the creating task's course — the caller
 *  resolves it, since course colors live in the registry).
 *
 *  `course` is the creating task's course, remembered as the auto-file default so
 *  the folder's caption already names the right one when it first appears. It is
 *  only ever a DEFAULT: the checkmark starts off, and the student can retype the
 *  course on the caption. */
export function makeFolder(name: string, color: string, course = ''): TaskFolder {
  const f: TaskFolder = { id: 'fold_' + genId(), name: name.trim(), color };
  if (course) f.autoFileCourse = course;
  return f;
}

/** The course a folder auto-files, for the caption and for the sync.
 *
 *  Falls back to the course of any member that has one, because a folder made
 *  from a course-less task still earns the caption the moment something inside it
 *  gets a course (Gabe: "It can be the course of any task, not just the creator").
 *  Returns '' when nothing in the folder has a course — which is exactly when the
 *  caption stays invisible. */
export function autoFileCourseOf(folder: TaskFolder, map: TaskMap): string {
  if (folder.autoFileCourse) return folder.autoFileCourse;
  return folderMembers(folder, map).find((t) => t.course)?.course || '';
}

/** A folder's member tasks (active + completed), from the live task map. */
export function folderMembers(folder: TaskFolder, map: TaskMap): Task[] {
  return Object.values(map).filter((t) => t.folderId === folder.id);
}

/** Folders that should DISSOLVE: every member completed, or no members at all
 *  (last member deleted/purged — an empty folder is an orphan either way). */
export function dissolvedFolders(folders: TaskFolder[], map: TaskMap): TaskFolder[] {
  return folders.filter((f) => {
    const members = folderMembers(f, map);
    return members.length === 0 || members.every((t) => t.completed);
  });
}
