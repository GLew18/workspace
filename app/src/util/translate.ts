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
   *  the student is the one who can answer it. See rankCandidates. */
  | { status: 'english'; ambiguous?: boolean; detected?: string }
  | { status: 'error' };

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
    : { status: 'english', ambiguous: isAmbiguous(key, verdict), detected: verdict.lang };

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

/** Diacritics are evidence in `chars`, and noise everywhere else: a teacher typing
 *  "capitulo" for "cap\u00edtulo" still wrote Spanish. Stripped before the word and
 *  ending tests so both spellings match. */
function bare(t: string): string {
  return t.toLowerCase().normalize('NFD').replace(/[\u0300-\u036f]/g, '');
}

/**
 * COULD THIS LANGUAGE HAVE WRITTEN THIS, AT ALL? (Gabe, 8/21)
 *
 * Script is the first answer and a free one: a Hebrew title rules out every
 * Latin-script language in a single step, which is why Hebrew titles have always
 * behaved. The problem is that script says NOTHING inside the Latin alphabet, where
 * ninety languages live, so "importante test si" was offering Vietnamese.
 *
 * This is the second answer, for the languages where writing system alone settles it.
 * Two kinds of rule, both hard exclusions rather than scores:
 *
 *   letters   the alphabet this language uses. Maori has no s, b, c, d, f or l, so a
 *             title containing one was not written in Maori. Not a preference: those
 *             letters do not exist in the orthography.
 *   clusters  consonant runs the language does not form. Vietnamese syllables take a
 *             fixed set of onsets (ch, gh, kh, ng, nh, ph, th, tr, qu, gi) and nothing
 *             else, so "mp", "rt", "st" and "nt" are all impossible in it. "importante
 *             test" contains three of them.
 *
 * DELIBERATELY PARTIAL. Only languages whose orthography genuinely forbids something
 * are listed, and a language absent from this table is never excluded by it. Spanish
 * against Portuguese against Catalan cannot be settled this way (they share an
 * alphabet and a syllable structure), and pretending otherwise would trade a visible
 * wrong answer for an invisible one. Those are separated by EVIDENCE and ranked, not
 * excluded. What this table does is stop languages from a different linguistic world
 * appearing in a list of Romance candidates at all.
 */
/**
 * CHARACTERS THAT NAME THEIR OWN LANGUAGE (Gabe, 8/21).
 *
 * The strongest signal on the page, and it was being thrown away. "Tôi muốn đi vệ
 * sinh." is unmistakably Vietnamese, and it came back offering French FIRST, because
 * both languages matched on the one character they share (ô) and history broke the
 * tie. Meanwhile ố and ệ sat there in the same sentence, used by Vietnamese and by
 * nothing else on earth.
 *
 * So these are not scored, they RESTRICT. A mark present in the title means the title
 * was written in one of the languages that uses it, and every language that does not
 * is out. Several marks intersect: a title with both ß and ł has no candidates,
 * which is the correct answer to an impossible question.
 *
 * ONLY GENUINELY DIAGNOSTIC MARKS BELONG HERE, and the bar is high because the cost of
 * being wrong is a language silently excluded from its own words. ç and ñ are
 * deliberately absent: half a dozen unrelated languages use each, so they discriminate
 * badly and are left to the scoring layer. Everything below is a mark whose users can
 * be listed exhaustively.
 */
const MARKS: Array<[RegExp, string[]]> = [
  // Vietnamese tone marks. The whole Latin Extended Additional block plus ơ/ư is
  // Vietnamese and nothing else in this catalog.
  [/[\u1ea0-\u1ef9\u01a1\u01b0]/, ['vi']],
  [/\u00df/, ['de']],                                   // ß
  [/[\u0151\u0171]/, ['hu']],                            // ő ű
  [/[\u0142\u0105\u0119\u017c\u017a\u015b\u0107\u0144]/, ['pl']],      // ł ą ę ż ź ś ć ń
  [/[\u0219\u021b]/, ['ro']],                            // ș ț (comma below, Romanian)
  [/[\u0131\u011f]/, ['tr', 'az']],                      // ı ğ
  [/[\u00fe\u00f0]/, ['is']],                            // þ ð
  [/[\u00e6\u00f8]/, ['da', 'no', 'is']],                // æ ø
  [/\u00e5/, ['sv', 'da', 'no', 'fi', 'is']],           // å
  [/[\u010d\u0161\u017e]/, ['cs', 'sk', 'sl', 'hr', 'bs', 'sr', 'lv', 'lt', 'et', 'rom', 'tk', 'fi']], // č š ž
  [/\u0111/, ['vi', 'hr', 'bs', 'sr']],                 // đ
];

