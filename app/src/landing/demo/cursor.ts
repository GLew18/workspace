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
  /** Skip the hover shim (whole-container targets like scrollers, where a
   *  brightness lift would light up the entire screen). */
  noHover?: boolean;
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
  /** The element currently "under" the hand — carries the hover shim class. */
  private hovered: Element | null = null;
  /** Set by kill(): every primitive throws from here on. */
  private dead = false;
  /** The loop-seam exit is the ONE legal off-screen moment (Gabe's iron rule).
   *  Everything else that places the cursor outside the shell body is recorded
   *  as a violation the smoke run fails on. */
  private offscreenOk = false;

  constructor(private space: HTMLElement, opts: CursorOpts = {}) {
    this.opts = { instant: opts.instant ?? false, speed: opts.speed ?? 1 };
    this.elCursor = el('div', { class: 'lp-demo-cursor' });
    this.elCursor.innerHTML = CURSOR_SVG;
    space.append(this.elCursor);
    this.place(this.x, this.y);
  }

  destroy(): void {
    this.hover(null);
    this.elCursor.remove();
  }

  /** Abort every in-flight and future primitive (the audit "play from scene"
   *  jump): the running scene throws, the runner's error path rebuilds the
   *  world, and the next pass fast-forwards to the requested scene. */
  kill(): void {
    this.dead = true;
  }

  /** Live instant-mode toggle: the runner fast-forwards the scenes BEFORE a
   *  jump target by flipping this on, then off for the scene being watched. */
  setInstant(on: boolean): void {
    this.opts.instant = on;
  }

  private check(): void {
    if (this.dead) throw new Error('aborted (scene jump)');
  }

  /** The hover shim: synthetic events can't trigger CSS :hover (no real
   *  hit-testing), so arrival ALSO sets a demo-scoped class that brightens the
   *  element the way its hover state would, and fires the pointer/mouse events
   *  real mice emit so JS-driven hover behavior runs. Without this, controls
   *  never light up before they fire — the loudest "it's a video" tell. */
  private hover(next: Element | null): void {
    if (next === this.hovered) return;
    if (this.hovered) {
      this.hovered.classList.remove('lp-hover');
      this.fire(this.hovered, 'pointerout');
      this.fire(this.hovered, 'mouseout');
    }
    this.hovered = next;
    if (next) {
      next.classList.add('lp-hover');
      this.fire(next, 'pointerover');
      this.fire(next, 'mouseover');
      this.fire(next, 'pointermove');
      this.fire(next, 'mousemove');
    }
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
    // The iron rule, enforced: outside the shell body = a recorded violation
    // (the smoke run asserts the list stays empty). Instant mode places the
    // cursor AT every interaction point, so this audits headless runs too.
    // A zero-sized body means the shell hasn't laid out yet — nothing to judge.
    if (this.space.offsetWidth === 0) return;
    if (!this.offscreenOk && (x < -2 || y < -2 || x > this.space.offsetWidth + 2 || y > this.space.offsetHeight + 2)) {
      const w = window as unknown as { __demoCursorViolations?: string[]; __demoScene?: string; __demoBeat?: string };
      (w.__demoCursorViolations ??= []).push(
        `[${w.__demoScene ?? '?'}${w.__demoBeat ? ` @ ${w.__demoBeat}` : ''}] cursor at ${Math.round(x)},${Math.round(y)} (body ${this.space.offsetWidth}x${this.space.offsetHeight})`
      );
    }
  }

  /** Take something WITH the hand off the right edge (the loop seam's mini player):
   *  land on `grip`, press, and glide right past the frame while `target` translates
   *  by exactly the hand's own delta every frame, so the hand rides the grip all the
   *  way out. No pointer events are fired: the window has no drag handler, and the
   *  app's own makeDraggable would map window coordinates into the scaled frame and
   *  teleport it (the 8/17 audit) — this is staging, not input. Like exit(), it is
   *  the ONE legal off-screen move. */
  async carry(target: HTMLElement, grip: Element, dx: number): Promise<void> {
    // GRIP THE LEFT END (Gabe, 9/3/26: "the cursor is still not on the pip when
    // dismissing it off the screen"). The hand and the window do move as one — but
    // the frame CLIPS at its right edge, and a hand holding the bar's centre crosses
    // that edge halfway through the drag, leaving 220px of window sliding out with
    // nothing on it. Held near the left edge, the hand stays inside the frame until
    // the window is all but gone (~26px), so it is on the window the whole way.
    await this.moveTo(grip, { ax: 0.06, ay: 0.5 });
    this.elCursor.classList.add('pressed');
    await this.wait(120); // the grab reads before anything moves
    this.offscreenOk = true;
    const from = { x: this.x, y: this.y };
    target.style.transition = 'none';
    const steps = this.opts.instant ? 2 : 30; // ~0.6s at the scripted tempo
    for (let i = 1; i <= steps; i++) {
      const e = easeInOut(i / steps);
      target.style.transform = `translateX(${dx * e}px)`;
      this.place(from.x + dx * e, from.y);
      await this.wait(16);
    }
    this.elCursor.classList.remove('pressed');
  }

  /** The loop seam's exit: glide off the frame's right edge, legally. */
  async exit(): Promise<void> {
    this.offscreenOk = true;
    await this.moveTo({ x: this.space.offsetWidth + 80, y: Math.min(this.y, this.space.offsetHeight * 0.5) }, { slow: 1.1 });
  }

  // --- waiting ----------------------------------------------------------------

  /** The live tempo: the scripted speed times the (temporary) audit override
   *  on window — ×0.5 there means every duration doubles. */
  private tempo(): number {
    const w = window as unknown as { __demoSpeed?: number };
    return this.opts.speed * (w.__demoSpeed ?? 1);
  }

  /** The (temporary) audit pause: primitives hold between beats while
   *  window.__demoPause is set. App-owned timers keep running — this pauses
   *  the HAND, not the app. */
  private async pauseGate(): Promise<void> {
    if (this.opts.instant) return;
    const w = window as unknown as { __demoPause?: boolean };
    while (w.__demoPause) {
      this.check(); // a scene jump must break out of a paused hold too
      await new Promise((r) => setTimeout(r, 120));
    }
  }

  /** A human beat. Scaled by tempo; zero in instant mode. */
  async wait(ms: number): Promise<void> {
    this.check();
    if (this.opts.instant) return;
    await this.pauseGate();
    await new Promise((r) => setTimeout(r, ms * this.tempo()));
    this.check();
  }

  /** Poll a condition until true. For asserting outcomes the app commits on its
   *  OWN clock (e.g. bulk-complete's 820ms glide choreography persists after the
   *  animation) — instant mode can't skip those timers, only ours. */
  waitUntil(fn: () => Promise<boolean> | boolean, timeout = 4000, label = 'condition'): Promise<void> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const look = async (): Promise<void> => {
        if (this.dead) return reject(new Error('aborted (scene jump)'));
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
        if (this.dead) return reject(new Error('aborted (scene jump)'));
        const hit = fn();
        if (hit) return resolve(hit);
        if (performance.now() - t0 > timeout) return reject(new Error(`waitForResult timed out: ${label}`));
        setTimeout(look, this.opts.instant ? 12 : 60);
      };
      look();
    });
  }

  /** Poll a producer until it yields an ATTACHED element with a real box —
   *  the cure for re-render races: views redraw on their own async schedule,
   *  and an element captured before a redraw is a detached corpse whose rect
   *  reads as garbage (the classic off-screen-click bug). Query at USE time,
   *  through this, everywhere state may have changed. */
  fresh<T extends Element>(fn: () => T | null | undefined, label = 'element'): Promise<T> {
    return this.waitForResult(() => {
      const e = fn();
      if (!e || !e.isConnected) return undefined;
      const r = e.getBoundingClientRect();
      return r.width > 0 || r.height > 0 ? e : undefined;
    }, 4000, label);
  }

  /** fresh(), plus patience: the SAME node has to keep coming back for `holdMs`
   *  before it counts. For targets a view is about to redraw on its own clock (the
   *  session todo list after a write-back, the 🎵 menu after its library refresh),
   *  fresh() returns the instant an attached node exists — which can be the very
   *  node the redraw is about to replace, so the hand sets off for a corpse, or,
   *  since a corpse has no box, does not set off at all (Gabe's audit, 9/3/26: two
   *  beats in the last scene did exactly that, every loop). */
  async stable<T extends Element>(fn: () => T | null | undefined, label = 'element', holdMs = 320): Promise<T> {
    const t0 = performance.now();
    let last: T | null = null;
    let since = t0;
    while (performance.now() - t0 < 4000) {
      this.check();
      const e = fn();
      let live = false;
      if (e && e.isConnected) {
        const r = e.getBoundingClientRect();
        live = r.width > 0 || r.height > 0;
      }
      if (live && e === last) {
        if (performance.now() - since >= holdMs) return e as T;
      } else {
        last = live ? (e as T) : null;
        since = performance.now();
      }
      await new Promise((r) => setTimeout(r, 40));
    }
    throw new Error(`${label}: never held still`);
  }

  /** Wait (REAL time, instant mode included) for a target to settle inside
   *  the frame — CSS transitions (the sidebar drawer, panel slides) carry
   *  elements in over ~300ms that no scripted wait covers in instant mode. */
  private async settleIntoBounds(target: Element): Promise<void> {
    const t0 = performance.now();
    while (performance.now() - t0 < 900 && !this.dead) {
      if (this.space.offsetWidth === 0) return;
      const r = target.getBoundingClientRect();
      if (target.isConnected && (r.width > 0 || r.height > 0)) {
        const p = this.localPoint(target, 0.5, 0.5);
        if (p.x >= -2 && p.y >= -2 && p.x <= this.space.offsetWidth + 2 && p.y <= this.space.offsetHeight + 2) return;
      }
      await new Promise((res) => setTimeout(res, 45));
    }
  }

  /** Poll for an element the previous action should have produced. Fails loudly
   *  after `timeout` — a missing selector means the app changed under the
   *  script, and the loop's error policy reports exactly which step broke. */
  waitFor<T extends Element>(sel: string, root: ParentNode = this.space, timeout = 4000): Promise<T> {
    return new Promise((resolve, reject) => {
      const t0 = performance.now();
      const look = (): void => {
        if (this.dead) return reject(new Error('aborted (scene jump)'));
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
    this.check();
    if (target instanceof Element) {
      const r = target.getBoundingClientRect();
      if (!target.isConnected || (r.width === 0 && r.height === 0)) {
        // A detached corpse: its rect is garbage and chasing it teleports the
        // hand across the screen. Stay put; the dispatch (if any) still lands
        // on the element, and the next beat re-finds a live one.
        const w = window as unknown as { __demoStaleTargets?: string[]; __demoScene?: string; __demoBeat?: string };
        (w.__demoStaleTargets ??= []).push(`[${w.__demoScene ?? '?'}${w.__demoBeat ? ` @ ${w.__demoBeat}` : ''}] ${target.className}`);
        return;
      }
    }
    const to = target instanceof Element ? this.localPoint(target, o.ax, o.ay) : target;
    if (this.opts.instant) {
      this.place(to.x, to.y);
      this.hover(target instanceof Element && !o.noHover ? target : null);
      return;
    }
    await this.pauseGate();
    this.hover(null); // leaving the last element: its hover state drops
    const from = { x: this.x, y: this.y };
    const dx = to.x - from.x;
    const dy = to.y - from.y;
    const dist = Math.hypot(dx, dy);
    if (dist < 2) return;
    // Travel time grows sublinearly with distance — quick flicks for near
    // targets, controlled sweeps across the screen. The bow bends
    // perpendicular to the path, alternating side by position parity so long
    // sequences don't loop the same arc every time.
    const dur = Math.min(760, 240 + dist * 0.9) * (o.slow ?? 1) * this.tempo();
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
    this.hover(target instanceof Element && !o.noHover ? target : null); // arrival lights it up
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

  /** The nearest scrollable ancestor inside the shell (the auto-staging net). */
  private nearestScroller(el: Element): HTMLElement | null {
    let n = el.parentElement;
    while (n && n !== this.space) {
      const cs = getComputedStyle(n);
      if (n.scrollHeight > n.clientHeight + 4 && /(auto|scroll)/.test(cs.overflowY)) return n;
      n = n.parentElement;
    }
    return null;
  }

  /**
   * WHAT A REAL MOUSE WOULD ACTUALLY HIT (Gabe, 9/1/26: Dan was editing rows from
   * behind the add-task bar).
   *
   * The cursor dispatches events straight AT an element, so unlike a real click it
   * never asks whether anything is on top of it. The add-task bar is sticky and
   * opaque once it pins, and rows slide under it — in the app a click there lands on
   * the bar (verified with elementFromPoint), but the demo happily double-clicked a
   * title nobody could see and typed into it.
   *
   * So ask the document the same question a mouse asks. If something unrelated owns
   * that pixel, scroll the target clear of it and ask again; the hand's own wheel
   * gesture is what moves it, so the viewer sees why the shot changed. Three tries,
   * then give up and let the beat proceed — a demo that deadlocks over a pixel is
   * worse than one that clicks a covered row.
   *
   * The stage carries `pointer-events: none` against real mice, which would make
   * every hit test return the page behind it, so it is lifted for the duration of
   * the test and restored before this function yields. No frame exists in which a
   * visitor's mouse could reach the demo.
   */
  private async clearOccluders(target: Element, o: ClickOpts): Promise<void> {
    if (this.opts.instant) return; // headless: nothing is painted to hit-test against
    const stage = this.space.closest<HTMLElement>('.lp-hero-stage');
    for (let i = 0; i < 3; i++) {
      const vp = this.viewportPoint(target, o.ax, o.ay);
      const prev = stage?.style.pointerEvents;
      if (stage) stage.style.pointerEvents = 'auto';
      const hit = document.elementFromPoint(vp.x, vp.y);
      if (stage) stage.style.pointerEvents = prev ?? '';
      // Unrelated = a genuine overlay. An ancestor or a child of the target means
      // the point simply is not on the target, which scrolling cannot fix.
      if (!hit || hit === target || target.contains(hit) || hit.contains(target)) return;
      const sc = this.nearestScroller(target);
      const hr = hit.getBoundingClientRect();
      if (!sc || hr.bottom <= vp.y) {
        // Nothing to scroll, or the cover sits BELOW the point (a bottom bar) —
        // record it so the smoke run can see what the hand walked into.
        const w = window as unknown as { __demoOccluded?: string[]; __demoScene?: string; __demoBeat?: string };
        (w.__demoOccluded ??= []).push(
          `[${w.__demoScene ?? '?'}${w.__demoBeat ? ` @ ${w.__demoBeat}` : ''}] ${target.className} covered by ${hit.className}`
        );
        return;
      }
      const cr = sc.getBoundingClientRect();
      const s = this.scale() || 1;
      await this.ensureInView(sc, target, (hr.bottom - cr.top) / s + 10);
    }
  }

  /** Move to the target, press, click — with the pressed-cursor visual. */
  async click(target: Element, o: ClickOpts = {}): Promise<void> {
    await this.settleIntoBounds(target); // transitions finish before the hand arrives
    // Still out of bounds but ALIVE = it sits past the fold of some scroller a
    // redraw just reset. Scroll it in like a hand would, never click blind.
    const r0 = target.getBoundingClientRect();
    if (target.isConnected && (r0.width > 0 || r0.height > 0)) {
      const p = this.localPoint(target, o.ax, o.ay);
      if (p.x < -2 || p.y < -2 || p.x > this.space.offsetWidth + 2 || p.y > this.space.offsetHeight + 2) {
        const sc = this.nearestScroller(target);
        if (sc) await this.ensureInView(sc, target, 16);
      }
    }
    await this.clearOccluders(target, o); // nothing sticky may stand between hand and target
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

  /** Double-click (the app's inline-edit gesture). The SECOND press gets its
   *  own visible cursor pulse — without it the gesture read as a single click
   *  (Gabe, 8/17), because only the first press animated. */
  async dblclick(target: Element, o: MoveOpts = {}): Promise<void> {
    await this.click(target, o);
    await this.wait(110);
    const vp = this.viewportPoint(target, o.ax, o.ay);
    this.elCursor.classList.add('pressed');
    this.fire(target, 'pointerdown', { clientX: vp.x, clientY: vp.y, button: 0 });
    this.fire(target, 'mousedown', { clientX: vp.x, clientY: vp.y, button: 0, detail: 2 });
    await this.wait(70);
    this.fire(target, 'pointerup', { clientX: vp.x, clientY: vp.y, button: 0 });
    this.fire(target, 'mouseup', { clientX: vp.x, clientY: vp.y, button: 0, detail: 2 });
    this.fire(target, 'click', { clientX: vp.x, clientY: vp.y, detail: 2 });
    this.fire(target, 'dblclick', { clientX: vp.x, clientY: vp.y, detail: 2 });
    this.elCursor.classList.remove('pressed');
  }

  /** Type into an input/textarea like a person: per-character, jittered cadence,
   *  tiny hesitations after word breaks. Ends WITHOUT committing (callers press
   *  Enter themselves when the flow calls for it). */
  async typeInto(field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    field.focus({ preventScroll: true }); // never scroll the visitor's page to the field
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

  /** Paste: the whole string lands at once (URLs are pasted, never typed:
   *  nobody keys in 40 characters of href by hand, and the demo should read
   *  like a person). The full honest sequence a real Ctrl+V emits: modifier
   *  keydown, V keydown, a paste ClipboardEvent, one insertFromPaste input. */
  async paste(field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    field.focus({ preventScroll: true }); // never scroll the visitor's page to the field
    await this.wait(200); // the beat of reaching for Ctrl+V
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'Control', ctrlKey: true, bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keydown', { key: 'v', ctrlKey: true, bubbles: true }));
    field.dispatchEvent(new ClipboardEvent('paste', { bubbles: true, cancelable: true }));
    field.value += text;
    field.dispatchEvent(new InputEvent('input', { bubbles: true, inputType: 'insertFromPaste' }));
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'v', ctrlKey: true, bubbles: true }));
    field.dispatchEvent(new KeyboardEvent('keyup', { key: 'Control', bubbles: true }));
    await this.wait(150);
  }

  /** Select-all + retype (the rename gesture after an inline editor opens with
   *  the old value selected). */
  async retype(field: HTMLInputElement | HTMLTextAreaElement, text: string): Promise<void> {
    field.focus({ preventScroll: true }); // never scroll the visitor's page to the field
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
    // THE HAND RIDES THE DRAG (Gabe, 9/2/26: on the hue slider "he's not actually
    // touching" it). Two things pulled the pointer off what it was dragging. The
    // events walked an EASED path while the drawn cursor advanced in equal steps, so
    // the two separated in the middle of every drag; and the finish re-placed the
    // cursor at the target's CENTRE, which teleported it backwards off the thumb it
    // had just pushed — leaving the hue visibly changed with nothing on the slider.
    // Both now follow one eased path and stop where the drag stopped.
    const from = { x: this.x, y: this.y };
    this.fire(target, 'pointerdown', { clientX: vp.x, clientY: vp.y, button: 0 });
    const steps = this.opts.instant ? 2 : 14;
    for (let i = 1; i <= steps; i++) {
      const e = easeInOut(i / steps);
      this.fire(target, 'pointermove', { clientX: vp.x + dx * s * e, clientY: vp.y + dy * s * e });
      this.place(from.x + dx * e, from.y + dy * e);
      await this.wait(16);
    }
    this.fire(target, 'pointerup', { clientX: vp.x + dx * s, clientY: vp.y + dy * s, button: 0 });
    this.place(from.x + dx, from.y + dy);
  }

  /** HTML5 drag-and-drop between two rows (the focus todo reorder). Chrome lets
   *  a script construct a real DataTransfer, so the app's own dragstart/dragover/
   *  drop handlers run unmodified (dragstart dims the source row via its own
   *  .dragging class). What a synthetic drag CANNOT produce is the BROWSER'S
   *  drag image — the translucent row snapshot riding under the cursor — so the
   *  demo layer clones one and carries it along the path (Gabe, 8/17). */
  async dragRow(source: HTMLElement, handle: HTMLElement, targetRow: HTMLElement): Promise<void> {
    await this.moveTo(handle);
    const vp = this.viewportPoint(handle);
    this.fire(handle, 'pointerdown', { clientX: vp.x, clientY: vp.y, button: 0 }); // arms draggable
    const dt = new DataTransfer();
    source.dispatchEvent(new DragEvent('dragstart', { bubbles: true, cancelable: true, dataTransfer: dt }));
    // The ghost: a clone of the row, 70% opaque, glued to the hand.
    const ghost = source.cloneNode(true) as HTMLElement;
    ghost.classList.add('lp-drag-ghost');
    ghost.style.width = `${source.offsetWidth}px`;
    this.space.append(ghost);
    const follow = window.setInterval(() => {
      ghost.style.transform = `translate(${this.x - 14}px, ${this.y + 10}px)`;
    }, 16);
    try {
      await this.moveTo(targetRow, { slow: 1.1 });
      const tv = this.viewportPoint(targetRow);
      targetRow.dispatchEvent(new DragEvent('dragover', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tv.x, clientY: tv.y }));
      await this.wait(90);
      targetRow.dispatchEvent(new DragEvent('drop', { bubbles: true, cancelable: true, dataTransfer: dt, clientX: tv.x, clientY: tv.y }));
      source.dispatchEvent(new DragEvent('dragend', { bubbles: true, dataTransfer: dt }));
      this.fire(handle, 'pointerup', { clientX: tv.x, clientY: tv.y, button: 0 });
    } finally {
      window.clearInterval(follow);
      ghost.remove();
    }
  }

  /** Smoothly scroll a container — as a WHEEL scroll a viewer can believe:
   *  the hand travels over the thing about to move, wheel events fire at its
   *  position, and the (visible) scrollbar thumb rides along. A no-op delta
   *  neither moves nor stalls. */
  async scrollBy(container: HTMLElement, dy: number, ms = 600): Promise<void> {
    if (Math.abs(dy) < 1) return;
    if (this.opts.instant) {
      container.scrollTop += dy;
      // Headless documents fire no scroll events on their own — and scroll
      // listeners (the focus wheel's value logic) are the whole point.
      container.dispatchEvent(new Event('scroll'));
      return;
    }
    // ONLY REPOSITION IF THE HAND IS NOT ALREADY OVER IT (Gabe, 9/2/26: "he moves
    // his cursor to a spot, scrolls, stops, moves his cursor up and then scrolls
    // again"). A wheel works wherever the pointer happens to be, so walking it back
    // to the same centre point before every scroll was a tic, not a gesture — and
    // consecutive scrolls did it once each. A pointer already inside the box scrolls
    // from where it stands.
    const cr = container.getBoundingClientRect();
    const here = this.localPoint(container, 0.5, 0.5);
    const inside =
      Math.abs(this.x - here.x) < cr.width / (2 * (this.scale() || 1)) - 12 &&
      Math.abs(this.y - here.y) < cr.height / (2 * (this.scale() || 1)) - 12;
    if (!inside) {
      await this.moveTo(container, { ax: 0.55, ay: 0.45, noHover: true });
      await this.wait(120);
    }
    // The wheel fires WHERE THE HAND IS, which is the whole reason it may stay put.
    // (localPoint's inverse: local design pixels back into viewport pixels.)
    const s = this.scale() || 1;
    const sr = this.space.getBoundingClientRect();
    const vp = inside
      ? { x: sr.left + this.x * s, y: sr.top + this.y * s }
      : this.viewportPoint(container, 0.55, 0.45);
    const from = container.scrollTop;
    let lastNotch = 0;
    await new Promise<void>((resolve) => {
      const t0 = performance.now();
      const step = (): void => {
        const t = Math.min(1, (performance.now() - t0) / (ms * this.tempo()));
        const pos = dy * easeInOut(t);
        container.scrollTop = from + pos;
        // A wheel "notch" per ~90px travelled — what a real scroll emits.
        if (Math.abs(pos - lastNotch) > 90 || t === 1) {
          lastNotch = pos;
          container.dispatchEvent(
            new WheelEvent('wheel', { bubbles: true, deltaY: Math.sign(dy) * 120, clientX: vp.x, clientY: vp.y })
          );
        }
        if (t < 1) requestAnimationFrame(step);
        else resolve();
      };
      requestAnimationFrame(step);
    });
  }

  /** Scroll a container the minimum needed so `target` sits fully inside its
   *  visible box (with margin), as a real wheel gesture. The staging tool for
   *  the marquee rule: get everything in frame BEFORE the beat starts. */
  async ensureInView(container: HTMLElement, target: Element, margin = 56): Promise<void> {
    const cr = container.getBoundingClientRect();
    const tr = target.getBoundingClientRect();
    const s = this.scale() || 1;
    let dy = 0;
    if (tr.bottom > cr.bottom - margin * s) dy = (tr.bottom - (cr.bottom - margin * s)) / s;
    else if (tr.top < cr.top + margin * s) dy = (tr.top - (cr.top + margin * s)) / s;
    if (Math.abs(dy) < 4) return;
    await this.scrollBy(container, dy, Math.min(900, 300 + Math.abs(dy)));
    await this.wait(150);
  }
}
