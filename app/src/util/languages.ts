// Cobalt: the language catalog behind Settings ▸ Tasks ▸ Languages.
//
// Task titles arrive from Schoology in whatever language the teacher wrote them,
// and Cobalt translates them to English. The problem this file solves is the
// OPPOSITE of coverage: asking the detector "is this any of 100+ languages" is what
// made "huu" come back as Swahili for "this one" and "heybo" as Somali. Short,
// English-ish tokens will always land on a real word SOMEWHERE. So the student
// picks the languages that actually show up in their classes, and everything else
// is left alone — the same thing that happened before the feature existed.

export interface LanguageDef {
  /** The code stored in prefs and matched against the detector's answer. */
  code: string;
  /** English name, shown in the picker. */
  label: string;
  /** The language's own name, shown as a subtitle so it's recognizable. */
  native: string;
  /** Extra codes the detector may return for this same language (see expandCodes). */
  also?: string[];
  /** Writing system. Absent = Latin, which is most of the catalog. Used to decide
   *  which languages it is even PLAUSIBLE to ask about a given title — see
   *  scriptOf. */
  script?: Script;
  /** Other scripts this language is genuinely written in. Japanese is the reason:
   *  its script is normally kana MIXED with kanji, but a short title is often pure
   *  kanji ("第7章"), which reads as Han and would otherwise rule Japanese out of
   *  its own titles. Measured 8/16: that alone failed 2 of 200 live trials. */
  altScripts?: Script[];
}

/** The writing systems Cobalt can tell apart from the characters alone. */
export type Script =
  | 'latin' | 'cyrillic' | 'greek' | 'hebrew' | 'arabic' | 'han' | 'kana'
  | 'hangul' | 'devanagari' | 'thai' | 'armenian' | 'georgian' | 'ethiopic'
  | 'bengali' | 'tamil' | 'telugu' | 'kannada' | 'malayalam' | 'gujarati'
  | 'gurmukhi' | 'sinhala' | 'khmer' | 'lao' | 'burmese' | 'odia' | 'tibetan';

const RANGES: Array<[Script, RegExp]> = [
  ['hebrew', /[֐-׿]/],
  ['arabic', /[؀-ۿݐ-ݿﭐ-﷿]/],
  ['cyrillic', /[Ѐ-ӿԀ-ԯ]/],
  ['greek', /[Ͱ-Ͽἀ-῿]/],
  ['armenian', /[԰-֏]/],
  ['georgian', /[Ⴀ-ჿ]/],
  ['ethiopic', /[ሀ-፿]/],
  ['devanagari', /[ऀ-ॿ]/],
  ['bengali', /[ঀ-৿]/],
  ['gurmukhi', /[਀-੿]/],
  ['gujarati', /[઀-૿]/],
  ['odia', /[଀-୿]/],
  ['tamil', /[஀-௿]/],
  ['telugu', /[ఀ-౿]/],
  ['kannada', /[ಀ-೿]/],
  ['malayalam', /[ഀ-ൿ]/],
  ['sinhala', /[඀-෿]/],
  ['thai', /[฀-๿]/],
  ['lao', /[຀-໿]/],
  ['tibetan', /[ༀ-࿿]/],
  ['burmese', /[က-႟]/],
  ['khmer', /[ក-៿]/],
  ['hangul', /[가-힯ᄀ-ᇿ]/],
  // Kana BEFORE Han: Japanese text mixes both, and the kana is what distinguishes
  // it from Chinese. A title with any kana in it is Japanese, not Chinese.
  ['kana', /[぀-ヿ]/],
  ['han', /[一-鿿㐀-䶿]/],
];

/**
 * Which writing system a title is in.
 *
 * The point is not classification for its own sake — it is to stop Cobalt asking a
 * language a question it cannot sensibly answer. Naming a language outright forces
 * the engine to produce SOMETHING, so asking Japanese about a Russian sentence
 * returns English text that reads plausibly and is pure invention. Measured on
 * 8/16: 26 of 200 live trials translated a title whose language was switched OFF,
 * every one of them through exactly that route. Characters settle it for free.
 */
