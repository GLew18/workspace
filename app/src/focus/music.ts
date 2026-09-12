// Cobalt: focus music engine.
//
// Plays plain audio files (e.g. /music/lofi.mp3) with an HTML5 <audio> element.
// Built-in tracks live in app/public/music/; users can also paste a direct audio
// URL. The ⏭/⏮ arrows step through the playlist; a finished track auto-advances
// to the next, and a lone track loops seamlessly.
//
// LOUDNESS: an <audio> element caps at volume 1.0 (100%). To go louder, playback is
// LAZILY routed through a Web Audio gain (+ limiter) on the shared AudioContext —
// but only once that context is RUNNING (i.e. after a user gesture). Before that a
// cold page load plays the element directly, which keeps it autoplay-capable.

import { audioCtx } from './timer';
import { isDemoSilent } from '../util/silence';

export interface Track {
  key: string;
  label: string;
  emoji: string;
  src: string; // URL or path to an audio file, e.g. "/music/lofi.mp3"
  volume: number; // 0–100
  gain?: number; // per-track loudness-normalization multiplier (linear); default 1
  custom?: boolean;
}

/** Built-in tracks are now the curated 99-track library in src/focus/library.ts
 *  (5 genre playlists), mapped into this Track shape and wired up in focus/view.ts.
 *  Left as an empty array so any older reference degrades gracefully; users can
 *  still add their own custom tracks on top. */
export const BUILTIN_TRACKS: Track[] = [];

/** How long a track takes to swell to full volume when it starts (Gabe, 8/15).
 *  Applied in the ENGINE, not baked into the 151 MP3s: the files stay lossless and
 *  untouched, custom tracks get the same treatment for free, and the length is one
 *  constant away from changing. */
const FADE_IN_MS = 2500;
/** Un-muting after ⏸. Long enough to kill the click, short enough to feel instant. */
const RESUME_FADE_MS = 300;
/** DE-ZIPPERING. Every gain change is a short linear RAMP rather than an instant jump.
 *
 *  Writing `gain.value` sets the level for a whole render quantum, so the fade's 40 ms
 *  tick was moving the amplitude as a staircase, and a staircase on amplitude is a
 *  discontinuity in the waveform at every step. Those discontinuities are broadband:
 *  measured on a pure tone (statictest.html), the noise floor rose from -85 dB at a
 *  steady volume to -72.5 dB during a fade and -56.6 dB while dragging the slider,
 *  peaking at -30.9. That is the residual static Gabe could still hear, and he pinned
 *  it to volume changes before the measurement did.
 *
 *  40 ms matches the fade tick, so consecutive ramps meet end to end and the level
 *  becomes piecewise-linear with no steps at all. It is short enough that a slider
 *  still feels immediate. NOTE: the music's own dynamics never caused this. Only our
 *  writes to the gain node did. */
const DEZIP_MS = 40;

/** Fade shape. Amplitude = t^0.7 rises FAST at the start (20% by a tenth of the way
 *  in) and eases into the target, so the fade reads as intentional rather than as
 *  the dead air Gabe was hearing. A linear or slow-start curve would recreate it. */
const FADE_CURVE = 0.7;

/** EVERY engine that currently exists, in creation order.
 *
 *  Two engines playing at once is the one fault that sounds EXACTLY like the report
 *  Gabe keeps making: two copies of a track a few milliseconds apart comb-filter into
 *  a hollow, static-y sound, and where they fall out of phase they cancel to near
 *  silence. It is also invisible from the outside — `new Audio()` elements are not in
 *  the DOM, so no amount of inspecting the page can count them. This registry is how
 *  the doctor counts them. */
const ENGINES = new Set<MusicEngine>();
/** The live engines, for src/focus/audiodoctor.ts. */
export function liveEngines(): MusicEngine[] {
  return [...ENGINES];
}

/** One hidden element that does nothing but pull a track into the HTTP cache, so
 *  pressing Start plays from memory instead of waiting on the network. The engine
 *  primes the NEXT track too, which makes auto-advance seamless. */
let primer: HTMLAudioElement | null = null;
let primed = '';
export function primeAudio(src: string | null | undefined): void {
  if (!src || src === primed) return;
  try {
    primer ??= new Audio();
    primer.crossOrigin = 'anonymous';
    primer.preload = 'auto';
    primer.src = src;
    primer.load();
    primed = src;
  } catch {
    /* prewarming is an optimization — never let it break playback */
  }
}

