// Cobalt: Links (Quick Access) tab.
//
// A grid of rich, rectangular link cards: a large favicon fills the LEFT of each
// card, the name + host sit on the RIGHT. Live search, a shared add/edit modal,
// and a confirmed delete. Each card can be given an in-app keyboard shortcut that
// opens it, active while Cobalt is the focused browser tab (a web page can't
// capture keys globally without an extension).
//
// Persistence: the whole { list, groups } blob is saved under the 'bookmarks'
// profile key via the Data layer (full overwrite on every mutation).
//
// Deferred (next passes): colored groups, drag-to-reorder, per-site sub-links
// (Schoology auto-filled from your courses), and an optional companion extension
// for shortcuts that fire even when Cobalt isn't focused.

import type { Data } from '../db';
import { selectionBar, type SelBar } from '../ui/selbar';
import { el, textInput, enterConfirms, showToast } from '../util/dom';
import { popupGuideButton } from '../ui/popupGuide';
import { attachColorPicker } from '../ui/colorPicker';
import { genId } from '../util/ids';
import { normalizeUrl } from './url';
import {
  installInAppDispatcher,
  syncShortcutsToExtension,
  detectExtension,
  openShortcutModal,
  prettyCombo,
  normalizeCombo,
  extensionActive,
  openUrlsInGroup,
  openTabs,
  type ShortcutBookmark,
} from './shortcuts';

// #region Types & seed data
interface Bookmark {
  id: string;
  name: string;
  url: string;
  customIcon?: string | null;
  shortcut?: string; // e.g. "Alt+Y", opens this link when pressed (Cobalt focused)
  groupId?: string; // reserved for the deferred grouping feature
}
interface BookmarkGroup {
  id: string;
  name: string;
  color: string;
}
interface BookmarksData {
  list: Bookmark[];
  groups: BookmarkGroup[];
}

/* What a NEW account starts with (Gabe's pick, 8/7/26): the five links a Heschel
 * student actually lives in, school stack only. Existing accounts are untouched;
 * this list is only read when profile 'bookmarks' is empty (see load()). */
const DEFAULT_BOOKMARKS: Bookmark[] = [
  { id: 'bm1', name: 'Schoology', url: 'https://heschel.schoology.com' },
  { id: 'bm2', name: 'Google Docs', url: 'https://docs.google.com' },
  { id: 'bm3', name: 'Google Slides', url: 'https://slides.google.com' },
  { id: 'bm4', name: 'Google Drive', url: 'https://drive.google.com' },
  { id: 'bm5', name: 'Gmail', url: 'https://gmail.com' },
];

const FAVICON_OVERRIDES: Record<string, string> = {
  'drive.google.com': 'https://ssl.gstatic.com/images/branding/product/1x/drive_2020q4_48dp.png',
  'gmail.com': 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
  'mail.google.com': 'https://ssl.gstatic.com/ui/v1/icons/mail/rfr/gmail.ico',
  'classroom.google.com': 'https://ssl.gstatic.com/classroom/favicon.png',
  'heschel.schoology.com': 'https://www.google.com/s2/favicons?domain=schoology.com&sz=128',
  'chat.openai.com': 'https://cdn.oaistatic.com/assets/favicon-miwirzcz.ico',
  'claude.ai': 'https://claude.ai/favicon.ico',
  'youtube.com': 'https://www.youtube.com/s/desktop/favicon_144x144.png',
  'www.youtube.com': 'https://www.youtube.com/s/desktop/favicon_144x144.png',
};
// #endregion

// #region URL + favicon helpers
/** Pretty URL for the card's second line: host + the full path/query/hash so you
 *  see the precise link (e.g. "cobalt.app/tasks"), dropping only the scheme, a
 *  leading www., and a bare trailing slash. The card CSS keeps it to one line with
 *  an ellipsis, so a long path truncates instead of wrapping. */
function hostOf(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    const host = u.hostname.replace(/^www\./, '');
    const tail = (u.pathname + u.search + u.hash).replace(/\/$/, ''); // '/' → '' , '/tasks/' → '/tasks'
    return host + tail;
  } catch {
    return url;
  }
}

/** Best-guess favicon URL: Google Docs sub-products → overrides → per-host DDG for
 *  Google product subdomains → Google s2 service. Exported for tests. */
export function getFaviconUrl(url: string): string {
  try {
    const u = new URL(normalizeUrl(url));
    if (u.hostname === 'docs.google.com') {
      if (u.pathname.includes('/spreadsheets')) return 'https://ssl.gstatic.com/docs/spreadsheets/favicon3.ico';
      if (u.pathname.includes('/presentation')) return 'https://ssl.gstatic.com/docs/presentations/images/favicon5.ico';
      if (u.pathname.includes('/forms')) return 'https://ssl.gstatic.com/docs/forms/device_home/android_128dp/ic_lanceur_forms_v2_128dp.png';
      return 'https://ssl.gstatic.com/docs/documents/images/kix-favicon7.ico';
    }
    if (FAVICON_OVERRIDES[u.hostname]) return FAVICON_OVERRIDES[u.hostname];
    // Google products live on subdomains of google.com, and the s2 service keys on
    // the DOMAIN — every *.google.com product gets the generic "G" from it (that's
    // why Firebase showed a G instead of the flame). DuckDuckGo's icon service keys
    // on the FULL hostname and serves each product's real favicon, so prefer it for
    // those hosts; the ladder still falls back to s2 if DDG is down.
    if (u.hostname.endsWith('.google.com') && u.hostname !== 'www.google.com') {
      return 'https://icons.duckduckgo.com/ip3/' + u.hostname + '.ico';
    }
    return 'https://www.google.com/s2/favicons?domain=' + u.hostname + '&sz=128';
  } catch {
    return '';
  }
}

