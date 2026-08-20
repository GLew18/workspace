// Cobalt: the audio doctor.
//
// WHY THIS EXISTS. Gabe hears the music "go silent for a few seconds every few
// seconds, with a lot of static". I cannot hear it, and every reading I can take from
// the outside (`__cobaltMusic()`) is a SINGLE INSTANT, which is useless for a fault
// that comes and goes. Twice now that gap has been filled with a plausible theory
// instead of a measurement, and twice the noise came back.
//
// So this records, continuously, at every stage of the chain, and then says which
// stage the silence came from. The chain is:
//
//     <audio> element  --->  gain  --->  warmth  --->  limiter  --->  speakers
//          |                                              |
//        PRE tap                                       POST tap
//
// A dropout is localized by which taps see it:
//
//   PRE quiet  + POST quiet   -> the SOURCE went quiet: starving stream, or the file.
//   PRE normal + POST quiet   -> the GRAPH did it: a re-armed fade, a gain write, or
//                                the limiter clamping down.
//   both normal, ctx clock slipping -> BELOW THE APP: the audio thread or the output
//                                device glitched. Nothing in this codebase can cause
//                                it and nothing in this codebase can fix it.
//
// Plus the one fault no snapshot could ever reveal: TWO ENGINES PLAYING AT ONCE.
// Two copies of a track milliseconds apart comb-filter into exactly the hollow,
// static-y sound being described, and cancel to near-silence where they drift out of
// phase. `new Audio()` elements are not in the DOM, so they cannot be counted by
// inspecting the page, only by asking the engines themselves.

import { audioCtx } from './timer';
import { liveEngines } from './music';

/** 100 ms. Fine enough to catch a fifth-of-a-second duck, coarse enough that the
 *  recorder itself never becomes the thing that stutters the audio. */
const SAMPLE_MS = 100;
/** A dropout must last this long to count, so one quiet beat in the music is not
 *  mistaken for a fault. */
const MIN_DROPOUT_MS = 250;
/** How far under the track's own normal level counts as "silent". 18 dB is about an
 *  eighth of the amplitude: unmistakably a dropout, not a quiet passage. */
const DROP_DB = 18;

interface Sample {
  t: number; // ms since recording started (wall clock)
  ctxT: number; // AudioContext clock, for the drift check below
  playing: number; // how many engines were actually producing sound
  cur: number; // element currentTime
  ready: number; // element readyState (4 = plenty buffered)
  buf: number; // buffered-to, seconds
  preDb: number; // level entering the graph
  postDb: number; // level leaving the limiter
  postPeak: number; // absolute peak out of the limiter; over 1.0 WILL clip at the device
  gain: number; // gain node value
  red: number; // limiter gain reduction, dB
  fade: number; // fade multiplier
  state: string; // AudioContext state
}

interface Ev {
  t: number;
  what: string;
}

const dbOf = (rms: number): number => (rms > 1e-7 ? 20 * Math.log10(rms) : -140);

class Doctor {
  private samples: Sample[] = [];
  private events: Ev[] = [];
  private timer = 0;
  private t0 = 0;
  private ctx0 = 0;
  private pre: AnalyserNode | null = null;
  private post: AnalyserNode | null = null;
  private buf = new Float32Array(2048);
  private detach: (() => void)[] = [];
  private lastCur = -1;
  running = false;

