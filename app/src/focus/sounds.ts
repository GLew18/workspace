// Cobalt: Focus end-of-session sounds.
//
// Ten themed completion cues, fully synthesized with the Web Audio API (no asset
// files). The user picks one in Settings; the chosen key is played by the Focus
// view when a session completes. All cues share the gesture-armed AudioContext
// from timer.ts so they fire from a background-tab setInterval without a fresh
// user gesture.
//
// Each cue is a sustained ~5–8s "the session is clearly over" signal (not a quick
// ping that could be mistaken for a stray website sound). Everything is routed
// through a per-playback gain (the user's Volume setting) into a limiter, so the
// louder default can't harshly clip when many oscillators stack up.

import { armAudioContext, audioCtx } from './timer';

export interface EndSound {
  key: string;
  label: string;
  emoji: string;
  desc: string;
}

/** A running playback you can stop early; durationMs lets the UI revert a
 *  play/pause button once the cue finishes on its own. */
export interface EndSoundHandle {
  stop: () => void;
  /** Adjust the volume of the in-progress playback instantly (0..1). */
  setVolume: (volume: number) => void;
  durationMs: number;
}

/** The catalogue shown in Settings. `key` is what gets persisted/played. */
export const END_SOUNDS: EndSound[] = [
  { key: 'fanfare', label: 'Fanfare', emoji: '🎺', desc: 'Triumphant brass + cymbals' },
  { key: 'zen', label: 'Zen Gong', emoji: '🧘', desc: 'Deep, slow temple gong' },
  { key: 'arcade', label: 'Arcade', emoji: '🕹️', desc: '8-bit level-up jingle' },
  { key: 'marimba', label: 'Marimba', emoji: '🎶', desc: 'Warm wooden mallets' },
  { key: 'bell', label: 'Bell', emoji: '🔔', desc: 'Bright ringing bell' },
  { key: 'synthwave', label: 'Synthwave', emoji: '🌆', desc: 'Retro saw-chord swell' },
  { key: 'ping', label: 'Ping', emoji: '📲', desc: 'Clean two-tone chime' },
  { key: 'harp', label: 'Harp', emoji: '🎼', desc: 'Ascending glissando' },
  { key: 'drumroll', label: 'Drumroll', emoji: '🥁', desc: 'Roll into a crash' },
  { key: 'ambient', label: 'Ambient', emoji: '🌊', desc: 'Soft calming swell' },
];

export const DEFAULT_END_SOUND = 'fanfare';

/** Default Volume slider position (0..1). 0.8 reads as "clearly audible" once it
 *  passes through GAIN_SCALE below. */
export const DEFAULT_END_VOLUME = 0.8;

/** Maps the 0..1 Volume slider to an actual gain. >1 so the default is punchier
 *  than the raw note peaks; the limiter in playEndSound tames the peaks. */
const GAIN_SCALE = 1.6;

// #region Audio primitives
interface NoteOpts {
  attack?: number; // seconds to reach peak (default 0.01)
  glideTo?: number; // glide the pitch to this freq over the note
}

// All voices connect here during a single playEndSound() call (the per-playback
// gain node), and we track the latest scheduled end so the UI knows the length.
let currentDest: AudioNode | null = null;
let scheduledEnd = 0;
const dest = (c: AudioContext): AudioNode => currentDest ?? c.destination;
const markEnd = (end: number): void => {
  if (end > scheduledEnd) scheduledEnd = end;
};

/** One enveloped oscillator note. Exponential attack + decay (never ramps to a
 *  true 0 — Web Audio forbids exponential ramps to zero). */
