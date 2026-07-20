// WorkSpace — keyless task-title translation.
//
// Uses Google's public "gtx" endpoint, which is an ML translator that BOTH
// auto-detects the source language AND translates in a single call — no API key,
// and it sends `Access-Control-Allow-Origin: *` so the browser can call it
// directly. That one call is how we "read every task and tell if it's in another
// language": the endpoint reports the detected source language, so English is left
// alone and anything else comes back translated.
//
// analyzeTitle() returns a discriminated result so the caller can tell apart:
//   • 'foreign' → translate it (we have the English text + detected language)
//   • 'english' → leave it (it was already English / undetectable)
//   • 'error'   → network / rate-limit; DON'T cache, so it's retried later.

export type TitleAnalysis =
  | { status: 'foreign'; text: string; sourceLang: string }
  | { status: 'english' }
  | { status: 'error' };

// Non-Latin scripts (Hebrew, Arabic, Cyrillic, Greek, CJK, Hangul, Kana,
// Devanagari, Thai). A cheap, offline "definitely foreign" hint — kept for
// callers that want a synchronous check without a network round-trip.
const FOREIGN_SCRIPT =
  /[Ͱ-ϿЀ-ӿ֐-׿؀-ۿ܀-ݏऀ-ॿ฀-๿ᄀ-ᇿ぀-ヿ㐀-䶿一-鿿가-힯]/;

/** True when `text` clearly contains a non-Latin (foreign) script. Synchronous. */
export function looksForeign(text: string): boolean {
  return !!text && FOREIGN_SCRIPT.test(text);
}

// Successful analyses are cached per string for the session; errors are NOT cached
// (a title checked while offline should be retried on the next pass).
const cache = new Map<string, TitleAnalysis>();

/**
 * Ask the translator to read `text`: detect its language and, if it isn't
 * entirely English, translate everything to English (keeping any English parts).
 */
export async function analyzeTitle(text: string): Promise<TitleAnalysis> {
  const key = text.trim();
  if (!key) return { status: 'english' };
  const cached = cache.get(key);
  if (cached) return cached;

  // Translate, then re-translate the result until it stops changing. gtx's
  // auto-detect only translates ONE detected source language per call, so a title
  // mixing two non-English languages ("שלום hola clase") needs another pass to
  // finish; a pass that changes nothing means we've reached all-English. English
  // parts pass through untouched, so "hola clase, do page 15" keeps "do page 15".
  let current = key;
  let sourceLang = '';
  for (let pass = 0; pass < 3; pass++) {
    const r = await translateOnce(current);
    if (r === null) return { status: 'error' }; // network fail → uncached, retried later
    if (pass === 0) sourceLang = r.src;
    if (!r.tr || normKey(r.tr) === normKey(current)) break; // stable → all-English reached
    current = r.tr;
  }

  const out: TitleAnalysis =
    normKey(current) === normKey(key)
      ? { status: 'english' }
      : { status: 'foreign', text: current, sourceLang };
  cache.set(key, out);
  return out;
}

/** One round-trip to the endpoint. Returns { src, tr } or null on network failure. */
async function translateOnce(text: string): Promise<{ src: string; tr: string } | null> {
  try {
    const url =
      'https://translate.googleapis.com/translate_a/single?client=gtx&sl=auto&tl=en&dt=t&q=' +
      encodeURIComponent(text);
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = await res.json();
    // Response shape: [ [ [translatedChunk, originalChunk, …], … ], null, "iw", … ]
    const src = Array.isArray(data) && typeof data[2] === 'string' ? data[2] : '';
    const chunks: unknown = Array.isArray(data) ? data[0] : null;
    const tr = Array.isArray(chunks)
      ? chunks.map((c) => (Array.isArray(c) && typeof c[0] === 'string' ? c[0] : '')).join('').trim()
      : '';
    return { src, tr };
  } catch {
    return null;
  }
}

/** Compare two strings ignoring case, punctuation, and whitespace (letters+digits only). */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Human-readable name for a detected language code (for tooltips). */
export function languageName(code: string): string {
  const c = (code || '').toLowerCase();
  const map: Record<string, string> = {
    iw: 'Hebrew', he: 'Hebrew', yi: 'Yiddish', ar: 'Arabic', ru: 'Russian',
    es: 'Spanish', fr: 'French', de: 'German', it: 'Italian', pt: 'Portuguese',
    zh: 'Chinese', 'zh-cn': 'Chinese', 'zh-tw': 'Chinese', ja: 'Japanese',
    ko: 'Korean', el: 'Greek', hi: 'Hindi', th: 'Thai', la: 'Latin',
  };
  return map[c] || (code ? code.toUpperCase() : 'another language');
}
