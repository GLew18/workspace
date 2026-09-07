// Cobalt: THE WIDE STRESS CORPUS FOR THE LOCAL TRANSLATION GATE.
//
// scripts/checkDetector.ts is the REGRESSION suite: ~40 fixtures, every one of them
// a bug that actually happened. This file is the opposite shape — a deliberately
// broad sweep across axes nobody has hit yet, run to find out where the gate breaks
// rather than to prove a known break stays fixed.
//
// Run it with:  node scripts/runStressDetector.mjs
// Same vite bundle step and the same reason: the module under test imports the real
// prefs and language tables, so it is exercised exactly as it ships.
//
// FOUR AXES, because those are what a real Schoology feed varies on:
//
//   1. LANGUAGE OBSCURITY. Not es/fr/de, which every wordlist knows, but the
//      Latin-script languages with no diacritics to lean on and no function words in
//      FOREIGN_FUNCTION: Zulu, Somali, Basque, Welsh, Malagasy, Tok Pisin. These
//      survive only if their ENGLISH density lands under MIN_ENGLISH, which is a
//      much thinner margin than any fixture in checkDetector.ts tests.
//
//   2. DIALECT AND SCRIPT VARIANT. Hindi and Urdu are one language in two scripts;
//      Serbian is one language in two scripts; Yiddish and Aramaic are Hebrew script
//      carrying a language that is not Hebrew. That last pair is the one that
//      matters most here — this is a school that teaches Talmud, in Aramaic, for two
//      years.
//
//   3. SENTENCE COMPLEXITY. One word to six hundred characters, run-ons, ALL CAPS,
//      semicolon-chained clauses, numbered lists.
//
//   4. DIVERSIONS. The junk real teacher text carries: URLs, emoji, LaTeX, markdown,
//      course codes, citations, page ranges, Word-export homoglyphs, NFD accents,
//      and English proper nouns crowding out the foreign words around them.
//
// WHAT A FAILURE MEANS, and the asymmetry is the same one localDetect.ts is built
// around: a foreign text SKIPPED is a translation the student silently never sees,
// and that is fatal. An English text SENT costs a fraction of a cent and is reported
// as a rate, not a failure.

import { localVerdict, DETECTOR_VERSION } from '../src/util/localDetect';
import { substantiveScripts } from '../src/util/languages';
import { setPrefsCache, getPrefs } from '../src/prefs';

/** What the gate is allowed to do with a case. */
type Want = 'send' | 'skip';

interface Case {
  /** BCP-47-ish tag, or a note when the "language" is the point (homoglyph, mixed). */
  tag: string;
  text: string;
  want: Want;
  /** Why this case is in the corpus, printed only on failure. */
  note?: string;
}

/** A generous enabled list, so a "send" is never merely a language being switched
 *  off, and a "skip" is never merely the unwritable branch firing. The narrow-list
 *  behaviour has its own section at the bottom. */
const WIDE = [
  'he', 'es', 'ar', 'fr', 'de', 'it', 'nl', 'pt', 'sv', 'no', 'da', 'fi', 'pl', 'cs',
  'ru', 'uk', 'zh', 'ja', 'ko', 'hi', 'ur', 'fa', 'tr', 'vi', 'th', 'el', 'hu', 'ro',
  'id', 'ms', 'tl', 'sw', 'zu', 'yo', 'am', 'ka', 'hy', 'ta', 'te', 'bn', 'km', 'lo',
  'my', 'si', 'ne', 'af', 'sq', 'eu', 'cy', 'ga', 'is', 'mt', 'lv', 'lt', 'et', 'sl',
  'hr', 'sr', 'bg', 'mk', 'ht', 'la', 'eo', 'so', 'mg', 'haw', 'mi', 'qu', 'gn', 'yi',
];

