// Cobalt: the Suggestions box (top-bar 💡, next to the bell and the gear).
//
// PSEUDONYMOUS by design (Gabe, 8/13). The server discards name and email before
// the email is written, for two product reasons: a younger student should be able
// to say "this is confusing" without a classmate reading their name, and nobody
// should feel owed a personal reply.
//
// It is pseudonymous rather than anonymous because each message carries a stable
// 6-char fingerprint (see sendSuggestion), which is what lets one abusive sender be
// blocked without the rest of the box going down with them. The copy below is
// careful to claim only what the server actually does.
//
// The form is ONE box on purpose. Every category dropdown, title field and
// severity picker turns a ten-second thought into a chore, and the thing being
// collected is worth less than the friction of collecting it properly.

import { el, showToast, enterConfirms, fadeRemove } from './util/dom';
import { firebaseConfig, hasFirebaseConfig } from './firebase';

const MAX_CHARS = 2000;

/** Send the text. Resolves on success; throws a message worth showing on failure. */
async function submit(text: string, screen: string): Promise<void> {
  if (!hasFirebaseConfig) throw new Error('Suggestions need a connection. Try again later.');
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'sendSuggestion');
  try {
    await fn({ text, screen });
  } catch (err) {
    const code = (err as { code?: string }).code || '';
    // Always log the REAL code. Without this every failure looked identical from the
    // outside, and "Could not send that" sent us hunting the account and the network
    // when the actual answer was that the function had never been deployed (8/13).
    console.error('sendSuggestion failed:', code, (err as { message?: string }).message);
    // The server's own wording for the throttle cases is already student-facing.
    if (code.includes('resource-exhausted')) {
      throw new Error((err as { message?: string }).message || 'Try again a bit later.');
    }
    if (code.includes('unauthenticated')) throw new Error('Sign in first.');
    if (code.includes('unavailable')) throw new Error('Suggestions are paused right now.');
    // A MISSING callable does not surface as 'not-found' (tried that, 8/13). The 404
    // comes back without CORS headers, so the browser kills the preflight and the SDK
    // only ever sees 'internal'. Since a genuine server error looks identical, the
    // deploy hint is shown on localhost ONLY, where the reader is the developer.
    const dev = location.hostname === 'localhost' || location.hostname === '127.0.0.1';
    if (dev) {
      throw new Error('Send failed. If sendSuggestion isn’t deployed yet: firebase deploy --only functions');
    }
    throw new Error('Could not send that. Try again in a moment.');
  }
}

/** Open the box. `screen` is the tab the student was looking at, which rides along
 *  so a report about "the timer thing" arrives already knowing it was Focus. */
export function openSuggestionBox(screen = ''): void {
  // Shell: the shared bm-backdrop/bm-modal skin (ui/bookmarks.css), the same look
  // every other Cobalt form dialog uses (Gabe, 9/8: no dialog should look
  // one-off). Only the inside (sg-*) stays bespoke.
  const back = el('div', { class: 'bm-backdrop' });
  const box = el('div', { class: 'bm-modal sg-popup' });

  box.append(el('h3', { class: 'bm-modal-title', text: 'Suggestions and bug reports' }));

  const body = el('div', { class: 'popup-body' });

  // The ASK, as plain prose rather than a boxed callout. Its job is to raise the
  // quality of what gets typed: "what would you use it for and why does it matter"
  // is the difference between "add a weekly view" and a suggestion that can
  // actually be acted on.
  body.append(
    el('p', {
      class: 'sg-prompt',
      text: 'Anything that would make Cobalt better, big or small. If you are asking for a feature, it helps a lot to know when you would use it and what it would save you.',
    })
  );

  // A plain <textarea> carrying .ws-textbox, NOT textInput(). It still gets the
  // wrapping rule (that is what .ws-textbox provides: pre-wrap + overflow-wrap, so
  // text never runs off sideways), but not textInput's auto-grow, which writes an
  // INLINE height capped at 200px and flips overflow-y off that cap. Against a box
  // this size the two fought each other and produced a scrollbar on a nearly empty
  // field (Gabe, 8/13). Here the size is fixed by design, so CSS owns the height.
  const ta = el('textarea', {
    class: 'ws-textbox sg-input',
    rows: 6,
    // Shows the SHAPE of a useful answer instead of asking an open question the
    // student has to invent a format for.
    //
    // The example must be a REAL GAP. The first draft asked for a weekly view,
    // which the calendar already has (Gabe, 8/13), and an example the app already
    // does makes the whole box look like nobody uses it. Pushing a task to tomorrow
    // genuinely does not exist: changing a due date means opening the task and
    // editing the date field.
    placeholder: 'Like: let me push a task to tomorrow in one tap. I never finish everything in a night, and right now I have to open the task and retype the date.',
    maxlength: String(MAX_CHARS),
  }) as HTMLTextAreaElement;
  body.append(ta);

  // The note gets its OWN full-width line above the button row. Sharing one row with
  // the button squeezed it into a narrow column that wrapped to three lines and
  // pushed the card taller (Gabe, 8/13).
  //
  // The word "anonymous" is deliberately NOT used: it stopped being true when
  // messages started carrying a fingerprint, since that tag is stable and makes one
  // student's messages linkable to each other. What's left is literally true.
  body.append(
    el('div', {
      class: 'sg-note',
      text: 'Your name and email are not sent, and there is no reply.',
    })
  );

  // Only appears near the ceiling. A permanent counter is noise on a box nobody is
  // going to fill, but hitting an invisible wall at 2000 characters is worse.
  const count = el('span', { class: 'sg-count' });
  const cancel = el('button', { class: 'bm-btn', text: 'Cancel' });
  const send = el('button', { class: 'bm-btn bm-btn-primary sg-send', text: 'Send' }) as HTMLButtonElement;
  send.disabled = true;
  const close = () => fadeRemove(back);
  cancel.addEventListener('click', close);
  // Canon footer order (bm-modal-footer): left content, spacer, Cancel, primary.
  const footer = el('div', { class: 'bm-modal-footer' });
  footer.append(count, el('div', { class: 'bm-modal-spacer' }), cancel, send);

  ta.addEventListener('input', () => {
    const n = ta.value.trim().length;
    count.textContent = n > MAX_CHARS - 200 ? `${n}/${MAX_CHARS}` : '';
    send.disabled = n === 0;
  });

  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  // Escape closes, like every other bm-modal dialog (audit, 9/9/26: this box
  // was the one dialog that ignored it, even with the textarea focused).
  back.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') {
      e.stopPropagation();
      close();
    }
  });
  enterConfirms(back, () => (send.disabled ? null : send));

  send.addEventListener('click', () => {
    const text = ta.value.trim();
    if (!text) return;
    send.disabled = true;
    send.textContent = 'Sending…';
    void submit(text, screen)
      .then(() => {
        close();
        showToast('💡 Sent. Thank you.');
      })
      .catch((err: Error) => {
        send.disabled = false;
        send.textContent = 'Send';
        showToast(err.message);
      });
  });

  box.append(body, footer);
  back.append(box);
  document.body.append(back);
  ta.focus();
}
