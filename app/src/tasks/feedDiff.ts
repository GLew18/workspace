// Cobalt: "what changed on Schoology", shown as a real before/after.
//
// The ✱ badge on an imported task used to be a tooltip listing the NAMES of the
// fields a re-sync had touched: "Changed on Schoology since import: name, due
// date". That tells a student something changed and then makes them work out what
// (Gabe, 8/22) — which, for a teacher who rewrote one clause of a three-paragraph
// assignment, is not a thing anyone will actually do.
//
// So the task keeps a GHOST of itself: the values as they stood the last time the
// student acknowledged it (Task.feedPrev, written by the sync). Clicking the ✱
// opens ONE merged version, with the words that went in green and the words that
// went out struck through in red, the way tracked changes read anywhere else.
//
// WHY THE OLDEST VALUE AND NOT THE PREVIOUS ONE: feedPrev holds the value from
// before the FIRST un-dismissed change, matching how feedUpdated accumulates. Three
// syncs in a row that each nudge the deadline should show "was Monday, now
// Thursday", not "was Wednesday, now Thursday" — the student is comparing against
// the last version they actually read.

import { el } from '../util/dom';
import { formatMetaDate, formatTimeOfDay } from '../util/dates';
import type { Task } from '../types';

/** The task fields a Schoology re-sync can alter, in the order they are shown. */
const FIELDS: Array<{ key: keyof FeedPrev; label: string; kind: 'text' | 'date' | 'time' | 'url' }> = [
  { key: 'title', label: 'Name', kind: 'text' },
  { key: 'dueDate', label: 'Due date', kind: 'date' },
  { key: 'dueTime', label: 'Due time', kind: 'time' },
  { key: 'details', label: 'Instructions', kind: 'text' },
  { key: 'schoologyUrl', label: 'Link', kind: 'url' },
];

/** The shape stored on the task. Kept here so the sync and the viewer agree. */
export interface FeedPrev {
  title?: string;
  dueDate?: string;
  dueTime?: string;
  details?: string;
  schoologyUrl?: string;
}

// #region The diff itself — word-level, longest common subsequence
/** Split into words AND the gaps between them, so rebuilding a run keeps spacing. */
function tokenize(s: string): string[] {
  return s.match(/\s+|[^\s]+/g) ?? [];
}

type Run = { text: string; state: 'same' | 'add' | 'del' };

/**
 * A word-level diff, by the textbook LCS table.
 *
 * Word-level rather than character-level on purpose: a character diff of a renamed
 * assignment picks out the letters two words happen to share and produces confetti.
 * Words are the unit a person reads a change in.
 *
 * BOUNDED, because instructions can be several thousand words and this table is
 * O(n·m): past the cap the two versions are shown whole, unhighlighted, which is
 * still the before/after the student came for.
 */
const MAX_TOKENS = 1200;

export function diffWords(before: string, after: string): { runs: Run[]; capped: boolean } {
  const a = tokenize(before);
  const b = tokenize(after);
  if (a.length > MAX_TOKENS || b.length > MAX_TOKENS) {
    return {
      runs: [
        { text: before, state: 'del' },
        { text: after, state: 'add' },
      ],
      capped: true,
    };
  }
  // lcs[i][j] = length of the longest common subsequence of a[i…] and b[j…].
  const lcs: number[][] = Array.from({ length: a.length + 1 }, () => new Array(b.length + 1).fill(0));
  for (let i = a.length - 1; i >= 0; i--) {
    for (let j = b.length - 1; j >= 0; j--) {
      lcs[i][j] = a[i] === b[j] ? lcs[i + 1][j + 1] + 1 : Math.max(lcs[i + 1][j], lcs[i][j + 1]);
    }
  }
  // Walk the table forward, emitting a run per token, then merge adjacent runs of
  // the same state so the DOM gets one span per stretch instead of one per word.
  const raw: Run[] = [];
  let i = 0;
  let j = 0;
  while (i < a.length && j < b.length) {
    if (a[i] === b[j]) raw.push({ text: a[i++], state: 'same' }), j++;
    else if (lcs[i + 1][j] >= lcs[i][j + 1]) raw.push({ text: a[i++], state: 'del' });
    else raw.push({ text: b[j++], state: 'add' });
  }
  while (i < a.length) raw.push({ text: a[i++], state: 'del' });
  while (j < b.length) raw.push({ text: b[j++], state: 'add' });

  const runs: Run[] = [];
  for (const r of raw) {
    const last = runs[runs.length - 1];
    if (last && last.state === r.state) last.text += r.text;
    else runs.push({ ...r });
  }
  return { runs, capped: false };
}
// #endregion

// #region Rendering
/** How a stored value is written out for a human. Dates and times are formatted the
 *  way the task row formats them, so the diff and the row agree. */
function display(kind: 'text' | 'date' | 'time' | 'url', v: string): string {
  if (!v) return '';
  if (kind === 'date') return formatMetaDate(v);
  if (kind === 'time') return formatTimeOfDay(v);
  return v;
}

/** ONE merged version (Gabe, 9/23): unchanged words plain, removed words struck
 *  through in red, added words in green, all in reading order. It replaced a "was"
 *  box stacked over a "now" box, which repeated every unchanged word twice. */
