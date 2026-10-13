// Cobalt: the Tasks tab's Filter (Gabe, 10/11/26).
//
// Switch courses, priorities and folders off to see only what you want. It HIDES,
// it never deletes or completes anything, and the Tasks tab always says when
// something is hidden (the strip under the header) so a forgotten filter can never
// read as "my tasks disappeared". Stored as what is HIDDEN, so a course or folder
// added later shows up by default. Saved to the profile so it follows the student
// across devices.
//
// Only the Tasks tab filters. The dashboard cards, Focus and the due-today count
// keep showing everything.

import type { Data } from '../db';
import type { Task, TaskFolder } from '../types';
import { el } from '../util/dom';
import { getCourses } from '../courses/registry';
import { PRIORITIES } from './priorities';
import { openPopup } from '../ui/popup';
import { FILTER_WIDTH_KEY } from '../util/resize';
import { todayStr, addDays, addMonths } from '../util/dates';

/** Stands for "no course" / "no folder" in the hidden lists. */
const NONE = '__none';
const KEY = 'taskFilter';
/** More courses than this and the Filter card shows a button instead of the list. */
const MAX_INLINE_COURSES = 15;

interface Saved {
  courses?: string[];
  priorities?: string[];
  folders?: string[];
  dates?: string[];
}

/** Due-date groups, one task in exactly one (so no overlap): ticking a row shows that group. */
const DUE_BUCKETS: Array<{ key: string; label: string }> = [
  { key: 'overdue', label: 'Overdue' },
  { key: 'today', label: 'Due today' },
  { key: 'tomorrow', label: 'Due tomorrow' },
  { key: 'week', label: 'Due in the next week' },
  { key: 'month', label: 'Due in the next month' },
  { key: 'later', label: 'Due later' },
  { key: NONE, label: 'No due date' },
];

function dueBucket(due: string): string {
  if (!due) return NONE;
  const today = todayStr();
  if (due < today) return 'overdue';
  if (due === today) return 'today';
  if (due === addDays(today, 1)) return 'tomorrow';
  if (due <= addDays(today, 7)) return 'week';
  if (due <= addMonths(today, 1)) return 'month';
  return 'later';
}

const FUNNEL =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M3.5 5h17l-6.5 7.5V19l-4 1.5v-8z"/></svg>';

export class TaskFilter {
  private hiddenCourses = new Set<string>();
  private hiddenPriorities = new Set<string>();
  private hiddenFolders = new Set<string>();
  private hiddenDates = new Set<string>();
  private allBtn: HTMLButtonElement | null = null;
  private btn: HTMLButtonElement | null = null;
  private strip: HTMLElement | null = null;
  /** The open Filter popup's body, null when closed. */
  private body: HTMLElement | null = null;
  /** The second card listing every course (only when there are too many to inline). */
  private coursesBody: HTMLElement | null = null;
  private courseRows: (() => HTMLElement[]) | null = null;

  constructor(
    private data: Data,
    private folders: () => TaskFolder[],
    /** Tasks changed what is visible: repaint the list. */
    private onChange: () => void,
    /** The landing demo mounts popups inside its own frame. */
    private host?: HTMLElement
  ) {}

  async load(): Promise<void> {
    const s = await this.data.getProfile<Saved>(KEY).catch(() => undefined);
    if (!s || typeof s !== 'object') return;
    const arr = (v: unknown): string[] => (Array.isArray(v) ? v.filter((x): x is string => typeof x === 'string') : []);
    this.hiddenCourses = new Set(arr(s.courses));
    this.hiddenPriorities = new Set(arr(s.priorities));
    this.hiddenFolders = new Set(arr(s.folders));
    this.hiddenDates = new Set(arr(s.dates));
    this.sync();
    this.onChange();
  }

  private save(): void {
    void this.data
      .setProfile<Saved>(KEY, {
        courses: [...this.hiddenCourses],
        priorities: [...this.hiddenPriorities],
        folders: [...this.hiddenFolders],
        dates: [...this.hiddenDates],
      })
      .catch(() => {});
  }

  get active(): boolean {
    return this.hiddenCourses.size + this.hiddenPriorities.size + this.hiddenFolders.size + this.hiddenDates.size > 0;
  }

