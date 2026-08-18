// Cobalt: the hero demo's world — "Dan", the student the ghost-cursor animation
// follows (vault note "Cobalt Landing Animation Demo Flow").
//
// Everything here is REAL app data driving REAL views; the seed's only job is to
// stage the exact state each scene needs. Dates are computed from the visitor's
// actual today on every build, so the demo never goes stale, and every loop of
// the animation rebuilds this world from scratch (fresh Data, fresh registry).
//
// Course rule: this list is a SUPERSET of the try-it sample's SAMPLE_COURSES
// (same names + colors) because the course registry is a page-wide singleton —
// whichever sandbox seeds it last wins, and superset means the winner renders
// every frame identically. Math's parse words are exactly ['math', 'problem set',
// 'ma'] (Gabe, 8/15): no 'algebra', which would splice the word "algebra" out of
// the title Dan types in scene 4, and no 'geometry'.

import type { CourseConfig, Task } from '../../types';
import type { Data } from '../../db';
import { createSandboxData, sampleSchedule } from '../sandbox';
import { todayStr, addDays } from '../../util/dates';

const DEMO_COURSES: CourseConfig[] = [
  { id: 'course_ela', name: 'English', color: '#e091a8', parseWords: ['ela', 'english', 'annotate'] },
  { id: 'course_ivrit', name: 'Ivrit', color: '#70c0e0', parseWords: ['ivrit', 'hebrew'] },
  { id: 'course_math', name: 'Math', color: '#f0c040', parseWords: ['math', 'problem set', 'ma'] },
  { id: 'course_sci', name: 'Science', color: '#9b7ec8', parseWords: ['science', 'bio', 'lab', 'photosynthesis'] },
  { id: 'course_hist', name: 'Social Studies', color: '#e05050', parseWords: ['social studies', 'history', 'dbq'] },
  { id: 'course_bball', name: 'Basketball', color: '#e07b3a', parseWords: ['basketball', 'coach', 'practice'] },
  // Dan's "get cobalt premium" task lives here until he builds the `cobalt`
  // course live in scene 5. Color = the app's real default-course gray.
  { id: 'course_misc', name: 'Miscellaneous', color: '#9ca3af', parseWords: ['misc'] },
];

/** Dan's task list. Variety is the brief (the vault note calls it out): mixed
 *  courses, days, priorities, sources — plus the specific fixtures each scene
 *  needs, flagged inline. */
function danTasks(): Record<string, Task> {
  const today = todayStr();
  const base = {
    source: 'manual' as const,
    completed: false,
    completedAt: null,
    addedAt: new Date().toISOString(),
    dueTime: '',
    timeLabel: '',
    // Every seeded task ships translation-resolved so the live TasksView never
    // fires a network translate pass for the seed itself. (Tasks Dan TYPES
    // during the demo do get the real pass — that is the feature, working.)
    translationChecked: true,
  };
  const SCH = 'https://heschel.schoology.com';
  const imported = { source: 'schoology-ical' as const, schoologyUrl: SCH };

  const list: Task[] = [
    // --- Scene 2: the two due-today rows Dan bulk-checks off ---------------
    {
      ...base,
      ...imported,
      id: 'dan_read',
      title: 'Read chapter 12 & annotate',
      course: 'English',
      dueDate: today,
      // 8am, not another 11:59pm (Gabe, 8/17): imported due times vary.
      dueTime: '08:00',
      priority: 'normal',
      details: 'Read chapter 12 and annotate for character motivation. Annotations collected in class.',
      notes: [],
    },
    {
      ...base,
      ...imported,
      id: 'dan_lab',
      title: 'Finish lab write-up',
      course: 'Science',
      dueDate: today,
      dueTime: '15:00',
      priority: 'normal',
      details: 'Write up the pendulum lab: hypothesis, data table, and one paragraph on sources of error.',
      notes: [],
    },
    // --- Variety: the translated Hebrew row (translation shown, real data) --
    {
      ...base,
      ...imported,
      id: 'dan_ivrit',
      title: 'לקרוא פרק ה׳ ולענות על השאלות',
      course: 'Ivrit',
      // Due TODAY at 08:00: it sorts above the two Dan checks off (time asc),
      // shares their section header (fewer sections = the list fits the frame),
      // and stays on screen translated for the whole loop.
      dueDate: today,
      dueTime: '08:00',
      priority: 'normal',
      details: 'Read chapter 5 and answer the comprehension questions at the end.',
      notes: [],
      translatedTitle: 'Read chapter 5 and answer the questions',
      translatedLang: 'iw',
    },
    // --- Scene 3: the History-project chain, a clear multi-day progression.
    // Trimmed twice on 8/16 (Gabe: "WAY too many tasks; they should chiefly
    // fit in one view") — the whole seed is now 7 tasks. -----------------------
    {
      ...base,
      ...imported,
      id: 'dan_hp2',
      title: 'Research your assigned figure',
      course: 'Social Studies',
      // Shares the essay's day ON PURPOSE: one section holds both, and the
      // scene-3 range select still sweeps the essay (title sort puts it between
      // hp1's section and this row).
      dueDate: addDays(today, 3),
      dueTime: '23:59',
      // NORMAL, like every import (Gabe, 8/17): priority variance in the demo
      // comes ONLY from Dan's own edits.
      priority: 'normal',
      details: 'Gather at least five sources on your figure. Primary sources count double.',
      notes: [],
    },
    // --- Scene 6: the ELA essay whose description ends in the rubric link and
    // whose attachments already hold "Rubric" (exactly what the app's own
    // Schoology-import link extraction produces — seeded, not faked) ----------
    {
      ...base,
      ...imported,
      id: 'dan_essay',
      title: 'Finish Animal Farm essay',
      course: 'English',
      dueDate: addDays(today, 3),
      dueTime: '23:59',
      priority: 'normal', // imports arrive normal; Dan is the only priority-setter
      details:
        'Final draft of the Animal Farm essay: five paragraphs, two direct quotes per body paragraph, MLA citations. Before you submit, make sure you compare your work to the rubric: https://docs.google.com/document/d/1r-cobalt-demo-rubric/view',
      notes: [{ id: 'n_rubric', title: 'Rubric', url: 'https://docs.google.com/document/d/1r-cobalt-demo-rubric/view' }],
    },
    // --- Scene 5: Dan's own task — NO due date yet (he sets it to today), NO
    // Schoology buttons (manual source: no ↗, no ⓘ), course Miscellaneous
    // until he builds the `cobalt` course live -------------------------------
    {
      ...base,
      id: 'dan_prem',
      title: 'get cobalt premium',
      course: 'Miscellaneous',
      dueDate: '',
      priority: 'normal',
      notes: [],
    },
  ];

  const map: Record<string, Task> = {};
  for (const t of list) map[t.id] = t;
  return map;
}

