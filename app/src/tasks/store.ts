// Cobalt: task building, sorting, grouping, dedup (spec §6.1, §6.3, §6.6).

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
 * dueDate → priority → dueTime → has-course → addedAt → id, with hand-placed tasks
 * seated back into their chosen slot afterwards. Undated tasks sort last. Coursed
 * tasks rank above uncoursed ones, but WHICH course carries no weight — all courses
 * are equal, so coursed ties fall through to recency like everything else.
 *
 * HOW manualOrder WORKS NOW (rewritten 8/15). It is no longer a sort key. The list
 * is ordered by the automatic criteria, and only then is a PINNED task lifted into
 * the index it was dropped at, with everything else closing up around it in priority
 * order. Two consequences, both of them the point:
 *
 *   · a task the student never moved keeps obeying the hierarchy even when its
 *     position shifts to make room for a neighbour, and
 *   · a newly imported task lands in its priority band instead of at the bottom.
 *
 * Only ONE task per due-date group can be pinned: a ⋮⋮ drop pins the dragged task
 * and clears every other pin in that group (reorderWithinGroup in render.ts). The
 * previous design stamped an index onto every task in the group, which froze it —
 * priority stopped applying there forever and later imports sank. seatGroup() below
 * detects and discards that legacy shape.
 *
 * manualOrder is an index WITHIN one day's group, so it is only ever compared
 * against tasks sharing that due date (sortTasks seats each date's run separately).
 *
 * The addedAt/id tail makes ties FULLY deterministic. Without it, tied tasks fell
 * back to the backend map's key order — which is creation order for an optimistic
 * local write but lexicographic-by-random-id in a Firebase snapshot — so a freshly
 * added task would visibly "teleport" a second later when the echo arrived.
 */
/** The AUTOMATIC order, with manualOrder ignored completely. */
function autoCompare(a: Task, b: Task): number {
  if (!a.dueDate && b.dueDate) return 1;
  if (a.dueDate && !b.dueDate) return -1;
  if (a.dueDate !== b.dueDate) return a.dueDate < b.dueDate ? -1 : 1;
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
}

/**
 * Seat one due-date group: pinned tasks hold their slot, everything else fills in
 * around them in priority order. `group` arrives already in AUTO order.
 *
 * A pin whose index MATCHES where the automatic order already put it is dropped as
 * redundant. That is the whole rule (Gabe, 8/15): a task that was never actually
 * moved has no business overriding the hierarchy just because a neighbour shifted.
 * It also self-heals the old data, where a single drag stamped an index onto every
 * task in the group — those stamps mostly agree with the automatic order, so they
 * evaporate here instead of freezing the group forever.
 */
function seatGroup(group: Task[]): Task[] {
  const n = group.length;
  // AT MOST ONE PIN PER GROUP is an invariant of the writer: a drop pins the dragged
  // task and clears every other pin in that group (see reorderWithinGroup). So a
  // group holding two or more pins can only be LEGACY data, from when a single drag
  // stamped an index onto every task. Ignore all of them and fall back to pure
  // priority order, which is what those stamps were never meant to override.
  //
  // Without this, legacy stamps that no longer match their automatic index — which
  // happens the moment anything new is imported above them — would each look like a
  // deliberate placement and re-freeze the group (Gabe, 8/15: a task that was not
  // actually moved must still submit to the hierarchy).
  if (group.filter((t) => t.manualOrder != null).length > 1) return group;

  const pinned = group.filter((t, i) => t.manualOrder != null && t.manualOrder !== i);
  if (!pinned.length) return group;
  pinned.sort((a, b) => (a.manualOrder as number) - (b.manualOrder as number));
  const pinnedSet = new Set(pinned);
  const rest = group.filter((t) => !pinnedSet.has(t));

  const slots: (Task | null)[] = new Array(n).fill(null);
  for (const p of pinned) {
    let idx = Math.max(0, Math.min(p.manualOrder as number, n - 1));
    // Two pins wanting one slot: the later one takes the next free seat. Bounded by
    // n, and there are never more pins than seats, so this always terminates.
    while (slots[idx] !== null) idx = (idx + 1) % n;
    slots[idx] = p;
  }
  let r = 0;
  for (let k = 0; k < n; k++) if (slots[k] === null) slots[k] = rest[r++];
  return slots as Task[];
}

export function sortTasks(tasks: Task[]): Task[] {
  const auto = [...tasks].sort(autoCompare);
  // Nothing pinned anywhere: the common case, and pure priority order.
  if (!auto.some((t) => t.manualOrder != null)) return auto;
  // Pins are indexes WITHIN a due-date group, so seat each date's run separately.
  // autoCompare sorts by date first, so those runs are already contiguous.
  const out: Task[] = [];
  let i = 0;
  while (i < auto.length) {
    const key = auto[i].dueDate || '';
    let j = i;
    while (j < auto.length && (auto[j].dueDate || '') === key) j++;
    out.push(...seatGroup(auto.slice(i, j)));
    i = j;
  }
  return out;
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
