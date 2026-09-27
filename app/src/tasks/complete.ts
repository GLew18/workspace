// Cobalt completion feedback: the chime.
//
// The 5-second "task completed · Undo" toast that used to live here was removed
// 9/26 (Gabe): a checked-off task now stays on screen, crossed out, and clicking
// its checkbox again IS the undo, so a timed toast offering the same thing was noise.

import { getPrefs } from '../prefs';
import { isDemoSilent } from '../util/silence';

let audioCtx: AudioContext | null = null;

/** A short pleasant two-note chime via Web Audio. Created lazily on first use.
 *
 *  Silent when Settings ▸ Sound ▸ "App sounds" is off (Gabe, 8/15). Gated HERE, at
 *  the one place the sound is produced, rather than at the two call sites, so a
 *  future caller cannot reintroduce it by forgetting the check. The focus end cue
 *  and music are deliberately NOT gated by this: those are sounds the student
 *  chose, not incidental feedback. */
export function playCompleteChime(): void {
  if (isDemoSilent() || !getPrefs().sound.system) return;
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