function googleFavicon(url: string): string {
  try {
    return 'https://www.google.com/s2/favicons?domain=' + new URL(normalizeUrl(url)).hostname + '&sz=128';
  } catch {
    return '';
  }
}

/** Wire the spec's favicon fallback ladder onto an <img>: tiny-globe → DDG, error
 *  → custom-fail / DDG / Google / hide + 🔗 emoji. */
function attachFaviconLadder(img: HTMLImageElement, iconBox: HTMLElement, bm: Bookmark): void {
  img.src = bm.customIcon || getFaviconUrl(bm.url);
  // If the default already IS the DDG service (google.com subdomains), a failure
  // should fall straight through to s2 — retrying the identical URL is pointless.
  if (img.src.includes('icons.duckduckgo.com')) img.dataset.triedDdg = '1';
  img.onload = () => {
    if (img.naturalWidth <= 16 && img.naturalHeight <= 16 && !img.dataset.triedDdg) {
      try {
        img.dataset.triedDdg = '1';
        img.src = 'https://icons.duckduckgo.com/ip3/' + new URL(normalizeUrl(bm.url)).hostname + '.ico';
      } catch {
        /* unparseable url — leave the tiny icon */
      }
    }
  };
  img.onerror = () => {
    if (bm.customIcon) {
      bm.customIcon = null;
      img.src = getFaviconUrl(bm.url);
      return;
    }
    if (!img.dataset.triedDdg) {
      try {
        img.dataset.triedDdg = '1';
        img.src = 'https://icons.duckduckgo.com/ip3/' + new URL(normalizeUrl(bm.url)).hostname + '.ico';
        return;
      } catch {
        /* fall through */
      }
    }
    const g = googleFavicon(bm.url);
    if (g && img.src !== g) {
      img.src = g;
    } else {
      img.style.display = 'none';
      iconBox.textContent = '🌐';
    }
  };
}
// #endregion

/** The Esc handler belonging to the LIVE view. main.ts builds a fresh BookmarksView
 *  on every visit to the tab and never tears the old one down, so without this the
 *  document would collect one keydown listener per visit, forever. */
let activeKeyHandler: ((e: KeyboardEvent) => void) | null = null;

export class BookmarksView {
  // #region State & lifecycle
  private data: Data;
  private state: BookmarksData = { list: [], groups: [] };
  private grid!: HTMLElement;
  private search = '';

  // Landing-preview mode: modals mount into `host` (contained in the frame) and the
  // cards don't navigate to external sites.
  private sample?: { host: HTMLElement };

  // id of the card being dragged (⋮⋮ handle reorder), null when idle.
  private dragFromId: string | null = null;

  // --- multi-select. Deliberately the SAME model as the Tasks tab (tasks/render.ts
  // onRowClick): shift/ctrl/cmd click starts and extends a selection, and once one
  // exists a plain click toggles. Two tabs that both show a list of things should
  // not have two different ways to pick several of them. ---
  private selectedIds = new Set<string>();
  private lastSelId: string | null = null; // the shift-range anchor
  private selBar: SelBar | null = null; // the "N selected · Deselect all" strip

  // The pop-up fix-it guide. Created once, shown only once an "Open all" button
  // exists to explain (see renderGrid).
  private guideBtn?: HTMLButtonElement;

  constructor(data: Data, sample?: { host: HTMLElement }) {
    this.data = data;
    this.sample = sample;
  }

  async mount(panel: HTMLElement): Promise<void> {
    panel.replaceChildren();
    this.state = await this.load();
    // Single source of truth for the focused-tab fallback dispatcher: it reads the
    // live list and yields once the companion extension is detected.
    installInAppDispatcher(() => this.state.list as ShortcutBookmark[]);
    // Push the current shortcuts to the extension (full replace) and probe install.
    void syncShortcutsToExtension(this.state.list as ShortcutBookmark[]);
    void detectExtension();

    const page = el('div', { class: 'bm-page' });

    // The pop-up blocker fix-it guide, ABOVE the search box. It explains why
    // "Open all" might open only one tab, so it belongs next to the problem, not
    // at the bottom of the page. It also stays hidden until at least one group
    // actually HAS an "Open all" button (see renderGrid): a guide to fixing a
    // button you have never seen is just noise on an empty Bookmarks tab.
    // Present in the landing preview too (Gabe, 8/16): the demo frame should
    // show the page exactly as it is, and visitors can't click it anyway.
    this.guideBtn = popupGuideButton();
    this.guideBtn.style.margin = '0 0 14px';
    this.guideBtn.hidden = true;
    page.append(this.guideBtn);

    const searchWrap = el('div', { class: 'bm-search-wrap' });
    const searchInput = textInput({
      class: 'bm-search',
      placeholder: 'Search links…',
      autocomplete: 'off',
    });
    searchInput.value = this.search;
    searchInput.addEventListener('input', () => {
      this.search = searchInput.value;
      this.renderGrid();
    });
    searchWrap.append(searchInput);
    page.append(searchWrap);

    this.grid = el('div', { class: 'bm-grid' });
    // Esc clears the selection, and a click on empty page space does too — the
    // same two escapes the Tasks tab gives you. Samples included (8/17): the
    // selection bar SAYS "or press Esc", so every mount honors it.
    if (activeKeyHandler) document.removeEventListener('keydown', activeKeyHandler);
    activeKeyHandler = this.onKey;
    document.addEventListener('keydown', this.onKey);
    page.addEventListener('click', (e) => {
      if (this.selectedIds.size && !(e.target as Element).closest('.bm-card')) this.clearSelection();
    });
    page.append(this.grid);

    const addWrap = el('div', { class: 'bm-add-wrap' });
    const addBtn = el('button', { class: 'bm-add-btn', text: '+ Add link' });
    addBtn.addEventListener('click', () => this.openEditor(null));
    addWrap.append(addBtn);
    page.append(addWrap);

    panel.append(page);
    this.renderGrid();
  }