// ---------------------------------------------------------------------------
// 1. LANGUAGE OBSCURITY — Latin script, diacritics stripped where the language
//    tolerates it. Every one of these MUST be sent, and most of them have zero
//    support from FOREIGN_FUNCTION, so they pass or fail on English density alone.
// ---------------------------------------------------------------------------
const OBSCURE_LATIN: Case[] = [
  { tag: 'zu', want: 'send', text: 'Funda isahluko sesikhombisa bese uphendula yonke imibuzo esencwadini yakho ngokucophelela' },
  { tag: 'xh', want: 'send', text: 'Funda isahluko sesixhenxe uze uphendule yonke imibuzo esencwadini yakho ngononophelo' },
  { tag: 'so', want: 'send', text: 'Akhri cutubka toddobaad oo ka jawaab suaalaha oo dhan ee buugga kugu qoran maanta' },
  { tag: 'eu', want: 'send', text: 'Irakurri zazpigarren kapitulua eta erantzun liburuan datozen galdera guztiak arretaz' },
  { tag: 'cy', want: 'send', text: 'Darllenwch y bennod saith ac atebwch y cwestiynau i gyd yn eich llyfr yn ofalus' },
  { tag: 'mg', want: 'send', text: 'Vakio ny toko fahafito ary valio ny fanontaniana rehetra ao amin ny bokinao tsara' },
  { tag: 'sq', want: 'send', text: 'Lexoni kapitullin e shtate dhe pergjigjuni pyetjeve te gjitha ne librin tuaj me kujdes' },
  { tag: 'tr', want: 'send', text: 'Yedinci bolumu okuyun ve kitabinizdaki tum sorulari dikkatlice yanitlayin lutfen bugun' },
  { tag: 'fi', want: 'send', text: 'Lukekaa seitsemas luku ja vastatkaa kaikkiin kirjan kysymyksiin huolellisesti tanaan' },
  { tag: 'et', want: 'send', text: 'Lugege seitsmes peatukk ja vastake koikidele raamatus olevatele kusimustele hoolikalt' },
  { tag: 'hu', want: 'send', text: 'Olvassatok el a hetedik fejezetet es valaszoljatok a konyvben talalhato kerdesekre' },
  { tag: 'lt', want: 'send', text: 'Perskaitykite septintaji skyriu ir atsakykite i visus knygoje esancius klausimus' },
  { tag: 'lv', want: 'send', text: 'Izlasiet septito nodalu un atbildiet uz visiem gramata esosajiem jautajumiem rupigi' },
  { tag: 'ht', want: 'send', text: 'Li chapit set la epi reponn tout kesyon yo ki nan liv la pou demen maten anvan klas' },
  { tag: 'la', want: 'send', text: 'Lege capitulum septimum et responde ad omnes quaestiones in libro tuo diligenter' },
  { tag: 'qu', want: 'send', text: 'Qanchis yachana qillqata nawinchay hinaspa llapan tapukuykunata kutichiy allinta' },
  { tag: 'ceb', want: 'send', text: 'Basaha ang kapitulo pito ug tubaga ang tanang pangutana sa imong libro pag-ayo karon' },
  { tag: 'tpi', want: 'send', text: 'Ritim namba seven sapta na bekim olgeta askim i stap long buk bilong yu gut tru' },
  { tag: 'af', want: 'send', text: 'Lees hoofstuk sewe en beantwoord al die vrae in jou boek versigtig voor die klas' },
  { tag: 'ms', want: 'send', text: 'Bacalah bab ketujuh dan jawab semua soalan yang terdapat dalam buku anda dengan teliti' },
  { tag: 'sw', want: 'send', text: 'Soma sura ya saba naujibu maswali yote yaliyo katika kitabu chako kwa uangalifu leo' },
  { tag: 'gn', want: 'send', text: 'Emonee pe capitulo siete ha embohovai opa porandu oiva nde arandukapepe hekopete' },
];

/** The same axis, but WITH the diacritics the language really writes. These should
 *  all be caught by ACCENTED before any density test runs, so they are the easy half
 *  — included so a regression in ACCENTED shows up as a block of failures rather
 *  than one. */
