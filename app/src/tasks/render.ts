// Cobalt: Tasks tab view (spec §6.6).
//
// TASK-ROW ACTIONS (Gabe, 8/13). ↗ Schoology and ⓘ description are always on the
// row: they are the two a student actually presses, and Cobalt showing the real
// description is why it can stand in for Schoology rather than just linking to it.
// Every other control is OPTIONAL and lives behind the row's "…" unless it earns
// its slot by having content behind it (a translation, an attachment, a folder),
// or the student pins it there. See rowActions / openMoreMenu.

import type { Task, TaskMap, Priority, ParsedTask, TaskFolder } from '../types';
import type { Data, TasksUpdate } from '../db';
import { el, textInput, copyTextMetrics, autoWidthToText, showToast } from '../util/dom';
import { extensionActive } from '../bookmarks/shortcuts';
import { popupGuideButton } from '../ui/popupGuide';
import { attachColorPicker } from '../ui/colorPicker';
import { openPopup } from '../ui/popup';
import { buildFeedDiff, hasFeedDiff } from './feedDiff';
import {
  TITLE_SLOT, DETAILS_SLOT, TX_SLOTS, verifySample,
  txText, txTranslated, txLang, txChecked, txHidden, txAmbiguous, txChosen,
  txDetected, txRuledOut, txOptions, txVerifiedFor, txWrite,
  type TxSlot,
} from './txSlot';
import { formatMetaDate, formatShortDate, formatTimeOfDay, formatDate, todayStr } from '../util/dates';
import { getPrefs, setPrefsCache, PREFS_EVENT, type AppPrefs, type PinnedAction } from '../prefs';
import { genId } from '../util/ids';
import { buildQuickAdd } from './quickadd';
import { makeTask, duplicateTask, clearTranslation, groupTasks, dueBadge, sortTasks, type TaskGroup } from './store';
import { PRIORITIES, priorityDef } from './priorities';
import { getCourseColor, onRegistryChange, matchCourseStrict } from '../courses/registry';
import { classifyByRules, learnCorrection } from '../schoology/classify';
import { recordManualLabelForTask } from '../schoology/extension';
import { BADGE_ASSESSMENT_RE } from '../schoology/ical';
import { parseDateTime, isPastDate, PAST_DATE_MSG, isPastTime, PAST_TIME_MSG } from './parser';
import { shiftSelect } from '../util/select';
import { detectAttachmentType, normalizeUrl, openAttachment, openAll } from './attachments';
import { playCompleteChime, showUndoToast } from './complete';
import { selectionBar, type SelBar } from '../ui/selbar';
import {
  getTaskFolders,
  saveTaskFolders,
  makeFolder,
  folderMembers,
  mutateTaskFolders,
  reorderTaskFolders,
  normFolder,
  FOLDERS_EVENT,
} from './folders';
import { acceptFolderName, cleanFolderName, guardFolderNameField, wireRename } from './folderName';
import { runSync } from '../schoology/sync';
import {
  analyzeTitle, languageName, rankCandidates, translateAs, translateBatchAs,
  MAX_CHIPS, TRANSLATE_LANGS_EVENT,
} from '../util/translate';

/**
 * The language list a stored translation verdict was reached under. See
 * autoTranslatePass: when this stops matching the current list, every stored verdict
 * is thrown away and the titles are read again.
 *
 * PER ACCOUNT (Gabe, 8/21). It was one un-scoped key for the whole browser, and that
 * is what made translations vanish for a few seconds on almost every load: two
 * different lists took turns writing the same slot, so each one arrived to find the
 * other's signature and wiped everything. Two accounts on a shared browser did it,
 * and so did the LANDING PAGE, which mounts this very view over a sandbox while prefs
 * are still the defaults (landing/view.ts). Signing in after seeing the landing page
 * was enough. Scoping it per uid stops the accounts colliding; the `sample` guard
 * below stops the landing page taking part at all.
 */
const txLangSigKey = (uid: string): string => `cobalt:tx-langs:${uid || 'anon'}`;

const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

