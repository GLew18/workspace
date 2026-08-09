// WorkSpace — Schoology import orchestration (client-side, on-demand).
//
// Runs on app open and when Settings is saved. In production the same
// parse/classify pipeline moves into a scheduled Cloud Function for the 30-min
// background sync — this module is the shared core, not throwaway.
//
// Import rules:
//   • FUTURE only — assignments due today or later (no past backlog).
//   • Each logical item imported AT MOST ONCE, ever (a persistent "seen" ledger),
//     so re-syncs only add genuinely new items and never resurrect deleted ones.
//   • An item posted on multiple calendar days collapses to its LATEST day.
//   • Logical identity = the assignment's /assignment/<id> (stable across days);
//     non-assignment events fall back to their title.
//   • ALTERATIONS carry through: when the feed's title / due date / due time /
//     description / link changed since import, the stored task is updated in
//     place — unless the user hand-edited that field (_manual* flags win).

import type { Data } from '../db';
import type { Task, ScheduleItem, SchoologySettings } from '../types';
import { parseIcal, taskEvents, scheduleEvents, type IcalEvent } from './ical';
import { classifyBatch } from './classify';
import { loadLabels, labelFor } from './extension';
import { todayStr, addDays } from '../util/dates';
import { getPrefs } from '../prefs';
import { firebaseConfig } from '../firebase';

// #region Types — the result of a sync + the persistent "already imported" ledger
export interface SyncResult {
  added: number;
  skipped: number; // already imported before (not re-added)
  updated: number; // already-imported tasks whose feed item changed (title/date/…)
  total: number; // future candidates considered
  scheduleCount: number;
}

interface SeenLedger {
  keys: string[];
}
// #endregion

// #region Fetching — proxy the feed (dev) and download/validate the iCal text
/**
 * webcal:// is what Schoology's Copy button hands out, and it is the right thing
 * for a student to paste — but it is NOT a network protocol. It is https with the
 * scheme swapped, a signal to the OS meaning "open this in a calendar app".
 * `fetch()` refuses it outright ("URL scheme webcal is not supported"), which
 * surfaced as a bogus "Couldn't reach that link" on a perfectly good URL.
 *
 * So we swap it back for the request only. Apple Calendar and Google Calendar do
 * exactly the same thing. Nothing about what the user pastes or sees changes.
 */
function toHttps(url: string): string {
  return url
    .trim()
    .replace(/^webcal:\/\//i, 'https://')
    // http:// is upgraded too. The CLIENT's isSchoologyIcalUrl tolerates http, but
    // the Cloud Function deliberately does NOT (a server fetch has no excuse to
    // leave TLS). Without this line a pasted http:// link would validate, work on
    // localhost via the dev proxy, and then be refused in production — precisely
    // the works-in-dev-fails-deployed trap this whole change exists to remove.
    .replace(/^http:\/\//i, 'https://');
}

/** Is this the dev server, where vite.config's /sgy proxy exists? */
const onDevProxy = (): boolean =>
  location.hostname === 'localhost' || location.hostname === '127.0.0.1';

/** Route the feed through the Vite dev proxy to dodge CORS (single-school in dev). */
function toFetchUrl(url: string): string {
  const https = toHttps(url);
  if (onDevProxy()) {
    const m = https.match(/^https?:\/\/[^/]+(\/.*)$/);
    if (m) return '/sgy' + m[1];
  }
  return https;
}

/**
 * Fetch the feed THROUGH THE SERVER, for every origin that isn't the dev server.
 *
 * Schoology sends no Access-Control-Allow-Origin header, so a browser on a
 * deployed origin is forbidden to read the response — the request fails before
 * the app sees anything ("blocked by CORS policy", confirmed in a real browser).
 * Server-to-server requests aren't subject to CORS, so the fetchSchoologyIcal
 * Cloud Function makes the identical request and hands back the body.
 *
 * It returns the RAW TEXT and nothing else. Every judgement about that text —
 * valid iCal? empty calendar? login page? — stays in fetchIcal below, so the dev
 * path and the deployed path produce identical messages from one piece of logic.
 */
async function fetchIcalViaFunction(url: string): Promise<{ ok: boolean; status: number; text: string }> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'fetchSchoologyIcal');
  const res = await fn({ url: toHttps(url) });
  return res.data as { ok: boolean; status: number; text: string };
}

