// Cobalt: Gems, the homework-completion currency (Gabe, 9/29/26).
//
// THE ANTI-LOOPHOLE RULE, stated outright per Gabe's own instruction: only
// tasks that came from a real Schoology import can earn Gems. A hand-typed
// task is worthless here on purpose — task.source === 'manual' never counts —
// so there is no free-currency loophole from inventing and checking off tasks.
//
// A SECOND LOOPHOLE, found by /roast on 9/30/26 and closed the same session:
// checking a real task off, unchecking it (a no-penalty undo elsewhere in the
// app), and checking it again used to pay out every time, because this file
// only ever compared to the ONE prior update, never true history. Fixed with a
// PERMANENT per-task record (`paidOut`, below) — once a task id has paid out,
// it never can again, no matter how many more times it's toggled, and nothing
// is clawed back on uncheck (clawback would mean tracking exactly how much a
// task paid and reversing it even after the Gems were spent — a worse bug than
// the one being fixed). The roast's Skeptic also found that Duplicate (a REAL
// task copied with a fresh id and completed reset to false) bypassed this
// ledger entirely and was bulk-capable — closed by excluding `_isDuplicate`
// tasks the same way manual ones are, below.
//
// PLACEHOLDER VALUES (Gabe, 9/29/26): the base award, the early-completion
// curve, and the same-day multiplier are explicitly NOT finalized. This is a
// starting point so the system is real and earning something, not a locked
// design — revisit once Gabe works out the actual numbers and the store's
// spend side.
//
// This is fed by Data.watchTasks (see main.ts boot), the same task-update
// stream every tab (Tasks, Focus, calendar) already funnels through via
// Data.putTask/putTasksBulk — so a completion earns Gems exactly once no
// matter which screen checked the box off.

import type { Data } from '../db';
import type { Task, TaskMap } from '../types';
import { todayStr, dayDiff, formatDate } from '../util/dates';
import { el, claimToastSlot, releaseToastSlot, retireToast, TOAST_MS } from '../util/dom';
import { STONE_SVG } from '../ui/laurel';

const PROFILE_KEY = 'gems';

interface GemsRecord {
  balance: number;
  /** 'YYYY-MM-DD' the counter below is for; reset when a new day starts. */
  countDate: string;
  /** How many eligible tasks have been completed on countDate so far. */
  countToday: number;
  /** Every task id that has EVER paid out, forever — see the file header's
   *  "SECOND LOOPHOLE" note. A plain object, not an array: O(1) lookup, and
   *  Firebase Realtime Database handles a sparse object far better than a
   *  growing array. */
  paidOut: Record<string, true>;
}

const BASE_GEMS = 10;
/**
 * +5 per day early, but the day right before the due date doesn't count
 * (Gabe, 9/30): "due Wednesday, doing it Tuesday doesn't add extra gems,
 * because most people do it Tuesday" — the bonus only starts TWO days out.
 * So 1 day early = +0, 2 days early = +5, 3 = +10, etc.
 */
const EARLY_BONUS_PER_DAY = 5;
const EARLY_BONUS_CAP_DAYS = 5;
/** Same-day volume bonus: +15% per additional eligible completion that day, capped. */
const SAME_DAY_STEP = 0.15;
const SAME_DAY_STEP_CAP = 4;

let data: Data | null = null;
let balance = 0;
let record: GemsRecord = { balance: 0, countDate: '', countToday: 0, paidOut: {} };
/** The task map as of the last update, so a fresh boot's full hydration isn't
 *  mistaken for a wave of brand-new completions (see noteTasksUpdate). */
let lastSeen: TaskMap | null = null;
const subscribers = new Set<() => void>();

export function getGemsBalance(): number {
  return balance;
}

/** Store purchases: deducts if affordable, returns whether it went through. */
export function spendGems(amount: number): boolean {
  if (amount > balance) return false;
  balance -= amount;
  void persist();
  return true;
}

