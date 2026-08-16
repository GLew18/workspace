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
  { code: 'he', label: 'Hebrew', native: 'עברית', also: ['iw'] },
  { code: 'es', label: 'Spanish', native: 'Español' },
  { code: 'ar', label: 'Arabic', native: 'العربية' },
  { code: 'fr', label: 'French', native: 'Français' },
  // --- the rest, alphabetical, so an unfiltered list is navigable ---
  { code: 'af', label: 'Afrikaans', native: 'Afrikaans' },
  { code: 'sq', label: 'Albanian', native: 'Shqip' },
  { code: 'am', label: 'Amharic', native: 'አማርኛ' },
  { code: 'hy', label: 'Armenian', native: 'Հայերեն' },
  { code: 'az', label: 'Azerbaijani', native: 'Azərbaycan' },
  { code: 'eu', label: 'Basque', native: 'Euskara' },
  { code: 'be', label: 'Belarusian', native: 'Беларуская' },
  { code: 'bn', label: 'Bengali', native: 'বাংলা' },
  { code: 'bs', label: 'Bosnian', native: 'Bosanski' },
  { code: 'bg', label: 'Bulgarian', native: 'Български' },
  { code: 'my', label: 'Burmese', native: 'မြန်မာ' },
  { code: 'ca', label: 'Catalan', native: 'Català' },
  { code: 'ceb', label: 'Cebuano', native: 'Cebuano' },
  { code: 'zh', label: 'Chinese', native: '中文', also: ['zh-cn', 'zh-tw'] },
  { code: 'co', label: 'Corsican', native: 'Corsu' },
  { code: 'hr', label: 'Croatian', native: 'Hrvatski' },
  { code: 'cs', label: 'Czech', native: 'Čeština' },
  { code: 'da', label: 'Danish', native: 'Dansk' },
  { code: 'nl', label: 'Dutch', native: 'Nederlands' },
  { code: 'eo', label: 'Esperanto', native: 'Esperanto' },
  { code: 'et', label: 'Estonian', native: 'Eesti' },
  { code: 'fi', label: 'Finnish', native: 'Suomi' },
  { code: 'gl', label: 'Galician', native: 'Galego' },
  { code: 'ka', label: 'Georgian', native: 'ქართული' },
  { code: 'de', label: 'German', native: 'Deutsch' },
  { code: 'el', label: 'Greek', native: 'Ελληνικά' },
  { code: 'gu', label: 'Gujarati', native: 'ગુજરાતી' },
  { code: 'ht', label: 'Haitian Creole', native: 'Kreyòl Ayisyen' },
  { code: 'ha', label: 'Hausa', native: 'Hausa' },
  { code: 'haw', label: 'Hawaiian', native: 'Olelo Hawaii' },
  { code: 'hi', label: 'Hindi', native: 'हिन्दी' },
  { code: 'hmn', label: 'Hmong', native: 'Hmoob' },
  { code: 'hu', label: 'Hungarian', native: 'Magyar' },
  { code: 'is', label: 'Icelandic', native: 'Íslenska' },
  { code: 'ig', label: 'Igbo', native: 'Igbo' },
  { code: 'id', label: 'Indonesian', native: 'Bahasa Indonesia' },
  { code: 'ga', label: 'Irish', native: 'Gaeilge' },
  { code: 'it', label: 'Italian', native: 'Italiano' },
  { code: 'ja', label: 'Japanese', native: '日本語' },
  { code: 'jv', label: 'Javanese', native: 'Basa Jawa', also: ['jw'] },
  { code: 'kn', label: 'Kannada', native: 'ಕನ್ನಡ' },
  { code: 'kk', label: 'Kazakh', native: 'Қазақ' },
  { code: 'km', label: 'Khmer', native: 'ខ្មែរ' },
  { code: 'rw', label: 'Kinyarwanda', native: 'Kinyarwanda' },
  { code: 'ko', label: 'Korean', native: '한국어' },
  { code: 'ku', label: 'Kurdish', native: 'Kurdî' },
  { code: 'ky', label: 'Kyrgyz', native: 'Кыргызча' },
  { code: 'lo', label: 'Lao', native: 'ລາວ' },
  { code: 'la', label: 'Latin', native: 'Latina' },
  { code: 'lv', label: 'Latvian', native: 'Latviešu' },
  { code: 'lt', label: 'Lithuanian', native: 'Lietuvių' },
  { code: 'lb', label: 'Luxembourgish', native: 'Lëtzebuergesch' },
  { code: 'mk', label: 'Macedonian', native: 'Македонски' },
  { code: 'mg', label: 'Malagasy', native: 'Malagasy' },
  { code: 'ms', label: 'Malay', native: 'Bahasa Melayu' },
  { code: 'ml', label: 'Malayalam', native: 'മലയാളം' },
  { code: 'mt', label: 'Maltese', native: 'Malti' },
  { code: 'mi', label: 'Maori', native: 'Te Reo Māori' },
  { code: 'mr', label: 'Marathi', native: 'मराठी' },
  { code: 'mn', label: 'Mongolian', native: 'Монгол' },
  { code: 'ne', label: 'Nepali', native: 'नेपाली' },
  { code: 'no', label: 'Norwegian', native: 'Norsk' },
  { code: 'ny', label: 'Nyanja', native: 'Chichewa' },
  { code: 'or', label: 'Odia', native: 'ଓଡ଼ିଆ' },
  { code: 'ps', label: 'Pashto', native: 'پښتو' },
  { code: 'fa', label: 'Persian', native: 'فارسی' },
  { code: 'pl', label: 'Polish', native: 'Polski' },
  { code: 'pt', label: 'Portuguese', native: 'Português' },
  { code: 'pa', label: 'Punjabi', native: 'ਪੰਜਾਬੀ' },
  { code: 'ro', label: 'Romanian', native: 'Română' },
  { code: 'ru', label: 'Russian', native: 'Русский' },
  { code: 'sm', label: 'Samoan', native: 'Gagana Samoa' },
  { code: 'gd', label: 'Scots Gaelic', native: 'Gàidhlig' },
  { code: 'sr', label: 'Serbian', native: 'Српски' },
  { code: 'st', label: 'Sesotho', native: 'Sesotho' },
  { code: 'sn', label: 'Shona', native: 'ChiShona' },
  { code: 'sd', label: 'Sindhi', native: 'سنڌي' },
  { code: 'si', label: 'Sinhala', native: 'සිංහල' },
  { code: 'sk', label: 'Slovak', native: 'Slovenčina' },
  { code: 'sl', label: 'Slovenian', native: 'Slovenščina' },
  { code: 'so', label: 'Somali', native: 'Soomaali' },
  { code: 'su', label: 'Sundanese', native: 'Basa Sunda' },
  { code: 'sw', label: 'Swahili', native: 'Kiswahili' },
  { code: 'sv', label: 'Swedish', native: 'Svenska' },
  { code: 'tl', label: 'Tagalog', native: 'Tagalog', also: ['fil'] },
  { code: 'tg', label: 'Tajik', native: 'Тоҷикӣ' },
  { code: 'ta', label: 'Tamil', native: 'தமிழ்' },
  { code: 'tt', label: 'Tatar', native: 'Татар' },
  { code: 'te', label: 'Telugu', native: 'తెలుగు' },
  { code: 'th', label: 'Thai', native: 'ไทย' },
  { code: 'tr', label: 'Turkish', native: 'Türkçe' },
  { code: 'tk', label: 'Turkmen', native: 'Türkmen' },
  { code: 'uk', label: 'Ukrainian', native: 'Українська' },
  { code: 'ur', label: 'Urdu', native: 'اردو' },
  { code: 'ug', label: 'Uyghur', native: 'ئۇيغۇرچە' },
  { code: 'uz', label: 'Uzbek', native: 'Ozbek' },
  { code: 'vi', label: 'Vietnamese', native: 'Tiếng Việt' },
  { code: 'cy', label: 'Welsh', native: 'Cymraeg' },
  { code: 'xh', label: 'Xhosa', native: 'isiXhosa' },
  { code: 'yi', label: 'Yiddish', native: 'ייִדיש' },
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
