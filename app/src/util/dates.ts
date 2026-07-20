// WorkSpace — date/time helpers (verbatim behavior from spec §9.5).
// All dates are handled as LOCAL 'YYYY-MM-DD' strings. To build a Date from one
// without a timezone day-shift, append 'T12:00:00'.

import { getPrefs } from '../prefs';

/** Format a "HH:MM" (24-hour) time-of-day string per the user's Time-format pref
 *  (Settings → Profile). 12h → "3pm" / "3:30pm"; 24h → "15:00". The single source
 *  of truth for how due times, sync, and Focus render the clock. */
export function formatTimeOfDay(hhmm: string): string {
  const [h, m] = hhmm.split(':').map(Number);
  if (getPrefs().timeFormat === '24h') {
    return `${String(h).padStart(2, '0')}:${String(m).padStart(2, '0')}`;
  }
  const ampm = h >= 12 ? 'pm' : 'am';
  const h12 = h % 12 || 12;
  return m ? `${h12}:${String(m).padStart(2, '0')}${ampm}` : `${h12}${ampm}`;
}

export const formatDate = (d: Date): string =>
  d.getFullYear() +
  '-' +
  String(d.getMonth() + 1).padStart(2, '0') +
  '-' +
  String(d.getDate()).padStart(2, '0');

export const todayStr = (): string => formatDate(new Date());

/** 'YYYY-MM-DD' -> 'M/D' */
export const formatShortDate = (ds: string): string => {
  const [, m, d] = ds.split('-');
  return +m + '/' + +d;
};

/** Build a local Date from a 'YYYY-MM-DD' string, anchored at noon to avoid TZ drift. */
export const dateFromISO = (ds: string): Date => new Date(ds + 'T12:00:00');

/** Add `n` days to a 'YYYY-MM-DD' string, returning a new 'YYYY-MM-DD' string. */
export const addDays = (ds: string, n: number): string => {
  const d = dateFromISO(ds);
  d.setDate(d.getDate() + n);
  return formatDate(d);
};

/** The Monday whose "Schedule - Week of …" post should be displayed (shared by
 *  the real dashboard and the landing sample):
 *    • Mon–Fri → the Monday of the CURRENT school week (the most recent Monday),
 *    • Sat & Sun → the UPCOMING Monday, so students can prep for the week ahead.
 *  Schoology anchors its weekly schedule posts on Mondays, so one always exists. */
export const scheduleMonday = (): string => {
  const now = new Date();
  const day = now.getDay(); // 0 = Sunday … 6 = Saturday
  const d = new Date(now);
  if (day === 0) d.setDate(d.getDate() + 1); // Sunday → tomorrow's Monday
  else if (day === 6) d.setDate(d.getDate() + 2); // Saturday → the Monday after
  else d.setDate(d.getDate() - (day - 1)); // Mon–Fri → this week's Monday
  return formatDate(d);
};

/** Whole-day difference (b - a) for two 'YYYY-MM-DD' strings. */
export const dayDiff = (a: string, b: string): number => {
  const ms = dateFromISO(b).getTime() - dateFromISO(a).getTime();
  return Math.round(ms / 86400000);
};

const WEEKDAYS = ['Sunday', 'Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday'];
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];

/** e.g. 'Friday, Jun 6' — with the year appended when the date falls outside the
 *  current calendar year (e.g. 'Sunday, Jul 4 2027'), so far-out due dates can't
 *  masquerade as this year's. */
export const formatGroupHeader = (ds: string): string => {
  const d = dateFromISO(ds);
  const base = `${WEEKDAYS[d.getDay()]}, ${MONTHS[d.getMonth()]} ${d.getDate()}`;
  return d.getFullYear() === new Date().getFullYear() ? base : `${base} ${d.getFullYear()}`;
};

/** Short weekday + 'M/D', e.g. 'Tue 6/8' */
export const formatMetaDate = (ds: string): string => {
  const d = dateFromISO(ds);
  return `${WEEKDAYS[d.getDay()].slice(0, 3)} ${formatShortDate(ds)}`;
};
