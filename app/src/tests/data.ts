// Cobalt: the school's test calendar, as the Tests tab sees it.
//
// THE SOURCE (Gabe, 10/5/26; plan: vault note "Cobalt Calendars Plan"). Heschel
// keeps one test calendar per grade ("09th Grade Test Calendar"). A relay (an Apps
// Script on a Heschel student's account, app/relay/) copies them to the server; the
// callable getSchoolTests hands them to a verified Heschel student. Events are
// all-day, one per subject per grade, with the grade in the title:
//
//   "G9 MATH Test"  "G9 LQ In-Class"  "G9 No HW Due"  "G9 HW Permitted!" (ignored)
//
// Subject codes: MATH, SCI, ENG, SS (social studies), WL (world language), HEB
// (Hebrew language), LQ (Limudei Kodesh = Rabbinics). In-class assessments are
// listed as tests (Gabe, 10/5).

import { scopedKey } from '../util/userScope';
import { getCourses } from '../courses/registry';
import type { CourseConfig } from '../types';
import type { ScheduleBlock } from '../schedule/feed';

export type TestKind = 'test' | 'inclass' | 'nohw';

export interface TestEvent {
  date: string; // 'YYYY-MM-DD'
  kind: TestKind;
  /** MATH, SCI, ENG, SS, WL, HEB or LQ. '' for a no-homework day. */
  subject: string;
  grade: number;
}

export interface SchoolTests {
  eligible: boolean;
  events: TestEvent[];
  /** When the relay last posted, epoch ms. 0 = never. */
  updatedAt: number;
}

export const SUBJECT_LABEL: Record<string, string> = {
  MATH: 'Math',
  SCI: 'Science',
  ENG: 'English',
  SS: 'Social Studies',
  WL: 'World Language',
  HEB: 'Hebrew Language',
  LQ: 'Rabbinics',
};

/** "G9 MATH Test" → an event, or null for anything that is not a test day. */
export function parseTestTitle(title: string, date: string): TestEvent | null {
  const m = /^G(\d{1,2})\s+(.+)$/i.exec(title.trim());
  if (!m) return null;
  const grade = Number(m[1]);
  const rest = m[2].trim();
  if (/^no\s*hw/i.test(rest)) return { date, kind: 'nohw', subject: '', grade };
  const s = /^([A-Z]{2,4})\s+(test|in-?class)/i.exec(rest);
  if (!s) return null; // "HW Permitted!" and anything unknown
  return { date, kind: /in-?class/i.test(s[2]) ? 'inclass' : 'test', subject: s[1].toUpperCase(), grade };
}

// #region Which grade is this student? -----------------------------------------

/** 9th grade is the class of (school-year end + 3). Heschel's school year ends in June. */
function gradeFromClassYear(classYear: number, now = new Date()): number {
  const endYear = now.getFullYear() + (now.getMonth() >= 7 ? 1 : 0);
  return 12 - (classYear - endYear);
}

/** From the schedule ("Advisory Class of 2030") or, failing that, the sign-in
 *  address (leo.tepper.2030@heschel.org). 0 when neither says. */
export function studentGrade(blocks: ScheduleBlock[] | null, email: string): number {
  for (const b of blocks ?? []) {
    const m = /class of (\d{4})/i.exec(`${b.name} ${b.detail}`);
    if (m) return gradeFromClassYear(Number(m[1]));
  }
  const m = /\.(20\d\d)@/.exec(email);
  return m ? gradeFromClassYear(Number(m[1])) : 0;
}

// #endregion

// #region Subject → the student's course ---------------------------------------

const SUBJECT_COURSE_RE: Record<string, RegExp> = {
  MATH: /algebra|geometry|calculus|trig|\bmath|statistics|precalc/i,
  SCI: /biolog|chemi|physics|science|environmental/i,
  ENG: /english|literature|composition|writing/i,
  SS: /history|social|civics|government|econom/i,
  HEB: /hebrew/i,
  WL: /spanish|french|latin|arabic|italian|mandarin|chinese|german/i,
  LQ: /bible|tanakh|tanach|talmud|gemara|mishna|rabbinic|halacha|jewish|chumash|navi|limudei|torah/i,
};

/** The student's course a subject code means, or null when none matches (the tab
 *  then shows the subject's own name in a neutral color). */
export function courseForSubject(subject: string, courses: CourseConfig[] = getCourses()): CourseConfig | null {
  const re = SUBJECT_COURSE_RE[subject];
  if (!re) return null;
  // Hebrew language must not be claimed by World Language, nor Rabbinics by Hebrew.
  return courses.find((c) => re.test(c.name) && !(subject === 'WL' && /hebrew/i.test(c.name))) ?? null;
}

// #endregion

// #region Load -----------------------------------------------------------------

const CACHE_KEY = () => scopedKey('tests:v1');
const REFRESH_MS = 60 * 60 * 1000;

interface Cache {
  fetchedAt: number;
  tests: SchoolTests;
}

function readCache(): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY()) || 'null') as Cache | null;
    return c && c.tests && Array.isArray(c.tests.events) ? c : null;
  } catch {
    return null;
  }
}

/** Every grade's events, from the server (cached an hour per account). Never
 *  throws: a failed fetch falls back to the cache, or to null. */
export async function loadSchoolTests(force = false): Promise<SchoolTests | null> {
  const c = readCache();
  if (c && !force && Date.now() - c.fetchedAt < REFRESH_MS) return c.tests;
  try {
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const { getFunctions, httpsCallable } = await import('firebase/functions');
    const { firebaseConfig } = await import('../firebase');
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
    const fn = httpsCallable(getFunctions(app, 'us-central1'), 'getSchoolTests');
    const r = (await fn({})).data as { eligible: boolean; events: { date: string; title: string }[]; updatedAt: number };
    const events = r.events.map((e) => parseTestTitle(e.title, e.date)).filter((e): e is TestEvent => !!e);
    const tests: SchoolTests = { eligible: !!r.eligible, events, updatedAt: Number(r.updatedAt) || 0 };
    try {
      localStorage.setItem(CACHE_KEY(), JSON.stringify({ fetchedAt: Date.now(), tests } satisfies Cache));
    } catch {
      /* quota: refetched next time */
    }
    return tests;
  } catch {
    return c?.tests ?? null;
  }
}

// #endregion
