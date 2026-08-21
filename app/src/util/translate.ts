// Cobalt: keyless task-title translation.
//
// One request per title both DETECTS the language and translates it to English, so
// English titles are left alone and anything else comes back readable. The provider
// is Google Cloud Translation, reached through Cobalt's own Cloud Function (see the
// block above translateOnce for the two providers before it and why each was left).
//
// analyzeTitle() returns a discriminated result so the caller can tell apart:
//   • 'foreign' → translate it (we have the English text + detected language)
//   • 'english' → leave it (it was already English / undetectable)
//   • 'error'   → network / rate-limit; DON'T cache, so it's retried later.

import { getPrefs } from '../prefs';
import { firebaseConfig } from '../firebase';
import {
  expandCodes, languageLabel, findLanguage, scriptOf, writesScript, type LanguageDef,
} from './languages';

export type TitleAnalysis =
  | { status: 'foreign'; text: string; sourceLang: string }
  /** Left alone. `ambiguous` means it was left alone because nothing was SURE
   *  enough, not because it read as English, so there is a real question here and
   *  the student is the one who can answer it. See translationReadings. */
  | { status: 'english'; ambiguous?: boolean }
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
  let confidence: number | null = null;
  for (let pass = 0; pass < 3; pass++) {
    const r = await translateOnce(current);
    if (r === null) return { status: 'error' }; // network fail → uncached, retried later
    if (pass === 0) {
      sourceLang = r.src;
      confidence = r.conf ?? null; // the FIRST pass is the one that read the title
    }
    if (!r.tr || normKey(r.tr) === normKey(current)) break; // stable → all-English reached
    current = r.tr;
  }

  // FIVE GATES, AND THE SECOND ONE IS A NUMBER AGAIN (Gabe, 8/20). All are in
  // gateDecision, which is where to read them; this is what each is FOR.
  //
  //   1. A LANGUAGE THE STUDENT ENABLED. Settings ▸ Tasks ▸ Languages. Nothing
  //      outside that list is ever translated, however sure the detector is.
  //   2. CONFIDENCE ≥ 0.92, straight from Google's detect(). This is the gate that
  //      was missing: "tod cod" — two of Cobalt's own parse words — was detected as
  //      Spanish, which IS on the list, translated to "to cod", and shown, because
  //      "did the text change" was the only thing left standing between junk and
  //      the screen.
  //   3. THE CHANGE GUARD. The text that came back must actually differ from the
  //      text that went in. Google hands English straight back unchanged, so an
  //      identical answer is the provider saying "there was nothing to do here" —
  //      and showing a second line identical to the first is noise either way.
  //   4. NOT JUST A TYPO FIX. See isTypoFix: a changed word that moved by one
  //      character is a spellcheck, which is what an engine does when handed
  //      something that is not a sentence in any language.
  //   5. THE SCRIPT AGREES. See scriptAgrees: Spanish is not written in the Hebrew
  //      alphabet, and characters can settle that for free.
  //
  // The old confidence gate was dropped on 8/15 for a good reason: it was read out
  // of an undocumented slot in the keyless endpoint's reply and could silently
  // refuse everything. That reason is gone. This number comes from the real Cloud
  // Translation API's detect(), asked for explicitly by the Cloud Function, and a
  // MISSING one counts as "not sure" rather than "certain" — so if detection ever
  // stops answering, the feature goes quiet instead of going wrong.
  //
  // There is no word-count rule here. A one-word title in a language you enabled,
  // detected with confidence, is a translation; length was never the thing that
  // made it trustworthy (Gabe, 8/20).
  const verdict = gateDecision({ source: key, translated: current, lang: sourceLang, conf: confidence, allowed: translateFrom() });
  const { lang, onList, sure, changed } = verdict;

  lastCheck = { title: key, detected: lang, onList, confidence, sure, translated: current, changed, typoFix: verdict.typoFix, scriptOk: verdict.scriptOk, accepted: verdict.accept };

  const out: TitleAnalysis = verdict.accept
    ? { status: 'foreign', text: current, sourceLang }
    : { status: 'english', ambiguous: isAmbiguous(key, verdict) };

  // THE NAME-A-LANGUAGE FALLBACK IS GONE (Gabe, 8/20).
  //
  // It re-asked the provider naming a specific language whenever auto-detect
  // landed on a close relative of one the student had enabled: Bosnian for Slovak,
  // Afrikaans for Dutch. It rescued real titles, and it cost more than it returned.
  //
  //   • Naming a language FORCES the engine to translate rather than decline, so
  //     the branch most likely to be handed junk was the one least able to refuse.
  //   • It bypassed the gates twice in two days. The last time it took "tod cod"
  //     at 0.646 confidence and rendered it "to cod", under a 0.92 bar.
  //   • Its guard was a language-family table being asked an empirical question
  //     about what THIS detector confuses. Those are not the same question, and
  //     the table got it wrong in both directions: it links Arabic and Hebrew,
  //     which share no script, and separates Arabic and Persian, which share one.
  //
  // What is lost: a confidently mis-detected sibling is now simply left alone. That
  // is the honest outcome, and it is the one the principle asks for. Nothing else
  // in this file depends on it, and the gate below is the whole decision now.

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

