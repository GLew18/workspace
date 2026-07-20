// WorkSpace Shortcuts — background service worker (MV3).
//
// Holds NO in-memory source of truth: the MV3 SW is evicted after ~30s idle, so
// chrome.storage.local is authoritative. Every listener below is registered
// SYNCHRONOUSLY at top level so they re-bind the instant the worker wakes.
//
// Responsibilities:
//   • onMessageExternal — trusted-origin channel from the WorkSpace web app
//       (externally_connectable). Handles PING (install/version detection) and
//       SYNC_SHORTCUTS (authoritative full-replace of the shortcut config).
//   • onMessage — internal channel from our own content scripts. Handles
//       OPEN_URL (chrome.tabs.create) and PING relayed via the postMessage bridge.
//
// Protocol envelope (see the web app's shortcuts.ts):
//   App -> Ext : { source: "workspace",  v: 1, type: ... }
//   Ext -> App : { source: "workspace-ext", v: 1, type: ... }

const PROTOCOL_VERSION = 1;
const EXT_VERSION = chrome.runtime.getManifest().version;

// ---------------------------------------------------------------------------
// Config validation + storage write (shared by external + bridge-relayed sync)
// ---------------------------------------------------------------------------

/** Shallow-validate an incoming ShortcutConfig. Returns the cleaned config or null. */
function validateConfig(config) {
  if (!config || typeof config !== 'object') return null;
  if (config.version !== 1) return null;
  if (typeof config.origin !== 'string' || !config.origin) return null;
  if (typeof config.updatedAt !== 'number' || !isFinite(config.updatedAt)) return null;
  if (!Array.isArray(config.entries)) return null;

  const entries = [];
  for (const e of config.entries) {
    if (!e || typeof e !== 'object') continue;
    if (typeof e.combo !== 'string' || !e.combo) continue;
    if (typeof e.url !== 'string' || !e.url) continue;
    entries.push({
      id: typeof e.id === 'string' ? e.id : '',
      combo: e.combo,
      url: e.url,
      name: typeof e.name === 'string' ? e.name : '',
    });
  }
  return { version: 1, origin: config.origin, updatedAt: config.updatedAt, entries };
}

/** Derive the O(1) lookup map the content script matches against. */
function deriveByCombo(entries) {
  const byCombo = {};
  for (const e of entries) {
    // Last-writer-wins on duplicate combos (the app already guarantees uniqueness).
    byCombo[e.combo] = { url: e.url, id: e.id, name: e.name };
  }
  return byCombo;
}

/**
 * Validate + persist a SYNC_SHORTCUTS config. Drops the message if its updatedAt
 * is older than (or equal to) what we already stored (stale / out-of-order).
 * Calls sendAck(ackObject) with the SYNC_ACK payload.
 */
function handleSync(config, sendAck) {
  const clean = validateConfig(config);
  if (!clean) {
    sendAck({ source: 'workspace-ext', v: PROTOCOL_VERSION, type: 'SYNC_ACK', ok: false, count: 0, updatedAt: 0 });
    return;
  }
  chrome.storage.local.get('wsConfig', (cur) => {
    const prev = cur && cur.wsConfig;
    if (prev && typeof prev.updatedAt === 'number' && prev.updatedAt > clean.updatedAt) {
      // Stale message — keep the newer stored config, but still ACK truthfully.
      sendAck({
        source: 'workspace-ext',
        v: PROTOCOL_VERSION,
        type: 'SYNC_ACK',
        ok: true,
        count: Array.isArray(prev.entries) ? prev.entries.length : 0,
        updatedAt: prev.updatedAt,
      });
      return;
    }
    const byCombo = deriveByCombo(clean.entries);
    chrome.storage.local.set(
      { wsConfig: clean, shortcutsByCombo: byCombo, syncedAt: Date.now() },
      () => {
        sendAck({
          source: 'workspace-ext',
          v: PROTOCOL_VERSION,
          type: 'SYNC_ACK',
          ok: !chrome.runtime.lastError,
          count: clean.entries.length,
          updatedAt: clean.updatedAt,
        });
      }
    );
  });
}

