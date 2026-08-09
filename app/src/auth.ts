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

// NOTE: a "?tab=<label>" per-tab session mode used to live here, to allow two
// accounts side by side while testing the extension. Removed (Gabe, 8/7): tabs on
// one origin kept following each other in practice, and an incognito window gives
// genuinely separate storage with none of the code. Sign-in is shared by every tab
// again, which is the ordinary, expected behavior.

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

/**
 * Send a WorkSpace-branded auth email through the sendAuthEmail Cloud Function,
 * which generates the link and hands it to the same Trigger Email extension that
 * delivers reminders.
 *
 * Firebase's OWN mailer (sendPasswordResetEmail / sendEmailVerification) is a
 * shared, unbrandable sender whose mail was landing in spam. This route uses the
 * address students already see WorkSpace mail from, and lets the message carry the
 * wordmark so it's recognizable at a glance.
 *
 * The function always reports success, even for an address with no account, so
 * this can never be used to test which emails are registered.
 */
async function callAuthEmail(email: string, kind: 'reset' | 'verify'): Promise<void> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'sendAuthEmail');
  try {
    await fn({ email, kind });
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    const msg = (err as { message?: string }).message || '';
    if (code.includes('resource-exhausted')) {
      throw new AuthProblem('other', 'Just sent one. Check your inbox, then try again in a minute.');
    }
    if (code.includes('invalid-argument')) {
      throw new AuthProblem('other', 'That doesn’t look like a valid email.');
    }
    throw new AuthProblem('other', msg || 'Couldn’t send that email. Try again in a moment.');
  }
}

export async function signInWithGoogle(): Promise<void> {
  if (isLocalMode()) throw new Error('Google sign-in requires Firebase config');
  const { auth, instance } = await firebaseAuth();
  const provider = new auth.GoogleAuthProvider();
  await auth.signInWithPopup(instance, provider);
}

/**
 * The two doors do exactly what they say (per Gabe). Previously ONE function ran
 * sign-in-then-create for both, so "Get started" could silently log an existing
 * user in and "Log in" could silently create an account. The screen offered a
 * choice the logic ignored.
 *
 * A failure carries a `kind` so the screen can do the right thing rather than just
 * printing a sentence: 'account-exists' means hand them to the login door with
 * their typing intact, 'no-account' means offer the signup door.
 */
export type AuthProblemKind = 'account-exists' | 'no-account' | 'other';

export class AuthProblem extends Error {
  readonly kind: AuthProblemKind;
  constructor(kind: AuthProblemKind, message: string) {
    super(message);
    this.name = 'AuthProblem';
    this.kind = kind;
  }
}

/** The SIGN-UP door: creates the account, never signs anyone in. */
export async function signUpWithEmail(email: string, password: string): Promise<void> {
  if (isLocalMode()) throw new AuthProblem('other', 'Email sign-up requires Firebase config');
  const mail = email.trim();
  const { auth, instance } = await firebaseAuth();
  try {
    await auth.createUserWithEmailAndPassword(instance, mail, password);
    // Verify the address, or this password is living on borrowed time.
    //
    // Firebase keeps ONE account per email and treats an email provider as
    // authoritative for its own domain. So the first time this student clicks
    // "Continue with Google" on the same address, Google's claim outranks an
    // UNVERIFIED password and Firebase silently drops the password credential:
    // their data is untouched, but the password they'd been using stops working
    // with no explanation. (That rule exists for a good reason: without it,
    // anyone could pre-register a password on someone else's email and keep
    // access after the real owner signed in with Google.)
    //
    // Verification is what makes the password outrank the merge, so both methods
    // survive. Best-effort: a send failure must never fail an account that was
    // just created successfully.
    // Fire-and-forget, deliberately NOT awaited: createUserWithEmailAndPassword
    // has already signed them in, so awaiting an email round-trip here would just
    // hold the sign-up screen open for no reason. A failure is caught and ignored
    // (the in-app nudge can resend later); it must never fail a created account.
    if (instance.currentUser?.email) {
      void callAuthEmail(instance.currentUser.email.toLowerCase(), 'verify').catch(() => {
        /* offline / rate-limited — the nudge still offers Resend */
      });
    }
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    if (code === 'auth/email-already-in-use') {
      throw new AuthProblem('account-exists', 'You already have an account with this email. Log in to continue.');
    }
    throw new AuthProblem('other', friendlyAuthError(code));
  }
}

/** The LOG-IN door: signs in, never creates anything. */
export async function logInWithEmail(email: string, password: string): Promise<void> {
  if (isLocalMode()) throw new AuthProblem('other', 'Email sign-in requires Firebase config');
  const mail = email.trim();
  const { auth, instance } = await firebaseAuth();
  try {
    await auth.signInWithEmailAndPassword(instance, mail, password);
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    // Firebase's enumeration protection folds every failure into one code on
    // purpose, and the API that could tell us which methods an email has
    // (fetchSignInMethodsForEmail) was deprecated for the same reason. So we
    // cannot know which of THREE things happened, and the message names all
    // three. The third matters most: someone who signed up with Google has no
    // password to "check", and telling them to make an account would be wrong.
    if (
      code === 'auth/user-not-found' ||
      code === 'auth/wrong-password' ||
      code === 'auth/invalid-credential' ||
      code === 'auth/invalid-login-credentials'
    ) {
      throw new AuthProblem(
        'no-account',
        'We couldn’t sign you in. Check your password, try Continue with Google above, or create an account if you’re new.'
      );
    }
    throw new AuthProblem('other', friendlyAuthError(code));
  }
}

/**
 * Does the signed-in account have an unverified PASSWORD credential?
 *
 * Only password accounts are at risk from the merge described in signUpWithEmail:
 * a Google-only account has nothing to lose, and its `emailVerified` may be false
 * for unrelated reasons. So this asks two questions, not one.
 */
export async function needsEmailVerification(): Promise<boolean> {
  if (isLocalMode()) return false;
  const { instance } = await firebaseAuth();
  const u = instance.currentUser;
  if (!u || u.emailVerified) return false;
  return u.providerData.some((p) => p.providerId === 'password');
}

/** Re-send the verification email to the signed-in user. */
export async function resendEmailVerification(): Promise<void> {
  if (isLocalMode()) return;
  const { instance } = await firebaseAuth();
  const user = instance.currentUser;
  if (!user?.email) throw new AuthProblem('other', 'You’re signed out.');
  await callAuthEmail(user.email.toLowerCase(), 'verify');
}


/** Ask Firebase for fresh user state — the ONLY way to notice that the student
 *  clicked the link in another tab, since emailVerified is cached in this one. */
export async function refreshVerificationState(): Promise<boolean> {
  if (isLocalMode()) return true;
  const { instance } = await firebaseAuth();
  const u = instance.currentUser;
  if (!u) return false;
  try {
    await u.reload();
  } catch {
    /* offline: report what we last knew */
  }
  return !!instance.currentUser?.emailVerified;
}

/** Send a real reset email. Firebase's enumeration protection means this resolves
 *  the same way whether or not the address has an account, so the caller shows one
 *  message either way (which is also what OWASP recommends). */
export async function sendPasswordReset(email: string): Promise<void> {
  if (isLocalMode()) throw new AuthProblem('other', 'Password reset requires Firebase config');
  // Branded, via our own sender (see callAuthEmail) — not Firebase's default mailer.
  await callAuthEmail(email.trim().toLowerCase(), 'reset');
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
