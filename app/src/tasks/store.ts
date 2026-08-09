// WorkSpace — task building, sorting, grouping, dedup (spec §6.1, §6.3, §6.6).

import type { ParsedTask, Task, TaskMap } from '../types';
import { genId } from '../util/ids';
import { todayStr, dayDiff, formatGroupHeader } from '../util/dates';
import { PRIORITY_WEIGHT } from './priorities';

/** Build a fresh manual task from parser output. */
export function makeTask(parsed: ParsedTask): Task {
  return {
    id: 'manual_' + genId(),
    title: parsed.title,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    timeLabel: parsed.timeLabel,
    course: parsed.course,
    source: 'manual',
    completed: false,
    completedAt: null,
    priority: parsed.priority,
    addedAt: new Date().toISOString(),
    notes: [],
  };
}

/** Clone a task as a duplicate. */
export function duplicateTask(task: Task): Task {
  return {
    ...task,
    id: 'dup_' + genId(),
    completed: false,
    completedAt: null,
    addedAt: new Date().toISOString(),
    notes: task.notes.map((n) => ({ ...n, id: 'n_' + genId() })),
    _isDuplicate: true,
  };
}

// --- sorting --------------------------------------------------------------

/** Sort key for the time slot: timed first (by clock), then labels (clustered), then none. */
function timeKey(t: Task): string {
  if (t.dueTime) return t.dueTime;
  if (t.timeLabel) return '99:00 ' + t.timeLabel.toLowerCase();
  return '99:99';
}

/**
 * dueDate → manualOrder → priority → dueTime → has-course → addedAt → id.
 * Undated tasks sort last. Coursed tasks rank above uncoursed ones, but WHICH
 * course carries no weight — all courses are equal, so coursed ties fall through
 * to recency like everything else.
 *
 * manualOrder is the user's ⋮⋮ drag arrangement within a due-date group: an
 * explicit hand-placement outranks every automatic criterion after the date
 * itself. Tasks never hand-placed sort naturally BELOW the arranged ones (a new
 * import appends under the curated order instead of barging into it).
 *
 * `manualFirst` promotes manualOrder above dueDate, giving
 * manualOrder → dueDate → priority → dueTime → has-course → addedAt → id.
 * Focus passes it; the Tasks tab does not. See the note at the check itself.
 *
 * The addedAt/id tail makes ties FULLY deterministic. Without it, tied tasks fell
 * back to the backend map's key order — which is creation order for an optimistic
 * local write but lexicographic-by-random-id in a Firebase snapshot — so a freshly
 * added task would visibly "teleport" a second later when the echo arrived.
 */
export function sortTasks(tasks: Task[], opts: { manualFirst?: boolean } = {}): Task[] {
  return [...tasks].sort((a, b) => {
    const ma = a.manualOrder ?? Infinity;
    const mb = b.manualOrder ?? Infinity;
    // manualFirst (Focus only, per Gabe 8/8): the drag arrangement outranks the
    // due date itself, so a hand-placement can cross a date boundary. It's the
    // right rule for a FLAT list. The Tasks tab splits into visible day headers,
    // so a drag there can only ever mean "within this day" and letting it jump
    // the date would fling the row into another header. Focus shows one
    // undivided list, so there is no boundary to respect: a row dragged to the
    // top is expected to STAY at the top, whatever it's due.
    if (opts.manualFirst && ma !== mb) return ma - mb;
    if (!a.dueDate && b.dueDate) return 1;
    if (a.dueDate && !b.dueDate) return -1;
    if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
    // The user's drag arrangement (same-date group) beats the automatic criteria.
    if (ma !== mb) return ma - mb;
    // Within a day, higher priority comes first.
    const pw = PRIORITY_WEIGHT[a.priority] - PRIORITY_WEIGHT[b.priority];
    if (pw !== 0) return pw;
    const ta = timeKey(a);
    const tb = timeKey(b);
    if (ta !== tb) return ta < tb ? -1 : 1;
    // Coursed above uncoursed (a boolean — course names never compared).
    const ca = a.course ? 0 : 1;
    const cb = b.course ? 0 : 1;
    if (ca !== cb) return ca - cb;
    // Recency: earlier-created tasks stay above later ones (new tasks append below).
    if (a.addedAt !== b.addedAt) return a.addedAt < b.addedAt ? -1 : 1;
    // Absolute last resort (bulk imports can share an addedAt timestamp).
    return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
  });
}

// --- grouping -------------------------------------------------------------

export interface TaskGroup {
  key: string; // dueDate or 'none'
  header: string;
  tone: 'red' | 'orange' | 'none'; // red = overdue/today, orange = tomorrow
  tasks: Task[];
}

/** Group active (incomplete) tasks by due day, with overdue → today → future → no-date. */
export function groupTasks(map: TaskMap): TaskGroup[] {
  const active = sortTasks(Object.values(map).filter((t) => !t.completed));
  const today = todayStr();

  const byDate = new Map<string, Task[]>();
  const noDate: Task[] = [];
  for (const t of active) {
    if (!t.dueDate) noDate.push(t);
    else (byDate.get(t.dueDate) ?? byDate.set(t.dueDate, []).get(t.dueDate)!).push(t);
  }

  const groups: TaskGroup[] = [];
  for (const date of [...byDate.keys()].sort()) {
    let header: string;
    let tone: 'red' | 'orange' | 'none' = 'none';
    if (date === today) {
      header = `Today · ${formatGroupHeader(date)}`;
      tone = 'red';
    } else if (date < today) {
      header = `${formatGroupHeader(date)} (overdue)`;
      tone = 'red';
    } else if (dayDiff(today, date) === 1) {
      header = `Tomorrow · ${formatGroupHeader(date)}`;
      tone = 'orange';
    } else header = formatGroupHeader(date);
    groups.push({ key: date, header, tone, tasks: byDate.get(date)! });
  }

  if (noDate.length) groups.push({ key: 'none', header: 'No Due Date', tone: 'none', tasks: noDate });
  return groups;
}

// --- daily progress (drives the lightbulb) --------------------------------

export interface DailyProgress {
  done: number;
  total: number;
  pct: number; // 0..1
}

/**
 * Completion ratio of tasks due TODAY. Empty day → 1 (fully lit; nothing pending).
 * Relies on completed tasks being retained (not deleted) for the current day.
 */
export function dailyProgress(map: TaskMap): DailyProgress {
  const today = todayStr();
  const todays = Object.values(map).filter((t) => t.dueDate === today);
  const total = todays.length;
  const done = todays.filter((t) => t.completed).length;
  return { done, total, pct: total === 0 ? 1 : done / total };
}

// --- due badge ------------------------------------------------------------

export interface DueBadge {
  state: 'OVR' | 'TOD' | 'TOM' | 'Nd';
  label: string;
}

export function dueBadge(task: Task): DueBadge | null {
  if (!task.dueDate) return null;
  const today = todayStr();
  if (task.dueDate < today) return { state: 'OVR', label: 'OVR' };
  if (task.dueDate === today) return { state: 'TOD', label: 'TOD' };
  const diff = dayDiff(today, task.dueDate);
  if (diff === 1) return { state: 'TOM', label: 'TOM' };
  return { state: 'Nd', label: `${diff}d` };
}