/** The languages a title's diacritics permit. Empty list = the marks say nothing. */
function markedLanguages(text: string): string[] | null {
  let allowed: string[] | null = null;
  for (const [re, codes] of MARKS) {
    if (!re.test(text)) continue;
    allowed = allowed === null ? codes.slice() : allowed.filter((c) => codes.indexOf(c) >= 0);
  }
  return allowed;
}

interface Shape {
  /** Letters this orthography does NOT contain. A match rules the language out. */
  letters?: RegExp;
  /** Two-letter sequences that are ONE sound here, removed before the cluster test.
   *  Maori is the reason: "whakarongo" and "ngahuru" are ordinary Maori words, and a
   *  rule that reads "wh" and "ng" as consonant clusters would rule Maori out of its
   *  own vocabulary. */
  digraphs?: RegExp;
  /** Consonant runs this orthography does not form. A match rules it out. */
  clusters?: RegExp;
}
const SHAPE: Record<string, Shape> = {
  // Vietnamese: no consonant clusters beyond a fixed list of digraph onsets, and no
  // f, j, w or z in the alphabet.
  vi: {
    letters: /[fjwz]/,
    clusters: /(bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|sc|sk|sl|sm|sn|sp|st|sw|tw|mp|mb|nd|nt|nk|rt|rn|rs|rd|rk|rm|rp|lt|ln|ls|ld|lk|lm|lp|ct|pt|ft|xt|ks)/,
  },
  // Swahili: open syllables. The only clusters are prenasalised (mb, mp, nd, ng, nj,
  // ny, nz) and consonant + w/y, so a European cluster rules it out.
  sw: { clusters: /(rt|rn|rs|rd|rk|rm|rp|st|sk|sp|sl|sm|sn|ct|pt|ft|lt|ld|lk|lm|lp|xt|bl|br|cl|cr|dr|fl|fr|gl|gr|pl|pr|tr)/ },
  // Polynesian: tiny alphabets, and every syllable ends in a vowel.
  haw: { letters: /[bcdfgjqrstvxyz]/, clusters: /[bcdfghjklmnpqrstvwxyz]{2}/ },
  sm: { letters: /[bcdhjkqrwxyz]/, clusters: /[bcdfghjklmnpqrstvwxyz]{2}/ },
  mi: { letters: /[bcdfjlqsvxyz]/, digraphs: /(wh|ng)/g, clusters: /[bcdfhjklmnpqrstvwxyz]{2}/ },
  fj: { clusters: /[bcdfghjklmnpqrstvwxyz]{3}/ },
  // Japanese and Korean in romanisation, for the same reason: no European clusters.
  ja: { clusters: /(rt|st|nt|mp|ct|pt|ft|lt|ld|rk|rd|sp|sk)/ },
  ko: { clusters: /(rt|st|nt|mp|ct|pt|ft|lt|ld|rk|rd|sp|sk)/ },
};

/** Is this language's writing system capable of the letters in this title? */
function shapeAllows(code: string, flat: string): boolean {
  const sh = SHAPE[code];
  if (!sh) return true; // no rule = no opinion, never an exclusion
  if (sh.letters?.test(flat)) return false;
  if (!sh.clusters) return true;
  // Digraphs come out first, so a two-letter single sound is never counted as a run.
  const body = sh.digraphs ? flat.replace(sh.digraphs, 'a') : flat;
  return !sh.clusters.test(body);
}