  private async load(): Promise<BookmarksData> {
    const d = await this.data.getProfile<BookmarksData>('bookmarks');
    if (d && Array.isArray(d.list)) return { list: d.list, groups: d.groups || [] };
    // Fresh account — deep-copy the seed so we never mutate the constant.
    return { list: DEFAULT_BOOKMARKS.map((b) => ({ ...b })), groups: [] };
  }

  private save(): Promise<void> {
    return this.data.setProfile('bookmarks', this.state);
  }

  /** Removed on unmount so a re-mount can't stack listeners. */
  private onKey = (e: KeyboardEvent): void => {
    if (!this.grid?.isConnected) return; // a stale view from a previous visit
    // Not while a modal is open: Esc belongs to the dialog on top.
    if (e.key === 'Escape' && this.selectedIds.size && !document.querySelector('.bm-backdrop')) {
      this.clearSelection();
    }
  };

  teardown(): void {
    this.selBar?.destroy();
    this.selBar = null;
    if (activeKeyHandler === this.onKey) {
      document.removeEventListener('keydown', this.onKey);
      activeKeyHandler = null;
    }
    this.selectedIds.clear();
    this.lastSelId = null;
  }

  // --- multi-select ---------------------------------------------------------

  /** Card click routing. Mirrors tasks/render.ts onRowClick step for step, with one
   *  addition: a bookmark card IS a link, so a selecting click must also swallow the
   *  navigation it would otherwise perform. */
  private onCardClick(bm: Bookmark, e: MouseEvent): void {
    const t = e.target as Element;
    if (t.closest('button, input, textarea, .bm-card-handle')) return; // the card's own controls
    const multi = e.ctrlKey || e.metaKey || e.shiftKey;
    const range = e.shiftKey && !!this.lastSelId;
    if (!multi && !range && !this.selectedIds.size) return; // a plain click with nothing selected = open the link
    e.preventDefault(); // …otherwise the browser would navigate away mid-selection
    e.stopPropagation();
    window.getSelection()?.removeAllRanges();
    if (range) {
      const ids = [...this.grid.querySelectorAll<HTMLElement>('.bm-card[data-bm-id]')].map((c) => c.dataset.bmId!);
      const a = ids.indexOf(this.lastSelId!);
      const b = ids.indexOf(bm.id);
      if (a >= 0 && b >= 0) for (let i = Math.min(a, b); i <= Math.max(a, b); i++) this.selectedIds.add(ids[i]);
      else this.selectedIds.add(bm.id);
    } else if (this.selectedIds.has(bm.id)) {
      this.selectedIds.delete(bm.id);
    } else {
      this.selectedIds.add(bm.id);
    }
    // An empty selection drops the anchor too, so the next shift-click can't range
    // from a card deselected long ago and resurrect rows nobody re-picked.
    this.lastSelId = this.selectedIds.size ? bm.id : null;
    this.syncSelectionUI();
  }

  /** Paint the selection without a re-render.
   *
   *  ONLY the shortcut chip grays out, and ONLY on cards that are actually in the
   *  selection (Gabe, 8/15). Two rules, both deliberate:
   *
   *   • Group STAYS live, because grouping is the thing you multi-select FOR. It
   *     applies to the whole selection, like every bulk action on the Tasks tab.
   *   • Shortcut cannot: a keyboard combo is unique to one link by definition, so
   *     there is no meaning to assigning one to twelve of them.
   *
   *  And a card OUTSIDE the selection is untouched — its own chips still act on
   *  itself, exactly as they would with nothing selected. */
  private syncSelectionUI(): void {
    this.selBar ??= selectionBar('link', () => this.clearSelection(), this.sample?.host);
    this.selBar.update(this.selectedIds.size);
    const on = this.selectedIds.size > 1; // one card selected is still a single target
    for (const card of this.grid.querySelectorAll<HTMLElement>('.bm-card[data-bm-id]')) {
      const mine = this.selectedIds.has(card.dataset.bmId!);
      card.classList.toggle('selected', mine);
      card.classList.toggle('bm-selecting', this.selectedIds.size > 0);
      const sc = card.querySelector<HTMLButtonElement>('.bm-chip-shortcut');
      if (sc) {
        const off = on && mine;
        sc.classList.toggle('bm-chip-off', off);
        sc.disabled = off;
        sc.title = off ? 'A keyboard shortcut belongs to one link — clear the selection to set one' : sc.dataset.title || sc.title;
      }
    }
  }

