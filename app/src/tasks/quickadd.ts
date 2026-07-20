// WorkSpace — quick-add input + submit guard (spec §6.2 finalize / tryAddTask).

import type { ParsedTask, TaskFolder } from '../types';
import { parseQuickAdd } from './parser';
import { todayStr } from '../util/dates';
import { el, textInput } from '../util/dom';

const TOKEN_RE = /(^|\s)f:(.*)$/i; // the folder token runs to the end of the line

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
    matches.forEach((f, i) => {
      const row = el('button', { class: `qa-folder-opt${i === hi ? ' active' : ''}`, type: 'button' });
      row.innerHTML = `<svg viewBox="0 0 24 24" width="13" height="13" fill="${f.color}"><path d="M3 6a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v10a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>`;
      row.append(el('span', { text: f.name }));
      // mousedown (not click) so choosing a row beats the input's blur.
      row.addEventListener('mousedown', (e) => {
        e.preventDefault();
        accept(f);
      });
      drop.append(row);
    });
    drop.classList.toggle('open', matches.length > 0);
  };
  const accept = (f: TaskFolder): void => {
    const m = input.value.match(TOKEN_RE);
    if (m) input.value = input.value.slice(0, m.index! + m[1].length) + 'f:' + f.name;
    closeDrop();
    input.focus();
  };
  const refreshDrop = (): void => {
    const folders = getFolders?.() ?? [];
    const m = input.value.match(TOKEN_RE);
    if (!m || !folders.length) {
      closeDrop();
      return;
    }
    const part = m[2].trim().toLowerCase();
    matches = folders
      .filter((f) => f.name.toLowerCase().includes(part))
      // prefix matches float above mere substring hits
      .sort(
        (a, b) =>
          Number(b.name.toLowerCase().startsWith(part)) - Number(a.name.toLowerCase().startsWith(part))
      )
      .slice(0, 6);
    // The name is already complete → nothing to suggest; let Enter submit.
    if (matches.length === 1 && matches[0].name.toLowerCase() === part) {
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
    // The open dropdown owns Tab / arrows / Enter / Esc.
    if (matches.length) {
      if (e.key === 'Tab') {
        e.preventDefault();
        hi = (hi + (e.shiftKey ? -1 : 1) + matches.length) % matches.length;
        renderDrop();
        return;
      }
      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
        e.preventDefault();
        hi = (hi + (e.key === 'ArrowDown' ? 1 : -1) + matches.length) % matches.length;
        renderDrop();
        return;
      }
      if (e.key === 'Enter') {
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
    // "f:NAME" (anywhere after a space; runs to the END of the line, so folder
    // names can have spaces — put it last) peels off BEFORE the normal parse:
    // the parser never sees it, so titles/dates/courses parse exactly as usual.
    let text = input.value;
    let folderName = '';
    const fm = text.match(TOKEN_RE);
    if (fm) {
      folderName = fm[2].trim();
      text = text.slice(0, fm.index).trim();
      // Parse words typed AFTER the folder name belong to the TASK, not the
      // name ("f:Essays vh" → folder "Essays", priority ⇈). Peel recognized
      // tokens off the name's tail and hand them back to the parser. A token
      // counts as recognized when the REAL parser consumes it out of a probe
      // title — same vocabulary as everywhere, nothing duplicated here.
      const words = folderName.split(/\s+/).filter(Boolean);
      const returned: string[] = [];
      while (words.length) {
        const probe = parseQuickAdd('zzqx ' + words[words.length - 1]);
        if (probe && probe.title.trim() === 'zzqx') returned.unshift(words.pop()!);
        else break;
      }
      folderName = words.join(' '); // may end up empty ("f:vh") → no folder at all
      if (returned.length) text = `${text} ${returned.join(' ')}`.trim();
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
