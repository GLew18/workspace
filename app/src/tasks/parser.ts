// Cobalt: natural-language quick-add parser (spec §6.2, Appendix 13.3).
//
// Parses free text like "mow the lawn tom 630am misc" into a ParsedTask, or
// null when no title remains. Extraction order: time-label → priority → time
// → date → course → title. Priority is pulled before date/course so single
// words like "low" aren't eaten by other matchers.

import type { ParsedTask, Priority } from '../types';
import { todayStr, addDays, addMonths, addYears, formatDate } from '../util/dates';
import { PRIORITY_MULTI, PRIORITY_SINGLE } from './priorities';
import { extractCourseTokens } from '../courses/registry';

// EVERY TWO-LETTER WEEKDAY IS GONE (Gabe, 8/19), finishing what 'sa' started on
// 8/16: 'we', 'mo', 'th', 'tu', 'su' and 'fr' are all real words or common
// abbreviations, and each one silently ate a word out of a title and attached a
// due date nobody asked for. Three letters is the floor here — 'sun', 'mon',
// 'tue', 'wed', 'thu', 'fri', 'sat' are unambiguous and stay.
const dayMap: Record<string, number> = {
  sunday: 0, sun: 0,
  monday: 1, mon: 1,
  tuesday: 2, tue: 2, tues: 2,
  wednesday: 3, wed: 3,
  thursday: 4, thu: 4, thur: 4, thurs: 4,
  friday: 5, fri: 5,
  saturday: 6, sat: 6,
};

const TOMORROW = new Set(['tomorrow', 'tom', 'tmrw', 'tmr']);
const TODAY = new Set(['today', 'tod']);

// --- written numbers ------------------------------------------------------
//
// Anywhere the parser reads a number, it reads the WORD for it too (Gabe, 8/19):
// "in a week", "in three days", "jan first", "the fifteenth", "six pm". People
// write dates the way they say them, and a phrase the parser half-understood used
// to sit in the title with no date attached.
//
// These are safe despite being extremely common English words, because none of
// them is ever matched on its own: a count only counts after "in", a day only
// next to a month name (or alone in the date editor, where the whole box IS a
// date), and an hour only in front of am/pm. Context is what keeps "one" and "a"
// from being eaten out of a title, which is the trap that retired the one-letter
// and two-letter tokens.
const ONES: Record<string, number> = {
  one: 1, two: 2, three: 3, four: 4, five: 5, six: 6, seven: 7,
  eight: 8, nine: 9, ten: 10, eleven: 11, twelve: 12, thirteen: 13,
  fourteen: 14, fifteen: 15, sixteen: 16, seventeen: 17, eighteen: 18,
  nineteen: 19, twenty: 20, thirty: 30,
};

/**
 * "a" and "an" mean one AS A COUNT ONLY — "in a month", never a day of the month.
 * They are deliberately kept out of ONES for that reason (Gabe, 8/19): "a march"
 * and "march a" are not things anyone writes, so the only phrases they could ever
 * match are accidents. "in a month" and "march 1" / "march first" are the ways to
 * say it, in the date box and the task bar alike.
 */
const ARTICLES = new Set(['a', 'an']);

const ORDINALS: Record<string, number> = {
  first: 1, second: 2, third: 3, fourth: 4, fifth: 5, sixth: 6, seventh: 7,
  eighth: 8, ninth: 9, tenth: 10, eleventh: 11, twelfth: 12, thirteenth: 13,
  fourteenth: 14, fifteenth: 15, sixteenth: 16, seventeenth: 17,
  eighteenth: 18, nineteenth: 19, twentieth: 20, thirtieth: 30,
};

/** Strip a trailing comma and lowercase — every word lookup below wants this. */
const clean = (tok: string): string => tok.toLowerCase().replace(/,$/, '');

