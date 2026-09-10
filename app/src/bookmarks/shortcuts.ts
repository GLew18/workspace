// Cobalt: keyboard shortcuts (premium, extension-backed) + in-app fallback.
//
// This module is the SINGLE SOURCE OF TRUTH for everything shortcut-related:
//   • comboFromEvent / normalizeCombo / isTypingTarget / prettyCombo — the combo
//     algebra. comboFromEvent + isTypingTarget + reservedCombos are MIRRORED
//     BYTE-FOR-BYTE in the companion extension's content script; any divergence
//     silently breaks matching, so edit them in lock-step.
//   • classifyCombo — the single gatekeeper (no-modifier → reserved → in-use).
//   • openShortcutModal — the "Select Keys" capture modal (extension-gated by its
//     CALLER in view.ts, which toasts SHORTCUT_NEEDS_EXTENSION_MSG and skips
//     opening this modal at all when the extension is missing, same pattern as
//     OPEN_WINDOW_NEEDS_EXTENSION_MSG — Gabe, 9/8/26).
//   • detectExtension / syncShortcutsToExtension — the bridge to the companion
//     extension (ping/pong + full-replace config sync).
//   • installInAppDispatcher / setRecording — the focused-tab fallback that fires
//     shortcuts while Cobalt is the active tab (and yields to the extension
//     once it is detected, so exactly one tab opens per press).
//
// Transport: prefer chrome.runtime.sendMessage(EXTENSION_ID, …) when chrome and a
// known EXTENSION_ID exist; otherwise fall back to a window.postMessage handshake
// with the extension's bridge content script (dev/localhost + Firefox/Safari).

import { el, enterConfirms, showToast, fadeRemove } from '../util/dom';
import { normalizeUrl } from './url';
import { getPrefs } from '../prefs';

// #region Minimal chrome typings (no @types/chrome in this project)
interface ChromeRuntimeLike {
  sendMessage?: (
    extensionId: string,
    message: unknown,
    callback?: (response: unknown) => void
  ) => void;
  lastError?: { message?: string } | undefined;
}
interface ChromeLike {
  runtime?: ChromeRuntimeLike;
}
function getChrome(): ChromeLike | undefined {
  return (window as unknown as { chrome?: ChromeLike }).chrome;
}
// #endregion

// #region Public types
export interface ShortcutBookmark {
  id: string;
  name: string;
  url: string;
  shortcut?: string;
}
export interface ShortcutEntry {
  id: string;
  combo: string;
  url: string;
  name: string;
}
export interface ShortcutConfig {
  version: 1;
  origin: string;
  updatedAt: number;
  entries: ShortcutEntry[];
}
export interface DetectResult {
  installed: boolean;
  version?: string;
}
export type ComboRejectReason = 'reserved' | 'in-use' | 'no-modifier' | 'invalid';
export interface OpenShortcutModalOptions {
  existingCombos: Set<string>;
  onSaved: (combo: string) => void;
  onCleared?: () => void;
  /** Sample-mode container (the landing previews): the modal mounts here instead
   *  of document.body, so it stays inside the demo "screen". */
  host?: HTMLElement;
}
// #endregion

// #region Constants
export const PROTOCOL_VERSION = 1;
// 600ms used to be the default here, tuned for a warm extension that answers
// almost instantly. It was too tight for the one case that matters most: an
// MV3 service worker Chrome has evicted after ~30s idle (see background.js),
// which has to cold-start before it can answer a PING at all. A press that
// lands right after that eviction genuinely has the extension installed but
// loses the race, so the gate wrongly says "not installed" (Gabe, 9/9/26 bug
// report — his keyboard shortcuts still fired because content.js's OPEN_URL
// is fire-and-forget with no deadline, but the "needs extension" toasts,
// which DO have a deadline, fired anyway). 1500ms gives a cold wake real room
// while staying well under anything a user would call slow.
export const PING_TIMEOUT_MS = 1500;

/** Hardcoded published extension id. Dev override: localStorage 'ws:extId' or a
 *  Vite env var (VITE_WS_EXT_ID). Empty until the extension is published — until
 *  then detection relies on the postMessage ANNOUNCE handshake from bridge.js. */
export const EXTENSION_ID: string = resolveExtensionId();
function resolveExtensionId(): string {
  try {
    const ls = localStorage.getItem('ws:extId');
    if (ls && ls.trim()) return ls.trim();
  } catch {
    /* localStorage may be blocked */
  }
  const env = (import.meta as unknown as { env?: Record<string, string | undefined> }).env;
  const fromEnv = env?.VITE_WS_EXT_ID;
  if (fromEnv && fromEnv.trim()) return fromEnv.trim();
  return '';
}

/** Canonical-form blocklist of browser/OS-reserved combos. MIRRORED BYTE-FOR-BYTE
 *  in the extension, which also refuses these (defense in depth). The
 *  (Ctrl|Meta)+digit tab-jump guard in classifyCombo runs BEFORE this lookup. */
