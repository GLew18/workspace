// Cobalt: the hero demo's ghost cursor.
//
// A drawn pointer that moves like a hand: bezier paths with a perpendicular
// bow, ease-in-out with a whisper of overshoot, per-character typing with
// human jitter. Every primitive both ANIMATES the pointer and DISPATCHES the
// real DOM events, so the app underneath responds exactly as it would to a
// person (the views never know the difference — synthetic events bubble
// through the same listeners).
//
// `instant` mode strips all animation and delays: primitives fire their events
// immediately. That is the smoke-test mode — it verifies every selector and
// event sequence in milliseconds, which is also how the demo stays cheap to
// re-validate after app changes.
//
// Coordinates: the cursor lives in the shell BODY's coordinate space (design
// pixels). The shell is scaled by transform outside, so converting a target's
// viewport rect back into local space divides by the live scale factor.

import { el } from '../../util/dom';

const CURSOR_SVG =
  '<svg viewBox="0 0 24 24" width="22" height="22"><path d="M5.5 3.2l12.3 10.4-5.4.7 3 6.2-2.6 1.2-3-6.3-4.3 3.6z" fill="#fff" stroke="#0b1f4d" stroke-width="1.4" stroke-linejoin="round"/></svg>';

export interface CursorOpts {
  /** Skip all animation + delays (smoke-test mode). */
  instant?: boolean;
  /** Global tempo multiplier: 1 = scripted speed, <1 = faster. */
  speed?: number;
}

interface MoveOpts {
  /** Where inside the target to land, 0..1 of its box (default center). */
  ax?: number;
  ay?: number;
  /** Extra travel time multiplier for this one move. */
  slow?: number;
}

interface ClickOpts extends MoveOpts {
  shift?: boolean;
  ctrl?: boolean;
}

const easeInOut = (t: number): number => (t < 0.5 ? 2 * t * t : 1 - Math.pow(-2 * t + 2, 2) / 2);

export class GhostCursor {
  private elCursor: HTMLElement;
  private x = 60;
  private y = 60;
  private opts: Required<CursorOpts>;

  constructor(private space: HTMLElement, opts: CursorOpts = {}) {
    this.opts = { instant: opts.instant ?? false, speed: opts.speed ?? 1 };
    this.elCursor = el('div', { class: 'lp-demo-cursor' });
    this.elCursor.innerHTML = CURSOR_SVG;
    space.append(this.elCursor);
    this.place(this.x, this.y);
  }

  destroy(): void {
    this.elCursor.remove();
  }

  // --- geometry -------------------------------------------------------------

  /** The live scale the shell is rendered at (transform on .lp-frame). */
  private scale(): number {
    const w = this.space.getBoundingClientRect().width;
    return w > 0 ? w / this.space.offsetWidth : 1;
  }

  /** A target's landing point in LOCAL (design-pixel) coordinates. */
  private localPoint(target: Element, ax = 0.5, ay = 0.5): { x: number; y: number } {
    const s = this.scale();
    const tr = target.getBoundingClientRect();
    const sr = this.space.getBoundingClientRect();
    return {
      x: (tr.left - sr.left + tr.width * ax) / s,
      y: (tr.top - sr.top + tr.height * ay) / s,
    };
  }

  /** The same landing point in VIEWPORT coordinates (for event clientX/Y). */
  private viewportPoint(target: Element, ax = 0.5, ay = 0.5): { x: number; y: number } {
    const tr = target.getBoundingClientRect();
    return { x: tr.left + tr.width * ax, y: tr.top + tr.height * ay };
  }

  private place(x: number, y: number): void {
    this.x = x;
    this.y = y;
    this.elCursor.style.transform = `translate(${x}px, ${y}px)`;
  }

  // --- waiting ----------------------------------------------------------------

  /** A human beat. Scaled by tempo; zero in instant mode. */
  wait(ms: number): Promise<void> {
    if (this.opts.instant) return Promise.resolve();
    return new Promise((r) => setTimeout(r, ms * this.opts.speed));
  }