export class MusicEngine {
  private audio: HTMLAudioElement;
  private playlist: Track[] = [];
  private index = 0;
  private onIndexChange: ((i: number) => void) | null = null;
  private onBlocked: (() => void) | null = null; // fires when the browser refuses play() (autoplay policy)
  private onPlayState: ((playing: boolean) => void) | null = null; // mirrors the element's real play/pause
  private onTime: ((cur: number, dur: number) => void) | null = null; // playback-position updates for the seek bar
  private volume01 = 0.75; // 0..1 slider fraction — the single volume source
  private graph: { gain: GainNode; limiter: DynamicsCompressorNode } | null = null; // Web Audio chain (lazy)
  private srcNode: MediaElementAudioSourceNode | null = null; // the element's node; REPLACED by a rebuild
  /** Fixed first stage. The source node connects INTO this, and everything downstream
   *  hangs off it, so swapping the element (see reviveIfSilent) relinks one edge and
   *  leaves the rest of the graph, the doctor's tap, and the probe all still valid. */
  private entry: GainNode | null = null;
  private probe: AnalyserNode | null = null; // watches for the element going silent
  private probeBuf = new Float32Array(1024);
  private silentSince = 0; // when the probe first saw digital silence (0 = not silent)
  private lastProbeTime = -1; // element clock at the previous probe tick
  private revivals = 0; // rebuilds spent on the current track; bounded, see below
  /** The gain most recently SCHEDULED. Read this rather than the node when you need
   *  the intended level: with ramps in flight the node is somewhere along the way to
   *  it, which is correct for the ear and useless for an assertion. */
  private lastTarget = 1;
  private watchdog = 0;
  private graphPending = false; // waiting on the AudioContext to reach 'running'
  // Fade-in state. `fadeMul` is a 0..1 multiplier folded into applyVolume(), so the
  // ramp and the volume slider compose instead of fighting: the slider keeps setting
  // the TARGET while the ramp scales it.
  private fadeMul = 1;
  private fadeTimer = 0;
  private pendingFade = 0; // ms of fade owed to the next 'playing' event (0 = none)
  // UNITY, NOT 2.0 (Gabe, 8/16: "music goes silent every few seconds and there is a
  // lot of static").
  //
  // 2.0 meant the slider's top end deliberately pushed ~6 dB PAST full scale and
  // left the brickwall limiter to mop up. That is not a safety net being used as
  // one, it is the limiter acting as the volume control — and a 20:1 limiter driven
  // that hard with a 200 ms release does exactly two audible things: it PUMPS (the
  // level ducks under a loud passage and swells back over about a fifth of a second)
  // and it DISTORTS. Measured across the 151-track library: at slider 60% the
  // worst-boosted track arrived 11 dB over the threshold; at 100%, 21 dB over.
  //
  // At 1.0 the chain can never exceed full scale, so the limiter goes back to being
  // what it is for — catching the occasional stray peak — and the slider stays
  // smooth and monotonic all the way up.
  //
  // The cost is honest: the very top is quieter than it was. The right way to buy
  // that back is a louder NORMALIZATION target in library.ts (gainDb), which raises
  // the floor without ever crossing the ceiling — not by driving a limiter.
  private static readonly MAX_GAIN = 2.0; // doubled 9/11/26 (Gabe: music too quiet)
  private static readonly VOL_CURVE = 2.2; // perceptual exponent (see applyVolume) — widens the usable range
  // "Warmth" EQ for focus: a gentle high-shelf that rolls the bright/harsh treble
  // down a few dB across EVERY track, so long sessions are easier on the ears and
  // nothing sounds piercing. Done live in the Web Audio graph (see ensureGraph) —
  // NOT baked into the files — so it stays lossless and trivially tunable.
  private static readonly WARMTH_HZ = 7000; // high-shelf corner
  private static readonly WARMTH_DB = -3.5; // reduction above the corner
  // Loudness is now leveled PER TRACK: each track carries a measured gain (LUFS
  // normalization, see library.ts `gainDb`) applied here, so a compressor is no
  // longer needed to even things out — just a brickwall limiter as a safety net
  // against the occasional peak.

