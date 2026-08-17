// Cobalt: the selection bar.
//
// A small floating strip that appears the moment a multi-select exists and says how
// many things are picked, with a way out. It exists because a selection is INVISIBLE
// STATE: once several rows are outlined, every subsequent click means something
// different, and until now the only way to learn how to get out of it was to guess
// Escape or click empty space. Neither is discoverable.
//
// ONE implementation for Tasks and Bookmarks, deliberately. The two tabs already
// share the selection gesture (see tasks/render.ts onRowClick and bookmarks/view.ts
// onCardClick); a second bar drawn by a second file is how they would drift apart.

import { el } from './../util/dom';

export interface SelBar {
  /** Show with `n` selected, or hide when n < 2. Cheap to call on every change. */
  update(n: number): void;
  /** Give the bar up. Only the view that currently owns it can do this. */
  destroy(): void;
}

// ---- ONE bar, one node, shared by every view -------------------------------
//
// It has to be a true singleton rather than "one per view", because main.ts builds
// a fresh view on every visit to a tab and never tears the old one down. The first
// version let each view own a node and dropped the others, which produced exactly
// the bug Gabe caught on 8/16: switch to Tasks, come back to Bookmarks, and the bar
// still read "2 tasks selected" over thirteen selected LINKS — the Bookmarks view
// was faithfully updating a node that had been removed from the document, while the
// visible bar belonged to a Tasks view nobody was looking at.
//
// Now the node is module-level and the LABEL and the CLEAR HANDLER are re-pointed on
// every call, so whichever view asked most recently is the one it speaks for.
let node: HTMLElement | null = null;
let countEl: HTMLElement | null = null;
let noun = 'item';
let onClear: () => void = () => {};
// EVERY view's clear function, not just the last one to speak. Leaving a tab has to
// drop that tab's selection, and "that tab" is not always the one holding the bar —
// see dropSelections.
const clearers = new Set<() => void>();

let mountHost: HTMLElement | null = null; // re-pointed per selectionBar call (sample hosts)

function ensure(): HTMLElement {
  const want = mountHost ?? document.body;
  if (node?.isConnected && node.parentElement === want) return node;
  if (node?.isConnected) {
    want.append(node); // a different host asked — move the singleton, keep its state
    return node;
  }
  node = el('div', { class: 'selbar' });
  countEl = el('span', { class: 'selbar-count' });
  const clear = el('button', { class: 'selbar-clear', text: 'Deselect all' });
  clear.addEventListener('click', (e) => {
    e.stopPropagation(); // never let the click fall through and toggle a row
    onClear();
  });
  // The hint is what makes the bar teach rather than just report: the keyboard way
  // out is worth knowing, and there is nowhere else it could be written down.
  node.append(countEl, el('span', { class: 'selbar-hint', text: 'or press Esc' }), clear);
  node.hidden = true;
  (mountHost ?? document.body).append(node);
  return node;
}

/**
 * Drop every selection in the app and hide the bar. Called on every tab change.
 *
 * A selection belongs to the list it was made in, so leaving that list ends it
 * (Gabe, 8/16). Merely HIDING the bar was tried first and was not enough: the
 * Bookmarks view mounts asynchronously, so a mount already in flight when you
 * switched away would finish afterwards, repaint, and put the bar straight back —
 * which is how "3 links selected" ended up floating over the Tasks tab.
 *
 * Clearing removes the whole class of problem rather than racing it. It calls EVERY
 * registered view, not just whichever one last held the bar: Tasks and Bookmarks can
 * both be carrying a selection at once, and leaving should end both.
 */
export function dropSelections(): void {
  for (const clear of clearers) {
    try {
      clear();
    } catch {
      /* a torn-down view — its selection is gone with it either way */
    }
  }
  if (node) node.hidden = true;
}

/**
 * @param forNoun  what is being counted — 'task' / 'link'. Pluralized here.
 * @param clearFn  called when the student asks to deselect.
 */
export function selectionBar(forNoun: string, clearFn: () => void, host?: HTMLElement): SelBar {
  clearers.add(clearFn);
  const handle: SelBar = {
    update(n: number): void {
      // Re-point on EVERY update, not just at creation. Two views hold a handle to
      // the same bar, and the one reporting a count is by definition the one on
      // screen — so it owns the wording and the button until the other speaks up.
      noun = forNoun;
      onClear = clearFn;
      mountHost = host ?? null; // sample views keep the bar inside their own screen
      const bar = ensure();
      // Below two there is no "selection" worth announcing — one picked row behaves
      // like an ordinary row, and a bar for it would be noise on every click.
      bar.hidden = n < 2;
      if (countEl) countEl.textContent = `${n} ${noun}${n === 1 ? '' : 's'} selected`;
    },
    destroy(): void {
      clearers.delete(clearFn);
      // Only the view that last spoke may take the bar away, so a torn-down
      // Bookmarks view cannot yank the bar out from under a live Tasks selection.
      if (onClear !== clearFn) return;
      node?.remove();
      node = null;
      countEl = null;
    },
  };
  return handle;
}