  private clearSelection(): void {
    this.selectedIds.clear();
    this.lastSelId = null;
    this.syncSelectionUI();
  }

  /** What the next action hits: the WHOLE selection when the acted-on card is part
   *  of one, just that card otherwise. The File-Explorer rule, same as Tasks. */
  private selTargets(bm: Bookmark): Bookmark[] {
    if (this.selectedIds.has(bm.id) && this.selectedIds.size > 1) {
      const want = this.selectedIds;
      return this.state.list.filter((b) => want.has(b.id)); // list order, not click order
    }
    return [bm];
  }
  // #endregion

  // #region Render — the responsive grid of rich cards
  /** The list as contiguous "blocks": each group's members clustered (in list
   *  order) at the position of the group's first member; every ungrouped bookmark
   *  is its own single-card block. Rendering AND drag-reorder both work on
   *  blocks — that's what keeps a group's cards adjacent and makes the whole
   *  group travel together when any one member is dragged. */
  private blocks(): Bookmark[][] {
    const seen = new Set<string>();
    const groupBlocks: Bookmark[][] = [];
    const loose: Bookmark[][] = [];
    for (const b of this.state.list) {
      if (b.groupId) {
        if (seen.has(b.groupId)) continue;
        seen.add(b.groupId);
        groupBlocks.push(this.state.list.filter((x) => x.groupId === b.groupId));
      } else {
        loose.push([b]);
      }
    }
    // Groups lead the page, loose links follow (Gabe, 8/16). Each half keeps
    // the list's own order, so drag-reorder still reads back consistently.
    return [...groupBlocks, ...loose];
  }

  private renderGrid(): void {
    this.grid.replaceChildren();
    // Show the fix-it guide only once an "Open all" button exists to be fixed,
    // which means a group that actually holds links. A group with no members
    // renders no header (see blocks()), so membership is the honest test, not
    // "a group record exists". Re-evaluated on every draw, so the guide appears
    // the moment the first group is created, with no reload.
    if (this.guideBtn) {
      const grouped = new Set(this.state.groups.map((g) => g.id));
      this.guideBtn.hidden = !this.state.list.some((b) => b.groupId && grouped.has(b.groupId));
    }
    const q = this.search.trim().toLowerCase();
    const hit = (b: Bookmark) => b.name.toLowerCase().includes(q) || b.url.toLowerCase().includes(q);
    // Walk BLOCKS (not the flat list) so a group can announce itself with a header
    // row above its cards; search filters within each block, and a block whose
    // every card is filtered out disappears header and all.
    let shown = 0;
    for (const blk of this.blocks()) {
      const cards = blk.filter(hit);
      if (!cards.length) continue;
      shown += cards.length;
      const group = blk[0].groupId ? this.state.groups.find((g) => g.id === blk[0].groupId) : undefined;
      if (group) {
        // A group is its OWN full-width block with its own inner grid, not a run of
        // loose cards. Without that, the grid keeps flowing: the first ungrouped
        // bookmark lands in whatever slot is left on the group's last row and reads
        // as a member of it. Owning a whole row makes the boundary real.
        const box = el('div', { class: 'bm-group-block' });
        box.style.setProperty('--group-color', group.color);
        box.append(this.groupHeader(group, cards));
        const inner = el('div', { class: 'bm-group-cards' });
        for (const bm of cards) inner.append(this.card(bm));
        box.append(inner);
        this.grid.append(box);
        continue;
      }
      for (const bm of cards) this.grid.append(this.card(bm));
    }
    if (shown === 0) {
      this.grid.append(
        el('div', {
          class: 'bm-empty',
          text: this.state.list.length === 0 ? 'No links yet. Add your first one below.' : 'No links match your search.',
        })
      );
    }
    // Drop ids that no longer exist (deleted, or filtered out by a search), then
    // repaint — a selection has to survive the re-render that a save triggers.
    for (const id of [...this.selectedIds]) {
      if (!this.state.list.some((b) => b.id === id)) this.selectedIds.delete(id);
    }
    if (!this.selectedIds.size) this.lastSelId = null;
    this.syncSelectionUI();
  }