export const reservedCombos: ReadonlySet<string> = new Set<string>([
  'Ctrl+T', 'Ctrl+N', 'Ctrl+W', 'Ctrl+Shift+T', 'Ctrl+Shift+N', 'Ctrl+Shift+W',
  'Ctrl+Tab', 'Ctrl+Shift+Tab', 'Ctrl+PageUp', 'Ctrl+PageDown',
  'Ctrl+1', 'Ctrl+2', 'Ctrl+3', 'Ctrl+4', 'Ctrl+5', 'Ctrl+6', 'Ctrl+7', 'Ctrl+8', 'Ctrl+9', 'Ctrl+0',
  'Ctrl+L', 'Ctrl+K', 'Ctrl+E', 'Ctrl+R', 'Ctrl+Shift+R', 'Ctrl+F', 'Ctrl+G', 'Ctrl+Shift+G',
  'Ctrl+P', 'Ctrl+S', 'Ctrl+D', 'Ctrl+Shift+D', 'Ctrl+O', 'Ctrl+U', 'Ctrl+J', 'Ctrl+H',
  'Ctrl+Shift+B', 'Ctrl+Shift+O', 'Ctrl+Plus', 'Ctrl+=', 'Ctrl+-', 'Ctrl+Shift+Delete',
  'Ctrl+Shift+J', 'Ctrl+Shift+I', 'Ctrl+Shift+C', 'Ctrl+Shift+M', 'Ctrl+Shift+E',
  'Ctrl+A', 'Ctrl+C', 'Ctrl+X', 'Ctrl+V', 'Ctrl+Z', 'Ctrl+Y', 'Ctrl+F5',
  'Alt+Home', 'Alt+ArrowLeft', 'Alt+ArrowRight', 'Alt+D', 'Alt+F4', 'Alt+F', 'Alt+E', 'Alt+Space',
  'F1', 'F3', 'F5', 'Shift+F5', 'F6', 'Shift+F6', 'F7', 'F10', 'F11', 'F12',
  'Meta+T', 'Meta+N', 'Meta+W', 'Meta+Shift+T', 'Meta+Shift+N', 'Meta+Shift+W',
  'Meta+1', 'Meta+2', 'Meta+3', 'Meta+4', 'Meta+5', 'Meta+6', 'Meta+7', 'Meta+8', 'Meta+9', 'Meta+0',
  'Meta+Shift+]', 'Meta+Shift+[', 'Meta+Alt+ArrowRight', 'Meta+Alt+ArrowLeft', 'Meta+`', 'Meta+Shift+`',
  'Meta+L', 'Meta+K', 'Meta+E', 'Meta+R', 'Meta+Shift+R', 'Meta+F', 'Meta+G', 'Meta+Shift+G',
  'Meta+ArrowLeft', 'Meta+ArrowRight', 'Meta+[', 'Meta+]', 'Meta+P', 'Meta+S', 'Meta+D', 'Meta+Shift+D',
  'Meta+O', 'Meta+Alt+U', 'Meta+Alt+J', 'Meta+Alt+I', 'Meta+Alt+C', 'Meta+Alt+E', 'Meta+Alt+M',
  'Meta+Y', 'Meta+Shift+B', 'Meta+Alt+B', 'Meta+Shift+J', 'Meta+Plus', 'Meta+=', 'Meta+-',
  'Meta+Shift+Delete', 'Meta+A', 'Meta+C', 'Meta+X', 'Meta+V', 'Meta+Shift+V', 'Meta+Z', 'Meta+Shift+Z',
  'Meta+M', 'Meta+H', 'Meta+Q', 'Meta+,', 'Meta+Ctrl+F', 'Meta+Space', 'Meta+Tab',
]);
// #endregion

// #region Combo algebra — MIRRORED BYTE-FOR-BYTE IN THE EXTENSION (uses e.key, never e.code)
/** Canonical combo string from a keydown, or null when it's not a usable shortcut
 *  (no Ctrl/Alt/Meta, or a lone modifier key). Backward-compatible superset of the
 *  legacy view.ts comboFromEvent — same order, same uppercasing — so already-stored
 *  shortcuts remain valid. */
