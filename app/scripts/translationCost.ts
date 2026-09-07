// Cobalt: WHAT THE TRANSLATION SYSTEM ACTUALLY COSTS, measured rather than guessed.
//
// Runs a corpus of realistic Schoology assignments — title and description, in the
// languages a Heschel student's classes are actually in plus the ones that stress
// the detector — through the SHIPPING util/localDetect.ts, and prints what each one
// would send.
//
// Run it with:  node scripts/runTranslationCost.mjs
//
// PRICING, and where each number comes from:
//   • $20 per 1,000,000 characters, Cloud Translation v2 and v3 alike.
//   • The first 500,000 characters each month are free, shared across both.
//   • Detection performed AS PART OF a translation is not charged separately.
//   • A STANDALONE detect() call — which functions/index.js makes to get the
//     confidence number behind the 0.92 gate — could not be confirmed either way
//     from Google's public pricing pages. It is modelled here as billed, because
//     assuming the cheaper answer is how you get a surprise invoice. Set
//     DETECT_BILLED to false to see the other case.

import { localVerdict } from '../src/util/localDetect';
import { setPrefsCache, getPrefs } from '../src/prefs';

const RATE_PER_CHAR = 20 / 1_000_000;
const FREE_TIER_CHARS = 500_000;
const DETECT_BILLED = true;

/** The default four, plus the languages the corpus below uses. Nothing is being
 *  translated here — the list only decides which scripts are worth sending. */
const LANGS = ['he', 'es', 'ar', 'fr', 'de', 'it', 'pt', 'nl', 'ru', 'zh', 'ja', 'vi', 'sw', 'id'];

interface Sample {
  lang: string;
  foreign: boolean;
  title: string;
  desc: string;
  /** Why this one is in the corpus, when it is not obvious. */
  note?: string;
}

const CORPUS: Sample[] = [
  // ---- English: the great majority of any American school's Schoology ----------
  {
    lang: 'English', foreign: false,
    title: 'Read chapter 12 and annotate',
    desc: 'Read chapter 12 and annotate for character motivation. Annotations will be collected at the start of class on Wednesday.',
  },
  {
    lang: 'English', foreign: false,
    title: 'Finish lab write-up',
    desc: 'Write up the pendulum lab: hypothesis, data table, and one paragraph on sources of error. Submit it through the portal.',
  },
  {
    lang: 'English', foreign: false,
    title: 'Animal Farm essay',
    desc: 'Final draft of the Animal Farm essay: five paragraphs, two direct quotes per body paragraph, and MLA citations throughout.',
  },
  {
    lang: 'English', foreign: false,
    title: 'Unit 4 test',
    desc: 'The test covers everything from the beginning of the chapter through the end of section four. Bring a calculator and a pencil.',
  },
  {
    lang: 'English', foreign: false,
    title: 'Problem set 7',
    desc: 'Complete the odd numbered problems and show all of your work on a separate sheet of paper. Answers alone will not receive credit.',
  },

  // ---- Hebrew: the reason the feature exists ----------------------------------
  {
    lang: 'Hebrew', foreign: true,
    title: 'לקרוא פרק ה׳ ולענות על השאלות',
    desc: 'קראו את הפרק החמישי וענו על שאלות ההבנה שבסוף הפרק. יש להגיש את המחברת בתחילת השיעור.',
  },

  // ---- The school's other taught languages ------------------------------------
  {
    lang: 'Spanish', foreign: true,
    title: 'Leer el capítulo 12',
    desc: 'Lee el capítulo doce y anota la motivación de los personajes principales. Las anotaciones se recogerán en clase.',
  },
  {
    lang: 'Spanish', foreign: true,
    title: 'Leer el capitulo 12',
    desc: 'Lee el capitulo doce y anota la motivacion de los personajes principales antes de la clase del jueves.',
    note: 'no accents at all — must be caught by the function words alone',
  },
  {
    lang: 'French', foreign: true,
    title: 'Lire le chapitre 12',
    desc: 'Lisez le chapitre douze et répondez aux questions dans votre cahier pour demain matin.',
  },
  {
    lang: 'French', foreign: true,
    title: 'Structure du message',
    desc: 'Une action importante sur la structure du message et la date de la nation possible dans la situation actuelle.',
    note: 'built almost entirely of English cognates — the case an English wordlist fails',
  },
  {
    lang: 'Arabic', foreign: true,
    title: 'اقرأ الفصل الخامس',
    desc: 'اقرأ الفصل الخامس وأجب عن أسئلة الفهم في نهاية الفصل. سيتم جمع الدفاتر في بداية الحصة.',
  },

  // ---- Other scripts -----------------------------------------------------------
  {
    lang: 'Russian', foreign: true,
    title: 'Прочитайте главу 5',
    desc: 'Прочитайте пятую главу и ответьте на вопросы в конце главы. Тетради будут собраны в начале урока.',
  },
  {
    lang: 'Chinese', foreign: true,
    title: '阅读第五章',
    desc: '阅读第五章并回答章节末尾的问题。请在上课开始时交作业本。',
  },
  {
    lang: 'Japanese', foreign: true,
    title: '第7章を読む',
    desc: '第七章を読んで、章末の質問に答えてください。ノートは授業の初めに集めます。',
  },

  // ---- Latin-script languages with no accents in the sample --------------------
  {
    lang: 'German', foreign: true,
    title: 'Kapitel 12 lesen',
    desc: 'Lest das Kapitel zwolf und schreibt eine kurze Zusammenfassung von der Handlung fur die nachste Stunde.',
  },
  {
    lang: 'Italian', foreign: true,
    title: 'Leggere il capitolo 12',
    desc: 'Leggete il capitolo dodici e rispondete alle domande che sono nel libro alla fine della sezione.',
  },
  {
    lang: 'Portuguese', foreign: true,
    title: 'Ler o capitulo 12',
    desc: 'Leia o capitulo doze e responda as questoes que estao no livro para a aula de amanha de manha.',
  },
  {
    lang: 'Dutch', foreign: true,
    title: 'Hoofdstuk 12 lezen',
    desc: 'Lees het hoofdstuk twaalf en beantwoord de vragen voor de les van morgen in je schrift.',
  },
  {
    lang: 'Vietnamese', foreign: true,
    title: 'Doc chuong 12',
    desc: 'Doc chuong muoi hai va tra loi cac cau hoi o cuoi chuong truoc buoi hoc ngay mai nhe.',
    note: 'the case that proved plausible() must NOT be used as the skip test',
  },
  {
    lang: 'Indonesian', foreign: true,
    title: 'Baca bab 12',
    desc: 'Bacalah bab dua belas untuk besok dengan teliti adalah tugas yang penting bagi semua siswa.',
  },
  {
    lang: 'Swahili', foreign: true,
    title: 'Soma sura ya 12',
    desc: 'Soma sura ya kumi na mbili kwa ajili ya kesho na ujibu maswali yaliyo katika kitabu hiki.',
  },
];

