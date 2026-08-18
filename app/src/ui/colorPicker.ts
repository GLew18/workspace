// Cobalt: the in-app color picker.
//
// Every color control in the app used to be a native <input type="color">, which
// opens the OS dialog: un-styleable, un-positionable, and invisible to the landing
// page's scripted demo (a ghost cursor cannot drag an OS window). This replaces it
// with a Cobalt-styled card that lives in the DOM: a saturation/value square with a
// draggable ring, a hue bar, an editable hex box, and a current-color chip. It is
// deliberately drivable by synthetic PointerEvents: no isTrusted checks anywhere,
// every drag resolves clientX/Y against getBoundingClientRect (so a CSS-scaled demo
// frame reads correctly, the fractions are scale-free), and setPointerCapture is
// wrapped in try/catch because fabricated pointer ids make it throw.
//
// Contract with call sites: the caller renders the swatch (a button-like element,
// keeping its existing class so demo/test selectors still match); this module
// paints its background with the current color, opens the card on click, calls
// onChange with a lowercase #rrggbb on EVERY live tweak (knob drag, hue drag, hex
// commit), and calls onClose(changed) when the card goes away. Closing keeps the
// last color: there is no cancel, exactly like the native picker's live 'input'
// stream followed by 'change' on dismiss.

import { el } from '../util/dom';

export interface ColorPickerOpts {
  /** Read the CURRENT color (fresh on every open); anything not #rrggbb falls back to the accent. */
  value: () => string;
  /** Live color stream: fired on every knob move and every valid hex commit. */
  onChange: (hex: string) => void;
  /** Where the card mounts (the landing demo passes its frame so the card stays
   *  inside the device; undefined or null means document.body, the real app). */
  host?: () => HTMLElement | null | undefined;
  /** Fired when the card closes; `changed` says whether onChange ever fired this
   *  visit, so "persist on close" sites can skip a no-op save. */
  onClose?: (changed: boolean) => void;
}

const HEX_RE = /^#?([0-9a-f]{6})$/i;
const FALLBACK = '#7db4ff'; // the accent: what junk or legacy values open as

// ---------------------------------------------------------------- HSV <-> hex
// Inline on purpose (no deps). h in [0,360), s and v in [0,1].

function hexToRgb(hex: string): [number, number, number] | null {
  const m = HEX_RE.exec(hex.trim());
  if (!m) return null;
  const n = parseInt(m[1], 16);
  return [(n >> 16) & 255, (n >> 8) & 255, n & 255];
}

function rgbToHex(r: number, g: number, b: number): string {
  return '#' + ((1 << 24) | (r << 16) | (g << 8) | b).toString(16).slice(1);
}

function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  r /= 255;
  g /= 255;
  b /= 255;
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d > 0) {
    if (max === r) h = 60 * (((g - b) / d) % 6);
    else if (max === g) h = 60 * ((b - r) / d + 2);
    else h = 60 * ((r - g) / d + 4);
  }
  if (h < 0) h += 360;
  return [h, max === 0 ? 0 : d / max, max];
}

function hsvToHex(h: number, s: number, v: number): string {
  const c = v * s;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = v - c;
  let r = 0, g = 0, b = 0;
  if (h < 60) [r, g, b] = [c, x, 0];
  else if (h < 120) [r, g, b] = [x, c, 0];
  else if (h < 180) [r, g, b] = [0, c, x];
  else if (h < 240) [r, g, b] = [0, x, c];
  else if (h < 300) [r, g, b] = [x, 0, c];
  else [r, g, b] = [c, 0, x];
  return rgbToHex(Math.round((r + m) * 255), Math.round((g + m) * 255), Math.round((b + m) * 255));
}

const clamp01 = (n: number): number => Math.min(1, Math.max(0, n));

/** Coerce whatever the site stored into a #rrggbb the picker can open on. */
function normalize(color: string): string {
  const rgb = hexToRgb(color);
  return rgb ? rgbToHex(...rgb) : FALLBACK;
}

// -------------------------------------------------------------------- attach