function diffLine(runs: Run[]): HTMLElement {
  const line = el('div', { class: 'fd-line' });
  for (const r of runs) {
    line.append(
      el('span', {
        class: r.state === 'same' ? 'fd-same' : r.state === 'del' ? 'fd-del' : 'fd-add',
        text: r.text,
      })
    );
  }
  if (!line.childElementCount) line.append(el('span', { class: 'fd-empty', text: '(nothing)' }));
  return line;
}

/**
 * IS THERE ANYTHING LEFT TO SHOW? The ✱ badge asks this before it draws itself.
 *
 * A field that was changed and then changed back is dropped from the popup (Gabe,
 * 8/22), so a task whose every recorded change was reverted has an empty popup and
 * should never have carried a badge in the first place. Answering the question here,
 * from the same code that builds the popup, is what keeps the two from disagreeing.
 */
export function hasFeedDiff(task: Task): boolean {
  // THE LEGACY FLAG STILL COUNTS. `feedUpdated` was a plain boolean before it was a
  // list of field names, and those tasks have no ghost and no field list, so the
  // parts below are empty for them. They are not unchanged, though: something did
  // change, it simply was not recorded, and the popup says exactly that. Without this
  // clause they would lose the badge, and with it the only route to the "Got it" that
  // clears the flag, so it would sit on the task for ever.
  if (task.feedUpdated && !Array.isArray(task.feedUpdated)) return true;
  const p = feedParts(task);
  return p.fields.length > 0 || p.leftovers.length > 0;
}

/** One field that genuinely reads differently now, as data rather than as markup. */
interface FeedPart {
  label: string;
  before: string;
  after: string;
}

/**
 * WHAT IS ACTUALLY DIFFERENT, with no DOM built.
 *
 * Separate from the rendering because hasFeedDiff runs on EVERY ROW of EVERY RENDER
 * to decide whether the ✱ belongs there. Building the whole popup, word-diff and all,
 * to answer a yes/no question is work that a 200-task list would do 200 times a
 * keystroke. The comparison is the cheap half; the word diff and the elements are
 * the expensive half, and only the popup needs those.
 */
function feedParts(task: Task): { fields: FeedPart[]; leftovers: string[] } {
  const prev = task.feedPrev;
  const fields: FeedPart[] = [];
  /** Fields the popup has SAID something about, so they are not reported twice. */
  const spokenFor = new Set<string>();
  for (const f of FIELDS) {
    if (!prev || prev[f.key] === undefined) continue;
    const before = display(f.kind, String(prev[f.key] ?? ''));
    const after = display(f.kind, String((task[f.key as keyof Task] as string | undefined) ?? ''));
    // A TEACHER WHO CHANGED SOMETHING AND PUT IT BACK. feedUpdated still lists the
    // field, because a real sync did touch it, and the ghost still holds its value.
    // But it reads exactly as it did before, so it is DROPPED ENTIRELY (Gabe, 8/22):
    // this popup answers "what is different now", and the honest answer for a
    // reverted field is nothing. It is still marked spokenFor, so the leftovers line
    // below does not then report it as an unrecorded change.
    spokenFor.add(f.label.toLowerCase());
    if (before === after) continue;
    fields.push({ label: f.label, before, after });
  }
  // Changes with no ghost behind them: attachments (which are appended, never
  // rewritten, so there is no "before" to show) and anything recorded by a sync
  // that ran before this feature existed. Measured against what the popup has
  // ALREADY spoken for, not against what the ghost happens to hold a key for.
  //
  // Array.isArray, NOT `?? []`. `feedUpdated` was a plain flag before it was a list
  // of field names, and a task carrying the old shape is exactly the task this
  // branch exists for: `(true).filter` would throw inside the popup's build
  // callback, leaving a titled empty card with no diff and no way to dismiss the
  // badge. Both other readers of this field guard it the same way.
  const changed = Array.isArray(task.feedUpdated) ? task.feedUpdated : [];
  return { fields, leftovers: changed.filter((c) => !spokenFor.has(String(c).toLowerCase())) };
}

/**
 * The body of the "what changed" popup. Returns null when there is nothing left to
 * show: no recorded ghost at all, or every recorded change turned out to be a
 * revert. Callers treat null as "this task did not really change".
 */
export function buildFeedDiff(task: Task): HTMLElement | null {
  const { fields, leftovers } = feedParts(task);
  // Nothing to say, including the case where EVERY listed change turned out to be a
  // revert. Returning null is what makes the caller treat the task as unchanged.
  if (!fields.length && !leftovers.length) return null;

  const blocks: HTMLElement[] = [];
  for (const f of fields) {
    const { runs, capped } = diffWords(f.before, f.after);
    const block = el('div', { class: 'fd-block' });
    block.append(el('div', { class: 'fd-label', text: f.label }));
    const box = el('div', { class: 'fd-side' });
    box.append(diffLine(runs));
    block.append(box);
    if (capped) {
      block.append(
        el('div', {
          class: 'fd-note',
          text: 'Too long to highlight word by word, so the old version is struck through in full, followed by the new one.',
        })
      );
    }
    blocks.push(block);
  }

  const body = el('div', { class: 'fd-body' });
  for (const b of blocks) body.append(b);
  if (leftovers.length) {
    body.append(
      el('div', {
        class: 'fd-note fd-leftovers',
        // No em dash: a comma does the job (Gabe's rule).
        text: blocks.length
          ? `Also changed, with no earlier version recorded: ${leftovers.join(', ')}.`
          : `Changed on Schoology: ${leftovers.join(', ')}. The earlier version was not recorded, so there is nothing to compare against.`,
      })
    );
  }
  return body;
}
// #endregion
