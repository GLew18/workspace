// Cobalt: quick-add input + submit guard (spec §6.2 finalize / tryAddTask).

import type { ParsedTask, TaskFolder } from '../types';
import { parseQuickAdd, isPastDate, PAST_DATE_MSG, isPastTime, PAST_TIME_MSG } from './parser';
import { attachFolderAutocomplete } from './folderAutocomplete';
import { el, textInput, showToast } from '../util/dom';

// The folder token is ONE WORD (per Gabe): "f:English" — everything after the
// next space belongs to the task title, wherever the token sits in the line. Use
// a hyphen for a multi-word name ("f:AP-Bio"); the matcher treats hyphens and
// underscores as spaces, so it still files into an existing "AP Bio".
const TOKEN_RE = /(^|\s)f:(\S*)/i;
// While the name is still being TYPED it runs to the end of the input — that is
// when the autocomplete belongs on screen. Once a space follows, the folder is
// settled and the menu gets out of the way.

// The suggestion list simply FITS its folders (per Gabe — no grip here; the
// window adapts to however many there are). The CSS max-height is only a
// runaway guard for someone with dozens of folders.

export function buildQuickAdd(
  onSubmit: (parsed: ParsedTask) => void,
  getFolders?: () => TaskFolder[]
): HTMLElement {
  const wrap = el('div', { class: 'quick-add' });
  const input = textInput({
    placeholder: 'Add a task… (natural language)',
    autocomplete: 'off',
    spellcheck: false,
  });
  // A VISIBLE + BESIDE THE BOX (Gabe, 8/26). Enter still submits and always will,
  // but Enter was the ONLY way in, and an empty box with a placeholder does not tell
  // you that. The Focus tab's two add boxes have carried this exact button since
  // 8/15 (.focus-add-btn) and nobody has to be told how those work; the same
  // affordance belongs on the bar that adds most of the tasks in the app.
  const addBtn = el('button', { class: 'quick-add-btn', type: 'button', text: '+', title: 'Add task' });
  // The input and the button share a flex row, and the row is a CHILD of .quick-add
  // rather than .quick-add itself: attachFolderAutocomplete hangs the "f:" menu off
  // the wrap and positions it at top:100%, so the wrap has to stay the full-width
  // positioned box the menu measures against.
  const row = el('div', { class: 'quick-add-row' });
  row.append(input, addBtn);
  wrap.append(row);

  // The "f:" folder menu, shared verbatim with the Focus add boxes.
  const folderAC = attachFolderAutocomplete(input, wrap, () => getFolders?.() ?? []);

  const flashInvalid = () => {
    input.classList.add('invalid');
    setTimeout(() => input.classList.remove('invalid'), 900);
  };

  /** Everything Enter used to do inline. The button and the key call the same
   *  function, so the two paths cannot drift. */
  const submit = (): void => {
    // "f:NAME" peels off BEFORE the normal parse, so the parser never sees it and
    // titles/dates/courses parse exactly as usual. The name is ONE WORD and the
    // token can sit anywhere: everything around it — including everything after
    // the space that ends it — is the task. That makes the split positional and
    // predictable ("essay f:English tmw vh" → folder English, title "essay",
    // tomorrow, ⇈) instead of depending on which trailing words the parser happens
    // to recognize, which is what the previous run-to-end-of-line rule required.
    let text = input.value;
    let folderName = '';
    const fm = text.match(TOKEN_RE);
    if (fm) {
      folderName = fm[2].trim();
      const before = text.slice(0, fm.index);
      const after = text.slice(fm.index! + fm[0].length);
      text = `${before} ${after}`.replace(/\s+/g, ' ').trim();
    }
    const parsed = parseQuickAdd(text);
    if (!parsed || !parsed.title.trim()) {
      flashInvalid();
      return;
    }
    if (folderName) parsed.folderName = folderName;
    // Past due dates are refused (see isPastDate). The typed text is LEFT IN
    // THE BOX so the date can be corrected instead of retyped from scratch.
    if (isPastDate(parsed.dueDate)) {
      flashInvalid();
      showToast(PAST_DATE_MSG);
      return;
    }
    // Same for a time earlier today — overdue is overdue (Gabe, 8/19).
    if (isPastTime(parsed.dueDate, parsed.dueTime)) {
      flashInvalid();
      showToast(PAST_TIME_MSG);
      return;
    }
    onSubmit(parsed);
    input.value = '';
    folderAC.close();
  };

  input.addEventListener('keydown', (e) => {
    // The open dropdown owns ↑ / ↓ / Tab / Enter / Esc.
    if (folderAC.handleKeydown(e)) return;
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
    submit();
  });
  // Same split as every other create button in the app (see tasks/render.ts):
  // mousedown cancels only the focus move, so the caret never leaves the box, and
  // `click` does the work, which is the event Space/Enter on a focused button fires.
  addBtn.addEventListener('mousedown', (e) => e.preventDefault());
  addBtn.addEventListener('click', () => {
    submit();
    input.focus(); // keyboard activation DOES move focus to the button — put it back
  });

  return wrap;
}
