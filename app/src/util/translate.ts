// Cobalt: keyless task-title translation.
//
// One request per title both DETECTS the language and translates it to English, so
// English titles are left alone and anything else comes back readable. The provider
// is MyMemory (see the block above translateOnce for why it is not Google any more,
// and why that was not a choice).
//
// analyzeTitle() returns a discriminated result so the caller can tell apart:
//   • 'foreign' → translate it (we have the English text + detected language)
//   • 'english' → leave it (it was already English / undetectable)
//   • 'error'   → network / rate-limit; DON'T cache, so it's retried later.

import { getPrefs } from '../prefs';
import { expandCodes, languageLabel } from './languages';

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
  // No languages picked = translation off. Answer without a round-trip: this is the
  // one path that must stay free, since it runs over every task on every import.
  if (!getPrefs().tasks.translateFrom.length) return { status: 'english' };
  const cached = cache.get(key);
  if (cached) return cached;

  // Translate, then re-translate the result until it stops changing. Auto-detect
  // only translates ONE detected source language per call, so a title mixing two
  // non-English languages ("שלום hola clase") needs another pass to finish; a pass
  // that changes nothing means we've reached all-English. English parts pass through
  // untouched, so "hola clase, do page 15" keeps "do page 15".
  let current = key;
  let sourceLang = '';
  for (let pass = 0; pass < 3; pass++) {
    const r = await translateOnce(current);
    if (r === null) return { status: 'error' }; // network fail → uncached, retried later
    if (pass === 0) sourceLang = r.src;
    if (!r.tr || normKey(r.tr) === normKey(current)) break; // stable → all-English reached
    current = r.tr;
  }

  // A CHANGED STRING IS NOT ENOUGH (Gabe, 8/15). This used to decide "foreign"
  // purely by whether the translation differed from the input, never looking at what
  // language was detected or how sure the detector was. Two gates now, because one
  // was not enough:
  //
  //   1. CONFIDENCE ≥ 0.9. Measured live: real titles score 0.97-1.00
  //      ("דקדוק worksheet" iw 1.00, "tarea" es 0.97), noise scores far lower
  //      ("heybo" so 0.61, "bio lab" da 0.41, "asdf" ar 0.66).
  //   2. A LANGUAGE WE ACTUALLY TRANSLATE. Confidence cannot catch "huu", which
  //      Google calls Swahili at 1.00 and renders "this one" — correctly, since it
  //      is a real Swahili word. Only the allowlist rules that out.
  const lang = (sourceLang || '').toLowerCase().split('-')[0];
  const onList = !!lang && lang !== 'en' && translateFrom().has(lang);
  // THE SECOND GATE IS "DID THE TEXT ACTUALLY CHANGE", and it replaces the
  // confidence score the old provider reported (Gabe, 8/15).
  //
  // That score was never the right instrument. It was a hard gate read out of a
  // fixed slot in an undocumented response, so it could silently refuse everything,
  // and it could not tell a real Spanish title from a real Spanish-looking accident.
  // The provider leaving the text UNTOUCHED is a far better signal, and it is
  // measured, not guessed: "huu" comes back as "huu", "heybo" as "heybo", "asdf" as
  // "asdf" — every one of the false positives that started this, rejected by one
  // rule. A genuine title changes: "tarea" → "task", "דקדוק" → "Grammar",
  // "chapitre 3" → "chapter 3".
  //
  // The check itself is the normKey comparison in `out` just below, which was
  // already there; what changed is that it is now load-bearing rather than a
  // backstop behind a number.
  const trustworthy = onList;
  lastCheck = { title: key, detected: lang, onList, translated: current, changed: normKey(current) !== normKey(key), accepted: trustworthy && normKey(current) !== normKey(key) };

  const out: TitleAnalysis =
    !trustworthy || normKey(current) === normKey(key)
      ? { status: 'english' }
      : { status: 'foreign', text: current, sourceLang };
  cache.set(key, out);
  return out;
}

/** Why the last title was accepted or rejected. Read it from the console as
 *  `window.__cobaltTranslate` when a title is not behaving as expected — it saves
 *  guessing about which of the two gates said no. */
let lastCheck: Record<string, unknown> = {};
Object.defineProperty(window, '__cobaltTranslate', { get: () => lastCheck, configurable: true });

/**
 * THE LANGUAGES COBALT WILL TRANSLATE FROM. Everything else is left alone.
 *
 * Now the student's own list (Settings ▸ Tasks ▸ Languages), defaulting to Hebrew,
 * Spanish, Arabic and French. It used to be hard-coded, and the reason it is an
 * allowlist at all has not changed: confidence alone cannot save us, and "huu"
 * proves it. Google reports Swahili at 1.00 and renders it "this one", because
 * *huu* really is a Swahili word. No threshold separates that from a genuine
 * Spanish title, since both are confident and both are correct. The detector was
 * never wrong; the QUESTION was. "Is this any of 100+ languages" guarantees that
 * short English-ish tokens keep landing on real words nobody here writes. "Is this
 * one of the four languages my classes are actually in" ends the whole class of
 * false positive.
 *
 * Read fresh on every call rather than captured once, so changing the list in
 * Settings applies to the very next title without a reload.
 */
