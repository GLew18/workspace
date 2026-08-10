// WorkSpace — data orchestrator.
//
// Wraps a Backend with the non-negotiable safety from spec §9.2 / §10:
//   • per-uid scoping (the backend already enforces this)
//   • self-echo suppression (ignore our own write echoes, and pause while editing)
//   • anti-wipe guard (refuse to accept a sudden "everything is empty" if we know
//     this user had data; surface a restore instead of rendering/writing the wipe)
//   • rolling localStorage backups

import type { Backend } from './backend';
import { LocalBackend } from './backend';
import { hasFirebaseConfig } from './firebase';
import type { Task, TaskMap } from './types';
import { snapshotIfNeeded, latestBundle, isEmptyBundle, type AccountBundle } from './backup';
import { todayStr } from './util/dates';

const ECHO_WINDOW_MS = 2000;

/**
 * Firebase Realtime Database silently drops empty arrays on write, so a task saved
 * with notes: [] reads back with notes undefined. Coerce every task to a safe shape
 * as it enters the app — the single boundary all stored tasks pass through — so views
 * can always rely on notes being an array.
 */
function normalizeTask(t: Task): Task {
  return { ...t, notes: Array.isArray(t.notes) ? t.notes : [] };
}
function normalizeTasks(map: TaskMap): TaskMap {
  const out: TaskMap = {};
  for (const id in map) out[id] = normalizeTask(map[id]);
  return out;
}

export interface TasksUpdate {
  tasks: TaskMap;
  /** True when the backend reported empty but we have evidence this user had data. */
  suspectedWipe: boolean;
}

export class Data {
  readonly uid: string;
  private backend: Backend;
  private lastWriteAt = 0;
  private renderLocked = false;
  private lastTasks: TaskMap = {};
  private taskCbs = new Set<(u: TasksUpdate) => void>();
  private subscribed = false;
  // How many bulk writes are in flight. A COUNTER, not a flag: two overlapping
  // bulks (an edit landing while the translate sweep writes) used to have the
  // first one to finish clear the flag for both, re-opening the echo storm.
  private bulkDepth = 0;

  private constructor(backend: Backend) {
    this.backend = backend;
    this.uid = backend.uid;
  }

  static async create(uid: string): Promise<Data> {
    let backend: Backend;
    if (hasFirebaseConfig) {
      const { createFirebaseBackend } = await import('./firebase-backend');
      backend = await createFirebaseBackend(uid);
    } else {
      backend = new LocalBackend(uid);
    }
    return new Data(backend);
  }

  /**
   * Build a Data over a caller-supplied backend, bypassing the Firebase/Local
   * selection. Used only by the landing-page sandbox, which injects a throwaway
   * in-memory backend so the real app views can run as a live, non-persistent
   * sample (nothing ever reaches Firebase or localStorage).
   */
  static createWithBackend(backend: Backend): Data {
    return new Data(backend);
  }

  /** Pause re-renders triggered by remote callbacks (e.g. while the user is typing an edit). */
  setRenderLocked(locked: boolean): void {
    this.renderLocked = locked;
  }

  private hadDataKey() {
    return `ws:hadData:${this.uid}`;
  }

  private onboardedKey() {
    return `ws:onboarded:${this.uid}`;
  }
  /** Local mirror of "this account finished onboarding". Lets us tell a brand-new
   *  user apart from a transient empty read of the account, so we never re-run
   *  onboarding (which would overwrite the saved profile) just because a read blanked. */
  wasOnboardedLocally(): boolean {
    return localStorage.getItem(this.onboardedKey()) === '1';
  }
  markOnboardedLocally(): void {
    localStorage.setItem(this.onboardedKey(), '1');
  }

  /** Begin a live subscription to the user's tasks. Supports multiple consumers (e.g. Dashboard + Tasks). */
  watchTasks(cb: (u: TasksUpdate) => void): void {
    this.taskCbs.add(cb);
    if (!this.subscribed) {
      this.subscribed = true;
      this.backend.subscribe<Task>('tasks', (value) => this.handleRemote(normalizeTasks(value as TaskMap)));
    } else {
      // Late subscriber — hand it the current state immediately.
      cb({ tasks: this.lastTasks, suspectedWipe: false });
    }
  }