export function attachColorPicker(swatch: HTMLElement, opts: ColorPickerOpts): void {
  // The swatch always wears the current color; callers style everything else.
  swatch.style.backgroundColor = normalize(opts.value());

  let pop: HTMLElement | null = null;
  let closedByOutsideAt = 0; // see the click handler: a forwarded icon-click's own pointerdown already closed us

  const close = (byOutside = false): void => {
    if (!pop) return;
    const changed = pop.dataset.changed === '1';
    pop.remove();
    pop = null;
    document.removeEventListener('pointerdown', onDocDown, true);
    document.removeEventListener('keydown', onKey, true);
    if (byOutside) closedByOutsideAt = Date.now();
    opts.onClose?.(changed);
  };

  const onDocDown = (e: PointerEvent): void => {
    const t = e.target as Node | null;
    if (!pop || !t) return;
    if (pop.contains(t) || swatch.contains(t) || t === swatch) return;
    close(true);
  };

  const onKey = (e: KeyboardEvent): void => {
    if (e.key !== 'Escape') return;
    e.stopPropagation(); // the Escape that dismisses the card must not also close whatever is underneath
    close();
  };

  const open = (): void => {
    const host = opts.host?.() ?? document.body;

    // State lives per visit; hue survives gray colors only within the visit,
    // which matches how the native square behaves after a reopen.
    let [h, s, v] = (() => {
      const rgb = hexToRgb(opts.value());
      return rgbToHsv(...(rgb ?? hexToRgb(FALLBACK)!));
    })();

    const sq = el('div', { class: 'cp-sq' });
    const knob = el('div', { class: 'cp-knob' });
    sq.append(knob);
    const hue = el('div', { class: 'cp-hue' });
    const hueKnob = el('div', { class: 'cp-hue-knob' });
    hue.append(hueKnob);
    const chip = el('div', { class: 'cp-chip' });
    const hexIn = el('input', { class: 'cp-hex', type: 'text', 'aria-label': 'Hex color' }) as HTMLInputElement;
    hexIn.spellcheck = false;
    hexIn.maxLength = 7; // "#rrggbb"; six hex digits also parse without the hash
    const row = el('div', { class: 'cp-row' }, [chip, hexIn]);
    pop = el('div', { class: 'cp-pop' }, [sq, hue, row]);

    /** Repaint everything from (h,s,v); notify = stream the color to the caller. */
    const commit = (notify: boolean): void => {
      const hex = hsvToHex(h, s, v);
      const pure = `hsl(${h}, 100%, 50%)`;
      sq.style.background = `linear-gradient(to top, #000, rgba(0, 0, 0, 0)), linear-gradient(to right, #fff, ${pure})`;
      knob.style.left = `${s * 100}%`;
      knob.style.top = `${(1 - v) * 100}%`;
      knob.style.backgroundColor = hex;
      hueKnob.style.left = `${(h / 360) * 100}%`;
      hueKnob.style.backgroundColor = pure;
      chip.style.backgroundColor = hex;
      if (document.activeElement !== hexIn) hexIn.value = hex;
      swatch.style.backgroundColor = hex;
      if (notify) {
        if (pop) pop.dataset.changed = '1';
        opts.onChange(hex);
      }
    };

    // One drag wiring for both surfaces. Capture is best-effort only (synthetic
    // pointer ids from the demo's ghost cursor make it throw); the window-level
    // move/up pair is what keeps a real drag alive once the pointer leaves the
    // surface, and the surface-level pair catches synthetic events dispatched
    // straight at the element without bubbling. Double delivery of a bubbled
    // move is harmless: apply() just re-derives the same state from clientX/Y.
    const drag = (surface: HTMLElement, apply: (e: PointerEvent) => void): void => {
      let active = false;
      const move = (ev: PointerEvent): void => {
        if (active) apply(ev);
      };
      const stop = (): void => {
        active = false;
        window.removeEventListener('pointermove', move);
        window.removeEventListener('pointerup', stop);
        window.removeEventListener('pointercancel', stop);
      };
      surface.addEventListener('pointermove', move);
      surface.addEventListener('pointerup', stop);
      surface.addEventListener('pointercancel', stop);
      surface.addEventListener('pointerdown', (e) => {
        e.preventDefault();
        e.stopPropagation();
        try {
          surface.setPointerCapture(e.pointerId);
        } catch {
          /* synthetic pointer id: no capture, the listeners above cover it */
        }
        active = true;
        apply(e);
        window.addEventListener('pointermove', move);
        window.addEventListener('pointerup', stop);
        window.addEventListener('pointercancel', stop);
      });
    };

    // Fractions of the surface's bounding rect: correct at any CSS scale, which
    // is what lets the same math work inside the shrunken landing demo frame.
    drag(sq, (e) => {
      const r = sq.getBoundingClientRect();
      if (!r.width || !r.height) return;
      s = clamp01((e.clientX - r.left) / r.width);
      v = 1 - clamp01((e.clientY - r.top) / r.height);
      commit(true);
    });
    drag(hue, (e) => {
      const r = hue.getBoundingClientRect();
      if (!r.width) return;
      h = Math.min(359.999, clamp01((e.clientX - r.left) / r.width) * 360);
      commit(true);
    });

    // The hex box: typing a full #rrggbb applies live; Enter or blur tidies the
    // text back to the canonical lowercase form. Invalid text just sits there
    // until corrected, the last good color stays in force.
    const applyHex = (): boolean => {
      const rgb = hexToRgb(hexIn.value);
      if (!rgb) return false;
      [h, s, v] = rgbToHsv(...rgb);
      commit(true);
      return true;
    };
    hexIn.addEventListener('input', () => {
      if (HEX_RE.test(hexIn.value)) applyHex();
    });
    hexIn.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      e.preventDefault();
      applyHex();
      hexIn.value = hsvToHex(h, s, v);
      hexIn.blur();
    });
    hexIn.addEventListener('blur', () => {
      applyHex();
      hexIn.value = hsvToHex(h, s, v);
    });
    // Keep pop-internal presses from reaching the outside-close listener's world
    // (they can't close us, but a backdrop underneath must not react either).
    pop.addEventListener('pointerdown', (e) => e.stopPropagation());

    commit(false); // paint the opening state without echoing it back
    host.append(pop);
    place(pop, swatch, host);
    document.addEventListener('pointerdown', onDocDown, true);
    document.addEventListener('keydown', onKey, true);
  };

  swatch.addEventListener('click', (e) => {
    e.preventDefault();
    if (pop) {
      close();
      return;
    }
    // A click on a FORWARDING element (the folder icon routes here via
    // swatch.click()) begins with a pointerdown that our outside-close listener
    // already acted on. Reopening now would make the icon un-closeable, so a
    // click landing right after an outside-close is read as that same gesture.
    if (Date.now() - closedByOutsideAt < 300) return;
    open();
  });
}

