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

/** The Schoology assignment id this task can take a photo for, or null. */
export function photoSubmitAssignment(task: Task): string | null {
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
 * Text and photos are TWO submissions in Schoology, not one: its API takes a
 * submission either as files or as text (the same Upload / Create split as its own
 * submit window), so with both, the text goes first and the photos second.
 */
export function openPhotoSubmit(task: Task): void {
  const aid = photoSubmitAssignment(task);
  if (!aid || document.querySelector('.bm-backdrop.photo-submit')) return;
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
    strip.replaceChildren(...urls.map((u) => el('img', { class: 'photo-submit-thumb', src: u, alt: '' })));
  };
  pickBtn.addEventListener('click', () => picker.click());
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
        await call({ step: 'submit', assignmentId: aid, fileIds: ids, text: text.value.trim() });
        close();
        showToast(`Submitted to Schoology: ${task.title}`);
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

  document.body.append(back);
  sync();
  cancel.focus();
}