/**
 * The enabled languages that could plausibly have written this title.
 *
 * Four filters, each a hard exclusion, cheapest and most certain first:
 *   1. SCRIPT      a Hebrew title is not written in a Latin-script language.
 *   2. MARKS       a title containing ố was written in Vietnamese, full stop.
 *   3. SHAPE       Vietnamese forms no "mp", Maori has no letter s.
 *   4. RULED OUT   the provider has already handed this exact title back unchanged
 *                  for that language, which is it saying it cannot read it.
 */
function plausible(text: string, ruledOut: readonly string[] = []): LanguageDef[] {
  const script = scriptOf(text);
  const flat = bare(text);
  const marked = markedLanguages(text);
  return getPrefs()
    .tasks.translateFrom.map((c) => findLanguage(c))
    .filter((d): d is LanguageDef => !!d)
    .filter((d) => writesScript(d, script))
    .filter((d) => !marked || marked.indexOf(d.code) >= 0)
    .filter((d) => shapeAllows(d.code, flat))
    .filter((d) => ruledOut.indexOf(d.code) < 0);
}

/**
 * TWO TO FOUR, ALWAYS (Gabe, 8/21).
 *
 * The floor is not a nicety, it is what makes this row internally consistent. The row
 * only exists when the detector was NOT confident enough to act (see isAmbiguous). So
 * a row that offers exactly one language is asserting a confidence the app just said
 * out loud that it did not have: if it were that sure, it would have translated the
 * title and shown no buttons at all. High contention is the entry condition, and
 * contention means contenders, plural.
 *
 * The honest reading of a one-button row was never "it is definitely Spanish", it was
 * "Spanish is ahead, and everything else is a wash" — which is exactly the moment a
 * student's own knowledge is worth more than the ranking's.
 */
export const MAX_CHIPS = 3;
const MIN_CHIPS = 2;


/**
 * WHAT A TITLE LOOKS LIKE IN A GIVEN LANGUAGE, as far as it can be told for free.
 *
 * Three kinds of evidence, cheapest first:
 *   chars   letters that language uses and most of its neighbours do not (ñ, ã, ş, ł)
 *   words   its commonest function words, which are what short titles are made of
 *   ends    endings that belong to it (-ción, -ção, -zione, -ung)
 *
 * Only Latin-script languages are here, and that is the point: script already
 * separates Hebrew from Greek from Han for free (see scriptOf), so the work left is
 * telling apart the ninety languages that share one alphabet. A language absent from
 * this table simply scores no evidence, which ranks it below any language that did,
 * and never rules it out.
 *
 * This is a RANKING aid, never a verdict. Nothing here decides whether to translate:
 * that is the five gates in analyzeTitle, and they are untouched. All this decides is
 * which two-to-five names to put under the student's thumb first.
 */
/**
 * SPELLING THAT BELONGS TO A WHOLE FAMILY, not to one language (Gabe, 8/21).
 *
 * The per-language table below is deliberately made of DISTINCTIVE marks, which is
 * right for picking a winner and useless for picking a field. "importante" is a real
 * word in Spanish, Portuguese, Italian and Catalan and carries no mark of any one of
 * them, so every language scored zero, the list fell through to the tie-break, and a
 * Spanish-looking word came back offering Italian and Portuguese with Spanish nowhere.
 *
 * These endings say "this is a Romance word" or "this is a Germanic word" without
 * saying which. Scored LOW on purpose: enough to lift a whole family above languages
 * that have nothing to do with the title, never enough to outrank a real mark like
 * ñ or "tarea". The job is to get the right FOUR on screen and let the detector, the
 * evidence and the student's own history order them.
 */
const FAMILY: Array<[RegExp, string[]]> = [
  // Romance. Accents are already stripped by bare(), so -ción/-ção arrive as cion/cao.
  [/(ante|ente|encia|ancia|cion|coes|cao|zione|mento|ista|ivo|iva|oso|osa|idad|dade|tat)\b/,
   ['es', 'pt', 'it', 'ca', 'gl', 'fr', 'ro']],
  [/(ung|heit|keit|schaft|lijk|lik|lich|ing)\b/, ['de', 'nl', 'af', 'sv', 'da', 'no', 'is']],
  [/(ost|ova|ski|cki|nie|nia)\b/, ['pl', 'cs', 'sk', 'hr', 'sl']],
];