// ---------------------------------------------------------------------------
const pad = (s: string, n: number): string => (s.length > n ? s.slice(0, n - 1) + '…' : s.padEnd(n));
const padL = (s: string, n: number): string => s.padStart(n);
const money = (chars: number): string => `$${(chars * RATE_PER_CHAR).toFixed(4)}`;

/** What ONE text costs upstream, in billed characters.
 *
 *  A pass is a translate() over the text. English text is stable on the first pass
 *  and stops; foreign text changes on pass 0 and is confirmed stable on pass 1, so
 *  it costs two. Each pass also carries the standalone detect() over the same
 *  characters, when detection is what we are paying for. */
function billed(chars: number, foreign: boolean): number {
  const passes = foreign ? 2 : 1;
  return chars * passes * (DETECT_BILLED ? 2 : 1);
}

function main(): void {
  setPrefsCache({ ...getPrefs(), tasks: { ...getPrefs().tasks, translateFrom: LANGS } });

  console.log(
    `\n  ${pad('LANGUAGE', 12)}${pad('FIELD', 6)}${padL('CHARS', 6)}  ${pad('VERDICT', 18)}SAMPLE`
  );
  console.log(`  ${'-'.repeat(96)}`);

  let beforeChars = 0;
  let afterChars = 0;
  let wrongSkips = 0;

  for (const s of CORPUS) {
    for (const [field, text] of [['title', s.title], ['desc', s.desc]] as const) {
      const v = localVerdict(text);
      const b = billed(text.length, s.foreign);
      beforeChars += b;
      if (!v.skip) afterChars += b;
      // The only failure that matters: foreign text that would never be sent.
      if (v.skip && s.foreign) wrongSkips++;
      const verdict = v.skip ? `skip (${v.why})` : 'SEND';
      console.log(
        `  ${pad(s.lang, 12)}${pad(field, 6)}${padL(String(text.length), 6)}  ${pad(verdict, 18)}${text.slice(0, 40)}`
      );
    }
    if (s.note) console.log(`  ${' '.repeat(24)}  ↑ ${s.note}`);
  }

  // --- The corpus totals -----------------------------------------------------
  console.log(`\n  ${'-'.repeat(96)}`);
  // NOT A PROJECTION. This corpus is 16 foreign out of 21 because it was built to
  // stress the detector, not to look like anyone's Schoology. Its reduction figure is
  // therefore a FLOOR — what the gate saves when three quarters of the work really is
  // in another language. The realistic mix is in the table below.
  const enChars = CORPUS.filter((s) => !s.foreign).reduce((n, s) => n + s.title.length + s.desc.length, 0);
  const enSent = CORPUS.filter((s) => !s.foreign).reduce(
    (n, s) => n + (['title', 'desc'] as const).reduce((m, f) => m + (localVerdict(s[f]).skip ? 0 : s[f].length), 0),
    0
  );
  console.log(
    `  STRESS CORPUS — ${CORPUS.length} assignments, ${CORPUS.filter((s) => s.foreign).length} of them foreign` +
      ` (deliberately not a realistic mix)\n` +
      `    billed characters before : ${beforeChars.toLocaleString()}   ${money(beforeChars)}\n` +
      `    billed characters after  : ${afterChars.toLocaleString()}   ${money(afterChars)}\n` +
      `    reduction                : ${Math.round((1 - afterChars / beforeChars) * 100)}%` +
      `  ← floor, because this corpus is mostly foreign\n` +
      `    of the ENGLISH text alone : ${enSent}/${enChars} characters sent` +
      ` (${Math.round((1 - enSent / enChars) * 100)}% of English never leaves the browser)`
  );
  console.log(
    wrongSkips
      ? `\n  ${wrongSkips} FOREIGN TEXT(S) WOULD BE SKIPPED — that is a lost translation.\n`
      : '\n  No foreign text is skipped.\n'
  );

  // --- Scaled to a real account ----------------------------------------------
  // Per-assignment averages measured from the corpus above, split by whether the
  // assignment is foreign, so the projection uses this corpus's real lengths rather
  // than a round number invented for the table.
  const avg = (list: Sample[], f: (s: Sample) => number): number =>
    list.length ? list.reduce((n, s) => n + f(s), 0) / list.length : 0;
  const enSamples = CORPUS.filter((s) => !s.foreign);
  const frSamples = CORPUS.filter((s) => s.foreign);

  const perAssignment = (samples: Sample[], foreign: boolean, gated: boolean): number =>
    avg(samples, (s) =>
      (['title', 'desc'] as const).reduce((n, field) => {
        const text = s[field];
        const b = billed(text.length, foreign);
        return n + (gated && localVerdict(text).skip ? 0 : b);
      }, 0)
    );

  const enBefore = perAssignment(enSamples, false, false);
  const enAfter = perAssignment(enSamples, false, true);
  const frBefore = perAssignment(frSamples, true, false);
  const frAfter = perAssignment(frSamples, true, true);

  // 90/10 is the realistic mix for an American school: a student takes one or two
  // language classes out of seven or eight. The corpus above is deliberately NOT
  // that mix — it is 16 foreign out of 21, chosen to stress the detector — so the
  // projection uses this share rather than the corpus's own proportions.
  const FOREIGN_SHARE = 0.1;
  const mix = (en: number, fr: number): number => (1 - FOREIGN_SHARE) * en + FOREIGN_SHARE * fr;
  const perTaskBefore = mix(enBefore, frBefore);
  const perTaskAfter = mix(enAfter, frAfter);

  /** imports = how many times an assignment is read by somebody; unique = how many
   *  DISTINCT assignment texts exist across them. The gap between those two numbers
   *  is exactly what the shared cache is worth, and it widens with every student. */
  const scenarios: Array<[string, number, number]> = [
    ['You, first import (100 tasks)', 100, 100],
    ['One Ivrit class of 30', 30 * 100, 100],
    ['200 students, ~40 sections', 200 * 100, 40 * 100],
    ['1,000 students, ~120 sections', 1000 * 100, 120 * 100],
  ];

  console.log(
    `  ${pad('SCENARIO', 32)}${padL('TODAY', 12)}${padL('GATE', 12)}${padL('GATE+CACHE', 12)}${padL('vs FREE TIER', 14)}`
  );
  console.log(`  ${'-'.repeat(82)}`);

  for (const [label, imports, unique] of scenarios) {
    const today = imports * perTaskBefore;
    const gate = imports * perTaskAfter;
    // Only DISTINCT text reaches Google once the cache is in: the thirtieth student
    // to import an assignment is answered from what the first one already paid for.
    const cached = unique * perTaskAfter;
    const overFree = cached - FREE_TIER_CHARS;
    console.log(
      `  ${pad(label, 32)}${padL(money(today), 12)}${padL(money(gate), 12)}${padL(money(cached), 12)}` +
        `${padL(overFree > 0 ? `${money(overFree)} over` : 'FREE', 14)}`
    );
  }

  console.log(
    `\n  TODAY      every text sent, every time, by every student.` +
      `\n  GATE       English never leaves the browser (util/localDetect.ts).` +
      `\n  GATE+CACHE distinct assignment text is translated once for everyone.` +
      `\n\n  Free tier is ${FREE_TIER_CHARS.toLocaleString()} characters a month, so anything in the` +
      ` GATE+CACHE column\n  under ${money(FREE_TIER_CHARS)} of usage costs nothing at all.` +
      `\n  Detection modelled as ${DETECT_BILLED ? 'BILLED' : 'FREE'} (see the header); foreign share ${Math.round(
        FOREIGN_SHARE * 100
      )}%.\n`
  );
}

main();
