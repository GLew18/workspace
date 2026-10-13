// Cobalt: Schoology iCal feed parser.
//
// Schoology's personal calendar feed is a flat ICS dump. Each VEVENT carries only:
//   UID, DTSTART, DTEND, SUMMARY, DESCRIPTION, URL — no course/teacher/room fields.
// We parse those, classify each event, and map the relevant ones to tasks. Course
// attribution is done downstream by the classifier (the feed has no course data).

// #region Types — the shape of a parsed calendar event
export type IcalKind = 'assignment' | 'assessment' | 'schedule' | 'event';

export interface IcalEvent {
  uid: string; // raw UID, e.g. 'calendar-event-8008331763@schoology.com'
  id: string; // numeric id pulled from the UID, e.g. '8008331763' (varies per calendar day)
  assignmentId: string; // stable id from /assignment/<id> in the URL ('' for non-assignments)
  summary: string;
  description: string; // cleaned (trailing " - Link: ..." stripped), unescaped
  url: string; // https-upgraded deep link
  date: string; // 'YYYY-MM-DD' (local) from DTSTART
  hasTime: boolean; // DTSTART was a DATE-TIME (vs all-day DATE)
  time: string; // 'HH:MM' (24h, local) from DTSTART when it's a DATE-TIME; '' for all-day
  kind: IcalKind;
}
// #endregion

// #region Matchers & helpers — regexes + raw-ICS text/date parsing
// Events that aren't assignments still become tasks if their title looks like a graded
// assessment. Word-boundary matched so "contest"/"testing"/"protest" don't trigger.
/** True only for a REAL Schoology calendar feed URL, like
 *    webcal://heschel.schoology.com/calendar/feed/ical/1781354425/….ics
 *  Host must be schoology.com (or a school subdomain of it) and the path must be
 *  the calendar-feed route. This is the ONE validator for every place a student
 *  can enter the link (onboarding, Settings) and for links arriving from the
 *  extension, so "any URL pastes fine" (a YouTube link, a Schoology COURSE page)
 *  can never reach the sync. Syntax only; a well-formed link that 404s is
 *  caught later by Sync itself. */
export function isSchoologyIcalUrl(raw: string): boolean {
  try {
    const u = new URL(raw.trim().replace(/^webcal:/i, 'https:'));
    if (u.protocol !== 'https:' && u.protocol !== 'http:') return false;
    const host = u.hostname.toLowerCase();
    const onSchoology = host === 'schoology.com' || host.endsWith('.schoology.com');
    return onSchoology && /\/calendar\/feed\//i.test(u.pathname);
  } catch {
    return false;
  }
}

export const ASSESSMENT_RE = /\b(quiz|quizzes|test|exam|exams|midterm|final|finals)\b/i;

// The Tasks view's BADGE matcher is narrower ON PURPOSE (per Gabe): quiz/test/exam
// earn the red pill, but not "final"/"midterm", which are too often ordinary title
// words ("final draft"). "Exam" is back in (Gabe 8/6): unlike "final", it only ever
// means an assessment. The IMPORT matcher above keeps the full list, so midterms
// and finals still become tasks; they just don't wear a pill.
export const BADGE_ASSESSMENT_RE = /\b(quiz|quizzes|test|tests|exam|exams)\b/i;

/** Unfold RFC-5545 folded lines (continuation lines begin with a space or tab). */
function unfold(text: string): string {
  return text.replace(/\r\n/g, '\n').replace(/\n[ \t]/g, '');
}

/** Unescape ICS TEXT values: \n \, \; \\ */
function unescapeText(v: string): string {
  return v
    .replace(/\\n/gi, '\n')
    .replace(/\\,/g, ',')
    .replace(/\\;/g, ';')
    .replace(/\\\\/g, '\\')
    .trim();
}

/** Pull one property's raw value out of a VEVENT block, ignoring any ;PARAMS. */
function prop(block: string, name: string): string | null {
  // Match at line start: NAME or NAME;params  then ':'  then value to end of (unfolded) line.
  const re = new RegExp(`(?:^|\\n)${name}(?:;[^:\\n]*)?:([^\\n]*)`, 'i');
  const m = block.match(re);
  return m ? m[1] : null;
}

