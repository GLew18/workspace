// WorkSpace Premium — options page logic.
//
// Read-only dashboard: reflects the authoritative state in chrome.storage.local
// (written by the background SW on every SYNC_SHORTCUTS) and shows whether the
// app has ever synced. Stays live via chrome.storage.onChanged.

const dot = document.getElementById('dot');
const statusText = document.getElementById('statusText');
const statusMeta = document.getElementById('statusMeta');
const table = document.getElementById('table');
const rows = document.getElementById('rows');
const empty = document.getElementById('empty');
const refreshBtn = document.getElementById('refresh');

const EXT_VERSION = chrome.runtime.getManifest().version;

/** Display-only prettifier: on mac, swap modifier words for their glyphs. */
const IS_MAC = navigator.platform.toUpperCase().indexOf('MAC') >= 0;
function prettyCombo(combo) {
  if (!IS_MAC) return combo;
  return combo
    .split('+')
    .map((p) => {
      if (p === 'Ctrl') return '⌃';
      if (p === 'Alt') return '⌥';
      if (p === 'Meta') return '⌘';
      if (p === 'Shift') return '⇧';
      return p;
    })
    .join('');
}

function fmtTime(ms) {
  if (!ms || typeof ms !== 'number') return 'never';
  try {
    return new Date(ms).toLocaleString();
  } catch (_e) {
    return String(ms);
  }
}

function safeHost(url) {
  try {
    return new URL(url).hostname.replace(/^www\./, '');
  } catch (_e) {
    return url;
  }
}

function render(items) {
  const config = items.wsConfig || null;
  const byCombo = items.shortcutsByCombo || {};
  const syncedAt = items.syncedAt || 0;

  // ---- connection status ----
  if (config && Array.isArray(config.entries)) {
    dot.className = 'dot ok';
    statusText.textContent = 'Connected to WorkSpace';
    statusMeta.innerHTML =
      'Origin: <b>' +
      escapeHtml(config.origin || '—') +
      '</b><br>Last sync: <b>' +
      escapeHtml(fmtTime(syncedAt)) +
      '</b> · Extension v' +
      escapeHtml(EXT_VERSION);
  } else {
    dot.className = 'dot warn';
    statusText.textContent = 'Waiting for first sync';
    statusMeta.innerHTML =
      'Open the WorkSpace web app and add a keyboard shortcut on the Links tab to connect. Extension v' +
      escapeHtml(EXT_VERSION);
  }

  // ---- shortcut table ----
  const entries = (config && Array.isArray(config.entries) ? config.entries : []).slice();
  // Keep only entries that survived into the matcher map (the source of truth for firing).
  const live = entries.filter((e) => e && byCombo[e.combo]);
  live.sort((a, b) => (a.name || '').localeCompare(b.name || ''));

  rows.replaceChildren();
  if (live.length === 0) {
    table.hidden = true;
    empty.hidden = false;
    empty.textContent = config ? 'No shortcuts set in WorkSpace yet.' : 'No shortcuts synced yet.';
    return;
  }
  table.hidden = false;
  empty.hidden = true;

  for (const e of live) {
    const tr = document.createElement('tr');

    const tdKey = document.createElement('td');
    const kbd = document.createElement('span');
    kbd.className = 'kbd';
    kbd.textContent = prettyCombo(e.combo);
    kbd.title = e.combo;
    tdKey.appendChild(kbd);

    const tdLink = document.createElement('td');
    const name = document.createElement('div');
    name.className = 'bm-name';
    name.textContent = e.name || safeHost(e.url);
    const urlDiv = document.createElement('div');
    urlDiv.className = 'bm-url';
    const a = document.createElement('a');
    a.href = e.url;
    a.target = '_blank';
    a.rel = 'noopener noreferrer';
    a.textContent = e.url;
    urlDiv.appendChild(a);
    tdLink.appendChild(name);
    tdLink.appendChild(urlDiv);

    tr.appendChild(tdKey);
    tr.appendChild(tdLink);
    rows.appendChild(tr);
  }
}

function escapeHtml(s) {
  return String(s).replace(/[&<>"']/g, (c) => {
    return { '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c];
  });
}

function load() {
  chrome.storage.local.get(['wsConfig', 'shortcutsByCombo', 'syncedAt'], (items) => {
    if (chrome.runtime.lastError) {
      dot.className = 'dot';
      statusText.textContent = 'Storage unavailable';
      statusMeta.textContent = '';
      return;
    }
    render(items || {});
  });
}

refreshBtn.addEventListener('click', load);

chrome.storage.onChanged.addListener((changes, area) => {
  if (area !== 'local') return;
  if (changes.wsConfig || changes.shortcutsByCombo || changes.syncedAt) load();
});

load();
