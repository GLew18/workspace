// Cobalt Premium: content script.
//
// Runs at document_start on <all_urls>, all frames. This is the keydown hot path
// and it must work COLD (the MV3 service worker may be asleep), so matching is
// fully synchronous and reads its data straight from chrome.storage.local — never
// from the SW. Seeded once on load, then kept live via chrome.storage.onChanged
// (this is the "live sync" that replaces any manual refresh).
//
// IMPORTANT: comboFromEvent, normalizeKeyName, isTypingTarget, and RESERVED_COMBOS
// are mirrored BYTE-FOR-BYTE from the web app (app/src/bookmarks/shortcuts.ts).
// Any divergence silently breaks matching. Uses e.key, NEVER e.code.

(() => {
  'use strict';

  // Idempotency: a tab can receive this script from BOTH the manifest
  // content_scripts entry AND the programmatic inject-on-install in background.js.
  // The flag lives on this extension's isolated-world window, shared per frame, so
  // the second injection becomes a no-op (otherwise we'd double-bind keydown).
  if (window.__wsShortcutsLoaded) return;
  window.__wsShortcutsLoaded = true;

  // ===================== mirrored combo logic (verbatim) =====================

  function comboFromEvent(e) {
    // 1. Require at least one non-shift-capable modifier signal; Shift alone never qualifies a shortcut.
    if (!(e.ctrlKey || e.altKey || e.metaKey)) return null;
    const k = e.key;
    // 2. Reject lone modifier keys (combo not final yet). 'OS' is the legacy Win/Meta key name.
    if (k === 'Control' || k === 'Alt' || k === 'Meta' || k === 'Shift' || k === 'OS') return null;
    // 3. Fixed modifier order: Ctrl, Alt, Meta, Shift.
    const parts = [];
    if (e.ctrlKey) parts.push('Ctrl');
    if (e.altKey) parts.push('Alt');
    if (e.metaKey) parts.push('Meta');
    if (e.shiftKey) parts.push('Shift');
    // 4. Main key token from e.key (keycap-based, NEVER e.code):
    parts.push(normalizeKeyName(k));
    return parts.join('+');
  }

  function normalizeKeyName(k) {
    if (k === ' ' || k === 'Spacebar') return 'Space'; // avoid an invisible token
    if (k === '+') return 'Plus'; // a literal '+' would break the '+'-joined combo string
    if (k.length === 1) return k.toUpperCase(); // letters, digits, punctuation -> uppercase
    return k; // multi-char DOM names kept verbatim: Enter, Tab, Escape, ArrowUp, F1..F12, Home, End, PageUp, PageDown, Insert, Delete, Backspace
  }

  function isTypingTarget(t) {
    const node = t;
    if (!node) return false;
    return (
      node.tagName === 'INPUT' ||
      node.tagName === 'TEXTAREA' ||
      node.tagName === 'SELECT' ||
      node.isContentEditable === true
    );
  }

  // Mirrored byte-for-byte from the web app. The extension ALSO refuses these as
  // defense in depth even though the app's Select Keys box already blocks them.
  const RESERVED_COMBOS = new Set([
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

  // Programmatic guard mirrored from classifyCombo: refuse (Ctrl|Meta)+digit
  // tab-jumps regardless of set membership / layout quirks.
  const TAB_JUMP_RE = /^(Ctrl|Meta)\+([0-9])$/;

  function isReserved(combo) {
    if (!combo) return true;
    if (TAB_JUMP_RE.test(combo)) return true;
    return RESERVED_COMBOS.has(combo);
  }

  // ============================ in-memory config =============================

  // Seeded from chrome.storage.local and refreshed via storage.onChanged.
  let byCombo = Object.create(null); // { [combo]: { url, id, name } }
  let ownOrigin = null; // wsConfig.origin: Cobalt's own tab; in-app dispatcher owns it there.

  function applyStored(items) {
    const map = items && items.shortcutsByCombo;
    byCombo = map && typeof map === 'object' ? map : Object.create(null);
    const cfg = items && items.wsConfig;
    ownOrigin = cfg && typeof cfg.origin === 'string' ? cfg.origin : null;
  }

  try {
    chrome.storage.local.get(['shortcutsByCombo', 'wsConfig'], (items) => {
      if (chrome.runtime.lastError) return; // extension context torn down; ignore
      applyStored(items);
    });
  } catch (_e) {
    // chrome.storage unavailable (context invalidated) — leave maps empty.
  }

  try {
    chrome.storage.onChanged.addListener((changes, area) => {
      if (area !== 'local') return;
      if (changes.shortcutsByCombo) {
        const nv = changes.shortcutsByCombo.newValue;
        byCombo = nv && typeof nv === 'object' ? nv : Object.create(null);
      }
      if (changes.wsConfig) {
        const cfg = changes.wsConfig.newValue;
        ownOrigin = cfg && typeof cfg.origin === 'string' ? cfg.origin : null;
      }
    });
  } catch (_e) {
    /* ignore */
  }

  // ============================ keydown matcher ==============================

  // Are we running inside Cobalt's own tab? If so, the in-app dispatcher
  // handles shortcuts — bail to guarantee exactly one tab opens per press.
  // We compare the TOP-frame origin (window.top), falling back to this frame's
  // origin when cross-origin access throws.
  function isCobaltOwnTab() {
    if (!ownOrigin) return false;
    let topOrigin;
    try {
      topOrigin = window.top.location.origin;
    } catch (_e) {
      // Cross-origin top frame: this content script's frame is therefore NOT
      // Cobalt's top document, so it's not the "own tab" we must skip.
      return false;
    }
    return topOrigin === ownOrigin;
  }

  window.addEventListener(
    'keydown',
    (e) => {
      if (e.defaultPrevented) return;
      if (isTypingTarget(e.target)) return; // never hijack typing
      if (isCobaltOwnTab()) return; // Cobalt tab: let the in-app dispatcher fire

      const combo = comboFromEvent(e);
      if (!combo) return;
      if (isReserved(combo)) return; // never try to reclaim browser/OS combos

      const hit = byCombo[combo];
      if (!hit || !hit.url) return;

      e.preventDefault();
      e.stopPropagation();
      try {
        chrome.runtime.sendMessage({ type: 'OPEN_URL', url: hit.url });
      } catch (_err) {
        // Extension context invalidated (e.g. just updated). Nothing we can do
        // from this stale content script; the next page load reinjects a fresh one.
      }
    },
    true // CAPTURE phase — see it before the page's own bubble-phase handlers
  );
})();
