// Cobalt: "drag the bottom edge to resize" grip, shared by every resizable
// list panel (focus import, music browser, in-session song list).
//
// DESIGN (Gabe's rules, learned the hard way on the import panel):
//  • The grip rides the edge that actually MOVES, and dragging it that way
//    grows the panel. A panel pinned under a header grows downward, so its grip
//    sits at the BOTTOM (edge: 'bottom', the default) and drag-DOWN grows it.
//    A panel pinned to the bottom of a height-capped card — the focus import —
//    can only grow UPWARD (the list above yields), so its grip sits at the TOP
//    (edge: 'top') and drag-UP grows it. Chasing the still edge reads backwards.
//  • It is purely ADDITIVE: nothing about the default layout changes until the
//    user actually drags. Every panel looks exactly as it did before.
//  • The chosen height persists (localStorage) and restores on every open.
//  • The floor is generous on purpose — it also heals any previously-saved
//    tiny height back up to something usable on load.

import { el } from './dom';

export interface ResizeGripOptions {
  /** The scrollable element whose height the drag changes. */
  body: HTMLElement;
  /** localStorage key the chosen height persists under. */
  storageKey: string;
  /** Comfort floor / ceiling for the drag (px). Pass `min: 0` for a panel the user
   *  is allowed to close down to nothing (the focus import menus, Gabe 8/19). */
  min?: number;
  max?: number;
  /** Selector of a height-capped ancestor the body must stay inside. After any
   *  change, overflow past that cap is trimmed so the card never clips. */
  fitTo?: string;
  /** Floor used when `fitTo` forces trimming — a genuinely small card (the mini
   *  player) outranks the comfort floor, or the layout would overflow. */
  fitFloor?: number;
  /** Which edge the grip rides, i.e. which way the panel actually grows.
   *  'bottom' (default) → append `.el` LAST, drag DOWN to grow.
   *  'top' → append `.el` FIRST, drag UP to grow. */
  edge?: 'bottom' | 'top';
  /** Called when a drag ENDS at zero height. Dragging a panel shut is a way of
   *  saying "close this", so the owner can do exactly that (the focus import
   *  menus switch themselves off). The saved height is cleared first, or the
   *  next open would reopen at zero and shut itself again. */
  onCollapse?: () => void;
}

/** Build a resize grip for `body`. Append `.el` on the edge named by `edge` —
 *  LAST child for 'bottom' (the default), FIRST child for 'top' — so the bar
 *  sits against the boundary it moves. Call `.refit()` whenever the panel
 *  becomes visible — a collapsed panel can't be measured, so a capped card's
 *  trim has to be recomputed the moment it actually opens. */
