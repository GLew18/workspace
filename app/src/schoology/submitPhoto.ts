// Cobalt: hand in a photo on a Schoology assignment, from the task's ⋯ menu
// (Gabe, 10/8/26: "submit a photo to Cobalt and it submits it on that same
// assignment on Schoology").
//
// Only for a student connected to Schoology directly (the real API), and only on a
// task that IS a Schoology assignment ('ical_assign_<id>'). The flow:
//   1. a popup explains what happens; "Open File Explorer" adds photos (a phone
//      offers its camera) and a box takes text, since a submission goes straight
//      to the teacher and a student can't take it back,
//   2. each photo is shrunk to a ~1 MB JPEG here, uploaded one per call, then all
//      of them are handed in together as one submission (functions: sgySubmitPhoto).

import type { Data } from '../db';
import type { Task } from '../types';
import { el, fadeRemove, showToast, textInput } from '../util/dom';
import { getSgyApiState, sgyErrorText } from './api';
import { firebaseConfig } from '../firebase';
import { confirmDialog } from '../ui/confirm';
import { makeWidthGrip, migratePopupWidth, POPUP_WIDTH_KEY } from '../util/resize';

const TASK_PREFIX = 'ical_assign_';
const MAX_PHOTOS = 5; // photos AND recordings together: one submission, five files
const MAX_AUDIO_BYTES = 7 * 1024 * 1024; // the server's cap (functions: SGY_AUDIO_MAX_BYTES)
const MAX_REC_SECONDS = 10 * 60; // 64 kbps × 10 min ≈ 4.8 MB, safely under the cap
const MAX_SIDE = 2200; // px, the longer edge after shrinking; still sharp for handwriting
const QUALITY = 0.85;

let connected = false;

/** Read once at boot (main.ts), like the teacher list: the menu is built
 *  synchronously, so whether to offer the entry has to be known already. */
export async function loadPhotoSubmit(data: Data): Promise<void> {
  const s = await getSgyApiState(data);
  connected = !!s?.connected && !s.expired;
}

/** The Schoology assignment id this task can take a photo for, or null. The landing
 *  demo (`sample`) treats every imported Schoology task as connected, the way a
 *  connected student's rows look, and never reaches the server (see DemoOpts). */
export function photoSubmitAssignment(task: Task, sample = false): string | null {
  if (sample) return task.source === 'schoology-ical' ? 'demo' : null;
  if (!connected || !task.id.startsWith(TASK_PREFIX)) return null;
  const aid = task.id.slice(TASK_PREFIX.length);
  return /^\d+$/.test(aid) ? aid : null;
}

async function call<T>(payload: unknown): Promise<T> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const res = await httpsCallable(getFunctions(app, 'us-central1'), 'sgySubmitPhoto', { timeout: 90_000 })(payload);
  return res.data as T;
}

const isAudio = (f: File): boolean => f.type.startsWith('audio/');

/** A file as base64, untouched (recordings and audio files are sent as they are). */
async function toBase64(file: File): Promise<string> {
  const url = await new Promise<string>((res, rej) => {
    const r = new FileReader();
    r.onload = () => res(String(r.result));
    r.onerror = () => rej(r.error);
    r.readAsDataURL(file);
  });
  return url.slice(url.indexOf(',') + 1);
}

/** "1:07" */
const mmss = (sec: number): string => `${Math.floor(sec / 60)}:${String(Math.floor(sec % 60)).padStart(2, '0')}`;

/** Shrink to a JPEG no longer than MAX_SIDE on its long edge, as base64. */
async function toJpeg(file: File): Promise<string> {
  const bmp = await createImageBitmap(file, { imageOrientation: 'from-image' });
  const scale = Math.min(1, MAX_SIDE / Math.max(bmp.width, bmp.height));
  const canvas = document.createElement('canvas');
  canvas.width = Math.round(bmp.width * scale);
  canvas.height = Math.round(bmp.height * scale);
  const ctx = canvas.getContext('2d');
  if (!ctx) throw new Error('no canvas');
  ctx.fillStyle = '#fff'; // a transparent PNG would otherwise turn black
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bmp, 0, 0, canvas.width, canvas.height);
  bmp.close();
  const url = canvas.toDataURL('image/jpeg', QUALITY);
  return url.slice(url.indexOf(',') + 1);
}