const OBSCURE_ACCENTED: Case[] = [
  { tag: 'is', want: 'send', text: 'Lesið sjöunda kaflann og svarið öllum spurningunum í bókinni ykkar vandlega í dag' },
  { tag: 'mt', want: 'send', text: 'Aqra s-seba kapitlu u wieġeb il-mistoqsijiet kollha fil-ktieb tiegħek bir-reqqa' },
  { tag: 'ga', want: 'send', text: 'Léigh an seachtú caibidil agus freagair na ceisteanna go léir i do leabhar go cúramach' },
  { tag: 'vi', want: 'send', text: 'Đọc chương bảy và trả lời tất cả các câu hỏi trong sách của bạn một cách cẩn thận' },
  { tag: 'yo', want: 'send', text: 'Ka orí keje kí o sì dáhùn gbogbo àwọn ìbéèrè tí ó wà nínú ìwé rẹ pẹ̀lú ìtọ́jú' },
  { tag: 'haw', want: 'send', text: 'E heluhelu i ka mokuna hiku a e pane i nā nīnau a pau i loko o kāu puke me ka nānā' },
  { tag: 'mi', want: 'send', text: 'Pānuitia te upoko tuawhitu ka whakautu i ngā pātai katoa i roto i tō pukapuka' },
  { tag: 'eo', want: 'send', text: 'Legu la sepan ĉapitron kaj respondu ĉiujn demandojn en via libro tre atenteme hodiaŭ' },
  { tag: 'ro', want: 'send', text: 'Citiți capitolul șapte și răspundeți la toate întrebările din cartea voastră atent' },
  { tag: 'pl', want: 'send', text: 'Przeczytajcie rozdział siódmy i odpowiedzcie na wszystkie pytania w książce uważnie' },
  { tag: 'cs', want: 'send', text: 'Přečtěte si sedmou kapitolu a odpovězte na všechny otázky v učebnici pozorně dnes' },
  { tag: 'hr', want: 'send', text: 'Pročitajte sedmo poglavlje i odgovorite na sva pitanja u svojoj knjizi pažljivo' },
  { tag: 'sl', want: 'send', text: 'Preberite sedmo poglavje in odgovorite na vsa vprašanja v svoji knjigi natančno' },
];