export function comboFromEvent(e: KeyboardEvent): string | null {
  // 1. Require at least one non-shift modifier; Shift alone never qualifies.
  if (!(e.ctrlKey || e.altKey || e.metaKey)) return null;
  const k = e.key;
  // 2. Reject lone modifier keys. 'OS' is the legacy Win/Meta key name.
  if (k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Shift' || k === 'OS') return null;
  // 3. Fixed modifier order: Ctrl, Alt, Meta, Shift.
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  if (e.shiftKey) parts.push('Shift');
  // 4. Main key token from e.key (keycap-based, NEVER e.code).
  parts.push(normalizeKeyName(k));
  return parts.join('+');
}
function normalizeKeyName(k: string): string {
  if (k === ' ' || k === 'Spacebar') return 'Space'; // avoid an invisible token
  if (k === '+') return 'Plus'; // a literal '+' would break the '+'-joined combo string
  if (k.length === 1) return k.toUpperCase(); // letters, digits, punctuation
  return k; // multi-char DOM names kept verbatim: Enter, Tab, Escape, ArrowUp, F1..F12, …
}

/** True for INPUT/TEXTAREA/SELECT/contenteditable. MIRRORED in the extension. */
export function isTypingTarget(t: EventTarget | null): boolean {
  const node = t as HTMLElement | null;
  if (!node) return false;
  return (
    node.tagName === 'INPUT' ||
    node.tagName === 'TEXTAREA' ||
    node.tagName === 'SELECT' ||
    node.isContentEditable === true
  );
}

/** Idempotently re-normalize an already-built combo string (legacy migration /
 *  validation). Returns null if it doesn't look like a valid combo. */
export function normalizeCombo(combo: string): string | null {
  if (!combo) return null;
  const raw = combo.split('+').map((p) => p.trim()).filter(Boolean);
  if (raw.length < 2) return null; // must be at least one modifier + a key
  const want = { Ctrl: false, Alt: false, Meta: false, Shift: false };
  const others: string[] = [];
  for (const p of raw) {
    if (p === 'Ctrl' || p === 'Control') want.Ctrl = true;
    else if (p === 'Alt' || p === 'Option') want.Alt = true;
    else if (p === 'Meta' || p === 'Cmd' || p === 'Command' || p === 'Win' || p === 'OS') want.Meta = true;
    else if (p === 'Shift') want.Shift = true;
    else others.push(p);
  }
  if (others.length !== 1) return null; // exactly one main key
  if (!(want.Ctrl || want.Alt || want.Meta)) return null; // shift-only never qualifies
  const parts: string[] = [];
  if (want.Ctrl) parts.push('Ctrl');
  if (want.Alt) parts.push('Alt');
  if (want.Meta) parts.push('Meta');
  if (want.Shift) parts.push('Shift');
  parts.push(normalizeKeyName(others[0]));
  return parts.join('+');
}

const IS_MAC = typeof navigator !== 'undefined' && /Mac|iPhone|iPad|iPod/.test(navigator.platform || navigator.userAgent || '');
const MAC_SYMBOL: Record<string, string> = { Ctrl: '⌃', Alt: '⌥', Meta: '⌘', Shift: '⇧' };

/** Display-only rendering. On mac, swap modifier words for ⌃⌥⌘⇧. NEVER stored or
 *  matched — the raw canonical string is what's persisted and compared. */
export function prettyCombo(combo: string): string {
  if (!combo) return '';
  const parts = combo.split('+');
  if (IS_MAC) {
    return parts.map((p) => MAC_SYMBOL[p] ?? p).join('');
  }
  return parts.join(' + ');
}
// #endregion

// #region classifyCombo — the single gatekeeper
const TAB_JUMP_RE = /^(Ctrl|Meta)\+([0-9])$/;

/** Single gatekeeper for a captured combo. Order: no-modifier → reserved
 *  (programmatic tab-jump guard, then the blocklist) → in-use. First failure
 *  wins. `existingCombos` must already EXCLUDE the bookmark's own current combo
 *  (self-exclusion), and should span the ENTIRE bookmark list, not the filtered view. */
export function classifyCombo(
  combo: string | null,
  existingCombos: Set<string>
): { ok: true; combo: string } | { ok: false; reason: ComboRejectReason } {
  const norm = combo ? normalizeCombo(combo) : null;
  if (!norm) {
    // No combo at all → either nothing captured or shift-only / lone modifier.
    return { ok: false, reason: combo ? 'no-modifier' : 'invalid' };
  }
  // Reserved: programmatic (Ctrl|Meta)+digit guard first, then the blocklist.
  if (TAB_JUMP_RE.test(norm) || reservedCombos.has(norm)) {
    return { ok: false, reason: 'reserved' };
  }
  if (existingCombos.has(norm)) {
    return { ok: false, reason: 'in-use' };
  }
  return { ok: true, combo: norm };
}

function reasonMessage(reason: ComboRejectReason): string {
  switch (reason) {
    case 'no-modifier':
      return 'Add a modifier: try Alt + a letter or Ctrl + Shift + a letter.';
    case 'reserved':
      return 'That combo is reserved by the browser. Try Alt + a letter or Ctrl + Shift + a letter.';
    case 'in-use':
      return 'That combo is already used by another link.';
    case 'invalid':
    default:
      return 'Press a key combination that includes Ctrl, Alt, or ⌘.';
  }
}
// #endregion

// #region Open a link: tab or window (Gabe, 9/7/26)
//
// One prefs switch (openLinksInNewWindow, off by default) decides how every
// single-link open behaves — attachment click, bookmark card click, and an
// in-app keyboard shortcut all funnel through here. Bulk "Open all" (openTabs
// below) also reads it for its own per-link window.open calls. The dedicated
// "Open all in a new window" premium button is a separate feature (Gabe,
// 9/8/26): it always asks the extension for ONE new window holding every link
// as a tab (openUrlsInWindow, further down), regardless of this setting,
// because chrome.windows.create is the only thing that can put more than one
// tab in a window it creates — window.open never can.

/** A real separate browser window (full chrome, not a stripped popup), sized to
 *  4/5 of the screen and centered, so it reads as "your own window" rather than
 *  a cramped dialog. */
function newWindowFeatures(): string {
  const w = Math.round(screen.availWidth * 0.8);
  const h = Math.round(screen.availHeight * 0.8);
  const left = Math.round((screen.availWidth - w) / 2);
  const top = Math.round((screen.availHeight - h) / 2);
  return `noopener,width=${w},height=${h},left=${left},top=${top}`;
}

/** Open one link, honoring the new-window preference. THE single-open counterpart
 *  to openTabs below (which handles bulk opens). */
export function openLink(url: string): void {
  if (getPrefs().openLinksInNewWindow) window.open(url, '_blank', newWindowFeatures());
  else window.open(url, '_blank', 'noopener');
}
// #endregion

// #region In-app dispatcher (focused-tab fallback) + recording guard
let _recording = false;
let _dispatcherInstalled = false;
let _extActive = false; // true once the extension is detected; the own-tab handler fires only then

/** Set the module guard so the global dispatcher ignores keys for the ENTIRE modal
 *  lifetime (not per-keypress), preventing a stray match mid-capture. */
export function setRecording(active: boolean): void {
  _recording = active;
}

/** Handles shortcut presses ON the Cobalt tab itself. The extension's content
 *  script deliberately skips its own origin and defers here. Fires ONLY when the
 *  extension is detected: shortcuts are a premium/extension feature, so with no
 *  extension nothing fires (and nothing can be saved either — see openShortcutModal). */
export function installInAppDispatcher(getList: () => ShortcutBookmark[]): void {
  if (_dispatcherInstalled) return;
  _dispatcherInstalled = true;
  document.addEventListener('keydown', (e) => {
    if (_recording || !_extActive) return;
    if (isTypingTarget(e.target)) return;
    const combo = comboFromEvent(e);
    if (!combo) return;
    const norm = normalizeCombo(combo);
    if (!norm) return;
    const bm = getList().find((b) => b.shortcut && normalizeCombo(b.shortcut) === norm);
    if (bm) {
      e.preventDefault();
      openLink(normalizeUrl(bm.url));
    }
  });
  // Re-probe the extension when the user returns to the tab (e.g. they just
  // installed it), so detection + any open install banner stay fresh.
  window.addEventListener('focus', () => {
    _detectCache = null;
    _concludedAbsent = false; // they may have just installed or reloaded it
    void detectExtension();
  });
}
// #endregion

// #region Extension bridge — postMessage ANNOUNCE + detect + sync
let _announcedExtId = '';
let _bridgeListening = false;
let _detectCache: { result: DetectResult; at: number } | null = null;
const DETECT_CACHE_MS = 5000;
// A "not installed" result is cached far more briefly than a positive one. A
// positive result staying stale for 5s is harmless (the extension really is
// there). A NEGATIVE result staying stale for 5s is what let one lost race
// against a cold service-worker wake (see PING_TIMEOUT_MS above) poison every
// click for the next 5 seconds with the same wrong "not installed" answer,
// without ever re-probing. 800ms still coalesces rapid double-clicks but lets
// the very next deliberate press get a fresh, honest probe.
const DETECT_NEGATIVE_CACHE_MS = 800;
// Resolvers for in-flight detectExtension() calls, settled by an ANNOUNCE or PONG.
const _detectWaiters = new Set<(r: DetectResult) => void>();
// Resolvers for bridge-relayed REQUESTS, keyed by reqId. bridge.js echoes the
// reqId back on the SW's reply, which is what lets a postMessage round-trip carry
// a real answer instead of being fire-and-forget.
const _replyWaiters = new Map<string, (reply: Record<string, unknown>) => void>();
let _reqSeq = 0;
const nextReqId = (): string => `ws${Date.now().toString(36)}${(_reqSeq++).toString(36)}`;

// --- The instant install signal (Gabe, 9/9/26) ---------------------------
// bridge.js stamps <html data-cobalt-ext="1.1.0"> at document_start. Reading an
// attribute costs nothing and cannot lose a race, so it replaces the old
// "post a PING and wait up to 1.5s" gate as the FIRST thing every check does.
// The PING survives underneath it for two jobs the attribute cannot do: telling
// a genuinely-absent extension apart from a live-but-unresponsive one, and
// supporting an older installed build that predates the attribute.
const EXT_ATTR = 'cobaltExt';

/** The extension version stamped on <html>, or null when nothing stamped it. */
function stampedExtVersion(): string | null {
  try {
    const v = document.documentElement.dataset[EXT_ATTR];
    return v ? v : null;
  } catch {
    return null;
  }
}

// True once any signal (stamp, ANNOUNCE or PONG) has ever confirmed the
// extension in this page's lifetime. Guards the fast negative below: we only
// answer "not installed" without waiting when we have never seen it at all.
let _everSawExt = false;
// Set when a full probe has run and come back empty, which is what licenses an
// INSTANT "not installed" on later checks instead of another full timeout.
let _concludedAbsent = false;

/** Watch for a LATE stamp: background.js injects bridge.js into tabs that were
 *  already open when the extension loaded or reloaded, so the attribute can
 *  appear seconds after the page did. Without this the page would sit on a
 *  stale "not installed" until the next window focus. */
function watchForLateStamp(): void {
  if (typeof MutationObserver === 'undefined') return;
  const obs = new MutationObserver(() => {
    const v = stampedExtVersion();
    if (!v) return;
    obs.disconnect();
    _everSawExt = true;
    _extActive = true;
    _concludedAbsent = false;
    _detectCache = { result: { installed: true, version: v }, at: Date.now() };
    const waiters = [..._detectWaiters];
    _detectWaiters.clear();
    for (const w of waiters) w({ installed: true, version: v });
  });
  obs.observe(document.documentElement, { attributes: true, attributeFilter: ['data-cobalt-ext'] });
}

/** Listen for the extension's postMessage signals: ANNOUNCE (posted on page load)
 *  AND PONG (the reply to our PING). Either means "installed", and either resolves
 *  any detect() call currently waiting. Idempotent. */
function ensureBridgeListener(): void {
  if (_bridgeListening) return;
  _bridgeListening = true;
  window.addEventListener('message', (ev: MessageEvent) => {
    if (ev.source !== window) return; // only same-window relays from bridge.js
    const d = ev.data as
      | { source?: string; v?: number; type?: string; extId?: string; extVersion?: string }
      | undefined;
    if (!d || d.source !== 'workspace-ext') return;
    // A reply to a specific bridge-relayed request (it carries our reqId back).
    const rid = (d as { reqId?: string }).reqId;
    if (rid && _replyWaiters.has(rid)) {
      const w = _replyWaiters.get(rid)!;
      _replyWaiters.delete(rid);
      w(d as unknown as Record<string, unknown>);
      return;
    }
    if (d.type === 'ANNOUNCE' || d.type === 'PONG') {
      if (d.extId) _announcedExtId = d.extId;
      const r: DetectResult = { installed: true, version: d.extVersion };
      _extActive = true;
      _everSawExt = true;
      _concludedAbsent = false;
      _detectCache = { result: r, at: Date.now() };
      const waiters = [..._detectWaiters];
      _detectWaiters.clear();
      for (const w of waiters) w(r);
    }
  });
}

/** Resolve the best-known extension id: explicit EXTENSION_ID, else one learned
 *  from a postMessage ANNOUNCE/PONG. */
function knownExtId(): string {
  return EXTENSION_ID || _announcedExtId;
}

/** Install + version detection — ACTIVELY asks the extension (request→response) so
 *  it works no matter when the page or the Links tab loaded, instead of relying on
 *  the extension's one-shot announce (which the app can miss):
 *    • published build → direct chrome.runtime.sendMessage(extId, PING) → PONG.
 *    • dev/localhost  → window.postMessage(PING); the bridge content script relays
 *      it to the service worker and the PONG returns via ensureBridgeListener.
 *  Resolves installed:false only if nothing answers within timeoutMs. */
export function detectExtension(timeoutMs: number = PING_TIMEOUT_MS): Promise<DetectResult> {
  ensureBridgeListener();

  // 0. INSTANT YES. bridge.js stamped the version on <html> at document_start,
  //    so the answer is already sitting in the DOM. No message, no timeout.
  const stamped = stampedExtVersion();
  if (stamped) {
    const r: DetectResult = { installed: true, version: stamped };
    _extActive = true;
    _everSawExt = true;
    _concludedAbsent = false;
    _detectCache = { result: r, at: Date.now() };
    return Promise.resolve(r);
  }

  // 0b. INSTANT NO. A full probe already came back empty and nothing has
  //     confirmed the extension since, so make the user wait exactly zero ms
  //     for the "install the extension" toast. A later install is still picked
  //     up: the window-focus re-probe and the late-stamp observer both clear
  //     this flag.
  if (_concludedAbsent && !_everSawExt) {
    return Promise.resolve({ installed: false });
  }

  if (_detectCache) {
    const ttl = _detectCache.result.installed ? DETECT_CACHE_MS : DETECT_NEGATIVE_CACHE_MS;
    if (Date.now() - _detectCache.at < ttl) {
      return Promise.resolve(_detectCache.result);
    }
  }

  return new Promise<DetectResult>((resolve) => {
    let settled = false;
    let timer = 0;
    const onSignal = (r: DetectResult) => {
      if (settled) return;
      settled = true;
      _detectWaiters.delete(onSignal);
      window.clearTimeout(timer);
      _detectCache = { result: r, at: Date.now() };
      _extActive = r.installed;
      if (r.installed) _everSawExt = true;
      else if (!_everSawExt) _concludedAbsent = true;
      resolve(r);
    };
    // An ANNOUNCE/PONG arriving via the bridge resolves this call.
    _detectWaiters.add(onSignal);

    // 1. Direct channel (published extension with a known id).
    const chrome = getChrome();
    const extId = knownExtId();
    const runtime = chrome && chrome.runtime;
    if (runtime && runtime.sendMessage && extId) {
      try {
        runtime.sendMessage(
          extId,
          { source: 'workspace', v: PROTOCOL_VERSION, type: 'PING' },
          (response: unknown) => {
            if (runtime.lastError) return; // not reachable directly; bridge/timer decides
            const r = response as { source?: string; type?: string; extVersion?: string } | undefined;
            if (r && r.source === 'workspace-ext' && r.type === 'PONG') {
              onSignal({ installed: true, version: r.extVersion });
            }
          }
        );
      } catch {
        /* unknown id throws synchronously in some browsers — bridge/timer decides */
      }
    }

    // 2. Bridge channel (dev/localhost + non-Chrome): the bridge content script, if
    //    present in the page, relays this PING to the SW and posts the PONG back.
    try {
      window.postMessage({ source: 'workspace', v: PROTOCOL_VERSION, type: 'PING' }, location.origin);
    } catch {
      /* ignore */
    }

    // 3. Nothing answered in time → treat as not installed.
    timer = window.setTimeout(() => onSignal({ installed: false }), timeoutMs);
  });
}

/** Build the authoritative ShortcutConfig from the current bookmark list. */
function buildConfig(list: ShortcutBookmark[]): ShortcutConfig {
  const entries: ShortcutEntry[] = [];
  for (const b of list) {
    if (!b.shortcut) continue;
    const combo = normalizeCombo(b.shortcut);
    if (!combo) continue;
    entries.push({ id: b.id, combo, url: normalizeUrl(b.url), name: b.name });
  }
  return {
    version: 1,
    origin: location.origin,
    updatedAt: Date.now(),
    entries,
  };
}

/** Full-replace sync of every shortcut to the extension. No-op resolving false
 *  when the extension is absent. NEVER throws. On a send failure, the positive
 *  detect cache is invalidated so an uninstall is noticed on the next detect. */
export function syncShortcutsToExtension(list: ShortcutBookmark[]): Promise<boolean> {
  ensureBridgeListener();
  const config = buildConfig(list);
  const msg = { source: 'workspace', v: PROTOCOL_VERSION, type: 'SYNC_SHORTCUTS', config };
  const chrome = getChrome();
  const extId = knownExtId();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean) => {
      if (settled) return;
      settled = true;
      if (!ok) _detectCache = null; // invalidate so a later detect re-checks
      resolve(ok);
    };

    const canDirect = !!(chrome && chrome.runtime && chrome.runtime.sendMessage && extId);
    if (!canDirect) {
      // No direct channel: the postMessage bridge is the only path (localhost/dev +
      // Firefox/Safari). Don't also post when the direct channel works, or the same
      // SYNC reaches the background twice (external + bridge-relayed).
      try {
        window.postMessage(msg, location.origin);
      } catch {
        /* ignore */
      }
      done(!!_announcedExtId);
      return;
    }

    const timer = window.setTimeout(() => done(false), PING_TIMEOUT_MS);
    try {
      chrome!.runtime!.sendMessage!(extId, msg, (response: unknown) => {
        window.clearTimeout(timer);
        if (chrome!.runtime!.lastError) {
          done(false);
          return;
        }
        const r = response as { source?: string; type?: string; ok?: boolean } | undefined;
        done(!!(r && r.source === 'workspace-ext' && r.type === 'SYNC_ACK' && r.ok));
      });
    } catch {
      window.clearTimeout(timer);
      done(false);
    }
  });
}
// #endregion

