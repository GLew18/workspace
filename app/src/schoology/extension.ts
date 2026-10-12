// Cobalt: the Schoology payload (types + validation) and the course-label store.
//
// The file keeps its old name: it began as the client for the companion
// extension's Schoology scrape. Since 10/9/26 the only payload is the one the
// server builds from the student's real Schoology connection (sgyFetch, see
// api.ts); the extension no longer touches Schoology.
//
//   • coercePayload — rebuild a clean payload from whatever came over the wire.
//   • loadLabels / saveLabels / recordManualLabel / labelFor — the label store.
//   • applySgyPayload — merge labels in, fix already-imported tasks, seed the
//     course registry, remember teachers.
//
// STORAGE IS CLOUD, NOT LOCAL: labels persist at profile 'courseLabels' through
// Data (Firebase RTDB), so every device shows the same true course.
//
// PRECEDENCE (enforced in applySgyPayload): manual > ext > heuristic guess.
// A manual label is never overwritten by an import; an ext label DOES overwrite
// an older ext label, because teachers move assignments between courses.

import type { Data } from '../db';
import type { Task } from '../types';
import { getCourses, addCourse, registryHydratedFromStore } from '../courses/registry';
import { DEFAULT_COURSE_COLOR } from '../courses/maps';
import { saveSections, saveTeachers } from '../tasks/teachers';

// #region Public types — what sgyFetch sends
export interface SgyCourse {
  id: string; // Schoology section id from /course/<id>
  name: string;
}
/** One assignment read off Schoology's API, with the course resolved from the
 *  assignment's own section record. */
export interface SgyAssignment {
  id: string; // the /assignment/<id> join key
  title: string;
  description: string; // plain text (the server flattens Schoology's HTML)
  url: string;
  date: string; // 'YYYY-MM-DD'
  time: string; // 'HH:MM' or '' for all-day
  kind: 'assignment' | 'assessment';
  course: string; // '' when the section lookup failed
  /** Files, links and videos the teacher put on the assignment itself. */
  attachments?: SgyAttachment[];
}
export interface SgyAttachment {
  title: string; // may be '' (the app names it from the URL then)
  url: string; // https, openable by the student signed in to Schoology
}
/** A course's teacher and their Schoology email (Gabe, 10/8/26), what "Email
 *  teacher" opens Gmail with. Keyed by course NAME because that is what a task
 *  carries. */
export interface SgyTeacher {
  course: string;
  name: string;
  email: string;
}
export interface SgyPayload {
  host: string; // e.g. heschel.schoology.com
  courses: SgyCourse[];
  labels: Record<string, string>; // assignmentId -> courseName (exact ground truth)
  assignments?: SgyAssignment[]; // the student's upcoming work, when the API pass ran
  coverage?: { from: string; to: string }; // dates `assignments` is authoritative for
  teachers?: SgyTeacher[]; // who teaches each course, with email
  schedule?: { id: string; title: string; date: string; url: string }[]; // schedule posts, for the dashboard card
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
  coursesAdded: number; // new registry courses seeded from the payload
}
// #endregion

// #region Constants

/** Profile key for the label store. Cloud data (see header) — never localStorage. */
const LABELS_PROFILE_KEY = 'courseLabels';

/** The join to sync.ts: logicalKey 'assign_<id>' prefixed with 'ical_'. */
const TASK_ID_PREFIX = 'ical_assign_';

/** Assignment ids come from /assignment/(\d+) on both sides, so anything
 *  non-numeric is a broken scrape. Also keeps the profile write safe: RTDB
 *  rejects keys containing . # $ / [ ], and one bad key would fail the whole
 *  setProfile — digits can never do that. */
function isValidAssignmentId(id: string): boolean {
  return /^[0-9]+$/.test(id);
}
// #endregion


// #region Validation
/** Runtime validation of whatever came over the wire. A server a version ahead
 *  or behind the app is normal, so never trust the shape — rebuild a clean payload field by field and drop anything malformed. */