function note(
  c: AudioContext,
  type: OscillatorType,
  freq: number,
  start: number,
  dur: number,
  peak: number,
  opts: NoteOpts = {}
): void {
  const t = c.currentTime + start;
  const o = c.createOscillator();
  const g = c.createGain();
  o.type = type;
  o.frequency.setValueAtTime(freq, t);
  if (opts.glideTo) o.frequency.exponentialRampToValueAtTime(opts.glideTo, t + dur);
  const attack = Math.min(opts.attack ?? 0.01, dur * 0.5);
  g.gain.setValueAtTime(0.0001, t);
  g.gain.exponentialRampToValueAtTime(peak, t + attack);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  o.connect(g).connect(dest(c));
  o.start(t);
  o.stop(t + dur + 0.05);
  markEnd(start + dur + 0.05);
}

/** White-noise burst with exponential decay (cymbal / drum / hat). */
function noise(c: AudioContext, start: number, dur: number, peak: number, decayTau: number): void {
  const t = c.currentTime + start;
  const len = Math.max(1, Math.floor(c.sampleRate * dur));
  const buf = c.createBuffer(1, len, c.sampleRate);
  const d = buf.getChannelData(0);
  for (let i = 0; i < len; i++) {
    d[i] = (Math.random() * 2 - 1) * Math.exp(-i / (c.sampleRate * decayTau));
  }
  const src = c.createBufferSource();
  src.buffer = buf;
  const g = c.createGain();
  g.gain.setValueAtTime(peak, t);
  g.gain.exponentialRampToValueAtTime(0.0001, t + dur);
  src.connect(g).connect(dest(c));
  src.start(t);
  markEnd(start + dur);
}

/** Where a cue's finale begins: overlapping the body's tail so it lands as a
 *  climax rather than a separate appended sound. Each cue then plays its OWN
 *  finale in its own voice (see below), so the ending is unmistakably that sound. */
function finaleAt(): number {
  return Math.max(0.2, scheduledEnd - 0.4);
}
// #endregion

// #region The ten cues — each sustained ~5–8s
/** Triumphant 148-BPM brass fanfare, cymbal crashes, then a held ring-out chord. */
function fanfare(c: AudioContext): void {
  const beat = 60 / 148;
  const e = beat * 0.5, q = beat, h = beat * 2;
  const Bb4 = 466.16, Ab4 = 415.3, Db5 = 554.37, C5 = 523.25, Eb5 = 622.25, F5 = 698.46;
  // A brassy note = square + octave saw + two-octave sine, summed.
  const tr = (freq: number, start: number, dur: number, v: number) => {
    note(c, 'square', freq, start, dur, v);
    note(c, 'sawtooth', freq * 2, start, dur, v * 0.5);
    note(c, 'sine', freq * 3, start, dur, v * 0.4);
  };
  let p = 0;
  for (let i = 0; i < 3; i++) { tr(Bb4, p, e * 0.8, 0.12); p += e; }
  tr(Ab4, p, e * 0.8, 0.1); p += e;
  tr(Bb4, p, q * 1.5, 0.14); p += q * 2;
  for (let i = 0; i < 3; i++) { tr(Db5, p, e * 0.8, 0.13); p += e; }
  tr(C5, p, e * 0.8, 0.11); p += e;
  tr(Db5, p, q * 1.5, 0.15); p += q * 2;
  tr(Eb5, p, q * 1.5, 0.16); p += q * 2;
  tr(Db5, p, e * 0.8, 0.13); p += e;
  tr(Eb5, p, e * 0.8, 0.13); p += e;
  tr(F5, p, h * 1.5, 0.18); p += h * 2;
  noise(c, 0, 0.4, 0.12, 0.08);
  noise(c, beat * 4, 0.4, 0.12, 0.08);
  noise(c, beat * 8, 0.4, 0.12, 0.08);
  // Sustained ring-out: a held chord + final cymbal swell so the cue lands.
  [Bb4, Db5, F5].forEach((freq) => {
    note(c, 'square', freq, p, 2.0, 0.11);
    note(c, 'sawtooth', freq * 2, p, 2.0, 0.05);
    note(c, 'sine', freq * 3, p, 2.0, 0.04);
  });
  noise(c, p, 0.8, 0.13, 0.14);
}