/** Dan's bookmarks BEFORE scene 8: no Desmos, no GeoGebra, no Math group —
 *  he adds all three on camera. */
function danBookmarks() {
  return {
    list: [
      { id: 'dbm1', name: 'Schoology', url: 'https://heschel.schoology.com' },
      { id: 'dbm2', name: 'Google Drive', url: 'https://drive.google.com' },
      { id: 'dbm3', name: 'Gmail', url: 'https://gmail.com' },
      { id: 'dbm4', name: 'Quizlet', url: 'https://quizlet.com' },
    ],
    groups: [],
  };
}

/** Count Dan uses for the briefing card + the sidebar Tasks badge. */
export function danDueTodayCount(): number {
  const today = todayStr();
  return Object.values(danTasks()).filter((t) => !t.completed && t.dueDate === today).length;
}

/** Dan's focus records: a heart or two already given, and the "whole bunch of
 *  custom playlists" the vault note wants him scrolling past. All track ids are
 *  REAL library ids (focus/library.ts); "Deep Work Mix" is the cross-genre one
 *  he switches to mid-session. Deliberately NO preset_* records: creating the
 *  1h45m preset is scene 9's beat. */
function danFocus(): Record<string, unknown> {
  return {
    favorites: { ids: ['classical-piano-02', 'romantic-piano-01'] },
    'playlist_mix': {
      id: 'mix',
      name: 'Deep Work Mix',
      emoji: '🌀',
      trackIds: ['romantic-piano-02', 'ambient-01', 'solo-bach-01', 'orchestral-02', 'impressionist-piano-01'],
    },
    'playlist_latenight': {
      id: 'latenight',
      name: 'Late Night',
      emoji: '🌙',
      trackIds: ['ambient-02', 'impressionist-piano-02', 'classical-piano-01'],
    },
    'playlist_cram': {
      id: 'cram',
      name: 'Test Cram',
      emoji: '📚',
      trackIds: ['baroque-01', 'solo-bach-02', 'baroque-02'],
    },
  };
}

/**
 * Build Dan's world: a fresh sandbox Data seeded for every scene. Called once
 * per animation loop — each restart gets pristine state (and re-priming the
 * registry resets the `cobalt` course Dan created last cycle).
 */
export function createDanData(): Promise<Data> {
  return createSandboxData({
    tasks: danTasks(),
    focus: danFocus(),
    profile: {
      courses: { list: DEMO_COURSES },
      bookmarks: danBookmarks(),
      schedule: sampleSchedule(), // same weekly-schedule post the try-it dashboard shows
      account: { displayName: 'Dan', onboarded: true },
    },
  });
}
