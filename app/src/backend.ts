// WorkSpace — storage backend abstraction.
//
// The rest of the app talks to a `Backend`, never directly to Firebase or
// localStorage. This is the seam that lets Phase 0/1 run with NO backend
// (LocalBackend) and later swap in Firebase by changing only this file's wiring.

export type Collection = 'tasks' | 'focus' | 'profile' | 'meta';

export type Unsubscribe = () => void;

export interface Backend {
  /** Stable per-user id. */
  readonly uid: string;
  /** Live subscription to a collection; fires immediately with current value. */
  subscribe<T = unknown>(c: Collection, cb: (value: Record<string, T>) => void): Unsubscribe;
  /** Write a single child (scoped — never a whole-collection overwrite). */
  set<T = unknown>(c: Collection, id: string, value: T): Promise<void>;
  /** Remove a single child. */
  remove(c: Collection, id: string): Promise<void>;
  /** One-shot read of a whole collection. */
  getAll<T = unknown>(c: Collection): Promise<Record<string, T>>;
}

// ---------------------------------------------------------------------------
// Local backend: in-memory map mirrored to localStorage, keyed per uid.
// Subscriptions are notified synchronously on write so the UI stays live.
// ---------------------------------------------------------------------------

const lsKey = (uid: string, c: Collection) => `ws:${uid}:${c}`;

export class LocalBackend implements Backend {
  readonly uid: string;
  private cache: Record<Collection, Record<string, unknown>> = {
    tasks: {},
    focus: {},
    profile: {},
    meta: {},
  };
  private listeners: Partial<Record<Collection, Set<(v: Record<string, unknown>) => void>>> = {};

  constructor(uid: string) {
    this.uid = uid;
    (['tasks', 'focus', 'profile', 'meta'] as Collection[]).forEach((c) => {
      try {
        const raw = localStorage.getItem(lsKey(uid, c));
        if (raw) this.cache[c] = JSON.parse(raw);
      } catch {
        /* corrupt local data — start empty for this collection */
      }
    });
  }

  private persist(c: Collection) {
    try {
      localStorage.setItem(lsKey(this.uid, c), JSON.stringify(this.cache[c]));
    } catch {
      /* quota — backups module handles capping; ignore here */
    }
  }

  private emit(c: Collection) {
    this.listeners[c]?.forEach((cb) => cb({ ...this.cache[c] }));
  }

  subscribe<T>(c: Collection, cb: (value: Record<string, T>) => void): Unsubscribe {
    (this.listeners[c] ??= new Set()).add(cb as (v: Record<string, unknown>) => void);
    cb({ ...this.cache[c] } as Record<string, T>);
    return () => this.listeners[c]?.delete(cb as (v: Record<string, unknown>) => void);
  }

  async set<T>(c: Collection, id: string, value: T): Promise<void> {
    this.cache[c][id] = value;
    this.persist(c);
    this.emit(c);
  }

  async remove(c: Collection, id: string): Promise<void> {
    delete this.cache[c][id];
    this.persist(c);
    this.emit(c);
  }

  async getAll<T>(c: Collection): Promise<Record<string, T>> {
    return { ...this.cache[c] } as Record<string, T>;
  }
}