/** Synchronous "did a PING already answer?" — the async detectExtension caches its
 *  result here. Callers that must decide INSIDE a click handler use this: awaiting
 *  a fresh detect would spend the user gesture, and browsers block the window.open
 *  fallback once that's gone. False when the cache is cold (never detected yet), so
 *  the caller simply takes the plain-tabs path. */
export function extensionActive(): boolean {
  if (stampedExtVersion()) {
    _extActive = true;
    return true;
  }
  return _extActive;
}

/** Shown when the extension IS installed but its service worker never answered.
 *  Deliberately different wording from the "install it" toasts: the fix here is
 *  a reload in chrome://extensions, not an install. */
export const EXTENSION_NOT_RESPONDING_MSG =
  'The Cobalt extension did not respond. Try reloading it in chrome://extensions.';

// --- Boot probe + one diagnostic line ------------------------------------
// One console.info at startup saying exactly how detection landed and why, so a
// "the premium buttons do nothing" report can be diagnosed from the console in
// seconds instead of another round of guessing (Gabe, 9/9/26).
function bootDetectionProbe(): void {
  ensureBridgeListener();
  watchForLateStamp();
  const stamped = stampedExtVersion();
  if (stamped) {
    _extActive = true;
    _everSawExt = true;
    _detectCache = { result: { installed: true, version: stamped }, at: Date.now() };
    console.info(
      `[Cobalt] extension detected: YES (version ${stamped}, read from the data-cobalt-ext stamp on <html>). Origin ${location.origin}.`
    );
    return;
  }
  void detectExtension().then((r) => {
    if (r.installed) {
      console.info(
        `[Cobalt] extension detected: YES (version ${r.version ?? 'unknown'}, via a PONG reply, no data-cobalt-ext stamp). The installed build predates the stamp: reload it in chrome://extensions. Origin ${location.origin}.`
      );
    } else {
      console.info(
        `[Cobalt] extension detected: NO (no data-cobalt-ext stamp on <html> and no PONG within ${PING_TIMEOUT_MS}ms). Either it is not installed, or it is installed but was last reloaded before ${location.origin} was added to its manifest. Fix: chrome://extensions, find Cobalt Premium, click Reload, then hard-refresh this tab.`
      );
    }
  });
}
if (typeof window !== 'undefined' && typeof document !== 'undefined') {
  bootDetectionProbe();
}

