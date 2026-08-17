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
import { firebaseConfig } from '../firebase';
import { areSiblings, expandCodes, findLanguage, languageLabel, scriptOf, writesScript } from './languages';

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

  let out: TitleAnalysis =
    !trustworthy || normKey(current) === normKey(key)
      ? { status: 'english' }
      : { status: 'foreign', text: current, sourceLang };

  // ---- FALLBACK: ask by NAME when auto-detect guessed wrong ----------------
  //
  // Auto-detect confuses closely-related languages, and it does it worse on longer
  // text, which is exactly backwards from what you would expect. Measured against
  // the live API on 8/15, with Slovak:
  //
  //   "Som v pohode"                 → detected sk  → "I'm fine"           ✓
  //   "Prečítaj si kapitolu sedem"   → detected BS  → unchanged            ✗
  //   "Korýtnačka porazila zajaca"   → detected BS  → unchanged            ✗
  //   "Domáca úloha z matematiky"    → detected MG  → unchanged            ✗
  //
  // Every one of those translates correctly when the pair is named outright
  // (sk|en → "Read chapter seven", "Math homework"). So a mis-detect is not a
  // dead end; it just means the question has to be asked differently. This is
  // Gabe's report exactly: short phrases worked, longer ones silently did not.
  //
  // TWO GUARDS, and both are load-bearing:
  //
  //   1. THREE WORDS MINIMUM. Naming a language outright forces the engine to
  //      translate rather than decline, so it will happily turn junk into
  //      something. Measured: "huu" as Spanish → "HUU,", "asdf" as Spanish → a
  //      line of German. Every false positive this feature has ever produced was
  //      one or two words; a mis-detect only bites real sentences. So the two
  //      cases are separated by length, and the short one never reaches here.
  //   2. NOT ALREADY ENGLISH. The provider refuses English outright ("PLEASE
  //      SELECT TWO DISTINCT LANGUAGES"), and that answer is trusted. Without this
  //      guard, "Read Ch. 7 and annotate" asked as Spanish comes back "Read Ch. 7
  //      and note" — an English title quietly reworded.
  // WHEN COBALT SECOND-GUESSES THE DETECTOR.
  //
  // Only two cases, and the difference between them is the whole fix for the Asian
  // languages (Gabe, 8/16):
  //
  //  1. IT NAMED NOTHING. No answer is not an answer; ask the student's languages
  //     outright.
  //  2. IT NAMED A CLOSE RELATIVE of a language they enabled. Afrikaans against
  //     Dutch, Bosnian against Slovak: a short sentence genuinely cannot separate
  //     those, so it is worth asking again. THIS is what rescues "Huiswerk wiskunde"
  //     and the Slovak sentences.
  //
  // Everything else stands. If it names Chinese and the student enabled Japanese,
  // that is not a near-miss — those are unrelated families that happen to share a set
  // of characters — so the title is left alone. Treating that as a near-miss is what
  // translated Chinese titles out of a language nobody had turned on.
  //
  // The script check stays on top: a language that cannot be written this way is
  // never asked, however close a relative it is.
  const script = scriptOf(key);
  const words = key.replace(/[^\p{L}\p{N}]+/gu, ' ').trim().split(' ').filter(Boolean);
  const enabled = getPrefs().tasks.translateFrom;
  const nearMiss = !!lang && enabled.some((c) => areSiblings(lang, findLanguage(c)?.code || c));
  // Length only constrains LATIN text, and only when there is no near-miss to go on:
  // it guards English-looking junk ("huu", "asdf"), all of which is Latin and none of
  // which a detector calls a sibling of anything enabled.
  const longEnough = script !== 'latin' || words.length >= (nearMiss ? 2 : 3);
  if (out.status === 'english' && (!lang || nearMiss) && longEnough) {
    for (const code of enabled) {
      const def = findLanguage(code);
      if (!writesScript(def, script)) continue; // it cannot be written this way
      // With a near-miss, ask ONLY the relative — not every enabled language, which
      // is how an unrelated one used to get a turn.
      if (lang && !areSiblings(lang, def?.code || code)) continue;
      const ask = def?.also?.[0] || def?.code || code; // the code the provider knows
      const r = await translateOnce(key, ask);
      if (!r) break; // network trouble — leave it unchecked and try again later
      if (r.tr && normKey(r.tr) !== normKey(key)) {
        out = { status: 'foreign', text: r.tr, sourceLang: def?.code || code };
        lastCheck = { ...lastCheck, fallbackAskedAs: ask, accepted: true, translated: r.tr };
        break;
      }
    }
  }

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
 * THE PROVIDER: Google Cloud Translation, through Cobalt's own Cloud Function.
 *
 * Third provider, and the reasons for each move are worth keeping:
 *
 *   • Google's KEYLESS "gtx" endpoint. Free, no setup, and it died: it now answers
 *     every request with a redirect to a reCAPTCHA page. Verified two ways on 8/15
 *     (browser console showed `net::ERR_FAILED 302` then a CORS error on the
 *     redirect target; a request from outside a browser returned the challenge HTML)
 *     so it was never a CORS problem a proxy could route around.
 *   • MyMemory. Free, CORS-open, and good enough to ship in an afternoon — but its
 *     engine is visibly weaker on names and proper nouns. Gabe, 8/16: a Swahili
 *     sentence about a turtle came back "Kobe beats the buffalo". No amount of
 *     gating on this side improves a translation that is simply wrong.
 *   • THIS. The real Cloud Translation API, on Cobalt's own project.
 *
 * It goes through a Cloud Function rather than straight from the page, and that is
 * not ceremony: an API key in a bundle is a key anyone can read and spend. The
 * function authenticates as the project itself, so there is no key in the client at
 * all. It also batches, though this module asks one title at a time because each
 * answer feeds the next decision.
 */
async function callTranslate(texts: string[], from = ''): Promise<(Raw | null)[]> {
  const { initializeApp, getApps, getApp } = await import('firebase/app');
  const { getFunctions, httpsCallable } = await import('firebase/functions');
  const app = getApps().length ? getApp() : initializeApp(firebaseConfig);
  const fn = httpsCallable(getFunctions(app, 'us-central1'), 'translateTitles');
  const res = await fn(from ? { texts, from } : { texts });
  const out = (res.data as { results?: (Raw | null)[] })?.results;
  return Array.isArray(out) ? out : texts.map(() => null);
}

/** One round-trip. Returns null on any failure, which the caller treats as "ask
 *  again later" rather than "this title is English".
 *
 *  `from` names the source language outright instead of asking Google to detect it —
 *  see the fallback in analyzeTitle for why that is sometimes the only way to get a
 *  right answer. */
async function translateOnce(text: string, from = ''): Promise<Raw | null> {
  try {
    const [one] = await callTranslate([text], from);
    if (!one || !one.tr) return null;
    // Google does not refuse English the way MyMemory did; it simply hands the text
    // back unchanged with `en` detected. That is the same signal, said differently,
    // and the caller already treats "unchanged" as "not a translation".
    return { src: (one.src || '').toLowerCase(), tr: one.tr };
  } catch {
    return null;
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