export function coercePayload(raw: unknown): SgyPayload | null {
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
  // Assignments: rebuilt field by field like everything else. Only accepted
  // together with a well-formed coverage window, because without one the sync
  // could not tell "missing from this list" apart from "outside its reach".
  const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;
  const MAX_ASSIGNMENTS = 2000;
  const MAX_TEXT = 20000;
  const MAX_ATTACHMENTS = 30;
  const cov = p.coverage;
  if (
    Array.isArray(p.assignments) &&
    cov &&
    typeof cov.from === 'string' &&
    typeof cov.to === 'string' &&
    DATE_RE.test(cov.from) &&
    DATE_RE.test(cov.to) &&
    cov.from <= cov.to
  ) {
    const list: SgyAssignment[] = [];
    for (const a of p.assignments) {
      if (list.length >= MAX_ASSIGNMENTS) break;
      if (!a || typeof a !== 'object') continue;
      const id = typeof a.id === 'string' ? a.id : '';
      const title = typeof a.title === 'string' ? a.title.trim() : '';
      const date = typeof a.date === 'string' ? a.date : '';
      if (!isValidAssignmentId(id) || !title || !DATE_RE.test(date)) continue;
      const time = typeof a.time === 'string' && /^\d{2}:\d{2}$/.test(a.time) ? a.time : '';
      const url = typeof a.url === 'string' && /^https:\/\//i.test(a.url) ? a.url.slice(0, 2000) : '';
      // Teacher attachments: https only (they become clickable links), bounded.
      const attachments: SgyAttachment[] = [];
      if (Array.isArray(a.attachments)) {
        for (const x of a.attachments as unknown[]) {
          if (attachments.length >= MAX_ATTACHMENTS) break;
          const at = x as Partial<SgyAttachment> | null;
          if (!at || typeof at.url !== 'string' || !/^https:\/\//i.test(at.url)) continue;
          attachments.push({
            title: typeof at.title === 'string' ? at.title.trim().slice(0, 200) : '',
            url: at.url.slice(0, 2000),
          });
        }
      }
      list.push({
        id,
        title: title.slice(0, 500),
        description: typeof a.description === 'string' ? a.description.slice(0, MAX_TEXT) : '',
        url,
        date,
        time,
        kind: a.kind === 'assessment' ? 'assessment' : 'assignment',
        course: typeof a.course === 'string' ? a.course.trim().slice(0, MAX_NAME) : '',
        // Present-or-absent, never `attachments: undefined` (RTDB rejects undefined).
        ...(attachments.length ? { attachments } : {}),
      });
    }
    out.assignments = list;
    out.coverage = { from: cov.from, to: cov.to };
  }
  // Teachers: only well-formed addresses survive. They become the To field of a
  // mail draft, so a malformed one is dropped here rather than trusted.
  if (Array.isArray(p.teachers)) {
    const MAX_TEACHERS = 300;
    const seen = new Set<string>();
    const list: SgyTeacher[] = [];
    for (const t of p.teachers as unknown[]) {
      if (list.length >= MAX_TEACHERS) break;
      const x = t as Partial<SgyTeacher> | null;
      if (!x || typeof x.course !== 'string' || typeof x.email !== 'string') continue;
      const course = x.course.trim().slice(0, MAX_NAME);
      const email = x.email.trim().toLowerCase().slice(0, 120);
      if (!course || !/^[^@\s,;<>]+@[^@\s,;<>]+\.[^@\s,;<>]+$/.test(email)) continue;
      if (seen.has(course + '|' + email)) continue;
      seen.add(course + '|' + email);
      list.push({ course, name: typeof x.name === 'string' ? x.name.trim().slice(0, 120) : '', email });
    }
    if (list.length) out.teachers = list;
  }
  // Optional fields only when present — a stored `undefined` would poison later
  // writes (RTDB rejects undefined; this codebase deletes keys instead).
  if (p.diag && typeof p.diag === 'object') out.diag = p.diag as Record<string, unknown>;
  return out;
}

// #endregion

// #region Label store — cloud profile, the same on every device
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

// #region applySgyPayload — merge labels, fix tasks, seed courses, remember teachers
/** Fold one payload into the account. Idempotent by design: every step compares
 *  before writing, so a second run over the same payload changes nothing and
 *  returns all-zero counts. */
export async function applySgyPayload(data: Data, payload: SgyPayload): Promise<ApplyResult> {
  const result: ApplyResult = { labeled: 0, corrected: 0, coursesAdded: 0 };
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
  // list (names, colors, parse words) with seeds. Labels/tasks still apply;
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

  // --- 4. remember who teaches each course ---
  // Replaces the stored list only when this payload actually carried teachers, so
  // a scrape that skipped the daily harvest (or an API pass the school's privacy
  // settings left without emails) never wipes addresses already known.
  if (payload.teachers?.length) await saveTeachers(data, payload.teachers);
  // Same rule for the course pages: only replace the stored list when this payload had one.
  if (payload.courses?.length && payload.host) await saveSections(data, payload.host, payload.courses);

  return result;
}
// #endregion