/**
 * One written number → its value, or null. Handles the compounds too, written
 * either way round: "twenty one", "twenty-one", "twentyone", "twenty-first".
 * Both halves must be real words, so "twenty green" is not a number.
 */
function wordNumber(tok: string, ordinal = false): number | null {
  const t = clean(tok);
  if (!t) return null;
  const table = ordinal ? ORDINALS : ONES;
  if (t in table) return table[t];
  // compound: <tens><unit>, e.g. twenty-one / twentyfirst
  const m = t.match(/^(twenty|thirty)[- ]?(.+)$/);
  if (m) {
    const unit = ordinal ? ORDINALS[m[2]] : ONES[m[2]];
    if (unit !== undefined && unit < 10) return ONES[m[1]] + unit;
  }
  return null;
}

/** A numeral ("3") or a written number ("three", "a") → the count, else null.
 *  Null rather than NaN so a legitimate 0 is still a count. */
function countWord(tok: string): number | null {
  const t = clean(tok);
  if (!t) return null;
  if (/^\d+$/.test(t)) return +t;
  if (ARTICLES.has(t)) return 1;
  return wordNumber(t);
}

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

/**
 * Read a clock time starting at tokens[i], including the two-token written form
 * ("six pm"), and say how many tokens it used. The written hour is only accepted
 * WITH an am/pm beside it: a bare "six" in the middle of a sentence is a word, not
 * a time, and eating it would be the one-letter mistake all over again.
 */