// ---------------------------------------------------------------------------
// 2. NON-LATIN SCRIPTS, WIDE. All must send: every one of these languages is on
//    WIDE, so the readable branch has to find them.
// ---------------------------------------------------------------------------
const NON_LATIN: Case[] = [
  { tag: 'he', want: 'send', text: 'קראו את פרק שבע וענו על כל השאלות שבספר בעיון לפני השיעור של מחר בבוקר' },
  { tag: 'he-nikud', want: 'send', text: 'קִרְאוּ אֶת הַפֶּרֶק הַשְּׁבִיעִי וְעַנוּ עַל כָּל הַשְּׁאֵלוֹת שֶׁבַּסֵּפֶר', note: 'nikud are combining marks, not letters — base letters must still count' },
  { tag: 'ar', want: 'send', text: 'اقرأ الفصل السابع وأجب عن جميع الأسئلة الموجودة في كتابك بعناية قبل الحصة' },
  { tag: 'ar-EG', want: 'send', text: 'اقرا الفصل السابع وجاوب على كل الاسئلة اللي في الكتاب بتركيز قبل الحصة بكرة' },
  { tag: 'fa', want: 'send', text: 'فصل هفتم را بخوانید و به همه سوالات موجود در کتاب خود با دقت پاسخ دهید امروز' },
  { tag: 'ur', want: 'send', text: 'ساتواں باب پڑھیں اور اپنی کتاب میں موجود تمام سوالات کے جوابات احتیاط سے دیں' },
  { tag: 'ps', want: 'send', text: 'اوومه فصل ولولئ او په خپل کتاب کې د ټولو پوښتنو ځوابونه په پوره پاملرنې ورکړئ' },
  { tag: 'ru', want: 'send', text: 'Прочитайте седьмую главу и ответьте на все вопросы в учебнике внимательно сегодня' },
  { tag: 'uk', want: 'send', text: 'Прочитайте сьомий розділ і дайте відповіді на всі питання у підручнику уважно' },
  { tag: 'sr-Cyrl', want: 'send', text: 'Прочитајте седмо поглавље и одговорите на сва питања у својој књизи пажљиво данас' },
  { tag: 'bg', want: 'send', text: 'Прочетете седма глава и отговорете на всички въпроси в учебника внимателно днес' },
  { tag: 'el', want: 'send', text: 'Διαβάστε το έβδομο κεφάλαιο και απαντήστε σε όλες τις ερωτήσεις του βιβλίου σας' },
  { tag: 'hy', want: 'send', text: 'Կարդացեք յոթերորդ գլուխը և պատասխանեք գրքի բոլոր հարցերին ուշադիր այսօր' },
  { tag: 'ka', want: 'send', text: 'წაიკითხეთ მეშვიდე თავი და უპასუხეთ წიგნში მოცემულ ყველა კითხვას ყურადღებით' },
  { tag: 'am', want: 'send', text: 'ሰባተኛውን ምዕራፍ አንብቡ እና በመጽሐፉ ውስጥ ያሉትን ሁሉንም ጥያቄዎች በጥንቃቄ መልሱ' },
  { tag: 'hi', want: 'send', text: 'सातवाँ अध्याय पढ़ें और अपनी पुस्तक में दिए गए सभी प्रश्नों के उत्तर ध्यान से दें' },
  { tag: 'ne', want: 'send', text: 'सातौं अध्याय पढ्नुहोस् र आफ्नो पुस्तकमा दिइएका सबै प्रश्नहरूको उत्तर दिनुहोस्' },
  { tag: 'bn', want: 'send', text: 'সপ্তম অধ্যায় পড়ুন এবং আপনার বইয়ের সমস্ত প্রশ্নের উত্তর মনোযোগ সহকারে দিন' },
  { tag: 'ta', want: 'send', text: 'ஏழாவது பாடத்தைப் படித்து உங்கள் புத்தகத்தில் உள்ள அனைத்து கேள்விகளுக்கும் பதிலளிக்கவும்' },
  { tag: 'te', want: 'send', text: 'ఏడవ అధ్యాయాన్ని చదివి మీ పుస్తకంలోని అన్ని ప్రశ్నలకు జాగ్రత్తగా సమాధానం ఇవ్వండి' },
  { tag: 'si', want: 'send', text: 'සත්වන පරිච්ඡේදය කියවා ඔබේ පොතේ ඇති සියලුම ප්‍රශ්නවලට ප්‍රවේශමෙන් පිළිතුරු දෙන්න' },
  { tag: 'km', want: 'send', text: 'អានជំពូកទីប្រាំពីរ ហើយឆ្លើយសំណួរទាំងអស់នៅក្នុងសៀវភៅរបស់អ្នកដោយប្រុងប្រយ័ត្ន' },
  { tag: 'lo', want: 'send', text: 'ອ່ານບົດທີເຈັດ ແລະ ຕອບຄໍາຖາມທັງຫມົດໃນປຶ້ມຂອງເຈົ້າຢ່າງລະມັດລະວັງ' },
  { tag: 'my', want: 'send', text: 'သတ္တမအခန်းကို ဖတ်ပြီး သင့်စာအုပ်ထဲရှိ မေးခွန်းအားလုံးကို သတိထားဖြေဆိုပါ' },
  { tag: 'th', want: 'send', text: 'อ่านบทที่เจ็ดและตอบคำถามทั้งหมดในหนังสือของคุณอย่างระมัดระวังก่อนเข้าเรียน' },
  { tag: 'zh-Hans', want: 'send', text: '阅读第七章并仔细回答课本中的所有问题，明天上课前完成。' },
  { tag: 'zh-Hant', want: 'send', text: '閱讀第七章並仔細回答課本中的所有問題，明天上課前完成。' },
  { tag: 'yue', want: 'send', text: '睇完第七章，然後將書本裏面所有問題都答清楚，聽日上堂之前做完。' },
  { tag: 'ja', want: 'send', text: '第七章を読んで、教科書のすべての質問に注意深く答えてください。明日の授業までに。' },
  { tag: 'ja-kanji', want: 'send', text: '第七章読解及全問解答', note: 'pure kanji title reads as Han, not kana — altScripts is why ja survives' },
  { tag: 'ko', want: 'send', text: '일곱 번째 장을 읽고 교과서에 있는 모든 질문에 주의 깊게 답하십시오' },
];

