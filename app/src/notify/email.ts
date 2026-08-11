// Cobalt: email mirror via the Firestore "Trigger Email" extension.
//
// Desktop notifications are device-local. When the user turns on "also email me",
// each notification is ALSO queued as an email — the official way: write a doc to
// the `mail` collection in Cloud Firestore, which the "Trigger Email from Firestore"
// extension picks up and delivers through the configured SMTP / SendGrid sender.
//
// NOTE: the app's own data lives in the Realtime Database; this is the ONE place
// that touches Cloud Firestore, initialized lazily on the SAME Firebase app so the
// firestore SDK is only pulled in the first time an email is actually queued.
//
// ONE-TIME SETUP (Firebase console — until it's done, these writes sit unread and
// nothing is emailed, harmlessly):
//   1. Enable Cloud Firestore on the project.
//   2. Install the "Trigger Email from Firestore" extension; set its mail
//      collection to `mail` and connect an SMTP / SendGrid sender + a "from" address.
//   3. Firestore security rules: allow authenticated users to CREATE docs in `mail`.

import { hasFirebaseConfig, firebaseConfig } from '../firebase';
import { escapeHtml } from '../util/dom';

const MAIL_COLLECTION = 'mail';

async function mailApi() {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFirestore, collection, addDoc } = await import('firebase/firestore');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  return { db: getFirestore(app), collection, addDoc };
}

/** Queue one email through the Trigger Email extension. Best-effort: never throws
 *  (a failed queue must not break the desktop-notification path). No-op when
 *  Firebase isn't configured (local mode) or no recipient is given. */
export async function queueEmail(to: string, subject: string, body: string): Promise<void> {
  if (!hasFirebaseConfig || !to) return;
  try {
    const { db, collection, addDoc } = await mailApi();
    const html =
      `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#212c42;line-height:1.5">` +
      `<p style="margin:0 0 6px;font-weight:600;font-size:16px">${escapeHtml(subject)}</p>` +
      `<p style="margin:0;color:#4a5568">${escapeHtml(body)}</p>` +
      `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Sent by Cobalt · manage in Settings ▸ Notifications</p>` +
      `</div>`;
    await addDoc(collection(db, MAIL_COLLECTION), {
      to: [to],
      message: { subject, text: body, html },
    });
  } catch {
    /* offline / rules / extension not installed — silently ignore */
  }
}