/** Deep temple gong: low fundamental + inharmonic partials, struck three times,
 *  long decays that overlap into a continuous resonance. */
function zen(c: AudioContext): void {
  const strike = (start: number, base: number, v: number, dur: number) => {
    ([[1, v], [2.4, v * 0.4], [4.1, v * 0.2], [5.8, v * 0.12]] as number[][]).forEach(
      ([mult, vol]) => note(c, 'sine', base * mult, start, dur, vol, { attack: 0.05 })
    );
  };
  strike(0, 96, 0.34, 6.5);
  strike(0.16, 144, 0.12, 5.5); // faint higher shimmer
  strike(2.6, 96, 0.22, 4.5); // a second, softer toll
  // Finale: one deep, resonant final toll in the gong's own inharmonic voice.
  const zf = finaleAt();
  ([[1, 0.32], [2.4, 0.16], [4.1, 0.09], [5.8, 0.05], [7.4, 0.03]] as number[][]).forEach(
    ([mult, vol]) => note(c, 'sine', 72 * mult, zf, 3.6, vol, { attack: 0.04 })
  );
}

/** 8-bit "level up": three rising square runs, then a triumphant high cap chord. */
function arcade(c: AudioContext): void {
  const seq = [523.25, 659.25, 783.99, 1046.5]; // C5 E5 G5 C6
  const run = (base: number, vol: number) => {
    seq.forEach((f, i) => note(c, 'square', f, base + i * 0.09, 0.1, vol, { attack: 0.005 }));
    note(c, 'square', 1046.5, base + seq.length * 0.09, 0.26, vol + 0.02, { attack: 0.005 });
  };
  run(0, 0.15);
  run(0.95, 0.16);
  run(1.9, 0.17);
  const p = 2.95;
  [1046.5, 1318.51, 1567.98, 2093.0].forEach((f, i) =>
    note(c, 'square', f, p + i * 0.1, 0.16, 0.15, { attack: 0.005 })
  );
  // Sustained high cap chord rings the win out.
  [1046.5, 1567.98, 2093.0].forEach((f, i) =>
    note(c, 'square', f, p + 0.5, 1.7, 0.13 - i * 0.025, { attack: 0.005 })
  );
  // Finale: an 8-bit victory sting — ascending blips into a held square power chord.
  const af = finaleAt();
  [1046.5, 1318.51, 1567.98].forEach((f, i) =>
    note(c, 'square', f, af + i * 0.07, 0.09, 0.16, { attack: 0.004 })
  );
  [523.25, 1046.5, 1567.98, 2093.0].forEach((f) =>
    note(c, 'square', f, af + 0.21, 1.2, 0.13, { attack: 0.004 })
  );
}

/** Warm wooden mallets: up/down/up arpeggio runs over a soft low bed, final ring. */
function marimba(c: AudioContext): void {
  const up = [523.25, 659.25, 783.99, 987.77, 1046.5];
  const down = [987.77, 783.99, 659.25, 523.25];
  const play = (arr: number[], base: number) =>
    arr.forEach((f, i) => {
      note(c, 'triangle', f, base + i * 0.12, 0.5, 0.18, { attack: 0.004 });
      note(c, 'sine', f * 2, base + i * 0.12, 0.2, 0.05, { attack: 0.004 });
    });
  play(up, 0);
  play(down, 0.6);
  play(up, 1.1);
  play(down, 1.75);
  play(up, 2.25);
  note(c, 'sine', 261.63, 0, 5.2, 0.06, { attack: 0.4 }); // warm sustained bed
  note(c, 'triangle', 523.25, 2.85, 1.8, 0.14, { attack: 0.01 }); // final ring
  note(c, 'sine', 1046.5, 2.85, 1.8, 0.06, { attack: 0.01 });
  // Finale: a warm wooden mallet roll resolving to a held chord (no metal).
  const mf = finaleAt();
  [523.25, 659.25, 783.99, 1046.5].forEach((f, i) => {
    note(c, 'triangle', f, mf + i * 0.05, 0.4, 0.16, { attack: 0.004 });
    note(c, 'sine', f * 2, mf + i * 0.05, 0.2, 0.04, { attack: 0.004 });
  });
  note(c, 'triangle', 261.63, mf, 1.6, 0.12, { attack: 0.01 }); // warm low root
  note(c, 'sine', 523.25, mf + 0.2, 1.4, 0.05, { attack: 0.01 });
}