// ---------------------------------------------------------------------------
// 3. THE JEWISH-STUDIES CASES. Hebrew script carrying a language that is not
//    Hebrew, which is the shape this particular school generates every day.
//    All must SEND at the gate; whether the right translation comes BACK is a
//    live-provider question the gate cannot answer.
// ---------------------------------------------------------------------------
const HEBREW_SCRIPT_OTHER: Case[] = [
  { tag: 'arc/Talmud', want: 'send', text: 'תנו רבנן שלשה דברים צריך אדם לומר בתוך ביתו ערב שבת עם חשכה עשרתם ערבתם', note: 'Aramaic in Hebrew script — Talmud, grades 10-11' },
  { tag: 'arc/Aramaic', want: 'send', text: 'מאי טעמא אמר רב יהודה אמר שמואל הלכה כרבי מאיר בגזרותיו ולא בטעמיו' },
  { tag: 'yi', want: 'send', text: 'לייענט דעם זיבעטן קאפיטל און ענטפערט אויף אלע פראגן אין אייער בוך מיט אכטונג' },
  { tag: 'lad-Hebr', want: 'send', text: 'מילדאד איל קאפיטולו סייטי אי ריספונדיד א טודאס לאס פריגונטאס' },
  { tag: 'he-abbrev', want: 'send', text: 'קראו פרק ה׳ בבראשית ורש״י על פסוק ג׳ וענו על השאלות בדף העבודה שחולק בכיתה' },
  { tag: 'he-mixed', want: 'send', text: 'דקדוק worksheet page 14', note: 'bilingual title, Hebrew carries the meaning' },
  { tag: 'he-short', want: 'send', text: 'שיעורי בית' },
  { tag: 'lad-Latn', want: 'send', text: 'Melda el kapitulo siete i responde a todas las preguntas del livro kon atansion' },
];

// ---------------------------------------------------------------------------
// 4. SENTENCE COMPLEXITY. Length, shape, punctuation, casing.
// ---------------------------------------------------------------------------
const COMPLEXITY: Case[] = [
  { tag: 'he/1-word', want: 'send', text: 'מבחן' },
  { tag: 'es/2-word', want: 'send', text: 'Leer capitulo' },
  { tag: 'en/short', want: 'send', text: 'Finish lab write-up', note: 'under MIN_TOKENS — must never be guessed about' },
  { tag: 'en/short2', want: 'send', text: 'Chapter 12 questions' },
  { tag: 'es/run-on', want: 'send', text: 'lee el capitulo doce y anota la motivacion de los personajes y trae tus notas a clase manana porque vamos a discutir el texto en grupos pequenos y despues escribiremos un parrafo' },
  { tag: 'fr/semicolons', want: 'send', text: 'Lisez le chapitre; annotez les passages importants; repondez aux questions du cahier; apportez vos notes en classe demain matin sans faute' },
  { tag: 'de/ALLCAPS', want: 'send', text: 'LESEN SIE DAS SIEBTE KAPITEL UND BEANTWORTEN SIE ALLE FRAGEN IM BUCH SORGFAELTIG' },
  { tag: 'es/numbered', want: 'send', text: '1. Lee el capitulo siete. 2. Anota tres ideas principales. 3. Responde las preguntas 4 a 12 del libro. 4. Trae tus apuntes a clase.' },
  {
    tag: 'fr/long',
    want: 'send',
    text:
      'Pour le devoir de cette semaine, vous devez lire attentivement les chapitres sept et huit du roman, ' +
      'puis rediger un paragraphe de reponse dans lequel vous analysez la maniere dont le narrateur presente ' +
      'le personnage principal. Appuyez votre analyse sur au moins trois citations precises tirees du texte, ' +
      'en indiquant le numero de la page pour chacune. Nous discuterons de vos reponses en petits groupes ' +
      'lors du cours de jeudi, donc apportez vos notes ecrites a la main ainsi que votre exemplaire du livre.',
  },
  {
    tag: 'en/long',
    want: 'skip',
    text:
      'For this week you will need to read chapters seven and eight of the novel carefully, and then write a ' +
      'response paragraph in which you analyze the way the narrator presents the main character. Support your ' +
      'analysis with at least three specific quotations drawn from the text, giving the page number for each ' +
      'one. We will be discussing your responses in small groups during class on Thursday, so please bring ' +
      'your handwritten notes along with your copy of the book.',
  },
  { tag: 'en/ALLCAPS', want: 'skip', text: 'READ THE SEVENTH CHAPTER AND ANSWER ALL OF THE QUESTIONS IN THE BOOK CAREFULLY' },
  { tag: 'en/list', want: 'skip', text: '1. Read chapter seven. 2. Annotate three main ideas. 3. Answer questions four through twelve in the book. 4. Bring your notes to class.' },
];

