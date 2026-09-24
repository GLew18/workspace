// Cobalt: the address bar as app state.
//
// One path segment per level of the app — `/tasks`, `/settings/courses` — so that
// where you are is something you can copy, bookmark, reload into, and walk back
// out of with the browser's own Back button (Gabe, 9/4/26).
//
// TWO RULES THIS FILE EXISTS TO KEEP:
//
//  1. ONLY THE SIGNED-IN SHELL WRITES HERE. The landing page lives at "/", and its
//     hero demo drives a second, complete copy of these same tabs inside the device
//     frame. That copy must never touch the real URL, so nothing in ui/tabs.ts (which
//     both of them share) knows this module exists — main.ts does the writing.
//
//  2. AN UNKNOWN PATH IS NOT A ROUTE. Everything under the hosting rewrite serves
//     index.html, so a typo, an old link, or a crawler's guess all arrive here.
//     Anything not on the lists below parses as null and the caller falls back to
//     its normal opening behaviour rather than showing a blank tab.

/** The signed-in tabs, exactly as mountTabs knows them (see main.ts). */
const TABS = new Set(['dashboard', 'tasks', 'focus', 'bookmarks', 'settings', 'notifications']);

/** Settings' own side tabs, lowercased. The labels live in settings/view.ts; these
 *  are their slugs, and SETTINGS_LABEL maps back to the label it renders. */
export const SETTINGS_SECTIONS = ['profile', 'tasks', 'courses', 'focus', 'notifications'] as const;
export type SettingsSection = (typeof SETTINGS_SECTIONS)[number];

export interface Route {
  tab: string;
  /** Only ever set for `tab === 'settings'`. */
  section?: SettingsSection;
}

/** Parse a pathname into a route, or null if it names nothing this app has. */
export function parsePath(path: string = location.pathname): Route | null {
  const parts = path.split('/').filter(Boolean).map((s) => decodeURIComponent(s).toLowerCase());
  const [tab, section] = parts;
  // The Task Archives screen became the Tasks list's Completed drawer (9/23), so a
  // bookmarked /archive lands on the tab where that drawer now lives.
  if (tab === 'archive') return { tab: 'tasks' };
  if (!tab || !TABS.has(tab)) return null;
  if (tab === 'settings' && section && (SETTINGS_SECTIONS as readonly string[]).includes(section)) {
    return { tab, section: section as SettingsSection };
  }
  return { tab };
}

/** The path a route should show. */
export function pathOf(r: Route): string {
  return '/' + r.tab + (r.tab === 'settings' && r.section ? '/' + r.section : '');
}

/**
 * Point the address bar at `r`. `replace` rewrites the current entry instead of
 * adding one — used while restoring a route at boot, so arriving on /tasks doesn't
 * leave a phantom /dashboard behind the Back button.
 *
 * The query string is carried through untouched (sign-in redirects and campaign
 * tags both land there); the hash is deliberately dropped, since the only hash the
 * app ever used, "#tasks", is now a real path.
 */
export function setRoute(r: Route, replace = false): void {
  const next = pathOf(r) + location.search;
  if (next === location.pathname + location.search) return;
  history[replace ? 'replaceState' : 'pushState'](null, '', next);
}

/** Send the bar back to "/" — the landing page's address. Never a new entry. */
export function resetRoute(): void {
  if (location.pathname !== '/') history.replaceState(null, '', '/' + location.search);
}

/** Back/forward. Returns an unsubscribe, in the shape the rest of the app uses. */
export function onNavigate(fn: (r: Route | null) => void): () => void {
  const handler = (): void => fn(parsePath());
  window.addEventListener('popstate', handler);
  return () => window.removeEventListener('popstate', handler);
}