// Folder glyphs: a FILLED folder (tinted with the folder's color) for section
// rows, and an OUTLINE folder (currentColor) for the per-task toolbox button.
const FOLDER_SVG = (color: string) =>
  `<svg class="task-folder-ico" viewBox="0 0 24 24" fill="${color}"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
/** One optional row control, in both of its forms: the button that sits on the
 *  task row, and the entry that represents it inside the "…" menu. */
interface RowAction {
  id: PinnedAction;
  /** Menu wording. Reflects live state ("Hide translation", "Folder: Homework"). */
  label: string;
  iconHtml: string;
  iconColor?: string;
  /** True when the control has real content behind it, so it belongs on the row
   *  without anyone pinning it. */
  auto: boolean;
  /** Run the action straight from the menu. */
  run: () => void;
  /** Build the row button. OPTIONAL, because one action deliberately has no button:
   *  'readings' asks its question inside the translation row instead of behind a
   *  glyph of its own, so it exists in the … menu and nowhere else (Gabe, 8/21).
   *  Anything without a build() is also absent from PINNABLE, so no pin can conjure
   *  a button that was never written. */
  build?: () => HTMLElement;
}

const FOLDER_BTN_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>';

// External-link / open-in-Schoology glyph. Exported for the Task Archives, whose
// rows carry the same ↗ back to the assignment (tasks/archiveView.ts).
export const SCHOOLOGY_SVG =
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
/** How long the exit animations run: the row's glide (0.5s) plus the delayed
 *  height collapse behind it (0.34s at +0.46s). Renders are held this long. */
const EXIT_ANIM_MS = 820;

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
  private selBar: SelBar | null = null; // the "N selected · Deselect all" strip
  private autoTx = false; // guards the auto-translate pass against re-entry
  private langListener = false; // TRANSLATE_LANGS_EVENT is registered once, not per mount
  // The task being ⋮⋮-dragged (id + its due-date group), null when idle.
  private dragFrom: { id: string; group: string } | null = null;
  // The folder being ☰-dragged, null when idle. Separate from dragFrom so a task
  // drag inside an open folder and a folder drag can never be mistaken for each other.
  private folderDragId: string | null = null;
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
  /** When the exit animation currently playing (a row gliding out, a folder block
   *  folding shut) is due to finish. A re-render before then would swap the moving
   *  DOM for a finished list — the animation would simply not be seen. External
   *  redraw triggers wait for this instead of firing straight through. */
  private animatingUntil = 0;
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
  // Multi-select (list mode): Ctrl/Cmd+click toggles rows, Shift+click reaches
  // across a range (util/select.ts), Esc clears. There is deliberately NO anchor
  // field here any more - see that file for why remembering one was the bug.
  // File-Explorer rule: using the TOOLBOX on any selected row applies that action
  // to every selected task at once.
  private selectedIds = new Set<string>();

  // EXCERPT MODE (Gabe, 8/10): the Dashboard's "Today's Tasks" card mounts THIS
  // view filtered to one day, so its rows are the real Tasks-tab rows, not a
  // lookalike that drifts. No header, no quick-add, no calendar toggle, and no
  // folder sections: foldered and loose tasks are COMPILED into one flat list,
  // because "what's due today" is one question, not one per folder.
  private excerpt?: { filter: (t: Task) => boolean; empty: string; onCount?: (n: number) => void };

  constructor(
    data: Data,
    sample?: { host: HTMLElement },
    // onCount fires on every excerpt render with the number of matches, so the
    // host card can hide itself when there is nothing to show (the Overdue card
    // uses this). The count comes from the view's own filter, so there is one
    // definition of "overdue", not a duplicate in the dashboard.
    excerpt?: { filter: (t: Task) => boolean; empty: string; onCount?: (n: number) => void }
  ) {
    this.data = data;
    this.sample = sample;
    this.excerpt = excerpt;
  }

  /** Open an external URL — a no-op in the landing sample (buttons stay inert). */
  private openExt(url: string): void {
    if (!this.sample) openAttachment(url);
  }

  mount(panel: HTMLElement): void {
    this.bannerHost = el('div');
    // Excerpt: just the rows. It still watches tasks, folders and the registry,
    // so a task edited/completed anywhere repaints here on the same tick as the
    // Tasks tab, and the rows keep every behavior they have there.
    if (this.excerpt) {
      this.listEl = el('div', { class: 'task-list task-list-excerpt' });
      panel.append(this.listEl);
      this.data.watchTasks((u) => this.onUpdate(u));
      onRegistryChange(() => this.render());
      window.addEventListener(PREFS_EVENT, () => this.render());
      void getTaskFolders(this.data).then((f) => {
        this.folders = f;
        this.render();
      });
      window.addEventListener(FOLDERS_EVENT, () => {
        void getTaskFolders(this.data).then((f) => {
          this.folders = f;
          this.renderAfterAnimation();
        });
      });
      return;
    }
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
    // 💡 Pro tips, BETWEEN the two round buttons (Gabe, 8/22). The tips used to be
    // scattered: one printed above the list, one inside each folder picker, and the
    // rest were things you could only learn by being told. They are one popup now,
    // in the one place a student goes looking for "what else can this do".
    const tipsBtn = el('button', { class: 'tasks-tips-btn', text: '💡', title: 'Task pro tips' });
    tipsBtn.addEventListener('click', () => this.openProTips());
    header.append(this.modeBtn, tipsBtn, this.makeRefreshBtn());
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
    this.watchQuickAdd(quickAdd);

    // The student changed which languages get translated → every task's stored
    // verdict is stale (see util/translate.ts resetTranslationCache). Registered
    // ONCE: mount() runs on every visit to the Tasks tab, and a stacked listener
    // would fire one rescan per visit ever made.
    if (!this.langListener) {
      this.langListener = true;
      window.addEventListener(TRANSLATE_LANGS_EVENT, () => void this.autoTranslatePass());
    }
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
        // THIS re-render used to kill both dissolve animations. Completing the last
        // task in a folder writes the folder list (the dissolve) — which fires this
        // very event, milliseconds later, and rebuilding the list mid-flight
        // replaced the gliding row and the folding block with a finished list. So
        // the fold-shut is allowed to play out first; the fresh folders are already
        // in hand, they just get drawn at the end of the animation.
        this.renderAfterAnimation();
      });
    });
  }

  /** Mark an exit animation as running, so renders hold off until it's done. */
  private beginExitAnimation(): void {
    this.animatingUntil = Date.now() + EXIT_ANIM_MS;
  }

  /** Render now, or — if a row/folder is mid-flight — the moment it lands. */
  private renderAfterAnimation(): void {
    const wait = this.animatingUntil - Date.now();
    if (wait > 0) window.setTimeout(() => this.render(), wait);
    else this.render();
  }

  private onUpdate(u: TasksUpdate): void {
    this.map = u.tasks;
    this.recentLangsCache = null; // the tally below is counted FROM the map
    // Selection follows reality: drop ids that vanished or got completed.
    for (const id of [...this.selectedIds]) {
      const t = this.map[id];
      if (!t || t.completed) this.selectedIds.delete(id);
    }
    this.bannerHost.replaceChildren();
    if (u.suspectedWipe) this.showWipeBanner();
    // Same hold as the folder listener: a task write landing mid-glide (our own
    // delayed commit, or one from Focus) must not repaint over the animation.
    this.renderAfterAnimation();
    void this.folderMaintenance();
    // Read any not-yet-checked titles in the background and translate the foreign ones.
    void this.autoTranslatePass();
  }

  private showWipeBanner(): void {
    const banner = el('div', { class: 'wipe-banner' });
    banner.append(
      el('div', {
        text: '⚠️ Your data looked suddenly empty. Cobalt blocked it to protect you. Restore everything from your most recent backup?',
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
      // Hyphen-insensitive: the quick-add token is one word, so "f:AP-Bio" must
      // find an existing "AP Bio" rather than spawn a near-duplicate folder.
      const want = normFolder(parsed.folderName);
      let folder = this.folders.find((f) => normFolder(f.name) === want);
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
    const landed = ids.indexOf(fromId);

    // ONLY THE DRAGGED TASK IS PINNED (Gabe, 8/15). This used to stamp an index onto
    // every task in the group, which meant one drag froze the whole group: priority
    // stopped mattering there forever, and anything imported later fell to the
    // bottom because it had no stamp at all. The rule now is that a task the student
    // never touched keeps obeying the hierarchy even though its position shifted to
    // make room, so every other pin in this group is CLEARED here.
    const changed: Task[] = [];
    for (const t of group.tasks) {
      if (t.id === fromId) {
        if (t.manualOrder !== landed) changed.push({ ...t, manualOrder: landed });
      } else if (t.manualOrder != null) {
        const cleared = { ...t };
        delete cleared.manualOrder; // delete, not undefined — Firebase rejects undefined
        changed.push(cleared);
      }
    }
    if (!changed.length) return;
    this.map = { ...this.map, ...Object.fromEntries(changed.map((t) => [t.id, t])) };
    this.recentLangsCache = null;
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
    // The description popup carries a translation line that a press changes, so it
    // has to redraw with everything else. Dropped once its body leaves the document,
    // which is how it notices the popup was closed.
    if (this.detailsRedraw) {
      if (!this.detailsRedraw.body.isConnected) this.detailsRedraw = null;
      else {
        // ONLY WHEN SOMETHING IT SHOWS CHANGED. draw() replaces the popup's children,
        // which throws away the scroll position of a long description, and render()
        // runs on every task update, including each write of the auto-translate pass.
        // Redrawing on all of them would drag the student back to the top of the
        // instructions they were reading.
        const sig = this.detailsRedraw.sig();
        if (sig !== this.detailsRedraw.last) {
          this.detailsRedraw.last = sig;
          this.detailsRedraw.draw();
        }
      }
    }
    this.listEl.replaceChildren();
    if (this.excerpt) {
      this.renderExcerpt();
      return;
    }
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

  /** Excerpt render: one flat, sorted list of the matching tasks, folders and
   *  all. Rows come from renderTask, the SAME builder the Tasks tab uses, so
   *  chips, badges, buttons, editing and multi-select are identical by
   *  construction rather than by imitation. */
  private renderExcerpt(): void {
    const hits = Object.values(this.map).filter(
      (t) => !t.completed && !this.completingIds.has(t.id) && this.excerpt!.filter(t)
    );
    this.excerpt!.onCount?.(hits.length);
    if (!hits.length) {
      this.listEl.append(el('div', { class: 'dash-due-empty', text: this.excerpt!.empty }));
      return;
    }
    // ONE synthetic group: these rows are already one date's worth, so a ⋮⋮ drop
    // reorders within the excerpt exactly as it would within that date's group.
    const group: TaskGroup = { key: 'excerpt', header: '', tone: 'red', tasks: sortTasks(hits) };
    for (const t of group.tasks) this.listEl.append(this.renderTask(t, group));
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
    // "Today" only appears when it would actually GO somewhere (Gabe, 8/11): if
    // the view already contains today, the button lands you exactly where you are,
    // which reads as broken. Month view asks "same month + year"; week view asks
    // whether today falls inside the seven days on screen.
    if (!this.viewingToday()) nav.append(todayBtn);
    nav.append(prev, label, next);
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

  /** Is TODAY already on screen? Drives whether the "Today" button is shown. */
  private viewingToday(): boolean {
    const now = new Date();
    if (this.calView === 'month') {
      return (
        this.calCursor.getFullYear() === now.getFullYear() &&
        this.calCursor.getMonth() === now.getMonth()
      );
    }
    // Week view: today is on screen when it sits in [weekStart, weekStart + 7).
    const start = this.weekStartDate();
    const end = new Date(start);
    end.setDate(end.getDate() + 7);
    return now >= start && now < end;
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
      // ARCHIVED tasks never draw a chip, whatever "Show completed" says (Gabe,
      // 8/21). They used to be deleted at the next boot, so the calendar has
      // always shown only the current run of work; now that they are kept, the
      // grid would slowly fill up with months of finished chips. They live on the
      // Task Archives screen, which is where a student goes looking for them.
      if (!t.dueDate || t.archived || this.completingIds.has(t.id) || (t.completed && !show)) continue;
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
          : '#7db4ff'
        : priorityDef(t.priority).color;
    const chip = el('button', {
      class: `cal-chip${t.completed ? ' done' : ''}`,
      title: t.course ? `${t.title} · ${t.course}` : t.title,
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
      // What the head COUNTS is what the body SHOWS: still-open tasks. Counting
      // every member (completed included) made a check-off leave the number
      // frozen — 10 tasks stayed "10 tasks" until a reload purged the completed
      // ones and it jumped to 8. Excluding the rows mid-exit-animation too keeps
      // the number falling in step with them gliding out.
      const openMembers = members.filter((t) => !t.completed && !this.completingIds.has(t.id));
      const open = this.openFolders.has(f.id);
      const row = el('div', { class: `task-folder${open ? ' open' : ''}`, 'data-folder-id': f.id });
      const head = el('button', { class: 'task-folder-head' });
      head.innerHTML = FOLDER_SVG(f.color);

      // ☰ drag-to-reorder, the folder-scale twin of a task row's ⋮⋮. Folders are
      // the only list here the user orders by hand, so the grip is a hamburger
      // rather than the row grip: it reads as "the whole block moves". Same
      // arming trick as tasks — `draggable` goes on only while the grip is held,
      // so text selection and the head's own click behaviors stay untouched.
      const fHandle = el('span', {
        class: 'task-folder-handle',
        text: '⋮⋮',
        title: 'Drag to reorder folders',
      });
      fHandle.addEventListener('pointerdown', () => row.setAttribute('draggable', 'true'));
      fHandle.addEventListener('pointerup', () => row.removeAttribute('draggable'));
      row.addEventListener('dragstart', (e) => {
        this.folderDragId = f.id;
        row.classList.add('dragging');
        e.dataTransfer?.setData('text/plain', f.id);
        if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
        e.stopPropagation(); // an open folder holds task rows — don't read this as a task drag
      });
      row.addEventListener('dragend', () => {
        row.classList.remove('dragging');
        row.removeAttribute('draggable');
        this.folderDragId = null;
      });
      row.addEventListener('dragover', (e) => {
        if (!this.folderDragId || this.folderDragId === f.id) return;
        e.preventDefault();
        if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
      });
      row.addEventListener('drop', (e) => {
        const from = this.folderDragId;
        if (!from || from === f.id) return;
        e.preventDefault();
        e.stopPropagation();
        this.folderDragId = null;
        void reorderTaskFolders(this.data, from, f.id).then((list) => {
          this.folders = list;
          this.render();
        });
      });
      head.prepend(fHandle); // ahead of the folder icon — the grip is the row's leading edge
      // Double-click the name to rename (same convention as task titles); a
      // single click on the name is a no-op so renaming never fights the toggle.
      const nameEl = el('span', { class: 'task-folder-name', text: f.name });
      nameEl.addEventListener('dblclick', (e) => {
        e.stopPropagation();
        this.inlineEdit(nameEl, f.name, (v) => {
          const name = acceptFolderName(v, this.sample?.host); // no spaces: f: reads one word
          if (!name) return;
          f.name = name;
          void saveTaskFolders(this.data, this.folders);
        });
      });
      // Click the folder ICON to recolor: a hidden swatch behind it opens the
      // in-app picker card; the icon previews live while dragging, the pick
      // saves when the card closes.
      const colorIn = el('button', { type: 'button', class: 'task-folder-colorin', title: 'Folder color' });
      colorIn.addEventListener('click', (e) => e.stopPropagation());
      attachColorPicker(colorIn, {
        // A folder made before colors (or with junk stored) opens on the accent,
        // not on an invalid value a picker would silently turn black.
        value: () => (/^#[0-9a-f]{6}$/i.test(f.color) ? f.color : '#7db4ff'),
        onChange: (hex) => {
          f.color = hex;
          head.querySelector('.task-folder-ico')?.setAttribute('fill', hex);
        },
        onClose: (changed) => {
          if (!changed) return;
          void saveTaskFolders(this.data, this.folders);
          this.render();
        },
        host: () => this.sample?.host, // landing preview: the card stays inside the device frame
      });
      head.append(
        nameEl,
        // Total only, never done/total (Gabe, 8/7/26): a folder is a container
        // you keep adding to, so "2/5" read like progress toward a fixed goal
        // that does not exist. "5 tasks" just states what is inside.
        el('span', {
          class: 'task-folder-count',
          text: `${openMembers.length} task${openMembers.length === 1 ? '' : 's'}`,
        }),
        el('span', { class: 'task-folder-arrow', text: '▶' }),
        colorIn
      );
      head.addEventListener('click', (e) => {
        const t = e.target as Element;
        // A rename is in progress → the head is inert (a spacebar "activation
        // click" targets the BUTTON itself, so target checks alone can't catch it).
        if (head.querySelector('.inline-edit-block')) return;
        if (t.closest('.task-folder-name')) return;
        if (t.closest('.task-folder-handle')) return; // grabbing the grip is not a toggle
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
          for (const t of openMembers) subMap[t.id] = t; // the same set the head counts
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
    const applyAll = (mutate: (t: Task) => Task): void => this.applyToSelection(task, mutate);
    this.popup('Add to folder', (body, close) => {
      const note = this.bulkNote(task);
      if (note) body.append(note);
      const wrap = el('div', { class: 'folder-pick' });
      for (const f of this.folders) {
        const b = el('button', { class: `folder-pick-row${task.folderId === f.id ? ' on' : ''}` });
        b.innerHTML = FOLDER_SVG(f.color);
        // Double-click the name to rename, the same gesture as the folder head in
        // the list behind this menu (Gabe, 8/20). The picker is often where you
        // notice the name is wrong, and it was the one place you could not fix it.
        const nm = el('span', { class: 'folder-pick-name', text: f.name });
        wireRename(nm, f, () => void saveTaskFolders(this.data, this.folders).then(() => this.render()), this.sample?.host);
        b.append(nm);
        b.addEventListener('click', (ev) => {
          if ((ev.target as HTMLElement).closest('.inline-edit-block')) return; // renaming, not filing
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
      // task's course color but is freely editable (in-app picker card).
      const courseColor = task.course ? getCourseColor(task.course) : '#7db4ff';
      let newColor = /^#[0-9a-f]{6}$/i.test(courseColor) ? courseColor : '#7db4ff';
      const colorIn = el('button', { type: 'button', class: 'folder-pick-color', title: 'Folder color' });
      attachColorPicker(colorIn, {
        value: () => newColor,
        onChange: (hex) => (newColor = hex), // read below when Enter creates the folder
        host: () => this.sample?.host,
      });
      const input = textInput({ class: 'folder-pick-input', placeholder: '+ New folder…' });
      guardFolderNameField(input, this.sample?.host); // one word: f: cannot reach a name with a space in it
      input.addEventListener('keydown', (e) => {
        if (e.key !== 'Enter') return;
        const name = cleanFolderName(input.value);
        if (!name) return;
        const folder = makeFolder(name, newColor);
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
      // The f: shortcut used to be written here. It moved to the 💡 Task Pro Tips
      // popup in the Tasks header with the rest of them (Gabe, 8/22): a tip inside
      // the folder picker is only ever read by someone already filing a folder by
      // hand, which is the one moment it cannot save them anything.
      body.append(wrap);
    });
  }

  private quickAddOff?: () => void;
  /** Re-run the pinned/unpinned test on demand. See onShow(). */
  private quickAddSync?: () => void;

  /**
   * CONDENSE THE ADD BAR ONCE IT PINS (Gabe, 8/21).
   *
   * The bar is `position: sticky`, so it is always reachable however far down the
   * list you are, and this adds the one thing sticky cannot do by itself: tell the bar
   * WHEN it is stuck, so it can grow a hairline and a shadow and read as sitting on
   * top of the list rather than in it.
   *
   * It does not resize. The pinned state used to slim the bar too, and measuring it
   * ended that: see the comment on .quick-add in components.css for the nine pixels it
   * saved and the 26px lurch it cost.
   *
   * A SCROLL LISTENER, not an IntersectionObserver, and not for want of trying. The
   * observer version needed a sentinel element and could not be verified: IO does not
   * fire at all in the browser pane these changes are tested in, so shipping it would
   * have meant shipping a behaviour nothing had ever watched work. This asks the only
   * question that matters, directly — is the bar's top against the scroller's top? —
   * which is true exactly when sticky has caught it. No sentinel, nothing to keep in
   * sync, and it is measurable anywhere.
   *
   * The scroll container is `.app-below`; the window itself does not scroll in
   * app-mode. No rAF throttle: browsers already coalesce scroll events to about one
   * per frame, so the throttle bought nothing, and it cost the ability to test this
   * at all (rAF does not fire in the browser pane either). Two rect reads per scroll
   * event is what a sticky header costs everywhere.
   */
  private watchQuickAdd(bar: HTMLElement): void {
    this.quickAddOff?.();
    this.quickAddOff = undefined;
    const root = bar.closest('.app-below') as HTMLElement | null;
    if (!root || this.sample) return; // no scroller (landing demo, tests) = nothing to pin against
    const sync = (): void => {
      if (!bar.isConnected) return;
      const rect = bar.getBoundingClientRect();
      // HIDDEN MEANS UNANSWERABLE, NOT "PINNED" (Gabe, 8/21). The scroller is shared
      // by every tab, so this fires while the Tasks panel is display:none — and a
      // hidden element measures as an all-zero rect, whose "top" of 0 sits above the
      // scroller's top and reads as stuck. Refusing to answer leaves the last real
      // answer standing until onShow() asks again with the bar actually on screen.
      if (!rect.height) return;
      // Stuck means its top has caught the scroller's top, which is where `top: 0`
      // parks it. One pixel of slack for sub-pixel layout.
      const pinned = rect.top - root.getBoundingClientRect().top < 1;
      // Class only. It changes nothing about the box, so this cannot move the list
      // however often it fires.
      bar.classList.toggle('pinned', pinned);
    };
    root.addEventListener('scroll', sync, { passive: true });
    this.quickAddOff = () => root.removeEventListener('scroll', sync);
    this.quickAddSync = sync;
    sync(); // a re-mount while already scrolled must not open at full height
  }

  /**
   * The Tasks tab was opened. Re-test the add bar's pinned state.
   *
   * Needed because every tab now opens at the top (openAtTop in ui/tabs.ts), and the
   * scroll that does the resetting happens while THIS panel is hidden: the bar keeps
   * whatever class it had when you left, and coming back to a list already at scroll
   * zero fires no scroll event to correct it. So the bar sat at the top of an
   * unscrolled list wearing its pinned shadow. mountTabs calls onShow with the panel
   * already visible, which is the one moment the question can be answered honestly.
   */
  onShow(): void {
    this.quickAddSync?.();
  }

  private verifyQueue = new Set<string>();
  private verifying = false;
  /** Titles whose verification could not reach the provider. In-memory only: a new
   *  session, or a reload once the network is back, tries again. */
  private verifyFailed = new Set<string>();

  /**
   * WHICH LANGUAGES CAN ACTUALLY READ THIS TITLE, settled before any is offered.
   *
   * The cheap filters (script, diacritics, orthographic shape) are pure string work
   * and run instantly, but they can only rule out what is IMPOSSIBLE. They cannot tell
   * that German, which could perfectly well have written a Latin-script sentence,
   * simply cannot read this one: only the provider knows that, and only if asked.
   *
   * So it is asked, up front, once per title, and the answer is stored. That buys the
   * thing Gabe wanted — no button that leads nowhere — and it pays for itself twice
   * over, because a press then costs nothing.
   *
   * ONE CALL PER LANGUAGE, NOT PER TITLE: the queue collects every unverified title and
   * asks each candidate language about all of them at once (up to 50 to a call), so a
   * whole list costs about as much as a single task used to.
   */
  /** `slot:id`, because a task has a title AND a description to verify and they are
   *  independent questions with independent answers. */
  private vkey(slot: TxSlot, id: string): string {
    return `${slot.name}:${id}`;
  }

  private queueVerify(task: Task, slot: TxSlot = TITLE_SLOT): void {
    const text = txText(task, slot);
    if (!text) return;
    const k = this.vkey(slot, task.id);
    if (txVerifiedFor(task, slot) === text || this.verifyQueue.has(k)) return;
    if (this.verifyFailed.has(k)) return; // already tried this session, no network
    this.verifyQueue.add(k);
    if (this.verifying) return;
    this.verifying = true;
    // A tick, so a render that queues twenty rows results in ONE pass over twenty.
    setTimeout(() => void this.runVerify(), 60);
  }

  private async runVerify(): Promise<void> {
    try {
      // A job is a (task, slot) pair now: the same task can be waiting on an answer
      // about its title and a separate one about its description.
      const keys = [...this.verifyQueue];
      this.verifyQueue.clear();
      type Job = { task: Task; slot: TxSlot; text: string };
      const jobs: Job[] = [];
      for (const k of keys) {
        const i = k.indexOf(':');
        const slot = TX_SLOTS.find((sl) => sl.name === k.slice(0, i));
        const t = this.map[k.slice(i + 1)];
        if (!slot || !t) continue;
        const text = txText(t, slot);
        if (!text || txVerifiedFor(t, slot) === text) continue;
        jobs.push({ task: t, slot, text });
      }
      if (!jobs.length) return;

      // key -> code -> english, built language by language.
      const found = new Map<string, Record<string, string>>();
      const byLang = new Map<string, Job[]>();
      for (const j of jobs) {
        found.set(this.vkey(j.slot, j.task.id), {});
        for (const d of rankCandidates(j.text, txDetected(j.task, j.slot), [], txRuledOut(j.task, j.slot))) {
          const list = byLang.get(d.code) || [];
          list.push(j);
          byLang.set(d.code, list);
        }
      }
      let reachable = true;
      for (const [code, group] of byLang) {
        const batch = group.slice(0, 50);
        // verifySample, not the whole text: a description can be paragraphs long and
        // the question here is only "can this language read it at all". See txSlot.ts.
        const { ok, results } = await translateBatchAs(batch.map((j) => verifySample(j.text)), code);
        if (!ok) { reachable = false; break; } // offline: record nothing, try again later
        results.forEach((text, i) => {
          if (text) (found.get(this.vkey(batch[i].slot, batch[i].task.id)) as Record<string, string>)[code] = text;
        });
      }
      // OFFLINE CHANGES NOTHING ON THE TASK. Writing "verified, no options" here would
      // leave the title permanently unanswerable because the network blinked once. The
      // failure is remembered in memory instead, which stops the retry loop and lets
      // the rows fall back to the unverified list rather than sitting on "checking".
      if (!reachable) {
        for (const j of jobs) this.verifyFailed.add(this.vkey(j.slot, j.task.id));
        this.render();
        return;
      }

      // ONE WRITE PER TASK even when both slots were verified in the same pass:
      // two putTask calls for one task would have the second overwrite the first.
      const merged = new Map<string, Task>();
      for (const j of jobs) {
        const base = merged.get(j.task.id) ?? this.map[j.task.id];
        if (!base) continue;
        if (txText(base, j.slot) !== j.text) continue; // edited mid-pass
        // The options are keyed by the SAMPLE that was verified, but they are only
        // ever used as "this language works", plus a free answer for a short text
        // where the sample IS the whole thing. A truncated sample is not passed off
        // as the translation: see the press handler, which refetches when the text
        // is longer than the sample.
        merged.set(
          j.task.id,
          txWrite(base, j.slot, {
            options: found.get(this.vkey(j.slot, j.task.id)) || {},
            verifiedFor: j.text,
          })
        );
      }
      const writes = [...merged.values()];
      if (writes.length) await this.data.putTasksBulk(writes);
    } finally {
      this.verifying = false;
      if (this.verifyQueue.size) setTimeout(() => void this.runVerify(), 60);
    }
  }

  /** The open description popup's redraw, if one is open. `sig` is everything the
   *  popup draws, flattened, so render() can tell a change worth redrawing for from
   *  the twenty updates a translate pass fires. See openDetails. */
  private detailsRedraw:
    | { body: HTMLElement; draw: () => void; sig: () => string; last: string }
    | null = null;

  /** Rows told to ask again from the … menu, after an answer was already showing.
   *  Deliberately NOT persisted: it is a question on screen right now, not a property
   *  of the task, and a reload should leave it where the stored fields say it is. */
  private askingIds = new Set<string>();

  /**
   * THE LANGUAGES THIS ACCOUNT ACTUALLY WRITES IN, commonest first.
   *
   * Counted from the tasks already on screen: every confirmed translation is a term's
   * worth of evidence about which languages this student's classes are taught in, and
   * it beats any table shipped in the app. A student with forty Spanish assignments
   * should not be offered Afrikaans first because the alphabet allows it.
   *
   * A reading the student CHOSE counts double, because they said it out loud.
   */
  private recentLangsCache: string[] | null = null;

  private recentLangs(): string[] {
    // COUNTED ONCE PER TASK MAP, not once per row. readings() consults this, and
    // readings() is asked up to three times for every foreign or unplaced row in a
    // render (the ⋯ menu's entry, the ask-row gate, and the ask row itself) — so an
    // uncached scan of every task made drawing a list of foreign tasks quadratic.
    // The answer only changes when the tasks do, and the two places that reassign
    // this.map drop the cache with them.
    if (this.recentLangsCache) return this.recentLangsCache;
    const n = new Map<string, number>();
    for (const t of Object.values(this.map)) {
      const l = (t.translatedLang || '').toLowerCase().split('-')[0];
      if (!l) continue;
      n.set(l, (n.get(l) || 0) + (t.translationChosen ? 2 : 1));
    }
    this.recentLangsCache = [...n.entries()].sort((a, b) => b[1] - a[1]).map(([l]) => l);
    return this.recentLangsCache;
  }

  /**
   * THE LANGUAGES THIS TITLE WOULD ACTUALLY BE OFFERED AS, in the order they would
   * appear. Empty means there is no question worth asking, and every piece of
   * translation UI on the row is gated on it: the 🌐 "Translate from" line, and
   * the "Translate from… / Change language…" entry in the ⋯ menu. One answer, so
   * the menu can never open a row that then has nothing to show.
   *
   * FIRST, AND THIS IS THE ONE GABE ASKED FOR (8/21): a title the auto pass has
   * already read and placed as plain English is not a question. It was offering
   * "Translate from…" on every ordinary English task, which is a menu entry that
   * can only ever waste a press. `translationAmbiguous` is the pass saying it was
   * NOT sure, and those keep the offer; a chosen reading keeps it too, because
   * changing your mind must stay possible.
   *
   * THEN the verification: once the pass has checked which languages can genuinely
   * read this title, only those are candidates. Before it has run, the ranking
   * stands and the row says it is checking.
   */
  private readings(task: Task, slot: TxSlot = TITLE_SLOT): { code: string; label: string }[] {
    if (!getPrefs().tasks.translateFrom.length) return [];
    const text = txText(task, slot);
    if (!text) return [];
    if (txChecked(task, slot) && !txTranslated(task, slot) && !txAmbiguous(task, slot) && !txChosen(task, slot))
      return [];
    const ranked = rankCandidates(
      text,
      txDetected(task, slot),
      this.recentLangs(),
      txRuledOut(task, slot)
    );
    // Verification counts only for the text it was run against; anything else is
    // an answer about words this task no longer has.
    if (txVerifiedFor(task, slot) !== text) return ranked;
    const verified = Object.keys(txOptions(task, slot));
    return ranked.filter((d) => verified.indexOf(d.code) >= 0);
  }

  /** Is this row currently asking which language it is in? */
  private asking(task: Task, slot: TxSlot = TITLE_SLOT): boolean {
    if (!(this.askingIds.has(this.vkey(slot, task.id)) || txAmbiguous(task, slot))) return false;
    // Nothing to offer = nothing to ask. An empty row of buttons is a question with
    // no answers, which is exactly what "🌐 Translate from" with nothing after it
    // was (Gabe, 8/21).
    return this.readings(task, slot).length > 0;
  }

  /**
   * THE TRANSLATION ROW, ASKING INSTEAD OF ANSWERING.
   *
   * One button per language the title could plausibly be in, the detector's own
   * lean first. Pressing one buys exactly one translation, which is why the buttons
   * carry names rather than pre-fetched English: four calls to fill a line the
   * student answers with one glance is four times the cost for less clarity.
   */
  private buildAskRow(task: Task, slot: TxSlot = TITLE_SLOT): HTMLElement {
    const row = el('div', { class: 'task-translation asking' });
    row.append(el('span', { class: 'task-translation-badge', text: '🌐' }));
    row.append(el('span', { class: 'task-ask-label', text: 'Translate from' }));
    const chips = el('span', { class: 'task-ask-chips' });
    row.append(chips);

    // ONE RANKING, cut two ways. The row shows its head; "N more" shows the whole
    // thing, in the SAME order (Gabe, 8/21). Expanding used to fall back to the raw
    // enabled list, so opening it re-sorted the languages into settings order and
    // threw away every bit of reasoning that had put the likeliest one first.
    // VERIFIED ONLY (Gabe, 8/21). Once the pass has run, the ranking is filtered down
    // to the languages that actually produced English. Before it has run, the row asks
    // no question at all: it says it is checking, and the pass fills it in.
    // Verification counts only for the title it was run against. Anything else is an
    // answer about words this task no longer has.
    const text = txText(task, slot);
    const freshlyVerified = !!txVerifiedFor(task, slot) && txVerifiedFor(task, slot) === text;
    const vk = this.vkey(slot, task.id);
    // EVERY candidate is checked, so everything offered here has produced real English,
    // including the ones behind "more". A cap on how many get checked was tried and
    // reverted (Gabe, 8/21): it let an unchecked language into the visible shortlist,
    // which is the one thing this whole pass exists to prevent. The cost of checking
    // scales with how many languages are ENABLED, and that dial belongs to the student.
    //
    // THE SAME LIST the ⋯ menu decides by (readings), not a second calculation of it:
    // when the two disagreed, the menu offered a question whose row then drew a bare
    // "Translate from" with nothing after it.
    const all = this.readings(task, slot);
    const best = all.slice(0, MAX_CHIPS);
    // UNVERIFIED, AND THE PROVIDER IS REACHABLE: say so and go and find out. The row
    // shows no buttons in the meantime, because an unchecked button is exactly the
    // thing this pass exists to stop showing.
    if (!freshlyVerified && !this.verifyFailed.has(vk)) {
      row.append(el('span', { class: 'task-ask-checking', text: 'checking which languages fit\u2026' }));
      this.queueVerify(task, slot);
      return row;
    }
    // UNVERIFIED AND UNREACHABLE: fall back to the ranked candidates and the old
    // press-to-find-out behaviour. Offline, "checking..." would sit there for ever and
    // retry on every redraw, which is a worse answer than an unverified list: the
    // student can still press one, and a press that lands on a language which cannot
    // read it still says so and removes it.
    const draw = (expanded: boolean): void => {
      chips.textContent = '';
      for (const d of expanded ? all : best) chips.append(chip(d));
      // The escape hatch, and it should be rare: a ranking can be wrong, and being
      // wrong must not mean the right answer is unreachable. NO ✕ next to it —
      // the row is turned off with the globe in the toolbox, the same control that
      // hides a finished translation, because they are the same line (Gabe, 8/21).
      if (!expanded && all.length > best.length) {
        const more = el('button', { class: 'task-ask-chip more', text: `${all.length - best.length} more…` });
        more.addEventListener('click', (e) => { e.stopPropagation(); draw(true); });
        chips.append(more);
      }
    };

    const chip = (d: { code: string; label: string }): HTMLElement => {
      const b = el('button', { class: 'task-ask-chip', text: d.label });
      b.addEventListener('click', async (e) => {
        e.stopPropagation(); // the row underneath selects; this is a control on it
        if (b.disabled) return;
        // INSTANT, when the verification pass already has the answer. Every button on
        // a verified row does, which is the whole point of checking first: the press
        // applies a reading rather than going to fetch one.
        // The verification answer is only THE answer when it covered the whole text.
        // A long description is verified on a leading slice (see verifySample), so
        // handing that slice back as the translation would silently truncate it.
        const cached = txOptions(task, slot)[d.code];
        if (cached && verifySample(text) === text) {
          this.askingIds.delete(vk);
          void this.data.putTask(
            txWrite(task, slot, {
              translated: cached,
              lang: d.code,
              chosen: true,
              checked: true,
              ambiguous: false,
              hidden: false,
            })
          );
          return;
        }
        [...chips.querySelectorAll('button')].forEach((x) => ((x as HTMLButtonElement).disabled = true));
        b.classList.add('busy');
        const r = await translateAs(text, d.code);
        if ('text' in r) {
          this.askingIds.delete(vk); // answered: the row goes back to showing it
          // ONE write, not two. Clearing the refusals used to be a second putTask
          // built from the SAME stale `task`, so it landed after the first carrying
          // the pre-translation values and undid the answer just written.
          void this.data.putTask(
            txWrite(task, slot, {
              translated: r.text,
              lang: d.code,
              chosen: true,
              checked: true,
              ambiguous: false,
              hidden: false, // asking for a reading is asking to see it
              // Answered, so the refusals collected while hunting for it have done
              // their job. Cleared rather than left as a list nothing reads again.
              ruledOut: [],
            })
          );
          return;
        }
        // THE TWO FAILURES ARE NOT THE SAME FAILURE.
        //
        // 'offline' is a network problem: nothing is learned, the button comes back,
        // try again in a moment.
        //
        // 'unchanged' is THE PROVIDER REFUSING. Handed this title and told to read it
        // as French, it gave the title straight back, which is it saying this is not
        // French. That is a fact about these words, and a better one than any guess
        // this app makes, so it gets written down: the language stops being a
        // candidate for this title entirely (Gabe, 8/21). Announcing that a language
        // cannot read something and then offering it again on the next redraw was the
        // app arguing with itself in public.
        if (r.error === 'unchanged') {
          const already = txRuledOut(task, slot);
          void this.data.putTask(
            txWrite(task, slot, {
              ruledOut: already.indexOf(d.code) >= 0 ? already : [...already, d.code],
            })
          );
          this.notice(`🌐 ${d.label} cannot read this one, so it is off the list.`);
          return; // the redraw arrives with one fewer button
        }
        b.classList.remove('busy');
        [...chips.querySelectorAll('button')].forEach((x) => ((x as HTMLButtonElement).disabled = false));
        this.notice('🌐 Could not reach the translator. Try again in a moment.');
      });
      return b;
    };

    draw(false);
    return row;
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
          this.beginExitAnimation(); // the deadline IS the "are we animating?" flag now
        }
      }
      // Only the EMPTIED case gets its own notice. All-members-done dissolves
      // always ride a completion undo toast (single check-offs announce the
      // folder inside that toast; bulk completes have "N tasks completed") —
      // a second toast on top was redundant (per Gabe).
      const last = gone[gone.length - 1];
      if (folderMembers(last, this.map).length === 0) {
        this.notice(`📁 “${last.name}” empty, folder dissolved`);
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
      // Let the fold-shut play out first (beginExitAnimation set the deadline).
      this.renderAfterAnimation();
    }
  }

  /** A plain auto-expiring notice using the app's .toast styling (no Undo). */
  private notice(msg: string): void {
    showToast(msg, this.sample?.host ?? document.body);
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
    // A MODIFIER CLICK IS CAUGHT ON THE WAY DOWN, before any control on the row can
    // act on it (Gabe, 8/20). Skipping the early-return in onRowClick is not enough
    // on its own: the checkbox, the arrows and the ⋯ menu each have their OWN
    // listener, so a shift-click aimed at the row was still completing the task and
    // taking the selection with it. Capture phase settles it first — nobody holds
    // Shift to tick a box. Same rule as the bookmark cards.
    item.addEventListener(
      'click',
      (e) => {
        if (!(e.ctrlKey || e.metaKey || e.shiftKey) || this.mode !== 'list') return;
        e.preventDefault();
        e.stopPropagation();
        this.onRowClick(task, e);
      },
      true
    );
    item.addEventListener('click', (e) => this.onRowClick(task, e));
    // The strip is DORMANT (Gabe, 8/13): a color band you read, never a control
    // you press. It was briefly clickable; the arrow button in the action cluster
    // is the one way to change priority now. It still carries the label as a
    // tooltip, and it is still the visible cause of the list's order, since
    // `sortTasks` tie-breaks on priority.
    item.append(
      el('div', {
        class: `task-priority ${task.priority}`,
        title: `Priority: ${priorityDef(task.priority).label}`,
      })
    );

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
    // NOT in an excerpt card (Gabe, 8/15). renderExcerpt wraps its hits in ONE
    // synthetic group on the assumption that they are "already one date's worth".
    // That holds for Today's Tasks but is FALSE for the Overdue card, whose filter
    // is `dueDate < today` and therefore spans many past dates. Dragging there wrote
    // an index counted across those dates AND, because reorderWithinGroup clears
    // every other pin in the group it is handed, silently wiped the student's
    // arrangements in several real date groups at once. An excerpt is a read-only
    // summary; reordering belongs on the Tasks tab where the groups are real.
    if (!this.excerpt) item.append(handle);

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
    // hasFeedDiff, not just the flag: a sync that changed a field and changed it back
    // still writes feedUpdated, but there is nothing different to read, so no badge
    // (Gabe, 8/22). The popup and the badge answer the same question in one place.
    if (task.feedUpdated && hasFeedDiff(task)) {
      const what = Array.isArray(task.feedUpdated) && task.feedUpdated.length
        ? task.feedUpdated.join(', ')
        : 'name, date, or instructions';
      const upd = el('span', {
        class: 'task-altered-badge',
        text: '✱',
        title: `Changed on Schoology since import: ${what}. Click to see what changed`,
      });
      // CLICK SHOWS THE DIFF, IT NO LONGER JUST DISMISSES (Gabe, 8/22). The badge
      // used to be a tooltip naming the fields and a click that made it go away,
      // which asks the student to work out what a teacher actually altered in three
      // paragraphs of instructions. Now it opens the before and after, and the
      // dismiss lives in there, after the thing worth reading.
      upd.addEventListener('click', (ev) => {
        ev.stopPropagation(); // the row itself has click/dblclick behaviors
        this.openFeedDiff(task);
      });
      title.append(upd);
    }

    // ONE LINE UNDER THE TITLE, in one of two states (Gabe, 8/21).
    //
    //   ANSWERING  the translation, when there is one
    //   ASKING     a row of language buttons, when nobody could place the title, or
    //              when the student asked to change the language of an answer
    //
    // They are the same row — same slot, same globe, same toggle — which is the whole
    // point: a question about the translation is not a second feature, it is the
    // translation line before it knows the answer. And they are EXCLUSIVE. Changing
    // the language replaces the answer with the question rather than stacking a
    // second line under it, because the old answer is precisely what is in doubt.
    // vkey, not the bare id: askingIds holds `slot:id` now that the description asks
    // the same question independently, and a bare id matches neither entry.
    const changing = this.askingIds.has(this.vkey(TITLE_SLOT, task.id));
    // asking() is checked even while `changing`: pressing "Change language…" cannot
    // conjure a question out of a title that has no readings left to offer.
    const asks = !task.completed && !task.translationHidden
      && (changing || !task.translatedTitle)
      && this.asking(task);
    if (asks) info.append(this.buildAskRow(task));

    // Foreign-language title: the auto-translated English shows beneath it, unless
    // the user hid it with the 🌐 toggle (in the actions row).
    if (!asks && task.translatedTitle && !task.translationHidden) {
      const tr = el('div', {
        class: `task-translation${task.translationChosen ? ' chosen' : ''}`,
        // Provenance, and the two cases are genuinely different claims: one is the
        // app saying it read the title, the other is the app showing back an answer
        // the student gave it (Gabe, 8/20).
        title: task.translationChosen
          ? `You chose to read this as ${languageName(task.translatedLang || '')}`
          : `Translated from ${languageName(task.translatedLang || '')}`,
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
    // ONE CLICK opens the course/date editors, populated or empty (Gabe, 8/10).
    // They were dblclick when filled, which broke bulk editing: with a selection
    // active, the single click fell through to the row and toggled its selection,
    // so editing a batch took a double-click and often deselected the row first.
    // stopPropagation is what keeps the selection intact while the editor opens;
    // modifier clicks still pass through untouched, they are selection gestures.
    const editClick = (host: HTMLElement, open: () => void): void => {
      host.addEventListener('click', (e) => {
        if (e.shiftKey || e.ctrlKey || e.metaKey) return; // range/toggle select, not an edit
        e.stopPropagation();
        open();
      });
    };
    if (task.course) {
      const chip = el('span', { class: 'course-chip', text: task.course });
      chip.style.color = getCourseColor(task.course);
      editClick(chip, () => this.editCourse(task, chip));
      meta.append(chip);
    } else {
      // Uncategorized (e.g. an import the AI couldn't place) — offer a one-click tag.
      const chip = el('span', { class: 'course-chip empty', text: '+ course' });
      editClick(chip, () => this.editCourse(task, chip));
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
      editClick(dateEl, () => this.editDateTime(task, dateEl));
      meta.append(dateEl);
    } else {
      // Undated — offer a one-click affordance to set a due date (mirrors "+ course").
      meta.append(el('span', { class: 'meta-dot', text: '·' }));
      const dateEl = el('span', { class: 'meta-date empty', text: '+ due date' });
      editClick(dateEl, () => this.editDateTime(task, dateEl));
      meta.append(dateEl);
    }
    // (No "via Schoology" tag — the ↗ / ⓘ action buttons already mark imports,
    // and dropping it keeps the meta line uncluttered.)
    metaWrap.append(meta);

    // OVERDUE ONLY (Gabe, 8/10). TOD / TOM / "3d" are gone: the date is already
    // spelled out in the meta line beside this and the list is grouped by day,
    // so those three restated what two other things already said. OVR stays
    // because it is the one state the date alone doesn't shout: a past date
    // reads the same as any other until you do the arithmetic.
    const badge = dueBadge(task);
    if (badge?.state === 'OVR')
      metaWrap.append(el('span', { class: `task-due-badge ${badge.state}`, text: badge.label }));
    // Assessment badge — QUIZ / TEST / EXAM (BADGE_ASSESSMENT_RE).
    //
    // IMPORTED TASKS ONLY (Gabe, 8/21). The badge is a claim about what a piece of
    // work IS, made by pattern-matching its title, and on a title the student typed
    // themselves that claim is almost always unwanted: "test your hypothesis",
    // "study for the test" and "test the code" all earn a TEST pill for tasks that
    // are not tests. On a Schoology import the same pattern is reliable, because the
    // text is a teacher's assignment name and a real test is posted as one.
    //
    // So the badge follows the SOURCE of the words rather than the words alone. It
    // still checks at render time (covering old imports and translations), and the
    // hover ✕ still dismisses it for good, because even a teacher writes "practice
    // test" sometimes.
    const assess = task.source === 'manual' ? null :
      BADGE_ASSESSMENT_RE.exec(task.title) ||
      // The TRANSLATED title may only speak for a badge the student has not
      // rejected (Gabe, 8/20). The pill is the one output with no original beside
      // it: it says TEST on its own authority, from text the app guessed the
      // language of. If the student hid that translation with the globe, they have
      // said it was wrong, and a claim derived from it cannot outlive it.
      (task.translatedTitle && !task.translationHidden
        ? BADGE_ASSESSMENT_RE.exec(task.translatedTitle)
        : null);
    if (assess && !task.assessmentDismissed) {
      const word = assess[1].toLowerCase();
      // Singularize the plural forms: quizzes → quiz, tests → test.
      const label = (word === 'quizzes' ? 'quiz' : word.replace(/s$/, '')).toUpperCase();
      const pill = el('span', { class: 'task-test-badge', text: label });
      const x = el('button', { class: 'task-test-badge-x', text: '✕', title: 'Not actually a ' + label.toLowerCase() + '? Remove this badge' });
      x.addEventListener('click', (ev) => {
        ev.stopPropagation(); // the row itself has click/dblclick behaviors
        // PER TASK ON PURPOSE, never bulk (Gabe, 8/8). This pill isn't stored: it
        // is re-derived from the title on every render, and the only saved field
        // is this suppression flag. Across a selection the other rows either have
        // no badge (a permanent flag written for nothing, which would pre-silence
        // the badge if a teacher later renamed that task to "Unit 4 Test") or have
        // one for a DIFFERENT word, so dismissing "test" would silence "quiz".
        this.save({ ...task, assessmentDismissed: true });
      });
      pill.append(x);
      metaWrap.append(pill);
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

    // PRIORITY is always on the row (Gabe, 8/13), the third permanent control
    // after ↗ and ⓘ. It is the only way to change priority now that the strip is
    // dormant, so it cannot be optional or the setting would be unreachable.
    const prioBtn = el('button', { title: 'Priority', text: priorityDef(task.priority).arrow });
    prioBtn.style.color = priorityDef(task.priority).color;
    prioBtn.addEventListener('click', () => this.openPriority(task));
    actions.append(prioBtn);

    // The OPTIONAL tools. Each one is built here but only reaches the row if it
    // EARNS its slot; everything else waits in the "…" menu (see openMoreMenu).
    //
    // A control earns its slot by having real content behind it: a translation to
    // toggle, a link attached, a folder it belongs to. That rule is what makes the
    // row calm without asking the student to configure anything — the tasks that
    // use a feature show it, the ones that don't, don't. Pinning is the manual
    // override on top, for forcing an EMPTY control to stay put.
    const optional = this.rowActions(task);
    const pinned = getPrefs().tasks.pinnedActions;
    // `a.build` guards the buttonless one: 'readings' asks inside the translation row
    // rather than from the actions cluster, so it has nothing to append here.
    for (const a of optional) if (a.build && (a.auto || pinned.includes(a.id))) actions.append(a.build());

    // The "…" is ALWAYS present, even with nothing hidden: it is the only door to
    // the pin controls, so a stable door beats a row whose button count shifts.
    const more = el('button', { class: 'act-more', title: 'More', text: '⋯' });
    more.addEventListener('click', (e) => {
      e.stopPropagation(); // the row itself has click/dblclick behaviors
      this.openMoreMenu(task, more);
    });
    actions.append(more);

    bottom.append(actions);
    info.append(bottom);
    item.append(info);
    return item;
  }

  private fmtTime(hhmm: string): string {
    return formatTimeOfDay(hhmm); // honors the Time-format pref (12h/24h)
  }

  // --- multi-select (list mode) --------------------------------------------

  /**
   * Row click routing. TWO RULES, and that is the whole thing (Gabe, 8/19):
   *
   *   1. Click a row to select it. Click it again to deselect it.
   *   2. Shift+click to reach across a range. util/select.ts owns exactly what a
   *      range does, and is shared with Bookmarks and both Focus lists so the
   *      three cannot drift apart again.
   *
   * Ctrl/Cmd+click is kept as a synonym for a plain click, because muscle memory
   * from every file manager expects it to do something, and toggling is what it
   * does everywhere else too.
   *
   * File Explorer's exact model was tried on 8/19 and REVERTED the same day as
   * too much to hold in your head: there, shift REPLACES the selection from an
   * anchor that never moves, ctrl+shift ADDS instead, and a plain click collapses
   * everything to one row. Three modifiers with three different meanings is a
   * fine model for a file manager people use daily; it is too much for a task
   * list. Deselecting the same way you selected is the rule that needs no
   * explaining.
   *
   * Clicks on the row's own controls (buttons, links, editors, the ⋮⋮ handle)
   * are never selection gestures.
   */
  private onRowClick(task: Task, e: MouseEvent): void {
    if (this.mode !== 'list') return; // popover rows in calendar mode don't select
    const t = e.target as Element;
    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    // A MODIFIER-HELD CLICK IS ALWAYS A SELECTION GESTURE (Gabe, 8/20).
    //
    // The row's own controls swallow ordinary clicks, and they used to swallow
    // shift-clicks too. That is how "shift-clicking a new end point highlights the
    // one BEFORE it" happened: the card's buttons appear on hover, i.e. under the
    // cursor at the exact moment you go to click, so the shift-click hit a button,
    // nothing was selected, and the range still showed the previous end. Nobody
    // holds Shift to press a delete button, so the modifier settles it.
    if (!multi && t.closest('button, a, textarea, input, .task-handle, .inline-edit-block')) return;

    if (!multi && !this.selectedIds.size) return;
    e.preventDefault();
    window.getSelection()?.removeAllRanges(); // sweep away any text highlight a drag left behind
    if (e.shiftKey) {
      const ids = [...this.listEl.querySelectorAll<HTMLElement>('.task-item[data-task-id]')].map(
        (r) => r.dataset.taskId!
      );
      shiftSelect(ids, this.selectedIds, task.id);
    } else if (this.selectedIds.has(task.id)) {
      this.selectedIds.delete(task.id);
    } else {
      this.selectedIds.add(task.id);
    }
    this.syncSelectionUI();
  }

  private syncSelectionUI(): void {
    for (const row of this.listEl.querySelectorAll<HTMLElement>('.task-item[data-task-id]'))
      row.classList.toggle('selected', this.selectedIds.has(row.dataset.taskId!));
    // A selection is invisible state; the bar is how you find your way out of it.
    this.selBar ??= selectionBar('task', () => this.clearSelection(), this.sample?.host);
    this.selBar.update(this.selectedIds.size);
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.syncSelectionUI();
  }

  /** The tasks a toolbox action operates on: the WHOLE selection when the acted-on
   *  row is part of it, just that task otherwise (the File-Explorer rule). */
  private selTargets(task: Task): Task[] {
    if (this.selectedIds.has(task.id) && this.selectedIds.size > 1)
      return [...this.selectedIds].map((id) => this.map[id]).filter((t): t is Task => !!t);
    return [task];
  }

  /**
   * THE bulk-edit primitive: apply `mutate` to the acted-on task, or to the whole
   * selection when that row is part of one. EVERY task action routes through this,
   * so "it applies to the selection" is one rule, not a per-feature decision.
   *
   * A batch is ONE write (putTasksBulk), which matters: N separate writes would
   * fire N re-render notifications and make a 20-task edit crawl.
   *
   * The selection deliberately SURVIVES, so several edits can be made to the same
   * group in a row (set the course, then the priority, then the folder). Only
   * completion clears it, because those rows leave the list.
   */
  private applyToSelection(task: Task, mutate: (t: Task) => Task): void {
    const targets = this.selTargets(task);
    if (targets.length > 1) void this.data.putTasksBulk(targets.map(mutate));
    else this.save(mutate(task));
  }

  /** How many tasks the next action will hit. Popups show this so a bulk edit is
   *  never a surprise. */
  private selCount(task: Task): number {
    return this.selTargets(task).length;
  }

  /** A "Applies to N tasks" line for a popup, or nothing when it's a single task. */
  private bulkNote(task: Task): HTMLElement | null {
    const n = this.selCount(task);
    if (n < 2) return null;
    return el('div', { class: 'popup-bulk-note', text: `Applies to all ${n} selected tasks.` });
  }

  /** Complete every selected task in ONE write, with ONE undo for the batch —
   *  and the SAME exit animation the single check-off plays, on every row at
   *  once. This mirrors `complete()` step for step (animate → dissolve emptied
   *  folders → commit at 820ms → one undo toast); the only difference is that it
   *  does all of it to N rows instead of one. */
  private bulkComplete(): void {
    const tasks = [...this.selectedIds]
      .map((id) => this.map[id])
      .filter((t): t is Task => !!t && !t.completed);
    this.clearSelection();
    if (!tasks.length) return;
    playCompleteChime(); // ONE chime for the batch, not N overlapping ones
    const ids = new Set(tasks.map((t) => t.id));

    // Every selected row glides out together. The rows are found by id rather
    // than passed in, because only the clicked row's element was ever handed to
    // us. A row with no element (calendar popovers, or one scrolled out of a
    // virtualized list) simply completes without the animation.
    this.beginExitAnimation(); // hold every render until the glide + collapse lands
    for (const id of ids) {
      const row = this.listEl.querySelector<HTMLElement>(`.task-item[data-task-id="${id}"]`);
      if (row) this.animateRowOut(row);
      this.completingIds.add(id); // renders hide it while the write is pending
    }

    // FOLDERS: a folder finished off by this batch dissolves in the same breath,
    // exactly as in the single path. "Finished off" means every member is either
    // already completed or is in this batch, AND at least one member IS in this
    // batch (otherwise an untouched folder would be swept up).
    const dissolved: string[] = [];
    for (const folder of [...this.folders]) {
      const members = folderMembers(folder, this.map);
      if (!members.length || !members.some((m) => ids.has(m.id))) continue;
      if (!members.every((m) => m.completed || ids.has(m.id))) continue;
      const block = this.listEl.querySelector(`.task-folder[data-folder-id="${folder.id}"]`);
      if (block instanceof HTMLElement) collapseFolderBlock(block);
      this.folders = this.folders.filter((f) => f !== folder);
      this.openFolders.delete(folder.id);
      this.recentlyDissolved.set(folder.id, { folder, at: Date.now() });
      dissolved.push(folder.name);
    }
    if (dissolved.length) void saveTaskFolders(this.data, this.folders);

    // Commit after the full glide + collapse (~0.8s), same as the single path, so
    // the re-render that drops the rows can't interrupt the animation mid-flight.
    const now = new Date().toISOString();
    const commitTimer = window.setTimeout(() => {
      void Promise.resolve(
        this.data.putTasksBulk(tasks.map((t) => ({ ...t, completed: true, completedAt: now })))
      ).finally(() => {
        for (const id of ids) this.completingIds.delete(id);
      });
    }, 820);

    // COMPLETED, not "Deleted" (Gabe, 8/21). Checking the box is how a task leaves
    // the list, but calling that a deletion described the mechanism instead of what
    // the student did, and it reads like data loss for what is in fact the good
    // outcome. The row is retained either way (the daily lightbulb counts it).
    // Same vocabulary as the single-task toast, and dissolved folders ride along in
    // the one toast rather than firing their own.
    const base = `${tasks.length} task${tasks.length === 1 ? '' : 's'} completed`;
    const message = dissolved.length
      ? `${base} · 📁 ${dissolved.map((n) => `“${n}”`).join(', ')} dissolved`
      : base;
    showUndoToast(
      message,
      () => {
        clearTimeout(commitTimer); // a fast undo must not be clobbered by the pending commit
        for (const id of ids) this.completingIds.delete(id);
        this.animatingUntil = 0; // Undo cancels the exit — repaint at once, don't wait it out
        // The un-complete write triggers folderMaintenance, whose resurrection
        // path restores every just-dissolved folder along with its tasks.
        void this.data.putTasksBulk(tasks.map((t) => ({ ...t, completed: false, completedAt: null })));
      },
      () => {},
      this.sample?.host // landing preview → keep the toast inside the device frame
    );
  }

  // --- completion ---------------------------------------------------------

  /** The check-off exit: tick the box, glide the row aside while it fades, then
   *  collapse its height so the rows below ease up into the gap. The height is
   *  PINNED to its measured value first, because a collapse animation needs a
   *  from-value and `auto` isn't one. Shared by the single and bulk paths so a
   *  batch never looks different from one row. */
  private animateRowOut(row: HTMLElement): void {
    row.querySelector('.task-cb')?.classList.add('checked');
    const h = row.offsetHeight;
    row.style.height = `${h}px`;
    void row.offsetHeight; // force reflow so the collapse animates from full height
    row.classList.add('completing');
    requestAnimationFrame(() => {
      row.style.height = '0px';
      row.style.marginTop = '0px';
      row.style.marginBottom = '0px';
      row.style.paddingTop = '0px';
      row.style.paddingBottom = '0px';
    });
  }

  private complete(task: Task, animEl: HTMLElement): void {
    if (task.completed) return;
    // Checking a SELECTED row completes the whole selection (one write, one undo).
    if (this.selectedIds.has(task.id) && this.selectedIds.size > 1) {
      this.bulkComplete();
      return;
    }
    playCompleteChime();

    this.animateRowOut(animEl);
    this.beginExitAnimation(); // hold every render until the glide + collapse lands
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
      ? `“${name}” task completed · 📁 “${dissolvedFolderName}” dissolved`
      : `“${name}” task completed`;
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
        this.animatingUntil = 0; // Undo cancels the exit — repaint at once, don't wait it out
        this.save({ ...task, completed: false, completedAt: null });
        // The un-complete write triggers folderMaintenance, whose resurrection
        // path restores a just-dissolved folder along with this task.
      },
      () => {},
      this.sample?.host // landing preview → keep the toast inside the device frame
    );
  }

  // --- inline edits (double-click) ----------------------------------------

  private inlineEdit(
    host: HTMLElement,
    initial: string,
    commit: (value: string) => void,
    // Commit even when the text came back unchanged. Only ever set for a BULK
    // edit: `initial` is the acted-on row's value, so when the row you clicked
    // already reads "8/15", typing "8/15" to push that date onto the other four
    // selected tasks looked like a no-op and wrote nothing at all.
    commitUnchanged = false
  ): void {
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
      if (apply && (commitUnchanged || value !== initial.trim())) commit(value);
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

  /** ONE gate for every intrinsic-field editor (title / course / due date).
   *  Editing is UNLOCKED by default (Gabe, 8/6/26 — reversed from the original
   *  locked default); the Settings ▸ Tasks "Edit task details" switch can still
   *  freeze imports for anyone who wants what the teacher posted left alone. A
   *  locked click explains itself instead of dying silently. Subjective fields —
   *  priority, folders, attachments, done — are deliberately NOT behind this. */
  private editingUnlocked(): boolean {
    if (this.sample) return true; // the landing demo advertises editing — never lock it there
    if (getPrefs().tasks.allowEdit) return true;
    this.notice('✏️ Editing is off. Turn it on with “Edit task details” in Settings ▸ Tasks.');
    return false;
  }

  private editTitle(task: Task, host: HTMLElement): void {
    if (!this.editingUnlocked()) return;
    this.inlineEdit(host, task.title, (v) => {
      if (!v) return;
      // New title → drop the old translation and re-check it on the next pass.
      // Retyping the title of a selected row renames the WHOLE selection, which
      // is the one bulk edit worth pausing on: it is how you fix a batch of
      // badly-named imports in one move, and undo is a re-edit away.
      this.applyToSelection(task, (t) => clearTranslation({ ...t, title: v, _manualTitle: true }));
    });
  }

  private editDateTime(task: Task, host: HTMLElement): void {
    if (!this.editingUnlocked()) return;
    // One editor for both: shows "M/D h:mma" (or just "M/D" when there's no time).
    // Blur preserves; clearing the box deletes the date. A time is written only
    // when one is typed — iCal tasks keep their time, timeless ones stay timeless.
    const initial = task.dueDate
      ? task.dueTime
        ? `${formatShortDate(task.dueDate)} ${this.fmtTime(task.dueTime)}`
        : formatShortDate(task.dueDate)
      : '';
    this.inlineEdit(
      host,
      initial,
      (v) => {
        const { date, time } = parseDateTime(v);
        // Past dates are refused outright (see isPastDate): nothing is written
        // and the row keeps the date it had.
        if (isPastDate(date)) {
          this.notice(PAST_DATE_MSG);
          return;
        }
        // An hour earlier TODAY is overdue for the same reason a day is, and is
        // turned away the same way (Gabe, 8/19).
        if (isPastTime(date, time)) {
          this.notice(PAST_TIME_MSG);
          return;
        }
        // One due date onto every selected task: "these five are all due Friday".
        this.applyToSelection(task, (t) => {
          const next = { ...t, dueDate: date, dueTime: time, timeLabel: '', _manualDueDate: true };
          // manualOrder is an index WITHIN a due-date group, so it is meaningless
          // once the task changes date: it used to travel to the new day and seize
          // whatever slot that number happened to point at. Two tasks moved onto one
          // day could even land two pins in a group, which seatGroup then reads as
          // legacy data and discards wholesale, destroying the real pin too.
          if (t.dueDate !== date) delete next.manualOrder;
          return next;
        });
      },
      this.selCount(task) > 1 // bulk: retyping the same date still pushes it to the rest
    );
  }

  private editCourse(task: Task, host: HTMLElement): void {
    if (!this.editingUnlocked()) return;
    this.inlineEdit(
      host,
      task.course,
      (v) => {
        const course = v ? matchCourseStrict(v) : ''; // '' → renders "+ course"
        this.applyToSelection(task, (t) => ({ ...t, course, _manualCourse: true }));
        // The two learning side effects are PER TASK, so they run over the whole
        // selection: labelling ten assignments at once should teach ten times, not
        // once. (The write above is a single batch; only the teaching fans out.)
        for (const t of this.selTargets(task)) {
          // Remember the correction as GROUND TRUTH in the cloud label store, not just
          // on this task: it outranks anything the extension later scrapes, and it
          // reaches this student's other devices (a phone can fix a label too).
          void recordManualLabelForTask(this.data, t, course);
          // Layer 3 "Help our AI": reinforce the learned model with the words/phrases
          // of this assignment so the same kind auto-tags (confidently) next time.
          if (course) void learnCorrection(t.title, t.details || '', course);
        }
      },
      this.selCount(task) > 1 // bulk: retyping the same course still pushes it to the rest
    );
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
  /**
   * The language list changed → forget every stored verdict and check again.
   *
   * `translationChecked` is written onto the task and outlives the page, which is
   * what made the picker look broken (Gabe, 8/15): a task judged before a language
   * was turned on kept its old answer forever, so switching Portuguese on did
   * nothing to the Portuguese task already sitting there, and a translation made
   * back when everything was allowed stayed on screen after its language was
   * removed. Clearing the flag is what puts them back in front of the translator.
   *
   * ONE read, ONE bulk write. Looping a per-task helper here would re-read the
   * cache each time and silently drop most of the changes.
   */
  private async clearStoredVerdicts(): Promise<boolean> {
    // A reading the student CHOSE is not stale. Changing the language list changes
    // what the app can work out on its own; it does not un-answer a question a person
    // already answered.
    const stale = Object.values(this.map).filter(
      (t) => (t.translationChecked || t.translatedTitle) && !t.translationChosen
    );
    if (!stale.length) return false;
    await this.data.putTasksBulk(
      stale.map((t) => ({
        ...t,
        translatedTitle: '',
        translatedLang: '',
        translationChecked: false,
        translationAmbiguous: false,
      }))
    );
    return true;
  }

  private async autoTranslatePass(): Promise<void> {
    if (this.autoTx) return;
    // THE LANDING DEMO DOES NOT VOTE. It mounts this same view over an in-memory
    // sandbox, signed out, with prefs still at their defaults, and its sample tasks
    // arrive pre-translated. Letting it run meant it recorded the DEFAULT language
    // list as the signature for the whole browser, so the next real sign-in found a
    // mismatch and wiped every genuine translation (Gabe, 8/21). It has nothing to
    // translate and nothing to say about anyone's language list.
    if (this.sample) return;

    // THE LANGUAGE LIST IS PART OF THE ANSWER, so a stored answer is only valid for
    // the list that produced it. Comparing signatures here — rather than relying on
    // the Settings event alone — is what makes this hold even when the change was
    // made on another device, or while this view had never been mounted. Without it
    // the picker silently did nothing to tasks that already existed.
    const sig = getPrefs().tasks.translateFrom.join(',');
    // The two guards on the left of `&&` are not decoration. Recording the new
    // signature before the tasks were actually re-checked is a one-way door: the
    // rescan is skipped forever after, and the picker goes back to doing nothing.
    // So it is only recorded AFTER a successful clear, and never while this view is
    // still empty — a language changed before the task list has loaded (Settings is
    // its own tab) would otherwise burn the signature against zero tasks.
    const sigKey = txLangSigKey(this.data.uid);
    if (localStorage.getItem(sigKey) !== sig && Object.keys(this.map).length) {
      this.autoTx = true;
      try {
        const cleared = await this.clearStoredVerdicts();
        // Recorded only AFTER a successful clear, so a failure cannot skip the rescan
        // forever. But a THROW here is worse than either: the verdicts are already
        // gone and the signature is not written, so the next update wipes them again,
        // and the next, with no way out (localStorage throws on quota, and this
        // browser also holds up to 4 MB of account backups). Swallowing it costs one
        // extra rescan; letting it escape costs every translation, permanently.
        try {
          localStorage.setItem(sigKey, sig);
        } catch {
          /* full or blocked: the rescan below still runs, it just runs again later */
        }
        if (cleared) return; // the write comes back through watchTasks → this runs again
      } finally {
        this.autoTx = false;
      }
    }

    // BOTH SLOTS (Gabe, 8/22). The title and the description are read by the same
    // pass, because they are the same question asked of two pieces of text, and a
    // foreign assignment's instructions matter more than its name.
    const pending: Array<{ task: Task; slot: TxSlot }> = [];
    for (const t of Object.values(this.map)) {
      if (t.completed) continue;
      for (const slot of TX_SLOTS) {
        // A CHOSEN reading is never re-examined. The student answered the question the
        // auto pass could not, so re-asking it can only overwrite their answer with the
        // silence that prompted them in the first place (Gabe, 8/20).
        if (txText(t, slot) && !txChecked(t, slot) && !txChosen(t, slot)) pending.push({ task: t, slot });
      }
    }
    if (!pending.length) return;

    this.autoTx = true;
    const results: Array<{
      id: string; slot: TxSlot; text: string; translated: string; lang: string;
      ambiguous: boolean; detected: string;
    }> = [];
    try {
      for (const { task: t, slot } of pending) {
        const text = txText(t, slot);
        const r = await analyzeTitle(text);
        if (r.status === 'error') break; // offline / rate-limited → stop; retry next update
        results.push({
          id: t.id,
          slot,
          text,
          translated: r.status === 'foreign' ? r.text : '',
          lang: r.status === 'foreign' ? r.sourceLang : '',
          ambiguous: r.status === 'english' && !!r.ambiguous,
          detected: r.status === 'english' ? r.detected || '' : '',
        });
        await new Promise((res) => setTimeout(res, 150)); // gentle throttle
      }
    } finally {
      this.autoTx = false;
      // Merge onto the CURRENT tasks (skip any edited/removed mid-pass) and write
      // once. `this.map` being current is what makes this safe: a pass can run for
      // many seconds, so it must spread over the task as it stands NOW, not as it
      // stood when the pass began — otherwise a bulk edit that landed mid-pass gets
      // its new values written straight back to the old ones. (Data.putTasksBulk
      // publishes optimistically for exactly this reason.) The title check stays:
      // a retitled task's translation belongs to a title that no longer exists.
      // MERGED PER TASK, because one task can have produced a result for its title
      // AND its description in the same pass. Two separate spreads of `this.map[id]`
      // would each drop the other's answer.
      const merged = new Map<string, Task>();
      for (const r of results) {
        const base = merged.get(r.id) ?? this.map[r.id];
        // The text check stays: an edited task's reading belongs to words that are
        // gone.
        if (!base || txText(base, r.slot) !== r.text) continue;
        merged.set(
          r.id,
          txWrite(base, r.slot, {
            translated: r.translated,
            lang: r.lang,
            checked: true,
            ambiguous: r.ambiguous,
            detected: r.detected,
          })
        );
      }
      const writes = [...merged.values()];
      if (writes.length) await this.data.putTasksBulk(writes);
    }
  }

  // --- popups -------------------------------------------------------------

  /** The optional row controls, in row order, each knowing whether it has earned
   *  its slot (`auto`) and how to render both as a row button and as a menu entry. */
  private rowActions(task: Task): RowAction[] {
    const out: RowAction[] = [];
    const noteCount = task.notes?.length ?? 0;
    const inFolder = this.liveFolder(task);

    // THE GLOBE, for both things the translation row can be (Gabe, 8/21).
    //
    // It used to appear only once a translation existed, which left the OTHER state
    // with no control at all: a title the app could not place put a row of language
    // buttons on screen with nothing to toggle it, and an ✕ to dismiss it, so the
    // one row you could not turn off was the one that was only a question. Same
    // glyph, same slot, one meaning: show or hide the translation line, whether that
    // line is holding an answer or asking for one.
    //
    // `translationHidden` carries both, deliberately. It already meant "I do not want
    // this line", and a question is that line.
    // THE SAME TEST THE ROW ITSELF USES, and it has to be (Gabe, 8/21). This asked
    // only whether the title was ambiguous, and `translationAmbiguous` is written
    // once by the auto pass and never cleared — so when verification later came back
    // having found NO language that can read this title, the ask row went quiet (see
    // asking()) while the globe stayed on the row, toggling a line that no longer
    // exists. readings() is what both of them now agree on, which also covers the
    // emptied-language-picker case the old length check was here for.
    const askable = !task.translatedTitle && !!task.translationAmbiguous && this.readings(task).length > 0;
    if (task.translatedTitle || askable) {
      const shown = !task.translationHidden;
      const run = () => {
        // Target state computed ONCE from the clicked row, then written to all of
        // them. Flipping each task's own flag would leave a mixed selection mixed,
        // just inverted, which is not what a toggle means.
        const hidden = shown;
        // Hiding the line ends a change-language in progress too. Otherwise the
        // question would be waiting, invisible, and reappear on the next unhide over
        // a translation the student never asked to revisit again.
        if (hidden) for (const t of this.selTargets(task)) this.askingIds.delete(this.vkey(TITLE_SLOT, t.id));
        this.applyToSelection(task, (t) => ({ ...t, translationHidden: hidden }));
      };
      const label = task.translatedTitle
        ? shown ? 'Hide translation' : 'Show translation'
        : shown ? 'Hide language options' : 'Choose a language';
      out.push({
        id: 'translate',
        label,
        iconHtml: '🌐',
        auto: true,
        run,
        build: () => {
          const b = el('button', {
            class: `act-translate${shown ? ' active' : ''}`,
            title: label,
            text: '🌐',
          });
          b.addEventListener('click', run);
          return b;
        },
      });
    }

    // READINGS — NO BUTTON OF ITS OWN, and that is the point (Gabe, 8/21). A
    // dedicated glyph on the row announced a whole new feature; the question is not a
    // new feature, it is the translation line not knowing its language yet. So the
    // asking happens IN the translation row (see buildAskRow) and this entry exists
    // only in the … menu, for going back to the question after an answer is showing.
    // `auto: false` always: it must never claim a slot on the row.
    // ONLY WHEN IT HAS SOMETHING TO OFFER. An entry that explains why it cannot help
    // was tried and cut (Gabe, 8/21): a menu item whose only job is to apologise is
    // worse than no menu item, because the absence already says the same thing without
    // costing a press. readings() is the same test the 🌐 row uses, which is what
    // stops the menu opening a question the row then refuses to draw — and it is what
    // keeps the entry off ordinary English tasks entirely.
    if (task.title && this.readings(task).length) {
      out.push({
        id: 'readings',
        label: task.translatedTitle ? 'Change language…' : 'Translate from…',
        iconHtml: '🌐',
        auto: false,
        run: () => {
          this.askingIds.add(this.vkey(TITLE_SLOT, task.id));
          this.render();
        },
      });
    }

    // ATTACH — earns the row once the task actually has links on it.
    out.push({
      id: 'attach',
      label: noteCount ? `Attachments (${noteCount})` : 'Attachments',
      iconHtml: '📎',
      auto: noteCount > 0,
      run: () => this.openAttachments(task),
      build: () => {
        const b = el('button', { title: 'Attachments' });
        b.innerHTML = `📎${noteCount ? `<span class="attach-count">${noteCount}</span>` : ''}`;
        b.addEventListener('click', () => this.openAttachments(task));
        return b;
      },
    });

    // FOLDER — earns the row once the task belongs to one, and wears its color.
    out.push({
      id: 'folder',
      label: inFolder ? `Folder: ${inFolder.name}` : 'Add to folder',
      iconHtml: FOLDER_BTN_SVG,
      auto: !!inFolder,
      run: () => this.openFolderPicker(task),
      build: () => {
        const b = el('button', {
          class: 'act-folder',
          title: inFolder ? `Folder: ${inFolder.name}` : 'Add to folder',
        });
        b.innerHTML = FOLDER_BTN_SVG;
        if (inFolder) b.style.color = inFolder.color;
        b.addEventListener('click', () => this.openFolderPicker(task));
        return b;
      },
    });

    // PRIORITY is deliberately NOT here: it is a permanent row control now, so it
    // is neither hideable nor pinnable. See the action cluster in renderTask.

    // DUPLICATE — never auto. Kept (Gabe, 8/13: don't delete it), but off the row
    // by default: sitting one target away from ↗ Schoology, the button students
    // press constantly, made it a mis-tap that silently forges a second copy.
    out.push({
      id: 'duplicate',
      label: 'Duplicate',
      iconHtml: '⎘',
      auto: false,
      run: () => this.applyToSelection(task, (t) => duplicateTask(t)),
      build: () => {
        const b = el('button', { title: 'Duplicate', text: '⎘' });
        // Duplicating a selected row duplicates the whole selection.
        b.addEventListener('click', () => this.applyToSelection(task, (t) => duplicateTask(t)));
        return b;
      },
    });

    return out;
  }

  /** Persist a pinned-actions change: live cache first (so every open view
   *  repaints synchronously off PREFS_EVENT), then write. Mirrors SettingsView's
   *  savePrefs exactly — the pin is a real preference, not row-local state. */
  private async setPinned(next: PinnedAction[]): Promise<void> {
    const prefs = { ...getPrefs(), tasks: { ...getPrefs().tasks, pinnedActions: next } };
    setPrefsCache(structuredClone(prefs));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: prefs }));
    await this.data.setProfile('prefs', prefs);
  }

  /** An anchored dropdown hanging off `anchor`, instead of a centered modal
   *  (Gabe, 8/13: a dropdown reads more naturally for a row's own menu).
   *
   *  Positioning mirrors the popup idiom exactly: a full-cover backdrop catches the
   *  outside click, and the menu is placed relative to THAT backdrop's measured
   *  box. The backdrop is `fixed` in the real app and `absolute` inside a landing
   *  frame (see components.css), so measuring it instead of assuming the viewport
   *  is what makes one code path correct in both places. */
  private dropdown(anchor: HTMLElement, build: (body: HTMLElement, close: () => void) => void): void {
    const host = this.sample?.host ?? document.body;
    const back = el('div', { class: 'row-menu-back' });
    const menu = el('div', { class: 'row-menu' });
    back.append(menu);
    host.append(back);

    const close = () => {
      back.remove();
      document.removeEventListener('keydown', onKey, true);
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    document.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });

    build(menu, close);

    // Placed AFTER build so the menu has its real size to measure against.
    // Rects are VIEWPORT pixels, but left/top are written in the backdrop's
    // LOCAL pixels — inside a transform-scaled ancestor (the landing's device
    // frame) those differ by the scale factor, and writing scaled numbers put
    // the menu ~200px away from its ⋯ button. Divide the geometry back.
    const a = anchor.getBoundingClientRect();
    const b = back.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const s = back.offsetWidth > 0 ? b.width / back.offsetWidth : 1;
    const GAP = 6;
    // Right-aligned to the button (the "…" sits at the row's right edge, so a
    // left-aligned menu would immediately run off), then clamped inside the box.
    let left = (a.right - b.left - m.width) / s;
    left = Math.max(8, Math.min(left, back.offsetWidth - m.width / s - 8));
    // ALWAYS BELOW (Gabe, 8/21). It used to flip above when the row sat near the
    // bottom, which meant the same button opened in two different places depending on
    // how far down the list you happened to be: you learn where the menu appears, and
    // then for the last few rows it does not appear there. One direction, every time,
    // is worth more than never being clipped. The list scrolls, so a menu that runs
    // past the bottom edge can still be reached; a menu that moves cannot be aimed at.
    const top = (a.bottom - b.top + GAP) / s;
    menu.style.left = `${left}px`;
    menu.style.top = `${Math.max(8, top)}px`;
  }

  /** The row's "…" menu: the optional controls that are NOT already on the row,
   *  each runnable right here, each with a 📌 that promotes it onto the row.
   *
   *  A PIN, not a "+" (Gabe, 8/13): a "+" next to 📎 reads as "add an attachment",
   *  which is a completely different action one pixel away from this one. */
  private openMoreMenu(task: Task, anchor: HTMLElement): void {
    this.dropdown(anchor, (body, close) => {
      const note = this.bulkNote(task);
      if (note) body.append(note);
      const pinned = getPrefs().tasks.pinnedActions;

      // AUTO-promoted controls are left out entirely (Gabe, 8/13): the folder
      // button is already sitting on the row, so listing "Folder: Homework" in
      // here too was the same control offered twice. PINNED ones DO stay listed,
      // because their lit 📌 is the only way to unpin them again.
      const entries = this.rowActions(task).filter((a) => !a.auto);
      if (!entries.length) {
        body.append(el('div', { class: 'row-menu-empty', text: 'Everything is already on this task.' }));
        return;
      }

      for (const a of entries) {
        const row = el('div', { class: 'more-row' });

        // Left side: the action itself.
        const go = el('button', { class: 'more-go', title: a.label });
        const ico = el('span', { class: 'more-ico' });
        ico.innerHTML = a.iconHtml;
        if (a.iconColor) ico.style.color = a.iconColor;
        go.append(ico, el('span', { class: 'more-label', text: a.label }));
        go.addEventListener('click', () => {
          a.run();
          close();
        });

        // Right side: the pin. Only ever a real two-way toggle now, since anything
        // auto-promoted was filtered out above and never reaches this list.
        //
        // NO PIN for an action with no button. 'readings' asks its question inside the
        // translation row, so pinning it would light a 📌 against a control that
        // cannot appear on the row at all (Gabe, 8/21).
        if (!a.build) {
          row.append(go);
          body.append(row);
          continue;
        }
        const isPinned = pinned.includes(a.id);
        const pin = el('button', {
          class: `more-pin${isPinned ? ' on' : ''}`,
          text: '📌',
          title: isPinned ? 'Unpin from the task row' : 'Pin to the task row',
        }) as HTMLButtonElement;
        pin.addEventListener('click', () => {
          const next = isPinned ? pinned.filter((p) => p !== a.id) : [...pinned, a.id];
          void this.setPinned(next);
          close();
        });

        row.append(go, pin);
        body.append(row);
      }
    });
  }

  /** The app's modal card. The implementation moved to ui/popup.ts when the Task
   *  Archives needed the same one; this stays as the thin call-through so the many
   *  call sites below are untouched. `this.sample?.host` keeps a demo popup inside
   *  the device frame. */
  private popup(title: string, build: (body: HTMLElement, close: () => void) => void): void {
    openPopup(title, build, this.sample?.host);
  }

  /**
   * TASK PRO TIPS — every "did you know" the Tasks tab has, in one place.
   *
   * Each of these used to live wherever it happened to be relevant: Shift+click was
   * printed above the list, `f:` was written inside both folder pickers, and the
   * other two were not written down anywhere. Scattering them meant a tip was only
   * ever read by someone already in the situation it describes, which is a little
   * late to be learning the shortcut for it (Gabe, 8/22). Collected here they can be
   * read on purpose, once, from a button that is always in the same spot.
   *
   * Keep them SHORT and keep them things a student could not guess.
   */
  private openProTips(): void {
    const TIPS: Array<[string, string]> = [
      [
        'File a task as you type it',
        'Type f: followed by a folder name in the task bar, e.g. “essay f:English tmw”. The folder is created if it does not exist yet, and the same shortcut works in every Focus add box.',
      ],
      [
        'Foreign titles translate themselves',
        'A task written in a language you have enabled gets an English line under it automatically. Choose which languages in Settings ▸ Tasks ▸ Languages; anything not on that list is left exactly as written.',
      ],
      [
        'Select more than one task',
        'Shift+click a second task to select everything between the two, or Ctrl+click (⌘ on a Mac) to pick them out one at a time. Checking off, dating, filing or deleting any one of them does it to the whole selection.',
      ],
      [
        'Checked something off by mistake?',
        'Nothing you finish is thrown away. Open Task Archives from the filing-cabinet icon in the top bar, find it, and press Restore to put it back on your list.',
      ],
    ];
    this.popup('Task Pro Tips:', (body) => {
      const list = el('div', { class: 'protip-list' });
      for (const [head, text] of TIPS) {
        const tip = el('div', { class: 'protip' });
        tip.append(
          el('div', { class: 'protip-head', text: `💡 ${head}` }),
          el('div', { class: 'protip-body', text })
        );
        list.append(tip);
      }
      body.append(list);
    });
  }

  /**
   * The ✱ badge's popup: what Schoology changed, as a before/after.
   *
   * "Got it" is the dismiss that used to be the click on the badge itself. It sits
   * AFTER the diff for a reason — dismissing is what you do having read the thing,
   * and the old design made it what you did INSTEAD of reading it.
   *
   * PER TASK ON PURPOSE, never bulk (Gabe, 8/8). The sync writes this flag, not the
   * user, and it describes THIS assignment's specific changes. "Got it" means "I
   * read them", so bulk-dismissing would mark changes read that were never seen and
   * wipe the one signal that says which tasks to look at.
   */
  private openFeedDiff(task: Task): void {
    this.popup('What changed on Schoology', (body, close) => {
      body.append(
        buildFeedDiff(task) ??
          el('div', { class: 'fd-note', text: 'This task changed, but the earlier version was not recorded.' })
      );
      const row = el('div', { class: 'fd-actions' });
      const ok = el('button', { class: 'fd-dismiss', text: 'Got it' });
      ok.addEventListener('click', () => {
        const next = { ...task };
        delete next.feedUpdated; // delete, not undefined — Firebase rejects undefined
        delete next.feedPrev; // the ghost goes with the badge it belonged to
        void this.save(next);
        close();
      });
      row.append(ok);
      body.append(row);
    });
  }

  /**
   * The description, and its translation (Gabe, 8/22).
   *
   * THE SAME LINE THE TITLE GETS, in the same two exclusive states: the English
   * underneath when there is a reading, a row of language buttons when nobody could
   * place it or the student asked to change it. Not a second feature and not a second
   * implementation: buildAskRow and the translation line are handed the description
   * SLOT (see tasks/txSlot.ts) and behave exactly as they do for a title.
   *
   * The popup redraws itself on a task update, because the answer arrives
   * asynchronously: pressing a language writes to the task, and without this the
   * student would be looking at the version of the popup that existed before their
   * own press.
   */
  private openDetails(task: Task): void {
    const slot = DETAILS_SLOT;
    this.popup(task.title, (body) => {
      const draw = (): void => {
        const t = this.map[task.id] || task;
        body.replaceChildren();
        // Description ONLY (Gabe, 8/16): the popup used to append an "Open in
        // Schoology" button, but the row already carries the dedicated ↗, and the
        // duplicate here was clutter rather than a second feature.
        body.append(linkifyText(txText(t, slot), 'task-details-text'));

        const changing = this.askingIds.has(this.vkey(slot, t.id));
        const asks = !txHidden(t, slot) && (changing || !txTranslated(t, slot)) && this.asking(t, slot);
        if (asks) {
          body.append(this.buildAskRow(t, slot));
          return;
        }
        if (!txTranslated(t, slot) || txHidden(t, slot)) return;

        const tr = el('div', {
          class: `task-translation${txChosen(t, slot) ? ' chosen' : ''}`,
          title: txChosen(t, slot)
            ? `You chose to read this as ${languageName(txLang(t, slot))}`
            : `Translated from ${languageName(txLang(t, slot))}`,
        });
        tr.append(el('span', { class: 'task-translation-badge', text: '🌐' }));
        tr.append(linkifyText(txTranslated(t, slot), 'task-details-text'));
        body.append(tr);

        // CHANGE LANGUAGE, the same offer the title's ⋯ menu carries. Only shown when
        // there is another reading to change TO, so it can never be a press that
        // leads nowhere.
        if (this.readings(t, slot).length) {
          const change = el('button', {
            class: 'task-details-relang',
            text: '🌐 Change language…',
          });
          change.addEventListener('click', () => {
            this.askingIds.add(this.vkey(slot, t.id));
            draw();
          });
          body.append(change);
        }
      };
      const sig = (): string => {
        const t = this.map[task.id] || task;
        return [
          txText(t, slot),
          txTranslated(t, slot),
          txLang(t, slot),
          txHidden(t, slot),
          txChosen(t, slot),
          txAmbiguous(t, slot),
          txVerifiedFor(t, slot),
          Object.keys(txOptions(t, slot)).join(','),
          txRuledOut(t, slot).join(','),
          this.askingIds.has(this.vkey(slot, t.id)) ? '1' : '0',
        ].join(' ');
      };
      draw();
      // The press handler writes to the task; the redraw is how the popup shows it.
      // Held with its body so render() can tell whether the popup is still open, which
      // works for every way it can close (button, backdrop, Escape) without hooking
      // each of them.
      this.detailsRedraw = { body, draw, sig, last: sig() };
    });
  }

  private openPriority(task: Task): void {
    this.popup('Priority', (body, close) => {
      const note = this.bulkNote(task);
      if (note) body.append(note);
      for (const p of PRIORITIES) {
        const opt = el('button', { class: 'priority-option' });
        opt.append(el('span', { class: 'arrow', text: p.arrow }), el('span', { text: p.label }));
        (opt.firstChild as HTMLElement).style.color = p.color;
        opt.addEventListener('click', () => {
          // Acting on a selected row sets the priority on the WHOLE selection.
          this.applyToSelection(task, (t) => ({ ...t, priority: p.key as Priority }));
          close();
        });
        body.append(opt);
      }
    });
  }

  private openAttachments(task: Task): void {
    this.popup('Attachments', (body) => {
      const notes = (task.notes ?? []).map((n) => ({ ...n }));
      const editing = new Set<string>(); // note ids currently shown as editable inputs
      const list = el('div', { class: 'attach-list' });

      // BULK ATTACHMENTS APPEND, THEY DO NOT REPLACE (deliberate).
      //
      // Every other bulk action overwrites one field, so "apply to all" is
      // obvious. Attachments are different: each task owns a LIST, and each list
      // is usually different. Writing this popup's list onto ten tasks would
      // silently delete nine tasks' worth of links. So instead:
      //   • the popup shows and edits the CLICKED task's links, as always;
      //   • links ADDED here are copied onto the rest of the selection (fresh
      //     ids, since ids must be unique per task);
      //   • edits and deletes touch only the task whose row was opened, because
      //     the other tasks never had that link in the first place.
      const others = this.selTargets(task).filter((t) => t.id !== task.id);
      const startIds = new Set(notes.map((n) => n.id)); // what existed on open

      // AUTO-SAVE (Gabe, 8/7/26): attachments persist the moment they change,
      // the way Settings does. There is no Save button; every mutation (Done,
      // Remove, Delete, or blurring an edited field) writes through. Rows whose
      // URL is still empty are kept locally for editing but never persisted.
      const persist = (): void => {
        const cleaned = notes
          .filter((n) => n.url.trim())
          .map((n) => ({ ...n, url: normalizeUrl(n.url), title: n.title.trim() || n.url }));
        if (!others.length) {
          this.save({ ...task, notes: cleaned });
          return;
        }
        // Bulk: this task takes the edited list; the others take their own list
        // plus whatever was added here. `startIds` is what makes that split.
        const added = cleaned.filter((n) => !startIds.has(n.id));
        void this.data.putTasksBulk([
          { ...task, notes: cleaned },
          ...others.map((t) => ({
            ...t,
            notes: [
              ...(t.notes ?? []),
              // A fresh id per copy, and skip links that task already has, so
              // pressing Done twice doesn't attach the same URL twice.
              ...added
                .filter((n) => !(t.notes ?? []).some((e) => e.url === n.url))
                .map((n) => ({ ...n, id: 'n_' + genId() })),
            ],
          })),
        ]);
      };

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
          persist();
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
        // Enter in either field = Done for THIS card. `change` fires on blur, so
        // even closing the popup mid-edit still writes the field through first
        // (clicking anything else blurs the field): true auto-save, no Save button.
        for (const inp of [titleI, urlI]) {
          inp.setAttribute('data-enter-own', '1');
          inp.addEventListener('change', () => persist());
          inp.addEventListener('keydown', (e) => {
            if (e.key !== 'Enter' || e.shiftKey) return;
            e.preventDefault();
            done.click();
          });
        }
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
          persist();
          draw();
        });
        const done = el('button', { class: 'attach-done', text: 'Done' });
        done.addEventListener('click', () => {
          editing.delete(n.id);
          persist();
          draw();
        });
        actions.append(remove, done);

        item.append(fields, actions);
        requestAnimationFrame(() => titleI.focus());
        return item;
      };

      if (others.length)
        body.append(
          el('div', {
            class: 'popup-bulk-note',
            text: `Links you add here are copied to all ${others.length + 1} selected tasks.`,
          })
        );

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

      // Two DELIBERATELY separate launchers (Gabe, 8/7/26), so the user picks:
      //   Open all       = free, plain tabs, always.
      //   Open as group  = the PREMIUM one (gem cobalt blue): one named Chrome tab
      //                    group wearing the task's course color, via the
      //                    extension. Falls back to plain tabs if the extension
      //                    isn't there, so the button is never a dead end.
      // No Save button anymore: attachments auto-save (see persist above).
      const footer = el('div', { class: 'attach-footer' });
      const openAllBtn = el('button', {
        class: 'btn-primary',
        text: 'Open all',
        title: 'Open every link in its own tab',
      });
      openAllBtn.addEventListener('click', () => {
        if (!this.sample) openAll(notes);
      });
      // Stacked label (Gabe, 8/7/26): main line + a small qualifier, no star.
      const openGroupBtn = el('button', {
        class: 'btn-primary attach-open-group',
        title: 'Premium: opens every link as one named, colored Chrome tab group (needs the Cobalt extension)',
      });
      openGroupBtn.append(
        el('span', { text: 'Open all' }),
        el('span', { class: 'attach-open-group-sub', text: '(in a Chrome group)' })
      );
      openGroupBtn.addEventListener('click', () => {
        if (this.sample) return;
        // No silent fallback to plain tabs: a missing extension gets told WHY.
        if (!extensionActive()) {
          this.notice('Install the Cobalt extension to open links as one Chrome tab group.');
          return;
        }
        openAll(notes, { name: task.title, color: getCourseColor(task.course) });
      });
      footer.append(openAllBtn, openGroupBtn);

      // The pop-up blocker makes "Open all" look broken (one tab, silence), so
      // the fix-it guide lives right where the confusion happens.
      const guideBtn = popupGuideButton();
      guideBtn.style.margin = '12px 0 0';

      body.append(list, addBtn, footer, guideBtn);
    });
  }
}

/** Build a text block where any http(s) URL is a real, clickable link (new tab)
 *  instead of inert text — used by the ⓘ Description popup. Built with DOM nodes
 *  (never innerHTML), so the surrounding description text can't inject markup. */
export function linkifyText(text: string, cls: string): HTMLElement {
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
