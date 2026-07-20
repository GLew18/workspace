// WorkSpace — assignment-reminder scheduler.
//
// Runs while the app is open (started in renderApp, stopped on sign-out). Keeps a
// live copy of the task map via data.watchTasks, and every EVAL_MS (plus once per
// task update) applies four rules:
//
//   1. DUE-SOON — a not-done timed task fires a reminder at EACH selected lead
//      (minutes before its due time), on any day, within a 1h catch-up window.
//   2. DAILY AGENDA — once per day at a chosen morning time, "N tasks due today".
//   3. TOMORROW PREVIEW — once per day at a chosen evening time, "N due tomorrow".
//   4. NEW ASSIGNMENTS — tasks that appear after startup fire either one per task
//      ('each') or a batched "N imported in the last X" digest every intervalMins.
//
// Every send is recorded in the notify ledger FIRST, so reloads/re-renders can
// never duplicate a reminder. Settings changes arrive via the NOTIFY_SETTINGS_EVENT
// custom event (dispatched the moment a setting is toggled) — no profile polling.

import type { Data } from '../db';
import type { TaskMap } from '../types';
import { todayStr } from '../util/dates';
import {
  type NotifySettings,
  type Channels,
  NOTIFY_SETTINGS_EVENT,
  normalizeNotifySettings,
  reminderBody,
  taskInfoBody,
  intervalLabel,
  notificationPermission,
  setEmailAddress,
  sendNotification,
  alreadySent,
  markSent,
} from './notify';

const EVAL_MS = 30_000; // re-check twice a minute — plenty for minute-granular times
const CATCHUP_MS = 60 * 60_000; // a due-soon lead fires only within ~1h of its moment; older misses are the closed-app push's job

const pad = (n: number): string => String(n).padStart(2, '0');
const cap = (s?: string): string | undefined => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);
const tomorrowStr = (): string => {
  const d = new Date();
  d.setDate(d.getDate() + 1);
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
};
/** A task's due timestamp (ms), or null if it has no date+time. */
const dueMsOf = (t: { dueDate?: string; dueTime?: string }): number | null => {
  if (!t.dueDate || !t.dueTime) return null;
  const ms = new Date(`${t.dueDate}T${t.dueTime}:00`).getTime();
  return Number.isNaN(ms) ? null : ms;
};

export interface SchedulerOpts {
  /** Runs after a notification click focuses the window (e.g. jump to Tasks). */
  onClick?: () => void;
  /** The SIGNED-IN ACCOUNT email — the Gmail channel's one and only destination
   *  (deliberately not editable/stored, so notifications can't be aimed at others). */
  email?: string;
}