  /** The strip above a group's cards: its dot, its name, and TWO launchers
   *  (Gabe, 8/7/26), so the user picks:
   *    Open all  = free, every link in its own tab, always.
   *    ⭐ group  = the PREMIUM one (gem cobalt blue): the whole group opens as ONE named,
   *                colored Chrome tab group via the extension. Falls back to
   *                plain tabs if the extension isn't there, never a dead end. */
  private groupHeader(group: BookmarkGroup, members: Bookmark[]): HTMLElement {
    const row = el('div', { class: 'bm-group-head' });
    const dot = el('span', { class: 'bm-group-head-dot' });
    dot.style.background = group.color;
    const name = el('span', { class: 'bm-group-head-name', text: group.name });
    const count = el('span', { class: 'bm-group-head-count', text: String(members.length) });

    const urlsOf = () => members.map((b) => normalizeUrl(b.url)).filter(Boolean);

    const openAll = el('button', {
      class: 'bm-group-head-open',
      text: 'Open all',
      title: `Open all ${members.length} links in tabs`,
    });
    openAll.addEventListener('click', () => {
      if (this.sample) return; // the landing preview never opens real tabs
      // openTabs routes through the extension when present: window.open gets ONE
      // popup per click (the blocker eats the rest), chrome.tabs.create gets all.
      openTabs(urlsOf());
    });

    const openGroup = el('button', {
      class: 'bm-group-head-open bm-group-head-gopen',
      text: 'Open all as group',
      title: `Premium: open all ${members.length} links as one “${group.name}” Chrome tab group (needs the Cobalt extension)`,
    });
    openGroup.addEventListener('click', () => {
      if (this.sample) return;
      const urls = urlsOf();
      if (!urls.length) return;
      // One line in the console on every launch, saying which path ran and why.
      // Silent fallback was impossible to tell apart from a broken extension.
      const active = extensionActive();
      console.info('[Cobalt] Open as group:', { group: group.name, links: urls.length, extensionDetected: active });
      if (!active) {
        // No silent fallback to plain tabs: a missing extension gets told WHY.
        showToast('Install the Cobalt extension to open links as one Chrome tab group.');
        return;
      }
      void openUrlsInGroup(group.name, group.color, urls).then((ok) => {
        console.info('[Cobalt] tab group created:', ok);
        if (!ok) openTabs(urls); // extension answered "no" (old Chrome, missing permission)
      });
    });

    row.append(dot, name, count, openAll, openGroup);
    return row;
  }

