// Cobalt: the student's class schedule, read from their own Google Calendar.
//
// THE SOURCE (Gabe, 10/5/26). Heschel publishes every student's timetable to a
// Google Calendar the student owns (<name>.<classyear>@heschel.org). It is not
// public, but Google offers each owner a "Secret address in iCal format" for it,
// and that feed carries everything the dashboard needs: every block of every day,
// with the exact course name, room and teacher(s). Verified against Gabe's feed:
//
//   SUMMARY      "HS P5: Honors Algebra 2/Trig"      period + exact course name
//   LOCATION     "20-203", "20-HS Gym - 4th Fl", "NOROOM"
//   DESCRIPTION  "Teacher(s): Farhadian\, Farah"     several teachers on new lines
//   DTSTART/END  UTC ("…Z"), one event per block, NO recurrence rules
//
// The period order rotates by day, so the feed is the truth for each date and
// nothing here ever computes a rotation. The full plan lives in the vault note
// "Cobalt Calendars Plan".
//
// THE SECRET ADDRESS IS A PASSWORD: anyone holding it can read the calendar. It
// is stored on the account's own profile only, never logged, never shown back in
// full.

import type { Data } from '../db';
import { scopedKey } from '../util/userScope';

// #region Types -------------------------------------------------------------

/** One block of the school day. */
export interface ScheduleBlock {
  start: number; // epoch ms
  end: number; // epoch ms
  /** "P5" when the block is a numbered period, else ''. */
  period: string;
  /** What the block is: the course name for a class ("Honors Algebra 2/Trig"),
   *  else the block's own name ("Tefillah", "Lunch", "Test Period"). */
  name: string;
  /** Extra label a non-class block carries ("Orthodox Minyan"), else ''. */
  detail: string;
  room: string; // '' when the feed has none
  teachers: string[]; // "First Last", in feed order
  /** A real course (gets the course's color). False for Lunch, Tefillah, etc.,
   *  which all share one neutral color (Gabe, 10/5). */
  isClass: boolean;
}

/** profile/scheduleFeed */
export interface ScheduleFeed {
  url: string;
}
export const SCHEDULE_FEED_KEY = 'scheduleFeed';

// #endregion

// #region Link check ----------------------------------------------------------

/**
 * Is this a Google Calendar iCal feed address? Accepts the secret address
 * (…/private-<hex>/basic.ics) and the public one (…/public/basic.ics). The
 * Cloud Function runs the same check (functions/index.js) before fetching.
 */
export function isGoogleCalendarIcalUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim().replace(/^webcal:/i, 'https:'));
    return (
      (u.protocol === 'https:' || u.protocol === 'http:') &&
      u.hostname.toLowerCase() === 'calendar.google.com' &&
      /^\/calendar\/ical\/[^/]+\/(private-[0-9a-f]+|public)\/basic\.ics$/i.test(u.pathname)
    );
  } catch {
    return false;
  }
}

/**
 * Where "Open in Google Calendar" goes (Gabe, 10/7): the EXACT calendar on the
 * EXACT day, the way a task's ↗ lands on its exact Schoology page. The secret
 * address names the calendar (…/calendar/ical/<calendar id>/private-…/basic.ics),
 * and Google's single-calendar view takes that id plus a day. It is read-only,
 * and it shows a private calendar only to a browser signed in to an account
 * that can see it, which the student's is. Falls back to the account's day view
 * when the id cannot be read out of the address.
 */
export function calendarDayUrl(feedUrl: string, date: string): string {
  const [y, m, d] = date.split('-');
  const ymd = `${y}${m}${d}`;
  const id = /\/calendar\/ical\/([^/]+)\//i.exec(feedUrl)?.[1];
  if (!id) return `https://calendar.google.com/calendar/u/0/r/day/${y}/${Number(m)}/${Number(d)}`;
  let tz = '';
  try {
    tz = Intl.DateTimeFormat().resolvedOptions().timeZone || '';
  } catch {
    /* no zone: Google uses the calendar's own */
  }
  const q = new URLSearchParams({ src: decodeURIComponent(id), mode: 'DAY', dates: `${ymd}/${ymd}` });
  if (tz) q.set('ctz', tz);
  return `https://calendar.google.com/calendar/u/0/embed?${q.toString()}`;
}