export function onGemsChange(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

// --- the checkoff → toast visual trail (Gabe, 10/1/26) ---------------------
//
// "Gems sort of spew out of it and go into the place where the toast comes up
// from... forms an arrow that directs you towards the toast." Registered by
// the checkbox click handler (tasks/render.ts) right before it toggles, keyed
// by task id, so that when the award lands a moment later (see
// noteTasksUpdate) there's a real row on screen to launch the trail from.
// Self-expires: a task that never actually earns (manual, already paid out,
// a bulk edit with no visible row) just has its registration time out unused.
const checkoffOrigins = new Map<string, HTMLElement>();
const ORIGIN_TTL_MS = 3000;

/** Call right before toggling a task's checkbox, if it might earn Gems. */
export function registerCheckoffOrigin(taskId: string, row: HTMLElement): void {
  checkoffOrigins.set(taskId, row);
  setTimeout(() => {
    if (checkoffOrigins.get(taskId) === row) checkoffOrigins.delete(taskId);
  }, ORIGIN_TTL_MS);
}

export async function initGems(d: Data): Promise<void> {
  data = d;
  lastSeen = null;
  const stored = await d.getProfile<GemsRecord>(PROFILE_KEY);
  // `paidOut` is new (9/30/26): a record saved before this fix won't have it.
  record = stored ? { ...stored, paidOut: stored.paidOut ?? {} } : { balance: 0, countDate: '', countToday: 0, paidOut: {} };
  balance = record.balance;
}

async function persist(): Promise<void> {
  record.balance = balance;
  if (data) await data.setProfile(PROFILE_KEY, record);
  subscribers.forEach((cb) => cb());
}

function gemsForCompletion(task: Task, completedAt: string, nthToday: number): number {
  const doneDate = formatDate(new Date(completedAt));
  // The day right before the due date is day 1 early and earns nothing extra;
  // day 2 early is where the bonus starts (see EARLY_BONUS_PER_DAY above).
  const daysEarly = task.dueDate ? Math.max(0, dayDiff(doneDate, task.dueDate) - 1) : 0;
  const early = Math.min(daysEarly, EARLY_BONUS_CAP_DAYS) * EARLY_BONUS_PER_DAY;
  const multiplier = 1 + Math.min(nthToday, SAME_DAY_STEP_CAP) * SAME_DAY_STEP;
  return Math.round((BASE_GEMS + early) * multiplier);
}

/**
 * Feed every Data.watchTasks update through here (wired in main.ts at boot).
 * Diffs against the last-seen map to award Gems for tasks that JUST flipped
 * to completed — never for the map's first hydration (that would retroactively
 * pay out for every assignment finished before this feature existed).
 */
export function noteTasksUpdate(tasks: TaskMap): void {
  const prev = lastSeen;
  lastSeen = tasks;
  if (!data || !prev) return; // first hydration this session, or gems not booted yet — nothing to award

  const today = todayStr();
  if (record.countDate !== today) {
    record.countDate = today;
    record.countToday = 0;
  }

  let earned = 0;
  let blockedRecheck = 0; // a real, non-duplicate task re-completed after already paying out once
  const earnedIds: string[] = [];
  for (const id in tasks) {
    const t = tasks[id];
    if (t.source === 'manual' || t._isDuplicate) continue; // see the "SECOND LOOPHOLE" file header note
    if (!t.completed || !t.completedAt) continue;
    if (prev[id]?.completed) continue; // already counted on an earlier update
    if (formatDate(new Date(t.completedAt)) !== today) continue; // backfilled/synced, not a live check-off
    if (record.paidOut[id]) {
      blockedRecheck++; // checked, unchecked, checked again — already paid, never pays twice
      continue;
    }
    earned += gemsForCompletion(t, t.completedAt, record.countToday);
    record.countToday++;
    record.paidOut[id] = true;
    earnedIds.push(id);
  }
  if (earned > 0) {
    balance += earned;
    void persist();
    // ONE toast for the batch, not one per task (same principle as the
    // completion chime elsewhere) — it fires from document.body since this
    // runs off a data update, not a mounted view.
    showGemsToast(earned);
    // The visual trail: for every task in this batch that has a registered
    // row on screen, launch a stream of small gems from that row toward
    // where the toast just landed.
    for (const id of earnedIds) {
      const origin = checkoffOrigins.get(id);
      if (origin) {
        checkoffOrigins.delete(id);
        // From where the row LANDED (Gabe, 10/4): the check-off re-draws the list
        // and moves the finished row, so look it up again once that has happened.
        window.setTimeout(() => {
          const now = origin.isConnected
            ? origin
            : document.querySelector<HTMLElement>(`.task-item[data-task-id="${CSS.escape(id)}"]`);
          if (now) playGemsSpew(now);
        }, 0);
      }
    }
  } else if (blockedRecheck > 0) {
    // No toast here (Gabe, 10/1/26, reversing the 9/30 /roast call): a
    // recheck that earns nothing should be silent, not announce the non-event.
    // Still persisted — countDate/countToday may have changed above even
    // though nothing was earned this call.
    void persist();
  }
}

/** "+ [gem icon] N" instead of plain "+N Gems" text (Gabe, 10/1/26). Uses the
 *  real app-wide stone (not a user's equipped Store cosmetic) — this is
 *  system UI reporting a currency amount, not the brand mark. Reuses the same
 *  claim/retire choreography every other toast uses (util/dom.ts) so it
 *  still obeys the one-toast-at-a-time rule and gets replaced, not stacked,
 *  by a later toast of any kind. */
function showGemsToast(amount: number): void {
  const icon = el('span', { class: 'gems-toast-icon' });
  icon.innerHTML = STONE_SVG;
  const t = el('div', { class: 'toast gems-toast' }, [
    el('span', { class: 'gems-toast-plus', text: '+' }),
    icon,
    el('span', { class: 'gems-toast-amount', text: String(amount) }),
  ]);
  document.body.append(t);
  void t.offsetHeight;
  t.classList.add('show');
  const timer = window.setTimeout(() => {
    releaseToastSlot(t);
    retireToast(t);
  }, TOAST_MS);
  claimToastSlot(t, () => window.clearTimeout(timer));
}

const SPEW_PIECE_COUNT = 7;

/**
 * A short stream of small gems launches from `origin` (the row that was just
 * checked off) and converges on where the toast lands at the bottom of the
 * screen — "forms an arrow that directs you towards the toast" (Gabe,
 * 10/1/26's own description). Each piece's flight path is computed from the
 * row's REAL on-screen position, so this still points the right way
 * regardless of which row, in which list, on which screen size.
 */
function playGemsSpew(origin: HTMLElement): void {
  const r = origin.getBoundingClientRect();
  const originX = r.left + 18;
  const originY = r.top + r.height / 2;
  const targetX = window.innerWidth / 2;
  const targetY = window.innerHeight - 24 - 18; // the toast's vertical center at bottom:24px

  const burst = document.createElement('div');
  burst.className = 'gems-spew-burst';
  burst.style.cssText = `left:${originX.toFixed(1)}px;top:${originY.toFixed(1)}px;`;
  for (let i = 0; i < SPEW_PIECE_COUNT; i++) {
    const piece = document.createElement('span');
    piece.className = 'gems-spew-piece';
    // A little spread per piece so the stream reads as a loose arrow/trail
    // converging on the toast, not one gem retracing the same line.
    const spread = (i - (SPEW_PIECE_COUNT - 1) / 2) * 10;
    const dx = targetX - originX + spread;
    const dy = targetY - originY;
    piece.style.setProperty('--dx', `${dx.toFixed(1)}px`);
    piece.style.setProperty('--dy', `${dy.toFixed(1)}px`);
    piece.style.animationDelay = `${i * 45}ms`;
    burst.append(piece);
  }
  document.body.append(burst);
  setTimeout(() => burst.remove(), 950);
}
