// WorkSpace — quick-add input + submit guard (spec §6.2 finalize / tryAddTask).

import type { ParsedTask, TaskFolder } from '../types';
import { parseQuickAdd } from './parser';
import { normFolder } from './folders';
import { todayStr } from '../util/dates';
import { el, textInput } from '../util/dom';

// The folder token is ONE WORD (per Gabe): "f:English" — everything after the
// next space belongs to the task title, wherever the token sits in the line. Use
// a hyphen for a multi-word name ("f:AP-Bio"); the matcher treats hyphens and
// underscores as spaces, so it still files into an existing "AP Bio".
const TOKEN_RE = /(^|\s)f:(\S*)/i;
// While the name is still being TYPED it runs to the end of the input — that is
// when the autocomplete belongs on screen. Once a space follows, the folder is
// settled and the menu gets out of the way.
const TOKEN_TAIL_RE = /(^|\s)f:(\S*)$/i;

// The suggestion list simply FITS its folders (per Gabe — no grip here; the
// window adapts to however many there are). The CSS max-height is only a
// runaway guard for someone with dozens of folders.
const QA_DROP_MATCHES = 12;

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
  wrap.append(input);

  // --- "f:" folder autocomplete --------------------------------------------
  // Typing "f:" drops a menu of the existing folders under the box. Tab (and
  // the arrows) cycle the highlight, Enter or a click fills the name in, Esc
  // closes. While the menu is open it owns those keys; Enter goes back to
  // submitting the task the moment it's closed.
  const drop = el('div', { class: 'qa-folder-drop' });
  wrap.append(drop);
  let matches: TaskFolder[] = [];
  let hi = 0; // highlighted row

  const closeDrop = (): void => {
    matches = [];
    drop.classList.remove('open');
    drop.replaceChildren();
  };
  const renderDrop = (): void => {
    drop.replaceChildren();
    // The options live in their own scroller so the grip below can resize it.
    // Rebuilt on every keystroke, so the saved height is re-applied each time.
    const list = el('div', { class: 'qa-folder-list' });
    matches.forEach((f, i) => {
      const row = el('button', { class: `qa-folder-opt${i === hi ? ' active' : ''}`, type: 'button' });
      row.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="${f.color}"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
      row.append(el('span', { text: f.name }));
      // mousedown (not click) so choosing a row beats the input's blur.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        accept(f);
      });
      list.append(row);
    });
    drop.append(list);
    drop.classList.toggle('open', matches.length > 0);
  };
  const accept = (f: TaskFolder): void => {
    const m = input.value.match(TOKEN_TAIL_RE);
    // Hyphenate a legacy multi-word folder on the way in, so the one-word token
    // still round-trips to the right folder instead of filing under its first word.
    if (m) input.value = input.value.slice(0, m.index! + m[1].length) + 'f:' + f.name.trim().replace(/\s+/g, '-');
    closeDrop();
    input.focus();
  };
  const refreshDrop = (): void => {
    const folders = getFolders?.() ?? [];
    const m = input.value.match(TOKEN_TAIL_RE);
    if (!m || !folders.length) {
      closeDrop();
      return;
    }
    // Compare hyphen-insensitively, so typing "AP-B" still finds "AP Bio".
    const part = normFolder(m[2]);
    matches = folders
      .filter((f) => normFolder(f.name).includes(part))
      // prefix matches float above mere substring hits
      .sort(
        (a, b) =>
          Number(normFolder(b.name).startsWith(part)) - Number(normFolder(a.name).startsWith(part))
      )
      .slice(0, QA_DROP_MATCHES);
    // The name is already complete → nothing to suggest; let Enter submit.
    if (matches.length === 1 && normFolder(matches[0].name) === part) {
      closeDrop();
      return;
    }
    hi = 0;
    renderDrop();
  };
  input.addEventListener('input', refreshDrop);
  input.addEventListener('blur', () => window.setTimeout(closeDrop, 120));

  const flashInvalid = () => {
    input.classList.add('invalid');
    setTimeout(() => input.classList.remove('invalid'), 900);
  };

  input.addEventListener('keydown', (e) => {
    // The open dropdown owns ↑ / ↓ / Tab / Enter / Esc.
    if (matches.length) {
      // ↑/↓ move the highlight and WRAP (per Gabe): past the bottom lands on the
      // first row, before the top lands on the last. The modulo below is written
      // `(i + n) % n` rather than a plain `%` because JS keeps the sign on a
      // negative remainder, so -1 % 3 is -1, not 2.
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault(); // don't let the caret jump to the start/end of the input
        const step = e.key === 'ArrowDown' ? 1 : -1;
        hi = (hi + step + matches.length) % matches.length;
        renderDrop();
        // Keep the highlight visible when the list is scrolled (it's resizable, so
        // the matches can outrun the visible box).
        drop.querySelector('.qa-folder-opt.active')?.scrollIntoView({ block: 'nearest' });
        return;
      }
      // Tab COMPLETES the highlighted folder, shell-style — it never cycles
      // through them (per Gabe). Arrow keys are what move the highlight now;
      // clicking a row still accepts it outright.
      if (e.key === 'Tab' || e.key === 'Enter') {
        e.preventDefault();
        accept(matches[hi]);
        return;
      }
      if (e.key === 'Escape') {
        closeDrop();
        return;
      }
    }
    if (e.key !== 'Enter' || e.shiftKey) return;
    e.preventDefault();
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
    if (parsed.dueDate && parsed.dueDate < todayStr()) {
      flashInvalid(); // reject past due dates
      return;
    }
    onSubmit(parsed);
    input.value = '';
    closeDrop();
  });

  return wrap;
}
