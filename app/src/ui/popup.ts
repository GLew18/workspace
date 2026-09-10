// Cobalt: the app's modal card.
//
// A titled box on a dimmed backdrop, with the shared width grip. Every picker and
// panel in the Tasks tab is one of these (folder, priority, attachments, a task's
// description, Task Pro Tips), and now the Task Archives' description popup too:
// that is what moved it out of TasksView, where it had been a private method. A
// second implementation of "the app's popup" is how two popups end up different
// widths and different escape behaviour.
//
// Styles: .popup-backdrop / .popup / .popup-body in ui/components.css.

import { el, enterConfirms, fadeRemove } from '../util/dom';
import { makeWidthGrip } from '../util/resize';

/**
 * EVERY TRANSIENT OVERLAY CURRENTLY ON SCREEN (Gabe, 8/27).
 *
 * A popup and a row's "…" menu both mount on <body>, not inside the tab that opened
 * them, which is what lets them sit above the whole app and float over the row they
 * belong to. The cost is that neither has any idea the tab beneath it changed: open
 * a task's "…" menu, switch to Focus or Bookmarks, and the menu is still hanging
 * there over a screen it has nothing to do with, still holding a task you can no
 * longer see.
 *
 * A backdrop click and Esc already close one. What was missing is the third way to
 * leave, which is to leave the place it came from. main.ts calls closeAllPopups()
 * from mountTabs' onChange, next to dropSelections() — the same hook, for the same
 * reason: this belongs to the tab it was born in.
 *
 * WHAT IS DELIBERATELY NOT REGISTERED HERE: the modal dialogs, which are a different
 * kind of thing. Bookmarks' add/edit-link card and the Focus folder card hold typing
 * in progress, and yanking one away on a tab switch would throw work out rather than
 * tidy up after it. Only the transient menus — the ones you open to press one thing
 * — are tab-scoped.
 */
const open = new Set<() => void>();

/**
 * Register a body-mounted transient overlay so that leaving the tab closes it.
 *
 * Returns the close function to actually use: it deregisters itself first, so a
 * normal dismissal (backdrop click, Esc, picking a row) leaves nothing behind for
 * closeAllPopups to find, and closing twice is harmless.
 */
export function tabScopedOverlay(close: () => void): () => void {
  const wrapped = (): void => {
    open.delete(wrapped);
    close();
  };
  open.add(wrapped);
  return wrapped;
}

/** Shut every registered overlay. Safe to call when there are none. */
export function closeAllPopups(): void {
  // Copy first: each close() deletes its own entry, and mutating a Set mid-iteration
  // is how you skip half of them.
  for (const close of [...open]) close();
  open.clear();
}

/**
 * @param host  where to mount. Defaults to <body>; the landing page's live demo
 *              passes its own device frame so the card stays inside the mock.
 */
export function openPopup(
  title: string,
  build: (body: HTMLElement, close: () => void) => void,
  host?: HTMLElement
): void {
  const backdrop = el('div', { class: 'popup-backdrop' });
  const box = el('div', { class: 'popup' });
  box.append(el('h3', { text: title }));
  const body = el('div', { class: 'popup-body' });
  box.append(body);
  // Every popup (folder picker, priority, attachments, details) shares ONE
  // width — drag the right edge once and they all remember it. Width is the
  // pinch here, not height: long folder names and URLs are what get squeezed.
  box.append(makeWidthGrip({ box, storageKey: 'ws:popupWidth' }));
  // These popups have no primary action: clicking a row IS the save in the
  // pickers, and attachments auto-saves. (This used to look for a
  // [data-enter-primary] element; nothing ever set that attribute after
  // attachments lost its Save button, so the selector was dead code.)
  // Still called, for the stacked-popup guard inside enterConfirms.
  enterConfirms(backdrop, () => null);
  backdrop.append(box);
  (host ?? document.body).append(backdrop);
  const close = tabScopedOverlay(() => fadeRemove(backdrop));
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  // Escape closes, same as every other dialog family (9/9/26 audit: this was the
  // one popup with no keydown handler at all). Self-cleaning once the backdrop
  // leaves the DOM, so a popup that closed some other way doesn't leave a listener
  // behind to fire on the NEXT Escape press.
  const onEsc = (e: KeyboardEvent) => {
    if (!backdrop.isConnected) {
      document.removeEventListener('keydown', onEsc);
      return;
    }
    if (e.key === 'Escape') close();
  };
  document.addEventListener('keydown', onEsc);
  build(body, close);
}