// #region Chrome tab groups (premium) — open a set of links as one named bundle
/** Chrome's tab-group palette. `chrome.tabGroups.update` accepts only these nine
 *  names, so a Cobalt hex has to be snapped to the closest one. */
const CHROME_GROUP_COLORS: [string, [number, number, number]][] = [
  ['grey', [95, 99, 104]],
  ['blue', [26, 115, 232]],
  ['red', [217, 48, 37]],
  ['yellow', [249, 171, 0]],
  ['green', [30, 142, 62]],
  ['pink', [208, 24, 132]],
  ['purple', [147, 52, 230]],
  ['cyan', [0, 123, 131]],
  ['orange', [250, 144, 62]],
];

/** Nearest Chrome group color to an arbitrary hex, by squared RGB distance. A
 *  group's gold, a course's purple: each lands on the palette entry that reads
 *  closest, so the browser strip echoes the color used inside Cobalt. */
export function toChromeGroupColor(hex: string): string {
  const m = /^#?([0-9a-f]{6})$/i.exec((hex || '').trim());
  if (!m) return 'grey';
  const n = parseInt(m[1], 16);
  const rgb = [(n >> 16) & 255, (n >> 8) & 255, n & 255];
  let best = 'grey';
  let bestD = Infinity;
  for (const [name, c] of CHROME_GROUP_COLORS) {
    const d = (rgb[0] - c[0]) ** 2 + (rgb[1] - c[1]) ** 2 + (rgb[2] - c[2]) ** 2;
    if (d < bestD) {
      bestD = d;
      best = name;
    }
  }
  return best;
}

