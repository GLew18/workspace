// Cobalt: the shared "text + buttons" dialog — every popup in the app that is
// ONLY a title (plus, sometimes, one note line) and a row of buttons.
//
// One implementation, shared by every plain confirm/notice in the app (Settings ▸
// Sign out, replacing the calendar link, deleting a playlist, emptying the Task
// Archives, Bookmarks' delete confirm, Settings' single-button help card). It
// used to be copied by hand at each call site — and a hand-copied dialog is
// exactly the kind of thing that drifts until one of them stops matching (Gabe,
// 9/9: "all pop-ups that fit that category with text and buttons should look
// exactly like this").
//
// Styles: bm-backdrop/bm-modal/bm-modal-footer/bm-btn* (ui/bookmarks.css).
// Anything with an input, a list, a picker, a carousel, or an image is NOT this
// dialog — that is the advanced category, and it keeps its own bespoke markup.

import { el, fadeRemove } from '../util/dom';

export type ConfirmDialogButtonKind = 'cancel' | 'danger' | 'primary' | 'neutral';

export interface ConfirmDialogButton {
  label: string;
  kind: ConfirmDialogButtonKind;
  /** Omitted for a plain Cancel: closing the dialog is the whole job. */
  onClick?: () => void;
}

export interface ConfirmDialogOptions {
  title: string;
  /** A second line under the title, e.g. the list of names in a bulk delete. */
  note?: string;
  buttons: ConfirmDialogButton[];
  /** Extra class on the backdrop — a per-dialog single-instance guard (see
   *  confirmDanger below) and/or a z-index modifier for opening over another
   *  overlay (e.g. `above-focus`, see ui/bookmarks.css). */
  backdropClass?: string;
  /** Where to mount. Defaults to <body>. */
  host?: HTMLElement;
}

const KIND_CLASS: Record<ConfirmDialogButtonKind, string> = {
  cancel: 'bm-btn',
  neutral: 'bm-btn',
  primary: 'bm-btn bm-btn-primary',
  danger: 'bm-btn bm-btn-danger',
};

/** The shared text-and-buttons dialog. confirmDanger below is a thin wrapper
 *  over this for the common Cancel/destructive-Yes shape. */
export function confirmDialog(opts: ConfirmDialogOptions): void {
  if (opts.backdropClass && document.querySelector(`.bm-backdrop.${opts.backdropClass}`)) return;
  const back = el('div', { class: `bm-backdrop${opts.backdropClass ? ` ${opts.backdropClass}` : ''}` });
  const box = el('div', { class: 'bm-modal bm-modal-sm' });
  box.append(el('h3', { class: 'bm-modal-title', text: opts.title }));
  if (opts.note) box.append(el('div', { class: 'bm-modal-note', text: opts.note }));

  const close = () => fadeRemove(back);
  const row = el('div', { class: 'bm-modal-footer' });
  row.append(el('div', { class: 'bm-modal-spacer' }));
  let focusTarget: HTMLButtonElement | null = null;
  for (const b of opts.buttons) {
    const btn = el('button', { class: KIND_CLASS[b.kind], text: b.label }) as HTMLButtonElement;
    btn.addEventListener('click', () => {
      close();
      b.onClick?.();
    });
    row.append(btn);
    // Focus goes to Cancel when there is one — it pulls focus off whatever
    // trigger opened the dialog (the stacking bug: native Enter-activation
    // re-clicking a still-focused trigger button behind the backdrop) and, for
    // a destructive dialog, means a stray Enter hits Cancel, never Yes. With no
    // Cancel (a single-button notice like "Got it"), that one button gets
    // focus instead, so Enter/Space close it exactly like clicking would.
    if (b.kind === 'cancel') focusTarget = btn;
    else if (!focusTarget) focusTarget = btn;
  }
  box.append(row);
  back.append(box);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  // Escape always closes, self-cleaning once the dialog leaves the DOM.
  const onEsc = (e: KeyboardEvent) => {
    if (!back.isConnected) {
      document.removeEventListener('keydown', onEsc);
      return;
    }
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onEsc);
  (opts.host ?? document.body).append(back);
  focusTarget?.focus();
}

/** A can't-miss confirmation for destructive/sensitive changes: Cancel + a
 *  danger-styled confirm. Enter deliberately does NOT confirm here (Gabe,
 *  8/7/26): these are the consequential dialogs (sign out, change the calendar
 *  link, delete a playlist), so confirming must be a deliberate CLICK, never a
 *  reflexive keystroke — focus lands on Cancel, so a stray Enter is harmless. */
export function confirmDanger(title: string, onYes: () => void, yesLabel = 'Yes'): void {
  // Only one confirm can exist at a time (see the stacking-bug note above).
  confirmDialog({
    title,
    backdropClass: 'confirm-danger',
    buttons: [
      { label: 'Cancel', kind: 'cancel' },
      { label: yesLabel, kind: 'danger', onClick: onYes },
    ],
  });
}
