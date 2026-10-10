// Cobalt: course normalization (spec §6.4 / Appendix 13.1).

import { COURSE_ABBR, COURSE_COLORS, COURSE_TABGROUP_COLOR, DEFAULT_COURSE_COLOR } from './maps';

const CANONICAL = Object.keys(COURSE_COLORS);

/** Classic Levenshtein edit distance. */
export function levenshtein(a: string, b: string): number {
  const m = a.length;
  const n = b.length;
  if (!m) return n;
  if (!n) return m;
  let prev = Array.from({ length: n + 1 }, (_, i) => i);
  let cur = new Array<number>(n + 1);
  for (let i = 1; i <= m; i++) {
    cur[0] = i;
    for (let j = 1; j <= n; j++) {
      const cost = a[i - 1] === b[j - 1] ? 0 : 1;
      cur[j] = Math.min(prev[j] + 1, cur[j - 1] + 1, prev[j - 1] + cost);
    }
    [prev, cur] = [cur, prev];
  }
  return prev[n];
}

/**
 * Resolve free-text course input to a canonical course name.
 * Order: exact abbr → exact canonical (ci) → substring (len≥3) → fuzzy abbr (≤2)
 *        → fuzzy canonical (≤3) → input as-is.
 */
export function normalizeCourse(input: string): string {
  const raw = input.trim();
  if (!raw) return '';
  const lower = raw.toLowerCase();

  // 1. exact abbreviation
  if (COURSE_ABBR[lower]) return COURSE_ABBR[lower];

  // 2. exact canonical (case-insensitive)
  const exactCanon = CANONICAL.find((c) => c.toLowerCase() === lower);
  if (exactCanon) return exactCanon;

  // 3. substring (only for inputs of length >= 3 to avoid noise)
  if (lower.length >= 3) {
    const sub = CANONICAL.find(
      (c) => c.toLowerCase().includes(lower) || lower.includes(c.toLowerCase())
    );
    if (sub) return sub;
  }

  // 4. fuzzy abbreviation (Levenshtein <= 2)
  let bestAbbr: { canon: string; dist: number } | null = null;
  for (const [abbr, canon] of Object.entries(COURSE_ABBR)) {
    const d = levenshtein(lower, abbr);
    if (d <= 2 && (!bestAbbr || d < bestAbbr.dist)) bestAbbr = { canon, dist: d };
  }
  if (bestAbbr) return bestAbbr.canon;

  // 5. fuzzy canonical (Levenshtein <= 3)
  let bestCanon: { canon: string; dist: number } | null = null;
  for (const c of CANONICAL) {
    const d = levenshtein(lower, c.toLowerCase());
    if (d <= 3 && (!bestCanon || d < bestCanon.dist)) bestCanon = { canon: c, dist: d };
  }
  if (bestCanon) return bestCanon.canon;

  // 6. give back the input
  return raw;
}

/**
 * The catalog course a name CONFIDENTLY names, or '' (Gabe, 10/10). No typo
 * tolerance: normalizeCourse's fuzzy steps read "Test" as a misspelling of the
 * abbreviation "sost" (two letters off) and called it Social Studies, so a course
 * named Test was offered sost / social / ss. Only these count here:
 *   exact abbreviation, exact catalog name, or a catalog name appearing as whole
 *   words inside the name ("AP Biology") or the name as a whole word inside a
 *   catalog name, 4+ letters ("Chemistry" inside "Honors Chemistry").
 */
export function matchCourseStrict(input: string): string {
  const lower = input.trim().toLowerCase();
  if (!lower) return '';
  if (COURSE_ABBR[lower]) return COURSE_ABBR[lower];
  const esc = (s: string): string => s.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  const whole = (hay: string, needle: string): boolean => new RegExp(`(^|[^a-z0-9])${esc(needle)}($|[^a-z0-9])`).test(hay);
  for (const c of CANONICAL) {
    const cl = c.toLowerCase();
    if (cl === lower || whole(lower, cl) || (lower.length >= 4 && whole(cl, lower))) return c;
  }
  return '';
}

export const getCourseColor = (name: string): string => COURSE_COLORS[name] || DEFAULT_COURSE_COLOR;

export const getCourseTabColor = (name: string): string => COURSE_TABGROUP_COLOR[name] || 'grey';

/** Does this single token plausibly name a course? (exact maps only — used by the parser.) */
export function isCourseToken(token: string): boolean {
  const lower = token.toLowerCase();
  return Boolean(COURSE_ABBR[lower]) || CANONICAL.some((c) => c.toLowerCase() === lower);
}
