// Cobalt: the real Schoology connection (OAuth through Cloud Functions).
//
// The student authorizes Cobalt on their own school's Schoology page; the server
// keeps the token (functions/index.js, "Schoology API" region) and hands back the
// same payload shape the companion extension produces, so sync.ts runs its one
// pipeline over it unchanged. Task ids stay 'ical_assign_<id>', which means an
// account that already imported through iCal or the extension does not get a
// duplicate of anything when it switches over.
//
// BEHIND A FLAG until one real end-to-end import has run (Schoology Integration
// Timeline, Phase 2). The Settings row only appears when the flag is on or the
// account is already connected. Turn it on by opening the app with ?sgyapi=1.

import type { Data } from '../db';
import { firebaseConfig } from '../firebase';
import { coercePayload, type SgyPayload } from './extension';

/** Public marker the server writes at profile 'sgyApi'. The token itself never
 *  leaves the server. */
export interface SgyApiState {
  connected: boolean;
  expired?: boolean;
  host?: string;
  name?: string;
  connectedAt?: string;
  lastFetchAt?: string;
}

const FLAG_KEY = 'cobalt:sgyApi';

/** Is the beta connect row switched on for this browser? `?sgyapi=1` turns it on,
 *  `?sgyapi=0` off; the choice is remembered. */
export function sgyApiFlag(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('sgyapi');
    if (q === '1') localStorage.setItem(FLAG_KEY, '1');
    if (q === '0') localStorage.removeItem(FLAG_KEY);
    return localStorage.getItem(FLAG_KEY) === '1';
  } catch {
    return false;
  }
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

/** The school host to suggest in the connect box: from the saved iCal link when
 *  there is one (it lives on the school's own Schoology domain). */
export function hostFromIcal(icalUrl: string | undefined): string {
  const m = String(icalUrl || '').match(/^[a-z]+:\/\/([a-z0-9.-]+\.schoology\.com)\//i);
  return m ? m[1].toLowerCase() : '';
}
