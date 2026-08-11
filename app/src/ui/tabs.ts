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
