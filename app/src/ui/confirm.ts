// Cobalt: the red "are you sure?" dialog.
//
// One implementation, shared by every consequential action in the app (Settings ▸
// Sign out, replacing the calendar link, deleting a playlist, emptying the Task
// Archives). It lived as a private method on SettingsView until the Archives
// needed the same dialog — and a second copy of a destructive confirm is exactly
// the kind of thing that drifts until one of them stops asking.
//
// Styles: .confirm-* in ui/settings.css.

import { el } from '../util/dom';

/** A red, can't-miss confirmation for destructive/sensitive changes. */
export function confirmDanger(title: string, onYes: () => void, yesLabel = 'Yes'): void {
  // Only one confirm can exist. Without this, pressing Enter used to stack a
  // SECOND dialog: focus stayed on the button that opened the first one (e.g.
  // the Sign out row), so the browser's native Enter-activation clicked that
  // button again. Two backdrops darkened the screen, and after Yes signed the
  // user out, the orphaned first dialog survived on <body> over the landing
  // page. The focus move below kills the re-fire; this guard is the backstop.
  if (document.querySelector('.confirm-backdrop')) return;
  const back = el('div', { class: 'confirm-backdrop' });
  const box = el('div', { class: 'confirm-box' });
  box.append(el('h3', { class: 'confirm-title', text: title }));
  const row = el('div', { class: 'confirm-actions' });
  const cancel = el('button', { class: 'confirm-cancel', text: 'Cancel' });
  cancel.addEventListener('click', () => back.remove());
  const yes = el('button', { class: 'confirm-yes', text: yesLabel });
  yes.addEventListener('click', () => {
    back.remove();
    onYes();
  });
  row.append(cancel, yes);
  box.append(row);
  back.append(box);
  back.addEventListener('click', (e) => {
    if (e.target === back) back.remove();
  });
  // Escape = Cancel, self-cleaning the same way enterConfirms does.
  const onEsc = (e: KeyboardEvent) => {
    if (!back.isConnected) {
      document.removeEventListener('keydown', onEsc);
      return;
    }
    if (e.key === 'Escape') back.remove();
  };
  document.addEventListener('keydown', onEsc);
  // Enter deliberately does NOT confirm here (Gabe, 8/7/26): these dialogs are
  // the consequential ones (sign out, change the calendar link, delete a
  // playlist), so confirming must be a deliberate CLICK on Yes, never a
  // reflexive keystroke. Focus lands on Cancel instead: it pulls focus off the
  // button that opened the dialog (whose native Enter re-fire was the stacking
  // bug), and if Enter is pressed anyway, the harmless thing happens.
  document.body.append(back);
  cancel.focus();
}