/** The pasted address as the https URL every fetch uses. */
export const normalizeFeedUrl = (raw: string): string =>
  raw.trim().replace(/^webcal:\/\//i, 'https://').replace(/^http:\/\//i, 'https://');

// #endregion

// #region Fetch ---------------------------------------------------------------

/** The dev server proxies /gcal to calendar.google.com (vite.config.ts). */
const onDevProxy = (): boolean => location.hostname === 'localhost' || location.hostname === '127.0.0.1';

/**
 * Download the feed. Google sends no CORS header, so a deployed page cannot read
 * it directly: it goes through the same Cloud Function the Schoology feed uses
 * (fetchSchoologyIcal, which accepts Google Calendar feed addresses too).
 * Throws a sentence a student can read.
 */
export async function fetchScheduleIcs(rawUrl: string): Promise<string> {
  const url = normalizeFeedUrl(rawUrl);
  let text = '';
  let status = 200;
  try {
    if (onDevProxy()) {
      const res = await fetch('/gcal' + new URL(url).pathname);
      status = res.status;
      text = res.ok ? await res.text() : '';
    } else {
      const { initializeApp, getApps, getApp } = await import('firebase/app');
      const { getFunctions, httpsCallable } = await import('firebase/functions');
      const { firebaseConfig } = await import('../firebase');
      const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
      const fn = httpsCallable(getFunctions(app, 'us-central1'), 'fetchSchoologyIcal');
      const r = (await fn({ url })).data as { ok: boolean; status: number; text: string };
      status = r.status;
      text = r.ok ? r.text : '';
    }
  } catch (err) {
    const msg = (err as { message?: string }).message || '';
    throw new Error(msg && !/internal/i.test(msg) ? msg : 'Couldn’t reach Google Calendar. Check your connection.');
  }
  // Google answers a wrong or reset secret address with a 404 page.
  if (status === 404) throw new Error('Google doesn’t recognize that address. It may have been reset: copy it again.');
  if (!text) throw new Error(`Google Calendar returned an error (${status}).`);
  if (!/BEGIN:VCALENDAR/i.test(text)) throw new Error('That link isn’t a calendar feed.');
  return text;
}

// #endregion

// #region Parse ---------------------------------------------------------------

const unfold = (s: string): string => s.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '');
const unescape = (s: string): string =>
  s.replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\');

/** A property's value, ignoring its parameters (DTSTART;TZID=…:value). */
function prop(block: string, name: string): string {
  const m = block.match(new RegExp(`^${name}(?:;[^:\\r\\n]*)?:(.*)$`, 'm'));
  return m ? m[1].trim() : '';
}

/** "20261005T164700Z" → epoch ms. A floating or TZID time is read as local time,
 *  which is right for a student in their school's timezone. All-day (date-only)
 *  values return NaN: a whole-day event is not a block of the school day. */
function parseTime(v: string): number {
  const m = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z?)$/);
  if (!m) return NaN;
  const [, y, mo, d, h, mi, s, z] = m;
  return z
    ? Date.UTC(+y, +mo - 1, +d, +h, +mi, +s)
    : new Date(+y, +mo - 1, +d, +h, +mi, +s).getTime();
}

/** Blocks that are on the schedule but are not courses. Matched on the name. */
const NON_CLASS_RE =
  /^(lunch|test period|free|study hall|advisory|tefillah|mincha|clubs?|hachana|programming|assembly|recess|break)\b|\b(community|office hours)\b/i;

/** "Kapustin, Natan" → "Natan Kapustin". */
const flipName = (n: string): string => {
  const [last, first] = n.split(',').map((x) => x.trim());
  return first ? `${first} ${last}` : last;
};

/** Parse a whole feed into blocks, oldest first. Cancelled events are dropped. */
export function parseScheduleIcs(ics: string): ScheduleBlock[] {
  const out: ScheduleBlock[] = [];
  for (const raw of unfold(ics).split('BEGIN:VEVENT').slice(1)) {
    const block = raw.split('END:VEVENT')[0];
    if (/^STATUS:CANCELLED/im.test(block)) continue;
    const start = parseTime(prop(block, 'DTSTART'));
    const end = parseTime(prop(block, 'DTEND'));
    if (!Number.isFinite(start) || !Number.isFinite(end)) continue;

    // "HS P5: Honors Algebra 2/Trig" | "HS Tefillah: Orthodox Minyan" | "HS Mincha: HS Mincha"
    const summary = unescape(prop(block, 'SUMMARY')).replace(/^HS\s+/i, '').trim();
    if (!summary) continue;
    let period = '';
    let name = summary;
    let detail = '';
    const pm = summary.match(/^P(\d+)\s*:\s*(.+)$/i);
    if (pm) {
      period = `P${pm[1]}`;
      name = pm[2].trim();
    } else {
      const i = summary.indexOf(':');
      if (i > 0) {
        name = summary.slice(0, i).trim();
        const rest = summary.slice(i + 1).trim().replace(/^HS\s+/i, '');
        if (rest.toLowerCase() !== name.toLowerCase()) detail = rest;
      }
    }
    // "Lunch 9": the trailing grade number says nothing the student doesn't know.
    if (/^lunch\b/i.test(name)) name = 'Lunch';

    const loc = unescape(prop(block, 'LOCATION'));
    const room = /^noroom$/i.test(loc) ? '' : loc.replace(/^\d+-/, '').trim();
    const teachers = unescape(prop(block, 'DESCRIPTION'))
      .replace(/^Teacher\(s\):\s*/i, '')
      .split('\n')
      .map((t) => t.trim())
      .filter(Boolean)
      .map(flipName);

    out.push({ start, end, period, name, detail, room, teachers, isClass: !!period && !NON_CLASS_RE.test(name) });
  }
  return out.sort((a, b) => a.start - b.start);
}

