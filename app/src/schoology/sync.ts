// Cobalt: Schoology import orchestration (client-side, on-demand).
//
// Runs on app open and when Settings is saved. Two sources feed it (see the
// Sources region): the companion extension's scrape when installed (assignments
// with true courses, refreshed every 30 min in the background) and the iCal feed
// as the no-extension fallback.
//
// Import rules:
//   • FUTURE only — assignments due today or later (no past backlog).
//   • Each logical item imported AT MOST ONCE, ever (a persistent "seen" ledger),
//     so re-syncs only add genuinely new items and never resurrect deleted ones.
//     EXCEPT: the manual "Refresh tasks" button (Tasks tab) passes force:true,
//     which imports anything in the feed that isn't CURRENTLY a task — the one
//     deliberate way to bring back something you deleted (see SyncOptions.force).
//   • An item posted on multiple calendar days collapses to its LATEST day.
//   • Logical identity = the assignment's /assignment/<id> (stable across days);
//     non-assignment events fall back to their title.
//   • ALTERATIONS carry through: when the feed's title / due date / due time /
//     description / link changed since import, the stored task is updated in
//     place — unless the user hand-edited that field (_manual* flags win).
//   • An assignment DELETED at the source (its VEVENT is gone from the feed
//     entirely, past or future) is removed from Cobalt too — unless it's
//     already checked off, which keeps completed work as a record.

import type { Data } from '../db';
import type { Task, ScheduleItem, SchoologySettings } from '../types';
import { parseIcal, taskEvents, scheduleEvents, type IcalEvent } from './ical';
import { classifyBatch } from './classify';
import {
  loadLabels,
  labelFor,
  detectSchoologyExtension,
  requestSgyData,
  type SgyPayload,
} from './extension';
import { extractLinks } from '../tasks/attachments';
import { clearTranslation, clearDetailsTranslation } from '../tasks/store';
import { getTaskFolders, patchTaskFolder } from '../tasks/folders';
import { genId } from '../util/ids';
import { todayStr, addDays } from '../util/dates';
import { getPrefs } from '../prefs';
import { firebaseConfig } from '../firebase';

