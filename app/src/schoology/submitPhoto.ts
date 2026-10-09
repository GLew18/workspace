// Cobalt: hand in a photo on a Schoology assignment, from the task's ⋯ menu
// (Gabe, 10/8/26: "submit a photo to Cobalt and it submits it on that same
// assignment on Schoology").
//
// Only for a student connected to Schoology directly (the real API), and only on a
// task that IS a Schoology assignment ('ical_assign_<id>'). The flow:
//   1. pick or take photos (a phone offers its camera),
//   2. a confirm screen shows them with the assignment's title, because a
//      submission goes straight to the teacher and a student can't take it back,
//   3. each photo is shrunk to a ~1 MB JPEG here, uploaded one per call, then all
//      of them are handed in together as one submission (functions: sgySubmitPhoto).

import type { Data } from '../db';
import type { Task } from '../types';
import { el, fadeRemove, showToast } from '../util/dom';
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

/** Opens the photo picker, then the confirm screen. */
export function openPhotoSubmit(task: Task): void {
  const aid = photoSubmitAssignment(task);
  if (!aid) return;
  const input = el('input', { type: 'file', accept: 'image/*', multiple: true }) as HTMLInputElement;
  input.addEventListener('change', () => {
    const files = [...(input.files ?? [])].filter((f) => f.type.startsWith('image/'));
    if (files.length) confirmPhotos(task, aid, files.slice(0, MAX_PHOTOS), files.length > MAX_PHOTOS);
  });
  input.click();
}

function confirmPhotos(task: Task, aid: string, files: File[], trimmed: boolean): void {
  if (document.querySelector('.bm-backdrop.photo-submit')) return;
  const back = el('div', { class: 'bm-backdrop photo-submit' });
  const box = el('div', { class: 'bm-modal photo-submit-modal' });
  box.append(el('h3', { class: 'bm-modal-title', text: 'Submit to Schoology?' }));
  box.append(
    el('div', {
      class: 'bm-modal-note',
      text: `${files.length === 1 ? 'This photo' : `These ${files.length} photos`} will be handed in on “${task.title}”. Your teacher sees ${files.length === 1 ? 'it' : 'them'} right away, and a submission can’t be taken back.`,
    })
  );
  if (trimmed) box.append(el('div', { class: 'bm-modal-note', text: `Only the first ${MAX_PHOTOS} photos are sent.` }));

  const strip = el('div', { class: 'photo-submit-strip' });
  const urls = files.map((f) => URL.createObjectURL(f));
  for (const u of urls) strip.append(el('img', { class: 'photo-submit-thumb', src: u, alt: '' }));
  box.append(strip);

  const status = el('div', { class: 'photo-submit-status' });
  box.append(status);

  const close = (): void => {
    urls.forEach((u) => URL.revokeObjectURL(u));
    fadeRemove(back);
  };
  const row = el('div', { class: 'bm-modal-footer' });
  row.append(el('div', { class: 'bm-modal-spacer' }));
  const cancel = el('button', { class: 'bm-btn', text: 'Cancel' }) as HTMLButtonElement;
  const send = el('button', { class: 'bm-btn bm-btn-primary', text: 'Submit' }) as HTMLButtonElement;
  row.append(cancel, send);
  box.append(row);
  back.append(box);

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

  // A deliberate CLICK, never Enter: focus starts on Cancel (same rule as
  // confirmDanger), because this one cannot be undone.
  send.addEventListener('click', () => {
    if (busy) return;
    busy = true;
    send.disabled = cancel.disabled = true;
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
        await call({ step: 'submit', assignmentId: aid, fileIds: ids });
        close();
        showToast(`Submitted to Schoology: ${task.title}`);
      } catch (err) {
        busy = false;
        send.disabled = cancel.disabled = false;
        send.textContent = 'Try again';
        status.textContent = sgyErrorText(err);
        status.classList.add('error');
      }
    })();
  });

  document.body.append(back);
  cancel.focus();
}
