// Cobalt: Tests tab (Gabe, 10/8/26; plan: vault note "Cobalt Calendars Plan", section 4).
//
// An Upcoming list and a month calendar of the school's tests for the student's
// grade, in course colors, each with a countdown and the Schoology work due in the
// week before it. Students do nothing to get it: a verified Heschel account just
// receives its grade's tests (see data.ts). Everyone else sees an explanation.

import type { Data } from '../db';
import type { Task } from '../types';
import { el } from '../util/dom';
import { addDays, dateFromISO, dayDiff, formatDate, todayStr } from '../util/dates';
import { getCourseColor, onRegistryChange } from '../courses/registry';
import { getFeed, loadBlocks } from '../schedule/feed';
import {
  SUBJECT_LABEL,
  courseForSubject,
  loadSchoolTests,
  studentGrade,
  type SchoolTests,
  type TestEvent,
} from './data';

const NEUTRAL = 'var(--text-dim)';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];
const DOW = ['Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat', 'Sun'];

export class TestsView {
  private data: Data;
  private email: string;
  private panel: HTMLElement | null = null;
  private tests: SchoolTests | null = null;
  private grade = 0;
  private tasks: Task[] = [];
  /** First of the month shown in the calendar, 'YYYY-MM-01'. */
  private month = todayStr().slice(0, 8) + '01';
  private off: (() => void) | null = null;

  constructor(data: Data, email = '') {
    this.data = data;
    this.email = email;
  }

  mount(panel: HTMLElement): void {
    this.panel = panel;
    this.off?.();
    this.off = onRegistryChange(() => this.paint());
    panel.replaceChildren(el('div', { class: 'tests' }, [el('div', { class: 'tests-note', text: 'Loading…' })]));
    void this.load();
  }

  /** Re-fetch when the tab is shown again (the fetch is cached an hour). */
  onShow(): void {
    if (this.panel) void this.load();
  }

  private async load(force = false): Promise<void> {
    const feed = await getFeed(this.data).catch(() => null);
    const [tests, blocks, taskMap] = await Promise.all([
      loadSchoolTests(force),
      feed ? loadBlocks(feed.url).then((r) => r.blocks) : Promise.resolve(null),
      this.data.getTasksAll().catch(() => ({})),
    ]);
    this.tests = tests;
    this.grade = studentGrade(blocks, this.email);
    this.tasks = Object.values(taskMap as Record<string, Task>);
    this.paint();
  }

  // #region Paint ----------------------------------------------------------------

  private paint(): void {
    if (!this.panel) return;
    const root = el('div', { class: 'tests' });
    root.append(el('h2', { class: 'tests-title', text: 'Tests' }));

    const t = this.tests;
    if (!t) {
      root.append(this.note('Couldn’t load your tests. Check your connection and reopen this tab.'));
    } else if (!t.eligible) {
      root.append(
        this.note('Tests appear here automatically for Heschel students. Connect your Heschel schedule on the Dashboard and they will show up.')
      );
    } else if (!this.grade) {
      root.append(this.note('Connect your schedule on the Dashboard so Cobalt knows your grade.'));
    } else {
      const mine = t.events.filter((e) => e.grade === this.grade);
      if (!mine.length) {
        root.append(this.note('No tests are on the calendar yet.'));
      } else {
        root.append(this.upcoming(mine), this.calendar(mine));
        if (t.updatedAt) {
          const h = Math.max(0, Math.round((Date.now() - t.updatedAt) / 3_600_000));
          root.append(el('div', { class: 'tests-stamp', text: h < 1 ? 'Updated just now' : `Updated ${h} hour${h === 1 ? '' : 's'} ago` }));
        }
      }
    }
    this.panel.replaceChildren(root);
  }

  private note(text: string): HTMLElement {
    return el('div', { class: 'tests-note', text });
  }

  private name(e: TestEvent): string {
    return courseForSubject(e.subject)?.name ?? SUBJECT_LABEL[e.subject] ?? e.subject;
  }

  private color(e: TestEvent): string {
    const c = courseForSubject(e.subject);
    return c ? getCourseColor(c.name) : NEUTRAL;
  }

  private countdown(date: string): string {
    const n = dayDiff(todayStr(), date);
    if (n === 0) return 'Today';
    if (n === 1) return 'Tomorrow';
    return `In ${n} days`;
  }

