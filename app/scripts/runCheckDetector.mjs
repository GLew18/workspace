// Bundles scripts/checkDetector.ts with the project's own vite and runs it in node.
//
// WHY A BUNDLE STEP. The module under test imports the real prefs and language
// tables using extensionless paths, which node's own TypeScript stripping cannot
// resolve. Bundling with vite means the checker exercises the SHIPPING module
// exactly as the app does, rather than a hand-copied version of it that would drift
// away from the real one the first time either changed.
//
//   node scripts/runCheckDetector.mjs
//
// Also machine-checks that FOREIGN_FUNCTION and ENGLISH_FUNCTION stay disjoint. Four
// collisions (for, men, over, per) survived a careful manual reading of two ~200-word
// lists, which is exactly why this is not left to a careful manual reading.

import { build } from 'vite';
import { readFile, rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const outDir = resolve(app, '.check-tmp');

/** The disjointness check, read straight out of the source so it cannot be fooled
 *  by a stale build. */
async function checkSetsDisjoint() {
  const src = await readFile(resolve(app, 'src/util/localDetect.ts'), 'utf8');
  const grab = (name) => {
    const m = new RegExp(`${name} = new Set\\(\\[(.*?)\\n\\]\\);`, 's').exec(src);
    if (!m) throw new Error(`could not find ${name} in localDetect.ts`);
    return new Set([...m[1].matchAll(/'([^']+)'/g)].map((x) => x[1]));
  };
  const foreign = grab('FOREIGN_FUNCTION');
  const english = grab('ENGLISH_FUNCTION');
  const both = [...foreign].filter((w) => english.has(w));
  console.log(
    `\n  word sets — foreign: ${foreign.size}  english: ${english.size}  ` +
      (both.length ? `COLLISIONS: ${both.join(', ')}` : 'disjoint ✓')
  );
  return both.length === 0;
}

const disjoint = await checkSetsDisjoint();

await build({
  root: app,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    ssr: true,
    target: 'node20',
    rollupOptions: {
      input: resolve(app, 'scripts/checkDetector.ts'),
      output: { entryFileNames: 'checkDetector.mjs', format: 'es' },
    },
  },
});

await import(resolve(outDir, 'checkDetector.mjs'));
await rm(outDir, { recursive: true, force: true });

if (!disjoint) process.exitCode = 1;
