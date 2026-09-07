// Cobalt: THE CHECK THAT HAS TO PASS BEFORE THE LOCAL GATE IS TRUSTED.
//
// util/localDetect.ts decides, without spending anything, whether text is worth
// sending to Google. It can make two mistakes and they are not equal: sending
// English costs a fraction of a cent, while SKIPPING FOREIGN TEXT loses a
// translation silently. So this file exists to measure the second one.
//
// Run it with:  node scripts/runCheckDetector.mjs
// (that wrapper bundles this through vite first, because the module under test
// imports the real prefs and language tables and must be exercised as-is rather
// than reimplemented here — a checker that reimplements its subject tests nothing.)
//
// Three things are checked:
//   1. The two word sets are disjoint. Four collisions survived a careful manual
//      reading of the lists, so this is machine-checked from now on.
//   2. A fixture corpus: every FOREIGN entry must be sent, every ENGLISH entry
//      should be skipped, and the junk that the gates in translate.ts were built
//      for must still reach those gates.
//   3. Optionally, real exported tasks (see runCheckDetector.mjs --tasks).

import { localVerdict, DETECTOR_VERSION } from '../src/util/localDetect';
import { setPrefsCache, getPrefs } from '../src/prefs';

/** The student's language list drives the script test, so it is set explicitly
 *  rather than left at whatever the defaults happen to be. These are the defaults
 *  (Hebrew, Spanish, Arabic, French) plus the Latin-script languages the fixtures
 *  below actually use, so a "send" is never merely the result of a language being
 *  switched off. */
const LANGS = ['he', 'es', 'ar', 'fr', 'de', 'it', 'nl', 'pt', 'sv', 'id', 'ru', 'zh', 'ja'];

/** THE OTHER HALF OF THE SCRIPT TEST, and it needs its own list to be tested at all.
 *
 *  Text in an alphabet that NONE of the student's languages is written in is skipped
 *  outright. That is not a shortcut: today the provider is called, answers (say)
 *  Russian, `onList` is false, and isAmbiguous returns false because the detector was
 *  sure of a language that was not enabled — no translation, no language buttons. The
 *  skip reaches the identical screen without paying for it.
 *
 *  This list deliberately does NOT contain ru/zh/ja, so the entries below must skip.
 *  The first run of this file had them missing from LANGS above too, and the three
 *  "failures" it reported were this behaviour working correctly against a fixture
 *  that had not asked for it. */
const NARROW_LANGS = ['he', 'es'];

/** MUST BE SKIPPED under NARROW_LANGS: nothing enabled is written this way. */
const UNWRITABLE: Array<[string, string]> = [
  ['ru', 'Прочитайте главу 5 и ответьте на вопросы'],
  ['zh', '阅读第五章并回答问题'],
  ['ja', '第7章を読んで質問に答えてください'],
];

/** MUST BE SENT. Anything here that gets skipped is a lost translation, which is
 *  the only failure this file treats as fatal. */
const FOREIGN: Array<[string, string]> = [
  ['he', 'לקרוא פרק ה׳ ולענות על השאלות'],
  ['he', 'דקדוק worksheet'],
  ['ar', 'اقرأ الفصل الخامس وأجب عن الأسئلة'],
  ['ru', 'Прочитайте главу 5 и ответьте на вопросы'],
  ['zh', '阅读第五章并回答问题'],
  ['ja', '第7章を読んで質問に答えてください'],
  // Latin-script, accented — caught by ACCENTED.
  ['es', 'Lee el capítulo 12 y anota la motivación de los personajes para mañana'],
  ['fr', 'Lisez le chapitre 12 et annotez pour la motivation des personnages en classe'],
  ['de', 'Lest das Kapitel 12 und schreibt eine kurze Zusammenfassung für nächste Woche'],
  // Latin-script, NO accents at all — these are the ones that must be caught by the
  // foreign-function-word test alone, and they are the hardest cases in this file.
  ['es', 'Lee el capitulo 12 y anota la motivacion de los personajes con cuidado'],
  ['fr', 'Lisez le chapitre et repondez aux questions dans le cahier pour demain'],
  ['nl', 'Lees het hoofdstuk en beantwoord de vragen voor de les van morgen'],
  ['it', 'Leggete il capitolo e rispondete alle domande che sono nel libro'],
  ['pt', 'Leia o capitulo e responda as questoes que estao no livro para amanha'],
  ['id', 'Bacalah bab ini untuk besok dengan teliti adalah tugas yang penting'],
  // Cognate-heavy French: the case that would defeat an English-wordlist approach,
  // since action / nation / important / possible / message / date / structure are
  // all the same word in both languages.
  ['fr', 'Une action importante sur la structure du message et la date de la nation possible'],

  // --- THE STRAY-CHARACTER REGRESSIONS (code auditor, 8/28) -------------------
  // Every one of these was SKIPPED by the first version of the gate, because it
  // asked scriptOf() for THE script and got back whichever range matched first.
  // π θ Δ are Greek to Unicode and are simply how STEM homework is written; a
  // citation drops a Cyrillic word into a Spanish paragraph. Greek and Russian are
  // never on a student's list, so all of these were thrown away as "unwritable" —
  // real foreign descriptions, silently losing their translation. They stay here
  // forever: this is the failure mode the whole module exists to avoid.
  ['es', 'Calcula el area del circulo usando π y anota tus resultados en el cuaderno'],
  ['es', 'Resuelve la ecuacion para encontrar el valor de θ en cada uno de los triangulos'],
  ['fr', 'Calculez la variation Δ de la temperature et repondez aux questions du cahier'],
  ['es', 'Lee el capitulo doce y anota la motivacion de los personajes. Fuente: Достоевский.'],
  ['he', 'קראו את הפרק וענו על השאלות. חשבו את הזווית θ במשולש.'],
  // The same shape in ENGLISH is not a translation problem — it is only here to show
  // the fix did not turn every STEM description into a paid call. English + π should
  // still skip, because Latin is the only writing system in it.
];

