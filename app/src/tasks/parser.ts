// Cobalt: natural-language quick-add parser (spec §6.2, Appendix 13.3).
//
// Parses free text like "mow the lawn tom 630am misc" into a ParsedTask, or
// null when no title remains. Extraction order: time-label → priority → time
// → date → course → title. Priority is pulled before date/course so single
// letters (h/l/m/n) aren't eaten by other matchers.

import type { ParsedTask, Priority } from '../types';
import { todayStr, addDays, formatDate } from '../util/dates';
import { PRIORITY_MULTI, PRIORITY_SINGLE } from './priorities';
import { extractCourseTokens } from '../courses/registry';

const dayMap: Record<string, number> = {
  sunday: 0, sun: 0, su: 0,
  monday: 1, mon: 1, mo: 1,
  tuesday: 2, tue: 2, tues: 2, tu: 2,
  wednesday: 3, wed: 3, we: 3,
  thursday: 4, thu: 4, thurs: 4, th: 4,
  friday: 5, fri: 5, fr: 5,
  saturday: 6, sat: 6, sa: 6,
};

const TOMORROW = new Set(['tomorrow', 'tom', 'tmrw', 'tmr']);
const TODAY = new Set(['today', 'tod']);

const pad = (n: number) => String(n).padStart(2, '0');

// --- time -----------------------------------------------------------------

/** Parse a single token as a clock time → 'HH:MM' (24h), or null. */
export function parseTimeToken(tok: string): string | null {
  const lower = tok.toLowerCase();

  // Suffix accepts the full am/pm or a bare a/p ("630a", "1145p", "6:30p").
  const ampm = lower.match(/^(\d{1,4})(?::(\d{2}))?(am|pm|a|p)$/);
  if (ampm) {
    let h: number;
    let min: number;
    if (ampm[2] !== undefined) {
      h = +ampm[1];
      min = +ampm[2];
    } else {
      const d = ampm[1];
      if (d.length <= 2) {
        h = +d;
        min = 0;
      } else if (d.length === 3) {
        h = +d[0];
        min = +d.slice(1);
      } else {
        h = +d.slice(0, 2);
        min = +d.slice(2);
      }
    }
    if (h < 1 || h > 12 || min < 0 || min > 59) return null;
    const isPm = ampm[3].startsWith('p'); // covers both "pm" and bare "p"
    if (isPm && h < 12) h += 12;
    if (!isPm && h === 12) h = 0;
    return `${pad(h)}:${pad(min)}`;
  }

  const military = lower.match(/^(\d{1,2}):(\d{2})$/);
  if (military) {
    const h = +military[1];
    const min = +military[2];
    if (h < 0 || h > 23 || min < 0 || min > 59) return null;
    return `${pad(h)}:${pad(min)}`;
  }

  return null;
}


// --- date -----------------------------------------------------------------

const dow = () => new Date().getDay();