/**
 * SUBMIT TO SCHOOLOGY (Gabe, 10/10): the popup FIRST, the file picker only when
 * asked. Opening File Explorer straight from the row left a student staring at a
 * file dialog with no idea what it was for. The popup says what happens, offers
 * "Open File Explorer" for photos and a box for text, and Submit stays grayed out
 * until there is something to hand in.
 *
 * Text WITH photos goes in as a comment on the submission (Gabe, 10/10), the
 * private thread Schoology shows beside it when the teacher grades. A submission
 * itself is either files or text, never both (its own Upload / Create split), so
 * text on its own is a normal text submission. If Schoology refuses the comment,
 * the server hands the text in as its own submission instead (functions:
 * sgySubmitPhoto).
 */
export function openPhotoSubmit(task: Task, demo?: DemoOpts): void {
  const aid = photoSubmitAssignment(task, !!demo);
  const host = demo?.host ?? document.body;
  if (!aid || host.querySelector('.bm-backdrop.photo-submit')) return;
  const back = el('div', { class: 'bm-backdrop photo-submit' });
  const box = el('div', { class: 'bm-modal photo-submit-modal' });
  box.append(el('h3', { class: 'bm-modal-title', text: 'Submit to Schoology' }));
  box.append(
    el('div', {
      class: 'bm-modal-note',
      text: `Handed in to “${task.title}”. Your teacher sees it right away, and a submission can’t be taken back.`,
    })
  );

  let files: File[] = [];
  let urls: string[] = [];
  const picker = el('input', { type: 'file', accept: 'image/*,audio/*', multiple: true }) as HTMLInputElement;
  const pickBtn = el('button', { class: 'bm-btn photo-submit-pick', type: 'button', text: '📁 Open File Explorer' }) as HTMLButtonElement;
  // TAKE A PHOTO and RECORD (Gabe, 10/11): the computer's own camera and microphone,
  // right here, beside File Explorer. Not in the landing demo: a visitor's browser
  // would be asked for camera and microphone access by a marketing page.
  const camBtn = el('button', { class: 'bm-btn', type: 'button', text: '📷 Take photo' }) as HTMLButtonElement;
  const recBtn = el('button', { class: 'bm-btn', type: 'button', text: '🎙 Record' }) as HTMLButtonElement;
  // CAMERA ROLL (Gabe, 10/12): an images-only picker. On a phone it opens the photo
  // library straight away; on a computer it is the same file dialog, filtered to
  // pictures (there is no web route into Google Photos).
  const libBtn = el('button', { class: 'bm-btn', type: 'button', text: '🖼 Camera roll' }) as HTMLButtonElement;
  const libPicker = el('input', { type: 'file', accept: 'image/*', multiple: true }) as HTMLInputElement;
  const tools = el('div', { class: 'photo-submit-tools' });
  tools.append(pickBtn);
  // The camera roll is for phones and tablets; a computer already has Open File Explorer.
  const touch = window.matchMedia?.('(pointer: coarse)').matches;
  if (!demo) tools.append(...(touch ? [libBtn] : []), camBtn, recBtn);
  const live = el('div', { class: 'photo-submit-live' }); // the camera or the recorder, while one is open
  live.hidden = true;
  const strip = el('div', { class: 'photo-submit-strip' });
  const note = el('div', { class: 'bm-modal-note photo-submit-trim' });
  const text = textInput({ class: 'photo-submit-text', placeholder: 'Add text to hand in (optional)' });
  const status = el('div', { class: 'photo-submit-status' });
  // THE CONFIRMATION (Gabe, 10/12): pressing Submit opens a red Yes / No popup, since a
  // submission can't be taken back (see the send handler below).
  box.append(tools, live, strip, note, text, status);

  const row = el('div', { class: 'bm-modal-footer' });
  row.append(el('div', { class: 'bm-modal-spacer' }));
  const cancel = el('button', { class: 'bm-btn', text: 'Cancel' }) as HTMLButtonElement;
  const send = el('button', { class: 'bm-btn bm-btn-primary', text: 'Submit' }) as HTMLButtonElement;
  row.append(cancel, send);
  box.append(row);
  // Same width as every other popup: they share one remembered width (ui/popup.ts).
  migratePopupWidth();
  if (!demo) box.append(makeWidthGrip({ box, storageKey: POPUP_WIDTH_KEY, min: 240 }));
  back.append(box);

  // "Submitted your files to “Essay”" (Gabe, 10/11): what went, and where. No
  // trailing ": title", and no account of how Schoology filed the text.
  const doneText = (hasFiles: boolean, hasText: boolean): string =>
    `Submitted your ${hasFiles && hasText ? 'files and text' : hasFiles ? 'files' : 'text'} to “${task.title}”`;
  const ready = (): boolean => (files.length > 0 || !!text.value.trim()) && !liveOpen();
  const full = (): boolean => files.length >= MAX_PHOTOS;
  const sync = (): void => {
    send.disabled = busy || !ready();
    pickBtn.hidden = libBtn.hidden = camBtn.hidden = recBtn.hidden = full() || liveOpen();
  };
  /** Add files from any source, keeping to the five-file limit. */
  const addFiles = (more: File[]): void => {
    const all = [...files, ...more];
    files = all.slice(0, MAX_PHOTOS);
    note.textContent = all.length > MAX_PHOTOS ? `Up to ${MAX_PHOTOS} files. Only the first ${MAX_PHOTOS} are sent.` : '';
    drawStrip();
    sync();
  };
  const drawStrip = (): void => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = files.map((f) => URL.createObjectURL(f));
    // Each photo wears a ✕ in its top-right corner on hover, the same button a
    // bookmark or attachment card shows (Gabe, 10/10), to take a wrong pick back out.
    // A recording is a card with its name and a player, so it can be listened back.
    strip.replaceChildren(
      ...urls.map((u, i) => {
        const audio = isAudio(files[i]);
        const tile = el('div', { class: `photo-submit-tile${audio ? ' is-audio' : ''}` });
        const x = el('button', { class: 'bm-icon-btn bm-icon-danger photo-submit-x', type: 'button', text: '✕', title: audio ? 'Remove this recording' : 'Remove this photo' });
        x.addEventListener('click', () => {
          if (busy) return;
          files.splice(i, 1);
          note.textContent = '';
          drawStrip();
          sync();
        });
        if (audio) {
          const player = el('audio', { class: 'photo-submit-audio', src: u }) as HTMLAudioElement;
          player.controls = true;
          player.preload = 'metadata';
          tile.append(el('div', { class: 'photo-submit-audio-name', text: `🎙 ${files[i].name}` }), player, x);
        } else {
          tile.append(el('img', { class: 'photo-submit-thumb', src: u, alt: '' }), x);
        }
        return tile;
      })
    );
  };
  pickBtn.addEventListener('click', () => {
    // The demo has no file system: "Open File Explorer" hands Dan his photo of
    // the page directly, then runs the same change handler a real pick does.
    if (demo) {
      void demoPhoto().then((f) => {
        files = [...files, f].slice(0, MAX_PHOTOS);
        drawStrip();
        sync();
      });
      return;
    }
    picker.click();
  });
  picker.addEventListener('change', () => {
    const all = [...(picker.files ?? [])];
    picker.value = ''; // so picking the same file again still fires
    const tooBig = all.filter((f) => isAudio(f) && f.size > MAX_AUDIO_BYTES);
    addFiles(all.filter((f) => (f.type.startsWith('image/') || isAudio(f)) && !tooBig.includes(f)));
    if (tooBig.length) note.textContent = `${tooBig[0].name} is over 7 MB, too long to send. Try a shorter recording.`;
  });
  libBtn.addEventListener('click', () => libPicker.click());
  libPicker.addEventListener('change', () => {
    const all = [...(libPicker.files ?? [])];
    libPicker.value = '';
    addFiles(all.filter((f) => f.type.startsWith('image/')));
  });
  text.addEventListener('input', sync);

  // --- the camera and the recorder ------------------------------------------
  // Only one is open at a time, in the panel under the buttons. Whatever stream it
  // holds is stopped the moment it closes, so the camera light never stays on.
  let stream: MediaStream | null = null;
  let closeLive: (() => void) | null = null;
  const liveOpen = (): boolean => !!closeLive;
  const stopStream = (): void => {
    stream?.getTracks().forEach((t) => t.stop());
    stream = null;
  };
  const endLive = (): void => {
    const c = closeLive;
    closeLive = null;
    c?.();
    stopStream();
    live.replaceChildren();
    live.hidden = true;
    sync();
  };
  const deviceError = (err: unknown, what: 'camera' | 'microphone'): void => {
    endLive();
    const name = (err as { name?: string })?.name;
    status.classList.add('error');
    status.textContent =
      name === 'NotAllowedError'
        ? `Cobalt isn’t allowed to use your ${what}. Allow it from the icon at the left of the address bar, then try again.`
        : name === 'NotFoundError'
          ? `No ${what} found on this computer.`
          : `Couldn’t start the ${what}.`;
  };

  camBtn.addEventListener('click', async () => {
    if (busy || liveOpen()) return;
    status.textContent = '';
    status.classList.remove('error');
    closeLive = () => {};
    sync();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ video: { width: { ideal: 1920 }, height: { ideal: 1080 } }, audio: false });
    } catch (err) {
      return deviceError(err, 'camera');
    }
    if (!back.isConnected) return stopStream();
    const video = el('video', { class: 'photo-submit-video' }) as HTMLVideoElement;
    video.muted = true;
    video.playsInline = true;
    video.srcObject = stream;
    void video.play();
    const snap = el('button', { class: 'bm-btn bm-btn-primary', type: 'button', text: 'Take photo' }) as HTMLButtonElement;
    const done = el('button', { class: 'bm-btn', type: 'button', text: 'Cancel' }) as HTMLButtonElement;
    const bar = el('div', { class: 'photo-submit-live-bar' });
    bar.append(snap, done);
    live.replaceChildren(video, bar);
    live.hidden = false;
    snap.addEventListener('click', async () => {
      if (!video.videoWidth || full()) return;
      const c = document.createElement('canvas');
      c.width = video.videoWidth;
      c.height = video.videoHeight;
      c.getContext('2d')!.drawImage(video, 0, 0);
      const blob = await new Promise<Blob | null>((r) => c.toBlob(r, 'image/jpeg', 0.92));
      if (!blob) return;
      // ONE SHOT, THEN THE CAMERA CLOSES (Gabe, 10/11), the same as Stop on a
      // recording: the photo joins the list and "Take photo" up top opens the
      // camera again for the next one.
      endLive();
      addFiles([new File([blob], `photo-${files.length + 1}.jpg`, { type: 'image/jpeg' })]);
    });
    done.addEventListener('click', endLive);
  });

  recBtn.addEventListener('click', async () => {
    if (busy || liveOpen()) return;
    status.textContent = '';
    status.classList.remove('error');
    closeLive = () => {};
    sync();
    try {
      stream = await navigator.mediaDevices.getUserMedia({ audio: true, video: false });
    } catch (err) {
      return deviceError(err, 'microphone');
    }
    if (!back.isConnected) return stopStream();
    const type = ['audio/webm;codecs=opus', 'audio/ogg;codecs=opus', 'audio/webm', 'audio/mp4'].find((t) => MediaRecorder.isTypeSupported(t)) ?? '';
    const rec = new MediaRecorder(stream, { ...(type ? { mimeType: type } : {}), audioBitsPerSecond: 64_000 });
    const chunks: Blob[] = [];
    rec.ondataavailable = (e) => {
      if (e.data.size) chunks.push(e.data);
    };
    let keep = true;
    const dot = el('span', { class: 'photo-submit-rec-dot' });
    const clock = el('span', { class: 'photo-submit-rec-time', text: `0:00 / ${mmss(MAX_REC_SECONDS)}` });
    const stop = el('button', { class: 'bm-btn bm-btn-primary', type: 'button', text: 'Stop' }) as HTMLButtonElement;
    const discard = el('button', { class: 'bm-btn', type: 'button', text: 'Discard' }) as HTMLButtonElement;
    const head = el('div', { class: 'photo-submit-rec-head' });
    head.append(dot, el('span', { text: 'Recording' }), clock);
    // THE VOICE BARS (Gabe, 10/11): proof the microphone is hearing you. Each bar
    // is one band of the voice range, read off the live stream ~60 times a second.
    const VIZ_BARS = 28;
    const bars = Array.from({ length: VIZ_BARS }, () => el('span', { class: 'photo-submit-rec-bar' }));
    const viz = el('div', { class: 'photo-submit-rec-viz' });
    viz.append(...bars);
    const meter = el('div', { class: 'photo-submit-rec' });
    meter.append(head, viz);
    let vizCtx: AudioContext | null = null;
    let vizRaf = 0;
    try {
      vizCtx = new AudioContext();
      const an = vizCtx.createAnalyser();
      an.fftSize = 256; // 128 bands of ~190 Hz; a voice lives in the first ~25
      an.smoothingTimeConstant = 0.75;
      // LESS SENSITIVE (Gabe, 10/11: the hum at the back of the room moved the bars).
      // Anything quieter than -70 dB reads as silence (default -100), and a further
      // noise gate below keeps room tone flat, so only a voice lifts them.
      an.minDecibels = -70;
      an.maxDecibels = -20;
      vizCtx.createMediaStreamSource(stream).connect(an); // never to the speakers: no echo
      const buf = new Uint8Array(an.frequencyBinCount);
      // Lowest bands in the MIDDLE, mirrored outward, so speech swells from the center.
      const half = VIZ_BARS / 2;
      const draw = (): void => {
        an.getByteFrequencyData(buf);
        bars.forEach((b, i) => {
          const band = 1 + Math.abs(i - half + 0.5) | 0;
          const v = Math.max(0, (buf[band] / 255 - 0.22) / 0.78); // the gate
          b.style.transform = `scaleY(${Math.max(0.08, v).toFixed(3)})`;
        });
        vizRaf = requestAnimationFrame(draw);
      };
      draw();
    } catch {
      viz.hidden = true; // no Web Audio: record without the bars
    }
    const stopViz = (): void => {
      cancelAnimationFrame(vizRaf);
      void vizCtx?.close().catch(() => {});
      vizCtx = null;
    };
    const bar = el('div', { class: 'photo-submit-live-bar' });
    bar.append(stop, discard);
    live.replaceChildren(meter, bar);
    live.hidden = false;
    const t0 = Date.now();
    const tick = window.setInterval(() => {
      const sec = (Date.now() - t0) / 1000;
      clock.textContent = `${mmss(sec)} / ${mmss(MAX_REC_SECONDS)}`;
      if (sec >= MAX_REC_SECONDS && rec.state === 'recording') rec.stop(); // the length cap
    }, 250);
    rec.onstop = () => {
      window.clearInterval(tick);
      stopViz();
      const mime = (rec.mimeType || type || 'audio/webm').split(';')[0];
      const ext = mime.includes('ogg') ? 'ogg' : mime.includes('mp4') ? 'm4a' : 'webm';
      const take = keep && chunks.length ? new File(chunks, `recording-${files.filter(isAudio).length + 1}.${ext}`, { type: mime }) : null;
      if (closeLive) endLive(); // still open: close the panel (a popup close already did)
      if (take && back.isConnected) addFiles([take]);
    };
    // Closing the popup mid-recording throws the take away.
    closeLive = () => {
      if (rec.state === 'recording') {
        keep = false;
        rec.stop();
      }
    };
    stop.addEventListener('click', () => {
      if (rec.state === 'recording') rec.stop();
    });
    discard.addEventListener('click', () => {
      keep = false;
      if (rec.state === 'recording') rec.stop();
    });
    rec.start(1000);
  });

  const close = (): void => {
    endLive();
    urls.forEach((u) => URL.revokeObjectURL(u));
    fadeRemove(back);
  };
  let busy = false;
  cancel.addEventListener('click', () => !busy && close());
  back.addEventListener('click', (e) => {
    if (e.target === back && !busy) close();
  });
  const onEsc = (e: KeyboardEvent): void => {
    if (!back.isConnected) return void document.removeEventListener('keydown', onEsc);
    if (e.key === 'Escape' && !busy) close();
  };
  document.addEventListener('keydown', onEsc);

  // A deliberate CLICK, never Enter: this one cannot be undone. Pressing Submit asks
  // "Are you sure?" in the app's red Yes / No popup; only Yes sends.
  send.addEventListener('click', () => {
    if (busy || !ready()) return;
    confirmDialog({
      title: 'Are you sure you want to submit this?',
      note: 'Your teacher sees it right away, and a submission can’t be taken back.',
      backdropClass: 'confirm-submit',
      host: demo ? host : undefined,
      buttons: [
        { label: 'No', kind: 'cancel' },
        { label: 'Yes', kind: 'danger', onClick: () => submit() },
      ],
    });
  });
  const submit = (): void => {
    if (busy || !ready()) return;
    busy = true;
    send.disabled = cancel.disabled = pickBtn.disabled = libBtn.disabled = camBtn.disabled = recBtn.disabled = true;
    text.disabled = true;
    status.classList.remove('error');
    void (async () => {
      if (demo) {
        // The demo's hand-in: the same status lines and toast, no server.
        status.textContent = 'Sending the photo…';
        await new Promise((r) => setTimeout(r, 700));
        status.textContent = 'Handing it in…';
        await new Promise((r) => setTimeout(r, 600));
        close();
        showToast(doneText(files.length > 0, !!text.value.trim()), host);
        return;
      }
      try {
        const ids: string[] = [];
        let photoN = 0;
        for (let i = 0; i < files.length; i++) {
          const f = files[i];
          const audio = isAudio(f);
          status.textContent = files.length > 1 ? `Sending file ${i + 1} of ${files.length}…` : `Sending the ${audio ? 'recording' : 'photo'}…`;
          let data: string;
          try {
            data = audio ? await toBase64(f) : await toJpeg(f);
          } catch {
            throw new Error(audio ? 'Couldn’t read that recording.' : 'Couldn’t read that photo. Try a JPEG or PNG.');
          }
          const { fileId } = await call<{ fileId: string }>(
            audio
              ? { step: 'upload', name: f.name, mime: f.type, data }
              : { step: 'upload', name: `photo-${++photoN}.jpg`, mime: 'image/jpeg', data }
          );
          ids.push(fileId);
        }
        status.textContent = 'Handing it in…';
        await call({ step: 'submit', assignmentId: aid, fileIds: ids, text: text.value.trim() });
        close();
        showToast(doneText(ids.length > 0, !!text.value.trim()));
      } catch (err) {
        busy = false;
        cancel.disabled = pickBtn.disabled = libBtn.disabled = camBtn.disabled = recBtn.disabled = text.disabled = false;
        sync();
        send.textContent = 'Try again';
        status.textContent = sgyErrorText(err);
        status.classList.add('error');
      }
    })();
  };

  host.append(back);
  sync();
  if (!demo) cancel.focus(); // never steal page focus from the landing
}

