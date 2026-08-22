// Cobalt: the 🗄 Task Archives screen (a full tab, like Settings and the bell).
//
// WHERE FINISHED WORK GOES. Checking a task off takes it out of the list, and until
// now the next morning's first load deleted it outright — so a term's work simply
// evaporated, and a task checked off by mistake was gone for good. This screen is
// the other half of that: every completed task, newest first, each with a Restore
// that puts it back on the list and a Delete that ends it for good, plus one
// "Delete all" for when the student wants the slate clean.
//
// A ROW HERE IS THE TASK, NOT A RECEIPT FOR IT (Gabe, 8/21). It carries the same
// things its row in the Tasks list carried: the translation under a foreign title,
// its course, the folder it lived in, its date. Anything less and the archive reads
// as a log of strings rather than the work itself.
//
// It reads the SAME task map every other screen reads (data.watchTasks), so a task
// checked off in Tasks or in a focus session appears here immediately — no separate
// store, nothing to keep in sync. `archived` (set at boot by
// Data.archiveStaleCompleted) is not a filter here: this screen shows everything
// completed, whether it retired last month or thirty seconds ago.

import { el, showToast } from '../util/dom';
import type { Data } from '../db';
import type { Task, TaskFolder, TaskMap } from '../types';
import { getCourseColor } from '../courses/registry';
import { getTaskFolders, FOLDERS_EVENT } from './folders';
import { formatMetaDate, formatWallClock, formatDayHeading } from '../util/dates';
import { languageName } from '../util/translate';
import { confirmDanger } from '../ui/confirm';
import { shiftSelect } from '../util/select';
import { selectionBar, type SelBar } from '../ui/selbar';

const FOLDER_SVG =
  '<svg viewBox="0 0 24 24" width="12" height="12" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

export class TaskArchiveView {
  private host: HTMLElement | null = null;
  private map: TaskMap = {};
  private folders: TaskFolder[] = [];
  private watching = false;
  /** Multi-select, exactly as the Tasks list does it: modifier-click to start one,
   *  Shift to draw a range, then Restore or Delete acts on the whole set. */
  private selectedIds = new Set<string>();
  private selBar: SelBar | null = null;
  /** Visible row order, rebuilt by every draw — what Shift+click measures against. */
  private visIds: string[] = [];

  constructor(private data: Data) {}

