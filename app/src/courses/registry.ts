// WorkSpace — runtime course registry.
//
// The single source of truth for the user's courses, colors, and parse words.
// Seeded from the static Heschel catalog (maps.ts) on first run, then fully
// user-editable via the preferences screen and persisted at profile/courses.
//
// This powers Layer 1 of course attribution (deterministic parse-word matching)
// for BOTH typed quick-add tasks and Schoology calendar imports.

import type { Data } from '../db';
import type { CourseConfig, Task } from '../types';
import { genId } from '../util/ids';
import { COURSE_COLORS, COURSE_ABBR, DEFAULT_COURSE_COLOR } from './maps';
import { getCourseColor as staticColor } from './normalize';

let courses: CourseConfig[] = [];
let data: Data | null = null;
const subscribers = new Set<() => void>();
/** True only when initRegistry read a REAL stored course list (not seeded defaults,
 *  not a blank read). Automatic writers must check this: persisting while the
 *  in-memory list is seed defaults would overwrite the user's real courses — the
 *  hazard initRegistry avoids for itself but cannot enforce on its callers. */
let hydratedFromStore = false;
export const registryHydratedFromStore = (): boolean => hydratedFromStore;

/** Build the default course list from the static catalog (colors + abbreviations as seed parse words). */
function seedDefaults(): CourseConfig[] {
  return Object.keys(COURSE_COLORS).map((name) => {
    const parseWords = Object.entries(COURSE_ABBR)
      .filter(([, canon]) => canon === name)
      .map(([abbr]) => abbr);
    return {
      id: 'course_' + genId(),
      name,
      color: COURSE_COLORS[name] || DEFAULT_COURSE_COLOR,
      parseWords,
    };
  });
}

/** Load course config from the profile, seeding defaults the first time. */
export async function initRegistry(d: Data): Promise<void> {
  data = d;
  const stored = await d.getProfile<{ list: CourseConfig[] }>('courses');
  if (stored?.list?.length) {
    // Firebase Realtime Database silently drops empty arrays on write, so a course
    // saved with parseWords: [] reads back with parseWords undefined. Normalize here
    // — the single point where stored courses enter the app — so every consumer can
    // safely treat parseWords as an array.
    courses = stored.list.map((c) => ({ ...c, parseWords: Array.isArray(c.parseWords) ? c.parseWords : [] }));
    hydratedFromStore = true;
  } else {
    // No stored courses. Seed defaults IN MEMORY only — never write them to the
    // cloud here. An empty read can mean "brand-new user" OR "a read momentarily came
    // back blank"; persisting seeds in the second case would overwrite real courses.
    // They persist the first time the user saves real edits in Settings.
    courses = seedDefaults();
  }
}

async function persist(): Promise<void> {
  if (data) await data.setProfile('courses', { list: courses });
  subscribers.forEach((cb) => cb());
}