/** Bright inharmonic bell, struck five times, trailing off into a long final ring. */
function bell(c: AudioContext): void {
  const strike = (start: number, base: number, v: number) => {
    ([[1, v], [2.76, v * 0.5], [5.4, v * 0.25], [8.9, v * 0.1]] as number[][]).forEach(
      ([mult, vol]) => note(c, 'sine', base * mult, start, 2.4, vol, { attack: 0.002 })
    );
  };
  strike(0, 660, 0.18);
  strike(0.55, 880, 0.14);
  strike(1.3, 660, 0.12);
  strike(2.2, 990, 0.1);
  strike(3.3, 660, 0.09); // final long ring
  // Finale: a big, bright bell toll — strong inharmonic partials, long shimmering ring.
  const bf = finaleAt();
  ([[1, 0.26], [2.0, 0.1], [2.76, 0.16], [3.5, 0.07], [5.4, 0.1], [8.2, 0.04]] as number[][]).forEach(
    ([mult, vol]) => note(c, 'sine', 880 * mult, bf, 3.0, vol, { attack: 0.001 })
  );
  note(c, 'sine', 1760, bf + 0.02, 2.4, 0.05, { attack: 0.001 }); // octave shimmer
}

/** Retro saw-chord swell that evolves through two colors over a rising bass. */
function synthwave(c: AudioContext): void {
  const pad = (freqs: number[], start: number, dur: number, v: number) =>
    freqs.forEach((f) => note(c, 'sawtooth', f, start, dur, v, { attack: 0.3 }));
  pad([261.63, 329.63, 392.0, 523.25], 0, 3.0, 0.06); // C major
  pad([220.0, 329.63, 440.0, 523.25], 2.6, 3.0, 0.06); // moves toward A minor
  note(c, 'sawtooth', 130.81, 0, 2.2, 0.06, { attack: 0.1, glideTo: 523.25 });
  note(c, 'sawtooth', 110.0, 2.6, 2.6, 0.06, { attack: 0.1, glideTo: 440.0 });
  note(c, 'triangle', 1046.5, 0.5, 4.5, 0.03, { attack: 0.6 }); // high shimmer
  // Finale: a fat retro saw chord with a sub-bass sweep down (synthwave signature).
  const sf = finaleAt();
  [130.81, 196.0, 261.63, 392.0, 523.25].forEach((f) =>
    note(c, 'sawtooth', f, sf, 2.2, 0.07, { attack: 0.02 })
  );
  note(c, 'sawtooth', 130.81, sf, 1.8, 0.1, { attack: 0.01, glideTo: 65.41 }); // sub drop
  note(c, 'sawtooth', 1046.5, sf, 2.0, 0.035, { attack: 0.1 }); // bright top
}

/** Clean two-tone chime, repeated gently over a soft bed, with a final accent. */
function ping(c: AudioContext): void {
  const ding = (start: number, v: number) => {
    note(c, 'sine', 880, start, 0.18, v, { attack: 0.004 });
    note(c, 'sine', 1318.5, start + 0.12, 0.45, v, { attack: 0.004 });
  };
  ding(0, 0.2);
  ding(1.1, 0.18);
  ding(2.2, 0.16);
  ding(3.3, 0.14);
  note(c, 'sine', 659.25, 0, 5.0, 0.04, { attack: 0.5 }); // soft sustained bed
  note(c, 'sine', 1318.5, 4.2, 1.2, 0.12, { attack: 0.01 }); // final accent
  // Finale: a clean, bright two-tone chime — crystalline sine, no percussion.
  const pf = finaleAt();
  note(c, 'sine', 1318.5, pf, 0.5, 0.2, { attack: 0.002 });
  note(c, 'sine', 1760.0, pf + 0.1, 1.3, 0.22, { attack: 0.002 });
  note(c, 'sine', 2637.0, pf + 0.1, 0.8, 0.05, { attack: 0.002 }); // faint sparkle
}

