// Cobalt completion feedback: chime + 5s undo toast (spec §6.6).

import { getPrefs } from '../prefs';

let audioCtx: AudioContext | null = null;

/** THE LANDING PAGE'S DEMO IS NOT A USER (Gabe, 8/15).
 *
 *  The hero demo drives the real app with a ghost cursor that dispatches real
 *  events, so checking a task off in the demo reached this function and played the
 *  chime — on a loop, forever, on the landing page. And the "Check-off sound"
 *  switch could not stop it: that setting lives in the signed-in profile, and the
 *  landing page is signed out, so the prefs read below returns the default (on).
 *
 *  This is what Gabe kept hearing on every reload while I worked. It took a stack
 *  trace to find, because nothing about the symptom pointed at the landing page:
 *
 *    playCompleteChime  ← tasks/complete.ts
 *    TasksView.bulkComplete
 *    HTMLButtonElement.<anonymous>
 *    GhostCursor.fire   ← landing/demo/cursor.ts
 *    loop               ← landing/demo/script.ts
 *
 *  The demo raises this for its lifetime. Deliberately a plain module flag and not
 *  a preference: it describes who is clicking, which is not the student's business. */
let demoSilent = false;
export function setDemoSilent(on: boolean): void {
  demoSilent = on;
}

/** A short pleasant two-note chime via Web Audio. Created lazily on first use.
 *
 *  Silent when Settings ▸ Sound ▸ "App sounds" is off (Gabe, 8/15). Gated HERE, at
 *  the one place the sound is produced, rather than at the two call sites, so a
 *  future caller cannot reintroduce it by forgetting the check. The focus end cue
 *  and music are deliberately NOT gated by this: those are sounds the student
 *  chose, not incidental feedback. */
export function playCompleteChime(): void {
  if (demoSilent || !getPrefs().sound.system) return;
  try {
    audioCtx ??= new (window.AudioContext || (window as any).webkitAudioContext)();
    const ctx = audioCtx;
    const now = ctx.currentTime;
    const notes = [
      { f: 660, t: 0 },
      { f: 880, t: 0.09 },
    ];
    for (const n of notes) {
      const osc = ctx.createOscillator();
      const gain = ctx.createGain();
      osc.type = 'sine';
      osc.frequency.value = n.f;
      gain.gain.setValueAtTime(0.0001, now + n.t);
      gain.gain.exponentialRampToValueAtTime(0.18, now + n.t + 0.02);
      gain.gain.exponentialRampToValueAtTime(0.0001, now + n.t + 0.18);
      osc.connect(gain).connect(ctx.destination);
      osc.start(now + n.t);
      osc.stop(now + n.t + 0.2);
    }
  } catch {
    /* audio not available — silent */
  }
}

let currentToast: { el: HTMLElement; timer: number } | null = null;

/** How long the slide-down exit takes — keep in sync with .toast's CSS transition. */
const TOAST_EXIT_MS = 320;

/** Show a single undo toast. Calls onExpire after 5s unless undone first.
 *  `host` scopes it to a container (e.g. the landing preview's device frame); it
 *  defaults to document.body (the normal full-page, viewport-pinned toast). */
export function showUndoToast(
  message: string,
  onUndo: () => void,
  onExpire: () => void,
  host?: HTMLElement
): void {
  dismissToast();

  const toast = document.createElement('div');
  toast.className = 'toast';
  const span = document.createElement('span');
  span.textContent = message;
  const btn = document.createElement('button');
  btn.textContent = 'Undo';
  toast.append(span, btn);
  (host ?? document.body).append(toast);

  // Slide up: force a layout pass so the hidden start state is painted first —
  // adding .show in the same frame as append would skip the transition entirely.
  void toast.offsetHeight;
  toast.classList.add('show');

  // Slide back down, then remove once the transition has played out.
  const leave = () => {
    toast.classList.remove('show');
    window.setTimeout(() => toast.remove(), TOAST_EXIT_MS);
  };

  const expireTimer = window.setTimeout(() => {
    currentToast = null;
    leave();
    onExpire();
  }, 5000);

  btn.addEventListener('click', () => {
    clearTimeout(expireTimer);
    currentToast = null;
    leave();
    onUndo(); // undo applies immediately; the toast glides out on its own
  });

  currentToast = { el: toast, timer: expireTimer };
}

/** Dismiss any visible toast WITHOUT firing its expire callback. */
export function dismissToast(): void {
  if (currentToast) {
    clearTimeout(currentToast.timer);
    currentToast.el.remove();
    currentToast = null;
  }
}
