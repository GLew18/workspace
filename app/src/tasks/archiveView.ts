// Cobalt: the 🗄 Task Archives screen (a full tab, like Settings and the bell).
//
// WHERE FINISHED WORK GOES. Checking a task off takes it out of the list, and until
// now the next morning's first load deleted it outright — so a term's work simply
// evaporated, and a task checked off by mistake was gone for good. This screen is
// the other half of that: every completed task, newest first, each with a Restore
// that puts it back on the list and a Delete that ends it for good, plus one
// "Delete all" for when the student wants the slate clean.
//
// A ROW HERE IS THE TASK, NOT A RECEIPT FOR IT (Gabe, 8/21). It is drawn with the
// Tasks list's own markup and its own CSS classes — the translation under a foreign
// title, the course in its color, the interpunct, the date — so the two cannot look
// like different things. See the note on the markup in row() for what is deliberately
// added and removed.
//
// It reads the SAME task map every other screen reads (data.watchTasks), so a task
// checked off in Tasks or in a focus session appears here immediately — no separate
// store, nothing to keep in sync. `archived` (set at boot by
// Data.archiveStaleCompleted) is not a filter here: this screen shows everything
// completed, whether it retired last month or thirty seconds ago.

import { el } from '../util/dom';
// The SAME undo toast the Tasks tab uses to check a task off: one toast slot
// app-wide, offered for UNDO_MS. Restoring and deleting here are the same kind of
// act and get the same way out. NOTE what onExpire is and is not for: see the long
// note on beginDelete.
import { showUndoToast, UNDO_MS } from './complete';
import type { Data } from '../db';
import type { Task, TaskMap } from '../types';
import { getCourseColor } from '../courses/registry';
import { formatMetaDate, formatTimeOfDay, formatWallClock, formatDayHeading } from '../util/dates';
import { languageName } from '../util/translate';
import { confirmDanger } from '../ui/confirm';
import { openPopup } from '../ui/popup';
import { buildFeedDiff, hasFeedDiff } from './feedDiff';
// The ↗ glyph and the description linkifier are the Tasks row's own, imported
// rather than copied for the same reason the row's CSS classes are (see row()).
import { SCHOOLOGY_SVG, linkifyText } from './render';
import { openAttachment } from './attachments';
import { BADGE_ASSESSMENT_RE } from '../schoology/ical';
import { shiftSelect } from '../util/select';
import { selectionBar, type SelBar } from '../ui/selbar';