/** Subscribe to registry changes (the settings UI and task views re-render on change). */
export function onRegistryChange(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export function getCourses(): CourseConfig[] {
  return courses;
}

export function getCourseNames(): string[] {
  return courses.map((c) => c.name);
}

/** Color for a course name — user config first, static catalog as fallback. */
export function getCourseColor(name: string): string {
  if (!name) return DEFAULT_COURSE_COLOR;
  const hit = courses.find((c) => c.name.toLowerCase() === name.toLowerCase());
  return hit ? hit.color : staticColor(name);
}

/**
 * Strict course resolver for the inline course-edit field: returns a real course
 * ONLY when the input is an explicit identifier — an exact course name (ci) or a
 * registry parse word (Layer-1a engine). Returns '' for anything else, so the
 * field falls back to "+ course" (mirrors invalid-due-date behavior). It does NOT
 * consult the learned/frequency model — teacher-name-style associations are for
 * iCal auto-classification only, never for validating a typed course.
 */
export function matchCourseStrict(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();
  const byName = courses.find((c) => c.name.toLowerCase() === lower);
  if (byName) return byName.name;
  return matchByParseWords(raw); // explicit parse words only; '' if none match
}

/**
 * Layer 1: deterministic course match by parse word.
 * Scans the given text (title + description) for any course's parse words.
 * Longer words win (more specific), so "graphic organizer" beats "organizer".
 * Returns the course name, or '' if nothing matched.
 */
export function matchByParseWords(text: string): string {
  const hay = ' ' + text.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ') + ' ';
  const norm = (s: string) => s.toLowerCase().replace(/[^a-z0-9\s]/g, ' ').replace(/\s+/g, ' ').trim();
  let best = '';
  let bestLen = 0;
  for (const c of courses) {
    // The course NAME is an implicit parse word (so it matches here just like it
    // already does in the quick-add parser), alongside its explicit parse words.
    const words = [norm(c.name), ...c.parseWords.map(norm)];
    for (const word of words) {
      if (!word) continue;
      if (hay.includes(' ' + word + ' ') && word.length > bestLen) {
        best = c.name;
        bestLen = word.length;
      }
    }
  }
  return best;
}

/** Does this phrase name a course outright (ci) or is it one of its parse words? */
function matchPhraseToCourse(phrase: string): string {
  // An exact course name is the most authoritative identifier.
  for (const c of courses) {
    if (c.name.toLowerCase() === phrase) return c.name;
  }
  // Otherwise any registry parse word the user (or the seed) mapped to a course.
  for (const c of courses) {
    if (c.parseWords.some((w) => w.toLowerCase().trim() === phrase)) return c.name;
  }
  return '';
}

/**
 * Token-aware course extraction for the natural-language parsers (quick-add +
 * focus free-text). Scans `tokens` for a course identifier — an exact course name
 * or a registry parse word — preferring the LONGEST (most specific) phrase, so a
 * two-word parse word ("graphic organizer") beats a contained single word. On a
 * hit it REMOVES the matched token(s) from the array in place and returns the
 * course name; '' if nothing matches.
 *
 * This is the bridge that keeps typed tasks in lock-step with the user's course
 * settings: whatever parse words they configure here are recognized and stripped
 * out of the title, instead of the parser only knowing the static seed catalog.
 */
export function extractCourseTokens(tokens: string[]): string {
  if (!courses.length) return '';
  const maxSize = Math.min(4, tokens.length);
  for (let size = maxSize; size >= 1; size--) {
    for (let i = 0; i + size <= tokens.length; i++) {
      const phrase = tokens.slice(i, i + size).join(' ').toLowerCase();
      const course = matchPhraseToCourse(phrase);
      if (course) {
        tokens.splice(i, size);
        return course;
      }
    }
  }
  return '';
}

/** Returns the name of a different course already using `word`, or '' if free. */
export function parseWordConflict(word: string, exceptId: string): string {
  const w = word.toLowerCase().trim();
  for (const c of courses) {
    if (c.id === exceptId) continue;
    if (c.parseWords.some((p) => p.toLowerCase().trim() === w)) return c.name;
  }
  return '';
}

// --- mutations (all persist + notify) -------------------------------------

/** Replace the entire course list at once (used when Settings commits a staged draft). */
export async function replaceCourses(list: CourseConfig[]): Promise<void> {
  const prev = courses;
  courses = list;
  await persist();
  // A course is identified by its stable id, but a task stores its course by NAME.
  // So without this, a rename would orphan every task under the old name (wrong
  // color, wrong group) and a delete would leave a dangling course chip. Carry both
  // through to the tasks so course config and tasks stay in constant accordance.
  // (Color changes need no migration — task chips look the color up live and the
  // Tasks view re-renders on onRegistryChange.)
  await migrateCourseChanges(prev, list);
}

/** After a course list swap: rename `task.course` for renamed courses (same id, new
 *  name) and clear it for deleted courses (id gone → task shows "+ course" again).
 *  Focus session todos follow via onTasksUpdate. */
async function migrateCourseChanges(prev: CourseConfig[], next: CourseConfig[]): Promise<void> {
  if (!data) return;
  const prevById = new Map(prev.map((c) => [c.id, c]));
  const nextIds = new Set(next.map((c) => c.id));

  const renames = new Map<string, string>(); // oldName (lowercased) -> newName
  for (const c of next) {
    const old = prevById.get(c.id);
    if (old && old.name && c.name && old.name !== c.name) {
      renames.set(old.name.toLowerCase(), c.name);
    }
  }
  const deleted = new Set<string>(); // deletedName (lowercased)
  for (const c of prev) {
    if (!nextIds.has(c.id) && c.name) deleted.add(c.name.toLowerCase());
  }
  if (!renames.size && !deleted.size) return;

  const tasks = await data.getTasksAll();
  const changed: Task[] = [];
  for (const t of Object.values(tasks)) {
    const key = (t.course || '').toLowerCase();
    if (!key) continue;
    const newName = renames.get(key);
    if (newName) {
      if (t.course !== newName) changed.push({ ...t, course: newName });
    } else if (deleted.has(key)) {
      changed.push({ ...t, course: '' }); // course gone → back to "+ course"
    }
  }
  if (changed.length) await data.putTasksBulk(changed);
}

export async function addCourse(name: string, color: string): Promise<CourseConfig> {
  const c: CourseConfig = { id: 'course_' + genId(), name: name.trim(), color, parseWords: [] };
  courses = [...courses, c];
  await persist();
  return c;
}

export async function updateCourse(id: string, patch: Partial<Omit<CourseConfig, 'id'>>): Promise<void> {
  courses = courses.map((c) => (c.id === id ? { ...c, ...patch } : c));
  await persist();
}

export async function removeCourse(id: string): Promise<void> {
  courses = courses.filter((c) => c.id !== id);
  await persist();
}

/** Add a parse word to a course. Returns the conflicting course name if blocked (no-op then). */
export async function addParseWord(id: string, word: string): Promise<string> {
  const w = word.toLowerCase().trim();
  if (!w) return '';
  const conflict = parseWordConflict(w, id);
  if (conflict) return conflict; // blocked — caller shows the error
  courses = courses.map((c) =>
    c.id === id && !c.parseWords.includes(w) ? { ...c, parseWords: [...c.parseWords, w] } : c
  );
  await persist();
  return '';
}

export async function removeParseWord(id: string, word: string): Promise<void> {
  courses = courses.map((c) =>
    c.id === id ? { ...c, parseWords: c.parseWords.filter((p) => p !== word) } : c
  );
  await persist();
}