  start(): string {
    if (this.running) return 'Already recording. Let it run while the noise happens, then call __audioDoctor.report()';
    const ctx = audioCtx();
    const engines = liveEngines();
    if (!engines.length) return 'No music engine exists yet. Start a focus session with music playing, then run this again.';
    if (!ctx || ctx.state !== 'running') return 'The AudioContext is "' + (ctx ? ctx.state : 'missing') + '". Press play so it unlocks, then run this again.';

    const d = engines[0]._diag();
    if (!d.gain || !d.src || !d.limiter) return 'The engine has not built its Web Audio graph yet. Let a track play for a second, then run this again.';

    // The taps. An analyser with nothing downstream is not guaranteed to be pulled by
    // the graph, so each one runs into a MUTED gain and on to the destination: that
    // makes it part of a live path without adding a single dB to what comes out.
    const mute = ctx.createGain();
    mute.gain.value = 0;
    mute.connect(ctx.destination);
    this.pre = ctx.createAnalyser();
    this.post = ctx.createAnalyser();
    this.pre.fftSize = 2048;
    this.post.fftSize = 2048;
    d.src.connect(this.pre);
    d.limiter.connect(this.post);
    this.pre.connect(mute);
    this.post.connect(mute);
    const preTap = this.pre;
    const postTap = this.post;
    this.detach.push(() => {
      try {
        d.src?.disconnect(preTap);
      } catch {
        /* already gone */
      }
      try {
        d.limiter?.disconnect(postTap);
      } catch {
        /* already gone */
      }
      try {
        mute.disconnect();
      } catch {
        /* already gone */
      }
    });

    // Element events. These are the stream's own account of what happened, and they
    // timestamp a stall far more precisely than a 100 ms sampler can.
    const names = ['waiting', 'stalled', 'suspend', 'abort', 'emptied', 'error', 'ended', 'pause', 'play', 'playing', 'seeking', 'ratechange'];
    engines.forEach((e, i) => {
      const el = e._diag().audio;
      for (const name of names) {
        const tag = 'element' + (engines.length > 1 ? '#' + i : '') + ': ' + name;
        const h = (): void => this.note(tag);
        el.addEventListener(name, h);
        this.detach.push(() => el.removeEventListener(name, h));
      }
    });
    const onState = (): void => this.note('AudioContext is now ' + ctx.state);
    ctx.addEventListener('statechange', onState);
    this.detach.push(() => ctx.removeEventListener('statechange', onState));
    const onVis = (): void => this.note('tab ' + document.visibilityState);
    document.addEventListener('visibilitychange', onVis);
    this.detach.push(() => document.removeEventListener('visibilitychange', onVis));

    this.samples = [];
    this.events = [];
    this.lastCur = -1;
    this.t0 = performance.now();
    this.ctx0 = ctx.currentTime;
    this.running = true;
    this.timer = window.setInterval(() => this.tick(), SAMPLE_MS);
    this.note('recording started');
    return 'Recording. Leave this tab alone and let the music play. The moment you have heard the problem a few times, run:  __audioDoctor.report()';
  }

  private note(what: string): void {
    this.events.push({ t: Math.round(performance.now() - this.t0), what });
  }

  private level(a: AnalyserNode): { db: number; peak: number } {
    if (this.buf.length !== a.fftSize) this.buf = new Float32Array(a.fftSize);
    a.getFloatTimeDomainData(this.buf);
    let sum = 0;
    let peak = 0;
    for (let i = 0; i < this.buf.length; i++) {
      const v = this.buf[i];
      sum += v * v;
      const av = v < 0 ? -v : v;
      if (av > peak) peak = av;
    }
    return { db: dbOf(Math.sqrt(sum / this.buf.length)), peak };
  }

  private tick(): void {
    const ctx = audioCtx();
    const engines = liveEngines();
    if (!ctx || !engines.length || !this.pre || !this.post) return;
    const d = engines[0]._diag();
    const pre = this.level(this.pre);
    const post = this.level(this.post);
    const playing = engines.filter((e) => !e._diag().audio.paused).length;
    if (playing > 1) this.note(playing + ' ENGINES PLAYING AT ONCE');
    const cur = d.audio.currentTime;
    if (this.lastCur >= 0 && cur === this.lastCur && !d.audio.paused) this.note('element clock frozen');
    this.lastCur = cur;
    this.samples.push({
      t: Math.round(performance.now() - this.t0),
      ctxT: +(ctx.currentTime - this.ctx0).toFixed(3),
      playing,
      cur: +cur.toFixed(2),
      ready: d.audio.readyState,
      buf: d.audio.buffered.length ? +d.audio.buffered.end(d.audio.buffered.length - 1).toFixed(1) : 0,
      preDb: +pre.db.toFixed(1),
      postDb: +post.db.toFixed(1),
      postPeak: +post.peak.toFixed(3),
      gain: d.gain ? +d.gain.gain.value.toFixed(3) : 0,
      red: d.limiter ? +d.limiter.reduction.toFixed(2) : 0,
      fade: +d.fade.toFixed(2),
      state: ctx.state,
    });
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = 0;
    this.running = false;
    for (const f of this.detach) f();
    this.detach = [];
    this.pre = null;
    this.post = null;
  }

