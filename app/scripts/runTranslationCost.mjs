// Bundles scripts/translationCost.ts with the project's own vite and runs it in node.
//
// WHY A BUNDLE STEP. The module under test imports the real prefs and language
// tables using extensionless paths, which node's own TypeScript stripping cannot
// resolve. Bundling with vite means the checker exercises the SHIPPING module
// exactly as the app does, rather than a hand-copied version of it that would drift
// away from the real one the first time either changed.
//
//   node scripts/runTranslationCost.mjs

import { build } from 'vite';
import { rm } from 'node:fs/promises';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';

const here = dirname(fileURLToPath(import.meta.url));
const app = resolve(here, '..');
const outDir = resolve(app, '.check-tmp');


await build({
  root: app,
  logLevel: 'error',
  build: {
    outDir,
    emptyOutDir: true,
    ssr: true,
    target: 'node20',
    rollupOptions: {
      input: resolve(app, 'scripts/translationCost.ts'),
      output: { entryFileNames: 'translationCost.mjs', format: 'es' },
    },
  },
});

await import(resolve(outDir, 'translationCost.mjs'));
await rm(outDir, { recursive: true, force: true });