/* NO CALLERS AS OF 8/29, and kept deliberately rather than deleted. Both of its
   users — scriptAgrees and plausible, in util/translate.ts — moved to
   substantiveScripts() below after this function's first-match behaviour was found
   to be reading a single π as "this text is Greek". It stays because the comment
   above is the record of WHY the script test exists at all, and because
   substantiveScripts is built on the same RANGES table it documents. Delete it only
   together with that history. */
export function scriptOf(text: string): Script {
  for (const [name, re] of RANGES) if (re.test(text)) return name;
  return 'latin';
}

/**
 * HOW MANY LETTERS OF EACH SCRIPT THE TEXT CONTAINS.
 *
 * scriptOf() answers "what is this written in" by returning the FIRST range that
 * matches anywhere in the string. That is the right answer for a title wholly in one
 * alphabet and the wrong answer the moment a single foreign character appears — and
 * one foreign character is completely ordinary. π, θ, Δ, α, λ and Ω are Greek as far
 * as Unicode is concerned, and they are simply how geometry, physics and chemistry
 * homework is written; a pasted citation drops a Cyrillic name into a Spanish
 * paragraph; Word and PDF exports leave homoglyphs behind.
 *
 * Counting is what separates a SYMBOL from a WRITING SYSTEM, and no single-answer
 * function can make that distinction: one π in sixty Latin letters is notation, while
 * five Hebrew letters beside nine Latin ones is a bilingual title. The caller decides
 * where the line falls; this only reports the evidence.
 *
 * LETTERS ONLY. Digits and punctuation belong to no language, so counting them would
 * let "12" and "..." vote on what a sentence is written in.
 *
 * scriptOf() is deliberately LEFT ALONE. Its callers in translate.ts have their own
 * tested behaviour — and, as it happens, their own version of this bug: a Spanish
 * description containing π is refused by the scriptAgrees gate today, which predates
 * any of this and is worth fixing separately rather than folding in here.
 */
/**
 * THE SCRIPTS THE TEXT IS ACTUALLY WRITTEN IN, symbols discarded.
 *
 * A script earns a place here by contributing more than `noiseMax` letters. Below
 * that, alongside a script carrying the rest, it is notation rather than language:
 * π in a geometry description, θ in trigonometry, Δ in chemistry, α and β in
 * physics, or a stray homoglyph left behind by a Word or PDF export.
 *
 * MEASURED, on the two Gabe hit live on 8/29: a Georgian description containing one
 * π counts 47 Georgian letters against 1 Greek, and a Vietnamese one counts 32 Latin
 * against 1 Greek. scriptOf() called both of them Greek, because it returns the
 * first range that matches and Greek is tested before Georgian. Downstream, the
 * Georgian task offered "Translate from Greek" and the Vietnamese one offered
 * nothing at all — both translated perfectly the moment the π was removed.
 *
 * Three is enough for the shortest real word in any alphabet, so a genuine phrase in
 * another language always clears the bar while a symbol never does. The bar applies
 * to Latin too, deliberately: a Thai description containing "p. 45" is still Thai.
 *
 * Never empty for text containing any letter — if nothing clears the bar the text is
 * tiny, so whatever there is most of IS the text.
 */
export function substantiveScripts(text: string, noiseMax = 2): Script[] {
  const counts = scriptCounts(text);
  if (!counts.size) return [];
  const kept = [...counts.keys()].filter((s) => (counts.get(s) as number) > noiseMax);
  if (kept.length) return kept;
  return [[...counts.keys()].reduce((a, b) => ((counts.get(a) as number) >= (counts.get(b) as number) ? a : b))];
}

export function scriptCounts(text: string): Map<Script, number> {
  const counts = new Map<Script, number>();
  for (const ch of text) {
    if (!/\p{L}/u.test(ch)) continue;
    let hit: Script | null = null;
    for (const [name, re] of RANGES) {
      if (re.test(ch)) {
        hit = name;
        break;
      }
    }
    // A LETTER IN A SCRIPT THIS TABLE DOES NOT KNOW COUNTS AS LATIN, which is
    // exactly what scriptOf() does with its fallback and for the same stated reason:
    // an unfamiliar alphabet should pass rather than be refused for being
    // unfamiliar. RANGES has no entry for Thaana or Meetei Mayek, so Divehi and
    // Meiteilon are written in letters nothing here recognises.
    //
    // DROPPING THEM INSTEAD WAS A REAL BUG, caught by the 185-language sweep: with
    // uncounted letters, "ދިވެހި" produced an EMPTY count and "ދިވެހި π" produced
    // {greek: 1} — so a single symbol became the only script in the text, Greek is
    // nobody's enabled language, and Divehi was thrown away as unreadable. Counting
    // unknown letters as Latin puts both back on the path they were always on.
    if (!hit) hit = 'latin';
    counts.set(hit, (counts.get(hit) ?? 0) + 1);
  }
  return counts;
}