/**
 * Open `urls` as a named, colored Chrome tab group (premium; needs the extension).
 * Resolves false when the extension is absent or grouping fails, so every caller
 * can fall back to opening plain tabs. NEVER throws.
 */
export function openUrlsInGroup(name: string, colorHex: string, urls: string[]): Promise<boolean> {
  return sendTabRequest('OPEN_GROUP', 'OPEN_GROUP_ACK', { name, color: toChromeGroupColor(colorHex), urls });
}

/**
 * Open `urls` as PLAIN tabs through the extension (chrome.tabs.create), no group.
 * Exists because window.open hits the popup blocker: Chrome allows ONE popup per
 * click, so "Open all" from the page could only ever open the first link. The
 * extension has no such limit. Resolves false when the extension is absent, old
 * (no OPEN_TABS handler yet), or refuses.
 */
export function openUrlsPlain(urls: string[]): Promise<boolean> {
  return sendTabRequest('OPEN_TABS', 'OPEN_TABS_ACK', { urls });
}

/**
 * Open `urls` as ONE new browser window, with every link as a TAB inside it
 * (premium; needs the extension). This is the corrected "Open all in a new
 * window" button (Gabe, 9/8/26): "That button should create a new Chrome
 * window that has all of the attachments or links as separate tabs. It's not
 * that the links or attachments are windows themselves, that they compose one
 * Chrome window." Plain window.open cannot do this — a page gets one popup per
 * click and can never add further tabs to a window it opened — so only the
 * extension can, via chrome.windows.create with an array of urls. Resolves
 * false when the extension is absent or the call fails. Callers must NOT fall
 * back to opening tabs (or one window per link) on a false result: Gabe
 * reported that exact fallback as misleading (9/8/26) — pressing this button
 * with no extension installed silently opened the links as tabs in his
 * CURRENT window, which looks like the button did something when it refused.
 * The only correct response to false here is telling the user the extension
 * is required and opening nothing — see OPEN_WINDOW_NEEDS_EXTENSION_MSG.
 */
export function openUrlsInWindow(urls: string[]): Promise<boolean> {
  return sendTabRequest('OPEN_WINDOW', 'OPEN_WINDOW_ACK', { urls });
}

/** Shared copy for the "open all in a new window" premium feature (Gabe,
 *  9/8/26 bug fix), used by both call sites — the bookmarks group row and the
 *  attachments popup — so the two never drift into saying different things.
 *  Shown whenever the window can't be opened, whether the extension is
 *  missing, didn't answer in time, or answered "no": in every case the fix is
 *  the same (install/reload the extension), and there is no lesser substitute
 *  to fall back to. */
export const OPEN_WINDOW_NEEDS_EXTENSION_MSG =
  'Install the Cobalt extension to open all links in one new window.';

/** Shared copy for the "+ Shortcut" chip's extension gate (Gabe, 9/8/26: make it a
 *  toast "just like this current one", meaning OPEN_WINDOW_NEEDS_EXTENSION_MSG
 *  above, for continuity — one consistent way the app says "this needs the
 *  extension" instead of a pop-up banner). */
export const SHORTCUT_NEEDS_EXTENSION_MSG =
  'Install the Cobalt extension to set a keyboard shortcut for this link.';

/**
 * THE one entry point for "open these links as separate tabs" (bookmarks Open
 * all, attachments Open all, and every premium button's failure fallback when
 * the extension answers "no"). Extension first, because it dodges the popup
 * blocker; otherwise window.open per link, counting what the blocker ate and
 * saying so in a toast instead of silently opening one tab and looking broken.
 */
