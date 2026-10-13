// Cobalt: the Schoology connection (OAuth through Cloud Functions), the ONLY way
// Schoology connects since 10/9/26.
//
// The student authorizes Cobalt on their own school's Schoology page; the server
// keeps the token (functions/index.js, "Schoology API" region) and hands back the
// payload sync.ts imports. Task ids stay 'ical_assign_<id>' (a legacy name), so an
// account that imported through the old iCal link or extension gets no duplicates
// when it reconnects.

import type { Data } from '../db';
import { firebaseConfig } from '../firebase';
import { coercePayload, type SgyPayload } from './extension';
import { el, textInput } from '../util/dom';

/** Public marker the server writes at profile 'sgyApi'. The token itself never
 *  leaves the server. */
export interface SgyApiState {
  connected: boolean;
  expired?: boolean;
  host?: string;
  name?: string;
  /** Schoology's preferred first name, else the legal one: what Cobalt greets them as. */
  firstName?: string;
  connectedAt?: string;
  lastFetchAt?: string;
}

async function callable<T>(name: string, payload: unknown): Promise<T> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const res = await httpsCallable(getFunctions(app, 'us-central1'), name, { timeout: 120_000 })(payload);
  return res.data as T;
}

/** The callable's own sentence when it sent one, never a bare "internal". */
export function sgyErrorText(err: unknown): string {
  const msg = (err as { message?: string })?.message || '';
  return msg && !/^internal$/i.test(msg) ? msg : 'Something went wrong talking to Schoology. Try again.';
}

export async function getSgyApiState(data: Data): Promise<SgyApiState | null> {
  const s = await data.getProfile<SgyApiState>('sgyApi');
  return s && typeof s === 'object' ? s : null;
}

/** Leaves the app: full-page redirect to the school's Schoology approve screen. */
export async function startSchoologyConnect(host: string): Promise<void> {
  const { url } = await callable<{ url: string }>('sgyConnectStart', { host, returnTo: location.origin });
  location.assign(url);
}

/** Schoology just sent the student back here. Finish the connection and clean the
 *  URL. Resolves null when this page load is not a return from Schoology. */
export async function finishSchoologyConnectIfReturning(): Promise<SgyApiState | null> {
  const q = new URLSearchParams(location.search);
  const token = q.get('oauth_token');
  if (q.get('sgy') !== 'return' || !token) return null;
  const verifier = q.get('oauth_verifier') || '';
  // Strip the token from the address bar first, so a reload can never replay it.
  for (const k of ['sgy', 'oauth_token', 'oauth_verifier']) q.delete(k);
  const qs = q.toString();
  history.replaceState(null, '', location.pathname + (qs ? '?' + qs : '') + location.hash);
  return callable<SgyApiState>('sgyConnectFinish', { token, verifier });
}

export async function disconnectSchoology(): Promise<void> {
  await callable('sgyDisconnect', {});
}

/** The student's courses and upcoming assignments, read by the server. */
export async function fetchSgyApiPayload(): Promise<SgyPayload | null> {
  return coercePayload(await callable<unknown>('sgyFetch', {}));
}

/** The student's gradebook (Grades tab), read by the server. Never stored. */
export async function fetchSgyGrades(): Promise<unknown> {
  return callable<unknown>('sgyGrades', {});
}

// #region School address — the student types their school's Schoology address
// (Gabe, 10/10/26). It replaced a search over a hand-kept list of schools: a list
// only knows the schools someone added, while every Schoology school already has
// its own address, so this works for everyone from day one. Cobalt's own test
// accounts use the developer sandbox address, app.schoology.com.

/** The bare host when the text names a Schoology site, else ''. Forgiving about
 *  what students paste: a scheme, a path or trailing spaces are all fine. */
export function schoologyHost(text: string): string {
  const h = text.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.schoology\.com$/.test(h) ? h : '';
}

/** Address box + Connect button. Calls onPick with the host once the text is a
 *  real Schoology address; otherwise says what one looks like. */
export function buildSchoolAddress(opts: {
  inputClass: string;
  btnClass: string;
  onPick: (host: string) => void;
  /** Pre-filled address, e.g. the school an expired connection used. */
  value?: string;
}): { el: HTMLElement; setBusy: (busy: boolean, label?: string) => void } {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:8px;width:100%' });
  const input = textInput({ class: opts.inputClass, placeholder: 'school.schoology.com', value: opts.value ?? '' });
  input.setAttribute('aria-label', 'Your school’s Schoology address');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  const btn = el('button', { class: opts.btnClass, type: 'button', text: 'Connect' }) as HTMLButtonElement;
  btn.style.marginTop = '0';
  // "PRESS THIS FOR NOW" STAYS (Gabe, 10/10): PowerSchool's app reviewers were told
  // to press it, and it connects the developer sandbox in one tap. Remove it only
  // once the review is over.
  const sandbox = el('button', { class: opts.btnClass, type: 'button', text: 'Press this for now' }) as HTMLButtonElement;
  sandbox.style.marginTop = '0';
  sandbox.addEventListener('click', () => {
    if (sandbox.disabled) return;
    err.textContent = '';
    opts.onPick('app.schoology.com');
  });
  const err = el('div', { style: 'font-size:12px;color:var(--red)' });
  const submit = (): void => {
    if (btn.disabled) return;
    const host = schoologyHost(input.value);
    if (!host) {
      err.textContent = input.value.trim()
        ? 'That isn’t a Schoology address. It looks like school.schoology.com.'
        : 'Type your school’s Schoology address, like school.schoology.com.';
      input.focus();
      return;
    }
    err.textContent = '';
    opts.onPick(host);
  };
  btn.addEventListener('click', submit);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    submit();
  });
  input.addEventListener('input', () => (err.textContent = ''));
  wrap.append(input, btn, sandbox, err);
  return {
    el: wrap,
    /** While busy, the Connect button itself is the progress line (Gabe, 10/12). */
    setBusy(b: boolean, label = 'Opening Schoology…') {
      btn.disabled = b;
      sandbox.disabled = b;
      input.disabled = b;
      btn.textContent = b ? label : 'Connect';
    },
  };
}
// #endregion
