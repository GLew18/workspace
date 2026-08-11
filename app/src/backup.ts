// Cobalt: rolling full-account backups (spec §9.2 / §10).
//
// A daily snapshot of the user's ENTIRE account — tasks + profile (name, courses,
// learned model, Schoology settings) + focus — kept per-uid. Keeps ~14 days, capped
// at ~4MB. NEVER auto-writes to the backend; restore is always an explicit user action.

import { todayStr } from './util/dates';
import type { Task } from './types';

const MAX_SNAPSHOTS = 14;
const MAX_BYTES = 4 * 1024 * 1024;

/** A full point-in-time copy of everything we store for one user. */
export interface AccountBundle {
  tasks: Record<string, Task>;
  profile: Record<string, unknown>;
  focus: Record<string, unknown>;
}

interface Snapshot {
  date: string; // 'YYYY-MM-DD'
  savedAt: string; // ISO
  bundle: AccountBundle;
}

const key = (uid: string) => `ws:backups:${uid}`;

function load(uid: string): Snapshot[] {
  try {
    const raw = JSON.parse(localStorage.getItem(key(uid)) || '[]');
    return Array.isArray(raw) ? raw : [];
  } catch {
    return [];
  }
}

function save(uid: string, snaps: Snapshot[]) {
  // Trim by count first, then by total size.
  let trimmed = snaps.slice(-MAX_SNAPSHOTS);
  let serialized = JSON.stringify(trimmed);
  while (serialized.length > MAX_BYTES && trimmed.length > 1) {
    trimmed = trimmed.slice(1);
    serialized = JSON.stringify(trimmed);
  }
  try {
    localStorage.setItem(key(uid), serialized);
  } catch {
    /* quota — drop the oldest and retry once */
    try {
      localStorage.setItem(key(uid), JSON.stringify(trimmed.slice(1)));
    } catch {
      /* give up silently; backups are best-effort */
    }
  }
}

/** True when a bundle holds nothing — so we never overwrite good history with a blank. */
export function isEmptyBundle(b: AccountBundle | null | undefined): boolean {
  if (!b) return true;
  return (
    !Object.keys(b.tasks ?? {}).length &&
    !Object.keys(b.profile ?? {}).length &&
    !Object.keys(b.focus ?? {}).length
  );
}

/** Record a full-account snapshot at most once per day (refreshing today's in place).
 *  A completely empty account is never snapshotted, so a wipe can't erase good history. */
export function snapshotIfNeeded(uid: string, bundle: AccountBundle): void {
  if (isEmptyBundle(bundle)) return;
  const snaps = load(uid);
  const today = todayStr();
  const entry: Snapshot = { date: today, savedAt: new Date().toISOString(), bundle };
  if (snaps.length && snaps[snaps.length - 1].date === today) {
    // Refresh today's snapshot in place with the latest state.
    snaps[snaps.length - 1] = entry;
  } else {
    snaps.push(entry);
  }
  save(uid, snaps);
}

/** List available snapshots (newest first). */
export function listBackups(uid: string): { date: string; savedAt: string; taskCount: number }[] {
  return load(uid)
    .map((s) => ({ date: s.date, savedAt: s.savedAt, taskCount: Object.keys(s.bundle?.tasks ?? {}).length }))
    .reverse();
}

/** The most recent snapshot's full bundle, or null. */
export function latestBundle(uid: string): AccountBundle | null {
  const snaps = load(uid);
  return snaps.length ? snaps[snaps.length - 1].bundle : null;
}