/**
 * HOW SURE THE DETECTOR HAS TO BE before a translation is shown (Gabe, 8/20 —
 * raised from the old 0.9).
 *
 * Measured against the keyless endpoint when this gate first existed: real titles
 * scored 0.97–1.00 ("דקדוק worksheet" 1.00, "tarea" 0.97) while noise scored far
 * lower ("heybo" 0.61, "bio lab" 0.41, "asdf" 0.66). 0.92 sits well clear of the
 * noise and still under every genuine title measured.
 */
const MIN_CONFIDENCE = 0.92;

/**
 * THE GATE, as a function of its inputs and nothing else.
 *
 * Pulled out so it can be exercised directly, hundreds of cases at a time, without
 * a network round-trip — the decision table is the part that has to be right, and
 * it is the part that kept being wrong (Gabe, 8/20).
 *
 * Three conditions, all required:
 *   • the detected language is one the student enabled (and is not English),
 *   • the detector was at least MIN_CONFIDENCE sure,
 *   • the text actually came back different.
 * A missing confidence is NOT confidence.
 */
/** Edit distance, capped: we only ever ask "is this 0, 1, or more than 1". */
function editDistance(a: string, b: string, cap = 2): number {
  if (a === b) return 0;
  if (Math.abs(a.length - b.length) > cap) return cap + 1;
  let prev = Array.from({ length: b.length + 1 }, (_, i) => i);
  for (let i = 1; i <= a.length; i++) {
    const row = [i];
    let best = i;
    for (let j = 1; j <= b.length; j++) {
      const v = Math.min(prev[j] + 1, row[j - 1] + 1, prev[j - 1] + (a[i - 1] === b[j - 1] ? 0 : 1));
      row.push(v);
      if (v < best) best = v;
    }
    if (best > cap) return cap + 1; // whole row already past the cap
    prev = row;
  }
  return prev[b.length];
}

/**
 * DID IT TRANSLATE, OR DID IT JUST CORRECT A TYPO? (Gabe, 8/20)
 *
 * Two live slip-ups survived the confidence gate, and they have the same shape:
 *
 *   "tod cod"  detected Spanish, confidently  ->  "to cod"
 *   "foo bar"  detected Spanish, confidently  ->  "food bar"
 *
 * Confidence cannot catch these. The detector really is sure, and the text really
 * did change, so both gates say yes. But look at WHAT changed: one word is
 * identical and the other differs by a single character. That is not a
 * translation, it is a spellcheck, and a spellcheck is what an engine falls back
 * on when it is handed something that is not a sentence in any language.
 *
 * So: a translation has to move at least one word by more than one character.
 *   "tarea" -> "homework"        every letter differs      yes
 *   "página 15" -> "page 15"     página/page is 3 edits    yes
 *   "el plan" -> "the plan"      el/the is 2 edits         yes
 *   "tod cod" -> "to cod"        tod/to is 1 edit          NO
 *   "foo bar" -> "food bar"      foo/food is 1 edit        NO
 *
 * Only applies when the two sides have the SAME number of words and are written
 * in the same script. A real translation usually changes the word count or the
 * alphabet, and either is proof enough on its own.
 */
function isTypoFix(source: string, translated: string): boolean {
  const a = source.split(' ').filter(Boolean);
  const b = translated.split(' ').filter(Boolean);
  if (!a.length || a.length !== b.length) return false; // word count moved: a real edit
  // Any word that moved by 2 or more characters means real work was done.
  return !a.some((w, i) => editDistance(w, b[i]) > 1);
}

