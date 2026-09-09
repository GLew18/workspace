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
// Cobalt REPLACES Schoology, so requiring the student to go visit Schoology to
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
const SGY_TAB_ALARM = 'ws-sgy-tab-watchdog';

/** Tabs WE opened for syncing, closed on capture or by the watchdog. */
const sgySyncTabs = new Set();

// ---- THE SIGN-IN BACKOFF (Gabe, 8/20) --------------------------------------
//
// THE TAB STORM. A background sync opens a hidden schoology.com tab every 30
// minutes. If the student is not signed in, Schoology bounces that tab to Google
// SSO, and two things then go wrong at once:
//
//   1. The tab is no longer a *.schoology.com URL, so the next run's
//      tabs.query({url: 'https://*.schoology.com/*'}) cannot see it and opens
//      ANOTHER one. Every 30 minutes. Forever.
//   2. The watchdog that was supposed to close it is a setTimeout inside an MV3
//      service worker, and MV3 evicts that worker when it goes idle. The timer
//      dies with it. The old comment here claimed the watchdog "guarantees no tab
//      is ever orphaned"; it guaranteed the opposite.
//
// Result: dozens of Google sign-in tabs, which is what Gabe photographed.
//
// So: count the times a sync tab lands somewhere that is not Schoology, and after
// three in a row stop trying for a while. Signed out is a state only the student
// can fix, and retrying it on a timer cannot help. The counter and the cooldown
// live in chrome.storage.local rather than in memory, because the worker being
// evicted is the whole problem and a counter that resets on eviction would never
// reach three.
const SGY_FAIL_KEY = 'sgy:signinFails';
const SGY_COOLDOWN_KEY = 'sgy:signinCooldownUntil';
const SGY_MAX_FAILS = 3;
const SGY_COOLDOWN_MS = 6 * 60 * 60 * 1000; // six hours, i.e. roughly a school day

/** True when the URL is anything other than the Schoology host we asked for:
 *  Google SSO, an SAML hop, a Schoology login page. All mean "not signed in". */
function isSignedOutUrl(url, host) {
  if (!url) return false;
  if (/^https:\/\/accounts\.google\.com/i.test(url)) return true;
  if (/^https:\/\/login\.microsoftonline\.com/i.test(url)) return true;
  if (/\/login\b|\/sso\b|\/saml\b/i.test(url)) return true;
  return host ? url.indexOf('https://' + host) !== 0 : false;
}

/** One more strike. At three, stop opening tabs until the cooldown expires. */
function noteSigninFailure() {
  chrome.storage.local.get([SGY_FAIL_KEY], (cur) => {
    const fails = (((cur || {})[SGY_FAIL_KEY]) || 0) + 1;
    const patch = { [SGY_FAIL_KEY]: fails };
    if (fails >= SGY_MAX_FAILS) patch[SGY_COOLDOWN_KEY] = Date.now() + SGY_COOLDOWN_MS;
    chrome.storage.local.set(patch);
  });
}

/** A scrape came back, so the student is signed in. Forget the whole thing. */
function clearSigninFailures() {
  chrome.storage.local.remove([SGY_FAIL_KEY, SGY_COOLDOWN_KEY]);
}

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
    // Remembered in STORAGE, not just the Set: this worker can be evicted at any
    // moment, and a tab we have forgotten about is a tab nobody will ever close.
    chrome.storage.local.set({ 'sgy:openTab': { id: id, host: host, at: Date.now() } });
    // An ALARM, not a setTimeout. MV3 kills the worker when it idles and takes
    // every pending timer with it, which is precisely how these tabs survived to
    // pile up. Alarms wake the worker back up.
    try {
      chrome.alarms.create(SGY_TAB_ALARM, { when: Date.now() + SGY_TAB_WATCHDOG_MS });
    } catch (_e) {
      setTimeout(() => closeSyncTab(id), SGY_TAB_WATCHDOG_MS); // no alarms: best effort
    }
  });
}

/** Close whatever sync tab is on file, wherever it drifted to, and judge it. */
function reapSyncTab() {
  chrome.storage.local.get(['sgy:openTab'], (cur) => {
    const rec = (cur || {})['sgy:openTab'];
    if (!rec || typeof rec.id !== 'number') return;
    chrome.storage.local.remove(['sgy:openTab']);
    try {
      chrome.tabs.get(rec.id, (tab) => {
        if (chrome.runtime.lastError || !tab) return;
        // Still not on Schoology when the watchdog fired: it never got through.
        if (isSignedOutUrl(tab.url || '', rec.host)) noteSigninFailure();
        sgySyncTabs.add(rec.id);
        closeSyncTab(rec.id);
      });
    } catch (_e) {
      /* tab already gone */
    }
  });
}

/** Refresh labels without the student lifting a finger. */
function backgroundSgySync() {
  chrome.storage.local.get(['sgy:host', SGY_KEY, SGY_COOLDOWN_KEY], (cur) => {
    // Three strikes and we stop. Being signed out is not something a retry can
    // fix, and the student will hit Schoology themselves soon enough, which is
    // what clears this (see SGY_CAPTURE).
    const until = (cur && cur[SGY_COOLDOWN_KEY]) || 0;
    if (until && Date.now() < until) return;
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
  if (!a) return;
  if (a.name === SGY_ALARM) backgroundSgySync();
  // The watchdog. An alarm rather than a timer because it has to survive the
  // worker being evicted, which is exactly when an orphaned tab needs reaping.
  if (a.name === SGY_TAB_ALARM) reapSyncTab();
});

// A tab we opened has finished loading somewhere it should not be. Do not wait for
// the watchdog: close it now and count the strike, so three sign-in bounces cost
// the student three brief hidden tabs rather than one per half hour forever.
chrome.tabs.onUpdated.addListener((tabId, changeInfo, tab) => {
  if (changeInfo.status !== 'complete' || !sgySyncTabs.has(tabId)) return;
  chrome.storage.local.get(['sgy:openTab'], (cur) => {
    const rec = (cur || {})['sgy:openTab'];
    if (!rec || rec.id !== tabId) return;
    if (!isSignedOutUrl((tab && tab.url) || '', rec.host)) return;
    chrome.storage.local.remove(['sgy:openTab']);
    noteSigninFailure();
    closeSyncTab(tabId);
  });
});

// Cold start: reap anything a previous worker left behind before it was evicted.
// Without this the tabs from before an update or a browser restart live forever.
reapSyncTab();

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

  if (msg.type === 'SGY_GET') {
    handleSgyGet(sendResponse);
    return true; // async storage read
  }

  if (msg.type === 'SGY_REFRESH') {
    handleSgyRefresh(sendResponse);
    return true; // async: tab round-trip + storage read
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

  // A Schoology page just scraped its course labels (schoology.js). No response.
  if (msg.type === 'SGY_CAPTURE') {
    handleSgyCapture(msg.payload);
    // If this came from a tab WE opened for a background sync, its job is done —
    // close it immediately so the student never notices it existed. (The watchdog
    // is the backstop for a scrape that never reports.)
    const fromTab = _sender && _sender.tab && _sender.tab.id;
    if (typeof fromTab === 'number') closeSyncTab(fromTab);
    clearSigninFailures(); // a scrape came back, so the sign-in is fine again
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