/** DTSTART → { date, hasTime, time }. Handles VALUE=DATE (all-day) and DATE-TIME. */
function parseDtStart(raw: string): { date: string; hasTime: boolean; time: string } | null {
  const v = raw.trim();
  const pad = (n: number) => String(n).padStart(2, '0');
  // All-day: 20250903 (VALUE=DATE) — no time.
  const dateOnly = v.match(/^(\d{4})(\d{2})(\d{2})$/);
  if (dateOnly) return { date: `${dateOnly[1]}-${dateOnly[2]}-${dateOnly[3]}`, hasTime: false, time: '' };
  // Date-time: ...THHMMSS(Z). Convert to local; the start time IS the due time.
  const dt = v.match(/^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/);
  if (dt) {
    const [, y, mo, d, h, mi, s, z] = dt;
    const dObj = z
      ? new Date(Date.UTC(+y, +mo - 1, +d, +h, +mi, +s))
      : new Date(+y, +mo - 1, +d, +h, +mi, +s);
    return {
      date: `${dObj.getFullYear()}-${pad(dObj.getMonth() + 1)}-${pad(dObj.getDate())}`,
      hasTime: true,
      time: `${pad(dObj.getHours())}:${pad(dObj.getMinutes())}`,
    };
  }
  return null;
}
// #endregion

// #region Classify & clean — decide an event's kind, tidy its description
function classify(url: string, summary: string): IcalKind {
  if (/\/assignment\//i.test(url)) return 'assignment';
  if (ASSESSMENT_RE.test(summary)) return 'assessment';
  if (/^\s*schedule\b/i.test(summary)) return 'schedule';
  return 'event';
}

/** Strip the trailing " - Link: <url>" that Schoology appends to every DESCRIPTION. */
function cleanDescription(raw: string): string {
  const text = unescapeText(raw);
  return text.replace(/\s*-\s*Link:\s*https?:\/\/\S+\s*$/i, '').trim();
}
// #endregion

// #region parseIcal() — split the ICS dump into structured events
/** Parse a full .ics document into structured events. */
export function parseIcal(ics: string): IcalEvent[] {
  const text = unfold(ics);
  const blocks = text.split('BEGIN:VEVENT').slice(1);
  const events: IcalEvent[] = [];

  for (const raw of blocks) {
    const block = raw.split('END:VEVENT')[0];

    const uid = prop(block, 'UID')?.trim() ?? '';
    const summary = unescapeText(prop(block, 'SUMMARY') ?? '');
    const url = (prop(block, 'URL') ?? '').trim().replace(/^http:\/\//i, 'https://');
    const dtRaw = prop(block, 'DTSTART');
    if (!uid || !summary || !dtRaw) continue;

    const dt = parseDtStart(dtRaw);
    if (!dt) continue;

    const idMatch = uid.match(/(\d{5,})/);
    const id = idMatch ? idMatch[1] : uid;
    const assignMatch = url.match(/\/assignment\/(\d+)/i);

    events.push({
      uid,
      id,
      assignmentId: assignMatch ? assignMatch[1] : '',
      summary,
      description: cleanDescription(prop(block, 'DESCRIPTION') ?? ''),
      url,
      date: dt.date,
      hasTime: dt.hasTime,
      time: dt.time,
      kind: classify(url, summary),
    });
  }

  return events;
}
// #endregion

// #region Event filters — which events become tasks vs the schedule card
/** Events that should become tasks: assignments + assessment-looking events. */
export function taskEvents(events: IcalEvent[]): IcalEvent[] {
  return events.filter((e) => e.kind === 'assignment' || e.kind === 'assessment');
}

/** Schedule-post events (for the dashboard "This Week's Schedule" card). */
export function scheduleEvents(events: IcalEvent[]): IcalEvent[] {
  return events.filter((e) => e.kind === 'schedule');
}
// #endregion