/** Bare weekday → next occurrence ('YYYY-MM-DD'); if it's today, jumps +7. */
function bareWeekday(target: number): string {
  let delta = (target - dow() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(todayStr(), delta);
}

/** "next <weekday>" → the weekday in the week AFTER the next occurrence. */
function nextWeekday(target: number): string {
  let delta = (target - dow() + 7) % 7;
  if (delta === 0) delta = 7;
  return addDays(todayStr(), delta + 7);
}

const MONTHS: Record<string, number> = {
  jan: 0, january: 0, feb: 1, february: 1, mar: 2, march: 2, apr: 3, april: 3,
  may: 4, jun: 5, june: 5, jul: 6, july: 6, aug: 7, august: 7,
  sep: 8, sept: 8, september: 8, oct: 9, october: 9, nov: 10, november: 10,
  dec: 11, december: 11,
};

/** "11", "11th", "1st", "22nd" → day 1–31, or null. */
function dayNum(tok: string): number | null {
  const m = tok.match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
  if (!m) return null;
  const d = +m[1];
  return d >= 1 && d <= 31 ? d : null;
}

/** 2-digit ("26") → 2026; 4-digit passed through. */
const fullYear = (y: string): number => (y.length <= 2 ? 2000 + +y : +y);

/** Build a 'YYYY-MM-DD' string, or null if month/day are out of range. */
function mkDate(year: number, monthIdx: number, day: number): string | null {
  if (monthIdx < 0 || monthIdx > 11 || day < 1 || day > 31) return null;
  return formatDate(new Date(year, monthIdx, day));
}

/**
 * THE past-date guard (Gabe, 8/11): "reject past dates. It can only be currently
 * and in the future."
 *
 * Every place a human types or edits a date runs this before writing: the
 * quick-add bar, the Tasks-tab date editor, and the three Focus editors. A bare
 * "8/6" can no longer produce one (it rolls to the next occurrence), so what
 * this actually catches is an explicit past year like "8/6/25".
 *
 * IT DOES NOT APPLY TO TASKS THAT SIMPLY AGED. A task due yesterday is overdue,
 * not invalid, and the Schoology feed may move a deadline on its own. This
 * guards the ENTRY POINTS only, never stored data or the importer, which is why
 * it lives here rather than inside parseDateTime.
 */
export function isPastDate(ds: string): boolean {
  return !!ds && ds < todayStr();
}

/** The one sentence shown when a past date is refused. */
export const PAST_DATE_MSG = '📅 That date has already passed. Pick today or later.';

/**
 * A month/day with NO year means THE NEXT TIME THAT DATE HAPPENS (Gabe, 8/11).
 * On 8/11/26, "8/6" is next year's 8/6, not the one that already went by: a
 * student typing a bare date is always scheduling something, never backdating
 * it, and the old this-year assumption silently created an overdue task.
 *
 * Today itself counts as "the next time", so "8/11" on 8/11 stays today.
 *
 * A date typed WITH a year is left exactly as typed, including into the past.
 * Saying the year out loud is unambiguous, and a deliberately backdated task is
 * a real thing (that is what the overdue state is for).
 */
function nextOccurrence(monthIdx: number, day: number): string | null {
  const now = new Date();
  const thisYear = mkDate(now.getFullYear(), monthIdx, day);
  if (!thisYear) return null;
  return thisYear >= todayStr() ? thisYear : mkDate(now.getFullYear() + 1, monthIdx, day);
}

/** Try to parse a date starting at tokens[i]; returns the date and tokens consumed. */
function parseDateAt(tokens: string[], i: number): { date: string; consumed: number } | null {
  const tok = tokens[i].toLowerCase().replace(/,$/, ''); // tolerate a trailing comma


  // --- relative words ---
  if (TODAY.has(tok)) return { date: todayStr(), consumed: 1 };
  if (TOMORROW.has(tok)) return { date: addDays(todayStr(), 1), consumed: 1 };
  if (tok === 'next' || tok === 'this' || tok === 'coming') {
    const n2 = tokens[i + 1]?.toLowerCase().replace(/,$/, '');
    // "next week" → the SUNDAY that starts next week (weeks are Sunday-anchored
    // app-wide), not a flat +7 from today.
    if (n2 === 'week') return { date: bareWeekday(0), consumed: 2 };
    if (tok === 'next' && n2 === 'month') {
      // First day of next month (Date() rolls Dec → Jan of next year itself).
      const now = new Date();
      return { date: formatDate(new Date(now.getFullYear(), now.getMonth() + 1, 1)), consumed: 2 };
    }
    if (tok === 'next' && n2 === 'year') {
      // Jan 1 of next year.
      return { date: formatDate(new Date(new Date().getFullYear() + 1, 0, 1)), consumed: 2 };
    }
    if (n2 && n2 in dayMap) {
      return { date: tok === 'next' ? nextWeekday(dayMap[n2]) : bareWeekday(dayMap[n2]), consumed: 2 };
    }
  }
  // "in N day(s) / week(s)"
  if (tok === 'in') {
    const n = +(tokens[i + 1] ?? '');
    const unit = tokens[i + 2]?.toLowerCase() ?? '';
    if (!isNaN(n) && tokens[i + 1]) {
      if (/^days?$/.test(unit)) return { date: addDays(todayStr(), n), consumed: 3 };
      if (/^weeks?$/.test(unit)) return { date: addDays(todayStr(), n * 7), consumed: 3 };
    }
  }
  // bare weekday
  if (tok in dayMap) return { date: bareWeekday(dayMap[tok]), consumed: 1 };

  // --- single-token numeric forms (all require a separator) ---
  // ISO: 2026-01-11 or 2026/01/11
  const iso = tok.match(/^(\d{4})[\/-](\d{1,2})[\/-](\d{1,2})$/);
  if (iso) { const d = mkDate(+iso[1], +iso[2] - 1, +iso[3]); if (d) return { date: d, consumed: 1 }; }
  // M/D/Y(Y) or M-D-Y(Y) — slash and dash only. We deliberately do NOT accept '.'
  // as a separator: "4.2" is far more often a section number than April 2, and
  // misreading it as a past due-date got whole tasks ("Complete section 4.2")
  // rejected. Slash and dash are conventional date separators; a dot is not.
  const mdy = tok.match(/^(\d{1,2})[\/-](\d{1,2})[\/-](\d{2}|\d{4})$/);
  if (mdy) { const d = mkDate(fullYear(mdy[3]), +mdy[1] - 1, +mdy[2]); if (d) return { date: d, consumed: 1 }; }
  // M/D or M-D (no year → the NEXT time that date occurs, this year or next).
  // Same separator reasoning: slash/dash yes, dot no.
  const md = tok.match(/^(\d{1,2})[\/-](\d{1,2})$/);
  if (md) { const d = nextOccurrence(+md[1] - 1, +md[2]); if (d) return { date: d, consumed: 1 }; }

  // --- month-name forms (multi-token) ---
  // "<month> <day>[ <year>]"  → "jan 11", "january 11th", "jan 11 2026"
  if (tok in MONTHS) {
    const day = dayNum(tokens[i + 1]?.toLowerCase().replace(/,$/, '') ?? '');
    if (day) {
      const yTok = tokens[i + 2] ?? '';
      const hasYear = /^\d{2}(\d{2})?$/.test(yTok);
      const d = hasYear ? mkDate(fullYear(yTok), MONTHS[tok], day) : nextOccurrence(MONTHS[tok], day);
      if (d) return { date: d, consumed: hasYear ? 3 : 2 };
    }
  }
  // "<day> <month>[ <year>]"  → "11 jan", "11th january 2026"
  const dFirst = dayNum(tok);
  if (dFirst) {
    const mWord = tokens[i + 1]?.toLowerCase().replace(/,$/, '') ?? '';
    if (mWord in MONTHS) {
      const yTok = tokens[i + 2] ?? '';
      const hasYear = /^\d{2}(\d{2})?$/.test(yTok);
      const d = hasYear ? mkDate(fullYear(yTok), MONTHS[mWord], dFirst) : nextOccurrence(MONTHS[mWord], dFirst);
      if (d) return { date: d, consumed: hasYear ? 3 : 2 };
    }
  }
  return null;
}

/** Standalone short-date parser for inline date editing. */
export function parseShortDate(str: string): string {
  const tokens = str.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const hit = parseDateAt(tokens, 0);
  return hit ? hit.date : (looseDayOfMonth(tokens) ?? '');
}

/** Editor-only: a bare day-of-month ("the 15th", "15") → next such day (this or next month). */
function looseDayOfMonth(tokens: string[]): string | null {
  const toks = tokens.filter((t) => t.toLowerCase() !== 'the');
  if (toks.length !== 1) return null;
  const day = dayNum(toks[0]);
  if (!day) return null;
  const now = new Date();
  let y = now.getFullYear();
  let m = now.getMonth();
  if (day < now.getDate()) { m++; if (m > 11) { m = 0; y++; } }
  return mkDate(y, m, day);
}

/**
 * Combined parser for the inline date+time editor. Pulls a clock time (am/pm or
 * HH:MM) and a 1–2 token date out of free text like "1/13 8am", "tom", or "8am".
 * A time with no date pins to today (matches quick-add). Either field may be ''.
 */
export function parseDateTime(input: string): { date: string; time: string } {
  const tokens = input.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return { date: '', time: '' };
  // Time — first token that reads as a clock; removed so it can't be re-read as a date.
  let time = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = parseTimeToken(tokens[i]);
    if (t) { time = t; tokens.splice(i, 1); break; }
  }
  // Date — first matching expression in what remains, then a bare day-of-month fallback.
  let date = '';
  for (let i = 0; i < tokens.length; i++) {
    const hit = parseDateAt(tokens, i);
    if (hit) { date = hit.date; tokens.splice(i, hit.consumed); break; }
  }
  if (!date) date = looseDayOfMonth(tokens) ?? '';
  if (time && !date) date = todayStr();
  return { date, time };
}