// #region Types — the result of a sync + the persistent "already imported" ledger
export interface SyncResult {
  added: number;
  skipped: number; // already imported before (not re-added)
  updated: number; // already-imported tasks whose feed item changed (title/date/…)
  removed: number; // already-imported, incomplete tasks whose assignment vanished from the feed
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

// #region Sources — the extension's assignment list, shaped like feed events
// TWO SOURCES, ONE PIPELINE (Gabe, 10/6/26). With the companion extension
// installed, the assignments come straight off Schoology's own API (title, due
// date, instructions AND the true course), read on the student's machine inside
// their own session. The iCal feed is the no-extension fallback and, when both
// exist, fills in whatever lies beyond the extension's coverage window. Both are
// flattened to IcalEvent so everything below (dedup, ledger, alterations,
// deletions, folders) is written once. Task ids stay 'ical_assign_<id>' for both,
// which is what lets a phone (feed only) and a laptop (extension) agree on the
// same task.
type SourceEvent = IcalEvent & { course?: string; via: 'ext' | 'feed' };

function eventsFromSgy(payload: SgyPayload): SourceEvent[] {
  return (payload.assignments ?? []).map((a) => ({
    via: 'ext' as const,
    uid: 'sgy-' + a.id,
    id: a.id,
    assignmentId: a.id,
    summary: a.title,
    description: a.description,
    url: a.url,
    date: a.date,
    hasTime: !!a.time,
    time: a.time,
    kind: a.kind,
    course: a.course,
  }));
}

/** The extension's latest scrape, or null when it is absent or has no
 *  assignments. Never throws. */
async function extensionSource(given?: SgyPayload | null): Promise<SgyPayload | null> {
  try {
    const p = given === undefined ? ((await detectSchoologyExtension()) ? await requestSgyData() : null) : given;
    return p && p.assignments && p.assignments.length && p.coverage ? p : null;
  } catch {
    return null;
  }
}
// #endregion

// #region Builders — stable dedup key + new-task factory
/** Stable logical id for dedup: assignment id when present, else normalized title. */
function logicalKey(e: IcalEvent): string {
  if (e.assignmentId) return 'assign_' + e.assignmentId;
  return 'evt_' + e.summary.trim().toLowerCase().replace(/\s+/g, ' ');
}

/** Build a fresh imported task from an event + its classified course. */
function newTask(key: string, e: SourceEvent, course: string): Task {
  const t: Task = {
    id: 'ical_' + key,
    title: e.summary,
    dueDate: e.date,
    dueTime: e.time,
    timeLabel: '',
    course,
    source: 'schoology-ical',
    importedVia: e.via,
    completed: false,
    completedAt: null,
    priority: 'normal',
    addedAt: new Date().toISOString(),
    // Links a teacher pasted into the title or the instructions become real
    // attachments on arrival, named from the words in front of them. Without this
    // the reading sits buried in the ⓘ popup: no 📎 count, no "open all as a tab
    // group", and no 📎 on the row (which promotes itself only when a task has
    // attachments). `skipUrls` keeps the assignment from attaching itself.
    notes: extractLinks(
      { title: e.summary, details: e.description, skipUrls: [e.url] },
      genId
    ),
  };
  // Present-or-absent, never `field: undefined`: Firebase rejects the WHOLE
  // write for one explicitly-undefined property. An assignment whose only
  // "instructions" were the stripped "- Link:" suffix produced details:
  // undefined here, the set failed silently behind the optimistic UI, and the
  // task vanished on every reload while the seen-ledger swore it was imported
  // (the 9/20/26 "מי אני" hunt). Same rule as the alterations pass below.
  if (e.description) t.details = e.description;
  if (e.url) t.schoologyUrl = e.url;
  return t;
}
// #endregion

// #region runSync() — fetch → dedup → import new tasks → rebuild schedule → save state
export interface SyncOptions {
  /** Bypass the "never resurrect a deleted import" rule: import EVERY feed item
   *  that isn't CURRENTLY a task, even if its key is already in the seen ledger
   *  (i.e. it was imported once before and later deleted). Only the manual
   *  "Refresh tasks" button in the Tasks tab sets this (Gabe, 9/16/26: a Schoology
   *  assignment he'd deleted, or that predated his link, should come back with one
   *  press instead of staying gone forever). The background auto-sync and the
   *  Settings "Save & sync" keep the default, ledger-respecting behavior — an
   *  automatic sync silently un-deleting a task would be its own kind of bug. */
  force?: boolean;
  /** The extension's payload when the caller already holds it (onboarding does).
   *  `null` means "do not ask the extension"; omitted means ask it. */
  sgy?: SgyPayload | null;
}

/** Full import pass. Returns counts; throws only when NO source can be read:
 *  no feed link and no extension data, or the feed failed with no extension
 *  data to fall back on. */
export async function runSync(data: Data, opts: SyncOptions = {}): Promise<SyncResult> {
  const settings = await data.getProfile<SchoologySettings>('schoology');
  const sgy = await extensionSource(opts.sgy);
  if (!settings?.icalUrl && !sgy) throw new Error('No Schoology link configured.');

  // --- gather: feed (when linked) + extension (when installed) ---------------
  // The feed is the only source of schedule posts and of anything past the
  // extension's window, so it is still read when a link exists; a feed failure
  // is fatal only when the extension cannot carry the sync alone.
  let feedEvents: IcalEvent[] = [];
  let feedRead = false;
  if (settings?.icalUrl) {
    try {
      feedEvents = parseIcal(await fetchIcal(settings.icalUrl));
      feedRead = true;
    } catch (err) {
      if (!sgy) throw err;
    }
  }
  const events = feedEvents;
  // Extension entries win over the feed's for the same assignment: they carry
  // the true course and come from the record itself rather than a calendar copy.
  const sourceTasks = new Map<string, SourceEvent>();
  for (const e of taskEvents(feedEvents)) {
    const key = logicalKey(e);
    const prev = sourceTasks.get(key);
    if (!prev || e.date > prev.date) sourceTasks.set(key, { ...e, via: 'feed' });
  }
  if (sgy) {
    for (const e of eventsFromSgy(sgy)) sourceTasks.set(logicalKey(e), e);
  }
  const today = todayStr();

  // Settings ▸ Tasks ▸ Import: which event types come in, and how far ahead.
  const imp = getPrefs().importPrefs;
  const horizon = addDays(today, imp.windowDays);
  const allowed = (e: IcalEvent): boolean => {
    if (e.kind === 'assignment') return imp.assignments;
    // Assessment calendar events split into quizzes vs tests/exams by title word.
    return /\bquiz(zes)?\b/i.test(e.summary) ? imp.quizzes : imp.assessments;
  };

  // --- one event per logical item (latest day, see the gather above), windowed ---
  const byKey = new Map<string, SourceEvent>();
  for (const [key, e] of sourceTasks) {
    if (e.date < today || e.date > horizon) continue; // future only, inside the window
    if (!allowed(e)) continue;
    byKey.set(key, e);
  }

  // --- only import keys we've never imported before (or, forced: keys that
  // aren't CURRENTLY a task — see SyncOptions.force above) ---
  const ledger = (await data.getProfile<SeenLedger>('imported')) || { keys: [] };
  const seen = new Set(ledger.keys);
  const existing = await data.getTasksAll(); // also reused by the alterations pass below
  const fresh: { key: string; e: SourceEvent }[] = [];
  for (const [key, e] of byKey) {
    const isNew = opts.force ? !existing['ical_' + key] : !seen.has(key);
    if (isNew) fresh.push({ key, e });
  }

  // --- GROUND TRUTH BEATS GUESSING -----------------------------------------
  // The companion extension reads each assignment's REAL course off the student's
  // own Schoology pages and stores it in the cloud (profile/courseLabels), keyed by
  // the same /assignment/<id> this feed carries. So the label map is consulted
  // FIRST, and the heuristic engine only handles what has no true label yet.
  // Because the labels live in the cloud rather than in the extension, a phone —
  // where extensions cannot run — gets the exact same course names.
  // An extension-sourced event already names its course (read from the
  // assignment's own section record), which outranks even the stored label map.
  const labels = await loadLabels(data);
  const trueCourse = (e: SourceEvent): string =>
    e.course || (e.assignmentId ? labelFor(labels, e.assignmentId) : '');

  // Classify (incl. the AI call) only the items with no ground-truth label — this
  // also shrinks the batch the classifier ever sees.
  const needGuess = fresh.filter(({ e }) => !trueCourse(e));
  const guesses = await classifyBatch(
    needGuess.map(({ key, e }) => ({ id: key, title: e.summary, description: e.description }))
  );

  const toWrite: Task[] = fresh.map(({ key, e }) =>
    newTask(key, e, trueCourse(e) || guesses[key]?.course || '')
  );

  // --- AUTO-FILE INTO FOLDERS (Gabe, 9/1/26) ---------------------------------
  // A folder can claim a course: everything that course sends from Schoology from
  // now on lands inside it instead of loose in the day groups. Only NEW arrivals
  // are filed, and only here — a task the student typed themselves is one they
  // already placed, and re-filing it would move their work out from under them.
  //
  // First folder wins if two claim the same course. That is the folder highest in
  // the student's own hand-ordered list, which is the only ranking that means
  // anything here, and it keeps an assignment in exactly one place.
  //
  // Matched on CASE ALONE, deliberately. Both sides already hold a course name the
  // registry produced, so anything fuzzier would only ever invent a match the
  // student never asked for — the same discipline the parse-word engine keeps.
  const folders = await getTaskFolders(data);
  const claimed = new Map<string, string>(); // course (lowercased) → folder id
  for (const f of folders) {
    if (!f.autoFile || !f.autoFileCourse) continue;
    const k = f.autoFileCourse.trim().toLowerCase();
    if (k && !claimed.has(k)) claimed.set(k, f.id);
  }
  if (claimed.size) {
    // Everything filed here is also recorded as UNSEEN on its folder — that list is
    // what the folder's red dot counts, and expanding the folder clears it. Without
    // this the assignment lands silently: a collapsed folder's only visible change
    // is its task count ticking up by one, which is not something anyone notices.
    const filed = new Map<string, string[]>(); // folder id → newly filed task ids
    for (const t of toWrite) {
      const fid = t.course ? claimed.get(t.course.trim().toLowerCase()) : undefined;
      if (!fid) continue;
      t.folderId = fid;
      const list = filed.get(fid) ?? [];
      list.push(t.id);
      filed.set(fid, list);
    }
    // Patched one folder at a time rather than writing the whole array back: the
    // Tasks tab and Focus each hold their own copy of the folder list, so a whole-
    // array write from here can erase a folder one of them created since this
    // function read its copy. Union with whatever is already unseen, so two syncs
    // before the student looks leave both assignments counted once, not twice.
    for (const f of folders) {
      const add = filed.get(f.id);
      if (!add) continue;
      await patchTaskFolder(data, f.id, {
        newAutoFiled: [...new Set([...(f.newAutoFiled ?? []), ...add])],
      });
    }
  }

  await data.putTasksBulk(toWrite);

  // --- carry feed ALTERATIONS onto ALREADY-imported tasks ---
  // Teachers rename assignments, move due dates, and rewrite instructions after
  // posting; each re-sync mirrors those changes onto the stored task. The user's
  // own edits always win: a field is only overwritten while its _manual flag is
  // unset (the flag is set the moment the user hand-edits title or date/time).
  // Never adds or removes tasks and never touches the ledger — deleted tasks stay
  // deleted (outside `force`). (`seen` here still holds only previously-imported
  // keys — fresh keys are added below — so brand-new tasks, just written above,
  // are skipped: `existing` was fetched before that write, so it doesn't have them
  // either, which lands on the same "skip" via the `!cur` check right below.)
  const altered: Task[] = [];
  for (const [key, e] of byKey) {
    if (!seen.has(key)) continue;
    const cur = existing['ical_' + key];
    if (!cur) continue; // user deleted the task — the ledger keeps it gone
    const next: Task = { ...cur };
    // What changed, by name — shown in the ✱ badge's tooltip. Starts from any
    // still-undismissed changes of earlier syncs, so nothing is silently replaced.
    const changes = new Set<string>(Array.isArray(cur.feedUpdated) ? cur.feedUpdated : []);
    // WHAT IT SAID BEFORE, for the ✱ badge's before/after (see Task.feedPrev and
    // tasks/feedDiff.ts). FIRST WRITE WINS per field, which is why this starts from
    // whatever the last un-dismissed sync recorded: the student is comparing against
    // the version they last read, not against yesterday's intermediate one.
    const prev: NonNullable<Task['feedPrev']> = { ...(cur.feedPrev ?? {}) };
    const remember = (k: keyof NonNullable<Task['feedPrev']>, v: string): void => {
      if (prev[k] === undefined) prev[k] = v;
    };
    let changed = false;
    if (!cur._manualTitle && cur.title !== e.summary) {
      remember('title', cur.title);
      next.title = e.summary;
      changes.add('name');
      // Everything the app worked out about the OLD title goes with it, so the passes
      // read the renamed one from scratch. See clearTranslation for why this is not a
      // list of fields written out here.
      Object.assign(next, clearTranslation(next));
      changed = true;
    }
    if (!cur._manualDueDate && (cur.dueDate !== e.date || cur.dueTime !== e.time)) {
      if (cur.dueDate !== e.date) {
        remember('dueDate', cur.dueDate);
        changes.add('due date');
      }
      if (cur.dueTime !== e.time) {
        remember('dueTime', cur.dueTime);
        changes.add('due time');
      }
      next.dueDate = e.date;
      next.dueTime = e.time;
      // A pin is an index within a DUE-DATE group, so a re-sync that moves the
      // deadline invalidates it (same reasoning as the Tasks-tab date editor).
      // Leaving it would carry the old day's slot number into the new day.
      if (cur.dueDate !== e.date) delete next.manualOrder;
      changed = true;
    }
    // Instructions and the link are flattened slightly differently by the two
    // sources, so the feed may not rewrite them on a task the extension wrote:
    // otherwise a phone (feed) and a laptop (extension) would flip them back and
    // forth and raise a false ✱ on every sync. Title and due date are identical
    // across sources and carry from either.
    const weakFieldsOk = e.via === 'ext' || cur.importedVia !== 'ext';
    if (weakFieldsOk && (cur.details ?? '') !== e.description) {
      remember('details', cur.details ?? '');
      if (e.description) next.details = e.description;
      else delete next.details; // delete, not undefined — Firebase rejects undefined fields
      // The reading belonged to the instructions that were just replaced.
      Object.assign(next, clearDetailsTranslation(next));
      changes.add('instructions');
      changed = true;

      // A teacher who edits the instructions usually does it to ADD the link. Pull
      // in any that are new, and only new ones: this APPENDS and never removes, so
      // attachments the student added by hand, and names they renamed, both survive
      // a re-sync. Matching is by URL, so an edit elsewhere in the text is a no-op.
      const have = new Set((cur.notes ?? []).map((n) => n.url.trim().replace(/\/+$/, '')));
      const fresh = extractLinks(
        { title: e.summary, details: e.description, skipUrls: [e.url] },
        genId
      ).filter((n) => !have.has(n.url.trim().replace(/\/+$/, '')));
      if (fresh.length) {
        next.notes = [...(cur.notes ?? []), ...fresh];
        changes.add(fresh.length === 1 ? 'an attachment' : 'attachments');
      }
    }
    if (weakFieldsOk && (cur.schoologyUrl ?? '') !== e.url) {
      remember('schoologyUrl', cur.schoologyUrl ?? '');
      if (e.url) next.schoologyUrl = e.url;
      else delete next.schoologyUrl;
      changes.add('link');
      changed = true;
    }
    if (changed) {
      if (e.via === 'ext') next.importedVia = 'ext';
      next.feedUpdated = [...changes]; // surfaces the ✱ "updated" badge on the task row
      // Never store an empty ghost. Today every branch that sets `changed` also
      // calls remember(), so this is always populated here; the check is what keeps
      // that true if a future branch forgets, rather than writing `{}` for nothing.
      if (Object.keys(prev).length) next.feedPrev = prev;
      altered.push(next);
    }
  }
  if (altered.length) await data.putTasksBulk(altered);

  // --- remove tasks whose Schoology assignment was deleted at the source ---
  // A teacher deleting an assignment just drops its VEVENT from the feed — no
  // "cancelled" marker, no matter whether the due date is past or future. Check
  // against the FULL unfiltered feed (not `byKey`, which is future-windowed and
  // import-preference-filtered) so an assignment that's merely overdue, or of a
  // type you've toggled off in Import, is never mistaken for deleted. Only
  // incomplete schoology-ical imports are candidates: completed work stays as a
  // record even if the source assignment disappears later, and nothing the
  // student typed themselves is ever touched.
  //
  // With the extension as a source, "absent" only counts where that source could
  // have seen it: inside its coverage window. A feed that was read covers every
  // date; a feed that was not read (no link, or it failed and the extension carried
  // the sync) covers none, so a task outside the extension's window is left alone.
  const allSourceKeys = new Set(sourceTasks.keys());
  const covered = (t: Task): boolean => {
    if (feedRead) return true;
    const c = sgy?.coverage;
    return !!c && t.dueDate >= c.from && t.dueDate <= c.to;
  };
  const gone = Object.entries(existing)
    .filter(([, t]) => t.source === 'schoology-ical' && !t.completed && covered(t))
    .map(([id]) => id)
    .filter((id) => !allSourceKeys.has(id.slice('ical_'.length)));
  if (gone.length) {
    await data.removeTasksBulk(gone);
    // Drop their keys from the ledger too: the SOURCE deleted these, not the
    // student, so if a teacher re-posts the same assignment it should come back
    // on its own instead of needing the force button.
    for (const id of gone) seen.delete(id.slice('ical_'.length));
  }

  // remember every key we've now seen so it never re-imports (even if deleted)
  for (const { key } of fresh) seen.add(key);
  await data.setProfile('imported', { keys: [...seen] });

  // --- schedule (dashboard card): collapse to latest day per title ---
  // Feed only: schedule posts are calendar events, not assignments, so the
  // extension's list never carries them. Left untouched when the feed was not read.
  let scheduleCount = 0;
  if (feedRead) {
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
    scheduleCount = schedule.length;
  }

  // --- sync state ---
  await data.setProfile('schoology', {
    ...(settings ?? { icalUrl: '' }),
    lastSyncAt: new Date().toISOString(),
    lastSyncCount: byKey.size,
  } satisfies SchoologySettings);

  // Force views to re-read (the schedule card especially) even if 0 tasks changed.
  data.refresh();

  return {
    added: fresh.length,
    skipped: byKey.size - fresh.length,
    updated: altered.length,
    removed: gone.length,
    total: byKey.size,
    scheduleCount,
  };
}
// #endregion
