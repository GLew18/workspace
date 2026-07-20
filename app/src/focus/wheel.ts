// WorkSpace — the endless number wheel (carousel column). One implementation,
// shared by the Focus setup's H:M:S length picker, the in-session custom add/trim
// popup, and the landing demo's custom picker — so every wheel in the app scrolls,
// snaps and loops identically.
//
// The values are laid out WHEEL_REPEAT times back-to-back so the list loops
// seamlessly (12 → 0 and back). As the user drifts toward either end we silently
// jump them back to the middle copy (recenter) — every copy is identical, so the
// jump is invisible but gives infinite room to keep scrolling.

import { el } from '../util/dom';

export const WHEEL_ITEM_H = 34; // row height; the scroll math depends on it
const WHEEL_REPEAT = 21;

export interface Wheel {
  wheel: HTMLElement;
  value: () => number;
  scrollTo: (v: number) => void;
  animateTo: (v: number, duration?: number) => void;
}

export function makeWheel(values: number[], onChange: () => void): Wheel {
  const n = values.length;
  const wheel = el('div', { class: 'focus-wheel' });
  for (let copy = 0; copy < WHEEL_REPEAT; copy++) {
    for (const v of values) wheel.append(el('div', { class: 'focus-wheel-item', text: String(v).padStart(2, '0') }));
  }
  const middleStart = Math.floor(WHEEL_REPEAT / 2) * n; // first item index of the centre copy

  const centreIndex = () => Math.round(wheel.scrollTop / WHEEL_ITEM_H); // which item is centred (absolute)
  const valueIndex = () => ((centreIndex() % n) + n) % n; // …mapped to 0..n-1 (loops)
  const updateActive = () => {
    const c = centreIndex();
    [...wheel.children].forEach((it, j) => (it as HTMLElement).classList.toggle('active', j === c));
  };
  const recenter = () => {
    const c = centreIndex();
    if (c < n || c >= (WHEEL_REPEAT - 1) * n) wheel.scrollTop = (middleStart + valueIndex()) * WHEEL_ITEM_H;
  };

  let raf = 0;
  let snapTimer = 0;
  let animRaf = 0;
  let suppressSnap = false; // true while animateTo is driving the scroll
  wheel.addEventListener(
    'scroll',
    () => {
      cancelAnimationFrame(raf);
      raf = requestAnimationFrame(() => {
        recenter();
        updateActive();
        onChange();
      });
      if (suppressSnap) return; // a smooth animateTo owns the position right now
      clearTimeout(snapTimer);
      snapTimer = window.setTimeout(() => {
        const top = centreIndex() * WHEEL_ITEM_H;
        if (wheel.scrollTop !== top) wheel.scrollTop = top;
      }, 120);
    },
    { passive: true }
  );
  wheel.addEventListener('click', (e) => {
    const item = (e.target as HTMLElement).closest('.focus-wheel-item');
    if (item) wheel.scrollTo({ top: [...wheel.children].indexOf(item) * WHEEL_ITEM_H, behavior: 'smooth' });
  });
  return {
    wheel,
    value: () => values[valueIndex()],
    scrollTo: (v: number) => {
      wheel.scrollTop = (middleStart + Math.max(0, values.indexOf(v))) * WHEEL_ITEM_H;
      updateActive();
    },
    animateTo: (v: number, duration = 420) => {
      cancelAnimationFrame(animRaf);
      clearTimeout(snapTimer);
      const c = centreIndex();
      let delta = Math.max(0, values.indexOf(v)) - (((c % n) + n) % n);
      if (delta > n / 2) delta -= n;
      if (delta < -n / 2) delta += n;
      const from = wheel.scrollTop;
      const to = (c + delta) * WHEEL_ITEM_H;
      if (Math.abs(to - from) < 1) return;
      suppressSnap = true;
      let t0: number | undefined;
      const stepAnim = (ts: number) => {
        if (t0 === undefined) t0 = ts;
        const p = Math.min(1, (ts - t0) / duration);
        wheel.scrollTop = from + (to - from) * (0.5 - 0.5 * Math.cos(Math.PI * p)); // easeInOutSine
        updateActive();
        if (p < 1) animRaf = requestAnimationFrame(stepAnim);
        else suppressSnap = false;
      };
      animRaf = requestAnimationFrame(stepAnim);
    },
  };
}