function translateFrom(): Set<string> {
  return expandCodes(getPrefs().tasks.translateFrom);
}

/** Fired when the student's language list changes. The Tasks view listens and
 *  re-scans, which is the ONLY thing that makes a change visible on tasks that
 *  already exist (see below). */
export const TRANSLATE_LANGS_EVENT = 'ws:translate-langs-changed';

/** Settings calls this when the language list changes.
 *
 *  Two layers of staleness, and clearing one without the other is exactly the bug
 *  Gabe hit on 8/15 ("huu translates without Swahili; Portuguese on, still no
 *  translation"):
 *
 *   1. THIS session cache, keyed by string. Verdicts in it were reached under the
 *      OLD list.
 *   2. The `translationChecked` flag written ONTO each task. That one outlives the
 *      page, so a task judged before the picker existed keeps its old answer
 *      forever — a stale translation stays visible and a newly-enabled language is
 *      never applied to anything already imported.
 *
 *  Clearing the cache handles (1). The event handles (2). */
export function resetTranslationCache(): void {
  cache.clear();
  window.dispatchEvent(new CustomEvent(TRANSLATE_LANGS_EVENT));
}

/** A translated title straight from the transport, before any gating. */
interface Raw {
  /** The detected source language code, '' if the provider would not say. */
  src: string;
  /** The English text. Equal to the input when the provider had nothing to change,
   *  which is the single most useful signal this file has — see analyzeTitle. */
  tr: string;
}

/**
 * THE PROVIDER: MyMemory.
 *
 * Cobalt used Google's keyless "gtx" endpoint. That is gone. It now answers every
 * request with a 302 to a reCAPTCHA challenge page, verified two ways on 8/15:
 * Gabe's browser console showed `net::ERR_FAILED 302 (Found)` followed by a CORS
 * error on the redirect target, and a direct server-side request from outside the
 * browser returns the challenge HTML rather than JSON. So it was not a CORS problem
 * that a proxy or a Cloud Function could route around — the endpoint itself is
 * closed. A dev proxy and a server-side function were both built and both deleted
 * once that was established.
 *
 * MyMemory is a straight replacement and, for this job, a better one:
 *   • It sends `Access-Control-Allow-Origin: *`, so the browser calls it directly.
 *     No proxy, no Cloud Function, no deploy, and nothing to keep alive.
 *   • `autodetect|en` both detects and translates in one request, which is what the
 *     old endpoint was chosen for.
 *   • Handed English, it REFUSES with "PLEASE SELECT TWO DISTINCT LANGUAGES". A
 *     provider that says "that is already English" outright is worth more than a
 *     confidence score to interpret.
 *
 * Free tier is 5,000 characters per day per IP, or 50,000 with a contact address
 * attached (`de=`), which is what CONTACT below is for. Task titles run about 45
 * characters, so that is roughly a thousand a day per student, against a heavy
 * import of maybe forty.
 */
const MYMEMORY = 'https://api.mymemory.translated.net/get';
const CONTACT = 'workspace.reminders@gmail.com'; // raises the daily allowance; see above

/** One round-trip. Returns null on a network or quota failure, which the caller
 *  treats as "ask again later" rather than "this title is English". */
async function translateOnce(text: string): Promise<Raw | null> {
  try {
    const url =
      `${MYMEMORY}?q=${encodeURIComponent(text)}&langpair=${encodeURIComponent('autodetect|en')}` +
      `&de=${encodeURIComponent(CONTACT)}`;
    const res = await fetch(url);
    if (!res.ok) return null;
    const data = (await res.json()) as {
      responseStatus?: number | string;
      responseData?: { translatedText?: string; detectedLanguage?: string };
      responseDetails?: string;
      quotaFinished?: boolean;
    };
    const status = Number(data.responseStatus);
    const details = String(data.responseDetails || '');

    // "PLEASE SELECT TWO DISTINCT LANGUAGES" = the provider read it as English
    // already. That is an ANSWER, not a failure, so it must not be reported as an
    // error — an error would leave the task unchecked and re-asked forever.
    if (status === 403 && /DISTINCT LANGUAGES/i.test(details)) return { src: 'en', tr: text };

    if (data.quotaFinished || status === 429) return null; // out of allowance → retry tomorrow
    if (status !== 200) return null;

    const tr = String(data.responseData?.translatedText || '').trim();
    const src = String(data.responseData?.detectedLanguage || '').trim().toLowerCase();
    if (!tr) return null;
    return { src, tr };
  } catch {
    return null; // offline → uncached, retried on the next pass
  }
}

/** Compare two strings ignoring case, punctuation, and whitespace (letters+digits only). */
function normKey(s: string): string {
  return s.toLowerCase().replace(/[^\p{L}\p{N}]+/gu, ' ').trim();
}

/** Human-readable name for a detected language code (for tooltips). One table, in
 *  util/languages.ts, so the picker and the tooltip can never disagree. */
export function languageName(code: string): string {
  return languageLabel(code);
}
