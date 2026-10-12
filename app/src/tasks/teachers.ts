// Cobalt: who teaches each course, and the "Email teacher" draft (Gabe, 10/8/26).
//
// A task belongs to a course and a course has teachers, so a task can reach its
// teacher without anyone typing an address. The names and emails come from
// the Schoology connection (sgyFetch), arrive in the same payload as the course
// labels, and are
// stored at profile/courseTeachers as { list: [{ course, name, email }] }. A list
// rather than a map keyed by course because course names can contain "/" ("Honors
// Algebra 2/Trig") and the database rejects that in a key.

import type { Data } from '../db';
import type { Task } from '../types';
import type { SgyTeacher, SgyCourse } from '../schoology/extension';

const KEY = 'courseTeachers';

let cache: SgyTeacher[] = [];

// Each course's Schoology section id and the school's host, so a course can link
// straight to its page on Schoology (profile/courseSections).
const SECTIONS_KEY = 'courseSections';
let sections: SgyCourse[] = [];
let sectionHost = '';

export async function loadTeachers(data: Data): Promise<void> {
  const v = await data.getProfile<{ list?: SgyTeacher[] }>(KEY);
  cache = Array.isArray(v?.list) ? v.list : [];
  const s = await data.getProfile<{ host?: string; list?: SgyCourse[] }>(SECTIONS_KEY);
  sections = Array.isArray(s?.list) ? s.list : [];
  sectionHost = s?.host ?? '';
}

export async function saveSections(data: Data, host: string, list: SgyCourse[]): Promise<void> {
  sections = list;
  sectionHost = host;
  await data.setProfile(SECTIONS_KEY, { host, list });
}

/** The course's own page on Schoology, or null when it was never seen there. */
export function schoologyCourseUrl(course: string): string | null {
  const c = course.trim().toLowerCase();
  const hit = c ? sections.find((x) => x.name.trim().toLowerCase() === c) : undefined;
  return hit && sectionHost ? `https://${sectionHost}/course/${hit.id}` : null;
}

export async function saveTeachers(data: Data, list: SgyTeacher[]): Promise<void> {
  cache = list;
  await data.setProfile(KEY, { list });
}

/** The teachers of a course, by exact (case-insensitive) name. */
export function teachersOf(course: string): SgyTeacher[] {
  const c = course.trim().toLowerCase();
  return c ? cache.filter((t) => t.course.trim().toLowerCase() === c) : [];
}

/**
 * The Gmail compose address for a task: the course's teachers in To, the
 * assignment's title as the subject, an empty body (Gabe, 10/8: no salutation).
 * Gmail's own compose URL, because it works with nothing installed; the To field
 * is the one thing a student cannot see before the window opens, so a wrong
 * address is the one real risk, which is why the list is exactly Schoology's own.
 * Null when the task has no course or the course has no known teacher.
 */
export function emailTeacherUrl(task: Task): string | null {
  return emailTeacherUrlFor(task.course, task.title);
}

/** The same draft for any course and subject (the Grades tab's assignment rows). */
export function emailTeacherUrlFor(course: string, subject: string): string | null {
  const ts = teachersOf(course);
  if (!ts.length) return null;
  const q = new URLSearchParams({
    view: 'cm',
    fs: '1',
    to: ts.map((t) => t.email).join(','),
    su: subject,
  });
  return `https://mail.google.com/mail/?${q.toString()}`;
}
