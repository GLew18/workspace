// Cobalt: focus music catalog generator.
//
//   node scripts/build-music-catalog.mjs
//
// Scans the five genre folders in "<repo>/Music Database" and regenerates
// src/focus/library.ts (the typed track catalog the app imports).
//
// TWO filename schemas are understood:
//
//  • FINAL   "NN - Title - Author(s) - License.mp3" — the verified, curated
//            deliverable (NN encodes the anti-repetition play order; License is
//            one of CC0 / CC-BY 1.0 / 2.5 / 3.0 / 4.0). Parsed exactly; the
//            catalog is stamped LIBRARY_MODE = 'final'.
//  • RAW     anything else — the original source files. Titles/composers are
//            cleaned up heuristically, play order is alphabetical, and the
//            license is 'Pending' (NEVER guessed — CC-BY compliance is a launch
//            blocker, so unverified files ship with an explicit pending flag).
//            The catalog is stamped LIBRARY_MODE = 'provisional'.
//
// When the FINAL zips arrive: extract them over the genre folders (replacing the
// raw files) and re-run this script — the app upgrades automatically.

import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const here = path.dirname(fileURLToPath(import.meta.url));
const MUSIC_ROOT = path.resolve(here, '..', '..', 'Music Database');
const OUT = path.resolve(here, '..', 'src', 'focus', 'library.ts');

const GENRES = [
  { dir: 'Genre 1 - Classical Piano', id: 'classical-piano', label: 'Classical Piano', emoji: '🎹' },
  { dir: 'Genre 2 - Solo Bach', id: 'solo-bach', label: 'Solo Bach', emoji: '🎻' },
  { dir: 'Genre 3 - Baroque', id: 'baroque', label: 'Baroque', emoji: '🎼' },
  { dir: 'Genre 4 - Impressionist Piano', id: 'impressionist-piano', label: 'Impressionist Piano', emoji: '🌙' },
  { dir: 'Genre 5 - Romantic Piano', id: 'romantic-piano', label: 'Romantic Piano', emoji: '🌹' },
  { dir: 'Genre 6 - Orchestral', id: 'orchestral', label: 'Orchestral', emoji: '🎺' },
  { dir: 'Genre 7 - Ambient', id: 'ambient', label: 'Ambient', emoji: '🌌' },
];

// Personal first+last artist names shrink to the surname in the PLAYER UI so the
// ambient artists read like the composers ("Buckley" next to "Bach"). Brand and
// mononym artists (Alex-Productions, Tokyo Music Walker, Sakura Girl, Meydän)
// keep their full name — they have no surname to shrink to. DISPLAY ONLY: the
// credits page and CREDITS.md always use the full `authors` (CC-BY attribution
// must name the creator properly).
const SHORT_ARTIST = {
  'Scott Buckley': 'Buckley',
  'Kevin MacLeod': 'MacLeod',
  'Alexander Nakarada': 'Nakarada',
};

const LICENSE_URLS = {
  CC0: 'https://creativecommons.org/publicdomain/zero/1.0/',
  'CC-BY 1.0': 'https://creativecommons.org/licenses/by/1.0/',
  'CC-BY 2.5': 'https://creativecommons.org/licenses/by/2.5/',
  'CC-BY 3.0': 'https://creativecommons.org/licenses/by/3.0/',
  'CC-BY 4.0': 'https://creativecommons.org/licenses/by/4.0/',
};

const AUDIO_EXT = /\.(mp3|ogg|oga|opus|wav|m4a|flac)$/i;

