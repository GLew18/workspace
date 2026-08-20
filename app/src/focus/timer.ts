// Cobalt: focus audio + time helpers (spec §8.2).
//
// The AudioContext is created during the START click (a user gesture) and reused,
// so the completion fanfare can fire later without a fresh gesture.

let ctx: AudioContext | null = null;

/** Create/resume the shared AudioContext. Call this inside the start-click handler. */
export function armAudioContext(): void {
  try {
    // latencyHint 'playback', NOT the default 'interactive' (Gabe, 8/19/26).
    //
    // The default asks for the smallest possible output buffer, which is right for a
    // game or an instrument and wrong for playing music: it leaves the audio thread
    // needing to deliver on a very tight deadline, and a device that occasionally
    // misses that deadline underruns, which is heard as static and dropouts. That is
    // exactly the situation on a remote-desktop session, where the sound device is a
    // virtual one whose timing depends on a network.
    //
    // It also explains the one result that looked contradictory: ordinary <audio>
    // playback (YouTube) stayed clean throughout, because the media pipeline buffers
    // deeply, while Web Audio on the same machine at the same moment did not.
    //
    // 'playback' asks for the largest buffer instead. The cost is output latency,
    // which for a timer chime and background music is not perceptible.
    ctx ??= new (window.AudioContext || (window as any).webkitAudioContext)({ latencyHint: 'playback' });
    if (ctx.state === 'suspended') void ctx.resume();
  } catch {
    /* audio unavailable */
  }
}

/** The shared, gesture-armed AudioContext (or null if unavailable). Used by the
 *  end-sound library (focus/sounds.ts) to schedule completion cues. */
export function audioCtx(): AudioContext | null {
  return ctx;
}

/** Seconds → 'M:SS' or 'H:MM:SS'. */
export function formatClock(totalSec: number, showSeconds = true): string {
  const s = Math.max(0, Math.round(totalSec));
  const pad = (n: number) => String(n).padStart(2, '0');
  if (showSeconds) {
    const h = Math.floor(s / 3600);
    const m = Math.floor((s % 3600) / 60);
    const sec = s % 60;
    return h > 0 ? `${h}:${pad(m)}:${pad(sec)}` : `${m}:${pad(sec)}`;
  }
  // No seconds: show H:MM, rounding the partial minute UP so the countdown never
  // reads lower than the time actually remaining.
  const totalM = Math.ceil(s / 60);
  const h = Math.floor(totalM / 60);
  const m = totalM % 60;
  return `${h}:${pad(m)}`;
}