/** Ascending pentatonic harp glissando, up/down/up, into a sustained final chord. */
function harp(c: AudioContext): void {
  const gliss = [392.0, 440.0, 523.25, 587.33, 659.25, 783.99, 880.0, 1046.5];
  const run = (base: number, vol: number, arr: number[]) =>
    arr.forEach((f, i) => note(c, 'triangle', f, base + i * 0.06, 0.7, vol, { attack: 0.003 }));
  run(0, 0.12, gliss);
  run(0.55, 0.11, [...gliss].reverse());
  run(1.15, 0.12, gliss);
  run(1.75, 0.1, [...gliss].reverse());
  run(2.4, 0.12, gliss);
  [392.0, 587.33, 783.99, 1046.5].forEach((f) =>
    note(c, 'sine', f, 2.9, 2.2, 0.07, { attack: 0.05 })
  ); // sustained final chord
  // Finale: a final harp strum resolving up into a soft sustained chord (no metal).
  const hf = finaleAt();
  [392.0, 523.25, 659.25, 783.99, 1046.5].forEach((f, i) =>
    note(c, 'triangle', f, hf + i * 0.04, 0.5, 0.12, { attack: 0.003 })
  );
  [392.0, 587.33, 783.99, 1174.66].forEach((f) =>
    note(c, 'sine', f, hf + 0.2, 2.4, 0.05, { attack: 0.04 })
  );
}

/** A long crescendoing roll into a crash, a second swell, then a booming ring. */
function drumroll(c: AudioContext): void {
  const roll = (start: number, dur: number, n: number, fromV: number, toV: number) => {
    for (let i = 0; i < n; i++) {
      noise(c, start + i * (dur / n), 0.05, fromV + (toV - fromV) * (i / n), 0.012);
    }
  };
  roll(0, 2.4, 48, 0.03, 0.13);
  noise(c, 2.4, 0.6, 0.18, 0.12); // crash
  note(c, 'sine', 110, 2.4, 0.6, 0.2, { attack: 0.005, glideTo: 55 }); // boom
  roll(2.9, 1.7, 34, 0.05, 0.15);
  noise(c, 4.6, 0.7, 0.2, 0.14); // final crash
  note(c, 'sine', 110, 4.6, 1.0, 0.22, { attack: 0.005, glideTo: 55 }); // big boom
  // Finale: the biggest crash + a deep booming drop (percussion is its identity).
  const df = finaleAt();
  noise(c, df, 0.08, 0.18, 0.01); // attack transient
  noise(c, df, 1.3, 0.22, 0.2); // big crash wash
  note(c, 'sine', 73.42, df, 1.1, 0.24, { attack: 0.004, glideTo: 41 }); // deep boom drop
}

/** Soft calming pad that slowly drifts through two chord colors over ~8s. */
function ambient(c: AudioContext): void {
  const pad = (freqs: number[], start: number, dur: number, v: number, attack: number) =>
    freqs.forEach((f) => note(c, 'sine', f, start, dur, v, { attack }));
  pad([220, 277.18, 329.63], 0, 5.0, 0.12, 0.6);
  pad([196.0, 293.66, 349.23], 3.5, 4.2, 0.11, 0.8); // drifts to a new color
  note(c, 'sine', 110, 0, 7.5, 0.1, { attack: 0.8 });
  note(c, 'triangle', 659.25, 1.0, 6.0, 0.03, { attack: 1.2 }); // faint shimmer
  // Finale: a warm major chord that blooms and slowly fades — gentle, no percussion.
  const amf = finaleAt();
  [130.81, 196.0, 261.63, 329.63].forEach((f) =>
    note(c, 'sine', f, amf, 3.6, 0.13, { attack: 0.5 })
  );
  note(c, 'sine', 65.41, amf, 3.8, 0.1, { attack: 0.6 }); // deep warm root
  note(c, 'triangle', 523.25, amf, 3.0, 0.03, { attack: 0.8 }); // faint shimmer
}