  private card(bm: Bookmark): HTMLElement {
    const href = normalizeUrl(bm.url);
    const card = el('a', { class: 'bm-card', href, target: '_blank', rel: 'noopener' }) as HTMLAnchorElement;
    card.dataset.bmId = bm.id;
    // Anchors are natively draggable (they drag the link) — keep that OFF so a
    // drag can only start from the ⋮⋮ handle below.
    card.setAttribute('draggable', 'false');
    const stop = (e: Event) => {
      e.preventDefault();
      e.stopPropagation();
    };
    // ONE listener for both modes. A preview must never NAVIGATE (preventDefault
    // up front), but multi-select still works there: the landing's Dan demo
    // bulk-groups cards on camera, and selecting is harmless without navigation.
    card.addEventListener('click', (e) => {
      if (this.sample) e.preventDefault();
      this.onCardClick(bm, e);
    });
    if (this.selectedIds.has(bm.id)) card.classList.add('selected');

    // --- Drag-to-reorder (same concept as focus-session todos): the ⋮⋮ handle
    // arms the card's draggable, native DnD moves it to the drop card's slot. ---
    const handle = el('span', { class: 'bm-card-handle', text: '⋮⋮', title: 'Drag to reorder' });
    handle.addEventListener('click', stop); // grabbing the handle must never navigate
    handle.addEventListener('pointerdown', () => card.setAttribute('draggable', 'true'));
    handle.addEventListener('pointerup', () => card.setAttribute('draggable', 'false'));
    card.addEventListener('dragstart', (e) => {
      this.dragFromId = bm.id;
      card.classList.add('dragging');
      e.dataTransfer?.setData('text/plain', bm.id);
      if (e.dataTransfer) e.dataTransfer.effectAllowed = 'move';
    });
    card.addEventListener('dragend', () => {
      card.classList.remove('dragging');
      card.setAttribute('draggable', 'false');
      this.dragFromId = null;
    });
    card.addEventListener('dragover', (e) => {
      e.preventDefault();
      if (e.dataTransfer) e.dataTransfer.dropEffect = 'move';
    });
    card.addEventListener('drop', async (e) => {
      e.preventDefault();
      const fromId = this.dragFromId;
      this.dragFromId = null;
      if (!fromId || fromId === bm.id) return;
      const blocks = this.blocks();
      const fi = blocks.findIndex((blk) => blk.some((b) => b.id === fromId));
      const ti = blocks.findIndex((blk) => blk.some((b) => b.id === bm.id));
      if (fi < 0 || ti < 0) return;
      if (fi === ti) {
        // Same group: reorder the card within its block.
        const blk = blocks[fi];
        const from = blk.findIndex((b) => b.id === fromId);
        const to = blk.findIndex((b) => b.id === bm.id);
        const [moved] = blk.splice(from, 1);
        blk.splice(to, 0, moved);
      } else {
        // Across blocks: the dragged card's WHOLE block takes the target slot —
        // a group always travels as one unit (same splice semantics as before:
        // dragging down lands after the target, dragging up lands before it).
        const [movedBlk] = blocks.splice(fi, 1);
        blocks.splice(ti, 0, movedBlk);
      }
      this.state.list = blocks.flat();
      await this.save();
      this.renderGrid();
    });

    // Colored left accent when the link belongs to a group.
    const group = bm.groupId ? this.state.groups.find((g) => g.id === bm.groupId) : undefined;
    if (group) card.style.borderLeft = `4px solid ${group.color}`;

    const iconBox = el('div', { class: 'bm-card-icon' });
    const img = el('img', { alt: '' }) as HTMLImageElement;
    attachFaviconLadder(img, iconBox, bm);
    iconBox.append(img);

    const body = el('div', { class: 'bm-card-body' });
    body.append(el('div', { class: 'bm-card-name', text: bm.name }));
    body.append(el('div', { class: 'bm-card-host', text: hostOf(bm.url) }));

    // --- Action row: Group + Shortcut (always visible; clicks never navigate) ---
    const btns = el('div', { class: 'bm-card-btns' });

    const groupBtn = el('button', { class: 'bm-chip-btn' });
    if (group) {
      groupBtn.classList.add('bm-chip-group');
      groupBtn.style.setProperty('--chip-color', group.color);
      groupBtn.textContent = group.name;
    } else {
      groupBtn.textContent = '+ Group';
    }
    groupBtn.addEventListener('click', (e) => {
      stop(e);
      this.openGroupPicker(bm); // acts on the whole selection when this card is in one
    });

    const scBtn = el('button', { class: 'bm-chip-btn bm-chip-shortcut' });
    const paintShortcut = () => {
      scBtn.classList.toggle('bm-chip-kbd', !!bm.shortcut);
      scBtn.textContent = bm.shortcut ? prettyCombo(bm.shortcut) : '+ Shortcut';
      scBtn.title = bm.shortcut ? 'Edit keyboard shortcut' : 'Add a keyboard shortcut';
      scBtn.dataset.title = scBtn.title; // remembered, so the grayed tooltip can be restored
    };
    paintShortcut();
    scBtn.addEventListener('click', (e) => {
      stop(e);
      // Grayed on a selected card while a multi-selection is live. `disabled` stops
      // a real mouse; this stops a keyboard, an assistive tool, or a scripted click,
      // so "grayed out" means the same thing however the click got here.
      if (this.selectedIds.size > 1 && this.selectedIds.has(bm.id)) return;
      // Every OTHER bookmark's combo, so the same combo on this card re-saves fine.
      const existingCombos = new Set<string>();
      for (const other of this.state.list) {
        if (other.id === bm.id || !other.shortcut) continue;
        const n = normalizeCombo(other.shortcut); // canonicalize so dup-check is reliable
        if (n) existingCombos.add(n);
      }
      openShortcutModal(bm as ShortcutBookmark, {
        existingCombos,
        // Sample mode (landing demos): contain the modal in the demo screen and
        // skip the extension gate — the capture UI itself is the showcase, and
        // a "install the extension" prompt inside an animation would be noise.
        host: this.sample?.host,
        detect: this.sample ? async () => ({ installed: true }) : undefined,
        onSaved: (combo) => {
          bm.shortcut = combo;
          void this.save().then(() => syncShortcutsToExtension(this.state.list as ShortcutBookmark[]));
          paintShortcut();
        },
        onCleared: () => {
          delete bm.shortcut;
          void this.save().then(() => syncShortcutsToExtension(this.state.list as ShortcutBookmark[]));
          paintShortcut();
        },
      });
    });

    btns.append(groupBtn, scBtn);
    body.append(btns);

    // --- Edit / delete (hover, top-right) ---
    const actions = el('div', { class: 'bm-card-actions' });
    const edit = el('button', { class: 'bm-icon-btn', title: 'Edit', text: '✎' });
    edit.addEventListener('click', (e) => {
      stop(e);
      // A name and a URL belong to ONE link, so this is the one action that cannot
      // be bulk-applied. Editing just this card out of a selection would be a silent
      // surprise, so the selection is dropped first and the intent is explicit.
      if (this.selTargets(bm).length > 1) this.clearSelection();
      this.openEditor(bm);
    });
    const del = el('button', { class: 'bm-icon-btn bm-icon-danger', title: 'Delete', text: '✕' });
    del.addEventListener('click', (e) => {
      stop(e);
      this.confirmDelete(this.selTargets(bm)); // the whole selection when this card is in one
    });
    actions.append(edit, del);

    card.append(handle, iconBox, body, actions);
    return card;
  }
  // #endregion

