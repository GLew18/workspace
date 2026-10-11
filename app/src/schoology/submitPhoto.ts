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

const TASK_PREFIX = 'ical_assign_';
const MAX_PHOTOS = 5;
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
 * sgySubmitPhoto), and the toast says so.
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
      text: `Handed in on “${task.title}”. Your teacher sees it right away, and a submission can’t be taken back.`,
    })
  );

  let files: File[] = [];
  let urls: string[] = [];
  const picker = el('input', { type: 'file', accept: 'image/*', multiple: true }) as HTMLInputElement;
  const pickBtn = el('button', { class: 'bm-btn photo-submit-pick', type: 'button', text: 'Open File Explorer' }) as HTMLButtonElement;
  const strip = el('div', { class: 'photo-submit-strip' });
  const note = el('div', { class: 'bm-modal-note photo-submit-trim' });
  const text = textInput({ class: 'photo-submit-text', placeholder: 'Add text to hand in (optional)' });
  const status = el('div', { class: 'photo-submit-status' });
  box.append(pickBtn, strip, note, text, status);

  const row = el('div', { class: 'bm-modal-footer' });
  row.append(el('div', { class: 'bm-modal-spacer' }));
  const cancel = el('button', { class: 'bm-btn', text: 'Cancel' }) as HTMLButtonElement;
  const send = el('button', { class: 'bm-btn bm-btn-primary', text: 'Submit' }) as HTMLButtonElement;
  row.append(cancel, send);
  box.append(row);
  back.append(box);

  const ready = (): boolean => files.length > 0 || !!text.value.trim();
  const sync = (): void => {
    send.disabled = busy || !ready();
    pickBtn.textContent = files.length ? 'Add more photos' : 'Open File Explorer';
    pickBtn.hidden = files.length >= MAX_PHOTOS;
  };
  const drawStrip = (): void => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    urls = files.map((f) => URL.createObjectURL(f));
    // Each photo wears a ✕ in its top-right corner on hover, the same button a
    // bookmark or attachment card shows (Gabe, 10/10), to take a wrong pick back out.
    strip.replaceChildren(
      ...urls.map((u, i) => {
        const tile = el('div', { class: 'photo-submit-tile' });
        const x = el('button', { class: 'bm-icon-btn bm-icon-danger photo-submit-x', type: 'button', text: '✕', title: 'Remove this photo' });
        x.addEventListener('click', () => {
          if (busy) return;
          files.splice(i, 1);
          note.textContent = '';
          drawStrip();
          sync();
        });
        tile.append(el('img', { class: 'photo-submit-thumb', src: u, alt: '' }), x);
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
    const picked = [...(picker.files ?? [])].filter((f) => f.type.startsWith('image/'));
    picker.value = ''; // so picking the same photo again still fires
    const all = [...files, ...picked];
    files = all.slice(0, MAX_PHOTOS);
    note.textContent = all.length > MAX_PHOTOS ? `Up to ${MAX_PHOTOS} photos. Only the first ${MAX_PHOTOS} are sent.` : '';
    drawStrip();
    sync();
  });
  text.addEventListener('input', sync);

  const close = (): void => {
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

  // A deliberate CLICK, never Enter: this one cannot be undone.
  send.addEventListener('click', () => {
    if (busy || !ready()) return;
    busy = true;
    send.disabled = cancel.disabled = pickBtn.disabled = true;
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
        showToast(
          text.value.trim() ? `Submitted to Schoology, with your text as a comment: ${task.title}` : `Submitted to Schoology: ${task.title}`,
          host
        );
        return;
      }
      try {
        const ids: string[] = [];
        for (let i = 0; i < files.length; i++) {
          status.textContent = files.length > 1 ? `Sending photo ${i + 1} of ${files.length}…` : 'Sending the photo…';
          let data: string;
          try {
            data = await toJpeg(files[i]);
          } catch {
            throw new Error('Couldn’t read that photo. Try a JPEG or PNG.');
          }
          const { fileId } = await call<{ fileId: string }>({ step: 'upload', name: `photo-${i + 1}.jpg`, mime: 'image/jpeg', data });
          ids.push(fileId);
        }
        status.textContent = 'Handing it in…';
        const res = await call<{ textAs?: 'comment' | 'submission' }>({ step: 'submit', assignmentId: aid, fileIds: ids, text: text.value.trim() });
        close();
        // Say where the text went when it rode with photos: as a comment beside them,
        // or (if Schoology refused the comment) as its own text submission.
        showToast(
          ids.length && res?.textAs === 'comment'
            ? `Submitted to Schoology, with your text as a comment: ${task.title}`
            : ids.length && res?.textAs === 'submission'
              ? `Submitted to Schoology. Your text went in as its own submission: ${task.title}`
              : `Submitted to Schoology: ${task.title}`
        );
      } catch (err) {
        busy = false;
        cancel.disabled = pickBtn.disabled = text.disabled = false;
        sync();
        send.textContent = 'Try again';
        status.textContent = sgyErrorText(err);
        status.classList.add('error');
      }
    })();
  });

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