// ---------------------------------------------------------------- placement

/** Below-left of the swatch when it fits, above when it does not, and always
 *  CLAMPED fully inside the host's box (the landing demo frame is a hard border:
 *  the card must never poke outside the device). All math runs in visual
 *  (getBoundingClientRect) space, then converts to the host's layout units, so a
 *  CSS-scaled host positions exactly as an unscaled one. */
function place(pop: HTMLElement, swatch: HTMLElement, host: HTMLElement): void {
  // Measure from a known origin: with left/top at 0 the delta between where the
  // card IS and where it SHOULD BE is the style we need, whatever the host's
  // own positioning context is.
  pop.style.visibility = 'hidden';
  pop.style.left = '0px';
  pop.style.top = '0px';
  const r0 = pop.getBoundingClientRect();
  const sw = swatch.getBoundingClientRect();
  const scale = pop.offsetWidth ? r0.width / pop.offsetWidth : 1;
  const gap = 6 * scale;
  const margin = 8 * scale;

  // The box to stay inside: the host's own rect, or the viewport for the body.
  const bounds =
    host === document.body
      ? { left: 0, top: 0, right: window.innerWidth, bottom: window.innerHeight }
      : host.getBoundingClientRect();

  let x = sw.left; // below-left preferred: left edges aligned, card under the swatch
  let y = sw.bottom + gap;
  if (y + r0.height > bounds.bottom - margin) y = sw.top - gap - r0.height; // flip above
  x = Math.max(bounds.left + margin, Math.min(x, bounds.right - r0.width - margin));
  y = Math.max(bounds.top + margin, Math.min(y, bounds.bottom - r0.height - margin));

  pop.style.left = `${(x - r0.left) / scale}px`;
  pop.style.top = `${(y - r0.top) / scale}px`;
  pop.style.visibility = '';
}
