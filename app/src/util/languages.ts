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
export function scriptOf(text: string): Script {
  for (const [name, re] of RANGES) if (re.test(text)) return name;
  return 'latin';
}

/**
 * LANGUAGES A DETECTOR REALISTICALLY CONFUSES WITH EACH OTHER.
 *
 * Every group is a set of close relatives — same family, largely shared vocabulary,
 * often mutually intelligible in writing. This is the ONLY basis on which Cobalt
 * will second-guess a detector: if it names Afrikaans and the student enabled Dutch,
 * that is a coin-flip between two languages a short sentence genuinely cannot
 * separate, so it is worth asking again. If it names Chinese and the student enabled
 * Japanese, that is not a near-miss — those are unrelated families that merely share
 * a set of characters — so the answer stands and the title is left alone.
 *
 * That distinction is what fixes the Asian languages without abandoning the sibling
 * rescue that made Slovak work (Gabe, 8/16). Han is shared by three languages and
 * confusable by none of them; Latin is shared by ninety and confusable within small
 * clusters only.
 */
const SIBLINGS: string[][] = [
  ['nl', 'af'],                                     // Dutch / Afrikaans
  ['cs', 'sk'],                                     // Czech / Slovak
  ['hr', 'bs', 'sr', 'sl', 'mk'],                   // South Slavic
  ['pl', 'cs', 'sk'],                               // West Slavic
  ['ru', 'uk', 'be', 'bg'],                         // East Slavic + Bulgarian
  ['es', 'pt', 'gl', 'ca', 'it', 'ro'],             // Romance
  ['da', 'no', 'sv', 'is'],                         // North Germanic
  ['de', 'lb', 'yi'],                               // German cluster
  ['id', 'ms', 'jv', 'su'],                         // Malay cluster
  ['hi', 'mr', 'ne', 'bn'],                         // Indo-Aryan
  ['fa', 'ur', 'tg', 'ps'],                         // Persian cluster
  ['fi', 'et'],                                     // Finnic
  ['tr', 'az', 'uz', 'kk', 'ky', 'tk', 'tt'],       // Turkic
  ['ar', 'he', 'mt', 'am'],                         // Semitic
  ['zu', 'xh', 'st', 'sn', 'ny', 'sw'],             // Bantu
  ['ga', 'gd', 'cy'],                               // Celtic
  ['lv', 'lt'],                                     // Baltic
];

/** Are these two close enough that a detector could genuinely mix them up? */
export function areSiblings(a: string, b: string): boolean {
  if (!a || !b || a === b) return a === b && !!a;
  return SIBLINGS.some((g) => g.includes(a) && g.includes(b));
}

/** Could a title in `script` plausibly be this language? */
export function writesScript(def: LanguageDef | undefined, script: Script): boolean {
  const primary = def?.script ?? 'latin';
  return primary === script || !!def?.altScripts?.includes(script);
}

/** The four Cobalt turns on for a new student (Gabe, 8/15). Hebrew is why the
 *  feature exists — Ivrit titles come straight from Schoology — and Spanish, Arabic
 *  and French are the school's other taught languages. */
export const DEFAULT_TRANSLATE_FROM = ['he', 'es', 'ar', 'fr'];

/** Every language Cobalt can translate from: the four defaults first, then the rest
 *  alphabetically by English name.
 *
 *  This is Google Translate's own detectable set, so anything a title could
 *  realistically be written in is here. The CATALOG is not the limit — the student's
 *  picks are, and that separation is the entire design. A short list would have been
 *  a second, invisible gate on top of the one they can actually see and change.
 *
 *  VERIFIED 8/15/26 against cloud.google.com/translate/docs/languages: all 106 codes
 *  below appear in Google's published list. Four need an alias, because the code
 *  Google REPORTS is not the modern one: Hebrew answers 'iw', Javanese 'jw', Tagalog
 *  'fil', and Chinese 'zh-CN'/'zh-TW' (handled by the base-code split in
 *  findLanguage). Those are covered by `also` and asserted in langtest.html.
 *
 *  A wrong code here would be quiet rather than harmful: that language would simply
 *  never match, so nothing written in it would translate. Nothing else breaks. */