export function openTabs(urls: string[]): void {
  const clean = urls.filter(Boolean);
  if (!clean.length) return;
  // TABS, ALWAYS. This function never opens windows, not even when the
  // "open links in a new window" setting is on (Gabe, 9/8/26). That setting
  // governs a SINGLE link click; a bulk open honoring it would open one window
  // per link, which is precisely the behavior he rejected: "it's not that the
  // links or attachments are windows themselves, that they compose one Chrome
  // window." One window holding every link as a tab is a different feature with
  // its own button, and it goes through openUrlsInWindow and the extension,
  // because window.open cannot put a second tab into a window it just made.
  // This also matters as a FALLBACK: when that button's extension call fails it
  // lands here, and here must not quietly do the rejected thing.
  const plainLoop = (): void => {
    let blocked = 0;
    for (const u of clean) {
      const w = window.open(u, '_blank', 'noopener');
      if (!w) blocked++;
    }
    if (blocked > 0) {
      showToast(
        `Chrome blocked ${blocked} of ${clean.length} tabs. Allow pop-ups for Cobalt to open them all.`
      );
    }
  };
  if (!extensionActive()) {
    plainLoop();
    return;
  }
  void openUrlsPlain(clean).then((ok) => {
    if (!ok) plainLoop(); // late fallback: the blocker will likely eat the extras, but the toast explains
  });
}

/** The shared request/ack plumbing both tab openers ride: direct channel when the
 *  origin is in externally_connectable, the postMessage bridge everywhere else. */
function sendTabRequest(
  type: 'OPEN_GROUP' | 'OPEN_TABS' | 'OPEN_WINDOW',
  ackType: 'OPEN_GROUP_ACK' | 'OPEN_TABS_ACK' | 'OPEN_WINDOW_ACK',
  payload: Record<string, unknown>
): Promise<boolean> {
  ensureBridgeListener();
  const chrome = getChrome();
  const extId = knownExtId();

  return new Promise<boolean>((resolve) => {
    let settled = false;
    const done = (ok: boolean, how: string) => {
      if (settled) return;
      settled = true;
      if (!ok) console.warn('[Cobalt]', type, 'did not run:', how);
      resolve(ok);
    };

    /**
     * Relay through the postMessage bridge (content script → SW) and WAIT for the
     * real ACK, matched by reqId. This is the path that must work everywhere: the
     * direct channel only exists for origins listed in the manifest's
     * externally_connectable, so on any other host (a LAN IP, a different port,
     * the deployed site) it is simply unavailable, and giving up there was why
     * grouping silently fell back to plain tabs.
     */
    const viaBridge = (): void => {
      const reqId = nextReqId();
      const timer = window.setTimeout(() => {
        _replyWaiters.delete(reqId);
        done(false, 'no reply from the extension (is it loaded, and reloaded since the manifest changed?)');
      }, 8000); // one tabs.create per link, then the group call
      _replyWaiters.set(reqId, (reply) => {
        window.clearTimeout(timer);
        done(reply.type === ackType && !!reply.ok, `extension replied ok=${String(reply.ok)}`);
      });
      try {
        window.postMessage({ source: 'workspace', v: PROTOCOL_VERSION, type, payload, reqId }, location.origin);
      } catch {
        window.clearTimeout(timer);
        _replyWaiters.delete(reqId);
        done(false, 'postMessage blocked');
      }
    };

    const canDirect = !!(chrome && chrome.runtime && chrome.runtime.sendMessage && extId);
    if (!canDirect) {
      viaBridge();
      return;
    }

    const msg = { source: 'workspace', v: PROTOCOL_VERSION, type, payload };
    let directFailed = false;
    const timer = window.setTimeout(() => {
      if (!settled && !directFailed) viaBridge(); // direct went quiet: try the relay
    }, 4000);
    try {
      chrome!.runtime!.sendMessage!(extId, msg, (response: unknown) => {
        window.clearTimeout(timer);
        if (chrome!.runtime!.lastError) {
          // Almost always "Could not establish connection": this page's origin is
          // not in externally_connectable. The bridge does not care about origin.
          directFailed = true;
          viaBridge();
          return;
        }
        // The service worker ANSWERED, so its verdict is final. Never retry over
        // the bridge here: both channels run the same handler, so a second attempt
        // would open every link a second time.
        const r = response as { source?: string; type?: string; ok?: boolean } | undefined;
        directFailed = true;
        done(!!(r && r.type === ackType && r.ok), 'the extension refused (see its service-worker console)');
      });
    } catch {
      window.clearTimeout(timer);
      viaBridge();
    }
  });
}
// #endregion

// #region openShortcutModal — the "Select Keys" capture modal
/** Open the "Open this website with a key combination." modal. The chip's click
 *  handler in view.ts is the extension gate now (Gabe, 9/8/26): it checks
 *  detectExtension() BEFORE calling this, and shows SHORTCUT_NEEDS_EXTENSION_MSG
 *  as a toast instead of opening this modal when the extension is missing. So by
 *  the time this runs, the extension is known to be present (or it's sample mode,
 *  which never gates at all) and the capture UI is the only thing there is to
 *  show. This used to detect internally and branch to an install banner
 *  (renderInstallPrompt, removed the same day) — that was the pop-up Gabe wanted
 *  gone in favor of the toast.
 *  The recording guard stays set for the whole modal lifetime and is always
 *  cleared. */
