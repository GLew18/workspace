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

/** Persist the full folder list. */
export async function saveTaskFolders(data: Data, list: TaskFolder[]): Promise<void> {
  await data.setProfile(KEY, { list });
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
