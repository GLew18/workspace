// Cobalt: parse-word recommendations for a course name.
//
// ONE implementation, used by both places a course can be created: the
// onboarding courses screen and Settings ▸ Courses. It used to be duplicated
// (and had already drifted), so it lives here now and both import it.
//
// Two sources, catalog first:
//
//   1. CATALOG ABBREVIATIONS: the curated COURSE_ABBR map in maps.ts. This is
//      the school's real vocabulary, so it carries knowledge no algorithm can
//      derive: Science → bio, chem, phys. Art → studio. Tanach → chumash.
//      These are strictly better suggestions than anything computed, so they go
//      first.
//   2. DERIVED WORDS: an acronym plus the significant words for a multi-word
//      name, or prefixes for a single-word name. This covers every course the
//      catalog has never heard of ("Enriched Geometry B", "Studio Art II").
//
// The course NAME itself is never recommended. The parser already matches an
// exact course name outright (registry.matchByParseWords includes the name), so
// suggesting it would add a word that does nothing.

import { COURSE_ABBR } from './maps';
import { normalizeCourse } from './normalize';

const STOP_WORDS = new Set(['of', 'the', 'and', 'a', 'an', 'for', 'to', 'in', 'on', '&']);

/** Strip to comparable form: lowercase, letters and digits only. */
const key = (s: string): string => s.toLowerCase().replace(/[^a-z0-9]/g, '');

/**
 * Up to `limit` parse-word suggestions for a course name, skipping any word
 * already used by another course.
 *
 *   "Science"          → sci, bio, chem      (catalog)
 *   "Art"              → arts, studio        (catalog; "art" is the name itself)
 *   "Computer Science" → cs, compsci, comp   (catalog)
 *   "Studio Art II"    → sai, studio, art    (derived, not in the catalog)
 *   "Mathematics"      → math, mat           (derived prefixes)
 */
export function recommendParseWords(name: string, exclude: Set<string>, limit = 3): string[] {
  const trimmed = name.trim();
  if (!trimmed || trimmed.toLowerCase() === 'new course') return [];

  const candidates: string[] = [];

  // --- 1. catalog abbreviations for whichever canonical course this resolves to
  // normalizeCourse handles exact hits, substrings and typos, so "Chem Honors"
  // still finds Science and inherits sci/bio/phys.
  const canonical = normalizeCourse(trimmed);
  if (canonical) {
    for (const [abbr, canon] of Object.entries(COURSE_ABBR)) {
      if (canon === canonical) candidates.push(abbr);
    }
  }

  // --- 2. derived words, for names the catalog doesn't know
  const words = trimmed
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w && !STOP_WORDS.has(w));
  if (words.length >= 2) {
    candidates.push(words.map((w) => w[0]).join('')); // acronym, e.g. "sai"
    for (const w of words) if (w.length >= 3) candidates.push(w);
  } else if (words.length === 1) {
    const w = words[0];
    candidates.push(w);
    if (w.length > 4) candidates.push(w.slice(0, 4));
    if (w.length > 3) candidates.push(w.slice(0, 3));
  }

  // --- 3. filter and cap
  const nameKey = key(trimmed);
  const seen = new Set<string>();
  const out: string[] = [];
  for (const c of candidates) {
    const k = key(c);
    // Skip: too short to be a useful token, the course's own name, anything
    // already suggested, and anything another course has claimed.
    if (k.length < 2 || k === nameKey || seen.has(c) || exclude.has(c)) continue;
    seen.add(c);
    out.push(c);
    if (out.length === limit) break;
  }
  return out;
}
