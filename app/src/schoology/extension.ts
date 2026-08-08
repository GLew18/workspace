// WorkSpace — Schoology-extension client + course-label store.
//
// The iCal feed has NO course names, so imported tasks get their course from a
// heuristic guess — the app's biggest credibility risk. The companion extension
// reads the REAL course label for every assignment straight off the signed-in
// Schoology pages (the same session access Schoology's own UI uses; no password,
// no cookies ever touched here) and hands it over as assignmentId → courseName.
// That joins to tasks EXACTLY: the feed URL and the Schoology DOM both carry the
// same /assignment/<id>, and sync.ts writes those tasks as 'ical_assign_<id>'.
//
// This module is the app side of that bridge:
//   • detectSchoologyExtension / requestSgyData — talk to the extension over the
//     same transport as bookmarks/shortcuts.ts (direct chrome.runtime.sendMessage
//     when the published id is known, window.postMessage bridge otherwise).
//   • loadLabels / saveLabels / recordManualLabel / labelFor — the label store.
//   • applySgyPayload — merge scraped labels in, fix already-imported tasks,
//     seed the course registry, and auto-capture the iCal URL.
//
// STORAGE IS CLOUD, NOT LOCAL: labels persist at profile 'courseLabels' through
// Data (Firebase RTDB). That is the entire reason this design works on mobile —
// the extension only exists on desktop Chrome, but once it has labeled an
// assignment there, a phone with no extension reads the same profile and shows
// the same true course.
//
// PRECEDENCE (enforced in applySgyPayload): manual > ext > heuristic guess.
// A manual label is never overwritten by a scrape; an ext label DOES overwrite
// an older ext label, because teachers move assignments between courses.

import type { Data } from '../db';
import type { Task, SchoologySettings } from '../types';
import { getCourses, addCourse, registryHydratedFromStore } from '../courses/registry';
import { DEFAULT_COURSE_COLOR } from '../courses/maps';
import { detectExtension, EXTENSION_ID, PROTOCOL_VERSION, PING_TIMEOUT_MS } from '../bookmarks/shortcuts';
import { genId } from '../util/ids';
import { isSchoologyIcalUrl } from './ical';

// #region Public types — mirrored field-for-field in the extension (plain JS side)
export interface SgyCourse {
  id: string; // Schoology section id from /course/<id>
  name: string;
}
export interface SgyPayload {
  host: string; // e.g. heschel.schoology.com
  icalUrl?: string; // personal iCal feed URL, when the scrape discovered it
  courses: SgyCourse[];
  labels: Record<string, string>; // assignmentId -> courseName (exact ground truth)
  scrapedAt: number;
  diag?: Record<string, unknown>; // which scrape strategies matched — troubleshooting only
}
export interface CourseLabel {
  course: string;
  src: 'ext' | 'manual';
  at: number;
}
export type LabelMap = Record<string, CourseLabel>;
export interface ApplyResult {
  labeled: number; // tasks that had NO course and got one
  corrected: number; // tasks whose guessed course was wrong and got fixed
  coursesAdded: number; // new registry courses seeded from the scrape
  icalCaptured: boolean; // the feed URL was auto-configured this pass
}
// #endregion

// #region Constants
/** Profile key for the label store. Cloud data (see header) — never localStorage. */
const LABELS_PROFILE_KEY = 'courseLabels';

/** The join to sync.ts: logicalKey 'assign_<id>' prefixed with 'ical_'. */
const TASK_ID_PREFIX = 'ical_assign_';

/** SGY_GET is a chrome.storage read in the SW — fast. SGY_REFRESH asks a live
 *  Schoology tab to re-scrape first, so it gets a much longer leash. */
const GET_TIMEOUT_MS = 2000;
const REFRESH_TIMEOUT_MS = 10000;

/** Assignment ids come from /assignment/(\d+) on both sides, so anything
 *  non-numeric is a broken scrape. Also keeps the profile write safe: RTDB
 *  rejects keys containing . # $ / [ ], and one bad key would fail the whole
 *  setProfile — digits can never do that. */
function isValidAssignmentId(id: string): boolean {
  return /^[0-9]+$/.test(id);
}
// #endregion

// #region Minimal chrome typings (no @types/chrome in this project; mirrors shortcuts.ts)
interface ChromeRuntimeLike {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void
  ) => void;
  lastError?: { message?: string } | undefined;
}
function getChromeRuntime(): ChromeRuntimeLike | undefined {
  return (window as unknown as { chrome?: { runtime?: ChromeRuntimeLike } }).chrome?.runtime;
}
// #endregion

// #region Transport — detect + request/response with the extension
/** True when the WorkSpace companion extension answers a ping. Same extension as
 *  shortcuts, so this simply reuses its detector (ping/pong over both channels,
 *  5s positive cache). Never throws; absent/blocked chrome APIs → false. */