  /** The verdict. Every line it prints is derived from the recording, and where it
   *  cannot tell, it says so rather than picking the likeliest story. */
  report(): string {
    const S = this.samples;
    const L: string[] = [];
    const secs = S.length ? ((S[S.length - 1].t - S[0].t) / 1000).toFixed(1) : '0';
    L.push('AUDIO DOCTOR: ' + S.length + ' samples over ' + secs + 's');
    L.push('');

    // --- 1. two engines at once. Checked BEFORE the too-short bail, because it is
    //        decisive on its own: if two are playing, that is the answer, and refusing
    //        to say so because the recording was brief would be its own bug. It also
    //        makes every level reading below meaningless, so it comes first. ---
    const doubled = S.filter((s) => s.playing > 1).length;
    if (doubled) {
      L.push('** TWO OR MORE ENGINES PLAYING AT ONCE (' + doubled + ' of ' + S.length + ' samples).');
      L.push('   This is the cause. Two copies of the same track comb-filter into a hollow,');
      L.push('   static-y sound and cancel to silence where they drift apart.');
      L.push('');
      L.push('VERDICT:');
      L.push('  Two engines are playing at the same time. Fix that first; nothing else matters until it is.');
      const early = L.join('\n');
      // eslint-disable-next-line no-console
      console.log(early);
      (window as unknown as Record<string, unknown>).__audioDoctorRaw = { samples: S, events: this.events };
      return early;
    }

    if (S.length < 20) return 'Only ' + S.length + ' samples. Let it record for at least a few seconds of music.';
    const live = S.filter((s) => s.playing > 0);
    if (!live.length) return 'Nothing was playing for the whole recording, so there is nothing to diagnose.';

    // --- 2. the reference level: the upper quartile, so quiet passages in the music
    //        do not drag the baseline down and hide a real dropout. ---
    const sorted = live.map((s) => s.postDb).sort((a, b) => a - b);
    const ref = sorted[Math.floor(sorted.length * 0.75)];
    L.push('Normal output level: ' + ref.toFixed(1) + ' dB   ·   a dropout counts below ' + (ref - DROP_DB).toFixed(1) + ' dB');

    // --- 3. find the dropouts ---
    const need = Math.ceil(MIN_DROPOUT_MS / SAMPLE_MS);
    const runs: Sample[][] = [];
    let run: Sample[] = [];
    for (const s of live) {
      if (s.postDb < ref - DROP_DB) run.push(s);
      else {
        if (run.length >= need) runs.push(run);
        run = [];
      }
    }
    if (run.length >= need) runs.push(run);

    // --- 3b. RE-ARMED FADES, detected from the multiplier rather than the level.
    //
    //  This is the fault most likely to produce what is being described (silence,
    //  then a swell, over and over) and the level test CANNOT SEE IT. The ramp is
    //  t^0.7, which clears -18 dB in the first 5% of its length: a full 2.5s fade
    //  spends only about 130 ms deeply quiet, well under the 250 ms a dropout has to
    //  last. So it is caught directly instead: the multiplier collapsing toward zero
    //  between two consecutive samples, while the element never paused, means
    //  something called armFade() on music that was already playing.
    const allRearms: Sample[] = [];
    for (let i = 1; i < live.length; i++) {
      if (live[i - 1].fade > 0.85 && live[i].fade < 0.4 && live[i].playing > 0) allRearms.push(live[i]);
    }
    // A TRACK CHANGE IS NOT A FAULT. Changing song re-arms the fade by design, and the
    // element says so: assigning a new src fires 'abort' and 'emptied'. Without this
    // split the report calls Gabe pressing a different song a defect, which is both
    // wrong and the kind of noise that makes a diagnostic worth ignoring.
    const srcChanges = this.events.filter((e) => /emptied|abort/.test(e.what)).map((e) => e.t);
    const nearSrcChange = (s: Sample): boolean => srcChanges.some((t) => Math.abs(t - s.t) < 800);
    const expected = allRearms.filter(nearSrcChange);
    const rearms = allRearms.filter((s) => !nearSrcChange(s));

    // Dips too brief to count as dropouts, reported so they are not simply invisible.
    const dips = live.filter((s) => s.postDb < ref - DROP_DB).length;

    // --- 4. clipping: the static detector. The limiter's output is float, so it can
    //        exceed 1.0, and everything above 1.0 is torn off by the sound card. ---
    const clipped = live.filter((s) => s.postPeak > 0.999).length;
    const worstPeak = Math.max(...live.map((s) => s.postPeak));
    const pumping = live.filter((s) => s.red < -3).length;

    L.push('Peak out of the limiter: ' + worstPeak.toFixed(3) + '   ·   samples at or over full scale: ' + clipped);
    L.push('Limiter working hard (over 3 dB of reduction) in ' + pumping + ' of ' + live.length + ' samples');
    L.push('Dropouts found: ' + runs.length + '   ·   brief dips (under ' + MIN_DROPOUT_MS + 'ms): ' + Math.max(0, dips - runs.reduce((n, r) => n + r.length, 0)));
    L.push('Fades re-armed: ' + allRearms.length + ' (' + expected.length + ' from a track change, which is normal · ' + rearms.length + ' unexplained)');
    L.push('');
    if (rearms.length) {
      L.push('** THE FADE WAS RE-ARMED ' + rearms.length + ' TIME(S) ON MUSIC THAT WAS ALREADY PLAYING,');
      L.push('   with no track change to account for it, at ' + rearms.map((s) => (s.t / 1000).toFixed(1) + 's') + '.');
      L.push('   Each one drops the volume to zero and swells it back.');
      L.push('');
    }

    // --- 5. the audio thread. If the CONTEXT clock falls behind the wall clock, the
    //        audio thread itself stalled, which no application code can cause. ---
    const wall = (S[S.length - 1].t - S[0].t) / 1000;
    const ctxAdv = S[S.length - 1].ctxT - S[0].ctxT;
    const drift = wall - ctxAdv;
    L.push('Audio clock: advanced ' + ctxAdv.toFixed(2) + 's while ' + wall.toFixed(2) + 's passed (slipped ' + drift.toFixed(2) + 's)');
    if (drift > 0.25) L.push('   ** The audio thread is losing time. That is below the app: driver, device, or CPU.');
    L.push('');

    // --- 6. classify each dropout ---
    if (runs.length) {
      L.push('EACH DROPOUT:');
      for (const r of runs.slice(0, 12)) {
        const at = (r[0].t / 1000).toFixed(1);
        const ms = r.length * SAMPLE_MS;
        const before = live[Math.max(0, live.indexOf(r[0]) - 3)];
        const preFell = r[0].preDb < before.preDb - DROP_DB / 2;
        const advanced = r[r.length - 1].cur - r[0].cur;
        const froze = advanced < (ms / 1000) * 0.5;
        const faded = Math.min(...r.map((s) => s.fade)) < 0.9;
        const clampedHard = Math.min(...r.map((s) => s.red)) < -6;
        const gainFell = Math.min(...r.map((s) => s.gain)) < before.gain * 0.5;
        // DEAD SOURCE: the pre tap sitting at digital silence. This has to be tested
        // BEFORE the fade, and the reason is structural rather than a matter of
        // preference: the fade multiplier is applied at the GAIN NODE, which is
        // downstream of the pre tap, so a fade cannot move `preDb` by even a dB. If
        // pre is at the floor, the element handed the graph nothing, and any fade
        // happening at the same time is a passenger.
        //
        // Getting this order wrong is not hypothetical. On 8/19 it reported a fade as
        // the cause of a 7.4s dropout whose pre tap read -140 dB, which sent the whole
        // diagnosis at the one part of the chain that provably was not responsible.
        const deadSource = Math.max(...r.map((s) => s.preDb)) < -90;
        let cause: string;
        if (froze) cause = 'THE STREAM STALLED. The element clock stopped; the audio starved (network, disk, or CPU).';
        else if (deadSource) cause = 'THE ELEMENT PLAYED BUT SENT NO AUDIO. Its clock kept running while the graph received digital silence: the element lost its connection to the Web Audio graph (this happens after a src change).';
        else if (faded && srcChanges.some((t) => Math.abs(t - r[0].t) < 800))
          cause = 'A TRACK CHANGE. The new track fades in from silence, which is by design; the audible part is about a tenth of a second.';
        else if (faded) cause = 'A FADE WAS RE-ARMED mid-playback, with no track change to explain it. Something in the app restarted the ramp.';
        else if (clampedHard) cause = 'THE LIMITER CLAMPED DOWN. Gain staging: the level is being driven too hard.';
        else if (gainFell) cause = 'THE GAIN NODE WAS WRITTEN DOWN. A volume or track change did this.';
        else if (preFell) cause = 'THE SOURCE ITSELF WENT QUIET. The file is quiet here, or the decoder produced nothing.';
        else cause = 'UNEXPLAINED. The source stayed loud and nothing in the graph moved. Suspect the device.';
        L.push('  ' + at + 's  for ' + ms + 'ms   ' + cause);
        L.push('         pre ' + r[0].preDb + ' dB · post ' + r[0].postDb + ' dB · gain ' + r[0].gain + ' · limiter ' + r[0].red + ' dB · fade ' + r[0].fade + ' · ready ' + r[0].ready + ' · buffered ' + r[0].buf + 's · clock advanced ' + advanced.toFixed(1) + 's of ' + (ms / 1000).toFixed(1) + 's');
      }
      if (runs.length > 12) L.push('  ... and ' + (runs.length - 12) + ' more');
      L.push('');
    }

    // --- 7. the plain-English answer ---
    const deadRuns = runs.filter((r) => Math.max(...r.map((x) => x.preDb)) < -90);
    L.push('VERDICT:');
    if (doubled) {
      L.push('  Two engines are playing at the same time. Fix that first; nothing else matters until it is.');
    } else if (deadRuns.length) {
      // Same priority as the itemized list above, so the verdict can never name the
      // fade while the rows underneath it say the element sent no audio at all.
      L.push('  On ' + deadRuns.length + ' occasion(s) the element kept playing but handed the graph');
      L.push('  digital silence. That is the dropout. Any fade re-armed at the same moment is a');
      L.push('  passenger: the fade acts after this measuring point and cannot cause it.');
      if (rearms.length) L.push('  (' + rearms.length + ' fade re-arm(s) also seen, which is normal on a track change.)');
    } else if (rearms.length) {
      L.push('  Something is re-arming the fade ' + rearms.length + ' time(s) on music that was already');
      L.push('  playing. That is the dropout, and it is in the app, not the device.');
      if (clipped) L.push('  Output is also clipping (peak ' + worstPeak.toFixed(3) + '), which is the static.');
    } else if (!runs.length && !clipped && drift <= 0.25) {
      L.push('  Nothing was wrong during this recording: the level never dropped, nothing clipped,');
      L.push('  and the audio clock kept perfect time. Either the fault did not happen while this');
      L.push('  was running, or what you are hearing is not coming from Cobalt. Record again and');
      L.push('  stop it the instant after you hear it.');
    } else {
      if (clipped) L.push('  Output is clipping (peak ' + worstPeak.toFixed(3) + ', ' + clipped + ' samples over full scale). THAT is the static.');
      if (drift > 0.25) L.push('  The audio thread is losing time, so the glitch is below the app, in the driver or device.');
      if (runs.length) L.push('  ' + runs.length + ' real dropouts, itemized above.');
    }
    L.push('');
    L.push('EVENTS:');
    L.push(this.events.length ? this.events.map((e) => '  ' + (e.t / 1000).toFixed(1) + 's  ' + e.what).join('\n') : '  (none)');

    const text = L.join('\n');
    // eslint-disable-next-line no-console
    console.log(text);
    (window as unknown as Record<string, unknown>).__audioDoctorRaw = { samples: S, events: this.events };
    return text;
  }
}

const doctor = new Doctor();

/** Wire `__audioDoctor` onto the window. Called once at boot. */
export function installAudioDoctor(): void {
  (window as unknown as Record<string, unknown>).__audioDoctor = {
    start: () => doctor.start(),
    stop: () => {
      doctor.stop();
      return 'stopped';
    },
    report: () => doctor.report(),
  };
}
