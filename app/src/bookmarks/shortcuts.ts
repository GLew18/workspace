// WorkSpace — keyboard shortcuts (premium, extension-backed) + in-app fallback.
//
// This module is the SINGLE SOURCE OF TRUTH for everything shortcut-related:
//   • comboFromEvent / normalizeCombo / isTypingTarget / prettyCombo — the combo
//     algebra. comboFromEvent + isTypingTarget + reservedCombos are MIRRORED
//     BYTE-FOR-BYTE in the companion extension's content script; any divergence
//     silently breaks matching, so edit them in lock-step.
//   • classifyCombo — the single gatekeeper (no-modifier → reserved → in-use).
//   • openShortcutModal — the "Select Keys" capture modal + premium/install UX.
//   • detectExtension / syncShortcutsToExtension / renderInstallPrompt — the
//     bridge to the companion extension (ping/pong + full-replace config sync).
//   • installInAppDispatcher / setRecording — the focused-tab fallback that fires
//     shortcuts while WorkSpace is the active tab (and yields to the extension
//     once it is detected, so exactly one tab opens per press).
//
// Transport: prefer chrome.runtime.sendMessage(EXTENSION_ID, …) when chrome and a
// known EXTENSION_ID exist; otherwise fall back to a window.postMessage handshake
// with the extension's bridge content script (dev/localhost + Firefox/Safari).

import { el, enterConfirms } from '../util/dom';
import { normalizeUrl } from './url';

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
  detect?: () => Promise<DetectResult>;
}
// #endregion

// #region Constants
export const PROTOCOL_VERSION = 1;
export const PING_TIMEOUT_MS = 600;

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

/** Web Store listing URL for the install CTA. */
function webStoreUrl(extId: string): string {
  return extId
    ? 'https://chromewebstore.google.com/detail/' + extId
    : 'https://chromewebstore.google.com/';
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

// #region In-app dispatcher (focused-tab fallback) + recording guard
let _recording = false;
let _dispatcherInstalled = false;
let _extActive = false; // true once the extension is detected; the own-tab handler fires only then

/** Set the module guard so the global dispatcher ignores keys for the ENTIRE modal
 *  lifetime (not per-keypress), preventing a stray match mid-capture. */
export function setRecording(active: boolean): void {
  _recording = active;
}

/** Handles shortcut presses ON the WorkSpace tab itself — the extension's content
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
      window.open(normalizeUrl(bm.url), '_blank', 'noopener');
    }
  });
  // Re-probe the extension when the user returns to the tab (e.g. they just
  // installed it), so detection + any open install banner stay fresh.
  window.addEventListener('focus', () => {
    _detectCache = null;
    void detectExtension();
  });
}
// #endregion

// #region Extension bridge — postMessage ANNOUNCE + detect + sync
let _announcedExtId = '';
let _bridgeListening = false;
let _detectCache: { result: DetectResult; at: number } | null = null;
const DETECT_CACHE_MS = 5000;
// Resolvers for in-flight detectExtension() calls, settled by an ANNOUNCE or PONG.
const _detectWaiters = new Set<(r: DetectResult) => void>();

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
    if (d.type === 'ANNOUNCE' || d.type === 'PONG') {
      if (d.extId) _announcedExtId = d.extId;
      const r: DetectResult = { installed: true, version: d.extVersion };
      _extActive = true;
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

  if (_detectCache && Date.now() - _detectCache.at < DETECT_CACHE_MS) {
    return Promise.resolve(_detectCache.result);
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

// #region Install prompt (reusable banner)
/** Render the premium/install CTA into `container`. Shown ONLY when the extension
 *  isn't detected. 'Install extension' opens the Web Store listing. */
export function renderInstallPrompt(container: HTMLElement): HTMLElement {
  const banner = el('div', { class: 'bm-install-banner' });
  banner.append(
    el('div', {
      class: 'bm-install-title',
      text: 'Keyboard shortcuts are a WorkSpace premium feature.',
    })
  );
  banner.append(
    el('div', {
      class: 'bm-install-body',
      text: 'Install the free companion extension to set keyboard shortcuts for your links.',
    })
  );
  const row = el('div', { class: 'bm-install-actions' });
  const install = el('button', { class: 'bm-btn bm-btn-primary', text: 'Install extension' });
  install.addEventListener('click', () => {
    window.open(webStoreUrl(knownExtId()), '_blank', 'noopener');
  });
  row.append(install);
  banner.append(row);
  container.append(banner);
  return banner;
}
// #endregion

// #region openShortcutModal — the "Select Keys" capture modal
/** Open the "Open this website with a key combination." modal. Shortcuts are
 *  extension-gated: detect the extension FIRST, then show EITHER the Select-Keys
 *  capture UI (installed) OR the install prompt (not installed) — never both. The
 *  recording guard stays set for the whole modal lifetime and is always cleared. */
export function openShortcutModal(bm: ShortcutBookmark, opts: OpenShortcutModalOptions): void {
  const detect = opts.detect ?? (() => detectExtension());

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
    back.remove();
  };

  box.append(el('h3', { class: 'bm-modal-title', text: 'Open this website with a key combination' }));

  const content = el('div', { class: 'bm-modal-content' });
  content.append(el('div', { class: 'bm-modal-hint', text: 'Checking for the WorkSpace extension…' }));
  box.append(content);

  back.append(box);
  back.addEventListener('click', (e) => {
    if (e.target === back) close();
  });
  document.body.append(back);

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

  // --- Not installed → the premium install prompt ONLY (no keys field) ---
  const buildNotInstalled = (): void => {
    content.replaceChildren();
    renderInstallPrompt(content);
    const footer = el('div', { class: 'bm-modal-footer' });
    const closeBtn = el('button', { class: 'bm-btn', text: 'Close' });
    closeBtn.addEventListener('click', close);
    footer.append(el('div', { class: 'bm-modal-spacer' }), closeBtn);
    content.append(footer);
  };

  void detect().then((r) => {
    if (cleanedUp) return; // modal already closed before detection resolved
    if (r.installed) buildInstalled();
    else buildNotInstalled();
  });
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