  /** Schoology work for the same course due in the 7 days up to the test. */
  private workBefore(e: TestEvent): Task[] {
    const course = courseForSubject(e.subject)?.name;
    if (!course) return [];
    const from = addDays(e.date, -7);
    return this.tasks.filter((k) => !k.completed && k.course === course && k.dueDate >= from && k.dueDate <= e.date && k.dueDate >= todayStr()).slice(0, 3);
  }

  private upcoming(all: TestEvent[]): HTMLElement {
    const today = todayStr();
    const horizon = addDays(today, 60);
    const list = all.filter((e) => e.date >= today && e.date <= horizon);
    const sec = el('section', { class: 'tests-card' }, [el('h3', { class: 'tests-h', text: 'Upcoming' })]);
    const noHw = new Set(list.filter((e) => e.kind === 'nohw').map((e) => e.date));
    const rows = list.filter((e) => e.kind !== 'nohw');
    if (!rows.length) sec.append(this.note('Nothing in the next 60 days.'));
    for (const e of rows) {
      const d = dateFromISO(e.date);
      const work = this.workBefore(e);
      const row = el('div', { class: 'tests-row' }, [
        el('div', { class: 'tests-bar' }),
        el('div', { class: 'tests-when' }, [
          el('div', { class: 'tests-dow', text: d.toLocaleDateString(undefined, { weekday: 'short' }) }),
          el('div', { class: 'tests-day', text: String(d.getDate()) }),
        ]),
        el('div', { class: 'tests-what' }, [
          el('div', { class: 'tests-course', text: this.name(e) }),
          el('div', { class: 'tests-sub', text: [e.kind === 'inclass' ? 'In-class assessment' : 'Test', noHw.has(e.date) ? 'No homework due' : ''].filter(Boolean).join(' · ') }),
          ...work.map((k) => el('div', { class: 'tests-work', text: `Due ${k.dueDate.slice(5).replace('-', '/').replace(/^0/, '')}: ${k.title}` })),
        ]),
        el('div', { class: 'tests-count', text: this.countdown(e.date) }),
      ]);
      row.style.setProperty('--tc', this.color(e));
      sec.append(row);
    }
    return sec;
  }

  private calendar(all: TestEvent[]): HTMLElement {
    const first = dateFromISO(this.month);
    const sec = el('section', { class: 'tests-card' });
    const prev = el('button', { class: 'tests-nav', 'aria-label': 'Previous month', text: '‹' });
    const next = el('button', { class: 'tests-nav', 'aria-label': 'Next month', text: '›' });
    const shift = (n: number) => {
      const d = new Date(first.getFullYear(), first.getMonth() + n, 1, 12);
      this.month = formatDate(d);
      this.paint();
    };
    prev.addEventListener('click', () => shift(-1));
    next.addEventListener('click', () => shift(1));
    sec.append(
      el('div', { class: 'tests-calhead' }, [prev, el('h3', { class: 'tests-h', text: `${MONTHS[first.getMonth()]} ${first.getFullYear()}` }), next])
    );

    const grid = el('div', { class: 'tests-grid' });
    for (const d of DOW) grid.append(el('div', { class: 'tests-gdow', text: d }));
    const lead = (first.getDay() + 6) % 7; // Monday first
    for (let i = 0; i < lead; i++) grid.append(el('div', { class: 'tests-cell tests-cell-empty' }));
    const days = new Date(first.getFullYear(), first.getMonth() + 1, 0).getDate();
    const today = todayStr();
    for (let n = 1; n <= days; n++) {
      const ds = formatDate(new Date(first.getFullYear(), first.getMonth(), n, 12));
      const cell = el('div', { class: 'tests-cell' + (ds === today ? ' today' : '') }, [el('div', { class: 'tests-cn', text: String(n) })]);
      for (const e of all.filter((x) => x.date === ds)) {
        if (e.kind === 'nohw') {
          cell.classList.add('nohw');
          cell.title = 'No homework due';
          continue;
        }
        const chip = el('div', { class: 'tests-chip', text: this.name(e), title: this.name(e) });
        chip.style.setProperty('--tc', this.color(e));
        cell.append(chip);
      }
      grid.append(cell);
    }
    sec.append(grid);
    return sec;
  }

  // #endregion
}