  private handleRemote(incoming: TaskMap): void {
    // During a bulk import, ignore the per-write echo storm entirely; the bulk
    // call snapshots and notifies once at the end.
    if (this.bulkDepth) return;
    // Self-echo suppression: skip callbacks right after our own write, or mid-edit.
    const isEcho = Date.now() - this.lastWriteAt < ECHO_WINDOW_MS;
    const empty = Object.keys(incoming).length === 0;
    const hadData = localStorage.getItem(this.hadDataKey()) === '1';

    // Anti-wipe: an empty payload is only suspicious when WE didn't just cause it.
    // Our own delete-to-empty arrives as an echo and is legitimate; an empty that
    // appears on its own (bad read, another device, server hiccup) is not — refuse
    // it and surface a restore instead of rendering/propagating the blank.
    if (empty && hadData && !isEcho) {
      this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: true });
      return;
    }

    if (empty) localStorage.removeItem(this.hadDataKey()); // legit empty (our echo) — stop guarding
    else localStorage.setItem(this.hadDataKey(), '1');
    this.lastTasks = incoming;

    // Keep the cache fresh but don't re-render over an in-progress edit.
    if (this.renderLocked || isEcho) return;
    this.notifyTasks({ tasks: incoming, suspectedWipe: false });
  }

  private notifyTasks(u: TasksUpdate): void {
    this.taskCbs.forEach((cb) => cb(u));
  }

  /**
   * Re-push the current tasks to all subscribers. Used after a sync so views
   * (e.g. the Dashboard schedule card) refresh even when the sync added 0 tasks
   * — otherwise putTasksBulk([]) is a no-op that never notifies.
   */
  refresh(): void {
    this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: false });
  }

  getTasks(): TaskMap {
    return this.lastTasks;
  }

  /** One-shot read of all tasks (used by Focus "Import Tasks" before the cache is warm). */
  async getTasksAll(): Promise<TaskMap> {
    const all = normalizeTasks(await this.backend.getAll<Task>('tasks'));
    this.lastTasks = all;
    return all;
  }

  /**
   * Remove completed tasks that are no longer due today, so they don't accumulate.
   * Today's completed tasks are kept so the daily lightbulb can measure progress.
   * Run once at boot.
   */
  async purgeStaleCompleted(): Promise<void> {
    const all = await this.backend.getAll<Task>('tasks');
    const today = todayStr();
    for (const t of Object.values(all)) {
      if (t.completed && t.dueDate !== today) {
        await this.backend.remove('tasks', t.id);
        delete this.lastTasks[t.id];
      }
    }
  }

  async putTask(task: Task): Promise<void> {
    this.lastWriteAt = Date.now();
    this.lastTasks = { ...this.lastTasks, [task.id]: task };
    localStorage.setItem(this.hadDataKey(), '1');
    // Optimistic: paint from the (already-updated) cache NOW instead of after the
    // server acknowledges — in Firebase mode that ack is a full network round-trip,
    // which showed up as a visible lag between pressing Enter and the task
    // appearing. The write itself still settles below (and Firebase queues/retries
    // it offline); our own echo of it is suppressed by the lastWriteAt window.
    this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: false });
    await this.backend.set('tasks', task.id, task);
  }

  /**
   * Write many tasks at once (bulk edit, Schoology import). Suppresses the
   * per-write snapshot/notify storm, then notifies a single time at the end.
   *
   * The cache is updated OPTIMISTICALLY, before the network, exactly like
   * putTask. That is not just for speed: this used to publish the new values
   * only after every write had settled, so for the whole (multi-second) span of
   * a bulk write every view still held the PRE-edit tasks. A background pass
   * that rebuilds a task from the cache in that window — the auto-translate
   * sweep does exactly this — would write the OLD field values straight back
   * over the edit, and whichever set() landed last won. That is what made a
   * bulk due-date change apply to only some of the selected tasks.
   */
  async putTasksBulk(tasks: Task[]): Promise<void> {
    if (!tasks.length) return;
    this.bulkDepth++;
    this.lastWriteAt = Date.now();
    const next = { ...this.lastTasks };
    for (const t of tasks) next[t.id] = t;
    this.lastTasks = next;
    localStorage.setItem(this.hadDataKey(), '1');
    // Paint the new values NOW so nothing downstream can read a stale task.
    this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: false });
    try {
      // allSettled, not a sequential loop: the loop aborted on the first
      // rejection and silently stranded every task queued behind it — the other
      // half of "the edit only applied to some of them". Every task gets its
      // write attempted, and a failure is reported instead of swallowed.
      const results = await Promise.allSettled(tasks.map((t) => this.backend.set('tasks', t.id, t)));
      const failed = results.filter((r) => r.status === 'rejected');
      if (failed.length) {
        console.error(`putTasksBulk: ${failed.length}/${tasks.length} task writes failed`, failed);
      }
    } finally {
      this.bulkDepth--;
      // Hold the echo window open until the LAST write of the batch has landed,
      // or the tail of our own storm comes back as a "remote" change.
      this.lastWriteAt = Date.now();
    }
    void this.backupAll(); // capture the freshly written state in a backup
    this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: false });
  }

  async removeTask(id: string): Promise<void> {
    this.lastWriteAt = Date.now();
    const next = { ...this.lastTasks };
    delete next[id];
    this.lastTasks = next;
    // If the user just emptied their own list, stop guarding against "empty" so a
    // later legitimate empty (e.g. on reload) isn't mistaken for a wipe.
    if (!Object.keys(next).length) localStorage.removeItem(this.hadDataKey());
    // Optimistic, same as putTask: the row disappears immediately; the network
    // delete settles in the background.
    this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: false });
    await this.backend.remove('tasks', id);
  }

  // --- profile collection (course config, schoology settings, schedule) ---

  async getProfile<T = unknown>(id: string): Promise<T | undefined> {
    const all = await this.backend.getAll<T>('profile');
    return all[id];
  }
  /**
   * Read the ENTIRE profile collection in a single backend round-trip. Prefer
   * this whenever a screen needs several profile keys at once: each getProfile()
   * re-fetches the whole collection (a network read apiece in Firebase mode), so
   * three getProfile() calls = three sequential network reads.
   */
  async getProfileAll<T = unknown>(): Promise<Record<string, T>> {
    return this.backend.getAll<T>('profile');
  }
  async setProfile<T = unknown>(id: string, value: T): Promise<void> {
    await this.backend.set('profile', id, value);
  }

  // --- notification ledger (SHARED with the sendReminders Cloud Function) --

  /** Everything already sent, so an open tab won't re-send what the server did. */
  async getNotifySent(): Promise<Record<string, unknown>> {
    return this.backend.getAll('notifySent');
  }
  /** Claim one notification key. Same node the Function checks before sending. */
  async markNotifySent(key: string, day: string): Promise<void> {
    await this.backend.set('notifySent', key, { at: Date.now(), day });
  }

  // --- focus collection (custom music, hidden built-ins, settings) --------

  async getFocusAll<T = unknown>(): Promise<Record<string, T>> {
    return this.backend.getAll<T>('focus');
  }
  async putFocus<T = unknown>(id: string, value: T): Promise<void> {
    await this.backend.set('focus', id, value);
  }
  async removeFocus(id: string): Promise<void> {
    await this.backend.remove('focus', id);
  }

  // --- backups & restore --------------------------------------------------

  /** Gather the whole account from the backend (best-effort; never throws). */
  private async gatherBundle(): Promise<AccountBundle | null> {
    try {
      const [tasks, profile, focus] = await Promise.all([
        this.backend.getAll<Task>('tasks'),
        this.backend.getAll('profile'),
        this.backend.getAll('focus'),
      ]);
      return { tasks: normalizeTasks(tasks), profile, focus };
    } catch {
      return null; // a failed read must never trigger a backup
    }
  }

  /**
   * Snapshot the entire account to BOTH a rolling local store and a single cloud
   * "last good" copy (so it survives clearing this browser or switching devices).
   * Guarded: a totally empty read is never snapshotted, so a bad read can't overwrite
   * good backups. Best-effort — safe to call on every app open / after a sync.
   */
  async backupAll(): Promise<void> {
    const bundle = await this.gatherBundle();
    if (isEmptyBundle(bundle) || !bundle) return;
    snapshotIfNeeded(this.uid, bundle); // local, ~14 days rolling
    try {
      await this.backend.set('meta', 'lastGoodSnapshot', { savedAt: new Date().toISOString(), bundle });
    } catch {
      /* cloud backup is best-effort; the local copy still protects you */
    }
  }

  private async readCloudSnapshot(): Promise<AccountBundle | null> {
    try {
      const meta = await this.backend.getAll<{ bundle: AccountBundle }>('meta');
      return meta.lastGoodSnapshot?.bundle ?? null;
    } catch {
      return null;
    }
  }

  /**
   * Restore the most recent backup — the WHOLE account, not just tasks. Prefers the
   * local snapshot, falls back to the cloud "last good" copy. Writes every section
   * back, then re-arms the wipe guard. Always an explicit user action.
   */
  async restoreLatestBackup(): Promise<boolean> {
    const bundle = latestBundle(this.uid) ?? (await this.readCloudSnapshot());
    if (isEmptyBundle(bundle) || !bundle) return false;
    for (const [id, t] of Object.entries(bundle.tasks)) await this.backend.set('tasks', id, t);
    for (const [id, v] of Object.entries(bundle.profile)) await this.backend.set('profile', id, v);
    for (const [id, v] of Object.entries(bundle.focus)) await this.backend.set('focus', id, v);
    this.lastTasks = normalizeTasks(bundle.tasks);
    if (Object.keys(this.lastTasks).length) localStorage.setItem(this.hadDataKey(), '1');
    this.notifyTasks({ tasks: this.lastTasks, suspectedWipe: false });
    return true;
  }
}
