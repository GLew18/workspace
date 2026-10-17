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

/** Opens the school's Schoology approve screen in a small popup window and leaves Cobalt
 *  where it is. The Schoology window just STOPS at Schoology once the student approves (no return
 *  to Cobalt: Gabe, 10/16); this tab finds out by itself (see watchSchoologyConnect)
 *  and the student clicks back into it. The tab is opened before the server call so
 *  the click still counts as a user gesture. If the browser blocks the tab, this falls
 *  back to leaving the page, and Schoology sends the student back to it. */
export async function startSchoologyConnect(
  host: string,
  allowPage = true
): Promise<{ how: 'tab' | 'page' | 'blocked'; token?: string; claim?: string }> {
  let win: Window | null = null;
  try {
    // A NAMED tab, so a second attempt reuses the same Schoology tab.
    // A small POPUP WINDOW, not a tab (Gabe, 10/16): Schoology's own approve screen,
    // then Schoology's "you have successfully approved" banner, and Cobalt untouched.
    const w = 560;
    const h = 760;
    const left = Math.max(0, Math.round(window.screenX + (window.outerWidth - w) / 2));
    const top = Math.max(0, Math.round(window.screenY + (window.outerHeight - h) / 2));
    win = window.open('about:blank', 'cobalt-schoology', `popup=yes,width=${w},height=${h},left=${left},top=${top}`);
  } catch {
    win = null;
  }
  const stay = !!win;
  try {
    const { url, token, claim } = await callable<{ url: string; token?: string; claim?: string }>('sgyConnectStart', { host, returnTo: location.origin, stay });
    if (win && !win.closed) {
      win.location.href = url;
      return { how: 'tab', token, claim };
    }
    if (!allowPage) return { how: 'blocked' };
    location.assign(url);
    return { how: 'page' };
  } catch (e) {
    try {
      win?.close();
    } catch {
      /* already gone */
    }
    throw e;
  }
}

const JUST_CONNECTED_KEY = 'ws:sgyJustConnected';
const CONNECT_ERROR_KEY = 'ws:sgyConnectError';

/** The connection finished on the page load that signed this student in. Read once:
 *  the onboarding (new account) or the app (returning one) takes it and shows the payoff. */
export function takeJustConnected(): SgyApiState | null {
  try {
    const raw = sessionStorage.getItem(JUST_CONNECTED_KEY);
    sessionStorage.removeItem(JUST_CONNECTED_KEY);
    return raw ? (JSON.parse(raw) as SgyApiState) : null;
  } catch {
    return null;
  }
}
export function peekJustConnected(): boolean {
  try {
    return !!sessionStorage.getItem(JUST_CONNECTED_KEY);
  } catch {
    return false;
  }
}
/** A return from Schoology that failed (expired, refused): said on the Connect screen. */
export function takeConnectError(): string {
  try {
    const m = sessionStorage.getItem(CONNECT_ERROR_KEY) || '';
    sessionStorage.removeItem(CONNECT_ERROR_KEY);
    return m;
  } catch {
    return '';
  }
}
export function isSgyReturn(): boolean {
  const q = new URLSearchParams(location.search);
  return q.get('sgy') === 'return' && !!q.get('oauth_token');
}
/** Page-load step, BEFORE the sign-in listener starts: if this load is the return
 *  from Schoology's approve screen, finish the connection (which signs a new visitor in). */