  constructor() {
    // A READ-ONLY WINDOW ON THE LIVE AUDIO CHAIN.
    //
    // Dropout and distortion reports are impossible to settle from the outside:
    // whoever can hear it cannot see the numbers, and whoever can see the numbers
    // cannot hear it (Gabe, 8/16). This closes that gap — run `__cobaltMusic()` in
    // the console WHILE the noise is happening and it says which of the two causes
    // it is:
    //
    //   reduction well below 0  → the limiter is pumping (a gain-staging problem)
    //   currentTime not advancing → the audio is starving (CPU, disk, or network)
    //   both fine                → the glitch is below the app, in the audio thread
    //                              or the output device
    //
    // Nothing writes through it, so it cannot become a control surface by accident.
    (window as unknown as Record<string, unknown>).__cobaltMusic = () => ({
      track: this.playlist[this.index]?.label ?? '(none)',
      playing: !this.audio.paused,
      currentTime: +this.audio.currentTime.toFixed(2),
      buffered: this.audio.buffered.length ? +this.audio.buffered.end(this.audio.buffered.length - 1).toFixed(1) : 0,
      readyState: this.audio.readyState, // 4 = plenty buffered, <3 = starving
      sliderVolume: Math.round(this.volume01 * 100),
      gainNode: this.graph ? +this.graph.gain.gain.value.toFixed(3) : null,
      gainTarget: +this.lastTarget.toFixed(3), // where the ramp is heading
      limiterReductionDb: +this.limiterReduction().toFixed(2), // 0 = idle, -6 = pumping hard
      fade: +this.fadeMul.toFixed(2),
      contextState: audioCtx()?.state ?? 'none',
      sampleRate: audioCtx()?.sampleRate ?? 0,
    });
    ENGINES.add(this);
    this.audio = this.makeElement();
  }

  /** Build an <audio> element and wire it up. Factored out because reviveIfSilent has
   *  to produce a second one that behaves identically to the first. */
  private makeElement(): HTMLAudioElement {
    const a = new Audio();
    // EVERY handler below is gated on this element still being the live one. A rebuild
    // (reviveIfSilent) leaves the old element behind, and tearing it down fires its own
    // events: without this gate the discarded element'''s '''pause''' would flip the UI to
    // the play glyph at the exact moment the replacement starts producing sound, and
    // its '''ended''' would skip a track that nobody had finished.
    const live = (): boolean => this.audio === a;
    // The element feeds a Web Audio graph (createMediaElementSource below). For
    // cross-origin sources (production: Firebase Storage) the graph outputs pure
    // SILENCE unless the media is fetched with CORS approval: this attribute asks for
    // it (the bucket must also send CORS headers; see FIREBASE-SETUP.md). Same-origin
    // dev requests are unaffected.
    a.crossOrigin = 'anonymous';
    a.preload = 'auto';
    // When a (non-looping) track finishes, advance to the next one.
    a.addEventListener('ended', () => { if (live()) this.next(); });
    // The element is the single source of truth for "is music audibly playing":
    // every path lands here (our buttons, a restored session's autoplay, OS media
    // keys, the PiP window's controls). Mirror its real state out so the UI can
    // never show play while sound is coming out, or pause while it isn't.
    a.addEventListener('play', () => { if (live()) this.onPlayState?.(true); });
    // 'playing', not 'play', is the event that means SOUND IS COMING OUT. Starting
    // the ramp here rather than at play() time is what makes the fade cover the
    // buffering gap instead of running out during it.
    a.addEventListener('playing', () => {
      if (!live() || !this.pendingFade) return;
      const ms = this.pendingFade;
      this.pendingFade = 0;
      this.runFade(ms);
    });
    a.addEventListener('pause', () => { if (live()) this.onPlayState?.(false); });
    // Feed playback position to whatever seek bar is currently on screen.
    a.addEventListener('timeupdate', () => { if (live()) this.onTime?.(a.currentTime, a.duration || 0); });
    return a;
  }

