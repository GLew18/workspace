// The sample gradebook the landing's "See it in action" Grades card shows (loaded
// only there). Course names match the landing sandbox's courses.

import { addDays, todayStr } from '../util/dates';
import type { GAssign, GCourse, GradesPayload } from './calc';

let n = 0;
const A = (cat: string, title: string, daysAgo: number, earned: number | null, max: number, exc = 0): GAssign => {
  const due = addDays(todayStr(), -daysAgo);
  return { id: 'a' + ++n, title, cat, earned, max, exc, ts: Math.floor(new Date(due + 'T12:00:00').getTime() / 1000), due };
};

const SCALE = {
  levels: [
    { cutoff: 97, title: 'A+' }, { cutoff: 93, title: 'A' }, { cutoff: 90, title: 'A-' }, { cutoff: 87, title: 'B+' },
    { cutoff: 83, title: 'B' }, { cutoff: 80, title: 'B-' }, { cutoff: 77, title: 'C+' }, { cutoff: 73, title: 'C' },
    { cutoff: 70, title: 'C-' }, { cutoff: 60, title: 'D' }, { cutoff: 0, title: 'F' },
  ],
};

export function sampleGrades(): GradesPayload {
  const cats = (ids: [string, string, number][]) => ids.map(([id, title, weight]) => ({ id, title, weight }));
  const algebra: GCourse = {
    id: '1',
    name: 'Math',
    scale: SCALE,
    categories: cats([['1', 'Engagement', 10], ['2', 'Homework', 20], ['3', 'Quizzes', 30], ['4', 'Tests', 40]]),
    periods: [
      {
        id: 'q1',
        title: 'Quarter 1',
        final: 84.4,
        catPct: {},
        assignments: [
          A('1', 'Class participation', 50, 10, 10),
          A('2', 'HW 1.1', 48, 10, 10),
          A('2', 'HW 1.2', 44, 9, 10),
          A('3', 'Quiz: Functions', 41, 24, 30),
          A('4', 'Unit 1 Test', 38, 88, 100),
          A('2', 'HW 2.1', 33, 10, 10),
          A('2', 'HW 2.2', 30, 0, 10, 3),
          A('3', 'Quiz: Quadratics', 27, 27, 30),
          A('1', 'Class participation', 22, 9, 10),
          A('4', 'Unit 2 Test', 18, 79, 100),
          A('3', 'Quiz: Logs', 9, 29, 30),
          A('2', 'HW 3.1', 5, 8, 10),
        ],
      },
    ],
  };
  const bio: GCourse = {
    id: '2',
    name: 'Science',
    // A school whose levels are not letters: Cobalt shows percentages only.
    scale: { levels: [{ cutoff: 95, title: 'PC' }, { cutoff: 85, title: 'P' }, { cutoff: 0, title: 'L' }] },
    categories: cats([['1', 'Labs', 25], ['2', 'Quizzes', 25], ['3', 'Tests', 50]]),
    periods: [
      {
        id: 'q1',
        title: 'Quarter 1',
        final: 74.6,
        catPct: {},
        assignments: [
          A('1', 'Lab: Enzymes', 45, 22, 25),
          A('2', 'Quiz: Cells', 40, 16, 20),
          A('3', 'Unit 1 Test', 34, 74, 100),
          A('1', 'Lab: Osmosis', 28, 18, 25),
          A('2', 'Quiz: Membranes', 20, 18, 20),
          A('3', 'Unit 2 Test', 12, 86, 100),
          A('1', 'Lab: Respiration', 6, null, 25, 3),
        ],
      },
    ],
  };
  const hist: GCourse = {
    id: '3',
    name: 'Social Studies',
    scale: SCALE,
    categories: cats([['1', 'Homework', 30], ['2', 'Essays', 30], ['3', 'Tests', 40]]),
    periods: [
      {
        id: 's1',
        title: 'Semester 1',
        final: 96.6,
        catPct: {},
        assignments: [
          A('1', 'Reading notes 1', 40, 10, 10),
          A('2', 'DBQ Essay', 32, 47, 50),
          A('3', 'Unit 1 Test', 25, 95, 100),
          A('1', 'Reading notes 2', 15, 10, 10),
          A('3', 'Unit 2 Test', 4, 97, 100),
        ],
      },
    ],
  };
  const eng: GCourse = {
    id: '4',
    name: 'English',
    categories: [],
    periods: [
      {
        id: 's1',
        title: 'Semester 1',
        final: null,
        catPct: {},
        assignments: [A('', 'Reading response', 14, 18, 20), A('', 'Close read', 7, 36, 50), A('', 'Vocab quiz', 2, 9, 10)],
      },
    ],
  };
  return { host: 'app.schoology.com', courses: [algebra, bio, hist, eng], fetchedAt: Date.now() };
}