interface Evidence {
  /** Letters this language uses that most of its neighbours do not. */
  chars?: RegExp;
  /** THE WORDS THIS APP ACTUALLY SEES. Every title here is a piece of homework, so
   *  "tarea", "devoir", "Hausaufgaben" and "compito" are worth more than any amount
   *  of grammar: they are unambiguous, and they are what teachers write. */
  school?: RegExp;
  /** Endings that belong to this language. */
  ends?: RegExp;
  /** Function words, DISTINCTIVE ones only. "de" is Spanish, Portuguese, Catalan,
   *  French and Dutch at once, so matching it says nothing while looking like it
   *  said something: "tarea de matematicas" scored five languages on that one word
   *  (Gabe, 8/21). Shared tokens are left out on purpose. */
  words?: RegExp;
}

const EVIDENCE: Record<string, Evidence> = {
  es: {
    chars: /[\u00f1\u00a1\u00bf]/i,
    school: /\b(tarea|tareas|deberes|examen|prueba|ensayo|capitulo|pagina|trabajo|leer|escribir|estudiar|resumen|ejercicio|repaso|apuntes|entrega)\b/,
    words: /\b(el|la|los|las|del|que|para|con|una|por|mi|su|hasta|sobre)\b/,
    ends: /(cion|ciones|dad|mente)\b/,
  },
  pt: {
    chars: /[\u00e3\u00f5\u00e7]/i,
    school: /\b(tarefa|dever|deveres|prova|exame|redacao|capitulo|pagina|trabalho|ler|escrever|estudar|resumo|exercicio|entrega)\b/,
    words: /\b(os|as|dos|das|que|para|com|uma|nao|voce|pelo|pela)\b/,
    ends: /(cao|coes|dade|mente)\b/,
  },
  ca: {
    chars: /[\u00e7\u00b7]/i,
    school: /\b(tasca|deures|examen|prova|redaccio|capitol|pagina|treball|llegir|escriure|estudiar|resum|exercici)\b/,
    words: /\b(els|les|amb|aquest|aquesta|per|molt|tambe)\b/,
    ends: /(cio|tat|ment)\b/,
  },
  gl: {
    chars: /[\u00f1]/i,
    school: /\b(tarefa|exame|proba|redaccion|capitulo|paxina|traballo|ler|escribir|estudar|resumo|exercicio)\b/,
    words: /\b(unha|coa|polo|pola|tamen)\b/,
    ends: /(cion|dade|mente)\b/,
  },
  it: {
    chars: /[\u00e8\u00ec\u00f9]/i,
    school: /\b(compito|compiti|verifica|esame|tema|capitolo|pagina|lavoro|leggere|scrivere|studiare|riassunto|esercizio|interrogazione)\b/,
    words: /\b(il|lo|gli|del|che|per|con|una|non|sono|anche|molto)\b/,
    ends: /(zione|zioni|mente|ta)\b/,
  },
  fr: {
    chars: /[\u00e2\u00ea\u00ee\u00f4\u00fb\u00eb\u00ef]/i,
    school: /\b(devoir|devoirs|controle|examen|redaction|chapitre|travail|lire|ecrire|etudier|resume|exercice|expose|interro)\b/,
    words: /\b(les|du|des|pour|avec|une|est|aux|dans|pas|cette|leur)\b/,
    ends: /(ement|eux|euse)\b/,
  },
  ro: {
    chars: /[\u0103\u00e2\u00ee\u0219\u021b]/i,
    school: /\b(tema|teme|examen|lucrare|capitolul|pagina|citeste|scrie|rezumat|exercitiu)\b/,
    words: /\b(si|este|care|pentru|acest|dintre)\b/,
    ends: /(tie|ului|ilor)\b/,
  },
  de: {
    chars: /[\u00e4\u00f6\u00fc\u00df]/i,
    school: /\b(hausaufgabe|hausaufgaben|klausur|prufung|pruefung|aufsatz|kapitel|seite|arbeit|lesen|schreiben|lernen|zusammenfassung|ubung|uebung|referat)\b/,
    words: /\b(der|die|das|und|fur|fuer|mit|eine|ist|den|von|nicht|auch)\b/,
    ends: /(ung|heit|keit|schaft|lich)\b/,
  },
  nl: {
    school: /\b(huiswerk|toets|proefwerk|opstel|hoofdstuk|bladzijde|lezen|schrijven|leren|samenvatting|oefening|verslag)\b/,
    words: /\b(het|een|voor|niet|zijn|worden|maar|deze|naar)\b/,
    ends: /(lijk|heid)\b/,
  },
  af: {
    school: /\b(huiswerk|toets|opstel|hoofstuk|bladsy|lees|skryf|leer|opsomming|oefening|werkstuk)\b/,
    words: /\b(die|vir|nie|se|jou|hulle|baie|hierdie)\b/,
    ends: /(lik|heid)\b/,
  },
  pl: {
    chars: /[\u0105\u0107\u0119\u0142\u0144\u015b\u017a\u017c]/i,
    school: /\b(zadanie|praca|sprawdzian|egzamin|rozdzial|strona|przeczytac|napisac|streszczenie|cwiczenie)\b/,
    words: /\b(jest|nie|dla|oraz|tego|przez)\b/,
  },
  cs: {
    chars: /[\u010d\u010f\u011b\u0148\u0159\u0161\u0165\u016f\u017e]/i,
    school: /\b(ukol|domaci|test|zkouska|kapitola|strana|precist|napsat|shrnuti|cviceni)\b/,
    words: /\b(pro|neni|tento|ktery)\b/,
  },
  sk: {
    chars: /[\u010d\u010f\u013e\u0139\u0148\u00f4\u0155\u0161\u0165\u017e]/i,
    school: /\b(uloha|domaca|test|skuska|kapitola|strana|precitat|napisat|zhrnutie|cvicenie)\b/,
    words: /\b(pre|nie|tento|ktory)\b/,
  },
  hr: {
    chars: /[\u010d\u0107\u0111\u0161\u017e]/i,
    school: /\b(zadaca|ispit|test|poglavlje|stranica|procitati|napisati|sazetak|vjezba)\b/,
    words: /\b(za|se|je|od|do|nije)\b/,
  },
  sl: {
    chars: /[\u010d\u0161\u017e]/i,
    school: /\b(naloga|izpit|test|poglavje|stran|prebrati|napisati|povzetek|vaja)\b/,
    words: /\b(pri|ter|nekaj|kateri)\b/,
  },
  hu: {
    chars: /[\u0151\u0171]/i,
    school: /\b(hazi|feladat|dolgozat|vizsga|fejezet|oldal|olvasni|irni|tanulni|osszefoglalas|gyakorlat)\b/,
    words: /\b(az|es|egy|van|nem|hogy|meg)\b/,
  },
  tr: {
    chars: /[\u00e7\u011f\u0131\u015f]/i,
    school: /\b(odev|sinav|deneme|bolum|sayfa|oku|yaz|calis|ozet|alistirma)\b/,
    words: /\b(icin|ile|olan|bir|degil)\b/,
    ends: /(lar|ler|mak|mek|lik)\b/,
  },
  sv: {
    chars: /[\u00e5\u00e4\u00f6]/i,
    school: /\b(lax|laxa|prov|tenta|uppsats|kapitel|sida|lasa|skriva|plugga|sammanfattning|ovning)\b/,
    words: /\b(och|att|ett|ar|for|med|till|inte)\b/,
  },
  da: {
    chars: /[\u00e6\u00f8\u00e5]/i,
    school: /\b(lektier|prove|eksamen|stil|kapitel|side|laese|skrive|laere|resume|ovelse)\b/,
    words: /\b(og|at|et|er|for|med|til|ikke)\b/,
  },
  no: {
    chars: /[\u00e6\u00f8\u00e5]/i,
    school: /\b(lekser|prove|eksamen|stil|kapittel|side|lese|skrive|laere|sammendrag|oving)\b/,
    words: /\b(og|en|et|er|for|med|til|ikke)\b/,
  },
  is: {
    chars: /[\u00fe\u00f0\u00e6]/i,
    school: /\b(heimanam|prof|ritgerd|kafli|bladsida|lesa|skrifa|laera|samantekt|aefing)\b/,
    words: /\b(fyrir|ekki|thetta|sem)\b/,
  },
  fi: {
    school: /\b(kotitehtava|lasyt|koe|tentti|essee|luku|sivu|lukea|kirjoittaa|opiskella|tiivistelma|harjoitus)\b/,
    words: /\b(etta|ovat|kun|tama|seka)\b/,
    ends: /(nen|inen|ssa|sta|lle)\b/,
  },
  et: {
    chars: /[\u00f5]/i,
    school: /\b(kodutoo|test|eksam|essee|peatukk|lehekulg|lugeda|kirjutada|kokkuvote|harjutus)\b/,
    words: /\b(see|kui|voi|ning)\b/,
  },
  id: {
    school: /\b(tugas|pekerjaan|ujian|ulangan|esai|bab|halaman|baca|tulis|belajar|ringkasan|latihan)\b/,
    words: /\b(yang|untuk|dengan|dari|adalah|tidak|akan)\b/,
  },
  ms: {
    school: /\b(kerja|rumah|ujian|peperiksaan|esei|bab|muka|baca|tulis|belajar|ringkasan|latihan)\b/,
    words: /\b(yang|untuk|dengan|daripada|adalah|tidak|akan)\b/,
  },
  sw: {
    school: /\b(kazi|nyumbani|mtihani|insha|sura|ukurasa|soma|andika|jifunze|muhtasari|zoezi)\b/,
    words: /\b(kwa|katika|ambayo|hii|kwenye)\b/,
  },
  tl: {
    school: /\b(takdang|aralin|pagsusulit|sanaysay|kabanata|pahina|basahin|isulat|magaral|buod|pagsasanay)\b/,
    words: /\b(ang|ng|mga|para|hindi|iyong)\b/,
  },
  vi: {
    chars: /[\u0103\u00e2\u0111\u00ea\u00f4\u01a1\u01b0]/i,
    school: /\b(bai|tap|kiem|tra|thi|luan|chuong|trang|doc|viet|hoc|tom|tat)\b/,
    words: /\b(cua|cho|trong|cac|khong)\b/,
  },
  eu: { school: /\b(etxeko|lana|azterketa|saiakera|kapitulua|orria|irakurri|idatzi|ikasi|laburpena|ariketa)\b/, words: /\b(eta|dira|edo|dute|bat)\b/ },
  cy: { school: /\b(gwaith|cartref|prawf|traethawd|pennod|tudalen|darllen|ysgrifennu|dysgu|crynodeb|ymarfer)\b/, words: /\b(yr|ac|yn|gyda|ar)\b/ },
  ga: { school: /\b(obair|bhaile|scrudu|aiste|caibidil|leathanach|leigh|scriobh|foghlaim|achoimre|cleachtadh)\b/, words: /\b(agus|leis|chun|nil)\b/ },
  la: { school: /\b(pensum|liber|caput|pagina|legere|scribere|discere)\b/, words: /\b(quae|quod|atque|cum|sunt)\b/ },
  eo: { school: /\b(hejmtasko|ekzameno|eseo|capitro|pago|legi|skribi|lerni|resumo|ekzerco)\b/, words: /\b(kaj|estas|por|ne)\b/, ends: /(oj|ojn|as|is|os)\b/ },
};