export async function detectSchoologyExtension(timeoutMs?: number): Promise<boolean> {
  try {
    const r = await detectExtension(timeoutMs ?? PING_TIMEOUT_MS);
    return r.installed;
  } catch {
    return false;
  }
}

/** Is this the student's own Schoology personal-calendar feed? Anything else must
 *  never reach account settings (see the icalUrl note in coercePayload).
 *  The check itself now lives in schoology/ical.ts (isSchoologyIcalUrl) so
 *  onboarding, Settings, and this wire-payload guard all share ONE validator. */
const isSchoologyFeedUrl = isSchoologyIcalUrl;

/** Runtime validation of whatever came over the wire. The extension is plain JS
 *  and a version ahead/behind of the app is normal, so never trust the shape —
 *  rebuild a clean payload field by field and drop anything malformed. */
function coercePayload(raw: unknown): SgyPayload | null {
  if (!raw || typeof raw !== 'object') return null;
  const p = raw as Partial<SgyPayload>;
  if (typeof p.host !== 'string' || !Array.isArray(p.courses) || !p.labels || typeof p.labels !== 'object') {
    return null;
  }
  // Caps: this payload crosses a message boundary and lands in a cloud profile
  // write plus the course registry. A buggy scrape (or a spoofed bridge message)
  // with tens of thousands of entries or a 50KB "course name" would bloat the
  // profile and flood Settings with junk chips, so bound it here at the door.
  const MAX_NAME = 120;
  const MAX_COURSES = 100;
  const MAX_LABELS = 5000;
  const courses: SgyCourse[] = [];
  for (const c of p.courses) {
    if (courses.length >= MAX_COURSES) break;
    if (c && typeof c.id === 'string' && typeof c.name === 'string' && c.name.trim()) {
      courses.push({ id: c.id.slice(0, 64), name: c.name.trim().slice(0, MAX_NAME) });
    }
  }
  const labels: Record<string, string> = {};
  let labelCount = 0;
  for (const [id, name] of Object.entries(p.labels as Record<string, unknown>)) {
    if (labelCount >= MAX_LABELS) break;
    if (isValidAssignmentId(id) && typeof name === 'string' && name.trim()) {
      labels[id] = name.trim().slice(0, MAX_NAME);
      labelCount++;
    }
  }
  const out: SgyPayload = {
    host: p.host,
    courses,
    labels,
    scrapedAt: typeof p.scrapedAt === 'number' ? p.scrapedAt : Date.now(),
  };
  // Optional fields only when present — a stored `undefined` would poison later
  // writes (RTDB rejects undefined; this codebase deletes keys instead).
  // icalUrl is re-validated HERE as well as in the extension: it gets written into
  // account settings first-write-wins, so a wrong capture (a teacher-posted third
  // party calendar link) would silently import someone else's calendar forever.
  // Belt-and-braces on both sides means one side regressing cannot open the hole.
  if (typeof p.icalUrl === 'string' && isSchoologyFeedUrl(p.icalUrl)) out.icalUrl = p.icalUrl;
  if (p.diag && typeof p.diag === 'object') out.diag = p.diag as Record<string, unknown>;
  return out;
}

/** One request→response round-trip. Same dual-channel scheme as shortcuts.ts:
 *  direct chrome.runtime.sendMessage when the published id is known, PLUS the
 *  postMessage bridge (dev/localhost, Firefox/Safari, unpublished builds where
 *  only bridge.js knows the id). Unlike SYNC_SHORTCUTS, sending on both channels
 *  is safe here — SGY_GET is a pure read and SGY_REFRESH's re-scrape is
 *  idempotent — and the reqId settle-once guard dedupes a double reply. */