// ---------------------------------------------------------------------------
// 5. DIVERSIONS. Everything real teacher text drags along with it. The foreign
//    entries must still send despite the noise; the English ones should still skip
//    despite it.
// ---------------------------------------------------------------------------
const DIVERSIONS: Case[] = [
  { tag: 'he+url', want: 'send', text: 'קראו את המאמר בקישור הבא וענו על השאלות https://www.haaretz.co.il/opinions/2026-08-30' },
  { tag: 'he+emoji', want: 'send', text: '📚 קראו את פרק שבע וענו על כל השאלות שבספר ✏️ להגיש עד יום חמישי בבוקר' },
  { tag: 'es+latex', want: 'send', text: 'Resuelve la ecuacion $x^2 + 5x - 14 = 0$ y explica cada uno de los pasos en tu cuaderno' },
  { tag: 'es+markdown', want: 'send', text: '**Tarea:** lee el capitulo doce y anota la motivacion de los personajes. *Entrega:* manana en clase.' },
  { tag: 'fr+coursecode', want: 'send', text: 'HW #4 (FR-201): Lisez le chapitre et repondez aux questions du cahier pour demain matin' },
  { tag: 'es+propernouns', want: 'send', text: 'Lee sobre Abraham Joshua Heschel y Martin Luther King Jr en el capitulo doce del libro' },
  { tag: 'he+propernouns', want: 'send', text: 'קראו על Abraham Joshua Heschel ועל Martin Luther King Jr בפרק השנים עשר' },
  { tag: 'es+digits', want: 'send', text: 'Lee las paginas 145 a 178 y responde las preguntas 3 4 7 9 12 15 y 18 del capitulo' },
  { tag: 'es+greek-symbol', want: 'send', text: 'Calcula el area del circulo usando π y anota tus resultados en el cuaderno de clase', note: 'the 8/28 stray-symbol regression' },
  { tag: 'ka+greek-symbol', want: 'send', text: 'წაიკითხეთ თავი და გამოთვალეთ π-ის მნიშვნელობა ყველა სავარჯიშოში ყურადღებით', note: 'the 8/29 Georgian + π case Gabe hit live' },
  { tag: 'vi+greek-symbol', want: 'send', text: 'Đọc chương bảy và tính giá trị của π trong tất cả các bài tập một cách cẩn thận' },
  { tag: 'es+cyrillic-cite', want: 'send', text: 'Lee el capitulo doce y anota la motivacion de los personajes. Fuente: Достоевский, 1866.' },
  { tag: 'es+NFD', want: 'send', text: 'Lee el capítulo doce y anota la motivación de los personajes para mañana', note: 'NFD-decomposed accents — combining range must catch these' },
  { tag: 'es+homoglyphs', want: 'send', text: 'Lee el сapitulo dосe y anota la motivacion de los personajes para manana en clase', note: 'Cyrillic c/o/e homoglyphs from a Word export' },
  { tag: 'he+rlm', want: 'send', text: '‏קראו את פרק שבע וענו על כל השאלות שבספר בעיון‎' },
  { tag: 'he+zwj', want: 'send', text: 'קראו‍ את‍ פרק‍ שבע‍ וענו‍ על‍ כל‍ השאלות‍ שבספר' },
  { tag: 'en+url', want: 'skip', text: 'Read the article at https://www.nytimes.com/2026/08/30/opinion and answer the questions in your notebook' },
  { tag: 'en+emoji', want: 'skip', text: '📚 Read chapter seven and answer all of the questions in the book ✏️ Due Thursday morning' },
  { tag: 'en+latex', want: 'skip', text: 'Solve the equation $x^2 + 5x - 14 = 0$ and explain each one of the steps in your notebook' },
  { tag: 'en+greek-symbol', want: 'skip', text: 'Calculate the area of the circle using π and record your results in the notebook for class', note: 'the fix must not have made every STEM description a paid call' },
  { tag: 'en+coursecode', want: 'skip', text: 'HW #4 (ENG-201): Read the chapter and answer the questions in your notebook for tomorrow morning' },
];