/** Local 'YYYY-MM-DD' of an instant. */
export const dayOf = (ms: number): string => {
  const d = new Date(ms);
  return `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}-${String(d.getDate()).padStart(2, '0')}`;
};

/** The distinct courses the student is taking now: class blocks from 30 days
 *  back to 60 ahead, so a course that ended last semester is not offered. */
export function currentCourses(blocks: ScheduleBlock[], now = Date.now()): string[] {
  const from = now - 30 * 86_400_000;
  const to = now + 60 * 86_400_000;
  const names = blocks.filter((b) => b.isClass && b.start >= from && b.start <= to).map((b) => b.name);
  return [...new Set(names)];
}

// #endregion

// #region Cache ---------------------------------------------------------------
//
// A year of blocks is ~730 KB of feed. The dashboard only ever shows one day, so
// the cache keeps yesterday through five weeks out, refreshed when older than
// REFRESH_MS. It lives in browser storage (per account), not the profile: it is a
// copy of Google's data, re-fetchable at any time, and reading it must be instant.

const CACHE_KEY = () => scopedKey('schedule:feed:v1');
const REFRESH_MS = 6 * 60 * 60 * 1000;
const WINDOW_DAYS = 35;

interface Cache {
  url: string;
  fetchedAt: number;
  blocks: ScheduleBlock[];
}

export function readCache(url: string): Cache | null {
  try {
    const c = JSON.parse(localStorage.getItem(CACHE_KEY()) || 'null') as Cache | null;
    return c && c.url === url && Array.isArray(c.blocks) ? c : null;
  } catch {
    return null;
  }
}

function writeCache(url: string, all: ScheduleBlock[]): Cache {
  const from = Date.now() - 86_400_000;
  const to = Date.now() + WINDOW_DAYS * 86_400_000;
  const c: Cache = { url, fetchedAt: Date.now(), blocks: all.filter((b) => b.end >= from && b.start <= to) };
  try {
    localStorage.setItem(CACHE_KEY(), JSON.stringify(c));
  } catch {
    /* quota: the card simply refetches next time */
  }
  return c;
}

export function clearCache(): void {
  try {
    localStorage.removeItem(CACHE_KEY());
  } catch {
    /* nothing to clear */
  }
}

/** Fetch, parse and cache. Returns the cached window. */
export async function refreshFeed(url: string): Promise<ScheduleBlock[]> {
  return writeCache(url, parseScheduleIcs(await fetchScheduleIcs(url))).blocks;
}

/** The cached window, refreshed first when stale. Never throws: a failed
 *  refresh falls back to whatever is cached (null when nothing is). */
export async function loadBlocks(url: string, force = false): Promise<{ blocks: ScheduleBlock[] | null; error: string }> {
  const c = readCache(url);
  if (c && !force && Date.now() - c.fetchedAt < REFRESH_MS) return { blocks: c.blocks, error: '' };
  try {
    return { blocks: await refreshFeed(url), error: '' };
  } catch (e) {
    return { blocks: c?.blocks ?? null, error: e instanceof Error ? e.message : 'Couldn’t load your schedule.' };
  }
}

/** The day the card shows: today while any block is still ahead, otherwise the
 *  next day that has blocks (weekends and after school show the next school day). */
export function dayToShow(blocks: ScheduleBlock[], now = Date.now()): { date: string; blocks: ScheduleBlock[] } | null {
  const today = dayOf(now);
  const todays = blocks.filter((b) => dayOf(b.start) === today);
  if (todays.some((b) => b.end > now)) return { date: today, blocks: todays };
  const next = blocks.find((b) => b.start > now && dayOf(b.start) !== today);
  if (!next) return null;
  const date = dayOf(next.start);
  return { date, blocks: blocks.filter((b) => dayOf(b.start) === date) };
}

// #endregion

// #region Profile -------------------------------------------------------------

export async function getFeed(data: Data): Promise<ScheduleFeed | null> {
  const f = await data.getProfile<ScheduleFeed>(SCHEDULE_FEED_KEY);
  return f?.url ? f : null;
}

/** Fired on window after saveFeed, so the dashboard card repaints when the link
 *  is changed or removed from Settings (Gabe, 10/7). */
export const FEED_EVENT = 'cobalt:schedule-feed';

export async function saveFeed(data: Data, url: string | null): Promise<void> {
  if (!url) clearCache();
  await data.setProfile(SCHEDULE_FEED_KEY, { url: url ? normalizeFeedUrl(url) : '' });
  window.dispatchEvent(new Event(FEED_EVENT));
}

// #endregion
