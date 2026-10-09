// Builds a lab page (labs/<entry>.ts) into ONE self-contained HTML file for
// publishing as an Artifact: JS and CSS inlined, nothing fetched except the
// Inter font from Google Fonts.
//
// Run from app/:  node scripts/build-lab.mjs <checkoff|badges>
// Then republish labs/out/<file> to the SAME artifact URL below so the link
// Gabe has keeps working (Artifact tool, publish with `url`).

import { build } from 'esbuild';
import { mkdirSync, writeFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const LABS = {
  checkoff: {
    entry: 'checkoffLab.ts',
    out: 'checkoff-lab.html',
    title: 'Checkoff Animations',
    artifact: 'https://claude.ai/artifact/6DydxgDdGWDRPk8PFN7ry9',
  },
  badges: {
    entry: 'badgeLab.ts',
    out: 'badge-lab.html',
    title: 'Cobalt Badges',
    artifact: 'https://claude.ai/artifact/KMabNsG2Rf7k8ExbpWrE8s',
  },
  onboarding: {
    entry: 'onbPreview.ts',
    out: 'onboarding-preview.html',
    title: 'Onboarding Preview',
    artifact: 'https://claude.ai/artifact/6QqDgqmBzCPHfDHmgN4tiA',
  },
};

const lab = LABS[process.argv[2]];
if (!lab) {
  console.error(`usage: node scripts/build-lab.mjs <${Object.keys(LABS).join('|')}>`);
  process.exit(1);
}

const app = join(dirname(fileURLToPath(import.meta.url)), '..');
const outDir = join(app, 'labs', 'out');
mkdirSync(outDir, { recursive: true });

const res = await build({
  entryPoints: [join(app, 'labs', lab.entry)],
  bundle: true,
  minify: true,
  format: 'iife',
  target: 'es2020',
  write: false,
  outdir: outDir,
  logLevel: 'warning',
  // The onboarding preview pulls in real app modules: the icon inlines, and Vite's
  // env object is empty, which the app reads as "no Firebase config" (local mode).
  loader: { '.svg': 'dataurl' },
  define: { 'import.meta.env': JSON.stringify({ PROD: true, DEV: false, MODE: 'lab' }) },
});

const js = res.outputFiles.find((f) => f.path.endsWith('.js')).text;
const css = res.outputFiles.find((f) => f.path.endsWith('.css'))?.text ?? '';

// The Artifact host supplies <!doctype>, <html>, <head> and <body>.
const html =
  `<title>${lab.title}</title>\n` +
  `<link rel="stylesheet" href="https://fonts.googleapis.com/css2?family=Inter:wght@400;500;600;700;800&display=swap">\n` +
  `<style>${css.replace(/<\/style/gi, '<\/style')}</style>\n` +
  `<main id="lab"></main>\n` +
  `<script>${js.replace(/<\/script/gi, '<\/script')}</script>\n`;

const out = join(outDir, lab.out);
writeFileSync(out, html);
console.log(`wrote ${out} (${(html.length / 1024).toFixed(1)} KB) -> publish to ${lab.artifact}`);