  /** Does this task pass the filter? */
  passes(t: Task): boolean {
    if (!this.active) return true;
    if (this.hiddenCourses.has(t.course ? t.course.toLowerCase() : NONE)) return false;
    if (this.hiddenPriorities.has(t.priority)) return false;
    if (this.hiddenDates.has(dueBucket(t.dueDate))) return false;
    const inFolder = t.folderId && this.folders().some((f) => f.id === t.folderId) ? t.folderId : NONE;
    if (this.hiddenFolders.has(inFolder)) return false;
    return true;
  }

  // #region UI --------------------------------------------------------------------

  /** The header button. Built once per mount. */
  button(): HTMLButtonElement {
    const b = el('button', { class: 'tasks-filter-btn', type: 'button', 'aria-haspopup': 'dialog' }) as HTMLButtonElement;
    b.innerHTML = FUNNEL;
    b.append(el('span', { text: 'Filter' }), el('span', { class: 'tasks-filter-n' }));
    b.addEventListener('click', () => this.open());
    this.btn = b;
    this.sync();
    return b;
  }

  /** The strip under the header that says what is hidden. */
  stripEl(): HTMLElement {
    this.strip = el('div', { class: 'tasks-filter-strip' });
    this.sync();
    return this.strip;
  }

  /** Redraw the button's count and the strip. */
  private sync(): void {
    const n = this.hiddenCourses.size + this.hiddenPriorities.size + this.hiddenFolders.size + this.hiddenDates.size;
    if (this.btn) {
      this.btn.classList.toggle('on', n > 0);
      (this.btn.querySelector('.tasks-filter-n') as HTMLElement).textContent = n ? String(n) : '';
    }
    if (!this.strip) return;
    this.strip.replaceChildren();
    this.strip.hidden = n === 0;
    if (!n) return;
    const names: string[] = [];
    for (const c of this.hiddenCourses) names.push(c === NONE ? 'no course' : getCourses().find((k) => k.name.toLowerCase() === c)?.name ?? c);
    for (const p of this.hiddenPriorities) names.push((PRIORITIES.find((d) => d.key === p)?.label ?? p) + ' priority');
    for (const d of this.hiddenDates) names.push(DUE_BUCKETS.find((b) => b.key === d)?.label.toLowerCase() ?? d);
    for (const f of this.hiddenFolders) names.push(f === NONE ? 'no folder' : 'folder ' + (this.folders().find((x) => x.id === f)?.name ?? ''));
    const text = names.length > 3 ? `${names.slice(0, 3).join(', ')} +${names.length - 3} more` : names.join(', ');
    const show = el('button', { class: 'tasks-filter-clear', type: 'button', text: 'Show all' });
    show.addEventListener('click', () => this.clear());
    this.strip.append(el('span', { class: 'tasks-filter-strip-t', text: 'Hiding ' + text }), show);
  }

  private clear(): void {
    this.hiddenCourses.clear();
    this.hiddenPriorities.clear();
    this.hiddenFolders.clear();
    this.hiddenDates.clear();
    this.save();
    this.sync();
    this.fill();
    this.fillCourses();
    this.onChange();
  }

  private toggle(set: Set<string>, key: string): void {
    if (!set.delete(key)) set.add(key);
    this.save();
    this.sync();
    this.fill();
    this.fillCourses();
    this.onChange();
  }

  private fillCourses(): void {
    const b = this.coursesBody;
    if (!b || !b.isConnected || !this.courseRows) return;
    const scroll = b.scrollTop;
    b.replaceChildren(el('div', { class: 'tf-group' }, this.courseRows()));
    b.scrollTop = scroll;
  }

  /** Second card: every course, for when the list is too long for the Filter card. */
  private openCourses(): void {
    openPopup(
      'Filter by course',
      (body, close) => {
        this.coursesBody = body;
        body.classList.add('tf-body', 'tf-courses-body');
        body.closest('.popup')?.classList.add('tf-popup', 'tf-courses-popup');
        this.fillCourses();
        const done = el('button', { class: 'tf-done', type: 'button', text: 'Done' });
        done.addEventListener('click', () => close());
        body.after(el('div', { class: 'tf-foot' }, [done]));
      },
      this.host,
      FILTER_WIDTH_KEY
    );
  }