/**
 * THE TWO TO FIVE MOST PLAUSIBLE LANGUAGES for a title nobody could place.
 *
 * Offering every enabled language was the bug (Gabe, 8/21): with nine switched on,
 * "importante" was answered with nine buttons including French, which nobody would
 * pick, and a "+5 more". A list that long is not a question, it is the app refusing
 * to have an opinion.
 *
 * It has an opinion now, from four things it actually knows, in descending order of
 * how much they are worth:
 *
 *   1. WHAT THE DETECTOR SAID. Too unsure to display is not too unsure to rank: a
 *      0.7 guess is still the best single piece of evidence in the building.
 *   2. WHAT THE TITLE LOOKS LIKE. See EVIDENCE: a "çã" says Portuguese, "-zione"
 *      says Italian, "ñ" says Spanish, and most short titles say nothing at all.
 *   3. WHAT THIS STUDENT'S TASKS HAVE ACTUALLY BEEN IN. A term of confirmed Spanish
 *      titles is a far better prior than any table, and it is free.
 *   4. THE ORDER THEY ENABLED THEM IN, as the last tie-break, because the language
 *      you added first is usually the one you meant.
 *
 * `recent` is language codes by how often this account has confirmed them, commonest
 * first. Callers that do not have it pass nothing and lose only signal 3.
 */
