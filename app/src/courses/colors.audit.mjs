// The audit colors.ts is held to (Gabe, 8/22: "create an algorithm for this and
// audit it rigorously"). Run it from the app/ directory:
//
//     node src/courses/colors.audit.mjs
//
// A plain script rather than a test file, because the project has no test runner:
// every check prints its own line and the last line is the verdict.
import { execFileSync } from 'node:child_process';
import path from 'node:path';
import os from 'node:os';
import { fileURLToPath, pathToFileURL } from 'node:url';

// Transpiled by the project's OWN esbuild rather than a regex, so what is audited is
// exactly what ships. A hand-rolled type stripper silently mangled the module the
// first time this ran.
const APP = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '../..');
const OUT = path.join(os.tmpdir(), 'colors.audit.built.mjs');
execFileSync(process.execPath, [
  path.join(APP, 'node_modules/esbuild/bin/esbuild'),
  'src/courses/colors.ts', '--format=esm', '--outfile=' + OUT,
], { cwd: APP, stdio: 'pipe' });
const M = await import(pathToFileURL(OUT).href + '?t=' + Date.now());

const { nextCourseColor, deltaE, parseHex, hslToHex, saturationOf } = M;

let failures = 0;
const fail = (msg) => { failures++; console.log('  FAIL  ' + msg); };
const ok = (msg) => console.log('  ok    ' + msg);

console.log('\n=== 1. the first three are yellow, red, blue ===');
{
  const seq = [];
  for (let i = 0; i < 3; i++) seq.push(nextCourseColor(seq.slice()));
  console.log('  ' + seq.join('  '));
  if (seq[0] !== '#f2c531') fail('1st is not the yellow anchor: ' + seq[0]); else ok('1st = yellow');
  if (seq[1] !== '#ef4444') fail('2nd is not the red anchor: ' + seq[1]); else ok('2nd = red');
  if (seq[2] !== '#4a9eff') fail('3rd is not the blue anchor: ' + seq[2]); else ok('3rd = blue');
}

console.log('\n=== 2. the sequence from empty, and how separation decays ===');
const seq = [];
const minEach = [];
for (let i = 0; i < 40; i++) {
  const c = nextCourseColor(seq.slice());
  // min distance of the NEW colour to everything already there
  let m = Infinity;
  for (const o of seq) m = Math.min(m, deltaE(c, o));
  minEach.push(m);
  seq.push(c);
}
for (let i = 0; i < 40; i++) {
  const d = minEach[i] === Infinity ? '  -' : minEach[i].toFixed(1).padStart(5);
  const bar = '#'.repeat(Math.min(40, Math.round((minEach[i] === Infinity ? 40 : minEach[i]) / 3)));
  console.log(`  ${String(i + 1).padStart(2)}  ${seq[i]}  dE ${d}  ${bar}`);
}