// THE SIBLING TABLE IS GONE (Gabe, 8/20).
//
// It listed languages a detector "realistically confuses" — Dutch with Afrikaans,
// Czech with Slovak — and existed for one caller: the fallback that re-asked the
// provider naming a specific language whenever detection landed on a close relative
// of an enabled one. That fallback is gone (see translate.ts), and with it the only
// reason to keep this.
//
// It should be remembered as a mistake in kind, not just in detail. It was a
// language-FAMILY taxonomy being asked an EMPIRICAL question about what this
// particular detector mixes up, and those are different questions — which is why it
// grouped Arabic with Hebrew, languages that share no alphabet, while separating
// Arabic from Persian, which share one. If a rescue for near-misses is ever wanted
// again, it has to be built from logged rejections, not from a family tree.

/** Could a title in `script` plausibly be this language? */
export function writesScript(def: LanguageDef | undefined, script: Script): boolean {
  const primary = def?.script ?? 'latin';
  return primary === script || !!def?.altScripts?.includes(script);
}

/** What Cobalt turns on for a new student (Gabe, 8/15). Hebrew is why the feature
 *  exists — Ivrit titles come straight from Schoology — and Spanish, Arabic and
 *  French are the school's other taught languages.
 *
 *  YIDDISH JOINED ON 9/1/26 (Gabe). It is Hebrew script, so it always cleared the
 *  local gate, and then died at the gate that matters: gateDecision refuses any
 *  language the student has not enabled, and isAmbiguous returns false when
 *  detection was SURE of an unenabled language — so a confidently-detected Yiddish
 *  title produced no translation AND no language chips, with nothing on screen to
 *  say a translation had been available. Defaulting it on is the whole fix; a
 *  Judaic-studies school generates this text and no student would think to go add
 *  Yiddish by name.
 *
 *  ARAMAIC IS DELIBERATELY ABSENT, and it is not an oversight. Google Translate has
 *  no Aramaic model, so it is not in the catalog below (see the provenance note),
 *  and since Cobalt only ever READS the code detection returns, an entry for it
 *  could never match. Talmud text is covered anyway: it is Hebrew script with no
 *  Aramaic model to claim it, so Google reports it as Hebrew and the Hebrew default
 *  carries it. Add 'arc' only alongside a provider that actually supports it. */
export const DEFAULT_TRANSLATE_FROM = ['he', 'es', 'ar', 'fr', 'yi'];

/** Every language Cobalt can translate from: the four defaults first, then the rest
 *  alphabetically by English name.
 *
 *  This is Google Translate's own published set, so anything a title could
 *  realistically be written in is here. The CATALOG is not the limit: the student's
 *  picks are, and that separation is the entire design. A short list would have been
 *  a second, invisible gate on top of the one they can actually see and change.
 *
 *  VERIFIED 8/20/26 against cloud.google.com/translate/docs/languages, which now
 *  publishes about 190 entries. The 185 below are all of them except English (the
 *  target, never a source) and the regional variants that collapse onto a base code
 *  anyway (fr-CA, pt-BR, zh-CN/zh-TW, ms-Arab, pa-Arab). Five need an alias, because
 *  the code Google REPORTS is not the modern one: Hebrew answers 'iw', Javanese 'jw',
 *  Tagalog 'fil', Meiteilon 'mni-Mtei', and Chinese 'zh-CN'/'zh-TW' (handled by the
 *  base-code split in findLanguage). Those are covered by `also`.
 *
 *  A WRONG CODE HERE IS QUIET, NOT HARMFUL, and that is worth being precise about,
 *  because it is what makes a catalog this size safe. Cobalt never SENDS a code to
 *  Google: it never names a source language, it only reads the one that detection
 *  hands back. So a code Google does not actually support, or that its detector never
 *  returns, simply never matches. That language is offered, chosen, and then nothing
 *  written in it is ever translated. No other language is affected. The failure mode
 *  of this file is silence, which is the one Gabe asked for. */
