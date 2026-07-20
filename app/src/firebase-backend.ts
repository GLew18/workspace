// WorkSpace — Firebase Realtime Database backend.
//
// Mirrors the LocalBackend interface but reads/writes under users/{uid}/{collection}.
// Loaded lazily (dynamic import) so the local-only build never pulls in Firebase.

import type { Backend, Collection, Unsubscribe } from './backend';
import { firebaseConfig } from './firebase';

export async function createFirebaseBackend(uid: string): Promise<Backend> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getDatabase, ref, child, set, remove, get, onValue } = await import('firebase/database');

  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const dbRoot = getDatabase(app);
  const userRef = ref(dbRoot, `users/${uid}`);

  return {
    uid,
    subscribe<T>(c: Collection, cb: (value: Record<string, T>) => void): Unsubscribe {
      return onValue(child(userRef, c), (snap) => cb((snap.val() ?? {}) as Record<string, T>));
    },
    async set<T>(c: Collection, id: string, value: T): Promise<void> {
      await set(child(userRef, `${c}/${id}`), value);
    },
    async remove(c: Collection, id: string): Promise<void> {
      await remove(child(userRef, `${c}/${id}`));
    },
    async getAll<T>(c: Collection): Promise<Record<string, T>> {
      const snap = await get(child(userRef, c));
      return (snap.val() ?? {}) as Record<string, T>;
    },
  };
}