  // #region Groups, add/edit modal, delete confirm
  /** Pick a group with ONE click: choosing a group (or None) applies immediately
   *  and closes — no Done / Remove buttons. Creating a group also auto-assigns. */
  private openGroupPicker(bm: Bookmark): void {
    // THE BULK ACTION. Grouping is what multi-select is for, so the picker acts on
    // the whole selection when this card is part of one — the same File-Explorer
    // rule the Tasks tab uses, and one write for the batch either way.
    const targets = this.selTargets(bm);

    // BUILT ON THE TASKS FOLDER PICKER'S MARKUP, not a lookalike (Gabe, 8/15). Same
    // .folder-pick rows, same "+ New …" row with a colour well beside the name box,
    // same hover and selected borders — every one of those styles comes from
    // components.css and is shared, so the two pickers cannot drift apart. The ONE
    // difference is the mark at the left of each row: a filled circle here, because
    // a bookmark group is identified by its colour, where a task folder is a folder.
    const back = el('div', { class: 'bm-backdrop' });
    const box = el('div', { class: 'bm-modal bm-modal-sm' });
    box.append(el('h3', { class: 'bm-modal-title', text: 'Add to group' }));
    if (targets.length > 1) {
      // .popup-bulk-note, the SAME accent-tinted panel the Tasks folder picker uses
      // (tasks/render.ts bulkNote). It was plain dim text here, which is the visible
      // difference Gabe spotted between the two popups on 8/16.
      box.append(el('div', { class: 'popup-bulk-note', text: `Applies to all ${targets.length} selected links.` }));
    }
    const close = () => back.remove();

    const pick = async (groupId: string | undefined) => {
      for (const t of targets) {
        if (groupId) t.groupId = groupId;
        else delete t.groupId;
      }
      await this.save();
      close();
      this.renderGrid();
    };

    /** The circle that stands in for the folder icon. */
    const dot = (color: string): HTMLElement => {
      const d = el('span', { class: 'group-pick-dot' });
      d.style.background = color;
      return d;
    };

    const wrap = el('div', { class: 'folder-pick' });
    // The check marks a group ONLY when every target already agrees — a mixed
    // selection has no single current group, and claiming one would be a lie.
    const allIn = (id: string | undefined) => targets.every((t) => (t.groupId || undefined) === id);

    let editingId: string | null = null; // group swapped for its inline editor
    const draw = (): void => {
      wrap.replaceChildren();
      for (const g of this.state.groups) {
        // Editing: the row becomes the same colour-well + name + Save trio as the
        // create row below, so renaming looks like what it is.
        if (editingId === g.id) {
          const row = el('div', { class: 'folder-pick-new' });
          let editColor = g.color; // the well's live pick; written back to the group on Save
          const colorEdit = el('button', { type: 'button', class: 'folder-pick-color', title: 'Group color' });
          attachColorPicker(colorEdit, {
            value: () => (/^#[0-9a-f]{6}$/i.test(editColor) ? editColor : '#7db4ff'),
            onChange: (hex) => (editColor = hex),
            host: () => this.sample?.host,
          });
          const nameEdit = textInput({ class: 'folder-pick-input' });
          nameEdit.maxLength = 18; // group names have to stay chip-sized on a card
          nameEdit.value = g.name;
          const commit = async (): Promise<void> => {
            const nm = nameEdit.value.trim();
            if (!nm) {
              nameEdit.classList.add('invalid');
              nameEdit.focus();
              return;
            }
            g.name = nm;
            g.color = editColor || g.color;
            await this.save();
            this.renderGrid(); // chips + card accents pick the change up live
            editingId = null;
            draw();
          };
          nameEdit.addEventListener('input', () => nameEdit.classList.remove('invalid'));
          nameEdit.addEventListener('keydown', (e) => {
            if (e.key === 'Enter') void commit();
            if (e.key === 'Escape') {
              editingId = null;
              draw();
            }
          });
          const saveBtn = el('button', { class: 'folder-pick-mini', text: 'Save' });
          saveBtn.addEventListener('click', () => void commit());
          row.append(colorEdit, nameEdit, saveBtn);
          wrap.append(row);
          requestAnimationFrame(() => nameEdit.focus());
          continue;
        }

        const b = el('button', { class: `folder-pick-row${allIn(g.id) ? ' on' : ''}` });
        b.append(dot(g.color), el('span', { text: g.name }));
        const edit = el('span', { class: 'group-pick-edit', text: '✎', title: `Rename “${g.name}”` });
        edit.addEventListener('click', (e) => {
          e.stopPropagation(); // renaming is not picking
          editingId = g.id;
          draw();
        });
        b.append(edit);
        b.addEventListener('click', () => void pick(g.id));
        wrap.append(b);
      }

      // "Remove from group", shown on the same terms as the Tasks picker's: only
      // when something in the selection actually has one to leave.
      if (targets.some((t) => t.groupId)) {
        const rm = el('button', { class: 'folder-pick-remove', text: 'Remove from group' });
        rm.addEventListener('click', () => void pick(undefined));
        wrap.append(rm);
      }

      // "+ New group": colour well, then the name box. Enter creates and assigns.
      let newColor = '#7db4ff';
      const colorInp = el('button', { type: 'button', class: 'folder-pick-color', title: 'Group color' });
      attachColorPicker(colorInp, {
        value: () => newColor,
        onChange: (hex) => (newColor = hex),
        host: () => this.sample?.host,
      });
      const nameInp = textInput({ class: 'folder-pick-input', placeholder: '+ New group…' });
      nameInp.maxLength = 18;
      const create = (): void => {
        const nm = nameInp.value.trim();
        if (!nm) {
          nameInp.classList.add('invalid');
          return;
        }
        const g: BookmarkGroup = { id: 'grp_' + genId(), name: nm, color: newColor || '#7db4ff' };
        this.state.groups.push(g);
        void pick(g.id); // creating auto-assigns and closes, same as clicking a row
      };
      nameInp.addEventListener('input', () => nameInp.classList.remove('invalid'));
      nameInp.addEventListener('keydown', (e) => {
        if (e.key === 'Enter') create();
      });
      const newRow = el('div', { class: 'folder-pick-new' });
      newRow.append(colorInp, nameInp);
      wrap.append(newRow);
      requestAnimationFrame(() => nameInp.focus());
    };
    draw();
    box.append(wrap);

    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    (this.sample?.host ?? document.body).append(back);
  }

  /** Open the shared editor. `existing` null = add a new bookmark. */
  private openEditor(existing: Bookmark | null): void {
    const back = el('div', { class: 'bm-backdrop' });
    const box = el('div', { class: 'bm-modal' });
    box.append(el('h3', { class: 'bm-modal-title', text: existing ? 'Edit link' : 'Add link' }));

    const nameInp = textInput({ class: 'bm-input', placeholder: 'Name' });
    nameInp.value = existing?.name ?? '';
    const urlInp = textInput({ class: 'bm-input', placeholder: 'URL' });
    urlInp.value = existing?.url ?? '';
    box.append(label('Name'), nameInp, label('URL'), urlInp);
    // Icon is fetched automatically from the site's favicon (falls back to 🌐) —
    // no manual icon picker.

    // Footer: Delete (edit only) · Cancel · Save
    const footer = el('div', { class: 'bm-modal-footer' });
    const close = () => {
      back.remove();
    };
    if (existing) {
      const delBtn = el('button', { class: 'bm-btn bm-btn-danger', text: 'Delete' });
      delBtn.addEventListener('click', () => {
        close();
        this.confirmDelete([existing]); // the editor is always about one link
      });
      footer.append(delBtn);
    }
    const spacer = el('div', { class: 'bm-modal-spacer' });
    const cancel = el('button', { class: 'bm-btn', text: 'Cancel' });
    cancel.addEventListener('click', close);
    const saveBtn = el('button', { class: 'bm-btn bm-btn-primary', text: 'Save' });
    saveBtn.addEventListener('click', async () => {
      const name = nameInp.value.trim();
      const url = urlInp.value.trim();
      if (!name) {
        nameInp.classList.add('invalid');
        nameInp.focus();
        return;
      }
      if (!url) {
        urlInp.classList.add('invalid');
        urlInp.focus();
        return;
      }
      let shouldSync = false;
      if (existing) {
        shouldSync = !!existing.shortcut; // URL/name change must repropagate to the ext
        existing.name = name;
        existing.url = url;
      } else {
        const bm: Bookmark = { id: genId(), name, url: normalizeUrl(url) };
        this.state.list.push(bm);
      }
      await this.save();
      if (shouldSync) void syncShortcutsToExtension(this.state.list as ShortcutBookmark[]);
      close();
      this.renderGrid();
    });
    footer.append(spacer, cancel, saveBtn);
    box.append(footer);

    nameInp.addEventListener('input', () => nameInp.classList.remove('invalid'));
    urlInp.addEventListener('input', () => urlInp.classList.remove('invalid'));

    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    enterConfirms(back, () => saveBtn); // Enter anywhere in the modal = Save
    (this.sample?.host ?? document.body).append(back);
    nameInp.focus();
  }

  /** Delete one link, or a whole selection, behind ONE confirmation and ONE write.
   *  N separate deletes would mean N saves and N re-renders for a single gesture. */
  private confirmDelete(targets: Bookmark[]): void {
    if (!targets.length) return;
    const back = el('div', { class: 'bm-backdrop' });
    const box = el('div', { class: 'bm-modal bm-modal-sm' });
    // The count is in the title, not a footnote: deleting twelve links when you
    // meant one is exactly the mistake a confirmation exists to prevent.
    box.append(
      el('h3', {
        class: 'bm-modal-title',
        text: targets.length === 1 ? `Delete “${targets[0].name}”?` : `Delete ${targets.length} links?`,
      })
    );
    if (targets.length > 1) {
      box.append(
        el('div', {
          class: 'bm-modal-note',
          text: targets.map((b) => b.name).join(', '),
        })
      );
    }
    const footer = el('div', { class: 'bm-modal-footer' });
    const cancel = el('button', { class: 'bm-btn', text: 'Cancel' });
    cancel.addEventListener('click', () => back.remove());
    const yes = el('button', { class: 'bm-btn bm-btn-danger', text: 'Delete' });
    yes.addEventListener('click', async () => {
      const ids = new Set(targets.map((b) => b.id));
      const hadShortcut = targets.some((b) => !!b.shortcut);
      this.state.list = this.state.list.filter((b) => !ids.has(b.id));
      this.clearSelection();
      await this.save();
      if (hadShortcut) void syncShortcutsToExtension(this.state.list as ShortcutBookmark[]);
      back.remove();
      this.renderGrid();
    });
    footer.append(el('div', { class: 'bm-modal-spacer' }), cancel, yes);
    box.append(footer);
    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) back.remove();
    });
    (this.sample?.host ?? document.body).append(back);
    // Same policy as Settings' confirmDanger (Gabe, 8/7/26): deleting is
    // consequential, so Enter must never confirm it. Focus moves INTO the dialog
    // (onto Cancel) so Enter can't re-activate the still-focused Delete button
    // that opened it, and a stray Enter just dismisses harmlessly.
    cancel.focus();
  }
  // #endregion
}

// #region Small DOM helpers
function label(text: string): HTMLElement {
  return el('div', { class: 'bm-modal-label', text });
}
// #endregion
