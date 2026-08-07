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

// ---------------------------------------------------------------------------
// Schoology course labels (see schoology.js).
//
// The content script scrapes the student's OWN logged-in Schoology pages for the
// one thing the iCal feed lacks: which course each assignment belongs to. We hold
// the latest scrape here in chrome.storage.local ('sgy:data') and hand it to the
// web app on request; the app then persists it to the cloud, which is what lets a
// PHONE (where extensions cannot run) show the same true course names.
//
// Storage is MERGED, never replaced: any single page only reveals a slice of the
// picture (the calendar shows this month, a course page shows that course), so
// clobbering on each scrape would make labels flicker in and out.
// ---------------------------------------------------------------------------
const SGY_KEY = 'sgy:data';

/** Union of the stored payload and a fresh one; newer values win per field. */
function sgyMerge(prev, next) {
  if (!prev || typeof prev !== 'object') return next;
  const courses = new Map();
  for (const c of Array.isArray(prev.courses) ? prev.courses : []) if (c && c.id) courses.set(c.id, c);
  for (const c of Array.isArray(next.courses) ? next.courses : []) if (c && c.id) courses.set(c.id, c);
  return {
    host: next.host || prev.host || '',
    // Keep a previously-found feed URL when this scrape happened not to see it.
    icalUrl: next.icalUrl || prev.icalUrl || undefined,
    courses: [...courses.values()],
    labels: Object.assign({}, prev.labels, next.labels),
    scrapedAt: next.scrapedAt || Date.now(),
    diag: next.diag || prev.diag,
  };
}

/** Shape-check a payload from a content script before it reaches storage. */
function validSgyPayload(p) {
  return !!p && typeof p === 'object' && typeof p.host === 'string' && !!p.labels && typeof p.labels === 'object';
}

function handleSgyCapture(payload) {
  if (!validSgyPayload(payload)) return;
  chrome.storage.local.get(SGY_KEY, (cur) => {
    const merged = sgyMerge(cur && cur[SGY_KEY], payload);
    // Remember the school's host: it is the ONLY way a later background sync knows
    // which subdomain to visit (schools are <school>.schoology.com).
    chrome.storage.local.set({ [SGY_KEY]: merged, 'sgy:host': merged.host || '' });
  });
}

// ---------------------------------------------------------------------------
// Background sync — the point of the whole feature.
//
// WorkSpace REPLACES Schoology, so requiring the student to go visit Schoology to
// keep course names accurate would defeat the product. Instead: every 30 minutes,
// if no Schoology tab happens to be open, open one INVISIBLY (a background tab the
// student never sees), let the content script scrape, and close it again. Typical
// life of that tab is a few seconds.
//
// Two things make this safe rather than creepy: it only ever visits the student's
// own school host (learned from a previous scrape — never guessed), and it does
// nothing at all until they have connected Schoology once.
// ---------------------------------------------------------------------------
const SGY_ALARM = 'ws-sgy-sync';
const SGY_SYNC_MINUTES = 30;
const SGY_TAB_WATCHDOG_MS = 45000; // force-close if the scrape never reports back

/** Tabs WE opened for syncing → closed on capture, or by the watchdog. MV3 evicts
 *  this worker, so the watchdog is what guarantees no tab is ever orphaned. */
const sgySyncTabs = new Set();

function closeSyncTab(tabId) {
  if (!sgySyncTabs.has(tabId)) return;
  sgySyncTabs.delete(tabId);
  try {
    chrome.tabs.remove(tabId, () => void chrome.runtime.lastError);
  } catch (_e) {
    /* already gone */
  }
}

function openSyncTab(host) {
  chrome.tabs.create({ url: 'https://' + host + '/home', active: false }, (tab) => {
    if (chrome.runtime.lastError || !tab || typeof tab.id !== 'number') return;
    const id = tab.id;
    sgySyncTabs.add(id);
    setTimeout(() => closeSyncTab(id), SGY_TAB_WATCHDOG_MS);
  });
}

/** Refresh labels without the student lifting a finger. */
function backgroundSgySync() {
  chrome.storage.local.get(['sgy:host', SGY_KEY], (cur) => {
    const host = (cur && cur['sgy:host']) || (cur && cur[SGY_KEY] && cur[SGY_KEY].host) || '';
    // Never connected yet → nothing to sync and no host we could legitimately
    // guess. The first scrape always comes from the student's own visit.
    if (!host || !/^[\w.-]+\.schoology\.com$/i.test(host)) return;
    chrome.tabs.query({ url: 'https://*.schoology.com/*' }, (tabs) => {
      const open = (Array.isArray(tabs) ? tabs : []).filter((t) => typeof t.id === 'number');
      if (open.length) {
        // Already there — reuse it and stay invisible.
        const t = open.find((x) => x.active) || open[0];
        try {
          chrome.tabs.sendMessage(t.id, { type: 'SGY_SCRAPE_NOW' }, () => void chrome.runtime.lastError);
        } catch (_e) {
          /* content script not injected yet; the alarm retries in 30 min */
        }
        return;
      }
      openSyncTab(host);
    });
  });
}

