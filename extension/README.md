# WorkSpace Premium (companion extension)

A small MV3 Chrome/Edge extension that makes the keyboard shortcuts you set on
the **Links** tab of the WorkSpace web app fire from **any tab in the browser**,
not just while the WorkSpace tab is focused.

The web app stays the single place you manage shortcuts. This extension just
receives the list over a trusted-origin message channel, stores it, and runs one
generic keydown matcher on every page. There is nothing to configure inside the
extension and no "refresh" to click — changes you make in WorkSpace propagate
live.

---

## How it works (architecture)

```
WorkSpace web app  ──(externally_connectable / postMessage bridge)──▶  background.js (SW)
                                                                          │  writes
                                                                          ▼
                                                                 chrome.storage.local   ◀── source of truth
                                                                          │  storage.onChanged
                                                                          ▼
                          every page's content.js  ──(keydown match)──▶  background.js ──▶ chrome.tabs.create
```

- **`manifest.json`** — MV3. Permissions: `storage`, `tabs`, `scripting` (the
  last is used by `background.js` to inject `content.js` into already-open tabs).
  `host_permissions: ["<all_urls>"]`. `externally_connectable.matches` lists the
  exact WorkSpace origins allowed to message the service worker.
- **`background.js`** — the service worker. Registers all listeners synchronously
  at top level (MV3 evicts idle workers after ~30s, so they must re-bind on
  wake). Handles `PING` → `PONG` (install/version detection) and
  `SYNC_SHORTCUTS` → validates the config, drops stale messages, and writes
  `{ wsConfig, shortcutsByCombo, syncedAt }` to `chrome.storage.local`. Opens
  matched URLs with `chrome.tabs.create` (avoids popup-blockers / sandbox / CSP
  issues that `window.open` from a content script hits).
- **`content.js`** — runs at `document_start` on `<all_urls>`, all frames. Reads
  `shortcutsByCombo` straight from `chrome.storage.local` (so matching is
  synchronous and works even when the worker is asleep) and stays live via
  `chrome.storage.onChanged`. On a matching `keydown` it `preventDefault`s and
  asks the worker to open the URL. It **ignores** typing targets and **ignores**
  WorkSpace's own tab (the web app's in-app dispatcher handles that one), so
  exactly one tab opens per press.
- **`bridge.js`** — a tiny relay injected **only** on the WorkSpace origin(s) +
  localhost. It announces the extension's id + version to the page and relays
  `window.postMessage` ⇄ `chrome.runtime`. This is the dev fallback (because
  `externally_connectable` to `http://localhost:5173` is unreliable) and the
  portability path for browsers without `externally_connectable` (Firefox/Safari).
- **`options.html` / `options.js`** — a read-only dashboard showing connection
  status (origin + last sync time) and the list of currently-synced shortcuts.

---

## Install for local development ("load unpacked")

1. Run the WorkSpace dev server: `cd app && npm run dev` (serves
   `http://localhost:5173`).
2. Open **`chrome://extensions`** (or **`edge://extensions`**).
3. Toggle **Developer mode** on (top-right).
4. Click **Load unpacked**.
5. Select this **`extension/`** folder (the one containing `manifest.json`).
6. The card shows **WorkSpace Premium** with an **ID** like
   `abcdefghijklmnopabcdefghijklmnop`. **Copy that ID.**
7. Tell the web app which extension you loaded, one of:
   - In the WorkSpace tab's DevTools console:
     `localStorage.setItem('ws:extId', 'PASTE_THE_ID_HERE')` then reload, **or**
   - Just reload the WorkSpace tab — `bridge.js` posts an `ANNOUNCE` with the id
     automatically on localhost, so the app can detect + learn the id without you
     pasting anything.
8. Open WorkSpace → **Links** tab → add a shortcut on a card. The banner should
   read **"WorkSpace Premium extension connected."** Switch to another tab,
   press the combo, and the link opens.

Verify on the extension's **Details → Extension options** page (or the puzzle-piece
menu → ⋮ → Options): it lists the synced shortcuts and the last sync time.

### Reloading after you edit extension code

