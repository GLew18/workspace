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

import { el, enterConfirms } from '../util/dom';
import { makeWidthGrip } from '../util/resize';

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
  const close = () => backdrop.remove();
  backdrop.addEventListener('click', (e) => {
    if (e.target === backdrop) close();
  });
  build(body, close);
}