function sendSgyRequest(type: 'SGY_GET' | 'SGY_REFRESH', timeoutMs: number): Promise<SgyPayload | null> {
  const reqId = 'sgy_' + genId();
  const msg = { source: 'workspace', v: PROTOCOL_VERSION, type, reqId };

  return new Promise<SgyPayload | null>((resolve) => {
    let settled = false;
    let timer = 0;
    const finish = (payload: SgyPayload | null): void => {
      if (settled) return;
      settled = true;
      window.clearTimeout(timer);
      window.removeEventListener('message', onMsg);
      resolve(payload);
    };

    // Bridge channel replies arrive as same-window postMessages tagged with our reqId.
    const onMsg = (ev: MessageEvent): void => {
      if (ev.source !== window) return; // only same-window relays from bridge.js
      const d = ev.data as
        | { source?: string; type?: string; reqId?: string; payload?: unknown }
        | undefined;
      if (!d || d.source !== 'workspace-ext' || d.type !== 'SGY_DATA' || d.reqId !== reqId) return;
      finish(coercePayload(d.payload));
    };
    window.addEventListener('message', onMsg);

    // 1. Direct channel (published extension with a known id). The announced-id
    //    fallback lives privately in shortcuts.ts; without EXTENSION_ID the
    //    bridge below is the only path — exactly like syncShortcutsToExtension.
    const runtime = getChromeRuntime();
    if (runtime && runtime.sendMessage && EXTENSION_ID) {
      try {
        runtime.sendMessage(EXTENSION_ID, msg, (response: unknown) => {
          if (runtime.lastError) return; // not reachable directly; bridge/timer decides
          const r = response as { source?: string; type?: string; payload?: unknown } | undefined;
          if (r && r.source === 'workspace-ext' && r.type === 'SGY_DATA') {
            finish(coercePayload(r.payload));
          }
        });
      } catch {
        /* unknown id throws synchronously in some browsers — bridge/timer decides */
      }
    }

    // 2. Bridge channel.
    try {
      window.postMessage(msg, location.origin);
    } catch {
      /* ignore */
    }

    // 3. Nothing answered in time → no extension / no data. Silence, never throw.
    timer = window.setTimeout(() => finish(null), timeoutMs);
  });
}

/** Fetch the extension's scraped Schoology data. `refresh` asks any open
 *  schoology.com tab to re-scrape first (SGY_REFRESH), else it's the cached
 *  chrome.storage copy (SGY_GET). Resolves null when the extension is absent,
 *  times out, or replies garbage — callers need no try/catch. */
export async function requestSgyData(refresh?: boolean): Promise<SgyPayload | null> {
  try {
    return await sendSgyRequest(
      refresh ? 'SGY_REFRESH' : 'SGY_GET',
      refresh ? REFRESH_TIMEOUT_MS : GET_TIMEOUT_MS
    );
  } catch {
    return null; // transport must never take the caller down
  }
}
// #endregion

// #region Label store — cloud profile, survives devices without the extension
/** Read the label map from the profile. Normalizes on read (same policy as
 *  registry/db: the storage boundary is where stored data gets made safe), so
 *  consumers can trust every entry. Never throws — a failed read is just {}. */
export async function loadLabels(data: Data): Promise<LabelMap> {
  try {
    const stored = await data.getProfile<LabelMap>(LABELS_PROFILE_KEY);
    if (!stored || typeof stored !== 'object') return {};
    const out: LabelMap = {};
    for (const [id, l] of Object.entries(stored)) {
      if (!l || typeof l.course !== 'string' || !l.course) continue;
      out[id] = {
        course: l.course,
        // Anything that isn't explicitly manual demotes to ext, so a corrupted
        // src can never accidentally claim manual's always-wins precedence.
        src: l.src === 'manual' ? 'manual' : 'ext',
        at: typeof l.at === 'number' ? l.at : 0,
      };
    }
    return out;
  } catch {
    return {};
  }
}

/** Persist the label map. Entries are rebuilt field-by-field so no undefined can
 *  reach the write (RTDB rejects undefined fields). */
export async function saveLabels(data: Data, labels: LabelMap): Promise<void> {
  const clean: LabelMap = {};
  for (const [id, l] of Object.entries(labels)) {
    if (!l || !l.course) continue;
    clean[id] = { course: l.course, src: l.src === 'manual' ? 'manual' : 'ext', at: l.at || 0 };
  }
  await data.setProfile(LABELS_PROFILE_KEY, clean);
}

/** The user hand-picked a course for this assignment. src 'manual' outranks every
 *  future scrape (applySgyPayload will never overwrite it), so a deliberate
 *  correction sticks even when Schoology disagrees. */
export async function recordManualLabel(data: Data, assignmentId: string, course: string): Promise<void> {
  const id = assignmentId.trim();
  const name = course.trim();
  if (!isValidAssignmentId(id) || !name) return;
  const labels = await loadLabels(data);
  const cur = labels[id];
  if (cur && cur.src === 'manual' && cur.course === name) return; // already recorded
  labels[id] = { course: name, src: 'manual', at: Date.now() };
  await saveLabels(data, labels);
}

/** Record a hand-set course straight from a task, for the two UI edit paths (Tasks
 *  tab chip, Focus todo). Only imported Schoology tasks carry an assignment id —
 *  a typed task has nothing to label, so this is a silent no-op for those. Never
 *  throws: a label-store hiccup must not break saving the task itself. */
export async function recordManualLabelForTask(data: Data, task: Task, course: string): Promise<void> {
  try {
    if (!task.id.startsWith(TASK_ID_PREFIX)) return;
    await recordManualLabel(data, task.id.slice(TASK_ID_PREFIX.length), course);
  } catch {
    /* best-effort */
  }
}

/** The effective course for an assignment, '' when unlabeled. */
export function labelFor(labels: LabelMap, assignmentId: string): string {
  const l = labels[assignmentId];
  return l ? l.course : '';
}
// #endregion