export function gateDecision(input: {
  source: string;
  translated: string;
  lang: string;
  conf: number | null | undefined;
  allowed: Set<string>;
}): {
  lang: string;
  onList: boolean;
  sure: boolean;
  changed: boolean;
  typoFix: boolean;
  scriptOk: boolean;
  accept: boolean;
} {
  const lang = (input.lang || '').toLowerCase().split('-')[0];
  const onList = !!lang && lang !== 'en' && input.allowed.has(lang);
  const sure = typeof input.conf === 'number' && input.conf >= MIN_CONFIDENCE;
  const src = normKey(input.source || '');
  const dst = normKey(input.translated || '');
  const changed = dst !== src;
  const typoFix = changed && isTypoFix(src, dst);
  const scriptOk = scriptAgrees(input.source || '', lang);
  return {
    lang, onList, sure, changed, typoFix, scriptOk,
    accept: onList && sure && changed && !typoFix && scriptOk,
  };
}

/**
 * A TITLE IN A WRITING SYSTEM THE DETECTED LANGUAGE DOES NOT USE (Gabe, 8/20).
 *
 * The cheapest gate here, and the only one that costs nothing and cannot be argued
 * with: Spanish is not written in the Hebrew alphabet. If a Hebrew-script title
 * comes back detected as Spanish with 0.97 confidence, every other gate says yes and
 * the student gets fluent English invented out of nothing. Characters settle it.
 *
 * IT ONLY EVER LOOKS AT NON-LATIN TITLES, and that restraint is the design. Half the
 * catalog is written in more than one alphabet depending on where you are: Serbian
 * in Latin, Uzbek in Latin, Malay in Jawi. Judging a LATIN title by script would
 * refuse all of those, so a Latin title is never judged here at all — and a script
 * Cobalt does not recognize (Thaana, Meetei Mayek) reads as Latin, so an unknown
 * alphabet also passes rather than being refused for being unfamiliar. The rule can
 * only ever fire on a script we know, against a language we know does not use it.
 */
function scriptAgrees(source: string, lang: string): boolean {
  const script = scriptOf(source);
  if (script === 'latin') return true; // never judge Latin text: too many languages share it
  const def = findLanguage(lang);
  if (!def) return true; // a language we have no entry for gets the benefit of the doubt
  return writesScript(def, script);
}

/**
 * IS THERE A QUESTION HERE THAT THE STUDENT COULD ANSWER? (Gabe, 8/20)
 *
 * A refusal is not always the end of the matter. Three refusals in particular are
 * the app admitting it does not know, rather than the app knowing the answer is no:
 * a short title that could be two of your languages, a creole the detector cannot
 * place, a phrase whose words are shared across a whole family. Those are worth
 * offering a choice on. The rest are not, and telling them apart is this function.
 *
 * NOT ambiguous, and each exclusion earns its place:
 *   - The detector said ENGLISH. It is right about English essentially always, and
 *     an offer on every English task is clutter on every row a student owns.
 *   - It was ACCEPTED. There is already a translation on screen.
 *   - It was SURE of a language you did not enable. That is a clear answer, just not
 *     a welcome one; the fix is to enable that language, not to pick from a list
 *     that cannot contain the right reading.
 *   - No enabled language is even written in this title's alphabet. Offering there
 *     would be a menu of certain wrong answers.
 */
export function isAmbiguous(
  text: string,
  verdict: { lang: string; onList: boolean; sure: boolean; accept: boolean }
): boolean {
  if (verdict.accept) return false;
  if (!verdict.lang || verdict.lang === 'en') return false;
  if (verdict.sure && !verdict.onList) return false;
  return plausible(text).length > 0;
}

/** The enabled languages a title in THIS alphabet could plausibly be written in.
 *  Script does the filtering for free: a Hebrew title rules out every Latin-script
 *  language you enabled in one step, and a Latin one rules out nothing. */
function plausible(text: string): LanguageDef[] {
  const script = scriptOf(text);
  return getPrefs()
    .tasks.translateFrom.map((c) => findLanguage(c))
    .filter((d): d is LanguageDef => !!d)
    .filter((d) => writesScript(d, script));
}

/** One way a title could read, in English, and the language that reads it that way. */
export interface Reading {
  /** The language this reading assumes. */
  lang: string;
  /** Its English name, for the row. */
  label: string;
  /** The English text it produces. */
  text: string;
  /** True for the one the detector itself leaned toward, so the list can say so. */
  guess: boolean;
}

/** At most this many. Past four the menu stops being a glance and becomes a
 *  decision, and the student is being asked to do the app's job either way. */
