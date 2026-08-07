// WorkSpace — landing-page sandbox.
//
// The landing showcases the REAL app views (Tasks, Bookmarks, Dashboard) running
// live, so a visitor can click, edit, check off, add — everything a signed-in user
// can — without an account. The trick: mount those views against a throwaway
// in-memory Data. Nothing here ever touches Firebase or localStorage, so every
// visitor gets the same pristine sample and their edits vanish on reload.

import type { Backend, Collection, Unsubscribe } from '../backend';
import { Data } from '../db';
import type { CourseConfig, Task } from '../types';
import { initRegistry } from '../courses/registry';
import { initLearn } from '../courses/learn';
import { todayStr, addDays, dateFromISO, scheduleMonday } from '../util/dates';

// #region In-memory backend (mirrors LocalBackend's contract, minus persistence)
class MemoryBackend implements Backend {
  readonly uid = '__sample__';
  private cache: Record<Collection, Record<string, unknown>>;
  private listeners: Partial<Record<Collection, Set<(v: Record<string, unknown>) => void>>> = {};

  constructor(seed: Partial<Record<Collection, Record<string, unknown>>> = {}) {
    this.cache = structuredSeed(seed);
  }

  subscribe<T>(c: Collection, cb: (value: Record<string, T>) => void): Unsubscribe {
    (this.listeners[c] ??= new Set()).add(cb as (v: Record<string, unknown>) => void);
    cb({ ...this.cache[c] } as Record<string, T>); // fire immediately, like the real backends
    return () => this.listeners[c]?.delete(cb as (v: Record<string, unknown>) => void);
  }
  async set<T>(c: Collection, id: string, value: T): Promise<void> {
    this.cache[c][id] = value;
    this.listeners[c]?.forEach((cb) => cb({ ...this.cache[c] }));
  }
  async remove(c: Collection, id: string): Promise<void> {
    delete this.cache[c][id];
    this.listeners[c]?.forEach((cb) => cb({ ...this.cache[c] }));
  }
  async getAll<T>(c: Collection): Promise<Record<string, T>> {
    return { ...this.cache[c] } as Record<string, T>;
  }
}

/** Fill in any collections the seed omitted so the cache always has all four. */
function structuredSeed(
  seed: Partial<Record<Collection, Record<string, unknown>>>
): Record<Collection, Record<string, unknown>> {
  return {
    tasks: seed.tasks ?? {},
    focus: seed.focus ?? {},
    profile: seed.profile ?? {},
    meta: seed.meta ?? {},
  };
}
// #endregion

// #region Sample content ---------------------------------------------------------
// Colors match the real Heschel catalog (courses/maps.ts COURSE_COLORS) so the sample
// looks exactly like the signed-in app. The color is the course-chip color; parse
// words let typed quick-adds ("email coach") auto-tag.
const SAMPLE_COURSES: CourseConfig[] = [
  { id: 'course_ela', name: 'English', color: '#e091a8', parseWords: ['ela', 'english', 'annotate'] },
  { id: 'course_ivrit', name: 'Ivrit', color: '#70c0e0', parseWords: ['ivrit', 'hebrew'] },
  { id: 'course_math', name: 'Math', color: '#f0c040', parseWords: ['math', 'geometry', 'algebra', 'problem set'] },
  { id: 'course_sci', name: 'Science', color: '#9b7ec8', parseWords: ['science', 'bio', 'lab', 'photosynthesis'] },
  { id: 'course_hist', name: 'Social Studies', color: '#e05050', parseWords: ['social studies', 'history', 'dbq', 'essay'] },
  { id: 'course_bball', name: 'Basketball', color: '#e07b3a', parseWords: ['basketball', 'coach', 'practice'] },
];

/** Build the sample task list fresh each call, dated relative to today so it always
 *  reads as "live" (Today / Tomorrow groups, TOD / TOM badges). */