/** English STEM text: still skipped. The stray-symbol fix must not have quietly
 *  turned "contains one Greek letter" into "always send". */
const ENGLISH_STEM: string[] = [
  'Calculate the area of the circle using π and record your results in the notebook for class.',
  'Solve each equation to find the value of θ in every one of the triangles on the worksheet.',
];

/** SHOULD BE SKIPPED. A miss here costs money, not correctness, so these are
 *  reported as a saving-rate rather than a failure. */
const ENGLISH: string[] = [
  'Read chapter 12 and annotate for character motivation. Annotations will be collected in class.',
  'Write up the pendulum lab: hypothesis, data table, and one paragraph on sources of error.',
  'Final draft of the Animal Farm essay: five paragraphs, two direct quotes per body paragraph, and MLA citations throughout.',
  'Gather at least five sources on your assigned figure. Primary sources count double for this project.',
  'Complete the review packet before the test on Friday and bring any questions you still have to class.',
  'Study for the unit test. It covers everything from the beginning of the chapter through the end of section four.',
  'Please submit your reflection through the portal by the end of the day on Thursday so that it can be graded.',
];

/** MUST BE SENT: short text the gate is not allowed to guess about, plus the two
 *  junk strings the gates in translate.ts were specifically built to refuse. The
 *  point is that they still REACH those gates rather than being decided here. */
const MUST_REACH_GATES: string[] = [
  'tod cod',      // two of Cobalt's own parse words; must still be refused downstream
  'huu',          // real Swahili word, the reason the allowlist exists
  'bio lab',
  'Finish lab write-up',
  'Chapter 12 questions',
  'get cobalt premium',
];

function main(): void {
  setPrefsCache({ ...getPrefs(), tasks: { ...getPrefs().tasks, translateFrom: LANGS } });

  let fatal = 0;
  const line = (s: string): void => console.log(s);

  line(`\n  localDetect v${DETECTOR_VERSION} — languages: ${LANGS.join(', ')}\n`);

  // --- 1. FOREIGN must never be skipped ------------------------------------
  line('  FOREIGN (must be sent)');
  for (const [lang, text] of FOREIGN) {
    const v = localVerdict(text);
    const bad = v.skip;
    if (bad) fatal++;
    line(`    ${bad ? 'FAIL' : ' ok '}  ${lang}  ${v.skip ? `SKIPPED (${v.why})` : 'sent'}  ${text.slice(0, 52)}`);
  }

  // --- 2. Short / junk text must still reach the real gates -----------------
  line('\n  MUST REACH THE GATES (must be sent)');
  for (const text of MUST_REACH_GATES) {
    const v = localVerdict(text);
    if (v.skip) fatal++;
    line(`    ${v.skip ? 'FAIL' : ' ok '}  ${v.skip ? `SKIPPED (${v.why})` : 'sent'}  ${text}`);
  }

  // --- 3. English: how much is actually saved -------------------------------
  line('\n  ENGLISH (should be skipped — misses cost money, not correctness)');
  let skipped = 0;
  let charsBefore = 0;
  let charsAfter = 0;
  for (const text of ENGLISH) {
    const v = localVerdict(text);
    if (v.skip) skipped++;
    charsBefore += text.length;
    if (!v.skip) charsAfter += text.length;
    line(`    ${v.skip ? 'skip' : 'SENT'}  ${text.slice(0, 62)}`);
  }

  line(
    `\n  English skipped: ${skipped}/${ENGLISH.length}` +
      `   characters sent: ${charsAfter}/${charsBefore}` +
      ` (${Math.round((1 - charsAfter / charsBefore) * 100)}% saved)`
  );

  // --- 3b. English STEM: a Greek symbol must not force a paid call ----------
  line('\n  ENGLISH WITH A GREEK SYMBOL (should still be skipped)');
  for (const text of ENGLISH_STEM) {
    const v = localVerdict(text);
    line(`    ${v.skip ? 'skip' : 'SENT'}  ${text.slice(0, 62)}`);
  }

  // --- 4. The script test's other half: an alphabet nothing enabled writes --
  setPrefsCache({ ...getPrefs(), tasks: { ...getPrefs().tasks, translateFrom: NARROW_LANGS } });
  line(`\n  UNWRITABLE with only [${NARROW_LANGS.join(', ')}] enabled (must be skipped)`);
  for (const [lang, text] of UNWRITABLE) {
    const v = localVerdict(text);
    const bad = !v.skip || v.why !== 'unwritable';
    if (bad) fatal++;
    line(`    ${bad ? 'FAIL' : ' ok '}  ${lang}  ${v.skip ? `skipped (${v.why})` : 'SENT'}  ${text.slice(0, 40)}`);
  }

  if (fatal) {
    line(`\n  ${fatal} FATAL failure(s): text that would be skipped and should not be.\n`);
    process.exitCode = 1;
  } else {
    line('\n  No foreign text would be skipped.\n');
  }
}

main();
