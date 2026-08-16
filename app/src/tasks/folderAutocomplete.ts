// Cobalt: the "f:" folder autocomplete.
//
// Typing "f:" drops a menu of existing folders under the box. ↑/↓ move the
// highlight (wrapping), Tab or Enter completes the highlighted one, Esc closes,
// and a click accepts outright. While the menu is open it OWNS those keys; the
// host's own Enter handling resumes the moment it closes.
//
// Lifted out of quickadd.ts unchanged (Gabe, 8/15) so the Focus add boxes get the
// same menu instead of a second, subtly different implementation. The Tasks
// quick-add and both Focus boxes now run this exact code.

import type { TaskFolder } from '../types';
import { normFolder } from './folders';
import { el } from '../util/dom';

// While the name is still being TYPED it runs to the end of the input — that is
// when the autocomplete belongs on screen. Once a space follows, the folder is
// settled and the menu gets out of the way.
const TOKEN_TAIL_RE = /(^|\s)f:(\S*)$/i;

// The suggestion list simply FITS its folders (per Gabe — no grip here; the
// window adapts to however many there are). The CSS max-height is only a
// runaway guard for someone with dozens of folders.
const DROP_MATCHES = 12;

export interface FolderAutocomplete {
  /** Feed it keydown. Returns true when the open menu consumed the key, in which
   *  case the host must not also act on it (e.g. submit on Enter). */
  handleKeydown: (e: KeyboardEvent) => boolean;
  close: () => void;
}

/**
 * Attach the menu to `input`, hanging inside `wrap` (which must be positioned).
 * `getFolders` is read live, so a folder created moments ago is offered at once.
 */
export function attachFolderAutocomplete(
  input: HTMLInputElement | HTMLTextAreaElement,
  wrap: HTMLElement,
  getFolders: () => TaskFolder[]
): FolderAutocomplete {
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
    const folders = getFolders() ?? [];
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
      .slice(0, DROP_MATCHES);
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

  const handleKeydown = (e: KeyboardEvent): boolean => {
    if (!matches.length) return false;
    // ↑/↓ move the highlight and WRAP (per Gabe): past the bottom lands on the
    // first row, before the top lands on the last. The modulo is written
    // `(i + n) % n` because JS keeps the sign on a negative remainder.
    if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
      e.preventDefault(); // don't let the caret jump to the start/end of the input
      const step = e.key === 'ArrowDown' ? 1 : -1;
      hi = (hi + step + matches.length) % matches.length;
      renderDrop();
      drop.querySelector('.qa-folder-opt.active')?.scrollIntoView({ block: 'nearest' });
      return true;
    }
    // Tab COMPLETES the highlighted folder, shell-style — it never cycles through
    // them (per Gabe). Arrows move the highlight; clicking accepts outright.
    if (e.key === 'Tab' || e.key === 'Enter') {
      e.preventDefault();
      accept(matches[hi]);
      return true;
    }
    if (e.key === 'Escape') {
      closeDrop();
      return true;
    }
    return false;
  };

  return { handleKeydown, close: closeDrop };
}