After changing any file in `extension/`, click the **reload (↻)** icon on the
extension's card in `chrome://extensions`. Content scripts only attach to pages
loaded **after** the reload — the service worker now re-injects `content.js` into
already-open http(s) tabs on every cold start (and on each tab's next `complete`
load), so in most cases you don't have to refresh manually. If a shortcut still
doesn't fire on a tab that was already open, just reload that tab once.

> [!NOTE]
> **No "scripting" permission prompt is expected.** Loading/reloading an *unpacked*
> extension grants its declared permissions (including `scripting` and the
> `<all_urls>` host access) **silently** — Chrome shows them as text on the
> extension's card ("Read and change all your data on all websites"), never as a
> runtime allow-dialog. The absence of a prompt does **not** mean the load failed.
> Confirm a successful load instead by checking the card has an **ID**, is
> **enabled**, and shows **no red "Errors"** badge — and that the **Options** page
> reports a recent "Last sync" with your shortcuts listed.

### `file://` pages

Shortcuts do **not** fire on `file://` URLs unless you enable
**"Allow access to file URLs"** on the extension's Details page.

---

## Where shortcuts will and won't fire

"Global" honestly means: normal websites in the browser, even when the WorkSpace
tab is in the background. Shortcuts will **not** fire on:

- `chrome://`, `edge://`, `about:` pages, and the New Tab page
- the Chrome Web Store, `view-source:`, the built-in PDF viewer, DevTools
- the omnibox / browser chrome itself, and any non-browser app
- a brand-new tab before a navigation injects the content script
- `file://` without "Allow access to file URLs" (see above)
- while you're typing in an `<input>`, `<textarea>`, `<select>`, or
  `contenteditable` element

Some pages call `stopImmediatePropagation` on `document`/`window` at
`document_start` (Google Docs, Gmail, web IDEs, some games) and can pre-empt the
matcher even though it runs in the capture phase — so coverage is high but not
100%.

Browser- and OS-reserved combinations (`Ctrl+T`, `Ctrl+W`, `Ctrl+N`,
`Ctrl+1..9`, `Alt+F4`, `⌘W`/`⌘T`/`⌘Q`, etc.) are intercepted by the browser
before any extension sees them and **cannot** be reclaimed. The web app's "Select
Keys" box already rejects these; the extension refuses them again as defense in
depth. Prefer `Alt+letter` or `Ctrl+Shift+letter`.

---

## Before releasing to the Chrome Web Store

> [!IMPORTANT]
> **The production web origin MUST be added to `externally_connectable.matches`
> before release.** Today the manifest only lists `http://localhost:5173/*`.

1. In **`manifest.json`**, add every exact production / staging / custom-domain
   origin to `externally_connectable.matches`, e.g.:
   ```json
   "externally_connectable": {
     "matches": ["http://localhost:5173/*", "https://app.workspace.example/*"]
   }
   ```
   `externally_connectable` does **not** support a wildcard TLD — list each exact
   origin. (You may drop `http://localhost:5173/*` from the published build; the
   `postMessage` bridge still covers dev.)
2. Add the **same production origin(s)** to the **second `content_scripts` entry**
   (the `bridge.js` one) so the announce/relay bridge runs there too.
3. Hardcode the published extension ID in the web app's
   `app/src/bookmarks/shortcuts.ts` (`export const EXTENSION_ID`). The
   `localStorage('ws:extId')` / env override remains for dev.
4. Changing matched origins or permissions requires a **Web Store re-publish**.
   Day-to-day shortcut changes do **not** — they travel as config over the
   message channel, never as code.

### Browser support

- **Chrome / Edge**: fully supported (the `externally_connectable` path).
- **Firefox / Safari**: no `externally_connectable`; the `postMessage` bridge is
  the supported path there. Treat as the portability target, not a v1 ship goal.

---

## Privacy

The extension stores only the shortcut config you set in WorkSpace
(combo + URL + name) in local extension storage. It sends nothing to any server,
makes no network requests, and reads no page content — `content.js` only listens
for `keydown` and never inspects the page DOM.

---

## Regenerating the icons

The icons are generated by a dependency-free Node script:

```
node icons/make-icons.cjs
```

It writes `icon16/32/48/128.png` (a gold laurel wreath + checkmark on a
dark-blue tile, matching the WorkSpace theme). The script is a build helper and
is not loaded by the extension at runtime.
