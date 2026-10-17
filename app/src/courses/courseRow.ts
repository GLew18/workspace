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
import { emailTeacherUrlFor, schoologyCourseUrl } from '../tasks/teachers';
import { MAIL_BTN_SVG, SCHOOLOGY_SVG } from '../tasks/rowIcons';

export interface CourseRowCtx {
  /** Every course in the list, for parse-word conflicts and recommendations. */
  all: () => CourseConfig[];
  /** Courses added in this session always show gold "+ word" suggestions; others show them while under 3 parse words. */
  isNew: (id: string) => boolean;
  /** Most suggestions to show at once; omitted = all of the set (Settings). */
  recLimit?: number;
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

function courseLink(cls: string, href: string, title: string, svg: string): HTMLElement {
  const a = el('a', { class: cls, href, target: '_blank', rel: 'noopener noreferrer', title, 'aria-label': title });
  a.innerHTML = svg;
  return a;
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
  // A rename is an edit of THIS course, not a new one: keep the old name as an alias
  // so the schedule or Schoology still saying it lands here (see CourseConfig.aliases).
  let startName = c.name;
  name.addEventListener('focus', () => {
    startName = c.name;
  });
  name.addEventListener('blur', () => {
    const was = startName.trim();
    const now = c.name.trim();
    if (was && now && was.toLowerCase() !== now.toLowerCase() && was.toLowerCase() !== 'new course') {
      const have = (c.aliases ??= []);
      if (!have.some((x) => x.toLowerCase() === was.toLowerCase())) have.push(was);
    }
    startName = c.name;
    ctx.onSave();
  });

  const del = el('button', { class: 'course-del', title: 'Remove', text: '✕' });
  del.addEventListener('click', () => {
    ctx.onRemove();
    ctx.onSave();
    ctx.redraw();
  });

  const top = el('div', { class: 'course-row-top' });
  // The row's toolbox: Schoology page, email to the teacher, then remove. One wrapper
  // so every child sits the same 2px apart (the Tasks toolbox spacing).
  const tools = el('div', { class: 'course-tools' });
  const sgyUrl = schoologyCourseUrl(c.name);
  if (sgyUrl) tools.append(courseLink('course-act course-act-sgy', sgyUrl, 'Open in Schoology', SCHOOLOGY_SVG));
  const mailUrl = emailTeacherUrlFor(c.name, c.name);
  if (mailUrl) tools.append(courseLink('course-act', mailUrl, 'Email teacher', MAIL_BTN_SVG));
  tools.append(del);
  top.append(color, name, tools);

  const chips = el('div', { class: 'parse-chips' });
  for (const w of c.parseWords) {
    const chip = el('span', { class: 'parse-chip', text: w });
    const x = el('button', { class: 'parse-chip-x', text: '✕' });
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
    // Always offered while the course has fewer than 3 parse words, new or not
    // (Gabe, 10/16): not picking them at creation must not hide them for good.
    if (!ctx.isNew(c.id) && c.parseWords.length >= 3) return;
    const named = c.name.trim();
    if (!named || named.toLowerCase() === 'new course') return; // wait for a real name
    const used = new Set(ctx.all().flatMap((x) => x.parseWords));
    const recs = recommendedSet(named, used).slice(0, ctx.recLimit ?? Infinity);
    if (!recs.length) return;
    // One press takes every suggestion (Gabe, 10/16), in Settings and in onboarding.
    if (recs.length > 1) {
      const all = el('button', { class: 'parse-rec parse-rec-all', title: 'Add every suggested parse word' });
      all.append(el('span', { class: 'parse-rec-plus', text: '+' }), el('span', { text: 'Add all' }));
      all.addEventListener('click', () => {
        for (const w of recs) if (!c.parseWords.includes(w)) c.parseWords.push(w);
        ctx.refocus.id = c.id;
        ctx.onSave();
        ctx.redraw();
      });
      recsHost.append(all);
    }
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
  // + FIRST (Gabe, 10/10), like the suggested words beside it ("+ lab").
  addWrap.append(addWordBtn, wordInput);

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
