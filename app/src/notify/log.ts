// Cobalt: the notification log (the 🔔 screen's data).
//
// Every notification Cobalt delivers is recorded here as ONE entry, whatever
// channels carried it. That single-entry rule is the whole point: a reminder sent
// as both a pop-up and an email is one event with two delivery routes, not two
// notifications — listing it twice with identical text would just be noise. The
// entry carries which routes fired, so the screen can say so in a line of icons.
//
// Storage is localStorage, matching the sent-ledger next door: notifications are a
// device-local thing (they fire from whichever device had Cobalt open), so a
// per-device history is the honest record, and it costs no cloud writes.

import { scopedKey } from '../util/userScope';
/** One delivered notification. */
export interface NotifyLogEntry {
  id: string;
  at: number; // epoch ms it was delivered
  title: string;
  body: string;
  popup: boolean; // shown as a system pop-up
  gmail: boolean; // sent to the account email
}

// Per-account (see util/userScope.ts). The log holds notification TITLES, which
// are task titles — one account must never read another's.
const LOG_KEY = () => scopedKey('notify:log:v1');
const SEEN_KEY = () => scopedKey('notify:log:seen:v1');
/** Keep the log bounded. Old entries fall off the end; nobody scrolls past ~200. */
const MAX_ENTRIES = 200;

/** Fired whenever the log or the seen-marker changes, so an open screen (and the
 *  bell's unread dot) repaint without polling. */
export const NOTIFY_LOG_EVENT = 'ws:notify-log-changed';

function read(): NotifyLogEntry[] {
  try {
    const raw = JSON.parse(localStorage.getItem(LOG_KEY()) || '[]');
    if (!Array.isArray(raw)) return [];
    // Tolerate anything malformed rather than throwing away the whole log.
    return raw.filter(
      (e): e is NotifyLogEntry =>
        !!e && typeof e === 'object' && typeof e.at === 'number' && typeof e.title === 'string'
    );
  } catch {
    return [];
  }
}

function write(list: NotifyLogEntry[]): void {
  try {
    localStorage.setItem(LOG_KEY(), JSON.stringify(list.slice(0, MAX_ENTRIES)));
  } catch {
    /* quota / private mode — the log is a nicety, never break delivery for it */
  }
  window.dispatchEvent(new CustomEvent(NOTIFY_LOG_EVENT));
}

/** Newest first. */
export function readNotifyLog(): NotifyLogEntry[] {
  return read().sort((a, b) => b.at - a.at);
}

/** Record a delivered notification. Called from sendNotification, which is the one
 *  place every notification in the app passes through, so nothing can slip by. */
export function logNotification(entry: Omit<NotifyLogEntry, 'id' | 'at'> & { at?: number }): void {
  const list = read();
  list.unshift({
    id: 'nl_' + Math.random().toString(36).slice(2, 10),
    at: entry.at ?? Date.now(),
    title: entry.title,
    body: entry.body,
    popup: !!entry.popup,
    gmail: !!entry.gmail,
  });
  write(list);
}

export function clearNotifyLog(): void {
  write([]);
}

/** Timestamp of the last time the log screen was opened (for the unread dot). */
function lastSeen(): number {
  const n = Number(localStorage.getItem(SEEN_KEY()) || 0);
  return Number.isFinite(n) ? n : 0;
}

/** How many entries arrived since the screen was last opened. Drives the bell's badge. */
export function unreadNotifyCount(): number {
  const since = lastSeen();
  return read().reduce((n, e) => n + (e.at > since ? 1 : 0), 0);
}

/** Mark everything read (the screen calls this when it opens). */
export function markNotifyLogSeen(): void {
  try {
    localStorage.setItem(SEEN_KEY(), String(Date.now()));
  } catch {
    /* ignore */
  }
  window.dispatchEvent(new CustomEvent(NOTIFY_LOG_EVENT));
}