export async function fetchIcal(url: string): Promise<string> {
  let text: string;
  let status = 200;
  try {
    if (onDevProxy()) {
      const res = await fetch(toFetchUrl(url));
      status = res.status;
      text = res.ok ? await res.text() : '';
    } else {
      const r = await fetchIcalViaFunction(url);
      status = r.status;
      text = r.ok ? r.text : '';
    }
  } catch (err) {
    // The callable throws its own sentences (bad link / not signed in / Schoology
    // unreachable); surface those rather than burying them under a generic one.
    const msg = (err as { message?: string }).message || '';
    throw new Error(msg && !/internal/i.test(msg)
      ? msg
      : 'Couldn’t reach that link. Check the URL and your connection.');
  }
  if (!text) throw new Error(`That link returned an error (${status}).`);
  // A real calendar feed must declare itself. HTML pages / wrong URLs won't —
  // so this catches "valid-looking but not actually iCal" links.
  if (!/BEGIN:VCALENDAR/i.test(text)) {
    // An EMPTY Schoology feed isn't an error and isn't a bad link: Schoology
    // serves a human-readable "There are no events in this calendar" page instead
    // of an empty calendar file. Say that, rather than blaming the link.
    if (/no events in this calendar/i.test(text)) {
      throw new Error('That calendar is empty. Schoology has nothing scheduled on it yet.');
    }
    throw new Error('That link isn’t a valid iCal calendar feed.');
  }
  return text;
}
// #endregion