  setOnIndexChange(cb: (i: number) => void): void {
    this.onIndexChange = cb;
  }
  /** Subscribe to playback-position updates (current + total seconds) for the seek bar. */
  setOnTime(cb: ((cur: number, dur: number) => void) | null): void {
    this.onTime = cb;
  }
  /** Current position + track length in seconds (dur is 0 until metadata loads). */
  progress(): { cur: number; dur: number } {
    return { cur: this.audio.currentTime || 0, dur: this.audio.duration || 0 };
  }
  /** Jump to an absolute position (seconds), clamped to the track. */
  seekTo(sec: number): void {
    const dur = this.audio.duration;
    if (!isFinite(dur) || dur <= 0) return;
    this.audio.currentTime = Math.max(0, Math.min(dur - 0.05, sec));
  }
  /** Skip forward/back by `delta` seconds (e.g. +10 / −10). */
  seekBy(delta: number): void {
    this.seekTo((this.audio.currentTime || 0) + delta);
  }
  /** Silence output without changing play/pause state — used while dragging the seek
   *  bar, so rapid scrubbing doesn't play choppy, sped-up snippets. */
  mute(on: boolean): void {
    this.audio.muted = on;
  }
  /** Notified when audio.play() is REJECTED — i.e. the browser blocked autoplay
   *  (a session restored without a user gesture). Lets the view show ▶ honestly
   *  and re-try playback on the next click. */
  setOnBlocked(cb: () => void): void {
    this.onBlocked = cb;
  }
  /** Notified with the element's TRUE play state whenever it flips (see constructor). */
  setOnPlayState(cb: (playing: boolean) => void): void {
    this.onPlayState = cb;
  }
  /** Start playback, reporting an autoplay block instead of swallowing it. */
  private attemptPlay(): void {
    if (isDemoSilent()) return; // a demo drives the real app; it must not play music
    this.audio.play().then(
      () => {},
      () => this.onBlocked?.() // rejected → almost always the autoplay policy
    );
  }

  /** autoplay=false loads the track (src, graph, volume) but leaves it paused —
   *  used when restoring a PAUSED session, where sound must wait for the user. */
  setPlaylist(tracks: Track[], startIndex = 0, autoplay = true): void {
    this.playlist = tracks;
    this.index = Math.max(0, Math.min(startIndex, tracks.length - 1));
    if (tracks.length) this.loadCurrent(autoplay);
  }

  private loadCurrent(autoplay = true): void {
    const t = this.playlist[this.index];
    if (!t) return;
    this.revivals = 0; // a new track gets its own budget
    this.silentSince = 0;
    this.lastProbeTime = -1;
    this.audio.src = t.src;
    this.audio.loop = this.playlist.length === 1; // a single track loops; otherwise advance on end
    // Silent BEFORE play(), so the ramp owns the whole opening and no unfaded frame
    // slips through between src and the first 'playing'.
    if (autoplay) this.armFade(FADE_IN_MS);
    this.ensureGraph();
    this.applyVolume();
    if (autoplay) this.attemptPlay(); // autoplay may be blocked (restored session) → onBlocked fires
    this.onIndexChange?.(this.index);
    // NO NEXT-TRACK PREWARM WHILE MUSIC IS PLAYING (Gabe, 8/16: "music fades in and
    // out, silent for a few seconds every few seconds").
    //
    // This used to pull the FOLLOWING track down as soon as the current one started,
    // to make ⏭ instant. On a fat connection that is free; on anything else it is a
    // second full-size MP3 competing with the one you are listening to, and the
    // stream underruns — which sounds exactly like the symptom. Saving a moment on a
    // skip is not worth interrupting the track actually playing.
    //
    // The prewarm that matters is still there and costs nothing: focus/view.ts
    // primes the CHOSEN track while the student is on the setup screen picking a
    // length, when no audio is playing at all.
  }

  play(): void {
    // A short swell on resume rather than an instant unmute: <audio> restarting at
    // full amplitude mid-waveform is what produces the click.
    if (this.audio.paused) this.armFade(RESUME_FADE_MS);
    this.attemptPlay();
  }
  pause(): void {
    // Freeze the ramp where it is. Without this the rAF keeps climbing while the
    // element is silent, and the next resume would jump straight to full volume.
    this.cancelFade();
    this.audio.pause();
  }
  /** Set live playback volume (0–100). Persists across ⏭/⏮ track changes. Above the
   *  element's own ceiling it leans on the Web Audio gain node (up to MAX_GAIN×). */
  setVolume(v: number): void {
    this.volume01 = Math.max(0, Math.min(100, v)) / 100;
    this.ensureGraph();
    this.applyVolume();
  }

