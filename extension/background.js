// Cobalt Premium: background service worker (MV3).
//
// Holds NO in-memory source of truth: the MV3 SW is evicted after ~30s idle, so
// chrome.storage.local is authoritative. Every listener below is registered
// SYNCHRONOUSLY at top level so they re-bind the instant the worker wakes.
//
// Responsibilities:
//   • onMessageExternal: trusted-origin channel from the Cobalt web app
//       (externally_connectable). Handles PING (install/version detection) and
//       SYNC_SHORTCUTS (authoritative full-replace of the shortcut config).
//       Also OPEN_GROUP / OPEN_TABS / OPEN_WINDOW (open bookmark links as a
//       named tab group, tabs, or a new window).
//   • onMessage — internal channel from our own content scripts. Handles
//       OPEN_URL (chrome.tabs.create) and the same app messages relayed via the
//       postMessage bridge.
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

// ---------------------------------------------------------------------------
// One-time cleanup: earlier versions kept Schoology scrape data, a background
// sync and two alarms. Schoology now connects only through OAuth in the web app,
// so on install/update remove whatever those versions left behind.
// ---------------------------------------------------------------------------
chrome.runtime.onInstalled.addListener(() => {
  chrome.storage.local.remove([
    'sgy:data',
    'sgy:host',
    'sgy:signinFails',
    'sgy:signinCooldownUntil',
    'sgy:openTab',
  ]);
  // The "alarms" permission is gone, so chrome.alarms may be undefined.
  if (chrome.alarms && chrome.alarms.clear) {
    chrome.alarms.clear('ws-sgy-sync');
    chrome.alarms.clear('ws-sgy-tab-watchdog');
  }
});

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
// OPEN_GROUP — open a set of links as a NAMED, COLORED Chrome tab group.
//
// The premium payoff for bookmark groups and task attachments: instead of N loose
// tabs, the browser shows one labelled bundle ("Chem Lab", purple) the student can
// collapse or close in a single click. Only the extension can do this — the web
// app has no access to chrome.tabs / chrome.tabGroups.
//
// The app sends an already-validated Chrome color name; anything else falls back
// to grey rather than throwing. URL and count limits are enforced HERE too (the
// SW never trusts the page): http(s) only, and a hard cap so a corrupt payload
// can't spawn hundreds of tabs.
// ---------------------------------------------------------------------------
const GROUP_COLORS = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
const MAX_GROUP_TABS = 25;

// Open urls as PLAIN background tabs, no group. Exists because the page's
// window.open hits Chrome's popup blocker (ONE popup per click), so "Open all"
// from Cobalt could only ever open the first link. chrome.tabs.create has no
// such limit. Same URL hygiene and window pinning as handleOpenGroup.
async function handleOpenTabs(payload, sendAck) {
  const ack = (ok, count) => sendAck({ source: 'workspace-ext', v: PROTOCOL_VERSION, type: 'OPEN_TABS_ACK', ok, count });
  const p = payload && typeof payload === 'object' ? payload : {};
  const urls = (Array.isArray(p.urls) ? p.urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_GROUP_TABS);
  if (!urls.length) {
    ack(false, 0);
    return;
  }
  try {
    // Pin every tab to the CURRENT window (a service worker has no window of its
    // own; without this, tabs can land wherever Chrome last had focus).
    let windowId;
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win && typeof win.id === 'number') windowId = win.id;
    } catch (_e) {
      /* no focused window: let Chrome choose */
    }
    let count = 0;
    for (const url of urls) {
      const tab = await chrome.tabs.create(windowId ? { url, active: false, windowId } : { url, active: false });
      if (typeof tab.id === 'number') count++;
    }
    ack(count > 0, count);
  } catch (e) {
    console.error('[Cobalt] open tabs failed:', e);
    ack(false, 0);
  }
}

// ---------------------------------------------------------------------------
// OPEN_WINDOW — open a set of links as ONE new browser window, one tab per link.
//
// Gabe, 9/8/26, correcting the OPEN_TABS-based "windows" button shipped the
// night before: "That button should create a new Chrome window that has all
// of the attachments or links as separate tabs. It's not that the links or
// attachments are windows themselves, that they compose one Chrome window."
// The page side cannot do this itself: window.open only ever gets ONE popup
// per click, and a page can never add further tabs to a window it already
// opened. chrome.windows.create CAN, by taking an array of urls — it opens
// exactly one window with one tab per url. Same URL hygiene and cap as
// OPEN_GROUP/OPEN_TABS above.
// ---------------------------------------------------------------------------
async function handleOpenWindow(payload, sendAck) {
  const ack = (ok, count) => sendAck({ source: 'workspace-ext', v: PROTOCOL_VERSION, type: 'OPEN_WINDOW_ACK', ok, count });
  const p = payload && typeof payload === 'object' ? payload : {};
  const urls = (Array.isArray(p.urls) ? p.urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_GROUP_TABS);
  if (!urls.length) {
    ack(false, 0);
    return;
  }
  try {
    const win = await chrome.windows.create({ url: urls, focused: true });
    const count = win && Array.isArray(win.tabs) ? win.tabs.length : urls.length;
    ack(true, count);
  } catch (e) {
    console.error('[Cobalt] open window failed:', e && e.message ? e.message : e);
    ack(false, 0);
  }
}

