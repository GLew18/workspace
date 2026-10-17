// The app's main tab bar: Dashboard / Tasks / Grades / Focus / Bookmarks / Store.
//
// TOP BAR ON DESKTOP, BOTTOM BAR ON PHONES (Gabe, 10/2). It replaced the hamburger
// drawer: tabs a student can't see are tabs a student never finds, and the red
// due-today count on Tasks was invisible until the drawer opened. Above 760px the
// bar sits in the header's centre column; at 760 and below the same element is
// pinned to the bottom of the screen with the icon over the label (components.css).
//
// ONE BUILDER, TWO CALLERS: the real header (main.ts) and the landing demo's replica
// (landing/demo/shell.ts) both build their tabs here, so the demo's bar can never
// drift from the app's. ORDER IS PRIORITY (Gabe, 8/12): further left = more
// important; keep this list, the landing showcase and "Open Cobalt to" in step.
import { el } from '../util/dom';

export interface AppTabDef {
  id: string;
  label: string;
}

/** The Tests tab is built but ON HOLD (Gabe, 10/8/26): it needs the test relay
 *  deployed first (see the vault note "Cobalt Calendars Plan"). Flip to true to ship. */
export const TESTS_TAB_ON = false;

/** The Grades tab (Gabe, 10/11/26). One switch to hide it everywhere, e.g. if the school
 *  asks Cobalt to drop grades. Full teardown steps: vault note "Grades Tab Teardown". */
export const GRADES_TAB_ON = true;

export const APP_TABS: AppTabDef[] = [
  { id: 'dashboard', label: 'Dashboard' },
  { id: 'tasks', label: 'Tasks' },
  ...(GRADES_TAB_ON ? [{ id: 'grades', label: 'Grades' }] : []),
  ...(TESTS_TAB_ON ? [{ id: 'tests', label: 'Tests' }] : []),
  { id: 'focus', label: 'Focus' },
  { id: 'bookmarks', label: 'Bookmarks' },
  { id: 'store', label: 'Shop' },
];

// Drawn like the header's toolbar icons: 24 box, 2 stroke, round caps. Left of
// the label on desktop, above it in the phone bar (components.css sizes both).
const svg = (inner: string): string =>
  `<svg class="app-tab-ico" viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">${inner}</svg>`;

const ICONS: Record<string, string> = {
  dashboard: svg('<rect x="3.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="3.5" width="7" height="7" rx="1.5"/><rect x="3.5" y="13.5" width="7" height="7" rx="1.5"/><rect x="13.5" y="13.5" width="7" height="7" rx="1.5"/>'),
  tasks: svg('<path d="M4 6.5l1.8 1.8L9 5"/><path d="M4 16.5l1.8 1.8L9 15"/><line x1="12.5" y1="7" x2="20" y2="7"/><line x1="12.5" y1="17" x2="20" y2="17"/>'),
  grades: svg('<line x1="4" y1="20" x2="20" y2="20"/><rect x="5.5" y="12" width="3.5" height="8" rx="1"/><rect x="10.25" y="7" width="3.5" height="13" rx="1"/><rect x="15" y="3.5" width="3.5" height="16.5" rx="1"/>'),
  tests: svg('<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 3.5h6v3H9z"/><path d="M8.5 12.5l2 2 4-4"/><line x1="8.5" y1="18" x2="15.5" y2="18"/>'),
  focus: svg('<circle cx="12" cy="13" r="8"/><path d="M12 9v4l2.5 2"/><path d="M9.5 2.5h5"/>'),
  bookmarks: svg('<path d="M6.5 3.5h11v17l-5.5-4-5.5 4z"/>'),
  store: svg('<path d="M5 8h14l-1.2 12H6.2z"/><path d="M9 8V6.5a3 3 0 0 1 6 0V8"/>'),
};

export interface AppTabs {
  /** The <nav> to place in the header's centre column. */
  nav: HTMLElement;
  /** One button per tab id; the tab controller toggles `.active` on these. */
  btns: Map<string, HTMLElement>;
  /** The red new-tasks circle on Tasks (`.count-badge.nav-count`, shown via `.on`). */
  tasksCount: HTMLElement;
  /** The same red circle on Grades: how many new grades are unseen (Gabe, 10/16). */
  gradesCount: HTMLElement;
}

export function createAppTabs(onPick: (id: string) => void, tabs: AppTabDef[] = APP_TABS): AppTabs {
  const nav = el('nav', { class: 'app-tabs', 'aria-label': 'Main' });
  const btns = new Map<string, HTMLElement>();
  const tasksCount = el('span', { class: 'count-badge nav-count', title: 'New tasks' });
  const gradesCount = el('span', { class: 'count-badge nav-count', title: 'New grades' });
  for (const t of tabs) {
    const b = el('button', { class: 'app-tab', 'data-tab': t.id });
    b.innerHTML = ICONS[t.id] ?? '';
    b.append(el('span', { class: 'app-tab-label', text: t.label }));
    if (t.id === 'tasks') b.append(tasksCount);
    if (t.id === 'grades') b.append(gradesCount);
    b.addEventListener('click', () => onPick(t.id));
    btns.set(t.id, b);
    nav.append(b);
  }
  return { nav, btns, tasksCount, gradesCount };
}
