// WorkSpace — Tasks tab view (spec §6.6).

import type { Task, TaskMap, Priority, ParsedTask, TaskFolder } from '../types';
import type { Data, TasksUpdate } from '../db';
import { el, textInput, copyTextMetrics, autoWidthToText } from '../util/dom';
import { formatMetaDate, formatShortDate, formatTimeOfDay, formatDate, todayStr } from '../util/dates';
import { getPrefs, PREFS_EVENT, type AppPrefs } from '../prefs';
import { makeWidthGrip } from '../util/resize';
import { genId } from '../util/ids';
import { buildQuickAdd } from './quickadd';
import { makeTask, duplicateTask, groupTasks, dueBadge, type TaskGroup } from './store';
import { PRIORITIES, priorityDef } from './priorities';
import { getCourseColor, onRegistryChange, matchCourseStrict } from '../courses/registry';
import { classifyByRules, learnCorrection } from '../schoology/classify';
import { ASSESSMENT_RE } from '../schoology/ical';
import { parseDateTime } from './parser';
import { detectAttachmentType, normalizeUrl, openAttachment, openAll } from './attachments';
import { playCompleteChime, showUndoToast } from './complete';
import {
  getTaskFolders,
  saveTaskFolders,
  makeFolder,
  folderMembers,
  mutateTaskFolders,
  FOLDERS_EVENT,
} from './folders';
import { runSync } from '../schoology/sync';
import { analyzeTitle, languageName } from '../util/translate';

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