export const LANGUAGES: LanguageDef[] = [
  // --- the four defaults, first ---
  // Google still reports Hebrew with the retired ISO code 'iw', so both must match.
  { code: 'he', label: 'Hebrew', native: 'עברית', also: ['iw'], script: 'hebrew' },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'ar', label: 'Arabic', native: 'العربية', script: 'arabic' },
  { code: 'fr', label: 'French', native: 'Français' },
  // --- the rest, alphabetical, so an unfiltered list is navigable ---
  { code: 'af', label: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', label: 'Albanian', native: 'Shqip' },
  { code: 'am', label: 'Amharic', native: 'አማርኛ', script: 'ethiopic' },
  { code: 'hy', label: 'Armenian', native: 'Հայերեն', script: 'armenian' },
  { code: 'az', label: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'eu', label: 'Basque', native: 'Euskara' },
  { code: 'be', label: 'Belarusian', native: 'Беларуская', script: 'cyrillic' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা', script: 'bengali' },
  { code: 'bs', label: 'Bosnian', native: 'Bosanski' },
  { code: 'bg', label: 'Bulgarian', native: 'Български', script: 'cyrillic' },
  { code: 'my', label: 'Burmese', native: 'မြန်မာ', script: 'burmese' },
  { code: 'ca', label: 'Catalan', native: 'Català' },
  { code: 'ceb', label: 'Cebuano', native: 'Cebuano' },
  { code: 'zh', label: 'Chinese', native: '中文', also: ['zh-cn', 'zh-tw'], script: 'han' },
  { code: 'co', label: 'Corsican', native: 'Corsu' },
  { code: 'hr', label: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', label: 'Czech', native: 'Čeština' },
  { code: 'da', label: 'Danish', native: 'Dansk' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
  { code: 'eo', label: 'Esperanto', native: 'Esperanto' },
  { code: 'et', label: 'Estonian', native: 'Eesti' },
  { code: 'fi', label: 'Finnish', native: 'Suomi' },
  { code: 'gl', label: 'Galician', native: 'Galego' },
  { code: 'ka', label: 'Georgian', native: 'ქართული', script: 'georgian' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'el', label: 'Greek', native: 'Ελληνικά', script: 'greek' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી', script: 'gujarati' },
  { code: 'ht', label: 'Haitian Creole', native: 'Kreyòl Ayisyen' },
  { code: 'ha', label: 'Hausa', native: 'Hausa' },
  { code: 'haw', label: 'Hawaiian', native: 'Olelo Hawaii' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी', script: 'devanagari' },
  { code: 'hmn', label: 'Hmong', native: 'Hmoob' },
  { code: 'hu', label: 'Hungarian', native: 'Magyar' },
  { code: 'is', label: 'Icelandic', native: 'Íslenska' },
  { code: 'ig', label: 'Igbo', native: 'Igbo' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ga', label: 'Irish', native: 'Gaeilge' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ja', label: 'Japanese', native: '日本語', script: 'kana', altScripts: ['han'] },
  { code: 'jv', label: 'Javanese', native: 'Basa Jawa', also: ['jw'] },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ', script: 'kannada' },
  { code: 'kk', label: 'Kazakh', native: 'Қазақ', script: 'cyrillic' },
  { code: 'km', label: 'Khmer', native: 'ខ្មែរ', script: 'khmer' },
  { code: 'rw', label: 'Kinyarwanda', native: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean', native: '한국어', script: 'hangul', altScripts: ['han'] },
  { code: 'ku', label: 'Kurdish', native: 'Kurdî' },
  { code: 'ky', label: 'Kyrgyz', native: 'Кыргызча', script: 'cyrillic' },
  { code: 'lo', label: 'Lao', native: 'ລາວ', script: 'lao' },
  { code: 'la', label: 'Latin', native: 'Latina' },
  { code: 'lv', label: 'Latvian', native: 'Latviešu' },
  { code: 'lt', label: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lb', label: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { code: 'mk', label: 'Macedonian', native: 'Македонски', script: 'cyrillic' },
  { code: 'mg', label: 'Malagasy', native: 'Malagasy' },
  { code: 'ms', label: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം', script: 'malayalam' },
  { code: 'mt', label: 'Maltese', native: 'Malti' },
  { code: 'mi', label: 'Maori', native: 'Te Reo Māori' },
  { code: 'mr', label: 'Marathi', native: 'मराठी', script: 'devanagari' },
  { code: 'mn', label: 'Mongolian', native: 'Монгол', script: 'cyrillic' },
  { code: 'ne', label: 'Nepali', native: 'नेपाली', script: 'devanagari' },
  { code: 'no', label: 'Norwegian', native: 'Norsk' },
  { code: 'ny', label: 'Nyanja', native: 'Chichewa' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ', script: 'odia' },
  { code: 'ps', label: 'Pashto', native: 'پښتو', script: 'arabic' },
  { code: 'fa', label: 'Persian', native: 'فارسی', script: 'arabic' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ', script: 'gurmukhi' },
  { code: 'ro', label: 'Romanian', native: 'Română' },
  { code: 'ru', label: 'Russian', native: 'Русский', script: 'cyrillic' },
  { code: 'sm', label: 'Samoan', native: 'Gagana Samoa' },
  { code: 'gd', label: 'Scots Gaelic', native: 'Gàidhlig' },
  { code: 'sr', label: 'Serbian', native: 'Српски', script: 'cyrillic' },
  { code: 'st', label: 'Sesotho', native: 'Sesotho' },
  { code: 'sn', label: 'Shona', native: 'ChiShona' },
  { code: 'sd', label: 'Sindhi', native: 'سنڌي', script: 'arabic' },
  { code: 'si', label: 'Sinhala', native: 'සිංහල', script: 'sinhala' },
  { code: 'sk', label: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', label: 'Slovenian', native: 'Slovenščina' },
  { code: 'so', label: 'Somali', native: 'Soomaali' },
  { code: 'su', label: 'Sundanese', native: 'Basa Sunda' },
  { code: 'sw', label: 'Swahili', native: 'Kiswahili' },
  { code: 'sv', label: 'Swedish', native: 'Svenska' },
  { code: 'tl', label: 'Tagalog', native: 'Tagalog', also: ['fil'] },
  { code: 'tg', label: 'Tajik', native: 'Тоҷикӣ', script: 'cyrillic' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்', script: 'tamil' },
  { code: 'tt', label: 'Tatar', native: 'Татар', script: 'cyrillic' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు', script: 'telugu' },
  { code: 'th', label: 'Thai', native: 'ไทย', script: 'thai' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'tk', label: 'Turkmen', native: 'Türkmen' },
  { code: 'uk', label: 'Ukrainian', native: 'Українська', script: 'cyrillic' },
  { code: 'ur', label: 'Urdu', native: 'اردو', script: 'arabic' },
  { code: 'ug', label: 'Uyghur', native: 'ئۇيغۇرچە', script: 'arabic' },
  { code: 'uz', label: 'Uzbek', native: 'Ozbek' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'cy', label: 'Welsh', native: 'Cymraeg' },
  { code: 'xh', label: 'Xhosa', native: 'isiXhosa' },
  { code: 'yi', label: 'Yiddish', native: 'ייִדיש', script: 'hebrew' },
  { code: 'yo', label: 'Yoruba', native: 'Yorùbá' },
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
