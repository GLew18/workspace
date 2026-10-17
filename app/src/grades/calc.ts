// Cobalt: grade math for the Grades tab (Gabe, 10/11/26). Pure functions, no DOM.
//
// A course grade is the weighted average of its categories (Engagement, Quizzes,
// Tests...) when the teacher set weights, else plain total points. The headline the
// student sees is ALWAYS Schoology's own number when it sent one; this math only
// supplies the graph, the what-ifs, and the headline's movement (projected =
// Schoology's grade + the change this math sees), so a teacher's custom rounding or
// drop-lowest rule never makes the headline disagree with Schoology.
//
// LETTERS ARE THE SCHOOL'S, NEVER OURS (Gabe, 10/11/26): a letter appears only when
// Schoology sent the course's grading scale. No scale, no letter.

// #region Types — the server's payload (functions/index.js sgyGrades)
export interface GAssign {
  id: string;
  title: string;
  cat: string; // category id | ''
  earned: number | null;
  max: number | null;
  /** Schoology's exception flag: 1 excused, 2 incomplete, 3 missing, 0 none. */
  exc: number;
  ts: number; // unix seconds the grade last changed
  due: string; // 'YYYY-MM-DD' | ''
  /** The teacher's comment on this grade, when there is one. */
  comment?: string;
  /** A made-up (what-if) grade the student added; never from Schoology. */
  whatif?: boolean;
  /** A what-if the grade-goal preview generated (End preview removes it). */
  preview?: boolean;
}
export interface GPeriod {
  id: string;
  title: string;
  final: number | null;
  catPct: Record<string, number | null>;
  assignments: GAssign[];
}
export interface GCategory {
  id: string;
  title: string;
  weight: number | null;
}
export interface GScale {
  levels: { cutoff: number; title: string }[]; // highest cutoff first
}
export interface GCourse {
  id: string;
  name: string;
  categories: GCategory[];
  periods: GPeriod[];
  scale?: GScale | null;
}
export interface GradesPayload {
  host?: string;
  courses?: GCourse[];
  /** The school hides grades from students (or refused the read). */
  blocked?: boolean;
  fetchedAt?: number;
}
// #endregion

// #region Letters (only the school's own)
/** The scale only if EVERY level is a plain letter grade (A, B+, C-, D, F...). A school
 *  that names its levels something else (P, PC, L...) gets percentages only, because
 *  those names mean nothing to anyone outside that school. */
export function letterScale(scale: GScale | null | undefined): GScale | null {
  return scale && scale.levels.length > 0 && scale.levels.every((l) => /^[A-F][+-]?$/.test(l.title.trim())) ? scale : null;
}

/** The school's name for this percentage, or '' when Schoology sent no scale. */
export function letterFor(pct: number, scale: GScale | null | undefined): string {
  scale = letterScale(scale);
  if (!scale) return '';
  const hit = scale.levels.find((l) => pct >= l.cutoff - 1e-9);
  return hit ? hit.title : scale.levels[scale.levels.length - 1].title;
}

/** The first level above the one `pct` sits in, or null at the top / with no scale. */
export function nextLevel(pct: number, scale: GScale | null | undefined): { cutoff: number; title: string } | null {
  scale = letterScale(scale);
  if (!scale) return null;
  const i = scale.levels.findIndex((l) => pct >= l.cutoff - 1e-9);
  if (i === 0) return null;
  return i === -1 ? scale.levels[scale.levels.length - 1] : scale.levels[i - 1];
}

/** "90.91%" style, two decimals trimmed. */
export const fmtPct = (n: number): string => (Math.round(n * 100) / 100).toString() + '%';
// #endregion

// #region Which assignments count
/** Earned and possible points an assignment adds to its category, or null when it
 *  does not count (excused, incomplete, not graded yet, or worth no points).
 *  A missing assignment with no score counts as zero. */