// ---------------------------------------------------------------------------
// 6. THE ENGLISH-LEXIFIED CREOLES. Genuinely other languages built on English
//    vocabulary, so ENGLISH_FUNCTION fires on them by design. Recorded as
//    'send' because a translation is wanted; expected to be the corpus's real
//    failures rather than a surprise.
// ---------------------------------------------------------------------------
const CREOLES: Case[] = [
  { tag: 'pcm', want: 'send', text: 'Make you read di chapter and answer all di question for the book before tomorrow morning' },
  { tag: 'jam', want: 'send', text: 'Read di sebent chapta an ansa aal di kwestyan dem inna yu buk gud gud before klaas' },
  { tag: 'sco', want: 'send', text: 'Read the seivent chaipter an answer aw the speirins in yer buik afore the morn' },
  { tag: 'bis', want: 'send', text: 'Yu ridim namba seven japta na yu ansarem evri kwestin long buk blong yu gud' },
];

// ---------------------------------------------------------------------------
// 7. ENGLISH THAT SHOULD SKIP. The saving. Misses cost money, not correctness.
// ---------------------------------------------------------------------------
const ENGLISH: Case[] = [
  { tag: 'en', want: 'skip', text: 'Read chapter twelve and annotate for character motivation. Annotations will be collected in class.' },
  { tag: 'en', want: 'skip', text: 'Write up the pendulum lab: hypothesis, data table, and one paragraph on sources of error.' },
  { tag: 'en', want: 'skip', text: 'Final draft of the Animal Farm essay: five paragraphs, two direct quotes per body paragraph, and MLA citations throughout.' },
  { tag: 'en', want: 'skip', text: 'Gather at least five sources on your assigned figure. Primary sources count double for this project.' },
  { tag: 'en', want: 'skip', text: 'Complete the review packet before the test on Friday and bring any questions you still have to class.' },
  { tag: 'en', want: 'skip', text: 'Please submit your reflection through the portal by the end of the day on Thursday so it can be graded.' },
  { tag: 'en/stem', want: 'skip', text: 'Balance each of the equations below and identify the limiting reagent in every one of the reactions.' },
  { tag: 'en/stem', want: 'skip', text: 'Graph the function and label the intercepts, the vertex, and the axis of symmetry on your paper.' },
  { tag: 'en/jewish', want: 'skip', text: 'Prepare the first ten lines of the sugya and be ready to explain the machloket between Rabbi Meir and Rabbi Yehuda in class.' },
  { tag: 'en/jewish', want: 'skip', text: 'Read the Rashi on the third verse and write a short paragraph explaining what question he is answering.' },
  { tag: 'en/terse', want: 'skip', text: 'Study for the unit test covering everything from the start of the chapter through the end of section four.' },
  { tag: 'en/instructions', want: 'skip', text: 'Bring your handwritten notes and a copy of the book to class on Thursday because we will be working in small groups.' },
];

const GROUPS: Array<[string, Case[]]> = [
  ['obscure Latin, no diacritics', OBSCURE_LATIN],
  ['obscure Latin, accented', OBSCURE_ACCENTED],
  ['non-Latin scripts', NON_LATIN],
  ['Hebrew script, other languages', HEBREW_SCRIPT_OTHER],
  ['sentence complexity', COMPLEXITY],
  ['diversions', DIVERSIONS],
  ['English-lexified creoles', CREOLES],
  ['English (should skip)', ENGLISH],
];

/** The narrow-list section: an alphabet nothing enabled writes must be skipped as
 *  'unwritable', because translate.ts's scriptAgrees gate would refuse the answer
 *  anyway and the call could only spend money to be told no. */
const NARROW = ['he', 'es'];
const UNWRITABLE: Case[] = [
  { tag: 'ru', want: 'skip', text: 'Прочитайте седьмую главу и ответьте на все вопросы в учебнике внимательно' },
  { tag: 'zh', want: 'skip', text: '阅读第七章并仔细回答课本中的所有问题，明天上课前完成。' },
  { tag: 'ja', want: 'skip', text: '第七章を読んで、教科書のすべての質問に注意深く答えてください。' },
  { tag: 'th', want: 'skip', text: 'อ่านบทที่เจ็ดและตอบคำถามทั้งหมดในหนังสือของคุณอย่างระมัดระวัง' },
  { tag: 'ka', want: 'skip', text: 'წაიკითხეთ მეშვიდე თავი და უპასუხეთ წიგნში მოცემულ ყველა კითხვას' },
];

