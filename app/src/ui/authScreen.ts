// Cobalt: sign-in screen (the landing page's "Get started" / "Log in" door).
//
// Visually IDENTICAL to the final slide of the onboarding deck: big app mark, a
// white Google pill first, an "or" rule, then email + password and a gold pill.
// It is a full-screen takeover rather than a floating card — a bordered box over
// the landing read as a separate widget instead of the next step of the journey.
//
// Two modes on one screen. "Get started" opens SIGNUP, "Log in" opens LOGIN, and
// a footer link swaps between them, so neither audience is asked to pick a door
// before they see anything. Both call the same auth, and whether onboarding then
// runs is decided by the ACCOUNT's `onboarded` flag (see main.ts), never here.
//
// On success the overlay removes itself; onAuthStateChanged swaps in the app. It
// lives on document.body, so it must tear itself down explicitly.

import { el } from '../util/dom';
import { signInWithGoogle, signUpWithEmail, logInWithEmail, sendPasswordReset, AuthProblem } from '../auth';

export type AuthMode = 'signup' | 'login';

// Google's "G" mark, inline so it needs no network (the CSP/offline-safe way).
const GOOGLE_G =
  '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">' +
  '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
  '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
  '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>' +
  '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
  '</svg>';

/** Show the sign-in overlay. Idempotent: a second call focuses the existing one. */
export function openAuthScreen(mode: AuthMode = 'signup'): void {
  if (document.querySelector('.auth-overlay')) {
    document.querySelector<HTMLInputElement>('.auth-input')?.focus();
    return;
  }

  const overlay = el('div', { class: 'auth-overlay' });
  const card = el('div', { class: 'auth-card' });

  // The ✕ lives on the OVERLAY, not inside the card, for two reasons:
  //   1. .auth-card runs a transform animation (auth-rise), and a transformed
  //      ancestor becomes the containing block for position:fixed children. That
  //      made the ✕ render at the CARD's corner for 0.28s, then snap to the
  //      screen corner when the transform cleared. Parenting it to the untransformed
  //      overlay puts it in the screen corner from the first frame.
  //   2. render() calls card.replaceChildren() on every mode swap. Out here the
  //      button is built once and never torn down, so it cannot flicker.
  const close = el('button', { class: 'auth-close', 'aria-label': 'Close', text: '✕' });
  const teardown = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') teardown();
  };
  close.addEventListener('click', teardown);
  // NO backdrop click-to-dismiss, on purpose: this screen fills the window, so a
  // stray tap anywhere read as "go back to the landing page" and lost whatever
  // was typed. The ✕ (and Escape) are the only ways out.
  document.addEventListener('keydown', onKey);
  overlay.append(close);

  // The whole screen is rebuilt on a mode swap — simpler than toggling a dozen
  // strings, and it re-runs the entrance animation, which reads as intentional.
  // `carry` moves what the user already typed across a mode swap, plus an optional
  // explanation of why they were moved. Nothing they entered is ever cleared by a
  // swap: re-typing an email and password because you picked the wrong door is the
  // whole frustration this screen is meant to remove.
  const render = (m: AuthMode, carry?: { email?: string; password?: string; notice?: string }): void => {
    const isNew = m === 'signup';
    card.replaceChildren();

    const logo = el('img', {
      class: 'auth-logo',
      src: '/icons/icon.svg',
      alt: 'Cobalt',
    }) as HTMLImageElement;

    const title = el('h1', {
      class: 'auth-title',
      text: isNew ? 'Create your account' : 'Log in to Cobalt',
    });
    const sub = el('p', {
      class: 'auth-sub',
      text: isNew
        ? 'Your assignments, sorted by class, in one calm place.'
        : 'Welcome back. Everything is where you left it.',
    });

    // --- provider first ----------------------------------------------------
    const googleBtn = el('button', { class: 'auth-google' }) as HTMLButtonElement;
    const gIcon = el('span', { class: 'auth-google-ico' });
    gIcon.innerHTML = GOOGLE_G;
    const gLabel = el('span', { text: 'Continue with Google' });
    googleBtn.append(gIcon, gLabel);

    // The one thing worth saying before the buttons: Heschel's Google Workspace
    // blocks unreviewed third-party apps (verified 8/7/26, "Access blocked"), so
    // the school account dead-ends here. A personal account works fully, and the
    // same-account-every-time line heads off the "my stuff is gone" second
    // account: the data lives under whichever account signs in.
    const hint = el('p', {
      class: 'auth-hint',
      text: 'School Google accounts can be blocked by your school. Use a personal account, and always sign in with the same one.',
    });

    const or = el('div', { class: 'auth-or' });
    or.append(el('span', { text: 'or' }));

    // --- manual email + password -------------------------------------------
    // Native inputs (not the wrapping textInput): auth fields need Enter-to-submit
    // and password masking, and they're short and single-line by nature.
    const form = el('form', { class: 'auth-form' }) as HTMLFormElement;
    const email = el('input', {
      type: 'email',
      class: 'auth-input',
      placeholder: 'Email',
      autocomplete: 'email',
      inputmode: 'email',
    }) as HTMLInputElement;
    const password = el('input', {
      type: 'password',
      class: 'auth-input',
      placeholder: 'Password',
      autocomplete: isNew ? 'new-password' : 'current-password',
    }) as HTMLInputElement;
    // One line for both problems and explanations. `.info` recolors it gold: being
    // handed to the other door is not an error, and red would say it was.
    const error = el('div', { class: 'auth-error' });
    // gold-sheen = the periodic shine every primary gold button in the product wears.
    const submit = el('button', {
      class: 'auth-continue gold-sheen',
      type: 'submit',
      text: isNew ? 'Create account' : 'Log in',
    }) as HTMLButtonElement;

    const setError = (msg: string) => {
      error.textContent = msg;
      error.classList.remove('info');
    };
    const setNotice = (msg: string) => {
      error.textContent = msg;
      error.classList.add('info');
    };

    let busy = false;
    const setBusy = (on: boolean, activeBtn?: HTMLButtonElement, label?: string) => {
      busy = on;
      submit.disabled = on;
      googleBtn.disabled = on;
      if (activeBtn && label !== undefined) activeBtn.textContent = label;
    };

    form.addEventListener('submit', (e) => {
      e.preventDefault();
      if (busy) return;
      setError('');
      const mail = email.value.trim();
      const pass = password.value;
      if (!mail) return setError('Enter your email.');
      if (!pass) return setError('Enter a password.');
      setBusy(true, submit, isNew ? 'Creating account…' : 'Signing in…');
      // Each door does ONLY its own job: signup creates, login signs in. Neither
      // quietly does the other's.
      (isNew ? signUpWithEmail(mail, pass) : logInWithEmail(mail, pass))
        .then(teardown) // success → onAuthStateChanged swaps in the app
        .catch((err: Error) => {
          setBusy(false, submit, isNew ? 'Create account' : 'Log in');
          const kind = err instanceof AuthProblem ? err.kind : 'other';
          if (kind === 'account-exists') {
            // They already have an account. Move them to the login door with both
            // fields intact: right password = one click in, wrong password = they
            // are already standing next to "Forgot password?".
            render('login', { email: mail, password: pass, notice: err.message });
            return;
          }
          setError(err.message);
        });
    });
    form.append(email, password, error, submit);

    googleBtn.addEventListener('click', () => {
      if (busy) return;
      setError('');
      setBusy(true, undefined);
      gLabel.textContent = 'Heading to Google…';

      // FULL-PAGE redirect (Gabe, 8/13): the whole tab goes to Google and comes
      // back signed in, no popup window. That also retires the 8/8 COOP
      // stuck-button workaround that used to live here: there is no popup handle
      // to lose anymore. On success this page is navigating away, so the button
      // deliberately STAYS busy (re-enabling it would flash mid-departure) and no
      // teardown runs; the return trip lands via onAuthStateChanged in main.ts.
      // Only a failure to even START the redirect (offline, bad config) returns.
      signInWithGoogle().catch(() => {
        setBusy(false);
        gLabel.textContent = 'Continue with Google';
        setError('Google sign-in failed. Please try again.');
      });
    });

    // --- footer: swap modes, and the login-only reset link ------------------
    const foot = el('div', { class: 'auth-foot' });
    const swap = el('button', { text: isNew ? 'Log in' : 'Create an account' });
    // Carry the typing across, so switching doors never costs a retype.
    swap.addEventListener('click', () =>
      render(isNew ? 'login' : 'signup', { email: email.value, password: password.value })
    );
    foot.append(document.createTextNode(isNew ? 'Already have an account? ' : 'New here? '), swap);

    card.append(logo, title, sub, googleBtn, hint, or, form);
    if (!isNew) {
      const forgot = el('button', { class: 'auth-mini', text: 'Forgot password?' }) as HTMLButtonElement;
      // Narrates the actual steps instead of one canned line (Gabe, 8/8): sending →
      // sent, naming the address it went to and where to look, then a live cooldown
      // so "did it work?" never has to be guessed at.
      //
      // It still cannot say whether that address HAS an account — that would let
      // anyone test emails against the user list. "If that email has an account"
      // stays; everything around it got specific.
      let cooldown = 0;
      let timer = 0;
      const startCooldown = (): void => {
        cooldown = 30;
        forgot.disabled = true;
        const tick = (): void => {
          forgot.textContent = cooldown > 0 ? `Resend in ${cooldown}s` : 'Resend reset link';
          if (cooldown <= 0) {
            window.clearInterval(timer);
            forgot.disabled = false;
            return;
          }
          cooldown--;
        };
        tick();
        timer = window.setInterval(tick, 1000);
      };
      forgot.addEventListener('click', () => {
        const mail = email.value.trim();
        if (!mail) return setError('Enter your email above first.');
        forgot.disabled = true;
        forgot.textContent = 'Sending…';
        setNotice(`Sending a reset link to ${mail}…`);
        void sendPasswordReset(mail)
          .then(() => {
            setNotice(
              `Sent. If ${mail} has an account, the reset link is in that inbox now. ` +
                'It can take a minute, and it sometimes lands in spam.'
            );
            startCooldown();
          })
          .catch((err: Error) => {
            setError(err.message);
            forgot.disabled = false;
            forgot.textContent = 'Forgot password?';
          });
      });
      card.append(forgot);
    }
    card.append(foot);
    if (isNew) {
      card.append(
        el('div', {
          class: 'auth-legal',
          text: 'By continuing you agree to the Terms and Privacy Policy.',
        })
      );
    }
    // Restore what was typed before the swap, then explain the swap (if any) and
    // land the cursor where the user still has work to do.
    if (carry?.email) email.value = carry.email;
    if (carry?.password) password.value = carry.password;
    if (carry?.notice) setNotice(carry.notice);
    if (carry?.email && !carry.password) password.focus();
    else if (carry?.email) password.select();
    else email.focus();
  };

  render(mode);
  overlay.append(card);
  document.body.append(overlay);
}
