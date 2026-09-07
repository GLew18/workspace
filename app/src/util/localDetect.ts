// Cobalt: DECIDING, WITHOUT SPENDING ANYTHING, WHETHER TEXT IS WORTH SENDING.
//
// Google Cloud Translation bills per character, and until now every unchecked title
// AND every unchecked description went to it — including the overwhelming majority
// that are plain English, sent purely to be told they are English. Descriptions are
// roughly five times the length of a title, so they were most of the bill.
//
// THE ONE QUESTION THIS FILE ANSWERS: is this text confidently English (or in a
// script no enabled language even writes)? Only a confident YES skips the call.
// Everything else is sent exactly as before.
//
// THE ASYMMETRY IS THE WHOLE DESIGN, and it is worth saying out loud because it
// decides every threshold below. The two mistakes this module can make are not
// equal:
//
//   • Sending English text costs a fraction of a cent and changes nothing.
//   • Skipping FOREIGN text loses a translation the student should have seen, and
//     loses it silently, with nothing on screen to say so.
//
// So every rule here is built to fail toward sending. A test that is unsure sends.
// A text too short to judge sends. Anything with a whiff of a foreign language
// sends. The saving comes from long English prose, which is both the easiest thing
// to be sure about and the expensive thing — the two line up, which is why this
// works at all.
//
// WHY NOT `plausible()` FROM translate.ts, which already narrows a text to the
// languages that could have written it: because it filters on orthography SHAPE and
// diacritics as well as script, and those were built to RANK the language buttons,
// not to veto a translation. They are heuristics with real false positives — a
// Vietnamese title containing an "mp" cluster is ruled out of Vietnamese by
// shapeAllows, yet Google detects it as Vietnamese with high confidence and the
// gates in translate.ts accept it. Only the SCRIPT filter is exact, and that is the
// only part borrowed here.

import { getPrefs } from '../prefs';
import { substantiveScripts, writesScript, findLanguage } from './languages';

/**
 * BUMP THIS WHENEVER A RULE BELOW CHANGES.
 *
 * A local skip writes `translationChecked` onto the task, which outlives the page —
 * so without a version to compare against, a text this module judged wrongly would
 * keep that verdict forever and a fix here could never reach it. tasks/render.ts
 * folds this number into the same localStorage signature that already forces a
 * rescan when the student's language list changes, so raising it re-examines
 * everything the previous version decided.
 */
export const DETECTOR_VERSION = 1;

export type LocalVerdict =
  /** Don't spend anything on this one. `english` records the same verdict the
   *  provider would have returned; `unwritable` means no enabled language is even
   *  written in this text's alphabet, which the gates in translate.ts would have
   *  refused anyway (see scriptAgrees). */
  | { skip: true; why: 'english' | 'unwritable' }
  | { skip: false };

const SEND: LocalVerdict = { skip: false };

/**
 * ACCENTED LATIN LETTERS ONLY — deliberately not "any non-ASCII character".
 *
 * Schoology descriptions are full of curly quotes, en dashes and ellipses that a
 * teacher's word processor inserted, and those say nothing about language. These
 * three ranges are Latin letters carrying marks (á é ñ ü ø å ő ạ …), which do: an
 * English sentence does not contain them, and a Romance, Nordic, Slavic-Latin or
 * Vietnamese one usually does. Punctuation lives at U+2000–U+206F and is untouched.
 *
 * THE COMBINING RANGE (U+0300–036F) IS THE FOURTH, added after the audit. The first
 * three cover PRECOMPOSED letters, which is what NFC text uses; text that arrives
 * NFD-decomposed carries a plain "e" followed by a separate combining acute instead,
 * and would have sailed past all three. macOS-originated text does this routinely.
 * No input was found where the gap actually lost a translation, but the file claimed
 * to handle NFD and did not, and closing it only ever sends more.
 */
const ACCENTED = /[\u00C0-\u024F\u1E00-\u1EFF\u0300-\u036F]/;

/**
 * HOW MANY LETTERS A SCRIPT NEEDS BEFORE IT COUNTS AS THE TEXT'S OWN.
 *
 * Two or fewer, alongside a script that carries the rest, is notation: π in a
 * geometry description, θ in trigonometry, Δ in chemistry, α and β in physics. Three
 * is enough for the shortest real word in any alphabet, so a genuine phrase in
 * another language always clears it while a symbol never does.
 *
 * The bar applies to Latin too, deliberately. A Thai description containing "p. 45"
 * is still Thai, and letting one stray Latin letter make it "readable" would have
 * quietly spent money on text nobody enabled.
 */
const SCRIPT_NOISE_MAX = 2;