console.log('\n=== 3. invariants ===');
{
  const dupes = seq.filter((c, i) => seq.indexOf(c) !== i);
  if (dupes.length) fail('repeated colours: ' + [...new Set(dupes)].join(', '));
  else ok('40 courses, no colour repeats');

  // every colour parses and is saturated enough to read as a hue
  const bad = seq.filter((c) => { const r = parseHex(c); return !r || saturationOf(r) < 0.12; });
  if (bad.length) fail('unusable / desaturated colours: ' + bad.join(', '));
  else ok('every colour is valid hex and carries a real hue');

  // Decay must be monotonic ACROSS THE SEARCH PHASE. The three anchors are exempt:
  // they are hand-picked for taste, and blue genuinely sits further from
  // {yellow, red} than red did from {yellow}, so separation legitimately rises once
  // at course 3. Past the anchors, any rise would mean the search had left room
  // unused on the previous pick.
  let regressions = 0;
  for (let i = 4; i < minEach.length; i++) {
    if (minEach[i] > minEach[i - 1] + 0.5) regressions++;
  }
  if (regressions) fail(`separation went back UP ${regressions}x in the search phase (leaving room unused)`);
  else ok('past the anchors, separation only ever decreases: earliest courses get the most contrast');

  // the floor: even at 40 courses nothing should be a near-invisible difference
  const worst = Math.min(...minEach.slice(1));
  if (worst < 8) fail(`worst separation at 40 courses is dE ${worst.toFixed(1)} (below "different shade")`);
  else ok(`worst separation at 40 courses is dE ${worst.toFixed(1)}, still a visibly different shade`);

  // pairwise, not just against-previous
  let pairMin = Infinity, pair = '';
  for (let i = 0; i < seq.length; i++)
    for (let j = i + 1; j < seq.length; j++) {
      const d = deltaE(seq[i], seq[j]);
      if (d < pairMin) { pairMin = d; pair = `${seq[i]} vs ${seq[j]}`; }
    }
  if (pairMin < 8) fail(`closest PAIR among 40 is dE ${pairMin.toFixed(1)} (${pair})`);
  else ok(`closest pair among all 40 is dE ${pairMin.toFixed(1)} (${pair})`);
}

console.log('\n=== 4. determinism and order-independence ===');
{
  const a = [];
  for (let i = 0; i < 12; i++) a.push(nextCourseColor(a.slice()));
  const b = [];
  for (let i = 0; i < 12; i++) b.push(nextCourseColor(b.slice()));
  if (a.join() !== b.join()) fail('same input gave a different sequence');
  else ok('deterministic: identical runs give identical palettes');

  // shuffling the EXISTING set must not change the answer
  const base = a.slice(0, 6);
  const straight = nextCourseColor(base);
  const shuffled = nextCourseColor([...base].reverse());
  if (straight !== shuffled) fail(`order of existing colours changed the pick: ${straight} vs ${shuffled}`);
  else ok('answer does not depend on the order of the existing colours');
}

console.log('\n=== 5. it respects colours the student picked by hand ===');
{
  // a student who already has a red should not be handed another red
  const mine = ['#e01b24'];
  const got = nextCourseColor(mine);
  const d = deltaE(got, mine[0]);
  if (d < 40) fail(`gave ${got} next to hand-picked ${mine[0]} (dE ${d.toFixed(1)})`);
  else ok(`hand-picked red ${mine[0]} → next is ${got} (dE ${d.toFixed(1)}), anchor red skipped`);

  // grey/black/white must not count as competition, and must never be produced
  const greys = ['#9ca3af', '#000000', '#ffffff'];
  const g = nextCourseColor(greys);
  if (g !== '#f2c531') fail(`greys blocked the yellow anchor, got ${g}`);
  else ok('grey, black and white do not crowd the wheel: first pick is still yellow');
}

console.log('\n=== 6. junk input cannot break it ===');
{
  const junk = [[], [''], ['not a color'], ['#12', 'rgb(1,2,3)'], [null, undefined, '#f2c531']];
  for (const j of junk) {
    try {
      const r = nextCourseColor(j);
      if (!parseHex(r)) { fail(`input ${JSON.stringify(j)} produced non-colour ${r}`); continue; }
    } catch (e) {
      fail(`input ${JSON.stringify(j)} threw: ${e.message}`);
      continue;
    }
  }
  ok('empty, malformed, null and non-hex inputs all return a valid colour');
}

console.log('\n=== 7. cost ===');
{
  const t0 = Date.now();
  const s = [];
  for (let i = 0; i < 200; i++) s.push(nextCourseColor(s.slice()));
  const ms = Date.now() - t0;
  console.log(`  200 sequential picks in ${ms}ms (${(ms / 200).toFixed(2)}ms each at up to 200 existing)`);
  if (ms > 2000) fail('too slow for a click handler');
  else ok('fast enough to run on every "+ Add course"');
}

console.log('\n' + (failures ? `>>> ${failures} FAILURE(S)` : '>>> ALL CHECKS PASS'));