export function points(a: GAssign): { e: number; m: number } | null {
  if (!a.max || a.max <= 0) return null;
  if (a.exc === 1 || a.exc === 2) return null;
  if (a.earned === null) return a.exc === 3 ? { e: 0, m: a.max } : null;
  return { e: a.earned, m: a.max };
}

export const isMissing = (a: GAssign): boolean => a.exc === 3 && a.earned === null;
// #endregion

// #region Course percentage
/** Weighted when any category carries a weight; otherwise total points. Returns null
 *  when nothing is graded yet. Categories with no graded points drop out and the
 *  remaining weights are renormalised, which is what Schoology does. */
export function coursePct(categories: GCategory[], assigns: GAssign[]): number | null {
  const byCat = new Map<string, { e: number; m: number }>();
  let totalE = 0;
  let totalM = 0;
  for (const a of assigns) {
    const p = points(a);
    if (!p) continue;
    totalE += p.e;
    totalM += p.m;
    const cur = byCat.get(a.cat) ?? { e: 0, m: 0 };
    cur.e += p.e;
    cur.m += p.m;
    byCat.set(a.cat, cur);
  }
  if (totalM <= 0) return null;
  const weights = new Map(categories.map((c) => [c.id, c.weight ?? 0]));
  const weighted = [...weights.values()].some((w) => w > 0);
  if (!weighted) return (totalE / totalM) * 100;
  let num = 0;
  let den = 0;
  for (const [cat, s] of byCat) {
    const w = weights.get(cat) ?? 0;
    if (w <= 0 || s.m <= 0) continue;
    num += w * (s.e / s.m);
    den += w;
  }
  return den > 0 ? (num / den) * 100 : (totalE / totalM) * 100;
}

/** One category's percentage from its own assignments, or null if none count. */
export function categoryPct(catId: string, assigns: GAssign[]): number | null {
  let e = 0;
  let m = 0;
  for (const a of assigns) {
    if (a.cat !== catId) continue;
    const p = points(a);
    if (p) {
      e += p.e;
      m += p.m;
    }
  }
  return m > 0 ? (e / m) * 100 : null;
}
// #endregion

// #region Headline + graph
/** What to show as the course's grade: Schoology's number, else our own math. */
export function headline(period: GPeriod, categories: GCategory[]): number | null {
  return period.final ?? coursePct(categories, period.assignments);
}

const sortKey = (a: GAssign): string => a.due || (a.ts ? new Date(a.ts * 1000).toISOString().slice(0, 10) : '');

export interface SeriesPoint {
  date: string;
  pct: number;
  /** The assignment that moved the line to this point. */
  title: string;
  /** Points of grade this assignment added (negative = it pulled the grade down). */
  delta: number;
}

/** The grade as it stood after each graded day, rebuilt from the assignments.
 *  Real from the first day, with no stored history needed. */
export function series(categories: GCategory[], assigns: GAssign[]): SeriesPoint[] {
  const dated = assigns.filter((a) => points(a) && sortKey(a)).sort((x, y) => (sortKey(x) < sortKey(y) ? -1 : sortKey(x) > sortKey(y) ? 1 : x.ts - y.ts));
  const out: SeriesPoint[] = [];
  const seen: GAssign[] = [];
  let prev = 0;
  for (const a of dated) {
    seen.push(a);
    const pct = coursePct(categories, seen);
    if (pct === null) continue;
    const date = sortKey(a);
    const last = out[out.length - 1];
    if (last && last.date === date) {
      last.pct = pct;
      last.title = last.title === a.title ? a.title : `${last.title} + ${a.title}`;
      last.delta = last.delta + (pct - prev);
    } else out.push({ date, pct, title: a.title, delta: out.length ? pct - prev : 0 });
    prev = pct;
  }
  return out;
}

/** The newest change time among a course's assignments, in unix seconds (0 = none). */
export const lastChange = (assigns: GAssign[]): number => assigns.reduce((m, a) => Math.max(m, a.ts), 0);
// #endregion

// #region What-if
/** Scores a student tries on real assignments, without saving anything. */
export interface Edits {
  /** assignment id -> a score (and out-of) to pretend. */
  set: Map<string, { earned: number; max: number }>;
  /** Made-up grades added with + inside a category. */
  added: GAssign[];
}

