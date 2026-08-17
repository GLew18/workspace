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
/** Fade shape. Amplitude = t^0.7 rises FAST at the start (20% by a tenth of the way
 *  in) and eases into the target, so the fade reads as intentional rather than as
 *  the dead air Gabe was hearing. A linear or slow-start curve would recreate it. */
const FADE_CURVE = 0.7;

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
  private volume01 = 0.5; // 0..1 slider fraction — the single volume source
  private graph: { gain: GainNode } | null = null; // Web Audio boost chain (lazy)
  private graphPending = false; // waiting on the AudioContext to reach 'running'
  // Fade-in state. `fadeMul` is a 0..1 multiplier folded into applyVolume(), so the
  // ramp and the volume slider compose instead of fighting: the slider keeps setting
  // the TARGET while the ramp scales it.
  private fadeMul = 1;
  private fadeTimer = 0;
  private pendingFade = 0; // ms of fade owed to the next 'playing' event (0 = none)
  private static readonly MAX_GAIN = 2.0; // slider 100% → 2.0× (a louder ceiling; the limiter still catches peaks)
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
    this.audio = new Audio();
    // The element feeds a Web Audio graph (createMediaElementSource below). For
    // cross-origin sources (production: Firebase Storage) the graph outputs pure
    // SILENCE unless the media is fetched with CORS approval — this attribute asks
    // for it (the bucket must also send CORS headers; see FIREBASE-SETUP.md).
    // Same-origin dev requests are unaffected.
    this.audio.crossOrigin = 'anonymous';
    this.audio.preload = 'auto';
    // When a (non-looping) track finishes, advance to the next one.
    this.audio.addEventListener('ended', () => this.next());
    // The element is the single source of truth for "is music audibly playing" —
    // every path lands here (our buttons, a restored session's autoplay, OS media
    // keys, the PiP window's controls). Mirror its real state out so the UI can
    // never show ▶ while sound is coming out, or ⏸ while it isn't.
    this.audio.addEventListener('play', () => this.onPlayState?.(true));
    // 'playing' — not 'play' — is the event that means SOUND IS COMING OUT. Starting
    // the ramp here rather than at play() time is what makes the fade cover the
    // buffering gap instead of running out during it.
    this.audio.addEventListener('playing', () => {
      if (!this.pendingFade) return;
      const ms = this.pendingFade;
      this.pendingFade = 0;
      this.runFade(ms);
    });
    this.audio.addEventListener('pause', () => this.onPlayState?.(false));
    // Feed playback position to whatever seek bar is currently on screen.
    this.audio.addEventListener('timeupdate', () => this.onTime?.(this.audio.currentTime, this.audio.duration || 0));
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
      src.connect(gain).connect(warmth).connect(limiter).connect(ctx.destination);
      this.graph = { gain };
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
    if (this.graph) {
      this.graph.gain.gain.value = shaped * MusicEngine.MAX_GAIN * trackGain;
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

  destroy(): void {
    // The fade runs on an interval, and a discarded engine's interval would otherwise
    // keep ticking for the rest of the page's life (a new engine is built per session).
    this.cancelFade();
    this.audio.pause();
    this.audio.removeAttribute('src');
    this.audio.load(); // release the file
  }
}