export class TaskArchiveView {
  private host: HTMLElement | null = null;
  private map: TaskMap = {};
  private watching = false;
  /** Multi-select, exactly as the Tasks list does it: modifier-click to start one,
   *  Shift to draw a range, then Restore or Delete acts on the whole set. */
  private selectedIds = new Set<string>();
  private selBar: SelBar | null = null;
  /** Visible row order, rebuilt by every draw — what Shift+click measures against. */
  private visIds: string[] = [];
  /** Deleted on screen, not yet deleted for real: the undo window is still open.
   *  See beginDelete. Held in memory on purpose, so a reload cancels rather than
   *  commits. */
  private pendingDelete = new Set<string>();

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
      // Escape = deselect, the way out the selection bar advertises. Only while this
      // screen is the one showing, and NOT while a confirm is up: Escape cancels that
      // dialog, and cancelling a bulk delete must leave the selection you were about
      // to act on standing (both handlers are on document, so both would fire).
      document.addEventListener('keydown', (e) => {
        if (e.key !== 'Escape' || !this.selectedIds.size) return;
        if (!this.host?.isConnected || document.querySelector('.bm-backdrop.confirm-danger')) return;
        this.clearSelection();
      });
    }
    this.draw();
  }

  /** Completed tasks, newest completion first. `completedAt` is the sort key; the
   *  handful of tasks that predate it (or that a restore-then-recomplete left
   *  blank) fall to the bottom rather than being dropped. */
  private entries(): Task[] {
    return Object.values(this.map)
      .filter((t) => t.completed && !this.pendingDelete.has(t.id))
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

    /**
     * THE REAL ROW'S OWN CLASSES, NOT A LIKENESS OF THEM (Gabe, 8/22).
     *
     * "Since these were tasks, their views should match the real task UI identically
     * besides features we explicitly added or removed." The first draft styled its
     * own `.arch-course` / `.arch-due` and drifted immediately: the course came out
     * as a bordered pill and the date wore a "Was due" caption, neither of which the
     * Tasks list does. So the markup below is `.task-info` → `.task-title` →
     * `.task-bottom-row` → `.task-meta-wrap` → `.task-meta` → `.course-chip` ·
     * `.meta-date`, copied structure for structure from buildRow in tasks/render.ts
     * and styled by that same CSS. There is nothing left for the two to disagree
     * about, and a later change to the task row lands here for free.
     *
     * WHAT IS DELIBERATELY ABSENT, and every one of them is an EDIT rather than a
     * view: the checkbox, the ⋮⋮ handle, the priority arrow, the ⋯ menu, click-to-edit
     * on the course and date, the "+ course" / "+ due date" prompts that exist only
     * to open those editors, the ✕ that dismisses the assessment pill and the click
     * that dismisses the ✱. Plus the OVR badge, because nothing finished is overdue.
     * WHAT IS ADDED: the completion-time gutter, and Restore / Delete.
     *
     * Everything the row can SAY, it still says: the ✱ change mark, the translation,
     * the course, the date, the QUIZ/TEST pill, and the two read-only doors back to
     * Schoology (↗ the assignment, ⓘ its instructions). Rereading what a finished
     * assignment actually asked for is a thing students do.
     */
    const main = el('div', { class: 'task-info' });
    const titleEl = el('div', { class: 'task-title', text: t.title });
    // ✱ = a Schoology re-sync altered this task after it was imported. Read-only
    // here: in the list a click means "I have read them", and there is nothing left
    // to read them FOR once the work is done.
    // Same gate as the Tasks row: a change that was undone leaves nothing to read.
    if (t.feedUpdated && hasFeedDiff(t)) {
      const what = Array.isArray(t.feedUpdated) && t.feedUpdated.length
        ? t.feedUpdated.join(', ')
        : 'name, date, or instructions';
      const upd = el('span', {
        class: 'task-altered-badge',
        text: '✱',
        title: `Changed on Schoology since import: ${what}. Click to see what changed`,
      });
      // Opens the same before/after the Tasks row opens, WITHOUT the "Got it" that
      // clears it: dismissing is an edit, and there is nothing left to act on once
      // the work is done. Reading what changed is still worth doing.
      upd.addEventListener('click', (ev) => {
        ev.stopPropagation();
        openPopup('What changed on Schoology', (b) =>
          b.append(
            buildFeedDiff(t) ??
              el('div', { class: 'fd-note', text: 'This task changed, but the earlier version was not recorded.' })
          )
        );
      });
      titleEl.append(upd);
    }
    main.append(titleEl);

    // THE TRANSLATION COMES WITH IT (Gabe, 8/21). A foreign title is unreadable
    // without it, here as much as in the list — an archive that drops the English
    // line is an archive the student cannot search by eye.
    if (t.translatedTitle && !t.translationHidden) {
      const tr = el('div', {
        class: `task-translation${t.translationChosen ? ' chosen' : ''}`,
        title: t.translationChosen
          ? `You chose to read this as ${languageName(t.translatedLang || '')}`
          : `Translated from ${languageName(t.translatedLang || '')}`,
      });
      tr.append(el('span', { class: 'task-translation-badge', text: '🌐' }));
      tr.append(el('span', { text: t.translatedTitle }));
      main.append(tr);
    }

    // The bottom row: COURSE · DATE and the QUIZ/TEST pill on the left, the two
    // Schoology doors on the right. Same element, same order, same classes as the
    // Tasks list. Course and date are simply omitted when empty rather than showing
    // the "+ course" / "+ due date" prompts, which are doors to editors this screen
    // does not have.
    const bottom = el('div', { class: 'task-bottom-row' });
    const metaWrap = el('div', { class: 'task-meta-wrap' });
    const meta = el('div', { class: 'task-meta' });
    if (t.course) {
      const chip = el('span', { class: 'course-chip', text: t.course });
      chip.style.color = getCourseColor(t.course);
      meta.append(chip);
    }
    // `dueDate || dueTime`, the live row's own test rather than a tighter one of my
    // own: the two travel together on every write path today, and copying the test
    // exactly is what keeps that from mattering if one day one of them does not.
    if (t.dueDate || t.dueTime) {
      if (t.course) meta.append(el('span', { class: 'meta-dot', text: '·' }));
      const when = [t.dueDate ? formatMetaDate(t.dueDate) : '', t.dueTime ? formatTimeOfDay(t.dueTime) : '']
        .filter(Boolean)
        .join(' ');
      meta.append(el('span', { class: 'meta-date', text: when }));
    }
    metaWrap.append(meta);
    // QUIZ / TEST / EXAM, re-derived from the title exactly as the list derives it:
    // imported tasks only, the translation may speak for it unless the student hid
    // that translation, and a dismissed pill stays dismissed.
    const assess =
      t.source === 'manual'
        ? null
        : BADGE_ASSESSMENT_RE.exec(t.title) ||
          (t.translatedTitle && !t.translationHidden ? BADGE_ASSESSMENT_RE.exec(t.translatedTitle) : null);
    if (assess && !t.assessmentDismissed) {
      const word = assess[1].toLowerCase();
      const label = (word === 'quizzes' ? 'quiz' : word.replace(/s$/, '')).toUpperCase();
      metaWrap.append(el('span', { class: 'task-test-badge', text: label }));
    }
    bottom.append(metaWrap);

    // ↗ the assignment on Schoology, ⓘ the instructions it came with. The only two
    // controls from the real row that survive here, because they are the only two
    // that READ rather than change.
    if (t.schoologyUrl || t.details) {
      const links = el('div', { class: 'task-actions' });
      if (t.schoologyUrl) {
        const link = el('button', { class: 'act-schoology', title: 'Open in Schoology' });
        link.innerHTML = SCHOOLOGY_SVG;
        link.addEventListener('click', () => openAttachment(t.schoologyUrl!));
        links.append(link);
      }
      if (t.details) {
        const info = el('button', { title: 'Description', text: 'ⓘ' });
        info.addEventListener('click', () =>
          openPopup(t.title, (b) => {
            b.append(linkifyText(t.details || '', 'task-details-text'));
            // AND ITS TRANSLATION, for the same reason the title's comes along: a
            // foreign-language description is unreadable without it, and the
            // instructions are the part that actually had to be understood.
            // READ-ONLY, like everything else in here. No language buttons and no
            // "change language": the row's controls are the ones that READ, and
            // re-answering a question about finished work is not a thing to offer.
            if (t.detailsTranslated && !t.detailsHidden) {
              const tr = el('div', {
                class: `task-translation${t.detailsChosen ? ' chosen' : ''}`,
                title: t.detailsChosen
                  ? `You chose to read this as ${languageName(t.detailsLang || '')}`
                  : `Translated from ${languageName(t.detailsLang || '')}`,
              });
              tr.append(el('span', { class: 'task-translation-badge', text: '🌐' }));
              tr.append(linkifyText(t.detailsTranslated, 'task-details-text'));
              b.append(tr);
            }
          })
        );
        links.append(info);
      }
      bottom.append(links);
    }
    // A row with no course, no date, no pill and no links has an empty bottom row,
    // and an empty flex strip still costs its margin. Only append it when it says
    // something.
    if (meta.childElementCount || metaWrap.childElementCount > 1 || bottom.childElementCount > 1) {
      main.append(bottom);
    }

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

  /**
   * Put tasks back on the list: un-complete them and lift the archive flag, which
   * is exactly the state they had before being checked off. Due dates are left
   * alone — a restored assignment that was due last week IS overdue, and saying so
   * is the point. ONE write for the batch, never a loop (see putTasksBulk).
   *
   * WRITTEN IMMEDIATELY, then offered back (Gabe, 8/22). A restore is not
   * destructive, so there is no reason to make the student wait five seconds to see
   * the task reappear in Tasks. Undo writes the ORIGINAL objects back verbatim —
   * not "complete it again", which would stamp a new completedAt and move the row
   * to the top of today. Taking something back should leave no trace that it
   * happened.
   */
  private async restore(tasks: Task[]): Promise<void> {
    if (!tasks.length) return;
    const before = tasks.map((t) => ({ ...t })); // the exact rows to put back on Undo
    const back = tasks.map((t) => ({ ...t, completed: false, completedAt: null, archived: false }));
    this.clearSelection();
    if (back.length === 1) await this.data.putTask(back[0]);
    else await this.data.putTasksBulk(back);
    // Same shape of sentence as the check-off toast in tasks/complete.ts
    // ("“name” task completed"), because this is its opposite and should read like it.
    showUndoToast(
      back.length === 1 ? `“${clip(back[0].title)}” task restored` : `${back.length} tasks restored`,
      () => {
        if (before.length === 1) void this.data.putTask(before[0]);
        else void this.data.putTasksBulk(before);
      },
      () => {} // letting it expire simply keeps the restore
    );
  }

  /**
   * Delete for good, after a red confirm AND a five-second stay of execution.
   *
   * THE ROWS GO FIRST AND THE DATA GOES LAST (Gabe, 8/22). Nothing is removed when
   * you press Yes: the ids join `pendingDelete`, the rows vanish from the redraw,
   * and the real `removeTasksBulk` only runs when the undo toast expires. So Undo
   * is not a resurrection, it is a cancellation — the tasks were never gone, which
   * is the only version of undo that cannot fail halfway.
   *
   * The toast lives on <body>, so switching tabs mid-window does NOT cancel
   * anything: it keeps counting and commits on schedule, and Undo stays reachable
   * the whole time. What does cancel it is a RELOAD, which takes the timer and this
   * in-memory set with it and leaves the tasks untouched. That is the right
   * direction to fail in, and it is why the pending set is not stored on the task.
   */
  private deleteTasks(tasks: Task[]): void {
    if (!tasks.length) return;
    const n = tasks.length;
    const what = n === 1 ? `“${clip(tasks[0].title)}”` : `${n} tasks`;
    confirmDanger(
      // "Delete X for good? This cannot be undone once the toast expires" argued
      // with itself: the opening said permanent, the rest said not yet. One claim
      // per sentence, and it is the WARNING half that gets said (Gabe, 8/22) —
      // a red dialog is there to be cautionary, not to reassure.
      `Delete ${what}? You can’t undo this after the toast expires.`,
      () => this.beginDelete(tasks),
      'Delete'
    );
  }

  /**
   * The shared body of both delete paths: hide now, commit on a timer, cancel
   * outright on Undo.
   *
   * THE WRITE RUNS ON ITS OWN TIMER, NOT ON THE TOAST'S onExpire, and that is the
   * whole point of this method's shape. There is ONE toast slot in the app, and a
   * new toast ENDS the old one early by calling its expire callback (claimToastSlot
   * in util/dom.ts). So a delete parked in onExpire committed the instant anything
   * else toasted: delete one task, press Restore on another, and the first was gone
   * for real about half a second into a window the confirm had just promised. The
   * check-off path solved this before us and is the pattern being copied here
   * (complete() in tasks/render.ts): the real write is its own setTimeout, Undo
   * clears it, and onExpire does nothing at all. Losing the toast early then costs
   * the button, not the data.
   */
  private beginDelete(tasks: Task[]): void {
    const ids = tasks.map((t) => t.id);
    const n = ids.length;
    this.clearSelection();
    for (const id of ids) this.pendingDelete.add(id);
    this.draw(); // the rows leave immediately, as if they were already gone
    const commit = window.setTimeout(() => {
      for (const id of ids) this.pendingDelete.delete(id);
      // STILL COMPLETED? A restore or a Schoology re-sync can land inside the
      // window, and deleting by id alone would throw that away. Anything that came
      // back to life in the last five seconds is left alone.
      const doomed = ids.filter((id) => this.map[id]?.completed);
      if (doomed.length) void this.data.removeTasksBulk(doomed);
    }, UNDO_MS);
    showUndoToast(
      n === 1 ? `“${clip(tasks[0].title)}” deleted` : `${n} tasks deleted`,
      () => {
        window.clearTimeout(commit); // nothing was deleted; nothing will be
        for (const id of ids) this.pendingDelete.delete(id);
        this.draw();
      },
      () => {} // the timer above owns the write, precisely so this cannot
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
      // Same sentence as the single delete, deliberately: two phrasings for the same
      // class of action is how a student learns to read one of them and not the
      // other. "all 1 archived task" is sidestepped rather than pluralized around.
      `${n === 1 ? 'Delete the one archived task' : `Delete all ${n} archived tasks`}? You can’t undo this after the toast expires.`,
      () => {
        const doomed = this.entries();
        if (doomed.length) this.beginDelete(doomed);
      },
      'Delete all'
    );
  }
}

/** A title short enough to sit inside a toast or a one-line question. */
function clip(title: string): string {
  return title.length > 38 ? title.slice(0, 38).trimEnd() + '…' : title;
}
