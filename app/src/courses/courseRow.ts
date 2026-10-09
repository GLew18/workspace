// Cobalt: one course row of the course editor (colour, name, parse words).
//
// ONE BUILDER, TWO SCREENS (Gabe, 10/8: "courses should look exactly the same").
// Settings ▸ Courses and the onboarding Courses screen both draw their rows here.
// Onboarding used to keep its own copy, which drifted: plain inputs instead of the
// wrapping textInput, so its "parse word" box ran to full width and fell onto a
// row of its own. A shared builder is the only way the two cannot drift again.
//
// The row only edits the CourseConfig it is handed. Persisting is the caller's job
// (`onSave`): Settings writes through immediately, onboarding holds a draft until
// its payoff screen commits it.

import { el, textInput } from '../util/dom';
import { attachColorPicker } from '../ui/colorPicker';
import { recommendedSet } from './recommend';
import type { CourseConfig } from '../types';

export interface CourseRowCtx {
  /** Every course in the list, for parse-word conflicts and recommendations. */
  all: () => CourseConfig[];
  /** Courses added in this session; only they show gold "+ word" suggestions. */
  isNew: (id: string) => boolean;
  /** Persist an edit (Settings) or do nothing (onboarding's draft). */
  onSave: () => void;
  /** Take the course out of the list. The row redraws the list afterwards. */
  onRemove: () => void;
  /** Rebuild the whole list. */
  redraw: () => void;
  /** After a parse word is added the list redraws, wiping focus. The course whose
   *  "+ parse word" box should get the cursor back, shared across redraws. */
  refocus: { id: string | null };
  /** Where the colour picker mounts; omitted = its default. */
  pickerHost?: () => HTMLElement | null | undefined;
}

/** Coerce any CSS color string to a #rrggbb the <input type=color> accepts. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9ca3af';
    ctx.fillStyle = color;
    if (/^#[0-9a-f]{6}$/i.test(ctx.fillStyle)) return ctx.fillStyle;
  }
  return '#9ca3af';
}

export function buildCourseRow(c: CourseConfig, ctx: CourseRowCtx): HTMLElement {
  const row = el('div', { class: 'course-row' });

  const color = el('button', { type: 'button', class: 'course-color', title: 'Course color' });
  attachColorPicker(color, {
    value: () => toHex(c.color),
    host: ctx.pickerHost,
    onChange: (hex) => {
      c.color = hex; // live preview while dragging in the picker
    },
    onClose: (changed) => {
      if (changed) ctx.onSave(); // persist when the picker closes
    },
  });

  const name = textInput({ class: 'course-name', value: c.name });
  name.addEventListener('input', () => {
    c.name = name.value;
    drawRecs(); // suggestions follow the name as it's typed
  });
  name.addEventListener('blur', () => ctx.onSave());

  const del = el('button', { class: 'course-del', title: 'Remove', text: '✕' });
  del.addEventListener('click', () => {
    ctx.onRemove();
    ctx.onSave();
    ctx.redraw();
  });

  const top = el('div', { class: 'course-row-top' });
  top.append(color, name, del);

  const chips = el('div', { class: 'parse-chips' });
  for (const w of c.parseWords) {
    const chip = el('span', { class: 'parse-chip', text: w });
    const x = el('button', { class: 'parse-chip-x', text: '×' });
    x.addEventListener('click', () => {
      c.parseWords = c.parseWords.filter((p) => p !== w);
      ctx.onSave();
      ctx.redraw();
    });
    chip.append(x);
    chips.append(chip);
  }

  // Recommended parse words (acronyms/abbreviations from the name) — shown only
  // for newly added courses, as distinct "+ word" suggestions to accept.
  const recsHost = el('div', { class: 'parse-recs' });
  const drawRecs = () => {
    recsHost.replaceChildren();
    if (!ctx.isNew(c.id)) return;
    const named = c.name.trim();
    if (!named || named.toLowerCase() === 'new course') return; // wait for a real name
    const used = new Set(ctx.all().flatMap((x) => x.parseWords));
    const recs = recommendedSet(named, used);
    if (!recs.length) return;
    for (const w of recs) {
      const rec = el('button', { class: 'parse-rec', title: `Add “${w}”` });
      rec.append(el('span', { class: 'parse-rec-plus', text: '+' }), el('span', { text: w }));
      rec.addEventListener('click', () => {
        if (!c.parseWords.includes(w)) c.parseWords.push(w);
        ctx.refocus.id = c.id; // land the cursor in the input for the next word
        ctx.onSave();
        ctx.redraw();
      });
      recsHost.append(rec);
    }
  };
  drawRecs();

  const err = el('div', { class: 'parse-error' });
  const wordInput = textInput({ class: 'parse-add', placeholder: 'parse word' });
  const addWord = (): void => {
    const w = wordInput.value.trim().toLowerCase();
    if (!w) {
      wordInput.focus();
      return;
    }
    const conflict = ctx.all().find((x) => x.id !== c.id && x.parseWords.includes(w));
    if (conflict) {
      err.textContent = `Already used in "${conflict.name}".`;
      return;
    }
    if (!c.parseWords.includes(w)) c.parseWords.push(w);
    ctx.refocus.id = c.id; // keep the cursor here for the next word
    ctx.onSave();
    ctx.redraw();
  };
  wordInput.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    addWord();
  });
  // The commit button (Gabe, 8/26 — "rather than it just being enter"). It sits
  // flush against the box as one pill so the pair reads as a single control and
  // not as a fourth chip type in a row that already has three. The + on the
  // placeholder and the + on the button are never on screen together: typing the
  // first character replaces one with the other.
  const addWordBtn = el('button', { type: 'button', class: 'parse-add-go', text: '+', title: 'Add parse word' });
  // mousedown cancels the focus move only; click does the work, so Space/Enter on
  // the focused button works too (see the note in tasks/render.ts).
  addWordBtn.addEventListener('mousedown', (e) => e.preventDefault());
  addWordBtn.addEventListener('click', () => addWord());
  const addWrap = el('div', { class: 'parse-add-wrap' });
  addWrap.append(wordInput, addWordBtn);

  // One chip row (artifact style): saved words, then gold "+ word" suggestions,
  // then the "+ parse word" input and its commit button — all flowing inline.
  chips.append(recsHost, addWrap);
  // After adding a word the whole list re-renders, wiping focus. If THIS course
  // is the one just edited, drop the cursor back into its "+ parse word" input so
  // several words can be typed in a row (Enter, type, Enter, type…) with no clicks.
  if (ctx.refocus.id === c.id) {
    ctx.refocus.id = null;
    requestAnimationFrame(() => wordInput.focus());
  }
  row.append(top, chips, err);
  return row;
}