export const emptyEdits = (): Edits => ({ set: new Map(), added: [] });
export const hasEdits = (e: Edits): boolean => e.set.size > 0 || e.added.length > 0;

/** The assignments as the what-if sees them. */
export function applyEdits(assigns: GAssign[], e: Edits): GAssign[] {
  return [
    ...assigns.map((a) => {
      const v = e.set.get(a.id);
      return v === undefined ? a : { ...a, earned: v.earned, max: v.max, exc: 0 };
    }),
    ...e.added,
  ];
}

/** The grade to show for the edited assignments: Schoology's number moved by the
 *  change this math sees, so it starts exactly where the student is. */
export function shownGrade(categories: GCategory[], base: GAssign[], edited: GAssign[], shownNow: number | null): number | null {
  const b = coursePct(categories, base);
  const n = coursePct(categories, edited);
  if (n === null) return shownNow;
  return shownNow !== null && b !== null ? shownNow + (n - b) : n;
}

const hypo = (cat: string, e: number, m: number): GAssign => ({ id: '_hypo', title: 'What-if', cat, earned: e, max: m, exc: 0, ts: 0, due: '' });

/** The grade if one more assignment landed. */
export function projectAdd(
  categories: GCategory[],
  assigns: GAssign[],
  shownNow: number | null,
  add: { cat: string; earned: number; max: number }
): number | null {
  const next = [...assigns, hypo(add.cat, add.earned, add.max)];
  const n = coursePct(categories, next);
  if (n === null) return null;
  return shownGrade(categories, assigns, next, shownNow);
}

export type Need =
  | { kind: 'already' }
  | { kind: 'impossible'; best: number }
  | { kind: 'need'; earned: number; pct: number };

/** Points needed on one more assignment to reach `target`. The grade is a straight
 *  line in the score, so two evaluations (0 and full marks) pin it down. */
export function pointsNeeded(
  categories: GCategory[],
  assigns: GAssign[],
  shownNow: number | null,
  target: number,
  add: { cat: string; max: number }
): Need | null {
  const lo = projectAdd(categories, assigns, shownNow, { ...add, earned: 0 });
  const hi = projectAdd(categories, assigns, shownNow, { ...add, earned: add.max });
  if (lo === null || hi === null) return null;
  if (lo >= target) return { kind: 'already' };
  if (hi < target) return { kind: 'impossible', best: hi };
  const share = (target - lo) / (hi - lo);
  const earned = Math.ceil(share * add.max * 100) / 100;
  return { kind: 'need', earned, pct: (earned / add.max) * 100 };
}
// #endregion

/** The grading period to open first: the one with the most recent activity. */
export function defaultPeriod(course: GCourse): GPeriod {
  let best = course.periods[0];
  let bestTs = -1;
  for (const p of course.periods) {
    const ts = lastChange(p.assignments);
    if (ts > bestTs || (ts === bestTs && p.final !== null && best.final === null)) {
      best = p;
      bestTs = ts;
    }
  }
  return best;
}

// #region Smooth line
/** A smooth curve THROUGH every real point that never overshoots them (monotone
 *  cubic, Fritsch-Carlson): between two grades it glides, it never swings above the
 *  higher or below the lower one, so the line stays honest. Both graphs use it, and
 *  the hover readout reads the same curve. Ends are level, so the line settles
 *  flat after the latest grade instead of pointing off the chart. */
export interface Curve {
  /** One Bezier per gap: start, two control points, end, all in data space. */
  segs: { x0: number; y0: number; c1x: number; c1y: number; c2x: number; c2y: number; x1: number; y1: number }[];
  /** The curve's value at x (flat outside the points). */
  at: (x: number) => number;
}