function sampleTasks(): Record<string, Task> {
  const today = todayStr();
  const tomorrow = addDays(today, 1);
  const base = {
    source: 'manual' as const,
    completed: false,
    completedAt: null,
    addedAt: new Date().toISOString(),
    dueTime: '',
    timeLabel: '',
    // Mark translation already resolved so the live view never fires a network
    // translate pass for the sample (the Hebrew task ships with its translation).
    translationChecked: true,
  };
  // The three class tasks look Schoology-imported: a description (the ⓘ button) and
  // a Schoology link (the ↗ button, inert in the preview). Basketball stays a plain
  // manual task (no description, no link).
  const SCH = 'https://heschel.schoology.com';
  const list: Task[] = [
    {
      ...base,
      id: 'sample_ela',
      title: 'Read Ch. 7 & annotate',
      course: 'English',
      dueDate: today,
      dueTime: '23:59', // Schoology's classic end-of-day due time → "11:59pm"
      priority: 'high',
      source: 'schoology-ical',
      schoologyUrl: SCH,
      details:
        'Read Chapter 7 (pp. 142–168) and annotate for tone, imagery, and the narrator’s shifting reliability. Mark at least three passages you can speak to in Thursday’s discussion. Annotations will be collected. The reading: https://drive.google.com',
      notes: [{ id: 'n_ela1', title: 'The reading (PDF)', url: 'https://drive.google.com' }],
    },
    {
      ...base,
      id: 'sample_ivrit',
      title: 'השלם את עמוד 16',
      course: 'Ivrit',
      dueDate: tomorrow,
      dueTime: '08:00', // due at the start of class → "8am"
      priority: 'low',
      source: 'schoology-ical',
      schoologyUrl: SCH,
      details:
        'Complete page 16 in the workbook: the vocabulary matching and the two short-answer prompts. Review the new binyanim before Wednesday’s quiz.',
      notes: [],
      translatedTitle: 'Complete page 16',
      translatedLang: 'iw',
    },
    {
      // A calendar-event assessment: shows off auto-detected tests (TEST badge).
      // Same date as the Ivrit task so it joins the Tomorrow group — no third
      // date heading, and the frame stays scrollbar-free.
      ...base,
      id: 'sample_test',
      title: 'Unit 5 Test',
      course: 'Math',
      dueDate: tomorrow,
      dueTime: '10:15',
      priority: 'normal',
      source: 'schoology-ical',
      schoologyUrl: SCH,
      details:
        'Unit 5 test on triangle congruence. Covers sections 5.1–5.4. Review the practice set and the proofs from class.',
      notes: [],
    },
    {
      ...base,
      id: 'sample_bball',
      title: 'tell coach about being late',
      course: 'Basketball',
      dueDate: '',
      priority: 'normal',
      notes: [],
    },
  ];
  const map: Record<string, Task> = {};
  for (const t of list) map[t.id] = t;
  return map;
}

/** A single "Schedule - Week of …" post for the TARGET week — the same Monday
 *  rule the dashboard displays by (Mon–Fri: this week's Monday; Sat/Sun: the
 *  upcoming Monday), so the landing's schedule card is NEVER empty. Title format
 *  M.D.YY matches the real Schoology weekly-schedule posts. */
function sampleSchedule() {
  const monday = scheduleMonday();
  const mon = dateFromISO(monday);
  const wk = `${mon.getMonth() + 1}.${mon.getDate()}.${String(mon.getFullYear()).slice(-2)}`;
  return {
    list: [{ id: 's1', title: `Schedule - Week of ${wk}`, date: monday, url: 'https://heschel.schoology.com' }],
  };
}

/** Link cards for the Bookmarks preview — eight of them, rendered two-per-row
 *  inside the frame (see landing.css .bm-grid override) so the panel fills its
 *  height the way the real multi-column tab does. Three share a "School" group to
 *  show off grouping (colored accent + named chip); the rest stay ungrouped so
 *  the "+ Group" affordance is visible too. The "+ Shortcut" chip is hidden in
 *  the frame (landing.css) — that's what keeps rows short enough for 4 rows. */
function sampleBookmarks() {
  return {
    list: [
      { id: 'bm1', name: 'AoPS', url: 'https://artofproblemsolving.com', groupId: 'grp_test-study' },
      { id: 'bm2', name: 'Schoology', url: 'https://heschel.schoology.com' },
      { id: 'bm3', name: 'Google Drive', url: 'https://drive.google.com', },
      { id: 'bm4', name: 'Google Docs', url: 'https://docs.google.com' },
      { id: 'bm5', name: 'Gmail', url: 'https://gmail.com' },
      { id: 'bm6', name: 'Wikipedia', url: 'https://wikipedia.org' },
      { id: 'bm7', name: 'Quizlet', url: 'https://quizlet.com', groupId: 'grp_test-study' },
      { id: 'bm8', name: 'Desmos', url: 'https://desmos.com/calculator' },
    ],
    groups: [{ id: 'grp_test-study', name: 'Test Study', color: '#ff00dd' }],
  };
}
// #endregion

/**
 * Create the shared sandbox Data for the landing previews, seed it, and prime the
 * course registry + learned model so the live views render exactly like the app.
 * All previews share ONE sandbox, so an edit in the Tasks demo even flows to the
 * Dashboard demo — real, connected behavior.
 */
export async function createSandbox(): Promise<Data> {
  const backend = new MemoryBackend({
    tasks: sampleTasks(),
    profile: {
      courses: { list: SAMPLE_COURSES },
      schedule: sampleSchedule(),
      bookmarks: sampleBookmarks(),
      account: { displayName: 'Gabe', onboarded: true },
    },
  });
  const data = Data.createWithBackend(backend);
  await initRegistry(data); // loads SAMPLE_COURSES (colors + parse words) from the seed
  try {
    await initLearn(data); // learned course model — empty sample is fine
  } catch {
    /* non-fatal: the sample still works without the learned model */
  }
  return data;
}