  /** Lazily route the <audio> through gain (+ a limiter) so volume can exceed the
   *  element's 100% cap. Only wires up once the shared AudioContext is RUNNING
   *  (after a gesture); before that we play the element directly, so a cold reload
   *  stays autoplay-capable and never hits the "playing-but-silent" trap. */
  private ensureGraph(): void {
    if (this.graph) return;
    const ctx = audioCtx();
    if (!ctx) return;
    if (ctx.state !== 'running') {
      // The context resumes on the next gesture; attach the graph the moment it does.
      if (!this.graphPending) {
        this.graphPending = true;
        ctx.addEventListener(
          'statechange',
          () => {
            this.graphPending = false;
            this.ensureGraph();
          },
          { once: true }
        );
      }
      return;
    }
    try {
      const src = ctx.createMediaElementSource(this.audio);
      this.srcNode = src;
      const entry = ctx.createGain(); // fixed first stage; survives an element swap
      entry.gain.value = 1;
      this.entry = entry;
      // The probe listens at the entry, which is BEFORE any volume, fade or limiting.
      // Silence here can only mean the element sent nothing.
      const probe = ctx.createAnalyser();
      probe.fftSize = 1024;
      this.probe = probe;
      entry.connect(probe);
      const gain = ctx.createGain(); // user volume × the current track's normalization gain
      // Warmth: a gentle high-shelf that softens harsh treble on every track.
      const warmth = ctx.createBiquadFilter();
      warmth.type = 'highshelf';
      warmth.frequency.value = MusicEngine.WARMTH_HZ;
      warmth.gain.value = MusicEngine.WARMTH_DB;
      // Brickwall limiter — safety net so a boosted (quiet) track's peaks never clip.
      const limiter = ctx.createDynamicsCompressor();
      limiter.threshold.value = -1;
      limiter.knee.value = 0;
      limiter.ratio.value = 20;
      limiter.attack.value = 0.002;
      limiter.release.value = 0.2;
      src.connect(entry);
      entry.connect(gain).connect(warmth).connect(limiter).connect(ctx.destination);
      this.graph = { gain, limiter };
      this.startWatchdog();
      // applyVolume folds the fade multiplier in, so a fade already in flight carries
      // straight across the switch from element.volume to the gain node.
      this.applyVolume();
    } catch {
      /* createMediaElementSource already used / unsupported → stay on element.volume */
    }
  }

  private applyVolume(): void {
    // Per-track loudness normalization: multiply user volume by the current track's
    // measured gain so every track lands at a similar loudness.
    const trackGain = this.playlist[this.index]?.gain ?? 1;
    // Perceptual volume curve. Hearing is roughly logarithmic, so a LINEAR slider
    // feels like almost all the change happens near the bottom. Raising the slider
    // fraction to an exponent (>1) widens the usable range: values near 0 get much
    // quieter and the top reaches a louder ceiling — while the curve stays smooth
    // and strictly increasing, so the progression still feels natural.
    // × the fade multiplier, so the slider sets the TARGET and the fade scales it.
    // One number, both output paths, and the two compose instead of overwriting each
    // other: moving the slider mid-fade neither cancels nor jumps the swell.
    const shaped = Math.pow(this.volume01, MusicEngine.VOL_CURVE) * this.fadeMul;
    const ctx = audioCtx();
    if (this.graph && ctx) {
      // NO CAP HERE. The track's gain arrives already peak-safe: focus/view.ts
      // libraryToTrack limits each boost to the headroom that track actually has
      // (library.ts peakDb). A multiplier above 1.0 is therefore FINE and expected —
      // a track peaking at -16 dBFS multiplied by 4.9 still lands under full scale.
      //
      // Capping it here was the bug: it treated the multiplier as if it were the
      // level, and cost the boosted tracks a median 6.4 dB for no reason.
      const target = shaped * MusicEngine.MAX_GAIN * trackGain;
      this.lastTarget = target;
      const g = this.graph.gain.gain;
      const now = ctx.currentTime;
      try {
        // cancelAndHold leaves the level exactly where the ramp had got to, so a change
        // arriving mid-ramp continues from there instead of snapping back to a stale
        // scheduled value. Without a hold of some kind, overlapping ramps step, which
        // is the very thing this is here to stop.
        const p = g as AudioParam & { cancelAndHoldAtTime?: (t: number) => void };
        if (typeof p.cancelAndHoldAtTime === 'function') p.cancelAndHoldAtTime(now);
        else {
          g.cancelScheduledValues(now);
          g.setValueAtTime(g.value, now);
        }
        g.linearRampToValueAtTime(target, now + DEZIP_MS / 1000);
      } catch {
        g.value = target; // automation unavailable: a step is still better than silence
      }
      this.audio.volume = 1; // element wide open; the gain node sets actual loudness
    } else {
      // Pre-graph fallback (before a gesture unlocks the AudioContext): the element
      // caps at 1.0, so a boost can't exceed unity here — good enough until the graph.
      this.audio.volume = Math.max(0, Math.min(1, shaped * trackGain));
    }
  }
  /** Arm a fade: go silent NOW, ramp once the element actually starts producing
   *  sound. Safe to call repeatedly — the newest arm wins. */
  private armFade(ms: number): void {
    this.cancelFade();
    this.pendingFade = ms;
    this.fadeMul = 0;
    this.applyVolume();
  }