const BUILDERS: Record<string, (c: AudioContext) => void> = {
  fanfare, zen, arcade, marimba, bell, synthwave, ping, harp, drumroll, ambient,
};
// #endregion

/**
 * Play the named end sound at `volume` (0..1; falls back to the default for an
 * unknown key). Returns a handle so a preview button can show a play/pause state
 * and stop the cue early.
 */
export function playEndSound(key: string, volume: number = DEFAULT_END_VOLUME): EndSoundHandle {
  armAudioContext();
  const c = audioCtx();
  if (!c) return { stop: () => {}, setVolume: () => {}, durationMs: 0 };

  // Build + schedule the whole cue on the (running) context.
  const schedule = (): EndSoundHandle => {
    const vol = Math.max(0, Math.min(1, volume));
    // Per-playback chain: user volume -> limiter -> speakers. The limiter lets the
    // louder default push hard without harshly clipping when voices stack.
    const sessionGain = c.createGain();
    let curGain = Math.max(0.0001, vol * GAIN_SCALE); // tracked so setVolume can re-ramp cleanly
    sessionGain.gain.value = curGain;
    const limiter = c.createDynamicsCompressor();
    limiter.threshold.value = -8;
    limiter.knee.value = 6;
    limiter.ratio.value = 12;
    limiter.attack.value = 0.003;
    limiter.release.value = 0.25;
    sessionGain.connect(limiter).connect(c.destination);

    currentDest = sessionGain;
    scheduledEnd = 0;
    try {
      (BUILDERS[key] || BUILDERS[DEFAULT_END_SOUND])(c);
    } catch {
      /* audio scheduling failed — non-fatal */
    } finally {
      currentDest = null;
    }
    const durationMs = Math.round(scheduledEnd * 1000) + 200;

    let stopped = false;
    const stop = (): void => {
      if (stopped) return;
      stopped = true;
      try {
        const now = c.currentTime;
        sessionGain.gain.cancelScheduledValues(now);
        sessionGain.gain.setValueAtTime(curGain, now);
        sessionGain.gain.exponentialRampToValueAtTime(0.0001, now + 0.12);
      } catch {
        /* ignore */
      }
    };

    // Live volume: dragging the slider mid-preview re-ramps the gain right away, so
    // the change is heard on the currently-playing cue without restarting it.
    const setVolume = (v: number): void => {
      if (stopped) return;
      const g = Math.max(0.0001, Math.max(0, Math.min(1, v)) * GAIN_SCALE);
      try {
        const now = c.currentTime;
        sessionGain.gain.cancelScheduledValues(now);
        sessionGain.gain.setValueAtTime(curGain, now);
        sessionGain.gain.linearRampToValueAtTime(g, now + 0.04);
        curGain = g;
      } catch {
        /* ignore */
      }
    };

    return { stop, setVolume, durationMs };
  };

  // Running → schedule immediately. Suspended (autoplay policy, or after a quiet
  // session) → RESUME first, then schedule, so the cue is never silently dropped —
  // this is what made the sound not fire when manually ending a session.
  if (c.state === 'running') return schedule();
  let live: EndSoundHandle | null = null;
  void c.resume().then(() => { live = schedule(); }).catch(() => {});
  return {
    stop: () => live?.stop(),
    setVolume: (v: number) => live?.setVolume(v),
    durationMs: 9000,
  };
}
