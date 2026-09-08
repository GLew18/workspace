// Cobalt: link attachments (spec §6.5). URLs only.

import type { Note } from '../types';
import { extensionActive, openUrlsInGroup, openTabs, openLink } from '../bookmarks/shortcuts';

export interface AttachmentType {
  label: string;
  color: string;
}

const TYPES: { test: RegExp; label: string; color: string }[] = [
  { test: /docs\.google\.com\/document|\.docx?$|\.odt$/i, label: 'DOC', color: '#4f8cff' },
  { test: /presentation|slides|\.pptx?$|\.odp$/i, label: 'SLIDE', color: '#f59e0b' },
  { test: /youtube|youtu\.be|vimeo|\.mp4$|\.mov$|\.webm$|\.avi$|\.mkv$/i, label: 'VIDEO', color: '#ef4444' },
  { test: /spreadsheets|sheets|\.xlsx$|\.ods$/i, label: 'SHEETS', color: '#22c55e' },
  { test: /forms|forms\.gle/i, label: 'FORMS', color: '#a855f7' },
  { test: /schoology\.com/i, label: 'SCHOOL', color: '#06b6d4' },
];

export function detectAttachmentType(url: string): AttachmentType {
  for (const t of TYPES) if (t.test.test(url)) return { label: t.label, color: t.color };
  return { label: 'LINK', color: '#9ca3af' };
}

/** Ensure a URL has a scheme. */
export function normalizeUrl(url: string): string {
  const u = url.trim();
  if (!u) return '';
  return /^https?:\/\//i.test(u) ? u : 'https://' + u;
}

const isMobile = () => /iphone|ipad|ipod|android/i.test(navigator.userAgent);

/**
 * Open a single attachment. On mobile, rewrite known hosts to their app deep-link
 * with an anchor-click fallback; on desktop, open a normal tab.
 */
