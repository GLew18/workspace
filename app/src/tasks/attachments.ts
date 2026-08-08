// WorkSpace — link attachments (spec §6.5). URLs only.

import type { Note } from '../types';
import { extensionActive, openUrlsInGroup, openTabs } from '../bookmarks/shortcuts';

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
    setTimeout(() => window.open(url, '_blank', 'noopener'), 400);
    return;
  }

  window.open(url, '_blank', 'noopener');
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
export function openAll(notes: Note[], group?: { name: string; color: string }): void {
  const valid = notes.map((n) => normalizeUrl(n.url)).filter(Boolean);
  if (!valid.length) return;
  if (group && extensionActive()) {
    void openUrlsInGroup(group.name, group.color, valid).then((ok) => {
      if (!ok) openTabs(valid); // grouping failed (old Chrome, revoked permission)
    });
    return;
  }
  openTabs(valid);
}