/**
 * Flexible time parser for the inline time editor. Accepts forms with or without
 * a colon and with or without am/pm, and returns 'HH:MM' (24h, stored internally;
 * always displayed back in 12h). Examples:
 *   '6:30 am' / '630am'  → '06:30'      '6pm'     → '18:00'
 *   '1145pm'             → '23:45'      '14:30'   → '14:30'
 *   '630'                → '06:30'      '1830'    → '18:30'
 * Returns '' if it can't be read as a time.
 */
export function parseClock(input: string): string {
  const s = input.trim().toLowerCase().replace(/\s+/g, '');
  if (!s) return '';

  // am/pm or HH:MM (handles '630am', '6:30am', '6pm', '14:30').
  const viaToken = parseTimeToken(s);
  if (viaToken) return viaToken;

  // Bare digits with no am/pm or colon, interpreted as 24h.
  const digits = s.match(/^(\d{1,4})$/);
  if (digits) {
    const d = digits[1];
    let h: number;
    let m: number;
    if (d.length <= 2) {
      h = +d;
      m = 0;
    } else if (d.length === 3) {
      h = +d[0];
      m = +d.slice(1);
    } else {
      h = +d.slice(0, 2);
      m = +d.slice(2);
    }
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) return `${pad(h)}:${pad(m)}`;
  }

  return '';
}