function ensureSgyAlarm() {
  try {
    chrome.alarms.create(SGY_ALARM, { periodInMinutes: SGY_SYNC_MINUTES, delayInMinutes: 1 });
  } catch (_e) {
    /* alarms unavailable — page-visit scraping still works */
  }
}
chrome.runtime.onInstalled.addListener(ensureSgyAlarm);
chrome.runtime.onStartup.addListener(ensureSgyAlarm);
ensureSgyAlarm(); // also on cold start, since onInstalled/onStartup don't always fire
chrome.alarms.onAlarm.addListener((a) => {
  if (a && a.name === SGY_ALARM) backgroundSgySync();
});

function sgyDataReply(payload, extra) {
  return Object.assign(
    { source: 'workspace-ext', v: PROTOCOL_VERSION, type: 'SGY_DATA', payload: payload || null },
    extra || {}
  );
}

function handleSgyGet(sendResponse) {
  chrome.storage.local.get(SGY_KEY, (cur) => {
    sendResponse(sgyDataReply(cur && cur[SGY_KEY]));
  });
}

/**
 * Ask ONE open Schoology tab to re-scrape, WAIT for it to finish, then answer with
 * the merged storage.
 *
 * Two things this must not do. (1) Fan out to every Schoology tab: a student with
 * five tabs open would fire five concurrent scrapes — ~75 credentialed requests in
 * a burst, which is what a bot looks like. One tab produces the same data, since
 * the scrape fetches its own pages regardless of which tab runs it. (2) Reply on a
 * fixed timer: a real scrape takes ~5-10s (a dozen spaced fetches), so answering
 * at 2.5s returned PRE-refresh data every time and made "Refresh" look broken. The
 * content script deliberately holds the channel open until the scrape settles, so
 * we settle on its callback instead, capped below the app's own timeout.
 */
const SGY_SCRAPE_WAIT_MS = 12000; // must stay under the app's REFRESH timeout
const SGY_SETTLE_MS = 350; // let the tab's SGY_CAPTURE merge land before we read

function handleSgyRefresh(sendResponse) {
  chrome.tabs.query({ url: 'https://*.schoology.com/*' }, (tabs) => {
    const list = (Array.isArray(tabs) ? tabs : []).filter((t) => typeof t.id === 'number');
    const finish = (refreshed) => {
      chrome.storage.local.get(SGY_KEY, (cur) => {
        sendResponse(sgyDataReply(cur && cur[SGY_KEY], { refreshed, tabs: list.length }));
      });
    };
    if (!list.length) {
      finish(false); // nothing to refresh — hand back the last known data immediately
      return;
    }
    // Prefer an active tab; the scrape runs the same either way.
    const target = list.find((t) => t.active) || list[0];
    let settled = false;
    const done = (refreshed) => {
      if (settled) return;
      settled = true;
      setTimeout(() => finish(refreshed), SGY_SETTLE_MS);
    };
    const timer = setTimeout(() => done(false), SGY_SCRAPE_WAIT_MS);
    try {
      chrome.tabs.sendMessage(target.id, { type: 'SGY_SCRAPE_NOW' }, (reply) => {
        clearTimeout(timer);
        // lastError = the content script isn't in that tab yet (installed while the
        // tab was already open). Report refreshed:false so the app can say so.
        done(!chrome.runtime.lastError && !!reply);
      });
    } catch (_e) {
      clearTimeout(timer);
      done(false);
    }
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

  if (msg.type === 'SGY_GET') {
    handleSgyGet(sendResponse);
    return true; // async storage read
  }

  if (msg.type === 'SGY_REFRESH') {
    handleSgyRefresh(sendResponse);
    return true; // async: tab round-trip + storage read
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

  // A Schoology page just scraped its course labels (schoology.js). No response.
  if (msg.type === 'SGY_CAPTURE') {
    handleSgyCapture(msg.payload);
    // If this came from a tab WE opened for a background sync, its job is done —
    // close it immediately so the student never notices it existed. (The watchdog
    // is the backstop for a scrape that never reports.)
    const fromTab = _sender && _sender.tab && _sender.tab.id;
    if (typeof fromTab === 'number') closeSyncTab(fromTab);
    return;
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
    if (msg.type === 'SGY_GET') {
      handleSgyGet(sendResponse);
      return true;
    }
    if (msg.type === 'SGY_REFRESH') {
      handleSgyRefresh(sendResponse);
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
  // Same reasoning for the Schoology scraper: the manifest entry only fires on
  // navigations AFTER the extension loads, so a Schoology tab that was already
  // open at install time would have no scraper — and a "Refresh" from the app
  // would silently find nothing to talk to. Top frame only, matching the manifest
  // entry and schoology.js's own top-frame guard; its __wsSgyLoaded guard makes a
  // double injection a no-op.
  if (/^https:\/\/[^/]*\.schoology\.com\//i.test(url || '')) {
    chrome.scripting.executeScript(
      { target: { tabId, allFrames: false }, files: ['schoology.js'] },
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