export function rankCandidates(
  text: string,
  detected = '',
  recent: string[] = [],
  ruledOut: readonly string[] = []
): LanguageDef[] {
  const defs = plausible(text, ruledOut);
  if (defs.length <= 1) return defs;
  const guess = (detected || '').toLowerCase().split('-')[0];
  const flat = ' ' + bare(text.trim()) + ' ';
  const families = FAMILY.filter(([re]) => re.test(flat)).map(([, codes]) => codes);

  const score = (d: LanguageDef, i: number): number => {
    let n = 0;
    if (d.code === guess || d.also?.some((a) => a.split('-')[0] === guess)) n += 100;
    const ev = EVIDENCE[d.code];
    if (ev) {
      // A homework word is the strongest thing on this page: "tarea" is Spanish and
      // nothing else, whereas "de" is five languages wearing a disguise.
      if (ev.school?.test(flat)) n += 40;
      if (ev.chars?.test(text)) n += 30;
      if (ev.ends?.test(flat)) n += 20;
      if (ev.words?.test(flat)) n += 12;
    }
    // Family spelling: small, and enough to beat a language with nothing at all.
    if (families.some((codes) => codes.indexOf(d.code) >= 0)) n += 8;
    // HISTORY ORDERS EQUALS. IT NEVER PROMOTES (Gabe, 8/21).
    //
    // It used to be worth up to 16, which is twice the family signal, so a language
    // the student had once picked while TESTING outranked the languages the title was
    // actually written like: "importante test si" came back offering Papiamento and
    // Vietnamese above Spanish and Portuguese. Habit is a real signal and a weak one,
    // and it has no business overruling what the words on screen look like. Kept
    // under 1 so it can only ever sort languages that the linguistics left tied.
    const seen = recent.indexOf(d.code);
    if (seen >= 0) n += Math.max(0.1, 0.9 - seen * 0.1);
    return n - i * 0.001; // last resort: the order the student enabled them in
  };

  return defs
    .map((d, i) => ({ d, n: score(d, i) }))
    .sort((a, b) => b.n - a.n)
    .map((r) => r.d);
}