// #region applySgyPayload — merge labels, fix tasks, seed courses, capture the feed URL
/** Fold one scrape into the account. Idempotent by design: every step compares
 *  before writing, so a second run over the same payload changes nothing and
 *  returns all-zero counts. */
export async function applySgyPayload(data: Data, payload: SgyPayload): Promise<ApplyResult> {
  const result: ApplyResult = { labeled: 0, corrected: 0, coursesAdded: 0, icalCaptured: false };
  if (!payload || typeof payload !== 'object') return result;
  const scrapedLabels = payload.labels && typeof payload.labels === 'object' ? payload.labels : {};

  // --- 1. merge scraped labels into the stored map (manual > ext > guess) ---
  const labels = await loadLabels(data);
  let labelsChanged = false;
  for (const [id, courseRaw] of Object.entries(scrapedLabels)) {
    const course = typeof courseRaw === 'string' ? courseRaw.trim() : '';
    if (!isValidAssignmentId(id) || !course) continue;
    const cur = labels[id];
    if (cur && cur.src === 'manual') continue; // the user's correction always wins
    if (cur && cur.course === course) continue; // unchanged → no write, no `at` churn
    // ext-over-ext IS allowed: teachers move assignments between courses, and the
    // newest scrape is the newest truth.
    labels[id] = {
      course,
      src: 'ext',
      at: typeof payload.scrapedAt === 'number' ? payload.scrapedAt : Date.now(),
    };
    labelsChanged = true;
  }
  if (labelsChanged) await saveLabels(data, labels);

  // --- 2. seed the course registry from the scraped course list ---
  // ADD-only: a course the user already has (case-insensitive) is left exactly as
  // is — never renamed, recolored, or deleted. New ones get the default gray; the
  // user picks real colors in Settings.
  //
  // GATED on the registry actually holding the user's STORED courses. addCourse
  // persists the whole in-memory list, and initRegistry deliberately keeps seeded
  // defaults in memory only — because an empty read can be a transient blank rather
  // than a new user. This is the first AUTOMATIC caller, so without this gate one
  // background scrape landing in that blank window would overwrite a curated course
  // list (names, colors, parse words) with seeds. Labels/tasks/iCal still apply;
  // only seeding waits, and the next run picks it up.
  if (registryHydratedFromStore()) {
    const have = new Set(getCourses().map((c) => c.name.toLowerCase().trim()));
    // Seed from the labels too, not just the course list: courseTextNear can name a
    // course the nav never listed, and a task stamped with a course the registry
    // lacks renders gray and is missing from Settings.
    const names = [
      ...(payload.courses ?? []).map((c) => (c?.name ?? '').trim()),
      ...Object.values(scrapedLabels).map((n) => (typeof n === 'string' ? n.trim() : '')),
    ];
    for (const name of names) {
      if (!name || have.has(name.toLowerCase())) continue;
      await addCourse(name, DEFAULT_COURSE_COLOR);
      have.add(name.toLowerCase());
      result.coursesAdded++;
    }
  }

  // --- 3. re-course already-imported tasks in place ---
  // Read the effective label from the MERGED map (not the raw payload), so a
  // stored manual label steers the task even when this scrape says otherwise.
  const tasks = await data.getTasksAll();
  const changed: Task[] = [];
  for (const id of Object.keys(scrapedLabels)) {
    const course = labelFor(labels, id);
    if (!course) continue;
    const t = tasks[TASK_ID_PREFIX + id];
    if (!t) continue; // never imported, or deleted — labels wait in the store either way
    // The user hand-edited this task's course chip — same rule as sync.ts: the
    // _manual* flag freezes the field against every import path, including us.
    if (t._manualCourse) continue;
    if (t.course === course) continue;
    if (t.course && t.course.trim()) result.corrected++;
    else result.labeled++;
    changed.push({ ...t, course });
  }
  if (changed.length) await data.putTasksBulk(changed);

  // --- 4. auto-capture the iCal feed URL ---
  // The whole point: the extension finds the personal feed URL so the user never
  // pastes one. FIRST-write only — an already-configured URL is the user's (or a
  // previous capture's) and is never overwritten.
  if (payload.icalUrl && typeof payload.icalUrl === 'string') {
    const settings = await data.getProfile<SchoologySettings>('schoology');
    if (!settings?.icalUrl) {
      const next: SchoologySettings = {
        icalUrl: payload.icalUrl,
        lastSyncAt: settings?.lastSyncAt ?? null,
      };
      // Optional field: only carry it when it exists — never write undefined.
      if (typeof settings?.lastSyncCount === 'number') next.lastSyncCount = settings.lastSyncCount;
      await data.setProfile('schoology', next);
      result.icalCaptured = true;
    }
  }

  return result;
}
// #endregion