/**
 * HIGH-FREQUENCY FUNCTION WORDS FROM THE MAJOR LATIN-SCRIPT LANGUAGES.
 *
 * Function words are the right signal here precisely because they are the words
 * that are NEVER cognates. English shares enormous content vocabulary with the
 * Romance languages — "action", "nation", "important", "possible", "message",
 * "date", "structure" are the same word in French — so counting English-looking
 * words would happily pass a French paragraph. No language borrows another's
 * articles and prepositions.
 *
 * A HIT HERE ONLY EVER MEANS "SEND", so an over-inclusive list costs money and
 * never costs a translation. That asymmetry is why this list can afford to be
 * generous. What it cannot afford is the reverse — a word that is ALSO ordinary
 * English fires on English text and quietly undoes the saving — so words that are
 * real in both languages are left out on purpose and named here, or someone will
 * helpfully add them back:
 *
 *   die, was, as, is, in, on, am, so, man, war, hay, son, sin, no, one, end, are,
 *   to, be, a, o, e, y — never added.
 *   for (sv/no/da), over (nl/da), men (sv/no/da "but"), per (it), plus (fr),
 *   van (nl), dan (id) — added, then REMOVED, because each is ordinary English
 *   and every one of them would have fired on ordinary English school text.
 *   ("todo" is excluded twice over: Spanish for "all", and on half the tasks in a
 *   task app.)
 *
 * The languages that lost an entry that way keep plenty of others, and the ones
 * that write accents are caught by ACCENTED before this list is ever consulted.
 *
 * Single letters and most two-letter tokens are out for the same reason. The
 * scripts/checkDetector.ts run asserts this set and ENGLISH_FUNCTION stay disjoint,
 * because reading two 200-word lists side by side does not reliably catch it — four
 * collisions survived exactly that reading.
 */
const FOREIGN_FUNCTION = new Set([
  // Spanish / Portuguese
  'el', 'los', 'las', 'una', 'del', 'con', 'por', 'para', 'que', 'pero', 'como',
  'este', 'esta', 'esto', 'estos', 'estas', 'cuando', 'donde', 'muy', 'sus', 'sobre',
  'entre', 'desde', 'hasta', 'cada', 'ser', 'estar', 'tiene', 'todos', 'todas',
  'mais', 'nao', 'nada', 'porque', 'aos', 'dos', 'das', 'uma', 'pelo', 'pela',
  // French
  'le', 'les', 'des', 'du', 'et', 'ou', 'est', 'sont', 'dans', 'pour', 'avec',
  'sur', 'par', 'qui', 'ne', 'pas', 'ce', 'cette', 'cet', 'ses', 'aux',
  'vous', 'nous', 'ils', 'elles', 'etre', 'avoir', 'faire', 'tout', 'tous', 'mais',
  'comme', 'quand', 'tres', 'bien', 'chez', 'sans', 'deja', 'leur', 'leurs',
  // German
  'der', 'das', 'den', 'dem', 'ein', 'eine', 'einen', 'einem', 'und', 'oder',
  'ist', 'sind', 'nicht', 'mit', 'fur', 'auf', 'von', 'zu', 'aber', 'auch', 'wenn',
  'wie', 'wer', 'wird', 'werden', 'haben', 'sein', 'dass', 'sich', 'nur', 'noch',
  'schon', 'bei', 'nach', 'vor', 'uber', 'unter', 'nicht', 'diese', 'dieser',
  // Italian
  'il', 'lo', 'gli', 'uno', 'di', 'della', 'delle', 'degli', 'che', 'non',
  'sono', 'anche', 'questo', 'questa', 'alla', 'nel', 'nella', 'sulla', 'dei',
  // Dutch
  'de', 'het', 'een', 'en', 'zijn', 'niet', 'voor', 'aan', 'door', 'maar',
  'ook', 'als', 'dat', 'deze', 'wordt', 'worden', 'heeft', 'hebben', 'naar',
  // Polish / Czech / other Slavic-Latin
  'nie', 'jest', 'sie', 'tego', 'jak', 'oraz', 'przez', 'jego', 'tylko', 'juz',
  'ale', 'nebo', 'jako', 'jsou', 'byl', 'byla', 'toto', 'ktere', 'ktery',
  // Nordic
  'och', 'att', 'som', 'har', 'inte', 'med', 'til', 'ikke', 'det', 'ett',
  'eller', 'fra', 'ved', 'skal', 'kan', 'blir',
  // Indonesian / Malay / Tagalog / Swahili — Latin-script, no diacritics to lean on
  'yang', 'untuk', 'dengan', 'dari', 'pada', 'adalah', 'tidak', 'akan',
  'ang', 'mga', 'sa', 'ni', 'kay', 'ay', 'para',
  'kwa', 'wa', 'ya', 'katika', 'kuwa', 'hii', 'hiyo', 'ili',
]);