// ---------------------------------------------------------------------------
// Loudness normalization. loudness.json (from measure-loudness.ps1) maps
// "<Genre folder>/<file>" → { i: integrated LUFS, tp: true peak }. Each track
// gets a gain (dB) that brings it to a shared target = mean + 4 dB (slightly
// louder than the library's current mean), clamped so quiet tracks aren't blown
// up. The player applies this gain per-track; a limiter catches any peaks.
const LOUDNESS = (() => {
  try {
    // Strip a UTF-8 BOM (Windows PowerShell Out-File adds one) before parsing.
    return JSON.parse(fs.readFileSync(path.resolve(here, 'loudness.json'), 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
})();
const LUFS_VALS = Object.values(LOUDNESS)
  .map((v) => (v && typeof v.i === 'number' ? v.i : null))
  .filter((v) => v !== null);
const MEAN_LUFS = LUFS_VALS.length ? LUFS_VALS.reduce((a, b) => a + b, 0) / LUFS_VALS.length : -18;
// This is a FOCUS/STUDY soundtrack — background music, meant to sit UNDER thought,
// not compete with it. So the shared loudness target is deliberately low: -26 LUFS,
// well below streaming/broadcast levels (~-14 to -23), and ~8 dB quieter than the
// old MEAN+4 (≈ -18) that made the punchier orchestral tracks blast. Every track is
// normalized to this one level, so nothing jumps out as "way too loud". (MEAN_LUFS
// is kept for reference / a possible relative mode.)
void MEAN_LUFS;
// -24 (was -26): "make all tracks slightly louder" — a uniform +2 dB across the
// library, still well under streaming loudness (~-14), so it stays background.
const TARGET_LUFS = -24;
const MAX_BOOST = 18; // cap on boosting very quiet outliers (keeps them near target
// without so much gain that the limiter squashes their peaks)
const MAX_CUT = 24;
function gainDbFor(key) {
  const m = LOUDNESS[key];
  if (!m || typeof m.i !== 'number') return 0; // unmeasured → no change
  const g = Math.max(-MAX_CUT, Math.min(MAX_BOOST, TARGET_LUFS - m.i));
  return Math.round(g * 100) / 100;
}

// ---------------------------------------------------------------------------
// Track lengths. durations.json (from ffprobe, see the measure step) maps
// "<Genre folder>/<file>" → seconds. Baked into the catalog so the UI can show
// each playlist's total run time without loading a single audio file.
const DURATIONS = (() => {
  try {
    return JSON.parse(fs.readFileSync(path.resolve(here, 'durations.json'), 'utf8').replace(/^﻿/, ''));
  } catch {
    return {};
  }
})();
function durationFor(key) {
  const s = DURATIONS[key];
  return typeof s === 'number' && s > 0 ? Math.round(s) : 0; // unmeasured → 0 (UI omits it)
}

// ---------------------------------------------------------------------------
// FINAL schema parser — "NN - Title - Author(s) - License.ext"
// The ` - ` delimiter separates fields; internal commas/parens belong to the
// title. Split license from the RIGHT and index from the LEFT (titles may
// themselves contain " - ").
function parseFinal(base) {
  const m = base.match(/^(\d{2}) - (.+)$/);
  if (!m) return null;
  const parts = m[2].split(' - ');
  if (parts.length < 3) return null;
  const license = parts[parts.length - 1].trim();
  if (!(license in LICENSE_URLS)) return null;
  const authors = parts[parts.length - 2].split(',').map((s) => s.trim()).filter(Boolean);
  const title = parts.slice(0, parts.length - 2).join(' - ').trim();
  if (!title || !authors.length) return null;
  return { index: Number(m[1]), title, authors, license };
}

// ---------------------------------------------------------------------------
// RAW heuristics — best-effort title/composer cleanup for the source files.
const COMPOSERS = [
  ['Johann Sebastian Bach', 'Bach'], ['J.S.Bach', 'Bach'], ['J. S. Bach', 'Bach'], ['Bach', 'Bach'],
  ['Beethoven', 'Beethoven'], ['Ludwig Van Beethoven', 'Beethoven'],
  ['Frederic Chopin', 'Chopin'], ['Chopin', 'Chopin'],
  ['Mozart', 'Mozart'], ['Claude Debussy', 'Debussy'], ['Debussy', 'Debussy'],
  ['Maurice Ravel', 'Ravel'], ['Ravel', 'Ravel'], ['Erik Satie', 'Satie'], ['Satie', 'Satie'],
  ['Mendelssohn', 'Mendelssohn'], ['Franz Schubert', 'Schubert'], ['Schubert', 'Schubert'],
  ['Edvard-Grieg', 'Grieg'], ['Grieg', 'Grieg'],
  ['Johann Pachelbel', 'Pachelbel'], ['Pachelbel', 'Pachelbel'],
  ['Handel', 'Handel'], ['Domenico Scarlatti', 'Scarlatti'], ['Scarlatti', 'Scarlatti'],
  ['François Couperin', 'Couperin'], ['Couperin', 'Couperin'],
  ['Purcell', 'Purcell'], ['Vivaldi', 'Vivaldi'], ['Vincent Lübeck', 'Lübeck'], ['Lübeck', 'Lübeck'],
  ['Gymnopedie', 'Satie'], ['Gymnopédie', 'Satie'], // Satie pieces named without him
  ['Mazurka', 'Chopin'], // the IMSLP mazurka scans
];

function detectAuthors(s) {
  if (/Bach-Siloti|arranged Siloti/i.test(s)) return ['Bach', 'Siloti'];
  if (/Vivaldi/i.test(s) && /Bach|BWV/i.test(s)) return ['Vivaldi', 'Bach'];
  for (const [needle, canonical] of COMPOSERS) {
    if (s.toLowerCase().includes(needle.toLowerCase())) return [canonical];
  }
  return [];
}

// Known performers whose names prefix raw files ("<Performer> - <piece>").
const PERFORMER_PREFIXES = [
  'Kevin MacLeod', 'Brendan Kinsella', 'Karine Gilanyan', 'Kimiko Ishizaka',
  'FAE Piano cafe', 'Kostas Papastergiou', 'Paul De Bra', 'ROSA Pianist',
  'Ruei-Hwa Shyu', 'Takashi Sato',
];

function cleanRawName(base) {
  let s = base;
  s = s.replace(/_/g, ' ');
  s = s.replace(/IMSLP\d+-PMLP\d+-/g, '');
  s = s.replace(/\(ISRC[^)]*\)/gi, '');
  s = s.replace(/\bISRC\s*\S+/gi, '');
  s = s.replace(/\b\d{2}-\d{2}-\d{4}\b/g, ''); // recording dates
  s = s.replace(/\s{2,}/g, ' ').replace(/\s+([,.])/g, '$1').trim();
  s = s.replace(/^[\s\-–—]+|[\s\-–—]+$/g, '');
  return s;
}

function parseRaw(base) {
  let s = cleanRawName(base);
  let performer = '';
  for (const p of PERFORMER_PREFIXES) {
    if (s.toLowerCase().startsWith(p.toLowerCase() + ' - ')) {
      performer = p;
      s = s.slice(p.length + 3);
      break;
    }
  }
  const authors = detectAuthors(s + ' ' + base);
  // Drop a leading composer name from the title ("Chopin - Nocturne…" → "Nocturne…").
  let title = s;
  for (const [needle] of COMPOSERS) {
    const rx = new RegExp('^' + needle.replace(/[.*+?^${}()|[\]\\]/g, '\\$&') + "[’']?s?\\s*[-–—,:]\\s*", 'i');
    if (rx.test(title)) { title = title.replace(rx, ''); break; }
  }
  title = title.trim() || s;
  title = title[0].toUpperCase() + title.slice(1);
  return { title, authors, performer };
}

// ---------------------------------------------------------------------------
// Per-track emoji, from the piece's character (see the import brief). First
// match wins; genre default as fallback. Aim: variety, not 30 identical rows.
const EMOJI_RULES = [
  [/dulcimer/i, '✨'],
  [/cathedrale|engloutie/i, '🌊'],
  [/clair de lune/i, '🌙'],
  [/jeux d'?eau/i, '⛲'],
  [/golliwog|cake ?walk/i, '🎪'],
  [/troldhaugen|wedding/i, '💍'],
  [/gymnop[eé]die/i, '🕯️'],
  [/canon/i, '🔁'],
  [/mazurka/i, '💃'],
  [/nocturne/i, '🌙'],
  [/waltz|valse/i, '💫'],
  [/fur ?elise|für ?elise|furelise/i, '🌼'],
  [/pathetique|pathétique/i, '🌩️'],
  [/hammerklavier/i, '🔨'],
  [/pastoral/i, '🌿'],
  [/spring song/i, '🌸'],
  [/songs without words/i, '🕊️'],
  [/impromptu/i, '✨'],
  [/blacksmith/i, '⚒️'],
  [/gavotte|rondeau/i, '🕺'],
  [/ricercare/i, '🔍'],
  [/magnificat|organ|silbermann/i, '⛪'],
  [/cello/i, '🎻'],
  [/violin|partita/i, '🎻'],
  [/harpsichord|clavecin|clavier/i, '🎼'],
  [/trio/i, '🎻'],
  [/fugue/i, '🌀'],
  [/sonata/i, '🎹'],
  [/suite/i, '📜'],
  [/prelude|prélude/i, '🌅'],
];

function pickEmoji(_title, _base, genreEmoji) {
  // Per Gabe: every song shows its GENRE's emoji — no per-piece emoji, so a genre
  // reads as one consistent set (all Classical Piano 🎹, all Orchestral 🎺, etc.).
  // The character-based EMOJI_RULES above are kept but intentionally UNUSED, so
  // per-song emojis can be restored by re-enabling the lookup here.
  return genreEmoji;
}

// ---------------------------------------------------------------------------
const q = JSON.stringify;
let finalCount = 0;
let rawCount = 0;
const genreBlocks = [];

for (const g of GENRES) {
  const dir = path.join(MUSIC_ROOT, g.dir);
  if (!fs.existsSync(dir)) {
    console.warn(`!! missing genre folder: ${dir}`);
    continue;
  }
  const files = fs.readdirSync(dir).filter((f) => AUDIO_EXT.test(f)).sort((a, b) => a.localeCompare(b, 'en'));
  const rows = [];
  files.forEach((file, i) => {
    const base = file.replace(AUDIO_EXT, '');
    const fin = parseFinal(base);
    let index, title, authors, performer, license;
    if (fin) {
      ({ index, title, authors, license } = fin);
      performer = '';
      finalCount++;
    } else {
      index = i + 1; // provisional: alphabetical position
      ({ title, authors, performer } = parseRaw(base));
      license = 'Pending';
      rawCount++;
    }
    rows.push({
      id: `${g.id}-${String(index).padStart(2, '0')}`,
      genreId: g.id,
      index,
      title,
      authors,
      authorsShort: authors.map((a) => SHORT_ARTIST[a] ?? a),
      performer,
      license,
      licenseUrl: LICENSE_URLS[license] ?? '',
      src: `/music-lib/${encodeURIComponent(g.dir)}/${encodeURIComponent(file)}`,
      emoji: pickEmoji(title, base, g.emoji),
      gainDb: gainDbFor(`${g.dir}/${file}`),
      duration: durationFor(`${g.dir}/${file}`),
    });
  });
  rows.sort((a, b) => a.index - b.index); // FINAL: the curated NN order
  genreBlocks.push({ genre: g, rows });
}

const mode = rawCount === 0 && finalCount > 0 ? 'final' : 'provisional';

let out = '';
out += `// Cobalt: focus music library catalog. GENERATED FILE, do not edit.\n`;
out += `// Regenerate with:  node scripts/build-music-catalog.mjs\n`;
out += `// Source of truth: the five genre folders in "<repo>/Music Database".\n`;
out += `//\n`;
if (mode === 'provisional') {
  out += `// ⚠ PROVISIONAL catalog: generated from the RAW source files (the verified\n`;
  out += `// "NN - Title - Author - License.mp3" FINAL set was not present). Play order\n`;
  out += `// is alphabetical, titles/composers are heuristic, and every license is\n`;
  out += `// 'Pending' — the app surfaces that honestly. Re-run the generator once the\n`;
  out += `// FINAL files are in place and all of this upgrades automatically.\n`;
} else {
  out += `// FINAL catalog: parsed from the verified curated filenames (NN play order,\n`;
  out += `// per-track licenses). \n`;
}
out += `\n`;
out += `export type LibraryMode = 'provisional' | 'final';\n`;
out += `export const LIBRARY_MODE: LibraryMode = ${q(mode)};\n\n`;
out += `export interface MusicGenre {\n  id: string;\n  label: string;\n  emoji: string;\n}\n\n`;
out += `export interface LibraryTrack {\n`;
out += `  id: string; // stable within a catalog generation: <genreId>-<NN>\n`;
out += `  genreId: string;\n`;
out += `  index: number; // curated play order within the genre (provisional: alphabetical)\n`;
out += `  title: string;\n`;
out += `  authors: string[]; // composer(s) / arranger(s) — FULL names; the credits page uses these\n`;
out += `  authorsShort: string[]; // player-UI display names (surname-only for ambient artists)\n`;
out += `  performer: string; // from the attributions data ('' until reconciled)\n`;
out += `  license: string; // 'CC0' | 'CC-BY x.y' | 'Pending' (never guessed)\n`;
out += `  licenseUrl: string; // CC deed link ('' while Pending)\n`;
out += `  src: string; // served by the dev music middleware (vite.config.ts)\n`;
out += `  emoji: string;\n`;
out += `  gainDb: number; // per-track loudness-normalization gain (dB), applied at playback\n`;
out += `  duration: number; // track length in seconds (0 if unmeasured)\n`;
out += `}\n\n`;
out += `export const MUSIC_GENRES: MusicGenre[] = [\n`;
for (const { genre } of genreBlocks) {
  out += `  { id: ${q(genre.id)}, label: ${q(genre.label)}, emoji: ${q(genre.emoji)} },\n`;
}
out += `];\n\n`;
out += `export const LIBRARY_TRACKS: LibraryTrack[] = [\n`;
for (const { genre, rows } of genreBlocks) {
  out += `  // ===== ${genre.label} (${rows.length}) =====\n`;
  for (const r of rows) {
    out += `  { id: ${q(r.id)}, genreId: ${q(r.genreId)}, index: ${r.index}, title: ${q(r.title)}, authors: ${q(r.authors)}, authorsShort: ${q(r.authorsShort)}, performer: ${q(r.performer)}, license: ${q(r.license)}, licenseUrl: ${q(r.licenseUrl)}, src: ${q(r.src)}, emoji: ${q(r.emoji)}, gainDb: ${r.gainDb}, duration: ${r.duration} },\n`;
  }
}
out += `];\n\n`;
out += `/** A genre's tracks in curated play order. */\n`;
out += `export function tracksForGenre(genreId: string): LibraryTrack[] {\n`;
out += `  return LIBRARY_TRACKS.filter((t) => t.genreId === genreId);\n`;
out += `}\n\n`;
out += `/** Find a library track by its stable id. */\n`;
out += `export function libraryTrack(id: string): LibraryTrack | undefined {\n`;
out += `  return LIBRARY_TRACKS.find((t) => t.id === id);\n`;
out += `}\n`;

fs.writeFileSync(OUT, out, 'utf8');
const total = finalCount + rawCount;
console.log(`catalog: ${total} tracks (${finalCount} final, ${rawCount} provisional) → ${path.relative(process.cwd(), OUT)}`);
console.log(`mode: ${mode.toUpperCase()}`);
for (const { genre, rows } of genreBlocks) console.log(`  ${genre.label}: ${rows.length}`);
