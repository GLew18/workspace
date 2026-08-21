// Cobalt: naming a folder, wherever a folder gets named.
//
// Two rules live here rather than in each picker, because there are four places a
// folder can be named (the Tasks picker, the Focus picker, and the folder head in
// either tab) and a rule enforced in three of them is not a rule.

import { el, textInput, showToast, copyTextMetrics, autoWidthToText } from '../util/dom';
import type { TaskFolder } from '../types';

/**
 * ONE WORD, NO SPACES (Gabe, 8/20).
 *
 * Not a style preference: the quick-add shortcut is `f:NAME` and it reads a single
 * run of non-space characters (FOCUS_FOLDER_RE in parser.ts, and the same token in
 * quickadd.ts). So a folder called "john lock" is a folder the task bar cannot file
 * anything into. It exists, it works by mouse, and the one feature the picker itself
 * advertises at the bottom of the menu quietly does not apply to it.
 *
 * Rather than let that be discovered later, spaces are refused at the moment they
 * are typed, with a line saying why. "john-lock" and "johnlock" both work.
 */
export const FOLDER_SPACE_MSG = '📁 Folder names can’t contain spaces: f: reads one word. Try a dash.';

/** Everything that counts as a space, including the ones a paste can smuggle in.
 *  Two of them: a /g regex carries a lastIndex, so .test() on one alternates
 *  true/false across calls and would let every second space through. */
const SPACE_STRIP = /\s+/g;
const HAS_SPACE = /\s/;

/** The name as it will actually be stored. */
export function cleanFolderName(name: string): string {
  return name.replace(SPACE_STRIP, '').trim();
}

/**
 * Refuse spaces in a folder-name field, and say so once per attempt.
 *
 * Handles the two ways a space gets in: typed (caught on keydown, so the caret never
 * moves) and pasted (caught on input, where the whole run is stripped at once and
 * the caret is put back where the text now ends). The toast is throttled, so pasting
 * "one two three four" explains itself once instead of four times.
 */
export function guardFolderNameField(
  field: HTMLTextAreaElement | HTMLInputElement,
  host?: HTMLElement
): void {
  let lastWarn = 0;
  const warn = (): void => {
    const now = Date.now();
    if (now - lastWarn < 1200) return;
    lastWarn = now;
    showToast(FOLDER_SPACE_MSG, host ?? document.body);
  };
  // Cast: `field` is a union of two element types, so addEventListener falls back
  // to the generic Event overload and loses `key`.
  field.addEventListener('keydown', (e) => {
    const key = (e as KeyboardEvent).key;
    if (key !== ' ' && key !== 'Spacebar') return;
    e.preventDefault();
    e.stopPropagation(); // inline editors inside a <button> type the space themselves
    warn();
  });
  field.addEventListener('input', () => {
    if (!HAS_SPACE.test(field.value)) return;
    const before = field.value.slice(0, field.selectionStart ?? field.value.length);
    field.value = cleanFolderName(field.value);
    const caret = cleanFolderName(before).length;
    field.setSelectionRange(caret, caret);
    warn();
  });
}

/**
 * The name to actually store, given what was typed, saying so if it had to change.
 *
 * For the rename editors that are SHARED with titles, courses and dates (TasksView's
 * inlineEdit, FocusView's inlineTodoEdit), where the space key legitimately types a
 * space. Those cannot refuse the key, so the folder rule is applied at the commit
 * instead: same outcome, same explanation, one line at the call site.
 */
export function acceptFolderName(typed: string, host?: HTMLElement): string {
  const clean = cleanFolderName(typed);
  if (clean !== typed.trim()) showToast(FOLDER_SPACE_MSG, host ?? document.body);
  return clean;
}

/**
 * Rename a folder from inside a picker menu, in place.
 *
 * The pickers deliberately do NOT reuse TasksView.inlineEdit: that one ends by
 * re-rendering the list behind the popup, which is the wrong surface here (the
 * popup is what the student is looking at) and it inserts spaces on purpose, which
 * is exactly what a folder name may not have.
 *
 * `label` is the <span> holding the name inside the row button. It is swapped for an
 * editor and swapped back on Enter, Escape or blur.
 */
export function renameFolderInline(
  label: HTMLElement,
  folder: TaskFolder,
  save: (name: string) => void,
  host?: HTMLElement
): void {
  if (label.parentElement?.querySelector('.inline-edit-block')) return; // already editing
  const input = textInput({ class: 'inline-edit-block', value: folder.name });
  copyTextMetrics(input, label);
  label.replaceWith(input);
  autoWidthToText(input);
  input.addEventListener('input', () => input.rewrap());
  guardFolderNameField(input, host);
  // A real double-click's native word-selection is the event's default action, and
  // it blurs a freshly focused textarea. A microtask runs after it, so focus sticks.
  queueMicrotask(() => {
    input.focus();
    input.select();
  });
  let done = false;
  const finish = (apply: boolean): void => {
    if (done) return;
    done = true;
    const value = cleanFolderName(input.value);
    if (apply && value && value !== folder.name) {
      folder.name = value;
      save(value);
    }
    const back = el('span', { class: label.className, text: folder.name });
    input.replaceWith(back);
    wireRename(back, folder, save, host);
  };
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') {
      e.preventDefault();
      e.stopPropagation(); // popups treat Enter as "confirm" — this one is a commit
      finish(true);
    }
    if (e.key === 'Escape') {
      e.stopPropagation(); // …and Escape as "close". Cancel the edit, keep the menu.
      finish(false);
    }
  });
  input.addEventListener('blur', () => finish(true));
  // The row is a <button>: without this its click would fire the moment the editor
  // is clicked into, filing the task and closing the menu mid-rename.
  input.addEventListener('click', (e) => e.stopPropagation());
  input.addEventListener('dblclick', (e) => e.stopPropagation());
}

/** Double-click a picker row's name to rename the folder. Rebound after each edit,
 *  since the label element is replaced rather than reused. */
export function wireRename(
  label: HTMLElement,
  folder: TaskFolder,
  save: (name: string) => void,
  host?: HTMLElement
): void {
  label.title = 'Double-click to rename';
  label.addEventListener('dblclick', (e) => {
    e.preventDefault();
    e.stopPropagation();
    renameFolderInline(label, folder, save, host);
  });
}
