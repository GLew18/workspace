// WorkSpace — Tasks-tab folders (the "big project" Folders feature).
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

/** Canonical form for comparing folder names. The quick-add bar's "f:" token is
 *  ONE WORD, so a multi-word folder is typed with a hyphen ("f:AP-Bio") — this
 *  makes that land in the existing "AP Bio" instead of creating a near-duplicate.
 *  Comparison only; the stored name keeps whatever the user actually typed. */
export function normFolder(name: string): string {
  return name.trim().toLowerCase().replace(/[-_]+/g, ' ').replace(/\s+/g, ' ');
}

/** Create a folder (color comes from the creating task's course — the caller
 *  resolves it, since course colors live in the registry). */
export function makeFolder(name: string, color: string): TaskFolder {
  return { id: 'fold_' + genId(), name: name.trim(), color };
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
