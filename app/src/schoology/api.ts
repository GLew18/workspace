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

const FLAG_KEY = 'cobalt:sgyApi';

/** Is the beta connect row switched on for this browser? `?sgyapi=1` turns it on,
 *  `?sgyapi=0` off; the choice is remembered. */
export function sgyApiFlag(): boolean {
  try {
    const q = new URLSearchParams(location.search).get('sgyapi');
    // The address alone decides when it says so, so a browser with storage blocked
    // still honours ?sgyapi=1 for this visit.
    if (q === '1' || q === '0') {
      try {
        if (q === '1') localStorage.setItem(FLAG_KEY, '1');
        else localStorage.removeItem(FLAG_KEY);
      } catch {
        /* remembered next time only if storage works */
      }
      return q === '1';
    }
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

// #region School picker — pick your school instead of typing its Schoology address
/** Schools Cobalt knows the Schoology address of. Picking one starts the connect
 *  flow in a single tap (Gabe, 10/8/26: typing an address was slow and cumbersome).
 *  "Test" is Schoology's developer sandbox, where PowerSchool's reviewers and
 *  Cobalt's own test accounts live. Add a school here as Cobalt reaches it. */
export interface SchoolChoice {
  name: string;
  host: string;
  /** Extra words the search matches, e.g. the school's full name. */
  also?: string;
}
export const SCHOOLS: SchoolChoice[] = [
  // Heschel ('heschel.schoology.com') comes back once PowerSchool publishes the app;
  // until then Schoology refuses every account outside the sandbox (Gabe, 10/8/26).
  // Labelled for testers until real schools are listed (Gabe, 10/8/26).
  { name: 'Press this for now', host: 'app.schoology.com', also: 'test schoology sandbox developer reviewer powerschool' },
];

export function matchSchools(query: string): SchoolChoice[] {
  const q = query.trim().toLowerCase();
  if (!q) return SCHOOLS;
  return SCHOOLS.filter((s) => `${s.name} ${s.host} ${s.also ?? ''}`.toLowerCase().includes(q));
}

/** A typed address that names a Schoology site, for schools not in the list yet. */
function typedHost(query: string): string {
  const h = query.trim().toLowerCase().replace(/^[a-z]+:\/\//, '').split(/[/?#]/)[0];
  return /^[a-z0-9-]+(\.[a-z0-9-]+)*\.schoology\.com$/.test(h) ? h : '';
}

/** Search box + one button per matching school. Tapping a school calls onPick
 *  with its host. Enter picks when exactly one school matches. A full
 *  "something.schoology.com" address works too, for a school not listed yet. */
export function buildSchoolPicker(opts: {
  inputClass: string;
  btnClass: string;
  onPick: (host: string) => void;
}): { el: HTMLElement; setBusy: (busy: boolean) => void } {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:8px;width:100%' });
  const input = textInput({ class: opts.inputClass, placeholder: 'School search' });
  const list = el('div', { style: 'display:flex;flex-direction:column;gap:8px' });
  const empty = el('div', {
    style: 'font-size:12px;opacity:.75',
    text: 'Not listed yet. Type your school’s full Schoology address, like yourschool.schoology.com.',
  });
  let busy = false;
  let current: string[] = [];
  const render = (): void => {
    list.replaceChildren();
    const hits = matchSchools(input.value);
    const extra = typedHost(input.value);
    current = hits.map((s) => s.host);
    if (extra && !current.includes(extra)) current.push(extra);
    for (const s of hits) {
      const b = el('button', { class: opts.btnClass, type: 'button', text: s.name, title: s.host }) as HTMLButtonElement;
      b.style.marginTop = '0';
      b.disabled = busy;
      b.addEventListener('click', () => opts.onPick(s.host));
      list.append(b);
    }
    if (extra && !hits.some((s) => s.host === extra)) {
      const b = el('button', { class: opts.btnClass, type: 'button', text: `Connect to ${extra}` }) as HTMLButtonElement;
      b.style.marginTop = '0';
      b.disabled = busy;
      b.addEventListener('click', () => opts.onPick(extra));
      list.append(b);
    }
    if (!current.length) list.append(empty);
  };
  input.addEventListener('input', render);
  input.addEventListener('keydown', (e) => {
    if (e.key !== 'Enter') return;
    e.preventDefault();
    if (current.length === 1 && !busy) opts.onPick(current[0]);
  });
  render();
  wrap.append(input, list);
  return {
    el: wrap,
    setBusy(b: boolean) {
      busy = b;
      render();
    },
  };
}
// #endregion