export async function finishReturnAtBoot(): Promise<void> {
  if (!isSgyReturn()) return;
  try {
    // The finish call must carry the identity of whoever started the connection, so
    // wait for any saved sign-in to be restored first.
    const { authReady } = await import('../auth');
    await authReady();
    await finishSchoologyConnectIfReturning();
  } catch (e) {
    try {
      sessionStorage.setItem(CONNECT_ERROR_KEY, sgyErrorText(e));
    } catch {
      /* nothing to carry it in */
    }
  }
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
  const res = await callable<SgyApiState & { customToken?: string }>('sgyConnectFinish', { token, verifier });
  const { customToken, ...st } = res;
  // A signed-out visitor: the server sent a login with the connection.
  if (customToken) {
    const { signInWithToken } = await import('../auth');
    await signInWithToken(customToken);
  }
  try {
    sessionStorage.setItem(JUST_CONNECTED_KEY, JSON.stringify(st));
  } catch {
    /* no session storage: the app just opens without the "connected" reveal */
  }
  return st;
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

/** While the Schoology window is open: asks the server every few seconds whether the
 *  student has approved yet. The moment they have, the connection is finished HERE (a
 *  signed-out visitor is signed in here too) and onConnected runs; the student only has
 *  to click back into this tab. `claim` is the secret only this tab holds, so nobody who
 *  merely sees the Schoology address can finish the connection. Gives up after 15
 *  minutes or on a real refusal. Returns the stop function. */
export function watchSchoologyConnect(
  token: string,
  claim: string,
  onConnected: (st: SgyApiState) => void,
  onError?: (e: unknown) => void
): () => void {
  const started = Date.now();
  let busy = false;
  let stopped = false;
  const stop = (): void => {
    stopped = true;
    clearInterval(timer);
  };
  const poll = async (): Promise<void> => {
    if (stopped || busy) return;
    if (Date.now() - started > 15 * 60_000) {
      stop();
      onError?.(new Error('That Schoology connection expired. Try connecting again.'));
      return;
    }
    busy = true;
    try {
      const res = await callable<SgyApiState & { customToken?: string; pending?: boolean }>('sgyConnectFinish', { token, claim, poll: true });
      if (stopped) return;
      if (res && res.pending) return; // not approved yet
      const { customToken, pending: _pending, ...st } = res;
      stop();
      // Left for the page that opens next, BEFORE signing in: signing in starts the app
      // up, and it must find the "just connected" marker waiting.
      try {
        sessionStorage.setItem(JUST_CONNECTED_KEY, JSON.stringify(st));
      } catch {
        /* the app just opens without the "connected" reveal */
      }
      if (customToken) {
        const { signInWithToken } = await import('../auth');
        await signInWithToken(customToken);
      }
      onConnected(st as SgyApiState);
    } catch (e) {
      // A network blip just tries again on the next tick; anything else the server
      // said is final (expired, refused, signing in failed), so say it.
      const code = (e as { code?: string })?.code || '';
      if (!/unavailable|deadline|network/i.test(code)) {
        stop();
        onError?.(e);
      }
    } finally {
      busy = false;
    }
  };
  const timer = setInterval(() => void poll(), 3000);
  return stop;
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
}): { el: HTMLElement; setBusy: (busy: boolean, label?: string) => void; setNote: (text: string) => void } {
  const wrap = el('div', { style: 'display:flex;flex-direction:column;gap:8px;width:100%' });
  const input = textInput({ class: opts.inputClass, placeholder: 'school.schoology.com', value: opts.value ?? '' });
  input.setAttribute('aria-label', 'Your school’s Schoology address');
  input.setAttribute('autocapitalize', 'off');
  input.setAttribute('spellcheck', 'false');
  const btn = el('button', { class: opts.btnClass, type: 'button', text: 'Connect' }) as HTMLButtonElement;
  btn.style.marginTop = '0';
  const err = el('div', { style: 'font-size:12px;color:var(--red)' });
  const note = el('div', { style: 'font-size:12px;color:var(--text-dim)' });
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
  wrap.append(input, btn, err, note);
  return {
    el: wrap,
    setNote(text: string) {
      note.textContent = text;
    },
    /** While busy, the Connect button itself is the progress line (Gabe, 10/12). */
    setBusy(b: boolean, label = 'Opening Schoology…') {
      btn.disabled = b;
      input.disabled = b;
      btn.textContent = b ? label : 'Connect';
    },
  };
}
// #endregion
