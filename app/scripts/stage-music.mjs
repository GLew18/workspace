// Cobalt: stage the focus-music MP3s into dist/ for deployment.
//
// WHY THIS EXISTS. The 151 focus tracks (~959 MB) live outside the app in
// "<repo>/Music Database" so Vite never bundles them. In dev a middleware in
// vite.config.ts serves them at /music-lib/…. On the deployed site nothing served
// them at all, so every track URL fell through to the SPA rewrite and the <audio>
// element received the index.html page instead of an MP3 (found live, 9/3/26).
//
// The fix is to ship them as ordinary static files on the same origin. Same-origin
// matters specifically: music.ts sets crossOrigin='anonymous' and feeds the element
// into a Web Audio graph via createMediaElementSource, so a cross-origin host would
// also need correct CORS headers or the graph taints and playback dies.
//
// Run AFTER `vite build`, because the build empties dist/.
//
// The staged folder is marked com.dropbox.ignored on macOS: the repo lives in a
// Dropbox folder, and syncing 959 MB of build output every deploy is not wanted.

import fs from 'node:fs';
import path from 'node:path';
import { execFileSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const appDir = path.resolve(path.dirname(fileURLToPath(import.meta.url)), '..');
const musicRoot = path.resolve(appDir, '..', 'Music Database');
const outRoot = path.join(appDir, 'dist', 'music-lib');

const library = fs.readFileSync(path.join(appDir, 'src', 'focus', 'library.ts'), 'utf8');
const refs = [...library.matchAll(/src:\s*"\/music-lib\/([^"]+)"/g)].map((m) => decodeURIComponent(m[1]));
if (refs.length === 0) throw new Error('stage-music: no /music-lib/ tracks found in library.ts — did the src shape change?');

fs.mkdirSync(outRoot, { recursive: true });
// Keep build output out of Dropbox sync (macOS only; harmless elsewhere).
//
// This is NOT just about the 959 MB. On 9/3/26 Dropbox was syncing dist/ and actively
// fighting the build: it restored the previous build's .map files after vite emptied
// the folder, and left 12 "…conflicted copy…" duplicates behind. All of it shipped to
// the live site. dist/ is regenerable build output and must never sync — mark the whole
// folder, not just the audio.
// BOTH MACHINES (9/3/26). This was macOS-only, which made the first deploy from the
// Windows PC a trap: nothing marked dist/, so Dropbox would sync ~959 MB of staged
// MP3s and fight the build exactly as it did here — restoring the previous build's
// files after vite emptied the folder and leaving "conflicted copy" duplicates that
// then shipped live. Dropbox reads the same marker on Windows, as an NTFS alternate
// data stream rather than an xattr.
for (const dir of [path.join(appDir, 'dist'), outRoot]) {
  try {
    if (process.platform === 'darwin') {
      execFileSync('xattr', ['-w', 'com.dropbox.ignored', '1', dir]);
    } else if (process.platform === 'win32') {
      execFileSync('powershell', [
        '-NoProfile',
        '-Command',
        `Set-Content -LiteralPath ${JSON.stringify(dir)} -Stream com.dropbox.ignored -Value 1`,
      ]);
    }
  } catch {
    /* not fatal — a synced dist/ is slow and messy, never wrong output */
  }
}

let copied = 0, skipped = 0, bytes = 0;
const missing = [];
for (const rel of refs) {
  const from = path.join(musicRoot, rel);
  const to = path.join(outRoot, rel);
  if (!fs.existsSync(from)) { missing.push(rel); continue; }
  const srcStat = fs.statSync(from);
  // Re-copy only when absent or a different size, so repeat deploys stay fast.
  const dstStat = fs.statSync(to, { throwIfNoEntry: false });
  if (dstStat && dstStat.size === srcStat.size) { skipped++; bytes += srcStat.size; continue; }
  fs.mkdirSync(path.dirname(to), { recursive: true });
  fs.copyFileSync(from, to);
  copied++; bytes += srcStat.size;
}

console.log(`stage-music: ${refs.length} referenced, ${copied} copied, ${skipped} already staged, ${(bytes / 1024 / 1024).toFixed(1)} MB total`);
if (missing.length) {
  console.error(`stage-music: ${missing.length} MISSING from "${musicRoot}":`);
  for (const m of missing.slice(0, 10)) console.error('  - ' + m);
  process.exitCode = 1;
}