  /** Stop a ramp in flight and leave the level exactly where it stands. */
  private cancelFade(): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    this.fadeTimer = 0;
    this.pendingFade = 0;
  }

  /** The ramp: raise the multiplier on a timer and let applyVolume() push it to
   *  whichever output is live (gain node, or element.volume before the AudioContext
   *  unlocks).
   *
   *  A TIMER, not requestAnimationFrame. rAF stops dead in a hidden tab, and a focus
   *  session spends most of its life in one — that's the entire point of the mini
   *  player — so an rAF ramp would leave a track that auto-advanced in the background
   *  stuck at zero, silent until you looked at the tab again. Background timers get
   *  clamped to about a second, which makes the fade steppy there but never silent,
   *  and in the foreground case this is actually about (the track you just started)
   *  it runs at the full 40ms resolution. */
  private runFade(ms: number): void {
    if (this.fadeTimer) clearInterval(this.fadeTimer);
    const from = this.fadeMul;
    const t0 = performance.now();
    this.fadeTimer = window.setInterval(() => {
      const t = Math.min(1, (performance.now() - t0) / ms);
      this.fadeMul = t >= 1 ? 1 : from + (1 - from) * Math.pow(t, FADE_CURVE);
      if (t >= 1) {
        clearInterval(this.fadeTimer);
        this.fadeTimer = 0;
      }
      this.applyVolume();
    }, 40);
  }

  next(): void {
    if (!this.playlist.length) return;
    this.index = (this.index + 1) % this.playlist.length;
    this.loadCurrent();
  }
  /** Jump straight to a playlist index (the music menu's track list). */
  jumpTo(i: number): void {
    if (!this.playlist.length) return;
    this.index = ((i % this.playlist.length) + this.playlist.length) % this.playlist.length;
    this.loadCurrent();
  }
  prev(): void {
    if (!this.playlist.length) return;
    this.index = (this.index - 1 + this.playlist.length) % this.playlist.length;
    this.loadCurrent();
  }
  currentIndex(): number {
    return this.index;
  }
  currentTrack(): Track | null {
    return this.playlist[this.index] ?? null;
  }

  /** THE SILENT-ELEMENT WATCHDOG (Gabe, 8/19/26).
   *
   *  The fault, measured rather than guessed: after a track change the element goes on
   *  playing (its clock advances, readyState is 4, over two minutes buffered) while
   *  the Web Audio graph receives digital silence. It righted itself after 1.0s once
   *  and 7.4s the next time. A fade re-arm happens at the same moment and looks like
   *  the culprit, but it is applied at the gain node, downstream of where the silence
   *  was measured, so it cannot be.
   *
   *  It does not reproduce here, which is exactly why this is a watchdog and not a
   *  targeted fix: the only remedy that can be trusted for an intermittent fault on
   *  someone else's machine is one that detects the fault and repairs it. When healthy
   *  it costs one analyser read every 250 ms and changes nothing.
   *
   *  The repair swaps in a fresh element and relinks it to the fixed entry node,
   *  preserving src, position and loop, because createMediaElementSource can only ever
   *  be called once per element: the broken pairing cannot be un-broken, only
   *  replaced. */
  private startWatchdog(): void {
    if (this.watchdog) return;
    this.watchdog = window.setInterval(() => this.reviveIfSilent(), 250);
  }

  private reviveIfSilent(): void {
    const ctx = audioCtx();
    if (!this.probe || !this.entry || !ctx || ctx.state !== 'running') return;
    const a = this.audio;
    // Only judge an element that claims to be playing usable audio. A paused, seeking,
    // starving or not-yet-started element is allowed to be silent.
    if (a.paused || a.seeking || a.muted || a.readyState < 3 || a.currentTime < 0.5) {
      this.silentSince = 0;
      this.lastProbeTime = a.currentTime;
      return;
    }
    // The clock must be MOVING. If it is not, the stream is stalling, which is a
    // different fault with a different fix, and rebuilding would not help it.
    const advancing = a.currentTime > this.lastProbeTime + 0.05;
    this.lastProbeTime = a.currentTime;
    if (this.probeBuf.length !== this.probe.fftSize) this.probeBuf = new Float32Array(this.probe.fftSize);
    this.probe.getFloatTimeDomainData(this.probeBuf);
    let peak = 0;
    for (let i = 0; i < this.probeBuf.length; i++) {
      const v = this.probeBuf[i] < 0 ? -this.probeBuf[i] : this.probeBuf[i];
      if (v > peak) peak = v;
    }
    // -80 dBFS. Real music, including the quietest piano in the library, does not sit
    // this low for half a second; a disconnected element sits at exactly zero.
    if (!advancing || peak > 1e-4) {
      this.silentSince = 0;
      return;
    }
    const now = performance.now();
    if (!this.silentSince) {
      this.silentSince = now;
      return;
    }
    // Half a second of "playing" with nothing coming out. Long enough that no ordinary
    // gap in the music trips it, short enough that the 7.4s Gabe sat through becomes
    // about half a second.
    if (now - this.silentSince < 500) return;
    this.silentSince = 0;
    // BOUNDED. If rebuilding does not help, it must not turn into a loop that restarts
    // the track forever; after three tries on one track, leave it alone.
    if (this.revivals >= 3) return;
    this.revivals++;
    this.rebuildElement();
  }

  /** Swap in a fresh element, keeping position and play state. */
  private rebuildElement(): void {
    const ctx = audioCtx();
    if (!ctx || !this.entry) return;
    const old = this.audio;
    const at = old.currentTime;
    const wasPlaying = !old.paused;
    const next = this.makeElement();
    next.src = old.currentSrc || old.src;
    next.loop = old.loop;
    next.muted = old.muted;
    let node: MediaElementAudioSourceNode;
    try {
      node = ctx.createMediaElementSource(next);
    } catch {
      return; // could not build a replacement; leave the original alone
    }
    try {
      this.srcNode?.disconnect();
    } catch {
      /* already detached */
    }
    node.connect(this.entry);
    this.srcNode = node;
    this.audio = next;
    const resume = (): void => {
      try {
        next.currentTime = at;
      } catch {
        /* not seekable yet; it will start from 0 */
      }
      // A short swell rather than snapping back to full level: the replacement starts
      // mid-waveform, which is the same click the resume fade exists to prevent.
      if (wasPlaying) {
        this.armFade(RESUME_FADE_MS);
        this.attemptPlay();
      }
    };
    if (next.readyState >= 1) resume();
    else next.addEventListener('loadedmetadata', resume, { once: true });
    this.applyVolume();
    old.pause();
    old.removeAttribute('src');
    old.load();
  }

  /** Everything src/focus/audiodoctor.ts needs to tap this engine. Deliberately not
   *  part of the public surface: it hands out live nodes, so it is a diagnostic
   *  seam, not an API. Returns nulls before the AudioContext unlocks. */
  _diag(): { audio: HTMLAudioElement; src: AudioNode | null; gain: GainNode | null; target: number; limiter: DynamicsCompressorNode | null; fade: number; track: string } {
    return {
      audio: this.audio,
      // The ENTRY node, not the source node: a rebuild replaces the source, and a tap
      // left on the discarded one would read silence forever and misreport it.
      src: this.entry,
      gain: this.graph?.gain ?? null,
      target: this.lastTarget,
      limiter: this.graph?.limiter ?? null,
      fade: this.fadeMul,
      track: this.playlist[this.index]?.label ?? '(none)',
    };
  }

  /** Live gain-reduction in dB (0 = the limiter is idle, which is now the norm).
   *  Exposed so a dropout complaint can be measured instead of guessed at. */
  limiterReduction(): number {
    return this.graph ? this.graph.limiter.reduction : 0;
  }

  destroy(): void {
    ENGINES.delete(this);
    if (this.watchdog) clearInterval(this.watchdog);
    this.watchdog = 0;
    // The fade runs on an interval, and a discarded engine's interval would otherwise
    // keep ticking for the rest of the page's life (a new engine is built per session).
    this.cancelFade();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load(); // release the file
  }
}
