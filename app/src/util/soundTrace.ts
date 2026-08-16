// Dev-only sound tracer.
//
// Gabe keeps hearing a short "check"-like sound on reloads even with the check-off
// sound switched off (8/15). The three sounds the app can actually make are all
// accounted for in code — the check-off chime is gated and only reachable from a
// click, and the focus end cue is one-shot — so the source is something none of us
// has guessed yet. Rather than keep guessing, this makes the page name it.
//
// OFF by default, and stripped from production entirely (the import.meta.env.DEV
// guard at the call site means the bundler drops it). Turn on with:
//
//   localStorage.setItem('cobalt:tracesound', '1')   then reload
//
// Every sound-producing call then logs a labeled stack trace, so the next time the
// sound happens the console says exactly what made it. Turn off by removing the key.

/** Patch the four ways this app can produce sound and log a stack for each. */
export function installSoundTrace(): void {
  const w = window as any;
  if (w.__soundTraceOn) return;
  w.__soundTraceOn = true;

  const hits: { what: string; at: number; stack: string }[] = [];
  w.__soundHits = hits;
  const note = (what: string): void => {
    const stack = new Error().stack || '';
    hits.push({ what, at: Math.round(performance.now()), stack });
    // eslint-disable-next-line no-console
    console.warn(`🔊 ${what} @${Math.round(performance.now())}ms`, '\n' + stack);
  };

  // 1. Web Audio oscillators — the check-off chime and every synthesized end sound.
  const AC = w.AudioContext || w.webkitAudioContext;
  if (AC) {
    const realOsc = AC.prototype.createOscillator;
    AC.prototype.createOscillator = function (this: AudioContext, ...a: unknown[]) {
      const osc = realOsc.apply(this, a as []);
      const realStart = osc.start;
      osc.start = function (...s: unknown[]) {
        note('oscillator.start');
        return realStart.apply(this, s as []);
      };
      return osc;
    };
    const realBuf = AC.prototype.createBufferSource;
    AC.prototype.createBufferSource = function (this: AudioContext, ...a: unknown[]) {
      const s = realBuf.apply(this, a as []);
      const realStart = s.start;
      s.start = function (...x: unknown[]) {
        note('bufferSource.start');
        return realStart.apply(this, x as []);
      };
      return s;
    };
  }

  // 2. <audio> playback — music, and anything else that plays a file.
  const realPlay = HTMLMediaElement.prototype.play;
  HTMLMediaElement.prototype.play = function (this: HTMLMediaElement) {
    note(`media.play(${(this.currentSrc || this.src || '').slice(-60)})`);
    return realPlay.call(this);
  };

  // 3. System notifications. THE PRIME SUSPECT: Windows plays its own two-tone
  //    alert for every one of these, and no in-app sound setting can silence it —
  //    it is the OS, not us. If this is what fires, the fix is `silent: true` on
  //    the Notification, or Windows' own per-app notification-sound setting.
  const RealNotification = w.Notification;
  if (RealNotification) {
    const Patched = function (this: unknown, title: string, opts?: NotificationOptions) {
      note(`new Notification("${title}")`);
      return new RealNotification(title, opts);
    } as unknown as typeof Notification;
    Patched.prototype = RealNotification.prototype;
    Object.defineProperty(Patched, 'permission', { get: () => RealNotification.permission });
    Patched.requestPermission = RealNotification.requestPermission.bind(RealNotification);
    w.Notification = Patched;
  }

  // eslint-disable-next-line no-console
  console.warn('🔊 sound trace ON. Every sound logs a stack. window.__soundHits holds them.');
}