  /** Mounted fresh on every visit (the tab uses onShow). The subscriptions are
   *  registered ONCE — mountTabs hands the same panel back each time, and a second
   *  subscription would repaint the screen twice per write. */
  mount(panel: HTMLElement): void {
    const page = el('div', { class: 'arch-page' });
    this.host = page;
    panel.replaceChildren(page);
    this.map = this.data.getTasks();
    if (!this.watching) {
      this.watching = true;
      this.data.watchTasks((u) => {
        this.map = u.tasks;
        // Only when this screen is actually on the page. The subscription outlives
        // the panel, and every task write in the app fires it — rebuilding a
        // detached archive of hundreds of rows on each keystroke-driven save would
        // be pure waste. The next mount() draws from the map we just stored.
        if (this.host?.isConnected) this.draw();
      });
      // Folders are shared with the Tasks tab; a rename there should show here.
      window.addEventListener(FOLDERS_EVENT, () => void this.loadFolders());
      // Escape = deselect, the way out the selection bar advertises. Only while this
      // screen is the one showing, and NOT while a confirm is up: Escape cancels that
      // dialog, and cancelling a bulk delete must leave the selection you were about
      // to act on standing (both handlers are on document, so both would fire).
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !this.selectedIds.size) return;
        if (!this.host?.isConnected || document.querySelector('.confirm-backdrop')) return;
        this.clearSelection();
      });
    }
    this.draw();
    void this.loadFolders(); // async: colors and the legacy name fallback, drawn a beat later
  }

  private async loadFolders(): Promise<void> {
    this.folders = await getTaskFolders(this.data);
    if (this.host?.isConnected) this.draw();
  }

  /** Completed tasks, newest completion first. `completedAt` is the sort key; the
   *  handful of tasks that predate it (or that a restore-then-recomplete left
   *  blank) fall to the bottom rather than being dropped. */
  private entries(): Task[] {
    return Object.values(this.map)
      .filter((t) => t.completed)
      .sort((a, b) => (b.completedAt || '').localeCompare(a.completedAt || ''));
  }

  private draw(): void {
    const host = this.host;
    if (!host) return;
    const tasks = this.entries();
    // Selection follows reality: a row that has been restored or deleted since the
    // last paint is no longer something the buttons can act on.
    const live = new Set(tasks.map((t) => t.id));
    for (const id of [...this.selectedIds]) if (!live.has(id)) this.selectedIds.delete(id);
    this.visIds = tasks.map((t) => t.id);
    host.replaceChildren();

    // Same page head as the Notifications screen: centered title over a one-line
    // purpose, with the destructive button pinned right and OUT of the flow so it
    // can't drag the centered text off-center.
    const head = el('div', { class: 'arch-head' });
    const headText = el('div', { class: 'arch-head-text' });
    headText.append(
      el('div', { class: 'arch-title', text: 'Task Archives' }),
      el('div', {
        class: 'arch-desc',
        text: 'Every task you have checked off, newest first. Restore one to put it back on your list.',
      })
    );
    head.append(headText);
    if (tasks.length) {
      const clear = el('button', { class: 'arch-clear', text: 'Delete all' });
      clear.addEventListener('click', () => this.deleteAll(tasks.length));
      head.append(clear);
    }
    host.append(head);

    if (!tasks.length) {
      const empty = el('div', { class: 'arch-empty' });
      empty.append(
        // VS16 on purpose: bare U+1F5C4 falls back to a thin monochrome glyph on
        // Windows, which reads as a missing character next to the bell's 🔔.
        el('div', { class: 'arch-empty-icon', text: '🗄️' }),
        el('div', { class: 'arch-empty-title', text: 'Nothing archived yet' }),
        el('div', {
          class: 'arch-empty-sub',
          text: 'Tasks you check off collect here instead of disappearing, so nothing is ever lost to a stray click.',
        })
      );
      host.append(empty);
      this.syncSelectionUI();
      return;
    }

    // The same tip the Tasks list carries above its own list, in the same words: a
    // multi-select is invisible until you know the gesture exists.
    host.append(el('div', { class: 'tasks-bulk-tip', text: '💡 Shift+click to select multiple tasks' }));

    // Group by the day it was finished, walking the already-sorted list and
    // emitting a heading whenever the label changes (same shape as the bell log).
    let lastDay = '';
    for (const t of tasks) {
      const at = t.completedAt ? Date.parse(t.completedAt) : NaN;
      const label = Number.isNaN(at) ? 'Earlier' : formatDayHeading(at);
      if (label !== lastDay) {
        lastDay = label;
        host.append(el('div', { class: 'arch-day', text: label }));
      }
      host.append(this.row(t, at));
    }
    this.syncSelectionUI();
  }

  private row(t: Task, at: number): HTMLElement {
    const row = el('div', { class: 'arch-row' });
    row.dataset.taskId = t.id;
    if (this.selectedIds.has(t.id)) row.classList.add('selected');
    row.addEventListener('mousedown', (e) => {
      if (e.shiftKey || e.ctrlKey || e.metaKey) e.preventDefault(); // no text painting
    });
    // CAPTURE PHASE, and the Tasks list learned this the hard way (its comment dates
    // it 8/20). Restore and Delete have their OWN click listeners, which run before
    // the row's — so a shift-click aimed at the row but landing on a button restored
    // the task AND took the selection with it. Intercepting a modifier-held click on
    // the way DOWN settles it first: it is a selection gesture, never a press.
    row.addEventListener(
      'click',
      (e) => {
        if (!(e.ctrlKey || e.metaKey || e.shiftKey)) return;
        e.preventDefault();
        e.stopPropagation(); // the button underneath never hears about it
        this.onRowClick(t, e);
      },
      true
    );
    row.addEventListener('click', (e) => this.onRowClick(t, e));

    row.append(el('div', { class: 'arch-time', text: Number.isNaN(at) ? '—' : formatWallClock(at) }));

    const main = el('div', { class: 'arch-main' });
    const title = t.emoji ? `${t.emoji} ${t.title}` : t.title;
    main.append(el('div', { class: 'arch-row-title', text: title }));

    // THE TRANSLATION COMES WITH IT (Gabe, 8/21). A foreign title is unreadable
    // without it, here as much as in the list — an archive that drops the English
    // line is an archive the student cannot search by eye. Same classes as the
    // Tasks row so the two look like the same thing, and the same 🌐 provenance
    // tooltip; `arch-translation` only adds the finished-work strike.
    if (t.translatedTitle && !t.translationHidden) {
      const tr = el('div', {
        class: `task-translation arch-translation${t.translationChosen ? ' chosen' : ''}`,
        title: t.translationChosen
          ? `You chose to read this as ${languageName(t.translatedLang || '')}`
          : `Translated from ${languageName(t.translatedLang || '')}`,
      });
      tr.append(el('span', { class: 'task-translation-badge', text: '🌐' }));
      tr.append(el('span', { text: t.translatedTitle }));
      main.append(tr);
    }

    // Meta line: course, folder, date. All three optional, in the Tasks list's own
    // order, and the date is bare — "Was due" was a caption on a column that is
    // obviously a date (Gabe, 8/21).
    const meta = el('div', { class: 'arch-meta' });
    if (t.course) {
      // Color only, exactly as the Tasks list styles its .course-chip — the border
      // stays neutral. Tinting it would mean synthesizing an alpha from the stored
      // hex, and the registry's colors are not guaranteed to be a format that
      // string-appending an alpha pair survives.
      const chip = el('span', { class: 'arch-course', text: t.course });
      chip.style.color = getCourseColor(t.course);
      meta.append(chip);
    }
    const folder = this.folderFor(t);
    if (folder) {
      const chip = el('span', { class: 'arch-folder', title: `Was in the “${folder.name}” folder` });
      chip.innerHTML = FOLDER_SVG;
      chip.append(el('span', { text: folder.name }));
      if (folder.color) chip.style.color = folder.color;
      meta.append(chip);
    }
    if (t.dueDate) meta.append(el('span', { class: 'arch-due', text: formatMetaDate(t.dueDate) }));
    if (meta.childElementCount) main.append(meta);

    // Restore over Delete, stacked (Gabe, 8/21): the safe action is the one your
    // eye lands on first, and the destructive one is a deliberate reach downward.
    const actions = el('div', { class: 'arch-actions' });
    const restore = el('button', { class: 'arch-restore', text: 'Restore' });
    restore.addEventListener('click', () => void this.restore(this.targets(t)));
    const del = el('button', { class: 'arch-delete', text: 'Delete' });
    del.addEventListener('click', () => this.deleteTasks(this.targets(t)));
    actions.append(restore, del);

    row.append(main, actions);
    return row;
  }

  /**
   * Which folder to name on a row, and WHY it is not a plain lookup.
   *
   * `folderName` is the name frozen onto the task when it was checked off, and it
   * is preferred because a folder dissolves the moment its last member is
   * completed — so for most archived tasks the id points at nothing. The live list
   * is consulted anyway, for the folder's COLOR (which is not stamped) and as the
   * fallback for tasks completed before the stamp existed.
   */
  private folderFor(t: Task): { name: string; color: string } | null {
    const live = t.folderId ? this.folders.find((f) => f.id === t.folderId) : undefined;
    const name = t.folderName || live?.name || '';
    if (!name) return null;
    return { name, color: live?.color ?? '' };
  }

  // --- selection ----------------------------------------------------------

  /**
   * A click on a row, borrowed verbatim from the Tasks list (onRowClick there):
   * plain clicks do nothing until a selection exists, a modifier always means
   * "select", and Shift draws a range measured from the selection itself.
   */
  private onRowClick(t: Task, e: MouseEvent): void {
    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    // Nobody holds a modifier to press Restore, so an unmodified click on a button
    // is the button's; a modified one is always a selection gesture.
    if (!multi && (e.target as Element).closest('button, a')) return;
    if (!multi && !this.selectedIds.size) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges(); // sweep away any highlight the drag left
    if (e.shiftKey) shiftSelect(this.visIds, this.selectedIds, t.id);
    else if (this.selectedIds.has(t.id)) this.selectedIds.delete(t.id);
    else this.selectedIds.add(t.id);
    this.syncSelectionUI();
  }

  private syncSelectionUI(): void {
    for (const row of this.host?.querySelectorAll<HTMLElement>('.arch-row[data-task-id]') ?? [])
      row.classList.toggle('selected', this.selectedIds.has(row.dataset.taskId!));
    // A selection is invisible state; the bar is how you find your way out of it.
    this.selBar ??= selectionBar('task', () => this.clearSelection());
    this.selBar.update(this.selectedIds.size);
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.syncSelectionUI();
  }

  /** What a row's button acts on: the WHOLE selection when that row is part of one,
   *  just that task otherwise. The Tasks tab's rule (selTargets), same everywhere. */
  private targets(t: Task): Task[] {
    if (this.selectedIds.has(t.id) && this.selectedIds.size > 1)
      return [...this.selectedIds].map((id) => this.map[id]).filter((x): x is Task => !!x);
    return [t];
  }

  // --- actions ------------------------------------------------------------

  /** Put tasks back on the list: un-complete them and lift the archive flag, which
   *  is exactly the state they had before being checked off. Due dates are left
   *  alone — a restored assignment that was due last week IS overdue, and saying so
   *  is the point. ONE write for the batch, never a loop (see putTasksBulk). */
  private async restore(tasks: Task[]): Promise<void> {
    if (!tasks.length) return;
    const back = tasks.map((t) => ({ ...t, completed: false, completedAt: null, archived: false }));
    this.clearSelection();
    if (back.length === 1) await this.data.putTask(back[0]);
    else await this.data.putTasksBulk(back);
    // Same shape of sentence as the check-off toast in tasks/complete.ts
    // ("“name” task completed"), because this is its opposite and should read like it.
    showToast(
      back.length === 1 ? `“${clip(back[0].title)}” task restored` : `${back.length} tasks restored`
    );
  }

  /** Delete for good. Red confirm every time, however few: this is the one thing on
   *  the screen that cannot be taken back. */
  private deleteTasks(tasks: Task[]): void {
    if (!tasks.length) return;
    const n = tasks.length;
    const what = n === 1 ? `“${clip(tasks[0].title)}”` : `${n} tasks`;
    confirmDanger(
      `Delete ${what} for good? This cannot be undone.`,
      () => {
        this.clearSelection();
        void this.data.removeTasksBulk(tasks.map((t) => t.id));
        showToast(n === 1 ? `${what} deleted` : `${n} tasks deleted`);
      },
      'Delete'
    );
  }

  /** Empty the archive.
   *
   *  `n` is the count as the button was drawn, which is what the question is about.
   *  WHAT gets deleted is re-read when the answer comes back, because the archive is
   *  live: a task checked off in another window while the dialog stands would
   *  otherwise be the one row left behind by a button that says "Delete all". */
  private deleteAll(n: number): void {
    confirmDanger(
      `Delete all ${n} archived task${n === 1 ? '' : 's'}? This cannot be undone.`,
      () => {
        const doomed = this.entries();
        if (!doomed.length) return;
        this.clearSelection();
        void this.data.removeTasksBulk(doomed.map((t) => t.id));
        showToast(`${doomed.length} archived task${doomed.length === 1 ? '' : 's'} deleted`);
      },
      'Delete all'
    );
  }
}

/** A title short enough to sit inside a toast or a one-line question. */
function clip(title: string): string {
  return title.length > 38 ? title.slice(0, 38).trimEnd() + '…' : title;
}