async function handleOpenGroup(payload, sendAck) {
  const ack = (ok, count) => sendAck({ source: 'workspace-ext', v: PROTOCOL_VERSION, type: 'OPEN_GROUP_ACK', ok, count });
  const p = payload && typeof payload === 'object' ? payload : {};
  const urls = (Array.isArray(p.urls) ? p.urls : [])
    .filter((u) => typeof u === 'string' && /^https?:\/\//i.test(u))
    .slice(0, MAX_GROUP_TABS);
  if (!urls.length) {
    ack(false, 0);
    return;
  }
  // Chrome truncates long group titles to a chip anyway; keep it sane.
  const title = (typeof p.name === 'string' ? p.name : '').trim().slice(0, 60);
  const color = GROUP_COLORS.includes(p.color) ? p.color : 'grey';

  // Fail LOUDLY in the service worker console (chrome://extensions → "service
  // worker"), because from the page side a failure is indistinguishable from the
  // extension not being installed at all.
  if (!chrome.tabGroups || !chrome.tabs.group) {
    console.error('[Cobalt] tab grouping unavailable. The extension needs a RELOAD after the manifest gained the "tabGroups" permission (chrome://extensions → Reload).');
    ack(false, 0);
    return;
  }

  try {
    // Open every tab in the background first, then bundle them. Grouping after
    // creation (rather than per-tab) means Chrome draws the group once, so the
    // strip doesn't visibly reshuffle as each tab lands.
    //
    // windowId is pinned to the CURRENT window: a service worker has no window of
    // its own, so without this each tabs.create can land wherever Chrome last had
    // focus, and tabs.group then refuses a set that spans two windows.
    let windowId;
    try {
      const win = await chrome.windows.getLastFocused({ windowTypes: ['normal'] });
      if (win && typeof win.id === 'number') windowId = win.id;
    } catch (_e) {
      /* no focused window: let Chrome choose */
    }

    const ids = [];
    for (const url of urls) {
      const tab = await chrome.tabs.create(windowId ? { url, active: false, windowId } : { url, active: false });
      if (typeof tab.id === 'number') ids.push(tab.id);
    }
    if (!ids.length) {
      console.error('[Cobalt] no tabs were created for', title);
      ack(false, 0);
      return;
    }
    const groupId = await chrome.tabs.group({ tabIds: ids });
    await chrome.tabGroups.update(groupId, { title, color });
    await chrome.tabs.update(ids[0], { active: true }); // land the user on the first link
    console.info('[Cobalt] grouped', ids.length, 'tabs as', JSON.stringify(title), color);
    ack(true, ids.length);
  } catch (e) {
    console.error('[Cobalt] tab grouping failed:', e && e.message ? e.message : e);
    ack(false, 0);
  }
}

// ---------------------------------------------------------------------------
// External channel: Cobalt web app -> SW (externally_connectable)
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

  if (msg.type === 'OPEN_GROUP') {
    handleOpenGroup(msg.payload, sendResponse);
    return true; // async: one tabs.create per link, then group + colorize
  }

  if (msg.type === 'OPEN_TABS') {
    handleOpenTabs(msg.payload, sendResponse);
    return true; // async: one tabs.create per link
  }

  if (msg.type === 'OPEN_WINDOW') {
    handleOpenWindow(msg.payload, sendResponse);
    return true; // async: one windows.create with every url
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
    if (msg.type === 'OPEN_GROUP') {
      handleOpenGroup(msg.payload, sendResponse);
      return true;
    }
    if (msg.type === 'OPEN_TABS') {
      handleOpenTabs(msg.payload, sendResponse);
      return true;
    }
    if (msg.type === 'OPEN_WINDOW') {
      handleOpenWindow(msg.payload, sendResponse);
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
// The Cobalt origins that get bridge.js. KEEP IN LOCK-STEP with
// manifest.json content_scripts[1].matches and externally_connectable.matches.
const COBALT_ORIGIN_RE =
  /^(https:\/\/(www\.)?cobaltstudy\.com|https:\/\/workspace-67029\.(web\.app|firebaseapp\.com)|http:\/\/(localhost|127\.0\.0\.1):5173)(\/|$)/i;

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
  // Same reasoning for the postMessage bridge, and it matters MORE than it does
  // for content.js (Gabe, 9/9/26). bridge.js is what stamps <html
  // data-cobalt-ext> and relays the app's requests, so a Cobalt tab that was
  // already open when the extension loaded or reloaded looks, to the app, like
  // the extension is not installed at all: the premium buttons toast "install
  // the extension" while the global shortcuts keep working, because those ride
  // content.js instead. Top frame only, matching the manifest entry and
  // bridge.js's own top-frame guard; its __wsBridgeLoaded guard makes a double
  // injection a no-op.
  if (COBALT_ORIGIN_RE.test(url || '')) {
    chrome.scripting.executeScript(
      { target: { tabId, allFrames: false }, files: ['bridge.js'] },
      () => {
        void chrome.runtime.lastError;
      }
    );
  }
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
