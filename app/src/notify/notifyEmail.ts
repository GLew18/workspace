// Cobalt: where reminder emails go, when it is NOT the sign-in email (Gabe, 10/8/26).
//
// A student can send Cobalt's emails to another inbox, but only one they prove
// they own: the server mails a 6-digit code there and switches the address only
// when the code comes back (functions/index.js, requestNotifyEmail /
// confirmNotifyEmail). The proven address lives in Firestore notifyEmails/{uid},
// which this browser may READ but never write (firestore.rules), so the page
// cannot simply set an address. Unset = the sign-in email, as before.

import { firebaseConfig, hasFirebaseConfig } from '../firebase';

let chosen = ''; // the proven address, '' = use the sign-in email
const listeners = new Set<() => void>();

const notify = (): void => listeners.forEach((cb) => cb());

export function onNotifyEmailChange(cb: () => void): () => void {
  listeners.add(cb);
  return () => listeners.delete(cb);
}

/** The proven custom address, or '' when reminders go to the sign-in email. */
export const chosenNotifyEmail = (): string => chosen;

async function app() {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  return getApps().length ? getApp() : initializeApp(firebaseConfig);
}

/** Read the stored choice once at sign-in. Never throws. */
export async function loadNotifyEmail(uid: string): Promise<void> {
  chosen = '';
  if (!hasFirebaseConfig || !uid) return;
  try {
    const { getFirestore, doc, getDoc } = await import('firebase/firestore');
    const snap = await getDoc(doc(getFirestore(await app()), 'notifyEmails', uid));
    chosen = snap.exists() ? String(snap.data().email || '') : '';
  } catch {
    chosen = '';
  }
  notify();
}

async function call<T>(name: string, payload: Record<string, unknown>): Promise<T> {
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  try {
    return (await httpsCallable(getFunctions(await app(), 'us-central1'), name)(payload)).data as T;
  } catch (e) {
    const msg = (e as { message?: string }).message || '';
    throw new Error(msg && !/internal/i.test(msg) ? msg : 'Couldn’t reach Cobalt. Try again in a moment.');
  }
}

/** Mail a code to `email`. Resolves 'sent', or 'done' when `email` is the
 *  sign-in email (no proof needed: that just switches back). */
export async function requestNotifyEmail(email: string): Promise<'sent' | 'done'> {
  const r = await call<{ sent?: boolean; done?: boolean }>('requestNotifyEmail', { email });
  if (r.done) {
    chosen = '';
    notify();
    return 'done';
  }
  return 'sent';
}

/** Check the code. On success the new address is live everywhere at once. */
export async function confirmNotifyEmail(code: string): Promise<string> {
  const r = await call<{ email: string }>('confirmNotifyEmail', { code });
  chosen = r.email;
  notify();
  return r.email;
}

/** Back to the sign-in email. */
export async function clearNotifyEmail(): Promise<void> {
  await call('clearNotifyEmail', {});
  chosen = '';
  notify();
}
