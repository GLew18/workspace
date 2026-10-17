// Cobalt: the last gradebook read, kept on this device (Gabe, 10/16) so the Grades
// tab and the dashboard's "Recently Graded Courses" paint at once, before the slow
// Schoology read finishes. Written by the Grades view after every good read.

import type { GradesPayload } from './calc';

export const GRADES_CACHE_EVENT = 'cobalt:grades-cache';

const key = (uid: string): string => `ws:gradesCache:${uid}`;

export function readGradesCache(uid: string): GradesPayload | null {
  try {
    const raw = JSON.parse(localStorage.getItem(key(uid)) || 'null') as GradesPayload | null;
    return raw && Array.isArray(raw.courses) ? raw : null;
  } catch {
    return null;
  }
}

export function writeGradesCache(uid: string, p: GradesPayload): void {
  try {
    localStorage.setItem(key(uid), JSON.stringify(p));
  } catch {
    /* storage full or blocked: the next open just waits for the network */
  }
  window.dispatchEvent(new Event(GRADES_CACHE_EVENT));
}