function pad(s: string, n: number): string {
  return s.length >= n ? s.slice(0, n) : s + ' '.repeat(n - s.length);
}

function main(): void {
  setPrefsCache({ ...getPrefs(), tasks: { ...getPrefs().tasks, translateFrom: WIDE } });

  const line = (s: string): void => console.log(s);
  line(`\n  localDetect v${DETECTOR_VERSION} — stress corpus`);
  line(`  ${WIDE.length} languages enabled\n`);

  let cases = 0;
  let lostTranslations = 0;
  const lost: Case[] = [];
  let englishSent = 0;
  let englishTotal = 0;
  let charsBefore = 0;
  let charsAfter = 0;

  for (const [title, group] of GROUPS) {
    line(`  ${title}`);
    for (const c of group) {
      cases++;
      const v = localVerdict(c.text);
      const sent = !v.skip;
      charsBefore += c.text.length;
      if (sent) charsAfter += c.text.length;

      if (c.want === 'send') {
        if (!sent) {
          lostTranslations++;
          lost.push(c);
        }
        const mark = sent ? ' ok ' : 'FAIL';
        line(`    ${mark}  ${pad(c.tag, 16)} ${sent ? 'sent' : `SKIPPED (${(v as { why: string }).why})`}  ${c.text.slice(0, 44)}`);
      } else {
        englishTotal++;
        if (sent) englishSent++;
        line(`    ${sent ? 'SENT' : 'skip'}  ${pad(c.tag, 16)} ${c.text.slice(0, 44)}`);
      }
    }
    line('');
  }

  // The narrow-list branch.
  setPrefsCache({ ...getPrefs(), tasks: { ...getPrefs().tasks, translateFrom: NARROW } });
  line(`  unwritable with only [${NARROW.join(', ')}] enabled (must skip)`);
  let unwritableWrong = 0;
  for (const c of UNWRITABLE) {
    cases++;
    const v = localVerdict(c.text);
    const ok = v.skip && v.why === 'unwritable';
    if (!ok) unwritableWrong++;
    line(`    ${ok ? ' ok ' : 'FAIL'}  ${pad(c.tag, 16)} ${v.skip ? `skipped (${v.why})` : 'SENT'}  ${c.text.slice(0, 40)}`);
  }
  line('');

  // Script-attribution sanity: what substantiveScripts actually sees for the cases
  // where the answer is the whole question.
  setPrefsCache({ ...getPrefs(), tasks: { ...getPrefs().tasks, translateFrom: WIDE } });
  line('  script attribution (the cases where counting is the point)');
  const probes = [
    ['he-nikud', HEBREW_SCRIPT_OTHER[0].text],
    ['es+greek-symbol', 'Calcula el area del circulo usando π y anota tus resultados'],
    ['ka+greek-symbol', 'წაიკითხეთ თავი და გამოთვალეთ π-ის მნიშვნელობა ყველა სავარჯიშოში'],
    ['es+homoglyphs', 'Lee el сapitulo dосe y anota la motivacion de los personajes'],
    ['he+English', 'דקדוק worksheet page 14'],
    ['ja-kanji', '第七章読解及全問解答'],
  ] as const;
  for (const [tag, text] of probes) {
    line(`    ${pad(tag, 18)} ${JSON.stringify(substantiveScripts(text))}`);
  }

  // --- Verdict --------------------------------------------------------------
  const savePct = Math.round((1 - charsAfter / charsBefore) * 100);
  line(`\n  ${cases} cases`);
  line(`  English skipped: ${englishTotal - englishSent}/${englishTotal}`);
  line(`  characters sent across the whole corpus: ${charsAfter}/${charsBefore} (${savePct}% withheld)`);

  if (unwritableWrong) line(`  ${unwritableWrong} unwritable case(s) did not skip as expected`);

  if (lostTranslations) {
    line(`\n  ${lostTranslations} LOST TRANSLATION(S) — foreign text skipped:\n`);
    for (const c of lost) {
      line(`    ${c.tag}  ${c.text.slice(0, 70)}`);
      if (c.note) line(`      why it is here: ${c.note}`);
    }
    line('');
    process.exitCode = 1;
  } else {
    line('\n  No foreign text would be skipped.\n');
  }
}

main();
