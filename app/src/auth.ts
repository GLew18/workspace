// WorkSpace — authentication.
//
// Firebase mode: Google sign-in (the only method in v1).
// Local mode (no Firebase config): a lightweight named profile so you can use
// the app immediately and verify per-user isolation with two profiles.

import { firebaseConfig, hasFirebaseConfig } from './firebase';

export interface AuthUser {
  uid: string;
  displayName: string;
  email: string;
}

type AuthCb = (user: AuthUser | null) => void;

export const isLocalMode = (): boolean => !hasFirebaseConfig;

const LOCAL_KEY = 'ws:localUser';

// ---- Local mode ----------------------------------------------------------

function readLocalUser(): AuthUser | null {
  try {
    return JSON.parse(localStorage.getItem(LOCAL_KEY) || 'null');
  } catch {
    return null;
  }
}

let localCb: AuthCb | null = null;

export function signInLocal(name: string): void {
  const clean = name.trim() || 'guest';
  const slug = clean.toLowerCase().replace(/[^a-z0-9]+/g, '-').replace(/^-|-$/g, '') || 'guest';
  const user: AuthUser = { uid: `local_${slug}`, displayName: clean, email: `${slug}@local` };
  localStorage.setItem(LOCAL_KEY, JSON.stringify(user));
  localCb?.(user);
}

// ---- Firebase mode -------------------------------------------------------

async function firebaseAuth() {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const auth = await import('firebase/auth');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return { auth, instance: auth.getAuth(app) };
}

export async function signInWithGoogle(): Promise<void> {
  if (isLocalMode()) throw new Error('Google sign-in requires Firebase config');
  const { auth, instance } = await firebaseAuth();
  const provider = new auth.GoogleAuthProvider();
  await auth.signInWithPopup(instance, provider);
}

/** Manual email + password — one unified "log in or sign up" action (matching the
 *  screen's title). We try to sign in first; if the account doesn't exist yet we
 *  create it. Firebase's email-enumeration protection collapses "no such user" and
 *  "wrong password" into one code, so we disambiguate on the create attempt: if the
 *  email is already in use, the password was simply wrong. Throws an Error whose
 *  message is safe to show the user. */
export async function continueWithEmail(email: string, password: string): Promise<void> {
  if (isLocalMode()) throw new Error('Email sign-in requires Firebase config');
  const mail = email.trim();
  const { auth, instance } = await firebaseAuth();
  try {
    await auth.signInWithEmailAndPassword(instance, mail, password);
    return;
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    // Existing account + right password already returned above. A credential error
    // here means either a new email or a wrong password — settle it by trying to
    // create the account.
    if (code === 'auth/user-not-found' || code === 'auth/invalid-credential' || code === 'auth/invalid-login-credentials') {
      try {
        await auth.createUserWithEmailAndPassword(instance, mail, password);
        return;
      } catch (err2) {
        const code2 = (err2 as { code?: string }).code || '';
        if (code2 === 'auth/email-already-in-use') throw new Error('Incorrect password for this email.');
        throw new Error(friendlyAuthError(code2));
      }
    }
    throw new Error(friendlyAuthError(code));
  }
}

/** Map a Firebase auth error code to a short, human sentence. */
function friendlyAuthError(code: string): string {
  switch (code) {
    case 'auth/invalid-email':
      return 'That doesn’t look like a valid email.';
    case 'auth/missing-password':
      return 'Enter a password.';
    case 'auth/weak-password':
      return 'Password must be at least 6 characters.';
    case 'auth/wrong-password':
      return 'Incorrect password for this email.';
    case 'auth/too-many-requests':
      return 'Too many attempts. Wait a moment and try again.';
    case 'auth/network-request-failed':
      return 'Network error. Check your connection and try again.';
    case 'auth/operation-not-allowed':
      return 'Email sign-in isn’t enabled yet. Turn on Email/Password in Firebase.';
    default:
      return 'Couldn’t sign in. Please try again.';
  }
}

// ---- Shared --------------------------------------------------------------

export async function signOut(): Promise<void> {
  if (isLocalMode()) {
    localStorage.removeItem(LOCAL_KEY);
    localCb?.(null);
    return;
  }
  const { auth, instance } = await firebaseAuth();
  await auth.signOut(instance);
}

/** Subscribe to auth state. Fires immediately with the current user (or null). */
export function onAuth(cb: AuthCb): void {
  if (isLocalMode()) {
    localCb = cb;
    cb(readLocalUser());
    return;
  }
  firebaseAuth().then(({ auth, instance }) => {
    auth.onAuthStateChanged(instance, (u) => {
      cb(
        u
          ? { uid: u.uid, displayName: u.displayName || 'Student', email: u.email || '' }
          : null
      );
    });
  });
}