export const LANGUAGES: LanguageDef[] = [
  // --- the defaults, first, in the same order as DEFAULT_TRANSLATE_FROM ---
  // Google still reports Hebrew with the retired ISO code 'iw', so both must match.
  { code: 'he', label: 'Hebrew', native: 'עברית', also: ['iw'], script: 'hebrew' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'ar', label: 'Arabic', native: 'العربية', script: 'arabic' },
  { code: 'fr', label: 'French', native: 'Français' },
  { code: 'yi', label: 'Yiddish', native: 'ייִדיש', script: 'hebrew' },
  // --- the rest, alphabetical, so an unfiltered list is navigable ---
  { code: 'ace', label: 'Acehnese', native: 'Bahsa Acêh' },
  { code: 'ach', label: 'Acholi', native: 'Leb Acoli' },
  { code: 'af', label: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', label: 'Albanian', native: 'Shqip' },
  { code: 'alz', label: 'Alur', native: 'Alur' },
  { code: 'am', label: 'Amharic', native: 'አማርኛ', script: 'ethiopic' },
  { code: 'hy', label: 'Armenian', native: 'Հայերեն', script: 'armenian' },
  { code: 'as', label: 'Assamese', native: 'অসমীয়া', script: 'bengali' },
  { code: 'awa', label: 'Awadhi', native: 'अवधी', script: 'devanagari' },
  { code: 'ay', label: 'Aymara', native: 'Aymar aru' },
  { code: 'az', label: 'Azerbaijani', native: 'Azərbaycan', altScripts: ['cyrillic'] },
  { code: 'ban', label: 'Balinese', native: 'Basa Bali' },
  { code: 'bm', label: 'Bambara', native: 'Bamanankan' },
  { code: 'ba', label: 'Bashkir', native: 'Башҡортса', script: 'cyrillic' },
  { code: 'eu', label: 'Basque', native: 'Euskara' },
  { code: 'btx', label: 'Batak Karo', native: 'Cakap Karo' },
  { code: 'bts', label: 'Batak Simalungun', native: 'Hata Simalungun' },
  { code: 'bbc', label: 'Batak Toba', native: 'Hata Batak Toba' },
  { code: 'be', label: 'Belarusian', native: 'Беларуская', script: 'cyrillic' },
  { code: 'bem', label: 'Bemba', native: 'Ichibemba' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', script: 'bengali' },
  { code: 'bew', label: 'Betawi', native: 'Bahasa Betawi' },
  { code: 'bho', label: 'Bhojpuri', native: 'भोजपुरी', script: 'devanagari' },
  { code: 'bik', label: 'Bikol', native: 'Bikol' },
  { code: 'bs', label: 'Bosnian', native: 'Bosanski' },
  { code: 'br', label: 'Breton', native: 'Brezhoneg' },
  { code: 'bg', label: 'Bulgarian', native: 'Български', script: 'cyrillic' },
  { code: 'my', label: 'Burmese', native: 'မြန်မာ', script: 'burmese' },
  { code: 'bua', label: 'Buryat', native: 'Буряад', script: 'cyrillic' },
  { code: 'yue', label: 'Cantonese', native: '粵語', script: 'han' },
  { code: 'ca', label: 'Catalan', native: 'Català' },
  { code: 'ceb', label: 'Cebuano', native: 'Cebuano' },
  { code: 'zh', label: 'Chinese', native: '中文', also: ['zh-cn', 'zh-tw'], script: 'han' },
  { code: 'cv', label: 'Chuvash', native: 'Чӑвашла', script: 'cyrillic' },
  { code: 'co', label: 'Corsican', native: 'Corsu' },
  { code: 'crh', label: 'Crimean Tatar', native: 'Qırımtatarca', altScripts: ['cyrillic'] },
  { code: 'hr', label: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', label: 'Czech', native: 'Čeština' },
  { code: 'da', label: 'Danish', native: 'Dansk' },
  { code: 'din', label: 'Dinka', native: 'Thuɔŋjäŋ' },
  { code: 'dv', label: 'Divehi', native: 'ދިވެހި' },
  { code: 'doi', label: 'Dogri', native: 'डोगरी', script: 'devanagari' },
  { code: 'dov', label: 'Dombe', native: 'Dombe' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
  { code: 'dz', label: 'Dzongkha', native: 'རྫོང་ཁ', script: 'tibetan' },
  { code: 'eo', label: 'Esperanto', native: 'Esperanto' },
  { code: 'et', label: 'Estonian', native: 'Eesti' },
  { code: 'ee', label: 'Ewe', native: 'Eʋegbe' },
  { code: 'fj', label: 'Fijian', native: 'Na Vosa Vakaviti' },
  { code: 'fi', label: 'Finnish', native: 'Suomi' },
  { code: 'fy', label: 'Frisian', native: 'Frysk' },
  { code: 'ff', label: 'Fulfulde', native: 'Fulfulde' },
  { code: 'gaa', label: 'Ga', native: 'Gã' },
  { code: 'gl', label: 'Galician', native: 'Galego' },
  { code: 'lg', label: 'Ganda', native: 'Luganda' },
  { code: 'ka', label: 'Georgian', native: 'ქართული', script: 'georgian' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'el', label: 'Greek', native: 'Ελληνικά', script: 'greek' },
  { code: 'gn', label: 'Guarani', native: 'Avañe’ẽ' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', script: 'gujarati' },
  { code: 'ht', label: 'Haitian Creole', native: 'Kreyòl Ayisyen' },
  { code: 'cnh', label: 'Hakha Chin', native: 'Laiholh' },
  { code: 'ha', label: 'Hausa', native: 'Hausa', altScripts: ['arabic'] },
  { code: 'haw', label: 'Hawaiian', native: 'Olelo Hawaii' },
  { code: 'hil', label: 'Hiligaynon', native: 'Ilonggo' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', script: 'devanagari' },
  { code: 'hmn', label: 'Hmong', native: 'Hmoob' },
  { code: 'hu', label: 'Hungarian', native: 'Magyar' },
  { code: 'hrx', label: 'Hunsrik', native: 'Hunsrik' },
  { code: 'is', label: 'Icelandic', native: 'Íslenska' },
  { code: 'ig', label: 'Igbo', native: 'Igbo' },
  { code: 'ilo', label: 'Ilocano', native: 'Ilokano' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ga', label: 'Irish', native: 'Gaeilge' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ja', label: 'Japanese', native: '日本語', script: 'kana', altScripts: ['han'] },
  { code: 'jv', label: 'Javanese', native: 'Basa Jawa', also: ['jw'] },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', script: 'kannada' },
  { code: 'pam', label: 'Kapampangan', native: 'Kapampangan' },
  { code: 'kk', label: 'Kazakh', native: 'Қазақ', script: 'cyrillic', altScripts: ['latin'] },
  { code: 'km', label: 'Khmer', native: 'ខ្មែរ', script: 'khmer' },
  { code: 'cgg', label: 'Kiga', native: 'Rukiga' },
  { code: 'rw', label: 'Kinyarwanda', native: 'Kinyarwanda' },
  { code: 'ktu', label: 'Kituba', native: 'Kikongo ya leta' },
  { code: 'gom', label: 'Konkani', native: 'कोंकणी', script: 'devanagari' },
  { code: 'ko', label: 'Korean', native: '한국어', script: 'hangul', altScripts: ['han'] },
  { code: 'kri', label: 'Krio', native: 'Krio' },
  { code: 'ku', label: 'Kurdish', native: 'Kurdî', altScripts: ['arabic'] },
  { code: 'ckb', label: 'Kurdish (Sorani)', native: 'کوردیی ناوەندی', script: 'arabic' },
  { code: 'ky', label: 'Kyrgyz', native: 'Кыргызча', script: 'cyrillic', altScripts: ['latin'] },
  { code: 'lo', label: 'Lao', native: 'ລາວ', script: 'lao' },
  { code: 'ltg', label: 'Latgalian', native: 'Latgaliešu' },
  { code: 'la', label: 'Latin', native: 'Latina' },
  { code: 'lv', label: 'Latvian', native: 'Latviešu' },
  { code: 'lij', label: 'Ligurian', native: 'Ligure' },
  { code: 'li', label: 'Limburgish', native: 'Limburgs' },
  { code: 'ln', label: 'Lingala', native: 'Lingála' },
  { code: 'lt', label: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lmo', label: 'Lombard', native: 'Lombard' },
  { code: 'luo', label: 'Luo', native: 'Dholuo' },
  { code: 'lb', label: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { code: 'mk', label: 'Macedonian', native: 'Македонски', script: 'cyrillic' },
  { code: 'mai', label: 'Maithili', native: 'मैथिली', script: 'devanagari' },
  { code: 'mak', label: 'Makassarese', native: 'Basa Mangkasara' },
  { code: 'mg', label: 'Malagasy', native: 'Malagasy' },
  { code: 'ms', label: 'Malay', native: 'Bahasa Melayu', altScripts: ['arabic'] },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം', script: 'malayalam' },
  { code: 'mt', label: 'Maltese', native: 'Malti' },
  { code: 'mi', label: 'Maori', native: 'Te Reo Māori' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', script: 'devanagari' },
  { code: 'chm', label: 'Meadow Mari', native: 'Олык марий', script: 'cyrillic' },
  { code: 'mni', label: 'Meiteilon', native: 'ꯃꯤꯇꯩꯂꯣꯟꯁ', also: ['mni-mtei'] },
  { code: 'min', label: 'Minangkabau', native: 'Baso Minang' },
  { code: 'lus', label: 'Mizo', native: 'Mizo ṭawng' },
  { code: 'mn', label: 'Mongolian', native: 'Монгол', script: 'cyrillic', altScripts: ['latin'] },
  { code: 'nr', label: 'Ndebele (South)', native: 'isiNdebele' },
  { code: 'ne', label: 'Nepali', native: 'नेपाली', script: 'devanagari' },
  { code: 'new', label: 'Newari', native: 'नेपाल भाषा', script: 'devanagari' },
  { code: 'nso', label: 'Northern Sotho', native: 'Sesotho sa Leboa' },
  { code: 'no', label: 'Norwegian', native: 'Norsk' },
  { code: 'nus', label: 'Nuer', native: 'Thok Naath' },
  { code: 'ny', label: 'Nyanja', native: 'Chichewa' },
  { code: 'oc', label: 'Occitan', native: 'Occitan' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ', script: 'odia' },
  { code: 'om', label: 'Oromo', native: 'Afaan Oromoo' },
  { code: 'pag', label: 'Pangasinan', native: 'Salitan Pangasinan' },
  { code: 'pap', label: 'Papiamento', native: 'Papiamentu' },
  { code: 'ps', label: 'Pashto', native: 'پښتو', script: 'arabic' },
  { code: 'fa', label: 'Persian', native: 'فارسی', script: 'arabic' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'gurmukhi', altScripts: ['arabic'] },
  { code: 'qu', label: 'Quechua', native: 'Runasimi' },
  { code: 'rom', label: 'Romani', native: 'Romani čhib' },
  { code: 'ro', label: 'Romanian', native: 'Română' },
  { code: 'rn', label: 'Rundi', native: 'Ikirundi' },
  { code: 'ru', label: 'Russian', native: 'Русский', script: 'cyrillic' },
  { code: 'sm', label: 'Samoan', native: 'Gagana Samoa' },
  { code: 'sg', label: 'Sango', native: 'Sängö' },
  { code: 'sa', label: 'Sanskrit', native: 'संस्कृतम्', script: 'devanagari' },
  { code: 'gd', label: 'Scots Gaelic', native: 'Gàidhlig' },
  { code: 'sr', label: 'Serbian', native: 'Српски', script: 'cyrillic', altScripts: ['latin'] },
  { code: 'st', label: 'Sesotho', native: 'Sesotho' },
  { code: 'crs', label: 'Seychellois Creole', native: 'Kreol Seselwa' },
  { code: 'shn', label: 'Shan', native: 'လိၵ်ႈတႆး', script: 'burmese' },
  { code: 'sn', label: 'Shona', native: 'ChiShona' },
  { code: 'scn', label: 'Sicilian', native: 'Sicilianu' },
  { code: 'szl', label: 'Silesian', native: 'Ślōnskŏ' },
  { code: 'sd', label: 'Sindhi', native: 'سنڌي', script: 'arabic', altScripts: ['devanagari'] },
  { code: 'si', label: 'Sinhala', native: 'සිංහල', script: 'sinhala' },
  { code: 'sk', label: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', label: 'Slovenian', native: 'Slovenščina' },
  { code: 'so', label: 'Somali', native: 'Soomaali' },
  { code: 'su', label: 'Sundanese', native: 'Basa Sunda' },
  { code: 'sw', label: 'Swahili', native: 'Kiswahili' },
  { code: 'ss', label: 'Swati', native: 'siSwati' },
  { code: 'sv', label: 'Swedish', native: 'Svenska' },
  { code: 'tl', label: 'Tagalog', native: 'Tagalog', also: ['fil'] },
  { code: 'tg', label: 'Tajik', native: 'Тоҷикӣ', script: 'cyrillic', altScripts: ['latin'] },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', script: 'tamil' },
  { code: 'tt', label: 'Tatar', native: 'Татар', script: 'cyrillic' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', script: 'telugu' },
  { code: 'tet', label: 'Tetum', native: 'Tetun' },
  { code: 'th', label: 'Thai', native: 'ไทย', script: 'thai' },
  { code: 'ti', label: 'Tigrinya', native: 'ትግርኛ', script: 'ethiopic' },
  { code: 'ts', label: 'Tsonga', native: 'Xitsonga' },
  { code: 'tn', label: 'Tswana', native: 'Setswana' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'tk', label: 'Turkmen', native: 'Türkmen', altScripts: ['cyrillic'] },
  { code: 'ak', label: 'Twi', native: 'Twi' },
  { code: 'uk', label: 'Ukrainian', native: 'Українська', script: 'cyrillic' },
  { code: 'ur', label: 'Urdu', native: 'اردو', script: 'arabic' },
  { code: 'ug', label: 'Uyghur', native: 'ئۇيغۇرچە', script: 'arabic' },
  { code: 'uz', label: 'Uzbek', native: 'Ozbek', altScripts: ['cyrillic'] },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'cy', label: 'Welsh', native: 'Cymraeg' },
  { code: 'xh', label: 'Xhosa', native: 'isiXhosa' },
  // Yiddish is not missing from the alphabetical run — it moved up into the defaults.
  { code: 'yo', label: 'Yoruba', native: 'Yorùbá' },
  { code: 'yua', label: 'Yucatec Maya', native: 'Maya t’aan' },
  { code: 'zu', label: 'Zulu', native: 'isiZulu' },
];

const BY_CODE = new Map(LANGUAGES.map((l) => [l.code, l]));

/** Look a stored code up. Tolerates an alias ('iw' → Hebrew) so a value saved by an
 *  older build, or read back from the detector, still resolves. */
export function findLanguage(code: string): LanguageDef | undefined {
  const c = (code || '').toLowerCase().split('-')[0];
  return BY_CODE.get(c) ?? LANGUAGES.find((l) => l.also?.some((a) => a.split('-')[0] === c));
}

/** Display name for any detected code, including ones not in the catalog. */
export function languageLabel(code: string): string {
  return findLanguage(code)?.label || (code ? code.toUpperCase() : 'another language');
}

/** Expand a student's chosen codes into every code the detector might answer with.
 *  Hebrew is the reason this exists: pick "he" and the API still says "iw". */
export function expandCodes(codes: readonly string[]): Set<string> {
  const out = new Set<string>();
  for (const c of codes) {
    const def = findLanguage(c);
    if (def) {
      out.add(def.code);
      for (const a of def.also ?? []) out.add(a.split('-')[0]);
    } else if (c) {
      out.add(c.toLowerCase().split('-')[0]); // unknown code — honor it literally
    }
  }
  return out;
}

/** Search the catalog by English name, native name, or code. Empty query = all. */
export function searchLanguages(query: string): LanguageDef[] {
  const q = query.trim().toLowerCase();
  if (!q) return LANGUAGES;
  return LANGUAGES.filter(
    (l) => l.label.toLowerCase().includes(q) || l.native.toLowerCase().includes(q) || l.code === q
  );
}