/** The landing demo's hooks: where the popup mounts (inside the hero frame). */
export interface DemoOpts {
  host: HTMLElement;
}

/** Dan's photo of his handwritten outline, drawn on a canvas so the demo ships no
 *  image file: lined paper and a few lines of pen. */
async function demoPhoto(): Promise<File> {
  const c = document.createElement('canvas');
  c.width = 600;
  c.height = 780;
  const g = c.getContext('2d')!;
  g.fillStyle = '#fbfaf5';
  g.fillRect(0, 0, c.width, c.height);
  g.strokeStyle = '#c9d7ea';
  g.lineWidth = 2;
  for (let y = 110; y < c.height; y += 44) {
    g.beginPath();
    g.moveTo(0, y);
    g.lineTo(c.width, y);
    g.stroke();
  }
  g.strokeStyle = '#e8a0a0';
  g.beginPath();
  g.moveTo(70, 0);
  g.lineTo(70, c.height);
  g.stroke();
  g.fillStyle = '#26334d';
  g.font = 'italic 30px "Segoe Print", "Bradley Hand", "Comic Sans MS", cursive';
  const lines = ['Animal Farm essay, outline', 'I. Napoleon takes the farm', '   - the dogs, ch. 5', 'II. Squealer rewrites history', '   - "four legs good"', 'III. Boxer and the windmill', 'Conclusion: power corrupts'];
  lines.forEach((l, i) => g.fillText(l, 84, 100 + i * 88));
  const blob = await new Promise<Blob>((r) => c.toBlob((b) => r(b!), 'image/jpeg', 0.9));
  return new File([blob], 'outline.jpg', { type: 'image/jpeg' });
}