export function makeResizeGrip(opts: ResizeGripOptions): { el: HTMLElement; refit: () => void } {
  const { body, storageKey, min = 180, max = 900, fitTo, fitFloor = 100, edge = 'bottom', onCollapse } = opts;

  const applyHeight = (h: number): void => {
    body.style.height = `${Math.max(min, Math.min(max, h))}px`;
    body.style.maxHeight = 'none'; // an explicit height replaces the CSS cap
    // …and so does an explicit min-height. A stylesheet floor exists to stop FLEX
    // from crushing an untouched panel; once the user takes hold of the grip the
    // height is theirs, and a leftover min-height would silently ignore the last
    // stretch of the drag (Gabe 8/19: it must be draggable down to nothing).
    body.style.minHeight = '0px';
    // Claim the space rather than request it: inside a flex column, the panel
    // must not be the one that shrinks — the flexible sibling list yields.
    const panel = body.parentElement;
    if (panel) {
      // (Nothing is hidden at zero. Removing chrome mid-drag moved the grip by its
      // height in a single step, which read as the slider jumping — see focus.css.)
      // THE PANEL IS NOW EXACTLY AS TALL AS THE HEIGHT JUST SET — it may neither
      // shrink below it nor grow past it. All three lines are needed:
      //   • flex-basis 'auto' so it measures its own content (the focus session's
      //     import menu carries a basis from the stylesheet; without this the drag
      //     moved the grip and changed nothing),
      //   • flex-shrink 0 so a crowded card takes its space from the list instead,
      //   • flex-grow 0 because a card with room to spare grew the panel straight
      //     back — dragging it to zero visibly sprang open again (Gabe, 8/19).
      panel.style.flexBasis = 'auto';
      panel.style.flexShrink = '0';
      panel.style.flexGrow = '0';
    }
  };

  /** Never let the chosen height push a capped ancestor past its cap: measure
   *  the real overflow and trim exactly that much. The layout is the ruler —
   *  no arithmetic about paddings and gaps. */
  const fitToCard = (): void => {
    if (!fitTo || !body.style.height) return;
    const card = body.closest<HTMLElement>(fitTo);
    if (!card) return;
    const over = card.scrollHeight - card.clientHeight;
    if (over > 0) body.style.height = `${Math.max(fitFloor, parseFloat(body.style.height) - over)}px`;
  };

  const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
  // Number.isFinite, NOT truthiness: a panel dragged all the way shut saves 0, and
  // `if (saved)` would read that as "nothing saved" and spring it back open.
  if (Number.isFinite(saved)) {
    applyHeight(saved);
    queueMicrotask(fitToCard); // needs the panel mounted + laid out first
  }

  const grip = el('div', {
    class: `ws-resize-grip${edge === 'top' ? ' ws-resize-grip-top' : ''}`,
    title: 'Drag to resize',
  });
  grip.append(el('div', { class: 'ws-resize-grip-pill' }));
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startY = e.clientY;
    const startH = body.getBoundingClientRect().height;
    try {
      grip.setPointerCapture(e.pointerId); // keeps the drag alive outside the bar
    } catch {
      /* no capture (synthetic pointer) — the drag still tracks while over the bar */
    }
    // The moving edge follows the pointer: a bottom grip grows as it goes DOWN,
    // a top grip grows as it goes UP — so the sign flips with the edge.
    const dir = edge === 'top' ? -1 : 1;
    const move = (ev: PointerEvent) => {
      applyHeight(startH + dir * (ev.clientY - startY));
      fitToCard();
    };
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      const h = parseFloat(body.style.height);
      // Released at zero = "close this". Forget the height rather than saving a 0
      // that would reopen shut, then hand the decision to the owner.
      if (onCollapse && Number.isFinite(h) && h <= 0) {
        localStorage.removeItem(storageKey);
        onCollapse();
        return;
      }
      if (Number.isFinite(h)) localStorage.setItem(storageKey, String(Math.round(h)));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  return { el: grip, refit: () => queueMicrotask(fitToCard) };
}

/** Re-apply a saved height to a panel that gets rebuilt from scratch (the music
 *  menu redraws on every track change). Call right after recreating the body. */
export function restoreSavedHeight(body: HTMLElement, storageKey: string, min = 180, max = 900): void {
  const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
  if (!saved) return;
  body.style.height = `${Math.max(min, Math.min(max, saved))}px`;
  body.style.maxHeight = 'none';
}

export interface WidthGripOptions {
  /** The box whose WIDTH the drag changes (a popup card). */
  box: HTMLElement;
  storageKey: string;
  min?: number;
  max?: number;
}

/** Horizontal twin of makeResizeGrip: a slim grab bar down the box's RIGHT edge —
 *  drag RIGHT to widen, LEFT to narrow. For popups whose pinch is width, not
 *  height (the folder picker's long names, attachment URLs). Append the returned
 *  element to the box itself; the box is made `position: relative` here so the
 *  grip can ride its edge. */
export function makeWidthGrip(opts: WidthGripOptions): HTMLElement {
  const { box, storageKey, min = 300, max = 900 } = opts;

  const applyWidth = (w: number): void => {
    box.style.width = `${Math.max(min, Math.min(max, w))}px`;
    box.style.maxWidth = 'none'; // an explicit width replaces the CSS cap
  };

  const saved = parseInt(localStorage.getItem(storageKey) || '', 10);
  if (saved) applyWidth(saved);

  if (getComputedStyle(box).position === 'static') box.style.position = 'relative';
  const grip = el('div', { class: 'ws-resize-grip-x', title: 'Drag to resize width' });
  grip.append(el('div', { class: 'ws-resize-grip-x-pill' }));
  grip.addEventListener('pointerdown', (e) => {
    e.preventDefault();
    const startX = e.clientX;
    const startW = box.getBoundingClientRect().width;
    try {
      grip.setPointerCapture(e.pointerId);
    } catch {
      /* no capture (synthetic pointer) — the drag still tracks while over the bar */
    }
    const move = (ev: PointerEvent) => applyWidth(startW + (ev.clientX - startX)); // RIGHT = wider
    const up = () => {
      grip.removeEventListener('pointermove', move);
      grip.removeEventListener('pointerup', up);
      const w = parseFloat(box.style.width);
      if (w) localStorage.setItem(storageKey, String(Math.round(w)));
    };
    grip.addEventListener('pointermove', move);
    grip.addEventListener('pointerup', up);
  });
  return grip;
}