/** Start the reminder loop. Returns a stop() that silences it (sign-out). */
export function startNotificationScheduler(data: Data, opts: SchedulerOpts = {}): () => void {
  let settings: NotifySettings = normalizeNotifySettings(null);
  let settingsLoaded = false; // never deliver against the defaults — wait for the real read
  let tasks: TaskMap = {};
  let stopped = false;

  /** Resolve a notification's OWN channel choice against what each channel can
   *  physically deliver (pop-up needs browser permission; email needs the account to
   *  HAVE an email — it's the only destination). The "All reminders" master is a
   *  linked select-all in the UI — it edits these child channels directly, so it is
   *  deliberately NOT consulted here. */
  const resolve = (ch: Channels): Channels => ({
    popup: ch.popup && notificationPermission() === 'granted',
    gmail: ch.gmail && !!opts.email,
  });
  /** Send on the resolved channels, once, ledgered. Skips (without consuming the
   *  ledger) when nothing would actually deliver. */
  const fire = (key: string, title: string, body: string, ch: Channels): void => {
    const r = resolve(ch);
    if (!r.popup && !r.gmail) return;
    if (alreadySent(key)) return;
    markSent(key, todayStr());
    sendNotification(title, body, { popup: r.popup, gmail: r.gmail, onClick: opts.onClick });
  };

  // New-assignment tracking: `seen` is seeded from the first task snapshot so
  // existing assignments are never announced; only tasks that appear afterward are.
  let seen: Set<string> | null = null;
  const pendingNew = new Set<string>(); // batched-mode accumulator
  let batchStartMs = 0; // when the current batch window opened

  const announceNewTask = (t: TaskMap[string]): void => {
    const body = taskInfoBody({ course: t.course, priority: cap(t.priority), dueMs: dueMsOf(t) }, settings.appearance);
    fire(`new|${t.id}`, `New assignment — ${t.title}`, body, settings.newAssignment.channels);
  };

  const anyOn = (ch: Channels): boolean => ch.popup || ch.gmail;

  const evaluate = (): void => {
    if (stopped) return;
    // Never evaluate against the DEFAULT settings (the real read may still be in
    // flight) — a default-channel send would consume the ledger and permanently
    // eat the reminder the user's actual channels should have delivered.
    if (!settingsLoaded) return;

    const today = todayStr();
    const now = Date.now();
    const open = Object.values(tasks).filter((t) => !t.completed);

    // --- 1. due-soon reminders — one per selected lead, across days ----------
    if (anyOn(settings.dueSoon.channels) && settings.dueSoon.leads.length) {
      for (const t of open) {
        if (!t.dueDate || !t.dueTime) continue; // untimed tasks are the agenda's job
        const dueMs = new Date(`${t.dueDate}T${t.dueTime}:00`).getTime();
        if (Number.isNaN(dueMs)) continue; // malformed time — never crash the loop
        for (const lead of settings.dueSoon.leads) {
          const fireAt = dueMs - lead * 60_000;
          if (now < fireAt || now >= dueMs) continue; // not yet, or already due
          if (now - fireAt > CATCHUP_MS) continue; // missed by too much — don't fire a stale reminder
          const body = reminderBody(
            { course: t.course, priority: cap(t.priority), nowMs: now, dueMs, leadMins: lead },
            settings.appearance
          );
          fire(`rem|${t.id}|${t.dueDate}|${t.dueTime}|${lead}`, `Due soon — ${t.title}`, body, settings.dueSoon.channels);
        }
      }
    }

    // --- 2. daily agenda — once per day at the chosen morning time -----------
    if (anyOn(settings.dailyAgenda.channels)) {
      const dueToday = open.filter((t) => t.dueDate === today);
      if (dueToday.length > 0) {
        const agendaMs = new Date(`${today}T${pad(settings.dailyAgenda.hour)}:${pad(settings.dailyAgenda.minute)}:00`).getTime();
        if (!Number.isNaN(agendaMs) && now >= agendaMs) {
          const n = dueToday.length;
          fire(`agenda|${today}`, `Good morning — ${n} task${n === 1 ? '' : 's'} due today`, 'Open WorkSpace to see them.', settings.dailyAgenda.channels);
        }
      }
    }

    // --- 3. tomorrow preview — once per day at the chosen evening time -------
    if (anyOn(settings.tomorrow.channels)) {
      const tmr = tomorrowStr();
      const dueTmr = open.filter((t) => t.dueDate === tmr);
      if (dueTmr.length > 0) {
        const hour24 = settings.tomorrow.hour + 12; // stored 5–11 = PM
        const fireMs = new Date(`${today}T${pad(hour24)}:${pad(settings.tomorrow.minute)}:00`).getTime();
        if (!Number.isNaN(fireMs) && now >= fireMs) {
          const n = dueTmr.length;
          fire(`tomorrow|${today}`, `Heads-up — ${n} task${n === 1 ? '' : 's'} due tomorrow`, 'Open WorkSpace to plan ahead.', settings.tomorrow.channels);
        }
      }
    }

    // --- 4. batched new-assignment digest — flush when the interval elapses --
    if (anyOn(settings.newAssignment.channels) && settings.newAssignment.mode === 'batched' && pendingNew.size > 0) {
      if (batchStartMs && now - batchStartMs >= settings.newAssignment.intervalMins * 60_000) {
        // Only clear the accumulator once a channel can ACTUALLY deliver (e.g. gmail-on
        // but unconfirmed resolves to nothing) — otherwise the whole batch would be
        // silently burned. Undeliverable → keep accumulating and retry next tick.
        const r = resolve(settings.newAssignment.channels);
        if (r.popup || r.gmail) {
          const n = pendingNew.size;
          pendingNew.clear();
          batchStartMs = 0;
          fire(`newbatch|${now}`, `${n} new assignment${n === 1 ? '' : 's'}`, `Imported in the last ${intervalLabel(settings.newAssignment.intervalMins)}.`, settings.newAssignment.channels);
        }
      }
    }
  };

  // Live task map: fires immediately with the current tasks, then on every change.
  data.watchTasks((u) => {
    if (stopped) return;
    tasks = u.tasks;
    const ids = new Set(Object.keys(tasks));
    if (seen === null) {
      // First snapshot — existing assignments are NOT "new". A late subscriber gets a
      // SYNCHRONOUS replay that can still be the pre-load empty map; seeding from that
      // would make the real snapshot announce the user's entire task list as new. Only
      // seed from an empty set once settings are loaded (a genuinely empty account).
      if (ids.size > 0 || settingsLoaded) seen = ids;
    } else {
      const fresh = [...ids].filter((id) => !seen!.has(id) && tasks[id] && !tasks[id].completed);
      if (fresh.length && anyOn(settings.newAssignment.channels)) {
        if (settings.newAssignment.mode === 'each') {
          for (const id of fresh) announceNewTask(tasks[id]);
        } else {
          if (!batchStartMs) batchStartMs = Date.now();
          for (const id of fresh) pendingNew.add(id);
        }
      }
      seen = ids; // whether or not we announced, mark them seen so they never re-fire
    }
    evaluate();
  });

  // The Gmail channel's destination is the signed-in ACCOUNT email, full stop.
  setEmailAddress(opts.email || '');

  // Settings: one initial read, then push-updates from the Settings Save.
  void data.getProfile('notifications').then((s) => {
    if (stopped) return;
    settings = normalizeNotifySettings(s);
    settingsLoaded = true;
    evaluate();
  });
  const onSettings = (e: Event): void => {
    settings = normalizeNotifySettings((e as CustomEvent).detail);
    settingsLoaded = true;
    evaluate();
  };
  window.addEventListener(NOTIFY_SETTINGS_EVENT, onSettings);

  const interval = window.setInterval(evaluate, EVAL_MS);

  return () => {
    stopped = true; // watchTasks has no unsubscribe; the flag makes our callback inert
    clearInterval(interval);
    window.removeEventListener(NOTIFY_SETTINGS_EVENT, onSettings);
  };
}