// Folder glyphs: a FILLED folder (tinted with the folder's color) for section
// rows, and an OUTLINE folder (currentColor) for the per-task toolbox button.
const FOLDER_SVG = (color: string) =>
  `<svg class="task-folder-ico" viewBox="0 0 24 24" fill="${color}"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
const FOLDER_BTN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// External-link / open-in-Schoology glyph.
const SCHOOLOGY_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 13v6a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2V8a2 2 0 0 1 2-2h6"/><path d="M15 3h6v6"/><path d="M10 14L21 3"/></svg>';

// The List ⇄ Calendar toggle's two faces.
const CAL_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="4" width="18" height="18" rx="2"/><path d="M16 2v4M8 2v4M3 10h18"/></svg>';
const LIST_SVG =
  '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M8 6h13M8 12h13M8 18h13M3 6h.01M3 12h.01M3 18h.01"/></svg>';

const DOWS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];

/** THE folder-dissolve animation — every dissolution (completed, emptied by
 *  remove/migrate/delete, in any tab) folds shut the same way: fade, then the
 *  height eases closed. ~0.8s total; callers that re-render must wait it out. */
export function collapseFolderBlock(block: HTMLElement): void {
  const h = block.offsetHeight;
  block.style.height = `${h}px`;
  block.style.overflow = 'hidden';
  block.style.transition = 'opacity 0.5s ease, height 0.34s ease 0.46s, margin 0.34s ease 0.46s';
  void block.offsetHeight;
  block.style.opacity = '0';
  requestAnimationFrame(() => {
    block.style.height = '0px';
    block.style.marginBottom = '0px';
  });
}

export class TasksView {
  private data: Data;
  private map: TaskMap = {};
  private listEl!: HTMLElement;
  private bannerHost!: HTMLElement;
  private autoTx = false; // guards the auto-translate pass against re-entry
  // The task being ⋮⋮-dragged (id + its due-date group), null when idle.
  private dragFrom: { id: string; group: string } | null = null;
  // Folders (the big-project feature): loaded once at mount, mutated only by
  // this view's own actions. openFolders is pure view state (expanded rows).
  private folders: TaskFolder[] = [];
  private openFolders = new Set<string>();
  // Dissolution is INSTANT (same render as the final check-off) — these two maps
  // make that safe: recentlyDissolved lets an Undo resurrect the folder with its
  // task; folderBornAt stops the "empty folder" sweep from eating a folder in
  // the moment between its creation and its first member's save.
  private recentlyDissolved = new Map<string, { folder: TaskFolder; at: number }>();
  private folderBornAt = new Map<string, number>();
  // Tasks whose completion is VISUALLY done but whose write is still pending
  // (the 820ms glide + the undo window). Hidden from renders, and ignored by the
  // folder-resurrection check so an instant dissolve isn't immediately undone.
  private completingIds = new Set<string>();
  // Landing-preview mode: popups mount into `host` (contained in the frame, not the
  // whole page) and external opens (Schoology / attachment links) are inert.
  private sample?: { host: HTMLElement };
  // Calendar mode (the big-project port). `mode` starts from the Default-screen
  // pref; `calView`/`calCursor` are pure view state; `calJumped` makes the
  // jump-to-earliest pref fire once per session, not on every render.
  private mode: 'list' | 'calendar' = 'list';
  private calView: 'month' | 'week' = 'month';
  private calCursor = new Date();
  private calJumped = false;
  private modeBtn!: HTMLButtonElement;
  // The floating task popover (a REAL task row): tracked so data updates can
  // rebuild its row in place, and so only one is ever open.
  private calPop: { taskId: string; pop: HTMLElement } | null = null;
  private calPopOutside: ((e: MouseEvent) => void) | null = null;
  // Multi-select (list mode): Ctrl/Cmd+click toggles rows, Shift+click extends
  // from the anchor; Esc clears. File-Explorer rule: using the TOOLBOX on any
  // selected row applies that action to every selected task at once.
  private selectedIds = new Set<string>();
  private lastSelId: string | null = null;

  constructor(data: Data, sample?: { host: HTMLElement }) {
    this.data = data;
    this.sample = sample;
  }

  /** Open an external URL — a no-op in the landing sample (buttons stay inert). */
  private openExt(url: string): void {
    if (!this.sample) openAttachment(url);
  }

  mount(panel: HTMLElement): void {
    this.bannerHost = el('div');
    const header = el('div', { class: 'tasks-header' });
    // List ⇄ Calendar toggle (quick nav; the Default-screen pref sets the start).
    this.mode = getPrefs().calendar.defaultScreen;
    this.calView = getPrefs().calendar.defaultView;
    this.modeBtn = el('button', { class: 'tasks-mode-btn' }) as HTMLButtonElement;
    const syncModeBtn = (): void => {
      this.modeBtn.innerHTML = this.mode === 'list' ? CAL_SVG : LIST_SVG;
      this.modeBtn.title = this.mode === 'list' ? 'Calendar view' : 'List view';
    };
    syncModeBtn();
    this.modeBtn.addEventListener('click', () => {
      this.mode = this.mode === 'list' ? 'calendar' : 'list';
      syncModeBtn();
      this.render();
    });
    header.append(this.modeBtn, this.makeRefreshBtn());
    // Settings changes (week start, density, colors…) repaint the calendar live.
    window.addEventListener(PREFS_EVENT, () => this.render()); // mount runs once per session
    // Esc clears the multi-select (unless an inline editor owns the keyboard).
    document.addEventListener('keydown', (e) => {
      if (e.key === 'Escape' && this.selectedIds.size && !document.querySelector('.inline-edit-block'))
        this.clearSelection();
    });
    const quickAdd = buildQuickAdd((parsed) => this.addTask(parsed), () => this.folders);
    this.listEl = el('div', { class: 'task-list' });
    panel.append(this.bannerHost, header, quickAdd, this.listEl);

    this.data.watchTasks((u) => this.onUpdate(u));
    // Re-render when course colors/names change in Preferences.
    onRegistryChange(() => this.render());
    // Folders are SHARED with Focus now, so they change from outside this view
    // too — load once, then re-read whenever anything writes them.
    void getTaskFolders(this.data).then((f) => {
      this.folders = f;
      this.render();
    });
    window.addEventListener(FOLDERS_EVENT, () => {
      void getTaskFolders(this.data).then((f) => {
        this.folders = f;
        this.render();
      });
    });
  }

  private onUpdate(u: TasksUpdate): void {
    this.map = u.tasks;
    // Selection follows reality: drop ids that vanished or got completed.
    for (const id of [...this.selectedIds]) {
      const t = this.map[id];
      if (!t || t.completed) this.selectedIds.delete(id);
    }
    this.bannerHost.replaceChildren();
    if (u.suspectedWipe) this.showWipeBanner();
    this.render();
    void this.folderMaintenance();
    // Read any not-yet-checked titles in the background and translate the foreign ones.
    void this.autoTranslatePass();
  }

  private showWipeBanner(): void {
    const banner = el('div', { class: 'wipe-banner' });
    banner.append(
      el('div', {
        text: '⚠️ Your data looked suddenly empty — WorkSpace blocked it to protect you. Restore everything from your most recent backup?',
      })
    );
    const btn = el('button', { text: 'Restore from backup' });
    btn.addEventListener('click', async () => {
      const ok = await this.data.restoreLatestBackup();
      if (ok) this.bannerHost.replaceChildren();
    });
    banner.append(btn);
    this.bannerHost.append(banner);
  }

  // --- data ops -----------------------------------------------------------

  private async addTask(parsed: ParsedTask): Promise<void> {
    // If the parser didn't catch an explicit course token, try Layer-1 parse-word
    // matching on the title so typed tasks get tagged like imported ones do.
    if (!parsed.course) {
      const hit = classifyByRules(parsed.title);
      if (hit) parsed = { ...parsed, course: hit };
    }
    const task = makeTask(parsed);
    // "f:NAME": join the folder with that name, or create it — color = the
    // task's course color, gray when there's no course (per Gabe's spec).
    if (parsed.folderName) {
      const want = parsed.folderName.toLowerCase();
      let folder = this.folders.find((f) => f.name.trim().toLowerCase() === want);
      if (!folder) {
        folder = makeFolder(parsed.folderName, parsed.course ? getCourseColor(parsed.course) : '#8b97a8');
        this.folderBornAt.set(folder.id, Date.now()); // shield from the empty sweep while the task saves
        this.folders.push(folder);
        await saveTaskFolders(this.data, this.folders);
      }
      task.folderId = folder.id;
      this.openFolders.add(folder.id);
    }
    await this.data.putTask(task);
  }

  private async save(task: Task): Promise<void> {
    await this.data.putTask(task);
  }

  /**
   * Persist a ⋮⋮ drop: rebuild the group's visible order with `fromId` moved to
   * `toId`'s slot, then snapshot every task's position into manualOrder (which
   * sortTasks ranks right after the due date). Renders optimistically first —
   * the bulk write's own notify re-renders identically once the backend acks.
   */
  private async reorderWithinGroup(group: TaskGroup, fromId: string, toId: string): Promise<void> {
    const ids = group.tasks.map((t) => t.id);
    const fi = ids.indexOf(fromId);
    const ti = ids.indexOf(toId);
    if (fi < 0 || ti < 0) return;
    ids.splice(ti, 0, ...ids.splice(fi, 1));
    const changed: Task[] = [];
    ids.forEach((id, i) => {
      const t = this.map[id];
      if (t && t.manualOrder !== i) changed.push({ ...t, manualOrder: i });
    });
    if (!changed.length) return;
    this.map = { ...this.map, ...Object.fromEntries(changed.map((t) => [t.id, t])) };
    this.render();
    await this.data.putTasksBulk(changed);
  }

  /** "Refresh tasks" — re-pull the Schoology iCal on demand. runSync() imports any
   *  new future assignments and calls data.refresh(), which re-renders the list. */
  private makeRefreshBtn(): HTMLButtonElement {
    // Icon-only (↻). Label is in the tooltip; single-glyph states keep the width
    // fixed: spins while loading, then ✓ on success / ⚠ on failure, then back to ↻.
    const btn = el('button', { class: 'tasks-refresh-btn', text: '↻', title: 'Refresh tasks' }) as HTMLButtonElement;
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('spinning');
      let ok = true;
      try {
        await runSync(this.data);
      } catch {
        ok = false;
      }
      btn.classList.remove('spinning');
      btn.textContent = ok ? '✓' : '⚠';
      setTimeout(() => {
        btn.disabled = false;
        btn.textContent = '↻';
      }, 1400);
    });
    return btn;
  }

  // --- rendering ----------------------------------------------------------

  private render(): void {
    this.listEl.replaceChildren();
    this.listEl.classList.toggle('cal-mode', this.mode === 'calendar');
    if (this.mode === 'calendar') {
      if (this.selectedIds.size) this.clearSelection(); // selection is list-only
      this.renderCalendar();
      this.refreshCalPop();
      return;
    }
    this.refreshCalPop(); // list mode → closes any stray popover
    this.renderFolders();
    // Foldered tasks live INSIDE their folder's section — the main due-date
    // groups show everything else. (A task pointing at a deleted folder falls
    // back to the main list rather than vanishing.)
    const loose: TaskMap = {};
    for (const [id, t] of Object.entries(this.map)) {
      if (!this.liveFolder(t) && !this.completingIds.has(id)) loose[id] = t;
    }
    const groups = groupTasks(loose);
    if (!groups.length && !this.folders.length) {
      this.listEl.append(
        el('div', { class: 'empty-state', text: 'No tasks yet. Add one above to get started.' })
      );
      return;
    }
    for (const g of groups) {
      this.listEl.append(
        el('div', { class: `task-group-header tone-${g.tone}`, text: g.header })
      );
      for (const t of g.tasks) this.listEl.append(this.renderTask(t, g));
    }
  }

  // --- calendar mode (the big-project port) --------------------------------

  /** The whole calendar screen: toolbar (view seg + nav) and the active view. */
  private renderCalendar(): void {
    const prefs = getPrefs().calendar;
    // Jump-to-earliest: once per session, as soon as tasks exist to measure.
    if (prefs.jumpToEarliest && !this.calJumped && Object.keys(this.map).length) {
      this.calJumped = true;
      const dates = Object.values(this.map)
        .filter((t) => !t.completed && t.dueDate)
        .map((t) => t.dueDate!)
        .sort();
      if (dates[0]) this.calCursor = new Date(dates[0] + 'T12:00:00');
    }

    const bar = el('div', { class: 'cal-bar' });
    const seg = el('div', { class: 'cal-seg' });
    for (const v of ['month', 'week'] as const) {
      const b = el('button', {
        class: `cal-seg-btn${this.calView === v ? ' active' : ''}`,
        text: v[0].toUpperCase() + v.slice(1),
      });
      b.addEventListener('click', () => {
        this.calView = v;
        this.render();
      });
      seg.append(b);
    }
    const nav = el('div', { class: 'cal-nav' });
    const label = el('span', { class: 'cal-label', text: this.calLabel() });
    const todayBtn = el('button', { class: 'cal-nav-btn cal-today', text: 'Today' });
    todayBtn.addEventListener('click', () => {
      this.calCursor = new Date();
      this.render();
    });
    const step = (dir: 1 | -1): void => {
      if (this.calView === 'month') this.calCursor.setMonth(this.calCursor.getMonth() + dir);
      else this.calCursor.setDate(this.calCursor.getDate() + dir * 7);
      this.render();
    };
    const prev = el('button', { class: 'cal-nav-btn', text: '‹', title: 'Previous' });
    const next = el('button', { class: 'cal-nav-btn', text: '›', title: 'Next' });
    prev.addEventListener('click', () => step(-1));
    next.addEventListener('click', () => step(1));
    nav.append(todayBtn, prev, label, next);
    bar.append(seg, nav);
    this.listEl.append(bar);

    // Folders first (same section as the list view — rename/recolor/toggle all
    // work here too); each open folder deploys its own scoped calendar. Foldered
    // tasks live THERE, so the main grid below shows only loose tasks.
    this.renderFolders('cal');
    const loose = this.calByDate((t) => !this.liveFolder(t));
    if (this.calView === 'month') this.calMonth(prefs, loose, this.listEl);
    else this.calWeek(prefs, loose, this.listEl);
  }

  private calLabel(): string {
    if (this.calView === 'month')
      return this.calCursor.toLocaleString('en-US', { month: 'long', year: 'numeric' });
    const start = this.weekStartDate();
    const end = new Date(start);
    end.setDate(end.getDate() + 6);
    const f = (d: Date) => d.toLocaleString('en-US', { month: 'short', day: 'numeric' });
    return `${f(start)} – ${f(end)}, ${end.getFullYear()}`;
  }

  /** The first day of the cursor's week, honoring the week-start pref. */
  private weekStartDate(): Date {
    const ws = getPrefs().calendar.weekStart;
    const d = new Date(this.calCursor);
    d.setHours(12, 0, 0, 0);
    d.setDate(d.getDate() - ((d.getDay() - ws + 7) % 7));
    return d;
  }

  /** Chips eligible for a grid: dated, not mid-completion, completed only when
   *  the Show-completed pref keeps them, and passing `filter` — the main
   *  calendar filters to LOOSE tasks, each folder's calendar to its members
   *  (mirroring the list view's folder/loose split). */
  private calByDate(filter?: (t: Task) => boolean): Map<string, Task[]> {
    const show = getPrefs().calendar.showCompleted;
    const by = new Map<string, Task[]>();
    for (const t of Object.values(this.map)) {
      if (!t.dueDate || this.completingIds.has(t.id) || (t.completed && !show)) continue;
      if (filter && !filter(t)) continue;
      (by.get(t.dueDate) ?? by.set(t.dueDate, []).get(t.dueDate)!).push(t);
    }
    for (const list of by.values())
      list.sort(
        (a, b) => (a.dueTime || '99:99').localeCompare(b.dueTime || '99:99') || a.title.localeCompare(b.title)
      );
    return by;
  }

  /** One chip: color strip per the Color-by pref, a course-colored dot (always —
   *  so the course reads at a glance either way), two-line title, NO time
   *  (times live in the popover). Click floats the real task row. */
  private calChip(t: Task): HTMLElement {
    const color =
      getPrefs().calendar.colorBy === 'course'
        ? t.course
          ? getCourseColor(t.course)
          : '#e6a817'
        : priorityDef(t.priority).color;
    const chip = el('button', {
      class: `cal-chip${t.completed ? ' done' : ''}`,
      title: t.course ? `${t.title} — ${t.course}` : t.title,
    });
    chip.style.setProperty('--chip', color);
    const txt = el('span', { class: 'cal-chip-txt' });
    if (t.course) {
      const dot = el('span', { class: 'cal-chip-dot' });
      dot.style.background = getCourseColor(t.course);
      txt.append(dot);
    }
    txt.append(t.title);
    chip.append(txt);
    chip.addEventListener('click', (e) => {
      e.stopPropagation();
      this.openCalPopover(t, e);
    });
    return chip;
  }

  private calMonth(prefs: AppPrefs['calendar'], by: Map<string, Task[]>, host: HTMLElement): void {
    const ws = prefs.weekStart;
    const y = this.calCursor.getFullYear();
    const m = this.calCursor.getMonth();
    const offset = (new Date(y, m, 1, 12).getDay() - ws + 7) % 7;
    const daysInMonth = new Date(y, m + 1, 0).getDate();
    const rows = Math.ceil((offset + daysInMonth) / 7);
    const maxChips = prefs.density === 'compact' ? 5 : 3;
    const todayISO = todayStr();

    const head = el('div', { class: 'cal-dows' });
    for (let i = 0; i < 7; i++) head.append(el('div', { text: DOWS[(ws + i) % 7] }));
    const grid = el('div', { class: `cal-grid cal-${prefs.density}` });
    for (let i = 0; i < rows * 7; i++) {
      const d = new Date(y, m, 1 - offset + i, 12);
      const dISO = formatDate(d);
      const cell = el('div', {
        class: `cal-cell${d.getMonth() !== m ? ' out' : ''}${dISO === todayISO ? ' today' : ''}`,
      });
      cell.append(el('div', { class: 'cal-daynum', text: String(d.getDate()) }));
      const tasks = by.get(dISO) ?? [];
      for (const t of tasks.slice(0, maxChips)) cell.append(this.calChip(t));
      if (tasks.length > maxChips) {
        const more = el('button', { class: 'cal-more', text: `+${tasks.length - maxChips} more` });
        more.addEventListener('click', (e) => {
          e.stopPropagation();
          this.openDayPop(dISO, tasks, e);
        });
        cell.append(more);
      }
      grid.append(cell);
    }
    host.append(head, grid);
  }

  private calWeek(prefs: AppPrefs['calendar'], by: Map<string, Task[]>, host: HTMLElement): void {
    const start = this.weekStartDate();
    const todayISO = todayStr();
    const head = el('div', { class: 'cal-dows' });
    const grid = el('div', { class: `cal-grid cal-week cal-${prefs.density}` });
    for (let i = 0; i < 7; i++) {
      const d = new Date(start);
      d.setDate(d.getDate() + i);
      const dISO = formatDate(d);
      head.append(el('div', { text: `${DOWS[d.getDay()]} ${d.getMonth() + 1}/${d.getDate()}` }));
      const cell = el('div', { class: `cal-cell${dISO === todayISO ? ' today' : ''}` });
      for (const t of by.get(dISO) ?? []) cell.append(this.calChip(t));
      grid.append(cell);
    }
    host.append(head, grid);
  }

  /** Chip click → the task's REAL list row, floated. Same element, same handlers:
   *  checkbox completes with the undo toast, the toolbox and dblclick edits all
   *  behave exactly like the list view. (The ⋮⋮ handle is hidden by CSS — a
   *  standalone container has no list to reorder within.) */
  private openCalPopover(task: Task, e: MouseEvent): void {
    this.closeCalPop();
    const pop = el('div', { class: 'cal-pop' });
    const closeB = el('button', { class: 'cal-pop-close', text: '✕' });
    closeB.addEventListener('click', () => this.closeCalPop());
    const rowHost = el('div', { class: 'cal-pop-row' });
    rowHost.append(this.calPopRow(task));
    // Completing from the popover: let the row's glide play, then the popover goes.
    rowHost.addEventListener('click', (ev) => {
      if ((ev.target as Element).closest('.task-cb')) window.setTimeout(() => this.closeCalPop(), 900);
    });
    pop.append(closeB, rowHost);
    this.mountCalPop(pop, e, task.id);
  }

  /** "+N more" → a small popup listing the day's full chip stack. */
  private openDayPop(dateISO: string, tasks: Task[], e: MouseEvent): void {
    this.closeCalPop();
    const pop = el('div', { class: 'cal-pop cal-day-pop' });
    const closeB = el('button', { class: 'cal-pop-close', text: '✕' });
    closeB.addEventListener('click', () => this.closeCalPop());
    const d = new Date(dateISO + 'T12:00:00');
    pop.append(
      closeB,
      el('div', {
        class: 'cal-day-pop-title',
        text: d.toLocaleString('en-US', { weekday: 'long', month: 'long', day: 'numeric' }),
      })
    );
    for (const t of tasks) pop.append(this.calChip(t));
    this.mountCalPop(pop, e, '');
  }

  /** Shared popover plumbing: mount, clamp to the viewport, close on outside
   *  click (clicks inside popups the row itself opens don't count as outside). */
  private mountCalPop(pop: HTMLElement, e: MouseEvent, taskId: string): void {
    (this.sample?.host ?? document.body).append(pop);
    pop.style.left = `${Math.max(12, Math.min(window.innerWidth - pop.offsetWidth - 12, e.clientX + 8))}px`;
    pop.style.top = `${Math.max(12, Math.min(window.innerHeight - pop.offsetHeight - 12, e.clientY + 8))}px`;
    this.calPop = { taskId, pop };
    this.calPopOutside = (ev: MouseEvent) => {
      const t = ev.target as Element;
      if (!t.closest('.cal-pop') && !t.closest('.popup-backdrop')) this.closeCalPop();
    };
    document.addEventListener('click', this.calPopOutside);
  }

  private calPopRow(task: Task): HTMLElement {
    // Synthesize the row's due-date group; a completed task (viewable when
    // Show-completed is on) gets a stub since groupTasks only returns active.
    const g =
      groupTasks({ [task.id]: task })[0] ??
      ({ key: 'none', header: '', tone: 'none', tasks: [task] } as TaskGroup);
    return this.renderTask(task, { ...g, key: `cal:${g.key}` });
  }

  /** Keep the open popover honest across re-renders: rebuild its row from the
   *  fresh task (so committed edits replace the editor), close it when its task
   *  is gone or the mode changed. Mid-glide completions are left to their timer. */
  private refreshCalPop(): void {
    if (!this.calPop) return;
    if (this.mode !== 'calendar') {
      this.closeCalPop();
      return;
    }
    const { taskId, pop } = this.calPop;
    if (!taskId) {
      this.closeCalPop(); // day-list popup: any data change makes it stale
      return;
    }
    if (this.completingIds.has(taskId)) return;
    const t = this.map[taskId];
    const rowHost = pop.querySelector('.cal-pop-row');
    if (!t || !rowHost || (t.completed && !getPrefs().calendar.showCompleted)) {
      this.closeCalPop();
      return;
    }
    rowHost.replaceChildren(this.calPopRow(t));
  }

  private closeCalPop(): void {
    if (this.calPopOutside) document.removeEventListener('click', this.calPopOutside);
    this.calPopOutside = null;
    this.calPop?.pop.remove();
    this.calPop = null;
  }

  /** The folder a task belongs to — undefined when unfoldered OR the folder no
   *  longer exists (orphaned folderId). */
  private liveFolder(t: Task): TaskFolder | undefined {
    return t.folderId ? this.folders.find((f) => f.id === t.folderId) : undefined;
  }

  /** The Folders section: rows above the date groups (list) or above the main
   *  grid (calendar). Expanding a folder shows the same presentation as the
   *  surrounding mode, scoped to that folder: due-date groups in the list, a
   *  whole scoped calendar in calendar mode. */
  private renderFolders(bodyMode: 'list' | 'cal' = 'list'): void {
    if (!this.folders.length) return;
    this.listEl.append(el('div', { class: 'task-folders-label', text: 'Folders' }));
    for (const f of this.folders) {
      const members = folderMembers(f, this.map);
      const done = members.filter((t) => t.completed).length;
      const open = this.openFolders.has(f.id);
      const row = el('div', { class: `task-folder${open ? ' open' : ''}`, 'data-folder-id': f.id });
      const head = el('button', { class: 'task-folder-head' });
      head.innerHTML = FOLDER_SVG(f.color);
      // Double-click the name to rename (same convention as task titles); a
      // single click on the name is a no-op so renaming never fights the toggle.
      const nameEl = el('span', { class: 'task-folder-name', text: f.name });
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.inlineEdit(nameEl, f.name, (v) => {
          if (!v) return;
          f.name = v;
          void saveTaskFolders(this.data, this.folders);
        });
      });
      // Click the folder ICON to recolor: a hidden native color input opens the
      // OS picker — the icon previews live while dragging, the pick saves on close.
      const colorIn = el('input', {
        type: 'color',
        class: 'task-folder-colorin',
        value: /^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#e6a817',
        title: 'Folder color',
      });
      colorIn.addEventListener('click', (e) => e.stopPropagation());
      colorIn.addEventListener('input', () => {
        f.color = colorIn.value;
        head.querySelector('.task-folder-ico')?.setAttribute('fill', colorIn.value);
      });
      colorIn.addEventListener('change', () => {
        void saveTaskFolders(this.data, this.folders);
        this.render();
      });
      head.append(
        nameEl,
        el('span', { class: 'task-folder-count', text: `${done}/${members.length}` }),
        el('span', { class: 'task-folder-arrow', text: '▶' }),
        colorIn
      );
      head.addEventListener('click', (e) => {
        const t = e.target as Element;
        // A rename is in progress → the head is inert (a spacebar "activation
        // click" targets the BUTTON itself, so target checks alone can't catch it).
        if (head.querySelector('.inline-edit-block')) return;
        if (t.closest('.task-folder-name')) return;
        if (t.closest('.task-folder-ico')) {
          colorIn.click();
          return;
        }
        if (open) this.openFolders.delete(f.id);
        else this.openFolders.add(f.id);
        this.render();
      });
      row.append(head);
      if (open) {
        const body = el('div', { class: `task-folder-body${bodyMode === 'cal' ? ' cal-scope' : ''}` });
        if (bodyMode === 'cal') {
          // A whole calendar, scoped to this folder's members — same view and
          // cursor as the main grid (the one toolbar drives every calendar).
          const prefs = getPrefs().calendar;
          const scoped = this.calByDate((t) => t.folderId === f.id);
          if (this.calView === 'month') this.calMonth(prefs, scoped, body);
          else this.calWeek(prefs, scoped, body);
        } else {
          const subMap: TaskMap = {};
          for (const t of members) if (!t.completed && !this.completingIds.has(t.id)) subMap[t.id] = t;
          const subgroups = groupTasks(subMap);
          for (const g of subgroups) {
            // Scope the group key to this folder so ⋮⋮ reordering never crosses
            // between a folder's list and the main list on the same date.
            const scoped: TaskGroup = { ...g, key: `${f.id}:${g.key}` };
            body.append(el('div', { class: `task-group-header tone-${g.tone}`, text: g.header }));
            for (const t of g.tasks) body.append(this.renderTask(t, scoped));
          }
          if (!subgroups.length) {
            body.append(el('div', { class: 'task-folder-empty', text: 'Everything in here is done 🎉' }));
          }
        }
        row.append(body);
      }
      this.listEl.append(row);
    }
  }

  /** The 🗀 picker: join an existing folder, leave the current one, or create a
   *  new folder (named here; color defaults to the task's course) — the same
   *  flow as Bookmarks' "+ Group". Opened from a SELECTED row, every choice
   *  here applies to the whole selection (the File-Explorer rule). */
  private openFolderPicker(task: Task): void {
    const targets = this.selTargets(task);
    const applyAll = (mutate: (t: Task) => Task): void => {
      if (targets.length > 1) void this.data.putTasksBulk(targets.map(mutate));
      else this.save(mutate(task));
    };
    this.popup('Add to folder', (body, close) => {
      const wrap = el('div', { class: 'folder-pick' });
      for (const f of this.folders) {
        const b = el('button', { class: `folder-pick-row${task.folderId === f.id ? ' on' : ''}` });
        b.innerHTML = FOLDER_SVG(f.color);
        b.append(el('span', { text: f.name }));
        b.addEventListener('click', () => {
          this.openFolders.add(f.id);
          applyAll((t) => ({ ...t, folderId: f.id }));
          close();
        });
        wrap.append(b);
      }
      if (targets.some((t) => t.folderId)) {
        const rm = el('button', { class: 'folder-pick-remove', text: 'Remove from folder' });
        rm.addEventListener('click', () => {
          applyAll((t) => {
            const next = { ...t };
            delete next.folderId; // delete, not undefined — Firebase rejects undefined
            return next;
          });
          close();
        });
        wrap.append(rm);
      }
      // "+ New folder" row: name box + a color well. The well DEFAULTS to the
      // task's course color but is freely editable (native color picker).
      const courseColor = task.course ? getCourseColor(task.course) : '#e6a817';
      const colorIn = el('input', {
        type: 'color',
        class: 'folder-pick-color',
        value: /^#[0-9a-f]{6}$/i.test(courseColor) ? courseColor : '#e6a817',
        title: 'Folder color',
      });
      const input = textInput({ class: 'folder-pick-input', placeholder: '+ New folder…' });
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const name = input.value.trim();
        if (!name) return;
        const folder = makeFolder(name, colorIn.value);
        this.folderBornAt.set(folder.id, Date.now()); // shields it from the empty-folder sweep while its first member saves
        this.folders.push(folder);
        void saveTaskFolders(this.data, this.folders).then(() => {
          this.openFolders.add(folder.id);
          applyAll((t) => ({ ...t, folderId: folder.id })); // triggers the re-render
          close();
        });
      });
      const newRow = el('div', { class: 'folder-pick-new' });
      newRow.append(colorIn, input);
      wrap.append(newRow);
      body.append(wrap);
    });
  }

  /** Folder upkeep, run on every task update — two jobs, in this order:
   *  1. RESURRECT: an Undo brought a member back after its folder dissolved →
   *     re-add the folder (30s window), so instant dissolution never orphans.
   *  2. DISSOLVE, instantly: all members completed → the folder goes in the SAME
   *     render pass as the final check-off (per Gabe: simultaneous, no delay).
   *     Folders left with no members also dissolve — except brand-new ones
   *     (< 5s old), which are mid-creation awaiting their first member's save. */
  private async folderMaintenance(): Promise<void> {
    const now = Date.now();

    // 1. resurrection (undo support)
    let changed = false;
    for (const [id, rec] of [...this.recentlyDissolved]) {
      if (now - rec.at > 30000) {
        this.recentlyDissolved.delete(id);
        continue;
      }
      const memberBack = Object.values(this.map).some(
        (t) => t.folderId === id && !t.completed && !this.completingIds.has(t.id)
      );
      if (memberBack && !this.folders.some((f) => f.id === id)) {
        this.folders.push(rec.folder);
        this.recentlyDissolved.delete(id);
        changed = true;
      }
    }

    // 2. instant dissolution
    const gone = this.folders.filter((f) => {
      const members = folderMembers(f, this.map);
      // The birth shield only bridges creation → first member's save. Once the
      // folder HAS members, retire it — so emptying the folder later (even
      // seconds after creating it) dissolves on the very next sweep.
      if (members.length === 0) return now - (this.folderBornAt.get(f.id) ?? 0) > 5000;
      this.folderBornAt.delete(f.id);
      return members.every((t) => t.completed);
    });
    let animating = false;
    if (gone.length) {
      this.folders = this.folders.filter((f) => !gone.includes(f));
      for (const f of gone) {
        this.openFolders.delete(f.id);
        this.recentlyDissolved.set(f.id, { folder: f, at: now });
        // Smooth exit (per Gabe: SAME animation for every dissolution): fold the
        // still-rendered block shut, and hold the re-render until it finishes.
        const block = this.listEl.querySelector<HTMLElement>(`.task-folder[data-folder-id="${f.id}"]`);
        if (block) {
          collapseFolderBlock(block);
          animating = true;
        }
      }
      // Only the EMPTIED case gets its own notice. All-members-done dissolves
      // always ride a completion undo toast (single check-offs announce the
      // folder inside that toast; bulk completes have "N tasks completed") —
      // a second toast on top was redundant (per Gabe).
      const last = gone[gone.length - 1];
      if (folderMembers(last, this.map).length === 0) {
        this.notice(`📁 “${last.name}” empty — folder dissolved`);
      }
      changed = true;
    }

    if (changed) {
      // Merge by ID against the CURRENT stored list — never write this view's
      // whole array back, or a folder created in Focus (which this copy has
      // never seen) would be erased along with the dissolved ones.
      this.folders = await mutateTaskFolders(
        this.data,
        gone.map((f) => f.id),
        this.folders
      );
      if (animating) window.setTimeout(() => this.render(), 820); // let the fold-shut play out first
      else this.render();
    }
  }

  /** A plain auto-expiring notice using the app's .toast styling (no Undo). */
  private notice(msg: string): void {
    const t = el('div', { class: 'toast', text: msg });
    (this.sample?.host ?? document.body).append(t);
    void t.offsetHeight;
    t.classList.add('show');
    window.setTimeout(() => {
      t.classList.remove('show');
      window.setTimeout(() => t.remove(), 350);
    }, 2600);
  }

  private renderTask(task: Task, group: TaskGroup): HTMLElement {
    const item = el('div', { class: `task-item${task.completed ? ' completed' : ''}` });
    // Multi-select: rows carry their id, wear .selected, and route clicks.
    item.dataset.taskId = task.id;
    if (this.selectedIds.has(task.id)) item.classList.add('selected');
    // Shift/Ctrl clicks are SELECTION gestures here — kill the browser's native
    // text-selection at its source (the mousedown default), or a shift+click
    // paints every row in between blue instead of selecting tasks.
    item.addEventListener('mousedown', (e) => {
      if ((e.shiftKey || e.ctrlKey || e.metaKey) && this.mode === 'list') e.preventDefault();
    });
    item.addEventListener('click', (e) => this.onRowClick(task, e));
    item.append(el('div', { class: `task-priority ${task.priority}` }));

    // ⋮⋮ drag-to-reorder (same handle as bookmark cards). A drop is only accepted
    // WITHIN the same due-date group — the group is determined by the due date, so
    // dragging can never silently reschedule a task. The handle arms `draggable`
    // so text selection and button clicks elsewhere on the row stay untouched.
    const handle = el('span', { class: 'task-handle', text: '⋮⋮', title: 'Drag to reorder' });
    handle.addEventListener('pointerdown', () => item.setAttribute('draggable', 'true'));
    handle.addEventListener('pointerup', () => item.removeAttribute('draggable'));
    item.addEventListener('dragstart', (e) => {
      this.dragFrom = { id: task.id, group: group.key };
      item.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', task.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    item.addEventListener('dragend', () => {
      item.classList.remove('dragging');
      item.removeAttribute('draggable');
      this.dragFrom = null;
    });
    item.addEventListener('dragover', (e) => {
      if (this.dragFrom?.group !== group.key) return; // cross-group: not a drop target
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    item.addEventListener('drop', (e) => {
      e.preventDefault();
      const from = this.dragFrom;
      this.dragFrom = null;
      if (!from || from.id === task.id || from.group !== group.key) return;
      void this.reorderWithinGroup(group, from.id, task.id);
    });
    item.append(handle);

    const cb = el('button', { class: `task-cb${task.completed ? ' checked' : ''}` });
    cb.innerHTML = CHECK_SVG;
    cb.addEventListener('click', () => this.complete(task, item));
    item.append(cb);

    const info = el('div', { class: 'task-info' });

    // Title (double-click to edit)
    const title = el('div', { class: 'task-title', text: task.title });
    title.addEventListener('dblclick', () => this.editTitle(task, title));
    info.append(title);

    // A re-sync changed this assignment (teacher renamed it, moved the date, or
    // rewrote the instructions) — show a gold ✱ until the user clicks it away.
    // The tooltip names exactly what changed (stored on the task by the sync);
    // the generic fallback covers flags written before the list existed.
    if (task.feedUpdated) {
      const what = Array.isArray(task.feedUpdated) && task.feedUpdated.length
        ? task.feedUpdated.join(', ')
        : 'name, date, or instructions';
      const upd = el('span', {
        class: 'task-altered-badge',
        text: '✱',
        title: `Changed on Schoology since import: ${what} — click to dismiss`,
      });
      upd.addEventListener('click', (ev) => {
        ev.stopPropagation(); // the row itself has click/dblclick behaviors
        const next = { ...task };
        delete next.feedUpdated; // delete, not undefined — Firebase rejects undefined
        this.save(next);
      });
      title.append(upd);
    }

    // Foreign-language title: the auto-translated English shows beneath it, unless
    // the user hid it with the 🌐 toggle (in the actions row).
    if (task.translatedTitle && !task.translationHidden) {
      const tr = el('div', {
        class: 'task-translation',
        title: `Translated from ${languageName(task.translatedLang || '')}`,
      });
      tr.append(el('span', { class: 'task-translation-badge', text: '🌐' }));
      tr.append(el('span', { text: task.translatedTitle }));
      info.append(tr);
    }

    // Bottom row: [ meta + due badge ] .......... [ actions ]   (single line)
    const bottom = el('div', { class: 'task-bottom-row' });
    const metaWrap = el('div', { class: 'task-meta-wrap' });
    const meta = el('div', { class: 'task-meta' });

    // Meta reads COURSE · DATE TIME — the date and its due time are ONE integrated
    // unit (e.g. "Tomorrow 8am"), never split across the row.
    if (task.course) {
      const chip = el('span', { class: 'course-chip', text: task.course });
      chip.style.color = getCourseColor(task.course);
      chip.addEventListener('dblclick', () => this.editCourse(task, chip));
      meta.append(chip);
    } else {
      // Uncategorized (e.g. an import the AI couldn't place) — offer a one-click tag.
      const chip = el('span', { class: 'course-chip empty', text: '+ course' });
      chip.addEventListener('click', () => this.editCourse(task, chip));
      meta.append(chip);
    }
    if (task.dueDate || task.dueTime) {
      meta.append(el('span', { class: 'meta-dot', text: '·' }));
      const when = [
        task.dueDate ? formatMetaDate(task.dueDate) : '',
        task.dueTime ? this.fmtTime(task.dueTime) : '',
      ]
        .filter(Boolean)
        .join(' ');
      const dateEl = el('span', { class: 'meta-date', text: when });
      dateEl.addEventListener('dblclick', () => this.editDateTime(task, dateEl));
      meta.append(dateEl);
    } else {
      // Undated — offer a one-click affordance to set a due date (mirrors "+ course").
      meta.append(el('span', { class: 'meta-dot', text: '·' }));
      const dateEl = el('span', { class: 'meta-date empty', text: '+ due date' });
      dateEl.addEventListener('click', () => this.editDateTime(task, dateEl));
      meta.append(dateEl);
    }
    // (No "via Schoology" tag — the ↗ / ⓘ action buttons already mark imports,
    // and dropping it keeps the meta line uncluttered.)
    metaWrap.append(meta);

    const badge = dueBadge(task);
    if (badge) metaWrap.append(el('span', { class: `task-due-badge ${badge.state}`, text: badge.label }));
    // Assessment badge — anything that looks like a graded assessment (same
    // word-boundary regex the importer uses) gets flagged beside the days badge,
    // labeled with its actual type: QUIZ / TEST / EXAM / MIDTERM / FINAL.
    // Checked at render time so it covers manual tasks, old imports & translations.
    const assess =
      ASSESSMENT_RE.exec(task.title) ||
      (task.translatedTitle ? ASSESSMENT_RE.exec(task.translatedTitle) : null);
    if (assess) {
      const word = assess[1].toLowerCase();
      // Singularize the plural forms: quizzes → quiz, exams → exam, finals → final.
      const label = (word === 'quizzes' ? 'quiz' : word.replace(/s$/, '')).toUpperCase();
      metaWrap.append(el('span', { class: 'task-test-badge', text: label }));
    }
    bottom.append(metaWrap);

    // Actions — two clusters separated by a dot:
    //   [assignment: ↗ Schoology, ⓘ description] · [tools: 🌐, 📎, priority, ⎘]
    const actions = el('div', { class: 'task-actions' });
    if (task.schoologyUrl) {
      const link = el('button', { class: 'act-schoology', title: 'Open in Schoology' });
      link.innerHTML = SCHOOLOGY_SVG;
      link.addEventListener('click', () => this.openExt(task.schoologyUrl!));
      actions.append(link);
    }
    if (task.details) {
      const infoBtn = el('button', { title: 'Description', text: 'ⓘ' });
      infoBtn.addEventListener('click', () => this.openDetails(task));
      actions.append(infoBtn);
    }
    // Separator between the assignment buttons and the tools (only when the
    // assignment cluster exists — manual tasks have no ↗/ⓘ, so no stray dot).
    if (actions.childNodes.length) actions.append(el('span', { class: 'act-sep', text: '·' }));

    // Translation toggle — only when there's a translation to show/hide.
    if (task.translatedTitle) {
      const trBtn = el('button', {
        class: `act-translate${task.translationHidden ? '' : ' active'}`,
        title: task.translationHidden ? 'Show translation' : 'Hide translation',
        text: '🌐',
      }) as HTMLButtonElement;
      trBtn.addEventListener('click', () =>
        this.save({ ...task, translationHidden: !task.translationHidden })
      );
      actions.append(trBtn);
    }

    const attachBtn = el('button', { title: 'Attachments' });
    const noteCount = task.notes?.length ?? 0;
    attachBtn.innerHTML = `📎${noteCount ? `<span class="attach-count">${noteCount}</span>` : ''}`;
    attachBtn.addEventListener('click', () => this.openAttachments(task));
    actions.append(attachBtn);

    // Folder — join/leave/create a folder for this task. Tinted with the
    // folder's color once the task belongs to one.
    const inFolder = this.liveFolder(task);
    const foldBtn = el('button', {
      class: 'act-folder',
      title: inFolder ? `Folder: ${inFolder.name}` : 'Add to folder',
    });
    foldBtn.innerHTML = FOLDER_BTN_SVG;
    if (inFolder) foldBtn.style.color = inFolder.color;
    foldBtn.addEventListener('click', () => this.openFolderPicker(task));
    actions.append(foldBtn);

    const prioBtn = el('button', { title: 'Priority', text: priorityDef(task.priority).arrow });
    prioBtn.style.color = priorityDef(task.priority).color;
    prioBtn.addEventListener('click', () => this.openPriority(task));
    actions.append(prioBtn);

    const dupBtn = el('button', { title: 'Duplicate', text: '⎘' });
    dupBtn.addEventListener('click', () => {
      // Duplicating a selected row duplicates the whole selection.
      const targets = this.selTargets(task);
      if (targets.length > 1) void this.data.putTasksBulk(targets.map((t) => duplicateTask(t)));
      else this.save(duplicateTask(task));
    });
    actions.append(dupBtn);

    bottom.append(actions);
    info.append(bottom);
    item.append(info);
    return item;
  }

  private fmtTime(hhmm: string): string {
    return formatTimeOfDay(hhmm); // honors the Time-format pref (12h/24h)
  }

  // --- multi-select (list mode) --------------------------------------------

  /** Row click routing, Explorer-style: SHIFT+click is the main gesture — the
   *  first one selects (and anchors), the next extends the range from the
   *  anchor. Ctrl/Cmd+click toggles individual rows, and once a selection
   *  exists plain clicks toggle too. Clicks on the row's own controls
   *  (buttons, links, editors, the ⋮⋮ handle) never count. */
  private onRowClick(task: Task, e: MouseEvent): void {
    if (this.mode !== 'list') return; // popover rows in calendar mode don't select
    const t = e.target as Element;
    if (t.closest('button, a, textarea, input, .task-handle, .inline-edit-block')) return;
    const multi = e.ctrlKey || e.metaKey || e.shiftKey; // an unanchored shift-click starts the selection
    const range = e.shiftKey && !!this.lastSelId;
    if (!multi && !range && !this.selectedIds.size) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges(); // sweep away any text highlight a drag left behind
    if (range) {
      const ids = [...this.listEl.querySelectorAll<HTMLElement>('.task-item[data-task-id]')].map(
        (r) => r.dataset.taskId!
      );
      const a = ids.indexOf(this.lastSelId!);
      const b = ids.indexOf(task.id);
      if (a >= 0 && b >= 0) {
        for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selectedIds.add(ids[i]);
      } else {
        this.selectedIds.add(task.id);
      }
    } else if (this.selectedIds.has(task.id)) {
      this.selectedIds.delete(task.id);
    } else {
      this.selectedIds.add(task.id);
    }
    // An EMPTY selection must also drop the range anchor — otherwise the next
    // shift+click ranges from a row deselected long ago and "resurrects" rows
    // the user never re-picked. Anchor exists only while a selection does.
    this.lastSelId = this.selectedIds.size ? task.id : null;
    this.syncSelectionUI();
  }

  private syncSelectionUI(): void {
    for (const row of this.listEl.querySelectorAll<HTMLElement>('.task-item[data-task-id]'))
      row.classList.toggle('selected', this.selectedIds.has(row.dataset.taskId!));
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.lastSelId = null;
    this.syncSelectionUI();
  }

  /** The tasks a toolbox action operates on: the WHOLE selection when the acted-on
   *  row is part of it, just that task otherwise (the File-Explorer rule). */
  private selTargets(task: Task): Task[] {
    if (this.selectedIds.has(task.id) && this.selectedIds.size > 1)
      return [...this.selectedIds].map((id) => this.map[id]).filter((t): t is Task => !!t);
    return [task];
  }

  /** Complete every selected task in ONE write, with ONE undo for the batch. */
  private async bulkComplete(): Promise<void> {
    const tasks = [...this.selectedIds]
      .map((id) => this.map[id])
      .filter((t): t is Task => !!t && !t.completed);
    this.clearSelection();
    if (!tasks.length) return;
    playCompleteChime();
    const now = new Date().toISOString();
    await this.data.putTasksBulk(tasks.map((t) => ({ ...t, completed: true, completedAt: now })));
    showUndoToast(
      `${tasks.length} task${tasks.length === 1 ? '' : 's'} completed`,
      () => void this.data.putTasksBulk(tasks.map((t) => ({ ...t, completed: false, completedAt: null }))),
      () => {},
      this.sample?.host
    );
  }

  // --- completion ---------------------------------------------------------

  private complete(task: Task, animEl: HTMLElement): void {
    if (task.completed) return;
    // Checking a SELECTED row completes the whole selection (one write, one undo).
    if (this.selectedIds.has(task.id) && this.selectedIds.size > 1) {
      void this.bulkComplete();
      return;
    }
    playCompleteChime();

    // Check the box, then let the row slowly glide to the side and fade out;
    // its height collapses afterward (CSS-delayed) so the tasks below ease up
    // into place. We pin the current height first so that collapse has a
    // from-value to animate from.
    animEl.querySelector('.task-cb')?.classList.add('checked');
    const h = animEl.offsetHeight;
    animEl.style.height = `${h}px`;
    void animEl.offsetHeight; // force reflow so the collapse animates from full height
    animEl.classList.add('completing');
    requestAnimationFrame(() => {
      animEl.style.height = '0px';
      animEl.style.marginTop = '0px';
      animEl.style.marginBottom = '0px';
      animEl.style.paddingTop = '0px';
      animEl.style.paddingBottom = '0px';
    });
    this.completingIds.add(task.id); // renders hide it while the write is pending

    // FOLDER, SIMULTANEOUS DISSOLVE: if this check-off finishes its folder, the
    // folder goes in the same breath — its block collapses alongside the row and
    // the record is removed NOW (per Gabe: zero seconds between task and folder).
    // The write below still lands at 820ms; the completingIds guard keeps the
    // resurrection check from "rescuing" the folder in that window, while a real
    // Undo (which un-completes with a write) restores folder AND task together.
    const folder = this.liveFolder(task);
    let dissolvedFolderName: string | null = null; // folds into the undo toast below (ONE toast, not two)
    if (folder && folderMembers(folder, this.map).every((m) => m.completed || m.id === task.id)) {
      // List mode: the row lives inside its folder block. Calendar mode: the row
      // is a floating popover, so find the block by the folder's id instead.
      const block =
        [...this.listEl.querySelectorAll('.task-folder')].find((n) => n.contains(animEl)) ??
        this.listEl.querySelector(`.task-folder[data-folder-id="${folder.id}"]`);
      if (block instanceof HTMLElement) collapseFolderBlock(block);
      this.folders = this.folders.filter((f) => f !== folder);
      this.openFolders.delete(folder.id);
      this.recentlyDissolved.set(folder.id, { folder, at: Date.now() });
      void saveTaskFolders(this.data, this.folders);
      dissolvedFolderName = folder.name; // announced inside the undo toast, not as a second one
    }

    // Commit completion only after the full slide-out + collapse (~0.8s) so the
    // re-render that drops the row never interrupts the animation mid-glide.
    const completeTimer = window.setTimeout(() => {
      void Promise.resolve(
        this.save({ ...task, completed: true, completedAt: new Date().toISOString() })
      ).finally(() => this.completingIds.delete(task.id));
    }, 820);

    const name = task.title.length > 38 ? task.title.slice(0, 38).trimEnd() + '…' : task.title;
    // ONE toast for the whole event (per Gabe): task gone — and, when this
    // check-off finished its folder, the folder's fate rides along. Undo
    // restores both (the un-complete write resurrects the folder).
    const message = dissolvedFolderName
      ? `“${name}” Task Deleted · 📁 “${dissolvedFolderName}” dissolved`
      : `“${name}” Task Deleted`;
    // Completed tasks are retained (hidden) so the daily lightbulb can measure
    // progress; they're purged automatically once the day rolls over. Undo
    // simply un-completes; letting the toast expire keeps it done. Cancelling the
    // pending commit first prevents a fast undo (within the ~0.8s window) from
    // being clobbered by the timer that would otherwise still mark it done.
    showUndoToast(
      message,
      () => {
        clearTimeout(completeTimer);
        this.completingIds.delete(task.id);
        this.save({ ...task, completed: false, completedAt: null });
        // The un-complete write triggers folderMaintenance, whose resurrection
        // path restores a just-dissolved folder along with this task.
      },
      () => {},
      this.sample?.host // landing preview → keep the toast inside the device frame
    );
  }

  // --- inline edits (double-click) ----------------------------------------

  private inlineEdit(host: HTMLElement, initial: string, commit: (value: string) => void): void {
    this.data.setRenderLocked(true);
    // Every inline editor (title, course, date) hugs its text at the text's own
    // on-screen size — no dilation, no row-wide box. Metrics are copied while the
    // host is still connected; the width sizer runs once the editor is.
    const input = textInput({ class: 'inline-edit-block', value: initial });
    copyTextMetrics(input, host);
    host.replaceWith(input);
    autoWidthToText(input);
    // autoWidthToText widens the box to fit the text on each keystroke; re-fit the
    // HEIGHT after that width settles, or it's measured at the pre-widen width and
    // the box bounces a line taller/shorter while typing (same fix as the focus
    // editor — this listener runs after the width one, so the order is right).
    input.addEventListener('input', () => input.rewrap());
    // Focus AFTER this event settles. A real double-click's native word-selection runs
    // as the event's default action; if we focus synchronously, a <textarea> gets blurred
    // by it and the blur handler instantly commits + re-renders — so the editor flashes
    // and never opens. A microtask runs after the default action, so focus sticks.
    queueMicrotask(() => {
      input.focus();
      input.select();
    });
    let done = false;
    const finish = (apply: boolean) => {
      if (done) return;
      done = true;
      this.data.setRenderLocked(false);
      const value = input.value.trim();
      // Only commit when the value actually changed — pressing away (blur) with no
      // edit must preserve the existing value, never re-parse/clear it.
      if (apply && value !== initial.trim()) commit(value);
      this.render();
    };
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') finish(true);
      if (e.key === 'Escape') finish(false);
      // Editors hosted inside a <button> (folder heads): the spacebar's default
      // action is the BUTTON's activation — the space never types, and the
      // key-release "click" toggles the head, killing the editor mid-word.
      // Take the key over: cancel the activation, insert the space ourselves.
      if (e.key === ' ') {
        e.preventDefault();
        e.stopPropagation();
        input.setRangeText(' ', input.selectionStart ?? input.value.length, input.selectionEnd ?? input.value.length, 'end');
        input.dispatchEvent(new Event('input', { bubbles: true })); // re-run width/height fitters
      }
    });
    input.addEventListener('blur', () => finish(true));
  }

  private editTitle(task: Task, host: HTMLElement): void {
    this.inlineEdit(host, task.title, (v) => {
      if (!v) return;
      // New title → drop the old translation and re-check it on the next pass.
      this.save({
        ...task,
        title: v,
        _manualTitle: true,
        translatedTitle: '',
        translatedLang: '',
        translationChecked: false,
      });
    });
  }

  private editDateTime(task: Task, host: HTMLElement): void {
    // One editor for both: shows "M/D h:mma" (or just "M/D" when there's no time).
    // Blur preserves; clearing the box deletes the date. A time is written only
    // when one is typed — iCal tasks keep their time, timeless ones stay timeless.
    const initial = task.dueDate
      ? task.dueTime
        ? `${formatShortDate(task.dueDate)} ${this.fmtTime(task.dueTime)}`
        : formatShortDate(task.dueDate)
      : '';
    this.inlineEdit(host, initial, (v) => {
      const { date, time } = parseDateTime(v);
      this.save({ ...task, dueDate: date, dueTime: time, timeLabel: '', _manualDueDate: true });
    });
  }

  private editCourse(task: Task, host: HTMLElement): void {
    this.inlineEdit(host, task.course, (v) => {
      const course = v ? matchCourseStrict(v) : ''; // '' → renders "+ course"
      this.save({ ...task, course, _manualCourse: true });
      // Layer 3 "Help our AI": reinforce the learned model with the words/phrases
      // of this assignment so the same kind auto-tags (confidently) next time.
      if (course) void learnCorrection(task.title, task.details || '', course);
    });
  }

  // --- translation --------------------------------------------------------

  /**
   * Background pass: read every not-yet-checked title through the translator,
   * which detects the language and translates anything that isn't English. The
   * result is stored ON the task (so every copy, including Focus todos, gets it
   * and it's never re-fetched). Runs after each task update; self-guards against
   * re-entry, throttles to be polite to the endpoint, and stops on the first
   * network error (retries on the next update) so it never hammers.
   */
  private async autoTranslatePass(): Promise<void> {
    if (this.autoTx) return;
    const pending = Object.values(this.map).filter(
      (t) => t.title && !t.completed && !t.translationChecked
    );
    if (!pending.length) return;

    this.autoTx = true;
    const results: Array<{ id: string; title: string; translatedTitle: string; translatedLang: string }> = [];
    try {
      for (const t of pending) {
        const r = await analyzeTitle(t.title);
        if (r.status === 'error') break; // offline / rate-limited → stop; retry next update
        results.push({
          id: t.id,
          title: t.title,
          translatedTitle: r.status === 'foreign' ? r.text : '',
          translatedLang: r.status === 'foreign' ? r.sourceLang : '',
        });
        await new Promise((res) => setTimeout(res, 150)); // gentle throttle
      }
    } finally {
      this.autoTx = false;
      // Merge onto the CURRENT tasks (skip any edited/removed mid-pass) and write once.
      const writes = results
        .map((r) => {
          const cur = this.map[r.id];
          if (!cur || cur.title !== r.title) return null;
          return {
            ...cur,
            translatedTitle: r.translatedTitle,
            translatedLang: r.translatedLang,
            translationChecked: true,
          } as Task;
        })
        .filter((t): t is Task => t !== null);
      if (writes.length) await this.data.putTasksBulk(writes);
    }
  }

  // --- popups -------------------------------------------------------------

  private popup(title: string, build: (body: HTMLElement, close: () => void) => void): void {
    const backdrop = el('div', { class: 'popup-backdrop' });
    const box = el('div', { class: 'popup' });
    box.append(el('h3', { text: title }));
    const body = el('div', { class: 'popup-body' });
    box.append(body);
    // Every popup (folder picker, priority, attachments, details) shares ONE
    // width — drag the right edge once and they all remember it. Width is the
    // pinch here, not height: long folder names and URLs are what get squeezed.
    box.append(makeWidthGrip({ box, storageKey: 'ws:popupWidth' }));
    backdrop.append(box);
    (this.sample?.host ?? document.body).append(backdrop);
    const close = () => backdrop.remove();
    backdrop.addEventListener('click', (e) => {
      if (e.target === backdrop) close();
    });
    build(body, close);
  }

  private openDetails(task: Task): void {
    this.popup(task.title, (body, close) => {
      body.append(linkifyText(task.details || '', 'task-details-text'));
      if (task.schoologyUrl) {
        const open = el('button', { class: 'btn-primary', text: 'Open in Schoology' });
        open.addEventListener('click', () => {
          this.openExt(task.schoologyUrl!);
          close();
        });
        body.append(open);
      }
    });
  }

  private openPriority(task: Task): void {
    this.popup('Priority', (body, close) => {
      for (const p of PRIORITIES) {
        const opt = el('button', { class: 'priority-option' });
        opt.append(el('span', { class: 'arrow', text: p.arrow }), el('span', { text: p.label }));
        (opt.firstChild as HTMLElement).style.color = p.color;
        opt.addEventListener('click', () => {
          // Acting on a selected row sets the priority on the WHOLE selection.
          const targets = this.selTargets(task);
          if (targets.length > 1) {
            void this.data.putTasksBulk(targets.map((t) => ({ ...t, priority: p.key as Priority })));
          } else {
            this.save({ ...task, priority: p.key as Priority });
          }
          close();
        });
        body.append(opt);
      }
    });
  }

  private openAttachments(task: Task): void {
    this.popup('Attachments', (body, close) => {
      const notes = (task.notes ?? []).map((n) => ({ ...n }));
      const editing = new Set<string>(); // note ids currently shown as editable inputs
      const list = el('div', { class: 'attach-list' });

      // Display: a compact bookmark-style card — badge + title + domain, click to
      // open. Edit/delete icons sit to the right.
      const displayCard = (n: typeof notes[number], idx: number): HTMLElement => {
        const item = el('div', { class: 'attach-item' });
        const type = detectAttachmentType(n.url);

        const main = el('button', { class: 'attach-open', title: n.url || 'Open' });
        const badge = el('span', { class: 'attach-badge', text: type.label });
        badge.style.background = type.color;
        const labels = el('div', { class: 'attach-labels' });
        labels.append(
          el('span', { class: 'attach-title', text: n.title || n.url || 'Untitled link' }),
          el('span', { class: 'attach-domain', text: attachmentDomain(n.url) })
        );
        main.append(badge, labels);
        main.addEventListener('click', () => {
          if (n.url.trim()) this.openExt(n.url);
        });

        const edit = el('button', { class: 'attach-iconbtn', text: '✎', title: 'Edit' });
        edit.addEventListener('click', () => {
          editing.add(n.id);
          draw();
        });
        const del = el('button', { class: 'attach-iconbtn danger', text: '✕', title: 'Delete' });
        del.addEventListener('click', () => {
          notes.splice(idx, 1);
          draw();
        });

        item.append(main, edit, del);
        return item;
      };

      // Edit: labeled Name + URL fields stacked full-width (mirrors the Bookmarks
      // add-link modal), with plain-English Remove / Done buttons below.
      const editCard = (n: typeof notes[number], idx: number): HTMLElement => {
        const item = el('div', { class: 'attach-item editing' });
        const fields = el('div', { class: 'attach-fields' });
        const titleI = textInput({ class: 'attach-input', placeholder: 'Name', value: n.title });
        const urlI = textInput({ class: 'attach-input', placeholder: 'URL', value: n.url });
        titleI.addEventListener('input', () => (notes[idx].title = titleI.value));
        urlI.addEventListener('input', () => (notes[idx].url = urlI.value));
        fields.append(
          el('div', { class: 'attach-field-label', text: 'Name' }),
          titleI,
          el('div', { class: 'attach-field-label', text: 'URL' }),
          urlI
        );

        const actions = el('div', { class: 'attach-edit-actions' });
        const remove = el('button', { class: 'attach-remove', text: 'Remove' });
        remove.addEventListener('click', () => {
          notes.splice(idx, 1);
          editing.delete(n.id);
          draw();
        });
        const done = el('button', { class: 'attach-done', text: 'Done' });
        done.addEventListener('click', () => {
          editing.delete(n.id);
          draw();
        });
        actions.append(remove, done);

        item.append(fields, actions);
        requestAnimationFrame(() => titleI.focus());
        return item;
      };

      const draw = () => {
        list.replaceChildren();
        if (!notes.length) list.append(el('div', { class: 'attach-empty', text: 'No links yet.' }));
        notes.forEach((n, idx) => list.append(editing.has(n.id) ? editCard(n, idx) : displayCard(n, idx)));
      };
      draw();

      const addBtn = el('button', { class: 'attach-add', text: '+ Add link' });
      addBtn.addEventListener('click', () => {
        const id = 'n_' + genId();
        notes.push({ id, title: '', url: '' });
        editing.add(id); // new links open straight into edit mode
        draw();
      });

      const footer = el('div', { class: 'attach-footer' });
      const openAllBtn = el('button', { class: 'btn-primary', text: 'Open all' });
      openAllBtn.addEventListener('click', () => {
        if (!this.sample) openAll(notes);
      });
      const saveBtn = el('button', { class: 'btn-primary', text: 'Save' });
      saveBtn.addEventListener('click', () => {
        const cleaned = notes
          .filter((n) => n.url.trim())
          .map((n) => ({ ...n, url: normalizeUrl(n.url), title: n.title.trim() || n.url }));
        this.save({ ...task, notes: cleaned });
        close();
      });
      footer.append(openAllBtn, saveBtn);

      body.append(list, addBtn, footer);
    });
  }
}

/** Build a text block where any http(s) URL is a real, clickable link (new tab)
 *  instead of inert text — used by the ⓘ Description popup. Built with DOM nodes
 *  (never innerHTML), so the surrounding description text can't inject markup. */
function linkifyText(text: string, cls: string): HTMLElement {
  const box = el('div', { class: cls });
  let last = 0;
  for (const m of text.matchAll(/https?:\/\/\S+/g)) {
    const start = m.index ?? 0;
    // Trailing punctuation is almost always the sentence's, not the URL's.
    const url = m[0].replace(/[.,;:!?)\]]+$/, '');
    if (start > last) box.append(text.slice(last, start));
    box.append(el('a', { href: url, target: '_blank', rel: 'noopener', text: url }));
    last = start + url.length;
  }
  box.append(text.slice(last));
  return box;
}

/** Bare domain for an attachment URL ("https://www.desmos.com/…" → "desmos.com"). */
function attachmentDomain(url: string): string {
  const u = url.trim();
  if (!u) return '';
  try {
    return new URL(/^https?:\/\//i.test(u) ? u : 'https://' + u).hostname.replace(/^www\./, '');
  } catch {
    return '';
  }
}