/**
 * The two-to-four the row shows: the head of that one ranking.
 *
 * Everything below the cut stays reachable behind "N more", and that list is the SAME
 * ranking continued rather than the raw enabled list. Expanding widens the question,
 * it does not re-ask it in settings order (Gabe, 8/21).
 */
export function readingCandidates(
  text: string,
  detected = '',
  recent: string[] = [],
  ruledOut: readonly string[] = []
): LanguageDef[] {
  const ranked = rankCandidates(text, detected, recent, ruledOut);
  return ranked.slice(0, Math.max(MIN_CHIPS, Math.min(MAX_CHIPS, ranked.length)));
}

/** What came back when the student named a language themselves. */
export type NamedTranslation = { text: string } | { error: 'offline' | 'unchanged' };

/**
 * TRANSLATE, WITH THE LANGUAGE NAMED BY THE STUDENT (Gabe, 8/21).
 *
 * The one place Cobalt names a source language to the provider, and the distinction
 * from the fallback deleted on 8/20 is the whole point. Naming a language forces the
 * engine to translate rather than decline, which is exactly wrong when a MACHINE
 * picks the language on a guess and exactly right when a PERSON picks it: the student
 * knows what language their class is taught in and the detector never will.
 *
 * No gate runs on the result, and it does not need one. Every gate exists to decide
 * whether Cobalt should assert something on its own authority, and nothing here is
 * Cobalt's assertion: it is the answer to a question a person asked, labelled as
 * theirs. The one refusal left is a reply identical to the input, because a second
 * line repeating the first is not a translation whoever asked for it.
 */
