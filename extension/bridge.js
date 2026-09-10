// Cobalt Premium: postMessage bridge content script.
//
// Injected ONLY on the Cobalt origin(s) + localhost (see manifest
// content_scripts[1].matches). It is the dev + cross-browser-portable fallback
// for externally_connectable, which (a) requires an EXACT origin match — no
// wildcard TLD — and is unreliable for http://localhost:5173, and (b) does not
// exist at all in Firefox/Safari.
//
// What it does:
//   1. At document_start, SYNCHRONOUSLY stamps the extension's version onto
//      <html data-cobalt-ext="1.1.0">. This is the instant, race-free install
//      signal: the page can read it the moment its own script runs, with no
//      message round trip and no timeout. Added 9/9/26 because the old
//      announce-plus-ping handshake made "you need the extension" toasts wait
//      out a 1.5s deadline before appearing.
//   2. On load, posts an ANNOUNCE to the page carrying this extension's id +
//      version, so the web app can detect install AND learn EXTENSION_ID without
//      it being hardcoded (the localhost/dev case).
//   3. Relays window.postMessage({ source: "workspace", ... }) from the page to
//      the background SW via chrome.runtime.sendMessage, and posts the SW's
//      reply back to the page (tagged source:"workspace-ext", echoing reqId).
//
// Envelope:
//   page -> ext : { source:"workspace", v:1, type:..., reqId?:string }
//   ext -> page : { source:"workspace-ext", v:1, type:..., reqId?:string }

(() => {
  'use strict';

  const PROTOCOL_VERSION = 1;

  // Only the top document needs the bridge; the app runs there.
  if (window.top !== window) return;

  // Idempotency, same pattern as content.js's __wsShortcutsLoaded. background.js
  // also injects this file programmatically into already-open Cobalt tabs, so
  // without this guard a tab could end up with two relay listeners and every
  // "open all" request would reach the service worker twice.
  if (globalThis.__wsBridgeLoaded) return;
  globalThis.__wsBridgeLoaded = true;

  function extVersion() {
    try {
      return chrome.runtime.getManifest().version;
    } catch (_e) {
      return ''; // context already invalidated
    }
  }

  // --- 0. Stamp the DOM so the page can detect us with zero latency. ---
  // document_start guarantees <html> exists, and a content script shares the
  // page's DOM even though it has its own JS world. The page reads
  // document.documentElement.dataset.cobaltExt and knows instantly.
  function markPresence() {
    const v = extVersion();
    if (!v) return;
    try {
      document.documentElement.dataset.cobaltExt = v;
    } catch (_e) {
      /* no documentElement yet: the readystatechange retry below covers it */
    }
  }
  markPresence();
  if (document.readyState === 'loading') {
    document.addEventListener('readystatechange', markPresence, { once: true });
    document.addEventListener('DOMContentLoaded', markPresence, { once: true });
  }

  // --- 1. Announce presence so the app learns install state + EXTENSION_ID. ---
  function announce() {
    const version = extVersion();
    if (!version) return;
    window.postMessage(
      {
        source: 'workspace-ext',
        v: PROTOCOL_VERSION,
        type: 'ANNOUNCE',
        extId: chrome.runtime.id,
        extVersion: version,
        protocol: PROTOCOL_VERSION,
      },
      window.location.origin
    );
  }
  announce();
  // Re-announce once after the SPA has had a moment to register its listener.
  if (document.readyState === 'loading') {
    document.addEventListener('DOMContentLoaded', announce, { once: true });
  }

  // --- 2. Relay page -> SW, and SW reply -> page. ---
  window.addEventListener('message', (event) => {
    // Only accept messages from THIS window on THIS origin (no cross-origin).
    if (event.source !== window) return;
    const msg = event.data;
    if (!msg || typeof msg !== 'object' || msg.source !== 'workspace') return;

    const reqId = typeof msg.reqId === 'string' ? msg.reqId : undefined;

    // Forward to the background SW. We strip nothing — background re-checks
    // msg.source === "workspace" as defense in depth.
    let sent;
    try {
      sent = chrome.runtime.sendMessage(msg, (reply) => {
        if (chrome.runtime.lastError) {
          // SW unreachable (shouldn't happen for an installed ext). Post a typed
          // error so a pending app-side promise can reject/resolve-false.
          window.postMessage(
            {
              source: 'workspace-ext',
              v: PROTOCOL_VERSION,
              type: 'ERROR',
              reqId,
              error: chrome.runtime.lastError.message || 'unreachable',
            },
            window.location.origin
          );
          return;
        }
        if (reply && typeof reply === 'object') {
          const out = Object.assign({}, reply);
          if (reqId) out.reqId = reqId;
          window.postMessage(out, window.location.origin);
        }
      });
    } catch (_e) {
      // chrome.runtime gone (extension updated/removed). Silently drop; the app
      // will fall back to its PING timeout and treat the ext as absent.
      return;
    }
    void sent;
  });
})();
