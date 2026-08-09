// WorkSpace — per-account scoping for browser storage.
//
// THE RULE (Gabe, 8/9/26): anything peculiar to ONE account — tasks, bookmarks,
// settings, focus sessions, notifications and their read state — must only be
// reachable while THAT account is signed in. Two accounts sharing a browser must
// never see each other's anything.
//
// This needs saying out loud because localStorage is scoped to the ORIGIN, not to
// the user. A key without a uid in it is silently shared by every account that
// ever signs in on this machine, and nothing warns you. That is not hypothetical:
// the focus session used one global key, so signing out of one account and into
// another offered the second account a "Restore" for the first account's session,
// task titles included.
//
// So: route every per-account key through scopedKey(). The uid is appended, which
// makes cross-account collision impossible by construction rather than by everyone
// remembering to be careful.
//
// THE DELIBERATE EXCEPTION — device preferences. Panel sizes (util/resize.ts), the
// mini-player position, the installed extension's id: these describe the MACHINE,
// not the person. They are meant to be shared by whoever sits down at it, so they
// stay global. The test is simple: "would it be wrong for another account to see
// this?" Data → yes, scope it. Ergonomics → no, leave it.

/** The signed-in uid. Empty before sign-in, which is safe: a real uid is never
 *  empty, so the pre-sign-in namespace can't collide with an account's. */
let currentUid = '';

/**
 * Bind storage to an account. Call ONCE per sign-in, before anything reads or
 * writes per-account state (main.ts does this the moment it has a user).
 *
 * `legacyKeys` are pre-scoping global keys to delete. They are DROPPED, never
 * migrated: migrating would hand one account's data to whoever happens to sign in
 * first, which is the exact bug this exists to prevent.
 */
export function setStorageUser(uid: string, legacyKeys: string[] = []): void {
  currentUid = uid || '';
  for (const k of legacyKeys) {
    try {
      localStorage.removeItem(k);
      sessionStorage.removeItem(k);
    } catch {
      /* private mode — then there was nothing stored to leak anyway */
    }
  }
}

/** `base` namespaced to the signed-in account. Use for EVERY per-account key. */
export function scopedKey(base: string): string {
  return `${base}:${currentUid}`;
}