export async function translateAs(text: string, lang: string): Promise<NamedTranslation> {
  const key = text.trim();
  if (!key || !lang) return { error: 'unchanged' };
  const r = await translateOnce(key, lang);
  if (!r || !r.tr) return { error: 'offline' };
  return readingOf(key, r.tr);
}

/**
 * DID THAT COME BACK AS ENGLISH, OR AS THE TITLE AGAIN? (Gabe, 8/21)
 *
 * Asked to read "Elige una figura sobre la cual escribir." as German, the engine
 * returned "Elige una figura sobre la cual write." — one word translated and the rest
 * of the Spanish handed straight back. It is not identical to the input, so the old
 * check passed it, and a plainly wrong reading was offered as a real option.
 *
 * A genuine translation between two languages shares almost no WORDS with its source.
 * Numbers and names survive ("Romeo", "15", "ch 7"), ordinary words do not. So the
 * test is how much of the source is still standing in the answer: half or more of the
 * real words surviving means the engine could not read it and mostly gave up.
 *
 * Numbers and single characters are excluded from the count, since they legitimately
 * pass through untouched and would otherwise make short titles look untranslated.
 */
export function readingIsReal(source: string, result: string): boolean {
  return 'text' in readingOf(source, result);
}

function readingOf(source: string, result: string): NamedTranslation {
  if (normKey(result) === normKey(source)) return { error: 'unchanged' };
  const words = (t: string): string[] =>
    bare(t).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 1 && /\p{L}/u.test(w));
  const src = words(source);
  const got = new Set(words(result));
  if (src.length >= 2) {
    const survived = src.filter((w) => got.has(w)).length;
    if (survived / src.length >= 0.5) return { error: 'unchanged' };
  }
  return { text: result };
}

/**
 * READ MANY TITLES AS ONE NAMED LANGUAGE, in a single round-trip.
 *
 * The verification pass (see TasksView.verifyReadings) needs to ask "can you read
 * this as Portuguese?" of every unplaced title at once. One call carries up to 50, so
 * checking a whole list costs one request per candidate LANGUAGE rather than one per
 * title per language.
 *
 * Returns one entry per input, in order: the English text, or null when the engine
 * handed the title back rather than translating it. A transport failure returns null
 * for everything, which the caller must tell apart from a refusal — hence the
 * separate `ok` flag.
 */
export async function translateBatchAs(
  texts: string[],
  lang: string
): Promise<{ ok: boolean; results: (string | null)[] }> {
  const clean = texts.map((t) => t.trim());
  if (!clean.length || !lang) return { ok: true, results: [] };
  // The transport THROWS on a rejected call (not signed in, offline, over quota), and
  // this is the only caller that reaches it without translateOnce's own try/catch in
  // between. Unhandled, it escapes as a promise rejection and takes the whole
  // verification pass with it instead of reporting the one thing the caller needs to
  // know: that nothing was learned and the answer must not be written down.
  let raw: (Raw | null)[];
  try {
    raw = await callTranslate(clean, lang);
  } catch {
    return { ok: false, results: clean.map(() => null) };
  }
  // Every slot empty means the call itself failed, not that every title was refused.
  if (raw.every((x) => !x || !x.tr)) return { ok: false, results: clean.map(() => null) };
  return {
    ok: true,
    results: raw.map((one, i) => {
      if (!one || !one.tr) return null;
      const v = readingOf(clean[i], one.tr);
      return 'text' in v ? v.text : null;
    }),
  };
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
 *  and it has EXACTLY ONE caller: translateAs, reading a title as a language the STUDENT named
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