/**
 * ENGLISH FUNCTION WORDS, plus the suffixes below — together, the evidence that a
 * text IS English rather than merely not-obviously-foreign.
 *
 * This replaces what would otherwise have to be a several-thousand-word English
 * lexicon shipped to every visitor. Ordinary English prose runs 40–50% function
 * words, and no other language shares them, so a couple of hundred entries settle
 * it as well as a dictionary would and cost nothing to load.
 */
const ENGLISH_FUNCTION = new Set([
  'the', 'of', 'and', 'to', 'in', 'is', 'it', 'you', 'that', 'was', 'for', 'on',
  'are', 'with', 'as', 'at', 'be', 'this', 'have', 'from', 'or', 'one', 'had',
  'by', 'but', 'not', 'what', 'all', 'were', 'we', 'when', 'your', 'can', 'said',
  'there', 'use', 'each', 'which', 'she', 'do', 'how', 'their', 'if', 'will',
  'up', 'other', 'about', 'out', 'many', 'then', 'them', 'these', 'so', 'some',
  'her', 'would', 'make', 'like', 'him', 'into', 'time', 'has', 'look', 'two',
  'more', 'write', 'go', 'see', 'no', 'way', 'could', 'people', 'my', 'than',
  'first', 'been', 'call', 'who', 'its', 'now', 'find', 'long', 'down', 'day',
  'did', 'get', 'come', 'made', 'may', 'part', 'over', 'new', 'sound', 'take',
  'only', 'little', 'work', 'know', 'place', 'year', 'live', 'me', 'back', 'give',
  'most', 'very', 'after', 'thing', 'our', 'just', 'name', 'good', 'sentence',
  'man', 'think', 'say', 'great', 'where', 'help', 'through', 'much', 'before',
  'line', 'right', 'too', 'mean', 'old', 'any', 'same', 'tell', 'boy', 'follow',
  'came', 'want', 'show', 'also', 'around', 'form', 'three', 'small', 'set', 'put',
  'end', 'does', 'another', 'well', 'large', 'must', 'big', 'even', 'such',
  'because', 'turn', 'here', 'why', 'ask', 'went', 'men', 'read', 'need', 'land',
  'different', 'home', 'us', 'move', 'try', 'kind', 'hand', 'picture', 'again',
  'change', 'off', 'play', 'spell', 'air', 'away', 'animal', 'house', 'point',
  'page', 'letter', 'mother', 'answer', 'found', 'study', 'still', 'learn',
  'should', 'america', 'world', 'his', 'he', 'they', 'i', 'a', 'an', 'while',
  'between', 'both', 'during', 'under', 'above', 'below', 'against', 'without',
  'within', 'along', 'across', 'behind', 'beyond', 'upon', 'per', 'via', 'until',
  'unless', 'whether', 'though', 'although', 'however', 'therefore', 'thus',
]);

/** Word endings that are English morphology. A text can be full of technical nouns
 *  the list above has never heard of and still be unmistakably English because of
 *  how its words END: "annotations collected", "reviewing", "carefully". Romance
 *  languages form these differently (-tion is -ción / -zione / -ção, and those
 *  carry accents that ACCENTED already caught).
 *
 *  THE TRAILING `s?` IS NOT DECORATION. Anchored without it, the single most common
 *  shape in an assignment description missed entirely: citations, annotations,
 *  questions, paragraphs, readings, findings are all plural, and an unanchored
 *  pattern would match inside unrelated words instead. Caught by running the real
 *  module in the browser against real description text — "Final draft of the Animal
 *  Farm essay: five paragraphs, two direct quotes per body paragraph, MLA citations"
 *  scored 0.29 against a 0.30 bar and was sent, purely for want of two letters.
 *
 *  It cannot pull a foreign text over the line, because FOREIGN_FUNCTION is checked
 *  first and returns immediately: French "citations" never reaches this test, since
 *  no French sentence gets that far without a le/la/les/de/des. */
const ENGLISH_SUFFIX = /(?:ing|ed|tion|sion|ness|ment|ly|ful|less|able|ible|ise|ize|ised|ized)s?$/;

/** Letters, digits and apostrophes; everything else splits. Accents survive so the
 *  caller can still test for them, but they never reach the word sets. */
function tokens(text: string): string[] {
  return text
    .toLowerCase()
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .trim()
    .split(/\s+/)
    .filter(Boolean);
}