export function monotoneCurve(xs: number[], ys: number[]): Curve {
  const n = xs.length;
  const dx: number[] = [];
  const m: number[] = [];
  for (let i = 0; i < n - 1; i++) {
    dx.push(xs[i + 1] - xs[i]);
    m.push(dx[i] === 0 ? 0 : (ys[i + 1] - ys[i]) / dx[i]);
  }
  const t: number[] = new Array(n).fill(0);
  for (let i = 1; i < n - 1; i++) t[i] = m[i - 1] * m[i] <= 0 ? 0 : (m[i - 1] + m[i]) / 2;
  for (let i = 0; i < n - 1; i++) {
    if (m[i] === 0) {
      t[i] = 0;
      t[i + 1] = 0;
      continue;
    }
    const a = t[i] / m[i];
    const b = t[i + 1] / m[i];
    const s = a * a + b * b;
    if (s > 9) {
      const k = 3 / Math.sqrt(s);
      t[i] = k * a * m[i];
      t[i + 1] = k * b * m[i];
    }
  }
  const segs = [];
  for (let i = 0; i < n - 1; i++) {
    const h = dx[i] / 3;
    segs.push({ x0: xs[i], y0: ys[i], c1x: xs[i] + h, c1y: ys[i] + t[i] * h, c2x: xs[i + 1] - h, c2y: ys[i + 1] - t[i + 1] * h, x1: xs[i + 1], y1: ys[i + 1] });
  }
  const at = (x: number): number => {
    if (n === 0) return 0;
    if (x <= xs[0]) return ys[0];
    if (x >= xs[n - 1]) return ys[n - 1];
    let i = 0;
    while (i < n - 2 && x > xs[i + 1]) i++;
    const h = dx[i];
    const u = (x - xs[i]) / h;
    const u2 = u * u;
    const u3 = u2 * u;
    return (2 * u3 - 3 * u2 + 1) * ys[i] + (u3 - 2 * u2 + u) * h * t[i] + (-2 * u3 + 3 * u2) * ys[i + 1] + (u3 - u2) * h * t[i + 1];
  };
  return { segs, at };
}
// #endregion

// #region Timescale (the graph's range, and the trend number that goes with it)
export type RangeId = 'week' | 'month' | 'quarter' | 'all';
export const RANGES: { id: RangeId; label: string; days: number | null; phrase: string }[] = [
  { id: 'week', label: 'Week', days: 7, phrase: 'past week' },
  { id: 'month', label: 'Month', days: 30, phrase: 'past month' },
  { id: 'quarter', label: '3 months', days: 90, phrase: 'past 3 months' },
  { id: 'all', label: 'All', days: null, phrase: 'this term' },
];

export interface Windowed {
  start: number; // ms
  end: number; // ms (today, or the last grade if later)
  /** The line's points inside the range. src is the grade change behind a point, or
   *  null for the point Cobalt adds at the left edge so the line starts where the
   *  grade really stood. */
  pts: { ms: number; pct: number; src: SeriesPoint | null }[];
  /** Points of grade gained (or lost) across the range; null with under two grades. */
  change: number | null;
}

export const dayMsOf = (d: string): number => new Date(d + 'T12:00:00').getTime();

/** The part of the grade history inside the last `days` days (all of it when null).
 *  The trend number and the graph both come from this one object, so they can
 *  never disagree about what period they cover. */
export function windowSeries(all: SeriesPoint[], days: number | null, now = Date.now()): Windowed | null {
  if (!all.length) return null;
  const ms = all.map((q) => dayMsOf(q.date));
  const full = monotoneCurve(ms, all.map((q) => q.pct));
  const end = Math.max(ms[ms.length - 1], now);
  const start = days === null ? ms[0] : Math.max(ms[0], end - days * 86_400_000);
  const pts: Windowed['pts'] = [];
  if (start > ms[0] && !ms.includes(start)) pts.push({ ms: start, pct: full.at(start), src: null });
  all.forEach((q, i) => {
    if (ms[i] >= start) pts.push({ ms: ms[i], pct: q.pct, src: q });
  });
  return { start, end, pts, change: all.length >= 2 ? full.at(end) - full.at(start) : null };
}
// #endregion
