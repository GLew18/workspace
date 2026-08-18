// Cobalt: authentication.
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

/** Did the automatic verification email at sign-up fail to send? Read by the
 *  verify banner so it can tell the truth ("we couldn't send it") instead of
 *  telling a student to check an inbox nothing was sent to. Module-level on
 *  purpose: it only needs to survive until the banner mounts, moments later in
 *  the same page load, and a reload legitimately clears it — Resend is right
 *  there either way. */
let verifySendFailed = false;
export function verificationEmailFailed(): boolean {
  return verifySendFailed;
}

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
 * Send a Cobalt-branded auth email through the sendAuthEmail Cloud Function,
 * which generates the link and hands it to the same Trigger Email extension that
 * delivers reminders.
 *
 * Firebase's OWN mailer (sendPasswordResetEmail / sendEmailVerification) is a
 * shared, unbrandable sender whose mail was landing in spam. This route uses the
 * address students already see Cobalt mail from, and lets the message carry the
 * wordmark so it's recognizable at a glance.
 *
 * The function always reports success, even for an address with no account, so
 * this can never be used to test which emails are registered.
 */
async function callAuthEmail(email: string, kind: 'reset' | 'verify' | 'set'): Promise<void> {
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

/**
 * POPUP FIRST, REDIRECT AS THE FALLBACK (Gabe, 8/16: "signing in via google is
 * broken, just sends me right back to the landing page").
 *
 * That symptom is not a bug in this code — it is Chrome. `signInWithRedirect`
 * needs the auth handler's origin (workspace-67029.firebaseapp.com) to read its own
 * storage while the app is on a DIFFERENT origin (localhost, or the deployed site).
 * Chrome now partitions third-party storage, so the round trip completes, the
 * handler cannot hand the session back, getRedirectResult returns null, and the app
 * lands on the sign-in screen as if nothing happened. Firebase documents this and
 * names two fixes: use a popup, or serve the auth handler from your own origin.
 *
 * The popup is the one that needs no infrastructure. Its origin is a first party to
 * itself, so nothing is partitioned. Redirect stays as the fallback for the cases a
 * popup genuinely cannot serve — a blocker, or a browser without popup support —
 * where it still works because those are usually same-origin or non-Chrome.
 *
 * The old "stuck button" trouble came from holding the popup's window handle and
 * watching it; nothing here does that. The promise is the only thing awaited, and a
 * user who closes the window resolves it as a cancel rather than an error.
 */
export async function signInWithGoogle(): Promise<boolean> {
  if (isLocalMode()) throw new Error('Google sign-in requires Firebase config');
  const { auth, instance } = await firebaseAuth();
  const provider = new auth.GoogleAuthProvider();
  // Always show the chooser. Without this a second account can never be picked on a
  // shared computer — Google silently reuses the last one.
  provider.setCustomParameters({ prompt: 'select_account' });

  // FULL-PAGE WHEN IT CAN WORK, POPUP WHEN IT CANNOT — decided here, so the deploy
  // needs no code change (Gabe asked 8/16 whether deploying alone would bring the
  // full-screen sign-in back; on its own it would not have).
  //
  // The redirect only ever broke for ONE reason: the auth handler lives on
  // `authDomain`, and when that is a different origin from the app, the handshake's
  // storage is third-party and Chrome partitions it away. Same origin, no third
  // party, no partitioning, and the full-page trip Gabe preferred works again.
  //
  // So the moment `VITE_FIREBASE_AUTH_DOMAIN` points at the site's own domain —
  // which is the custom-domain step already on the deploy list — this flips itself.
  // Until then (localhost, or a deploy still using workspace-67029.firebaseapp.com)
  // it stays on the popup, because a redirect there would silently fail again.
  const sameOrigin = (() => {
    try {
      return new URL('https://' + String(firebaseConfig.authDomain)).host === location.host;
    } catch {
      return false;
    }
  })();
  if (sameOrigin) {
    await auth.signInWithRedirect(instance, provider);
    return false; // the page is leaving; onAuth picks the session up on the way back
  }

  try {
    await auth.signInWithPopup(instance, provider);
    return true; // SIGNED IN — the caller must now close the sign-in screen itself
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    // The student shut the window or clicked twice. Not a failure, and an error
    // message here would accuse them of something they did on purpose — but the
    // caller still has to un-stick its button, hence `false` rather than a throw.
    if (code.includes('popup-closed-by-user') || code.includes('cancelled-popup-request')) return false;
    // No popup available → the full-page trip. This page is about to leave, so the
    // answer never arrives; `false` keeps the type honest and nothing reads it.
    if (code.includes('popup-blocked') || code.includes('operation-not-supported')) {
      await auth.signInWithRedirect(instance, provider);
      return false;
    }
    throw err;
  }
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
      // Still not awaited (see above), but no longer SILENT. A swallowed failure
      // meant a student could be told "check your inbox for the link" when no
      // link was ever sent — and these were landing in spam until recently, so
      // that was not hypothetical. One retry absorbs a transient blip; if it
      // still fails we remember, and the banner says so instead of lying.
      verifySendFailed = false;
      const address = instance.currentUser.email.toLowerCase();
      void callAuthEmail(address, 'verify')
        .catch(() => callAuthEmail(address, 'verify')) // one retry
        .catch(() => {
          verifySendFailed = true;
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
  if (!u) return false;
  // RELOAD FIRST. `emailVerified` on the restored user is whatever was persisted
  // when the session was last written — it does NOT refresh on its own, not even
  // across a page load. So a student who clicked the link and then reloaded
  // Cobalt would keep seeing "verify your email" until something else happened
  // to call reload(). One cheap round-trip here makes the banner tell the truth
  // on first paint.
  try {
    await u.reload();
  } catch {
    /* offline — fall through and judge on what we last knew */
  }
  const fresh = instance.currentUser;
  if (!fresh || fresh.emailVerified) return false;
  return fresh.providerData.some((p) => p.providerId === 'password');
}

/** Ask for a password on an account that has NONE (after the Google merge deleted
 *  it, or a Google-only account adding one). Same Firebase action as a reset — it
 *  is the only "choose a password" flow there is — but the email says "Set a
 *  password" rather than "Reset", because there is nothing to reset. */
export async function sendSetPasswordEmail(email: string): Promise<void> {
  if (isLocalMode()) throw new AuthProblem('other', 'Setting a password requires Firebase config');
  await callAuthEmail(email.trim().toLowerCase(), 'set');
}

/** Does the signed-in account currently have an email/password sign-in method?
 *  Used to notice when Firebase's provider merge has DELETED one (see main.ts). */
export async function hasPasswordProvider(): Promise<boolean> {
  if (isLocalMode()) return false;
  const { instance } = await firebaseAuth();
  const u = instance.currentUser;
  return !!u?.providerData.some((p) => p.providerId === 'password');
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
    // Consume the pending Google-redirect result, if this page load IS the
    // return trip from the full-page sign-in. Success needs nothing from us
    // (onAuthStateChanged below fires with the user); this call exists because
    // redirect ERRORS are only observable here, and swallowing them silently
    // would make a failed sign-in look like the button did nothing.
    auth.getRedirectResult(instance).catch((err) => {
      console.warn('Google sign-in (redirect) failed:', (err as { code?: string }).code || err);
    });
    auth.onAuthStateChanged(instance, (u) => {
      cb(
        u
          ? { uid: u.uid, displayName: u.displayName || 'Student', email: u.email || '' }
          : null
      );
    });
  });
}