export function openAttachment(rawUrl: string): void {
  const url = normalizeUrl(rawUrl);
  if (!url) return;

  if (isMobile()) {
    let deep = url;
    if (/youtube|youtu\.be/i.test(url)) deep = url.replace(/^https?:\/\//, 'youtube://');
    else if (/schoology\.com/i.test(url)) deep = url.replace(/^https?:\/\//, 'schoology://');
    else deep = url.replace(/^https?:\/\//, 'googlechromes://');
    const a = document.createElement('a');
    a.href = deep;
    a.rel = 'noopener';
    a.click();
    // Fallback to the plain URL shortly after, in case no app handled the scheme.
    setTimeout(() => openLink(url), 400);
    return;
  }

  openLink(url);
}

/** Open the links as plain tabs (the no-extension path). */
// Plain-tab opening now lives in bookmarks/shortcuts.ts openTabs(): it routes
// through the extension when present (chrome.tabs.create has no popup-blocker
// limit, window.open gets ONE popup per click) and toasts about anything the
// blocker ate when it has to fall back.

/**
 * Open every attachment.
 *
 * PREMIUM (needs the companion extension): pass `group` and the links arrive as one
 * named, colored Chrome tab group — the task's title on the chip, its course color
 * on the group — instead of a spray of anonymous tabs. Without the extension it
 * falls back to plain tabs, unchanged.
 *
 * The extension check is the SYNCHRONOUS cached one on purpose: awaiting a fresh
 * detect would spend the click's user-gesture, and the browser would then block the
 * window.open fallback. Cold cache simply means plain tabs this once.
 */
export function openAll(
  notes: Note[],
  group?: { name: string; color: string },
  opts?: { forceWindows?: boolean }
): void {
  const valid = notes.map((n) => normalizeUrl(n.url)).filter(Boolean);
  if (!valid.length) return;
  if (group && extensionActive()) {
    void openUrlsInGroup(group.name, group.color, valid).then((ok) => {
      if (!ok) openTabs(valid, opts); // grouping failed (old Chrome, revoked permission)
    });
    return;
  }
  openTabs(valid, opts);
}

// #region Auto-extract links from a task's title + description ------------------
//
// Schoology teachers paste the reading, the worksheet, the form straight into the
// assignment description, so before this the link was buried in the ⓘ popup: not
// counted, not openable as a group, and (since 8/13) not enough to promote 📎 onto
// the row. Pulling those out turns every such assignment into a real attachment
// with no student effort.
//
// NAMING, in order of preference:
//   1. The words in front of the link ("The reading: <url>" → "The reading").
//      This is what a human would have typed, so it wins whenever it is usable.
//   2. A meaningful last path segment ("/worksheet-3.pdf" → "Worksheet 3").
//   3. A friendly host name ("drive.google.com" → "Google Drive").
// Deliberately NO AI: a colon solves this offline and for free, where a model
// would mean a network call per link on every sync, forever.

/**
 * Links. **Scheme required** (Gabe, 8/13). Schemeless domains were tried and pulled
 * the same day: "study for quiz google.com" turning google.com into an attachment is
 * noise, and any TLD list broad enough to catch real links also swallows "e.g.",
 * "Ch. 7" and "etc.". A typed "https://" is an unambiguous statement of intent.
 * Closers are excluded because they usually belong to the sentence, not the link.
 */
const LINK_RE = /https?:\/\/[^\s<>"'`)\]}]+/gi;

/** Hosts worth a real name instead of a bare domain. */
const FRIENDLY_HOSTS: [RegExp, string][] = [
  [/^docs\.google\./i, 'Google Doc'],
  [/^drive\.google\./i, 'Google Drive'],
  [/^sheets\.google\./i, 'Google Sheet'],
  [/^slides\.google\./i, 'Google Slides'],
  [/^forms\.gle|^docs\.google\.com\/forms/i, 'Google Form'],
  [/^(www\.)?youtube\.|^youtu\.be/i, 'YouTube'],
  [/^(www\.)?quizlet\./i, 'Quizlet'],
  [/^(www\.)?desmos\./i, 'Desmos'],
  [/^(www\.)?khanacademy\./i, 'Khan Academy'],
  [/schoology\./i, 'Schoology'],
  [/^(www\.)?dropbox\./i, 'Dropbox'],
  [/^(www\.)?padlet\./i, 'Padlet'],
];

/** Words that carry no meaning at the START of a name. */
const LEAD_FILLER =
  /^(?:the|a|an|and|or|but|so|then|also|please|pls|kindly|you(?:'| a)?re|you|can|may|must|should|will|need to?|use|using|see|check(?: out)?|find|go to|head to|open|read|watch|visit|click|here(?:'s| is)?|it(?:'s| is)?|this(?: is)?|that(?: is)?|these|those|link(?:s)? to|link|url|at|on|in|from|for|of|to|is|are|be)\s+/i;

/** A name that is ONLY a filler word is not a name. LEAD_FILLER can't catch these:
 *  it requires trailing whitespace, and by this point there is nothing left after. */
const ALL_FILLER =
  /^(?:see|check|find|use|using|read|watch|visit|open|click|go|here|there|link|links|url|at|on|in|from|for|of|to|is|are|be|this|that|these|those|the|a|an|and|or|it|please|submit|complete|do)$/i;

/** Words that carry no meaning at the END of a name, just before the link. */
const TAIL_FILLER =
  /\s+(?:at|here|below|following|link|links|url|is|are|was|were|it|this|that|these|those|to|on|in|from|of|for|and|or|via|see|attached|posted|available)$/i;

/** Turn the text that PRECEDES a link into a name, or '' if there isn't one. */
export function nameFromContext(before: string): string {
  let s = before;

  // Never reach back past an earlier link. That includes a SCHEMELESS domain we
  // deliberately did not attach: in "Notes: example.com/n and slides: <url>" the
  // words for <url> are "slides", not the whole preamble. Anything link-shaped is
  // a boundary even when it is not itself an attachment.
  let cutAt = 0;
  for (const m of s.matchAll(/https?:\/\/\S+|\b[a-z0-9-]+\.[a-z]{2,}(?:\/\S*)?/gi)) {
    cutAt = (m.index ?? 0) + m[0].length;
  }
  if (cutAt) s = s.slice(cutAt);

  // Only the current clause. A sentence end, a newline, a bullet or a dash all
  // start a new thought, and so does a comma-free list separator.
  const cuts = [...s.matchAll(/[.!?]\s+|[\n\r;•·|]|\s[–—-]\s/g)];
  if (cuts.length) {
    const last = cuts[cuts.length - 1];
    s = s.slice((last.index ?? 0) + last[0].length);
  }

  // Drop the connector the link hangs off ("The reading:" / "worksheet -"), plus an
  // opener the sentence never closed ("Submit the form (https://…").
  s = s.replace(/[\s:：=>»\-–—([{]+$/, '');
  // MUST be trimmed before the filler pass: LEAD_FILLER is anchored with ^, so a
  // single leading space (" and the worksheet") would defeat it entirely.
  s = s.trim();
  // Strip filler from both ends, repeatedly ("and the worksheet" → "worksheet").
  for (let i = 0; i < 5; i++) {
    const t = s.replace(TAIL_FILLER, '').replace(LEAD_FILLER, '').trim();
    if (t === s) break;
    s = t;
  }
  s = s.replace(/[\s:：,]+$/, '').replace(/^[\s:："'([{]+/, '').replace(/\s+/g, ' ').trim();

  if (s.length < 3 || ALL_FILLER.test(s)) return '';
  // Keep it to a chip-sized label, cut on a word boundary.
  if (s.length > 44) {
    const cut = s.slice(0, 44);
    const sp = cut.lastIndexOf(' ');
    s = (sp > 16 ? cut.slice(0, sp) : cut).trim();
  }
  // A name that is only digits/punctuation is not a name.
  if (!/[a-z\u0590-\u05ff]/i.test(s)) return '';
  return s.charAt(0).toUpperCase() + s.slice(1);
}

/** Name derived from the URL itself: a meaningful path segment, else the host. */
export function nameFromUrl(url: string): string {
  let host = '';
  let path = '';
  try {
    const u = new URL(normalizeUrl(url));
    host = u.hostname;
    path = u.pathname;
  } catch {
    return 'Link';
  }

  // A descriptive last segment beats the host ("/files/worksheet-3.pdf").
  const segs = path.split('/').filter(Boolean);
  const last = segs[segs.length - 1] ?? '';
  const stem = decodeURIComponent(last)
    .replace(/\.[a-z0-9]{1,5}$/i, '') // extension
    .replace(/[-_+]+/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
  const wordy = /[a-z]{3}/i.test(stem) && stem.length >= 4 && stem.length <= 44;
  // Reject opaque ids: Drive/Docs keys are long and mix cases+digits with no spaces.
  // Opaque keys (Drive file ids, YouTube video ids like "dQw4w9WgXcQ") look "wordy"
  // to the test above but say nothing to a student. A single run of characters
  // carrying a digit is an id, not a phrase; real names keep their separator
  // ("worksheet-3" → "worksheet 3", which has a space and survives).
  const opaque =
    !stem.includes(' ') && (stem.length > 20 || /\d/.test(stem) || /^[a-z0-9_-]{16,}$/i.test(stem));
  // Generic route words say nothing about the content ("/watch", "/view", "/edit").
  const ROUTE = /^(edit|view|index|home|default|d|file|files|document|docs|watch|embed|share|preview|open|download|dl|page|post|item|content|main|new|show)$/i;
  if (wordy && !opaque && !ROUTE.test(stem)) {
    return stem.charAt(0).toUpperCase() + stem.slice(1);
  }

  for (const [re, label] of FRIENDLY_HOSTS) if (re.test(host)) return label;
  const bare = host.replace(/^www\./i, '');
  const first = bare.split('.')[0] ?? bare;
  return first ? first.charAt(0).toUpperCase() + first.slice(1) : 'Link';
}

/** The name for one link: context first, the URL itself as the fallback. */
export function nameForLink(before: string, url: string): string {
  return nameFromContext(before) || nameFromUrl(url);
}

/**
 * Every link in a task's title + description, as ready-to-store Notes.
 *
 * `skipUrls` drops links the task already carries elsewhere — above all its own
 * `schoologyUrl`, so an assignment never attaches a link to itself. Duplicate
 * URLs collapse; duplicate NAMES get numbered ("Worksheet", "Worksheet 2").
 */
export function extractLinks(
  opts: { title?: string; details?: string; skipUrls?: string[] },
  makeId: () => string
): Note[] {
  const skip = new Set((opts.skipUrls ?? []).filter(Boolean).map((u) => normalizeUrl(u).replace(/\/+$/, '')));
  const seen = new Set<string>();
  const usedNames = new Map<string, number>();
  const out: Note[] = [];

  for (const text of [opts.title ?? '', opts.details ?? '']) {
    if (!text) continue;
    // Where the PREVIOUS link in this text ended. The context for a link is only
    // the words since then, so in "reading: <a> and worksheet: <b>" the second
    // link cannot claim the first one's words. (Slicing here rather than hunting
    // for "http" also makes it work for schemeless links like "google.com".)
    let prevEnd = 0;
    for (const m of text.matchAll(LINK_RE)) {
      // Trailing punctuation is the sentence's, not the URL's.
      const raw = m[0].replace(/[.,;:!?)\]}'"»]+$/, '');
      const before = text.slice(prevEnd, m.index ?? 0);
      prevEnd = (m.index ?? 0) + m[0].length;

      const key = normalizeUrl(raw).replace(/\/+$/, '');
      if (!key || skip.has(key) || seen.has(key)) continue;
      seen.add(key);

      let name = nameForLink(before, raw);
      const n = (usedNames.get(name.toLowerCase()) ?? 0) + 1;
      usedNames.set(name.toLowerCase(), n);
      if (n > 1) name = `${name} ${n}`;

      out.push({ id: 'n_' + makeId(), title: name, url: raw });
    }
  }
  return out;
}
// #endregion
