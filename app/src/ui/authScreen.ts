// WorkSpace — sign-in screen (the "Try now" front door).
//
// A centered, WorkSpace-branded card (wordmark + email/password + Google), shown
// as an overlay over the landing page instead of signing the visitor in directly.
// Only two methods, by design: manual email/password and Continue with Google.
//
// On a successful sign-in the overlay removes itself; onAuthStateChanged (see
// main.ts) then swaps the landing for the app. The overlay lives on document.body,
// so it must tear itself down explicitly — a re-render of the app root wouldn't
// clear it.

import { el } from '../util/dom';
import { createWordmark } from './laurel';
import { signInWithGoogle, continueWithEmail } from '../auth';

// Google's "G" mark, inline so it needs no network (the CSP/offline-safe way).
const GOOGLE_G =
  '<svg viewBox="0 0 18 18" width="18" height="18" aria-hidden="true">' +
  '<path fill="#4285F4" d="M17.64 9.2c0-.64-.06-1.25-.16-1.84H9v3.48h4.84a4.14 4.14 0 0 1-1.8 2.72v2.26h2.92c1.7-1.57 2.68-3.88 2.68-6.62z"/>' +
  '<path fill="#34A853" d="M9 18c2.43 0 4.47-.8 5.96-2.18l-2.92-2.26c-.8.54-1.84.86-3.04.86-2.34 0-4.32-1.58-5.03-3.7H.96v2.33A9 9 0 0 0 9 18z"/>' +
  '<path fill="#FBBC05" d="M3.97 10.72a5.4 5.4 0 0 1 0-3.44V4.95H.96a9 9 0 0 0 0 8.1l3.01-2.33z"/>' +
  '<path fill="#EA4335" d="M9 3.58c1.32 0 2.5.45 3.44 1.35l2.58-2.58C13.47.9 11.43 0 9 0A9 9 0 0 0 .96 4.95l3.01 2.33C4.68 5.16 6.66 3.58 9 3.58z"/>' +
  '</svg>';

/** Show the sign-in overlay. Idempotent: a second call focuses the existing one. */
export function openAuthScreen(): void {
  if (document.querySelector('.auth-overlay')) {
    document.querySelector<HTMLInputElement>('.auth-input')?.focus();
    return;
  }

  const overlay = el('div', { class: 'auth-overlay' });
  const card = el('div', { class: 'auth-card' });

  const close = el('button', { class: 'auth-close', 'aria-label': 'Close', text: '✕' });
  const teardown = () => {
    document.removeEventListener('keydown', onKey);
    overlay.remove();
  };
  const onKey = (e: KeyboardEvent) => {
    if (e.key === 'Escape') teardown();
  };
  close.addEventListener('click', teardown);
  overlay.addEventListener('click', (e) => {
    if (e.target === overlay) teardown(); // click the dim backdrop to dismiss
  });
  document.addEventListener('keydown', onKey);

  // Brand: the real WorkSpace wordmark (the monitor-"o").
  const logo = el('div', { class: 'auth-logo' });
  logo.append(createWordmark().el);

  const title = el('h1', { class: 'auth-title', text: 'Log in or sign up' });

  // --- manual email + password -------------------------------------------
  // Native inputs here (not the wrapping textInput): auth fields need Enter-to-submit
  // and password masking, and they're short/single-line by nature.
  const form = el('form', { class: 'auth-form' }) as HTMLFormElement;
  const email = el('input', {
    type: 'email',
    class: 'auth-input',
    placeholder: 'you@email.com',
    autocomplete: 'email',
    inputmode: 'email',
  }) as HTMLInputElement;
  const password = el('input', {
    type: 'password',
    class: 'auth-input',
    placeholder: 'Password',
    autocomplete: 'current-password',
  }) as HTMLInputElement;
  const error = el('div', { class: 'auth-error' });
  const submit = el('button', { class: 'auth-continue', type: 'submit', text: 'Continue' }) as HTMLButtonElement;

  const setError = (msg: string) => {
    error.textContent = msg;
  };

  // A sign-in attempt is in flight → lock the buttons and show progress.
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
    setBusy(true, submit, 'Signing in…');
    continueWithEmail(mail, pass)
      .then(teardown) // success → onAuthStateChanged swaps in the app
      .catch((err: Error) => {
        setBusy(false, submit, 'Continue');
        setError(err.message);
      });
  });

  form.append(email, password, error, submit);

  // --- divider + Google ---------------------------------------------------
  const or = el('div', { class: 'auth-or' });
  or.append(el('span', { text: 'or' }));

  const googleBtn = el('button', { class: 'auth-google' }) as HTMLButtonElement;
  const gIcon = el('span', { class: 'auth-google-ico' });
  gIcon.innerHTML = GOOGLE_G;
  const gLabel = el('span', { text: 'Continue with Google' });
  googleBtn.append(gIcon, gLabel);
  googleBtn.addEventListener('click', () => {
    if (busy) return;
    setError('');
    setBusy(true, undefined);
    gLabel.textContent = 'Opening Google…';
    signInWithGoogle()
      .then(teardown)
      .catch((err: Error) => {
        setBusy(false);
        gLabel.textContent = 'Continue with Google';
        // A closed/cancelled popup isn't a real error — stay quiet for that one.
        const code = (err as unknown as { code?: string }).code || '';
        if (code !== 'auth/popup-closed-by-user' && code !== 'auth/cancelled-popup-request') {
          setError('Google sign-in failed. Please try again.');
        }
      });
  });

  card.append(close, logo, title, form, or, googleBtn);
  overlay.append(card);
  document.body.append(overlay);
  email.focus();
}