export function openShortcutModal(bm: ShortcutBookmark, opts: OpenShortcutModalOptions): void {
  // Guard the own-tab dispatcher for the entire modal lifetime.
  setRecording(true);

  const back = el('div', { class: 'bm-backdrop' });
  const box = el('div', { class: 'bm-modal' });

  let cleanedUp = false;
  let removeKeyListener: (() => void) | null = null;
  const cleanup = () => {
    if (cleanedUp) return;
    cleanedUp = true;
    setRecording(false);
    if (removeKeyListener) removeKeyListener();
  };
  const close = () => {
    cleanup();
    fadeRemove(back);
  };

  box.append(el('h3', { class: 'bm-modal-title', text: 'Open this website with a key combination' }));

  const content = el('div', { class: 'bm-modal-content' });
  box.append(content);

  back.append(box);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  (opts.host ?? document.body).append(back);

  // --- Installed → the "Select Keys" capture UI (keys only) ---
  const buildInstalled = (): void => {
    content.replaceChildren();
    content.append(
      el('div', { class: 'bm-modal-hint', text: `Choose a combo to open “${bm.name}” instantly.` })
    );

    let captured: string | null = bm.shortcut ? normalizeCombo(bm.shortcut) : null;

    content.append(el('div', { class: 'bm-modal-label', text: 'Select keys' }));
    const keysWrap = el('div', { class: 'bm-keys-premium' });
    const keysBox = el('div', {
      class: 'bm-keys-box',
      tabindex: '0',
      role: 'button',
      'aria-label': 'Press a key combination',
    });
    const renderKeysBox = (text: string) => {
      keysBox.replaceChildren(el('span', { class: 'bm-keys-text', text }));
    };
    renderKeysBox(captured ? prettyCombo(captured) : 'Click here, then press keys');
    if (captured) keysBox.classList.add('is-valid');
    keysWrap.append(keysBox);
    content.append(keysWrap);

    const errLine = el('div', { class: 'bm-keys-error' });
    content.append(errLine);
    const setError = (text: string) => {
      errLine.classList.remove('is-ok');
      errLine.textContent = text;
      keysBox.classList.remove('is-valid');
      keysBox.classList.add('is-invalid');
    };
    const setOk = (text: string) => {
      errLine.classList.add('is-ok');
      errLine.textContent = text;
      keysBox.classList.remove('is-invalid');
      keysBox.classList.add('is-valid');
    };
    const clearMsg = () => {
      errLine.classList.remove('is-ok');
      errLine.textContent = '';
    };
    if (captured) setOk(prettyCombo(captured) + ' is set.');

    const footer = el('div', { class: 'bm-modal-footer' });
    const clearBtn = el('button', { class: 'bm-btn bm-btn-danger', text: 'Clear' });
    const cancel = el('button', { class: 'bm-btn', text: 'Cancel' });
    const saveBtn = el('button', { class: 'bm-btn bm-btn-primary', text: 'Save' }) as HTMLButtonElement;
    const refreshSaveState = () => {
      saveBtn.disabled = !captured;
    };
    refreshSaveState();

    const onKey = (ev: KeyboardEvent): void => {
      if (cleanedUp) return;
      if (document.activeElement !== keysBox) return; // only while the box is focused
      if (ev.key === 'Tab') return; // let focus leave the box
      ev.preventDefault();
      ev.stopPropagation();
      if (ev.key === 'Escape') {
        keysBox.blur();
        return;
      }
      // Bare Enter = Save (per Gabe: Enter confirms every popup). Safe to steal
      // here because a bare Enter can never BE a combo (no modifier), while
      // Ctrl/Alt+Enter still falls through and records like any other combo.
      if (ev.key === 'Enter' && !ev.ctrlKey && !ev.altKey && !ev.metaKey && !ev.shiftKey) {
        if (captured) saveBtn.click();
        return;
      }
      const raw = comboFromEvent(ev);
      if (!raw) {
        const building = buildingLabel(ev);
        renderKeysBox(building || 'Keep holding…');
        keysBox.classList.remove('is-valid', 'is-invalid');
        // Shift is never a qualifying modifier on its own (comboFromEvent rule #1),
        // so a Shift-led press — Shift, then a letter — otherwise looks frozen: every
        // key is swallowed with no explanation. Tell the user another modifier is needed.
        if (ev.shiftKey && !ev.ctrlKey && !ev.altKey && !ev.metaKey && ev.key.length === 1) {
          setError(`Shift alone isn’t enough. Add Ctrl or Alt. Try Ctrl + Shift + ${ev.key.toUpperCase()}.`);
        } else {
          clearMsg();
        }
        return;
      }
      const verdict = classifyCombo(raw, opts.existingCombos);
      if (verdict.ok) {
        captured = verdict.combo;
        renderKeysBox(prettyCombo(verdict.combo));
        setOk(prettyCombo(verdict.combo) + ' looks good.');
      } else {
        captured = null;
        renderKeysBox(prettyCombo(raw));
        setError(reasonMessage(verdict.reason));
      }
      refreshSaveState();
    };
    document.addEventListener('keydown', onKey, true);
    removeKeyListener = () => document.removeEventListener('keydown', onKey, true);

    keysBox.addEventListener('focus', () => {
      keysBox.classList.add('is-focused');
      if (!captured) renderKeysBox('Press keys…');
    });
    keysBox.addEventListener('blur', () => {
      keysBox.classList.remove('is-focused');
      if (!captured) {
        renderKeysBox('Click here, then press keys');
        keysBox.classList.remove('is-valid', 'is-invalid');
      } else {
        renderKeysBox(prettyCombo(captured));
      }
    });
    keysBox.addEventListener('click', () => keysBox.focus());

    clearBtn.addEventListener('click', () => {
      close();
      if (opts.onCleared) opts.onCleared();
    });
    cancel.addEventListener('click', close);
    saveBtn.addEventListener('click', () => {
      if (!captured) return;
      // Re-validate at save time in case the list changed underneath us.
      const verdict = classifyCombo(captured, opts.existingCombos);
      if (!verdict.ok) {
        setError(reasonMessage(verdict.reason));
        refreshSaveState();
        return;
      }
      const combo = verdict.combo;
      close();
      opts.onSaved(combo);
    });

    if (bm.shortcut) footer.append(clearBtn);
    footer.append(el('div', { class: 'bm-modal-spacer' }), cancel, saveBtn);
    content.append(footer);

    // Enter = Save when a valid combo is staged and focus ISN'T in the keys box
    // (there, the capture handler above owns every key and does the same thing).
    enterConfirms(back, () => (captured ? saveBtn : null));

    keysBox.focus();
  };

  buildInstalled();
}

/** Best-effort label while the user is still holding modifiers (combo not final). */
function buildingLabel(e: KeyboardEvent): string {
  const parts: string[] = [];
  if (e.ctrlKey) parts.push('Ctrl');
  if (e.altKey) parts.push('Alt');
  if (e.metaKey) parts.push('Meta');
  if (e.shiftKey) parts.push('Shift');
  if (parts.length === 0) return '';
  return prettyCombo(parts.join('+')) + (IS_MAC ? '' : ' + …');
}
// #endregion