const MAX_READINGS = 4;

/**
 * EVERY WAY THIS TITLE COULD READ: one per enabled language that could plausibly
 * have written it (Gabe, 8/20).
 *
 * This is the ONE place Cobalt names a source language to the provider, and the
 * distinction from the fallback deleted on the same day is the entire point. Naming
 * a language forces the engine to translate rather than decline, which is exactly
 * wrong when a MACHINE picks the language on a guess and exactly right when a PERSON
 * picks it: the student knows what language their class is taught in, and the
 * detector never will. Nothing here is displayed on its own authority. It is a menu,
 * built only on an explicit click, and a row becomes a translation only when it is
 * chosen.
 *
 * Readings that come back unchanged are dropped, since a row offering the title you
 * already typed is not an option. Readings identical to one already listed are
 * dropped too: two languages agreeing is one answer, not two.
 */
export async function translationReadings(text: string): Promise<Reading[] | null> {
  const key = text.trim();
  if (!key) return [];
  const defs = plausible(key);
  if (!defs.length) return [];

  // One auto-detect pass, doing two jobs: it gives the detector's own lean, which
  // orders the list, and when that lean is one of the candidates it hands us that
  // candidate's translation for free.
  const auto = await translateOnce(key);
  const guess = auto ? auto.src.toLowerCase().split('-')[0] : '';
  const isGuess = (d: LanguageDef): boolean =>
    d.code === guess || !!d.also?.some((a) => a.split('-')[0] === guess);

  const order = [...defs.filter(isGuess), ...defs.filter((d) => !isGuess(d))].slice(0, MAX_READINGS);
  // Concurrent, and at most four single-title calls, only ever on a click, against a
  // per-person cap of 4000 titles a day.
  const raw = await Promise.all(
    order.map(async (d) => (auto && isGuess(d) ? auto : await translateOnce(key, d.code)))
  );

  // NULL IS NOT AN EMPTY LIST, and the menu says two different things about them.
  // Every call failing means we never got to ask, which is a network problem the
  // student can retry; an empty list means we asked and every language read the
  // title as itself, which is an answer. Reporting the first as the second would put
  // "no language reads this as anything" on screen while the app was simply offline
  // (or, in a test harness, signed out).
  if (!auto && raw.every((r) => r === null)) return null;

  const out: Reading[] = [];
  const seen = new Set<string>();
  const src = normKey(key);
  for (let i = 0; i < order.length; i++) {
    const r = raw[i];
    if (!r || !r.tr) continue;
    const norm = normKey(r.tr);
    if (!norm || norm === src || seen.has(norm)) continue;
    seen.add(norm);
    out.push({ lang: order[i].code, label: order[i].label, text: r.tr, guess: isGuess(order[i]) });
  }
  return out;
}

/** A translated title straight from the transport, before any gating. */
interface Raw {
  /** The detected source language code, '' if the provider would not say. */
  src: string;
  /** The English text. Equal to the input when the provider had nothing to change,
   *  which is the single most useful signal this file has — see analyzeTitle. */
  tr: string;
  /** HOW SURE THE DETECTOR IS, 0–1, or null when it did not say (and when a source
   *  language was named outright, where there is nothing to detect). Never read a
   *  missing value as certainty — see MIN_CONFIDENCE. */
  conf?: number | null;
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
 *  `from` names the source language outright instead of asking Google to detect it,
 *  and it has EXACTLY ONE caller: translationReadings, building a menu for a student
 *  to choose from. Never pass a `from` the app worked out by itself. Naming a
 *  language makes the engine translate rather than decline, so anything automatic
 *  coming through this door produces confident text for input that deserved silence,
 *  which is precisely how the deleted fallback rendered "tod cod" as "to cod" at
 *  0.646 confidence under a 0.92 bar. */
async function translateOnce(text: string, from = ''): Promise<Raw | null> {
  try {
    const [one] = await callTranslate([text], from);
    if (!one || !one.tr) return null;
    // Google does not refuse English the way MyMemory did; it simply hands the text
    // back unchanged with `en` detected. That is the same signal, said differently,
    // and the caller already treats "unchanged" as "not a translation".
    // A NAMED language is the answer; there was nothing to detect. Reporting it back
    // keeps the caller from having to remember what it asked for.
    return { src: (from || one.src || '').toLowerCase(), tr: one.tr, conf: one.conf ?? null };
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