  /** The Filter card: the app's own popup, centered over a dimmed screen. */
  private open(): void {
    openPopup(
      'Filter tasks',
      (body, close) => {
        this.body = body;
        body.classList.add('tf-body');
        body.closest('.popup')?.classList.add('tf-popup');
        this.fill();
        const done = el('button', { class: 'tf-done', type: 'button', text: 'Done' });
        done.addEventListener('click', () => close());
        // "Show everything" lives in the footer, at the very bottom of the card.
        const all = el('button', { class: 'tf-all', type: 'button', text: 'Show everything' }) as HTMLButtonElement;
        all.addEventListener('click', () => this.clear());
        all.hidden = !this.active;
        this.allBtn = all;
        body.after(el('div', { class: 'tf-foot' }, [all, done]));
      },
      this.host,
      FILTER_WIDTH_KEY
    );
  }

  private fill(): void {
    const body = this.body;
    if (!body || !body.isConnected) return;
    const scroll = body.scrollTop;
    body.replaceChildren();

    const section = (title: string, rows: HTMLElement[]): void => {
      if (!rows.length) return;
      body.append(el('div', { class: 'tf-col' }, [el('div', { class: 'tf-h', text: title }), el('div', { class: 'tf-group' }, rows)]));
    };
    /** `mark` is the colored dot (course, folder) or the priority arrow. */
    const row = (label: string, mark: HTMLElement, visible: boolean, set: Set<string>, key: string): HTMLElement => {
      const b = el('button', { class: 'tf-row' + (visible ? '' : ' off'), type: 'button', role: 'switch', 'aria-checked': String(visible) });
      const box = el('span', { class: 'tf-box' + (visible ? ' on' : '') });
      box.innerHTML = visible
        ? '<svg viewBox="0 0 16 16" width="13" height="13" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round"><path d="M3.5 8.5l3 3 6-7"/></svg>'
        : '';
      b.append(box, mark, el('span', { class: 'tf-label', text: label }));
      b.addEventListener('click', () => this.toggle(set, key));
      return b;
    };
    const dot = (color: string): HTMLElement => {
      const d = el('span', { class: 'tf-dot' });
      d.style.background = color;
      return d;
    };
    const arrow = (glyph: string, color: string): HTMLElement => {
      const a = el('span', { class: 'tf-arrow', text: glyph });
      a.style.color = color;
      return a;
    };

    const dim = 'var(--text-dim)';
    const courseRows = (): HTMLElement[] => [
      ...getCourses().map((c) => row(c.name, dot(c.color), !this.hiddenCourses.has(c.name.toLowerCase()), this.hiddenCourses, c.name.toLowerCase())),
      row('No course', dot(dim), !this.hiddenCourses.has(NONE), this.hiddenCourses, NONE),
    ];
    this.courseRows = courseRows;
    if (getCourses().length > MAX_INLINE_COURSES) {
      // Too many to list without making the card tall: one button opens them in a second card.
      const hidden = this.hiddenCourses.size;
      const more = el('button', { class: 'tf-row tf-more', type: 'button' }, [
        el('span', { class: 'tf-label', text: `All courses (${getCourses().length})` + (hidden ? ` · ${hidden} hidden` : '') }),
        el('span', { class: 'tf-chev', text: '›' }),
      ]);
      more.addEventListener('click', () => this.openCourses());
      section('Courses', [more]);
    } else section('Courses', courseRows());
    section(
      'Priority',
      PRIORITIES.map((p) => row(p.label, arrow(p.arrow, p.color), !this.hiddenPriorities.has(p.key), this.hiddenPriorities, p.key))
    );
    section(
      'Due date',
      DUE_BUCKETS.map((b) => row(b.label, el('span', { class: 'tf-gap' }), !this.hiddenDates.has(b.key), this.hiddenDates, b.key))
    );
    const folders = this.folders();
    if (folders.length) {
      section('Folders', [
        ...folders.map((f) => row(f.name, dot(f.color), !this.hiddenFolders.has(f.id), this.hiddenFolders, f.id)),
        row('Not in a folder', dot(dim), !this.hiddenFolders.has(NONE), this.hiddenFolders, NONE),
      ]);
    }
    if (this.allBtn) this.allBtn.hidden = !this.active;
    body.scrollTop = scroll;
  }

  // #endregion
}