// #region Builders — stable dedup key + new-task factory
/** Stable logical id for dedup: assignment id when present, else normalized title. */
function logicalKey(e: IcalEvent): string {
  if (e.assignmentId) return 'assign_' + e.assignmentId;
  return 'evt_' + e.summary.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Build a fresh imported task from an event + its classified course. */
function newTask(key: string, e: IcalEvent, course: string): Task {
  return {
    id: 'ical_' + key,
    title: e.summary,
    dueDate: e.date,
    dueTime: e.time,
    timeLabel: '',
    course,
    source: 'schoology-ical',
    completed: false,
    completedAt: null,
    priority: 'normal',
    addedAt: new Date().toISOString(),
    notes: [],
    details: e.description || undefined,
    schoologyUrl: e.url || undefined,
  };
}
// #endregion

// #region runSync() — fetch → dedup → import new tasks → rebuild schedule → save state
/** Full import pass. Returns counts; throws only on fetch/parse failure. */
export async function runSync(data: Data): Promise<SyncResult> {
  const settings = await data.getProfile<SchoologySettings>('schoology');
  if (!settings?.icalUrl) throw new Error('No Schoology link configured.');

  const ics = await fetchIcal(settings.icalUrl);
  const events = parseIcal(ics);
  const today = todayStr();

  // Settings ▸ Tasks ▸ Import: which event types come in, and how far ahead.
  const imp = getPrefs().importPrefs;
  const horizon = addDays(today, imp.windowDays);
  const allowed = (e: IcalEvent): boolean => {
    if (e.kind === 'assignment') return imp.assignments;
    // Assessment calendar events split into quizzes vs tests/exams by title word.
    return /\bquiz(zes)?\b/i.test(e.summary) ? imp.quizzes : imp.assessments;
  };

  // --- collapse to one event per logical item, keeping the LATEST day ---
  const byKey = new Map<string, IcalEvent>();
  for (const e of taskEvents(events)) {
    if (e.date < today || e.date > horizon) continue; // future only, inside the window
    if (!allowed(e)) continue;
    const key = logicalKey(e);
    const prev = byKey.get(key);
    if (!prev || e.date > prev.date) byKey.set(key, e);
  }

  // --- only import keys we've never imported before ---
  const ledger = (await data.getProfile<SeenLedger>('imported')) || { keys: [] };
  const seen = new Set(ledger.keys);
  const fresh: { key: string; e: IcalEvent }[] = [];
  for (const [key, e] of byKey) {
    if (!seen.has(key)) fresh.push({ key, e });
  }

  // --- GROUND TRUTH BEATS GUESSING -----------------------------------------
  // The companion extension reads each assignment's REAL course off the student's
  // own Schoology pages and stores it in the cloud (profile/courseLabels), keyed by
  // the same /assignment/<id> this feed carries. So the label map is consulted
  // FIRST, and the heuristic engine only handles what has no true label yet.
  // Because the labels live in the cloud rather than in the extension, a phone —
  // where extensions cannot run — gets the exact same course names.
  const labels = await loadLabels(data);
  const trueCourse = (e: IcalEvent): string => (e.assignmentId ? labelFor(labels, e.assignmentId) : '');

  // Classify (incl. the AI call) only the items with no ground-truth label — this
  // also shrinks the batch the classifier ever sees.
  const needGuess = fresh.filter(({ e }) => !trueCourse(e));
  const guesses = await classifyBatch(
    needGuess.map(({ key, e }) => ({ id: key, title: e.summary, description: e.description }))
  );

  const toWrite: Task[] = fresh.map(({ key, e }) =>
    newTask(key, e, trueCourse(e) || guesses[key]?.course || '')
  );
  await data.putTasksBulk(toWrite);

  // --- carry feed ALTERATIONS onto ALREADY-imported tasks ---
  // Teachers rename assignments, move due dates, and rewrite instructions after
  // posting; each re-sync mirrors those changes onto the stored task. The user's
  // own edits always win: a field is only overwritten while its _manual flag is
  // unset (the flag is set the moment the user hand-edits title or date/time).
  // Never adds or removes tasks and never touches the ledger — deleted tasks stay
  // deleted. (`seen` here still holds only previously-imported keys — fresh keys
  // are added below — so brand-new tasks, already written complete, are skipped.)
  const existing = await data.getTasksAll();
  const altered: Task[] = [];
  for (const [key, e] of byKey) {
    if (!seen.has(key)) continue;
    const cur = existing['ical_' + key];
    if (!cur) continue; // user deleted the task — the ledger keeps it gone
    const next: Task = { ...cur };
    // What changed, by name — shown in the ✱ badge's tooltip. Starts from any
    // still-undismissed changes of earlier syncs, so nothing is silently replaced.
    const changes = new Set<string>(Array.isArray(cur.feedUpdated) ? cur.feedUpdated : []);
    let changed = false;
    if (!cur._manualTitle && cur.title !== e.summary) {
      next.title = e.summary;
      changes.add('name');
      // The cached translation belongs to the OLD title — drop it so the
      // auto-translate pass re-reads the renamed one.
      delete next.translatedTitle;
      delete next.translatedLang;
      delete next.translationChecked;
      changed = true;
    }
    if (!cur._manualDueDate && (cur.dueDate !== e.date || cur.dueTime !== e.time)) {
      if (cur.dueDate !== e.date) changes.add('due date');
      if (cur.dueTime !== e.time) changes.add('due time');
      next.dueDate = e.date;
      next.dueTime = e.time;
      changed = true;
    }
    if ((cur.details ?? '') !== e.description) {
      if (e.description) next.details = e.description;
      else delete next.details; // delete, not undefined — Firebase rejects undefined fields
      changes.add('instructions');
      changed = true;
    }
    if ((cur.schoologyUrl ?? '') !== e.url) {
      if (e.url) next.schoologyUrl = e.url;
      else delete next.schoologyUrl;
      changes.add('link');
      changed = true;
    }
    if (changed) {
      next.feedUpdated = [...changes]; // surfaces the ✱ "updated" badge on the task row
      altered.push(next);
    }
  }
  if (altered.length) await data.putTasksBulk(altered);

  // remember every key we've now seen so it never re-imports (even if deleted)
  for (const { key } of fresh) seen.add(key);
  await data.setProfile('imported', { keys: [...seen] });

  // --- schedule (dashboard card): collapse to latest day per title ---
  const schedByTitle = new Map<string, IcalEvent>();
  for (const e of scheduleEvents(events)) {
    const prev = schedByTitle.get(e.summary);
    if (!prev || e.date > prev.date) schedByTitle.set(e.summary, e);
  }
  const schedule: ScheduleItem[] = [...schedByTitle.values()].map((e) => ({
    id: e.id,
    title: e.summary,
    date: e.date,
    url: e.url,
  }));
  await data.setProfile('schedule', { list: schedule });

  // --- sync state ---
  await data.setProfile('schoology', {
    ...settings,
    lastSyncAt: new Date().toISOString(),
    lastSyncCount: byKey.size,
  } satisfies SchoologySettings);

  // Force views to re-read (the schedule card especially) even if 0 tasks changed.
  data.refresh();

  return {
    added: fresh.length,
    skipped: byKey.size - fresh.length,
    updated: altered.length,
    total: byKey.size,
    scheduleCount: schedule.length,
  };
}
// #endregion
