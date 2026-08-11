// Cobalt: push notifications (closed-app reminders) via Firebase Cloud Messaging.
//
// THE DIVISION OF LABOR:
//   • While Cobalt is OPEN, src/notify/scheduler.ts fires reminders locally.
//   • While it's CLOSED, the Cloud Function in app/functions/ sends the same
//     reminders through FCM → the service worker (public/sw.js 'push' handler)
//     shows them, and a click opens the app at /#tasks.
//
// This module's only job is ENROLLMENT: obtain this device's FCM token and store
// it at users/{uid}/profile/pushTokens so the Cloud Function can target it.
//
// It is a silent no-op unless ALL of these hold:
//   1. Firebase is configured (it is, in Firebase mode),
//   2. VITE_FIREBASE_VAPID_KEY is set in .env.local (Firebase Console → Project
//      settings → Cloud Messaging → Web Push certificates → generate key pair),
//   3. notification permission is granted (the Settings "Enable" click),
//   4. a service worker is registered — i.e. a PRODUCTION build (dev unregisters).

import type { Data } from '../db';
import { firebaseConfig, hasFirebaseConfig } from '../firebase';
import { NOTIFY_SETTINGS_EVENT } from './notify';

const VAPID_KEY = (import.meta.env.VITE_FIREBASE_VAPID_KEY as string | undefined) || '';

interface PushTokens {
  [token: string]: { updatedAt: string; ua: string };
}

let enrolled = false; // once per session is plenty — tokens are stable

export async function enablePush(data: Data): Promise<void> {
  // Retry enrollment when notification settings are saved (permission may have
  // just been granted by the Enable click). Registered once per app load.
  window.addEventListener(NOTIFY_SETTINGS_EVENT, () => void tryEnroll(data));
  await tryEnroll(data);
}

async function tryEnroll(data: Data): Promise<void> {
  if (enrolled) return;
  if (!hasFirebaseConfig || !VAPID_KEY) return; // push not configured yet — silent no-op
  if (!('Notification' in window) || Notification.permission !== 'granted') return;
  if (!('serviceWorker' in navigator) || !import.meta.env.PROD) return; // dev has no SW

  try {
    const { getMessaging, getToken, isSupported } = await import('firebase/messaging');
    if (!(await isSupported())) return;
    const { initializeApp, getApps, getApp } = await import('firebase/app');
    const app = getApps().length ? getApp() : initializeApp(firebaseConfig);

    const registration = await navigator.serviceWorker.ready;
    const token = await getToken(getMessaging(app), {
      vapidKey: VAPID_KEY,
      serviceWorkerRegistration: registration,
    });
    if (!token) return;

    // Read-merge-write: one profile entry holds every device's token.
    const existing = (await data.getProfile<PushTokens>('pushTokens')) ?? {};
    existing[token] = { updatedAt: new Date().toISOString(), ua: navigator.userAgent.slice(0, 120) };
    await data.setProfile('pushTokens', existing);
    enrolled = true;
  } catch {
    /* messaging unsupported / blocked — the open-app scheduler still works */
  }
}
