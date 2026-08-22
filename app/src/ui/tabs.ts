// Cobalt: tab panels. Lazy-renders each panel on first view. The visible
// navigation is the hover side-drawer in main.ts; this just owns the panels and
// the goToTab/onChange wiring.

import { el } from '../util/dom';

// #region Types — a tab's definition and the controller mountTabs returns
export interface TabDef {
  id: string;
  label: string;
  /** Called once, the first time the tab is shown, to populate its panel. */
  render?: (panel: HTMLElement) => void;
  /** Called every time the tab is shown (after render) — e.g. to reload state
   *  from the last-saved version so unsaved edits don't survive a tab switch. */
  onShow?: (panel: HTMLElement) => void;
}

export interface TabController {
  goToTab: (id: string) => void;
  current: () => string;
}
// #endregion

// #region openAtTop() — every tab (and every settings sub-tab) starts at its top
/**
 * SCROLL TO THE TOP OF WHATEVER WAS JUST OPENED (Gabe, 8/21).
 *
 * In the signed-in shell the window does not scroll — `.app-below` does
 * (components.css) — and that ONE scroller is shared by every tab panel. So the
 * position was effectively linked: scrolling halfway down Tasks and then opening
 * Settings, Bookmarks or a settings section dropped you halfway down THAT too,
 * looking at the middle of a page you had never seen. Opening something is always
 * a request to start at its beginning.
 *
 * `node` is anywhere inside the surface being shown, and the scroller is found by
 * walking UP from it rather than by a document-wide query: the landing page's live
 * demo builds its own `.app-below` inside the device frame, and a global lookup
 * would reach across into it.
 */
export function openAtTop(node: Element): void {
  for (let n: Element | null = node; n; n = n.parentElement) {
    if (n.scrollTop) n.scrollTop = 0;
  }
}
// #endregion

// #region mountTabs() — one panel per tab; renders on first view, switches the active one
export function mountTabs(
  container: HTMLElement,
  tabs: TabDef[],
  onChange?: (id: string) => void
): TabController {
  const panels = new Map<string, HTMLElement>();
  const rendered = new Set<string>();
  let currentId = '';

  // Switch to a tab: toggle the active panel, render it the first time only,
  // then run its onShow hook and notify the caller (highlights the nav item).
  const goToTab = (id: string) => {
    currentId = id;
    for (const t of tabs) panels.get(t.id)!.classList.toggle('active', t.id === id);
    const tab = tabs.find((t) => t.id === id)!;
    const panel = panels.get(id)!;
    if (tab.render && !rendered.has(id)) {
      rendered.add(id);
      tab.render(panel);
    }
    tab.onShow?.(panel); // every visit — lets a tab reload from saved state
    // AFTER onShow, so a tab that rebuilt its content is measured in its final
    // shape. Every tab opens at its top, whatever the last one was scrolled to.
    openAtTop(panel);
    onChange?.(id);
  };

  // Build an (empty) panel element for every tab up front.
  for (const t of tabs) {
    const panel = el('div', { class: 'tab-panel', id: `${t.id}Tab` });
    panels.set(t.id, panel);
    container.append(panel);
  }

  if (tabs.length) goToTab(tabs[0].id); // open the first tab by default
  return { goToTab, current: () => currentId };
}
// #endregion