/** Strip accents so "capítulo" and "capitulo" hit the same set entry. Matches what
 *  `bare()` in translate.ts does for the same reason. */
function flat(word: string): string {
  return word.normalize('NFD').replace(/[\u0300-\u036F]/g, '');
}

/**
 * FEWER THAN THIS MANY WORDS AND WE DO NOT GUESS.
 *
 * Function-word density is a statistic, and a statistic over four words is noise:
 * "Finish lab write-up" contains no English function word at all and would score
 * zero. Short text therefore always sends — which is affordable precisely because
 * short text is cheap. A title runs ~45 characters; the descriptions this is really
 * aimed at run hundreds.
 */
const MIN_TOKENS = 10;

/**
 * HOW MUCH ENGLISH EVIDENCE IS ENOUGH, as a fraction of the words that carry any
 * language at all (numbers are excluded from the denominator — "12" is not English
 * or anything else).
 *
 * 0.3 is set well above what a foreign text can reach by accident and well below
 * what real English prose scores. Measured against the demo seed's own copy: "Read
 * chapter 12 and annotate for character motivation. Annotations collected in class."
 * scores 0.5 (and, for, in + motivation, annotations, collected), while the same
 * sentence in French scores 0.12 and is caught by the foreign-word test first.
 */
const MIN_ENGLISH = 0.3;

/**
 * The verdict. `text` is a title or a description; the caller (analyzeBatch in
 * util/translate.ts) treats `skip` as "record the same thing the provider would
 * have said, and do not call it".
 */
export function localVerdict(text: string): LocalVerdict {
  const trimmed = text.trim();
  if (!trimmed) return SEND;

  // --- Test A: script. Exact, and the cheapest thing here. -------------------
  //
  // EVERY script in the text, not the first one found (Gabe's code auditor, 8/28).
  // The first draft asked scriptOf() for THE script, which returns whichever range
  // matches first, anywhere in the string. That is right for a title wholly in one
  // alphabet and catastrophically wrong the moment one foreign character appears —
  // and one foreign character is completely ordinary:
  //
  //   "Calcula el area del circulo usando π ..."     → scriptOf says GREEK
  //   "Calculez la variation Δ de la temperature"    → scriptOf says GREEK
  //   "... Fuente: Достоевский."                     → scriptOf says CYRILLIC
  //
  // π θ Δ α λ Ω are Greek to Unicode and are simply how geometry, physics and
  // chemistry homework is written. Greek is never on a student's list, so all three
  // of those were skipped as "unwritable" — a real Spanish or French description,
  // silently losing its translation, with nothing on screen to say so. That is the
  // exact failure this module is not allowed to have.
  //
  // COUNT, THEN DECIDE. A script earns a vote by contributing real letters; one that
  // contributes a character or two while another carries the sentence is notation,
  // not a writing system. That cuts both ways and has to, or the fix for the bug
  // above becomes its own bug: rule that ANY non-Latin character forces a call, and
  // every English maths description with a π in it starts costing money.
  const substantive = substantiveScripts(trimmed, SCRIPT_NOISE_MAX);
  if (substantive.some((s) => s !== 'latin')) {
    // Real non-Latin content, so this is not English and the density test below has
    // nothing to say about it. Send it — unless nobody could read any of what is
    // actually here, in which case translate.ts's own scriptAgrees gate would refuse
    // the answer and the call could only spend money to be told no.
    const enabled = getPrefs().tasks.translateFrom;
    const readable = substantive.some((s) => enabled.some((code) => writesScript(findLanguage(code), s)));
    return readable ? SEND : { skip: true, why: 'unwritable' };
  }

  // --- Test B: Latin script. Is this confidently English? --------------------
  // Accented letters end it immediately: English does not use them, and every
  // Latin-script language that does has just identified itself.
  if (ACCENTED.test(trimmed)) return SEND;

  const words = tokens(trimmed);
  const lexical = words.filter((w) => !/^\d+$/.test(w));
  if (lexical.length < MIN_TOKENS) return SEND; // too short to be sure — see MIN_TOKENS

  let english = 0;
  for (const w of lexical) {
    const f = flat(w);
    // One foreign function word is enough. Articles and prepositions do not travel
    // between languages, so this is the strongest single signal available, and it
    // is checked first so it can end the whole thing.
    if (FOREIGN_FUNCTION.has(f)) return SEND;
    if (ENGLISH_FUNCTION.has(f) || ENGLISH_SUFFIX.test(f)) english++;
  }

  return english / lexical.length >= MIN_ENGLISH ? { skip: true, why: 'english' } : SEND;
}