  /** Poll a condition until true. For asserting outcomes the app commits on its
   *  OWN clock (e.g. bulk-complete's 820ms glide choreography persists after the
   *  animation) — instant mode can't skip those timers, only ours. */
  waitUntil(fn: () => Promise<boolean> | boolean, timeout = 4000, label = 'condition'): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const look = async (): Promise<void> => {
        if (await fn()) return resolve();
        if (performance.now() - t0 > timeout) return reject(new Error(`waitUntil timed out: ${label}`));
        setTimeout(() => void look(), this.opts.instant ? 40 : 90);
      };
      void look();
    });
  }

  /** Poll a producer until it returns something truthy, then hand it back.
   *  For targets that need more than a selector (text matching, filtering). */
  waitForResult<T>(fn: () => T | undefined | null, timeout = 4000, label = 'element'): Promise<T> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const look = (): void => {
        const hit = fn();
        if (hit) return resolve(hit);
        if (performance.now() - t0 > timeout) return reject(new Error(`waitForResult timed out: ${label}`));
        setTimeout(look, this.opts.instant ? 12 : 60);
      };
      look();
    });
  }

  /** Poll for an element the previous action should have produced. Fails loudly
   *  after `timeout` — a missing selector means the app changed under the
   *  script, and the loop's error policy reports exactly which step broke. */
  waitFor<T extends Element>(sel: string, root: ParentNode = this.space, timeout = 4000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const look = (): void => {
        const hit = root.querySelector(sel);
        if (hit) return resolve(hit as T);
        if (performance.now() - t0 > timeout) return reject(new Error(`waitFor timed out: ${sel}`));
        setTimeout(look, this.opts.instant ? 8 : 48);
      };
      look();
    });
  }

  // --- motion ----------------------------------------------------------------

  /** Glide to a target along a slightly bowed path with human easing. */
  async moveTo(target: Element | { x: number; y: number }, o: MoveOpts = {}): Promise<void> {
    const to = target instanceof Element ? this.localPoint(target, o.ax, o.ay) : target;
    if (this.opts.instant) {
      this.place(to.x, to.y);
      return;
    }
    const from = { x: this.x, y: this.y };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    // Travel time grows sublinearly with distance — quick flicks for near
    // targets, controlled sweeps across the screen. The bow bends
    // perpendicular to the path, alternating side by position parity so long
    // sequences don't loop the same arc every time.
    const dur = Math.min(760, 240 + dist * 0.9) * (o.slow ?? 1) * this.opts.speed;
    const side = (from.x + from.y) % 2 === 0 ? 1 : -1;
    const bow = Math.min(46, dist * 0.16) * side;
    const cx = from.x + dx / 2 - (dy / dist) * bow;
    const cy = from.y + dy / 2 + (dx / dist) * bow;
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (): void => {
        const t = Math.min(1, (performance.now() - t0) / dur);
        const e = easeInOut(t);
        // Quadratic bezier + a 1.5% overshoot that settles in the last tenth.
        const over = t > 0.9 ? Math.sin((t - 0.9) * 10 * Math.PI) * 0.015 * (1 - t) * dist : 0;
        const bx = (1 - e) * (1 - e) * from.x + 2 * (1 - e) * e * cx + e * e * to.x;
        const by = (1 - e) * (1 - e) * from.y + 2 * (1 - e) * e * cy + e * e * to.y;
        this.place(bx + over, by + over / 2);
        if (t < 1) requestAnimationFrame(step);
        else {
          this.place(to.x, to.y);
          resolve();
        }
      };
      requestAnimationFrame(step);
    });
  }

  // --- events ------------------------------------------------------------------

  private fire(target: Element, type: string, init: MouseEventInit & { detail?: number } = {}): void {
    const base: MouseEventInit = { bubbles: true, cancelable: true, composed: true, ...init };
    const ev =
      type.startsWith('pointer')
        ? new PointerEvent(type, { ...base, pointerId: 7, pointerType: 'mouse', isPrimary: true })
        : new MouseEvent(type, base);
    target.dispatchEvent(ev);
  }

  /** Move to the target, press, click — with the pressed-cursor visual. */
  async click(target: Element, o: ClickOpts = {}): Promise<void> {
    await this.moveTo(target, o);
    const vp = this.viewportPoint(target, o.ax, o.ay);
    const init: MouseEventInit = { clientX: vp.x, clientY: vp.y, shiftKey: !!o.shift, ctrlKey: !!o.ctrl };
    this.elCursor.classList.add('pressed');
    this.fire(target, 'pointerdown', { ...init, button: 0 });
    this.fire(target, 'mousedown', { ...init, button: 0 });
    await this.wait(70);
    this.fire(target, 'pointerup', { ...init, button: 0 });
    this.fire(target, 'mouseup', { ...init, button: 0 });
    this.fire(target, 'click', { ...init, detail: 1 });
    this.elCursor.classList.remove('pressed');
  }

  /** Double-click (the app's inline-edit gesture). */
  async dblclick(target: Element, o: MoveOpts = {}): Promise<void> {
    await this.click(target, o);
    await this.wait(90);
    const vp = this.viewportPoint(target, o.ax, o.ay);
    this.fire(target, 'pointerdown', { clientX: vp.x, clientY: vp.y, button: 0 });
    this.fire(target, 'mousedown', { clientX: vp.x, clientY: vp.y, button: 0, detail: 2 });
    this.fire(target, 'pointerup', { clientX: vp.x, clientY: vp.y, button: 0 });
    this.fire(target, 'mouseup', { clientX: vp.x, clientY: vp.y, button: 0, detail: 2 });
    this.fire(target, 'click', { clientX: vp.x, clientY: vp.y, detail: 2 });
    this.fire(target, 'dblclick', { clientX: vp.x, clientY: vp.y, detail: 2 });
  }

  /** Type into an input/textarea like a person: per-character, jittered cadence,
   *  tiny hesitations after word breaks. Ends WITHOUT committing (callers press
   *  Enter themselves when the flow calls for it). */
  async typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    field.focus();
    if (this.opts.instant) {
      field.value += text;
      field.dispatchEvent(new InputEvent('input', { bubbles: true }));
      return;
    }
    for (const ch of text) {
      field.value += ch;
      field.dispatchEvent(new InputEvent('input', { bubbles: true, data: ch, inputType: 'insertText' }));
      const beat = 34 + Math.random() * 52 + (ch === ' ' && Math.random() < 0.3 ? 110 : 0);
      await this.wait(beat);
    }
  }

  /** Select-all + retype (the rename gesture after an inline editor opens with
   *  the old value selected). */
  async retype(field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    field.focus();
    field.select();
    await this.wait(140);
    field.value = '';
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'deleteContentBackward' }));
    await this.typeInto(field, text);
  }

  /** A single key with modifiers (Enter to commit, the shortcut combo, Escape). */
  pressKey(target: Element, key: string, mods: { alt?: boolean; ctrl?: boolean; shift?: boolean; meta?: boolean } = {}): void {
    const init: KeyboardEventInit = {
      key,
      bubbles: true,
      cancelable: true,
      altKey: !!mods.alt,
      ctrlKey: !!mods.ctrl,
      shiftKey: !!mods.shift,
      metaKey: !!mods.meta,
    };
    target.dispatchEvent(new KeyboardEvent('keydown', init));
    target.dispatchEvent(new KeyboardEvent('keyup', init));
  }

  /** Pointer-drag (the minimized-widget move; NOT the HTML5 row drags). */
  async dragPointer(target: HTMLElement, dx: number, dy: number): Promise<void> {
    await this.moveTo(target);
    const vp = this.viewportPoint(target);
    const s = this.scale();
    this.fire(target, 'pointerdown', { clientX: vp.x, clientY: vp.y, button: 0 });
    const steps = this.opts.instant ? 2 : 14;
    for (let i = 1; i <= steps; i++) {
      const e = easeInOut(i / steps);
      this.fire(target, 'pointermove', { clientX: vp.x + dx * s * e, clientY: vp.y + dy * s * e });
      this.place(this.x + (dx / steps) * 1, this.y + (dy / steps) * 1);
      await this.wait(16);
    }
    this.fire(target, 'pointerup', { clientX: vp.x + dx * s, clientY: vp.y + dy * s, button: 0 });
    const end = this.localPoint(target);
    this.place(end.x, end.y);
  }

  /** HTML5 drag-and-drop between two rows (the focus todo reorder). Chrome lets
   *  a script construct a real DataTransfer, so the app's own dragstart/dragover/
   *  drop handlers run unmodified. */
  async dragRow(source: HTMLElement, handle: HTMLElement, targetRow: HTMLElement): Promise<void> {
    await this.moveTo(handle);
    const vp = this.viewportPoint(handle);
    this.fire(handle, 'pointerdown', { clientX: vp.x, clientY: vp.y, button: 0 }); // arms draggable
    const dt = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    await this.moveTo(targetRow, { slow: 1.1 });
    const tv = this.viewportPoint(targetRow);
    targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tv.x, clientY: tv.y }));
    await this.wait(90);
    targetRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tv.x, clientY: tv.y }));
    source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
    this.fire(handle, 'pointerup', { clientX: tv.x, clientY: tv.y, button: 0 });
  }

  /** Smoothly scroll a container (the tasks list drift-through). */
  async scrollBy(container: HTMLElement, dy: number, ms = 600): Promise<void> {
    if (this.opts.instant) {
      container.scrollTop += dy;
      return;
    }
    const from = container.scrollTop;
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (): void => {
        const t = Math.min(1, (performance.now() - t0) / (ms * this.opts.speed));
        container.scrollTop = from + dy * easeInOut(t);
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }
}