// --- priority -------------------------------------------------------------

function extractPriority(tokens: string[]): Priority {
  // Pass A: two-word phrases ("very high" / "very low").
  for (let i = 0; i < tokens.length - 1; i++) {
    const pair = `${tokens[i]} ${tokens[i + 1]}`.toLowerCase();
    if (PRIORITY_MULTI[pair]) {
      const p = PRIORITY_MULTI[pair];
      tokens.splice(i, 2);
      return p;
    }
  }
  // Pass B: single-token multi-abbrevs (vh / vl / v-high ...).
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (PRIORITY_MULTI[t]) {
      const p = PRIORITY_MULTI[t];
      tokens.splice(i, 1);
      return p;
    }
  }
  // Pass C: single letters / words (h / l / m / n ...).
  for (let i = 0; i < tokens.length; i++) {
    const t = tokens[i].toLowerCase();
    if (PRIORITY_SINGLE[t]) {
      const p = PRIORITY_SINGLE[t];
      tokens.splice(i, 1);
      return p;
    }
  }
  return 'normal';
}

// --- main -----------------------------------------------------------------

export function parseQuickAdd(input: string): ParsedTask | null {
  const text = input.trim();
  if (!text) return null;

  const tokens = text.split(/\s+/).filter(Boolean);

  const priority = extractPriority(tokens);

  // Course — pulled from the live registry (the user's own courses + parse words)
  // BEFORE date/time so an explicit parse word like "mon" resolves to its course
  // and is stripped from the title, instead of being eaten as the weekday Monday.
  const course = extractCourseTokens(tokens);

  // Time — first matching token only.
  let dueTime = '';
  for (let i = 0; i < tokens.length; i++) {
    const t = parseTimeToken(tokens[i]);
    if (t) {
      dueTime = t;
      tokens.splice(i, 1);
      break;
    }
  }

  // Date — first matching expression (1–2 tokens).
  let dueDate = '';
  for (let i = 0; i < tokens.length; i++) {
    const hit = parseDateAt(tokens, i);
    if (hit) {
      dueDate = hit.date;
      tokens.splice(i, hit.consumed);
      break;
    }
  }

  // No leftover title after extraction — fall back instead of rejecting:
  //   • course-only input ("ela") → title it with the course name.
  //   • otherwise the user typed ONLY a date/time (e.g. "4/2", or "tomorrow").
  //     A task needs a title and a due-date with no title is meaningless, so keep
  //     the literal text as the title and drop the parsed date/time — rather than
  //     rejecting the input as invalid.
  let title = tokens.join(' ').trim();
  if (!title) {
    if (course) {
      title = course;
    } else {
      title = text;
      dueDate = '';
      dueTime = '';
    }
  }

  // A time with no date defaults to today.
  if (dueTime && !dueDate) dueDate = todayStr();

  return { title, dueDate, dueTime, timeLabel: '', course, priority };
}

/**
 * Lightweight parser for the Focus tab's free-text "add a task" box. Focus todos
 * carry only text + course (no date/priority), so we ONLY pull a course parse word
 * out of the registry and keep everything else as the task text. "write essay mon"
 * → { text: "write essay", course: "Monkey" }. Typing just a course (e.g. "ela")
 * leaves no title, so we title it with the course too — both the text and course
 * become the course name.
 */
export function parseFocusInput(input: string): { text: string; course: string } {
  const raw = input.trim();
  if (!raw) return { text: '', course: '' };
  const tokens = raw.split(/\s+/).filter(Boolean);
  const course = extractCourseTokens(tokens);
  const text = tokens.join(' ').trim() || course || raw;
  return { text, course };
}