function pongPayload() {
  return {
    source: 'workspace-ext',
    v: PROTOCOL_VERSION,
    type: 'PONG',
    extVersion: EXT_VERSION,
    protocol: PROTOCOL_VERSION,
  };
}

// ---------------------------------------------------------------------------
// External channel: WorkSpace web app -> SW (externally_connectable)
// ---------------------------------------------------------------------------
chrome.runtime.onMessageExternal.addListener((msg, _sender, sendResponse) => {
  // Defense in depth on top of externally_connectable's origin allowlist.
  if (!msg || msg.source !== 'workspace') return; // ignore; channel stays default-closed

  if (msg.type === 'PING') {
    // Respond SYNCHRONOUSLY (do not return true) — keeps detection snappy & cold-start safe.
    sendResponse(pongPayload());
    return;
  }

  if (msg.type === 'SYNC_SHORTCUTS') {
    handleSync(msg.config, sendResponse);
    return true; // keep the channel open for the async storage write
  }

  // Unknown external message — ignore.
});

// ---------------------------------------------------------------------------
// Internal channel: our own content scripts (content.js / bridge.js) -> SW
// ---------------------------------------------------------------------------
chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  if (!msg || typeof msg !== 'object') return;

  // Content-script keydown match asks us to open a URL.
  if (msg.type === 'OPEN_URL') {
    if (typeof msg.url === 'string' && msg.url) {
      chrome.tabs.create({ url: msg.url, active: true });
    }
    return; // no response
  }

  // The postMessage bridge relays app messages here when externally_connectable
  // is unavailable (dev / non-Chrome). Same handlers, internal transport.
  if (msg.source === 'workspace') {
    if (msg.type === 'PING') {
      sendResponse(pongPayload());
      return;
    }
    if (msg.type === 'SYNC_SHORTCUTS') {
      handleSync(msg.config, sendResponse);
      return true;
    }
  }
});

// ---------------------------------------------------------------------------
// Inject the content script into ALREADY-OPEN tabs on install / browser start.
// Manifest content_scripts only auto-inject into tabs navigated AFTER the
// extension loads, so without this a freshly-installed (or just-reloaded)
// extension does nothing in the user's existing tabs until each is manually
// reloaded — the #1 "I installed it but my shortcut doesn't work" cause.
// content.js is idempotent (see its __wsShortcutsLoaded guard), so re-injecting
// a tab that already has it is a harmless no-op.
// ---------------------------------------------------------------------------
function injectContentScript(tabId, url) {
  if (typeof tabId !== 'number') return;
  // Only http(s) pages accept content scripts (not chrome://, the Web Store,
  // the New Tab Page, view-source:, etc.).
  if (!/^https?:\/\//i.test(url || '')) return;
  chrome.scripting.executeScript(
    { target: { tabId, allFrames: true }, files: ['content.js'] },
    () => {
      void chrome.runtime.lastError; // some tabs still refuse; ignore quietly
    }
  );
}

function injectIntoOpenTabs() {
  chrome.tabs.query({}, (tabs) => {
    if (chrome.runtime.lastError || !tabs) return;
    for (const tab of tabs) injectContentScript(tab.id, tab.url || '');
  });
}
chrome.runtime.onInstalled.addListener(injectIntoOpenTabs);
chrome.runtime.onStartup.addListener(injectIntoOpenTabs);

// Self-heal: any tab that finishes loading — including one that was discarded and
// is being restored, or was open BEFORE the extension (re)loaded and is now
// navigating — gets the matcher injected the moment it completes. content.js is
// idempotent (its __wsShortcutsLoaded guard), so this never double-binds a tab the
// manifest content_scripts entry already covered.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete') return;
  injectContentScript(tabId, (tab && tab.url) || '');
});

// Re-seed every already-open tab whenever this service worker COLD-STARTS — first
// install, browser start, the dev "Reload ↻" button, or a wake from MV3 idle
// eviction. onInstalled/onStartup don't fire on every reload, and a freshly
// reloaded extension orphans the content scripts already running in open tabs.
// This is the fix for the #1 "I installed it but my already-open tabs do nothing"
// case, so the user no longer has to manually refresh each tab. Idempotent, so
// re-runs on later wakes are harmless no-ops.
injectIntoOpenTabs();