export function parseTimeAt(tokens: string[], i: number): { time: string; consumed: number } | null {
  const one = parseTimeToken(tokens[i] ?? '');
  if (one) return { time: one, consumed: 1 };
  const h = wordNumber(tokens[i] ?? '');
  const suffix = clean(tokens[i + 1] ?? '');
  if (h !== null && h >= 1 && h <= 12 && /^(am|pm|a|p)$/.test(suffix)) {
    const hh = suffix.startsWith('p') ? (h === 12 ? 12 : h + 12) : h === 12 ? 0 : h;
    return { time: `${pad(hh)}:00`, consumed: 2 };
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

/** "11", "11th", "1st", "22nd", "eleven", "eleventh", "twenty-first" → day 1–31,
 *  or null. */
function dayNum(tok: string): number | null {
  const t = clean(tok);
  const m = t.match(/^(\d{1,2})(?:st|nd|rd|th)?$/i);
  const d = m ? +m[1] : (wordNumber(tok, true) ?? wordNumber(tok));
  return d !== null && d >= 1 && d <= 31 ? d : null;
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
 * A time TODAY that has already gone by (Gabe, 8/19). An hour that is behind you
 * is overdue for exactly the reason a date is, so it gets the same treatment and
 * the same shape of message — the only difference is the noun.
 *
 * Only ever true for TODAY: a time on a future date is fine whatever the clock
 * says, and a past DATE is already isPastDate's job.
 */
export function isPastTime(ds: string, time: string): boolean {
  if (!ds || !time || ds !== todayStr()) return false;
  const t = new Date(`${ds}T${time}:00`).getTime();
  return Number.isFinite(t) && t < Date.now();
}

/** The sentence shown when a time earlier today is refused. */
export const PAST_TIME_MSG = '⏰ That time has already passed. Pick a later time.';

/**
 * A month/day with NO year means THE NEXT TIME THAT DATE HAPPENS (Gabe, 8/11).
 * On 8/11/26, "8/6" is next year's 8/6, not the one that already went by: a
 * student typing a bare date is always scheduling something, never backdating
 * it, and the old this-year assumption silently created an overdue task.
 *
 * Today itself counts as "the next time", so "8/11" on 8/11 stays today.
 *
 * Not rolling was tried on 8/19 and REVERTED the same day (Gabe): it made a bare
 * "1/15" typed in the autumn mean THIS January and get refused, when a bare date
 * is precisely the ambiguous case that should be read generously. The unambiguous
 * one is a date typed WITH a year — see below.
 *
 * A date typed WITH a year is left exactly as typed, including into the past, and
 * the entry-point guards then refuse it (isPastDate). Saying the year out loud
 * leaves nothing to interpret: "8/16/26" on 8/20/26 can only mean a day that has
 * gone, so it is turned away rather than quietly moved to 2027.
 */
function nextOccurrence(monthIdx: number, day: number): string | null {
  const now = new Date();
  const thisYear = mkDate(now.getFullYear(), monthIdx, day);
  if (!thisYear) return null;
  return thisYear >= todayStr() ? thisYear : mkDate(now.getFullYear() + 1, monthIdx, day);
}

/** Try to parse a date starting at tokens[i]; returns the date and tokens consumed.
 *  `dayFirst` off skips the "11 jan" reading - see findDate for why. */
function parseDateAt(tokens: string[], i: number, dayFirst = true): { date: string; consumed: number } | null {
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
  // "in N days / weeks / months / years", where N is a numeral OR a written
  // number. "in a week" and "in one week" are how people actually say it, and
  // both used to fail silently: +('a') and +('one') are NaN, so the phrase stayed
  // in the title with no date attached (Gabe, 8/19).
  if (tok === 'in') {
    const n = countWord(tokens[i + 1] ?? '');
    const unit = tokens[i + 2]?.toLowerCase().replace(/,$/, '') ?? '';
    if (n !== null) {
      if (/^days?$/.test(unit)) return { date: addDays(todayStr(), n), consumed: 3 };
      if (/^weeks?$/.test(unit)) return { date: addDays(todayStr(), n * 7), consumed: 3 };
      if (/^months?$/.test(unit)) return { date: addMonths(todayStr(), n), consumed: 3 };
      if (/^years?$/.test(unit)) return { date: addYears(todayStr(), n), consumed: 3 };
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
    const day = dayNum(tokens[i + 1] ?? '');
    if (day) {
      const yTok = tokens[i + 2] ?? '';
      const hasYear = /^\d{2}(\d{2})?$/.test(yTok);
      const d = hasYear ? mkDate(fullYear(yTok), MONTHS[tok], day) : nextOccurrence(MONTHS[tok], day);
      if (d) return { date: d, consumed: hasYear ? 3 : 2 };
    }
  }
  // "<day> <month>[ <year>]"  → "11 jan", "11th january 2026"
  const dFirst = dayFirst ? dayNum(tok) : null;
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

/**
 * Find the first date in `tokens`, MONTH-FIRST BEFORE DAY-FIRST (Gabe, 8/20).
 *
 * Both orders are valid - "march 1" and "1 march" mean the same day - but they
 * can collide, and a left-to-right scan let the wrong one win. "read chapter 4
 * march 1" hit the "4" first, read "4 march" as March 4th, and left a task
 * called "read chapter 1". The number belonged to the chapter; the date was the
 * two words after it.
 *
 * So the whole line is searched for a month-first date before any day-first
 * reading is entertained. Month-first is far and away the common way to write it,
 * and the day-first form only exists to be accommodating - it should never be the
 * reading that takes something away from a title.
 */
function findDate(
  tokens: string[],
  from = 0
): { date: string; consumed: number; at: number } | null {
  for (const dayFirst of [false, true]) {
    for (let i = from; i < tokens.length; i++) {
      const hit = parseDateAt(tokens, i, dayFirst);
      if (hit) return { ...hit, at: i };
    }
  }
  return null;
}

/** Standalone short-date parser for inline date editing. */
export function parseShortDate(str: string): string {
  const tokens = str.trim().split(/\s+/).filter(Boolean);
  if (!tokens.length) return '';
  const hit = parseDateAt(tokens, 0, false) ?? parseDateAt(tokens, 0, true);
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
    const hit = parseTimeAt(tokens, i);
    if (hit) { time = hit.time; tokens.splice(i, hit.consumed); break; }
  }
  // Date — first matching expression in what remains, then a bare day-of-month fallback.
  let date = '';
  const hit = findDate(tokens);
  if (hit) { date = hit.date; tokens.splice(hit.at, hit.consumed); }
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
  // Written hour first, while the spaces are still there to split on: "six pm"
  // becomes "6pm", "six" becomes "6", and the rest of this function is unchanged.
  const parts = input.trim().toLowerCase().split(/\s+/).filter(Boolean);
  if (parts.length && parts.length <= 2) {
    const h = wordNumber(parts[0]);
    if (h !== null && h >= 0 && h <= 23) parts[0] = String(h);
  }
  const s = parts.join('').replace(/\s+/g, '');
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
  // Pass C: single-token words (high / low / med / norm ...).
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

  // Time — first match only ("6pm", "6:30", or the written "six pm").
  let dueTime = '';
  for (let i = 0; i < tokens.length; i++) {
    const hit = parseTimeAt(tokens, i);
    if (hit) {
      dueTime = hit.time;
      tokens.splice(i, hit.consumed);
      break;
    }
  }

  // Date - the first matching expression, month-first winning over day-first.
  let dueDate = '';
  const dateHit = findDate(tokens);
  if (dateHit) {
    dueDate = dateHit.date;
    tokens.splice(dateHit.at, dateHit.consumed);
  }

  // Nothing left over to be the title, because every word was a parse word. Rather
  // than reject the input, the task is named AFTER WHAT WAS TYPED and keeps
  // everything that was understood (Gabe, 8/20): "march 1" is a task called
  // "march 1" due March 1, and "ela" is a task called "ela" in English.
  //
  // Two earlier versions were wrong in opposite directions. It used to keep the
  // text and THROW THE DATE AWAY, on the reasoning that a due date with no title
  // is meaningless — true, but the fix is to supply a title, not to discard the
  // one thing the student actually said. Then a course-only entry was titled with
  // the course's PROPER name ("ela" → "English"), which quietly replaced their
  // words with ours. The literal text is the only answer that is never a surprise.
  let title = tokens.join(' ').trim();
  if (!title) title = text;

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
/** "f:NAME" — the same token the Tasks tab's quick-add uses. Peeled off BEFORE the
 *  rest of the parse so the folder name can never be mistaken for the title or a
 *  course word, exactly as quickadd.ts does it. */
const FOCUS_FOLDER_RE = /(^|\s)f:(\S*)/i;

export function parseFocusInput(input: string): {
  text: string;
  course: string;
  folderName: string;
  dueDate: string;
  dueTime: string;
  priority: Priority;
} {
  const raw = input.trim();
  const empty = { text: '', course: '', folderName: '', dueDate: '', dueTime: '', priority: 'normal' as Priority };
  if (!raw) return empty;

  // f: works in EVERY Focus add box now (Gabe, 8/15), matching the Tasks tab. It is
  // peeled off FIRST so the folder name can never be read as a title word, a course
  // parse word or a date.
  let rest = raw;
  let folderName = '';
  const fm = rest.match(FOCUS_FOLDER_RE);
  if (fm) {
    folderName = fm[2].trim();
    rest = (rest.slice(0, fm.index) + ' ' + rest.slice(fm.index! + fm[0].length)).replace(/\s+/g, ' ').trim();
  }

  // Then the SAME grammar the Tasks quick-add uses, rather than a course-only
  // subset. Typing "tod" in a Focus box used to leave the word sitting in the title
  // with no due date attached (Gabe, 8/15); now dates, times and priority words all
  // behave identically in both places, which is the only thing a student could
  // reasonably expect.
  const parsed = parseQuickAdd(rest);
  if (!parsed) return { ...empty, folderName };
  return {
    text: parsed.title || parsed.course || rest,
    course: parsed.course,
    folderName,
    dueDate: parsed.dueDate,
    dueTime: parsed.dueTime,
    priority: parsed.priority,
  };
}

