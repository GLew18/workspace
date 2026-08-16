// Cobalt: the hero demo's scene script + runner — "Dan" walks the real app
// (vault note "Cobalt Landing Animation Demo Flow").
//
// Each scene is one beat of the story: an async function that drives the REAL
// views through the ghost cursor and then ASSERTS the app actually did the
// thing (a scene that silently faked success would rot the moment the app
// changed). The runner plays scenes in order, then fades the screen and
// rebuilds the whole world — fresh sandbox, fresh registry — so the loop
// restarts pristine, and the fade is what makes the seam read as a cut, not a
// glitch.
//
// Error policy: fail LOUD in the console, fail SOFT on the page. A scene that
// throws logs exactly which beat broke and the loop restarts; the landing
// never shows a half-dead animation.
//
// Pausing: an IntersectionObserver gates scene advancement while the hero is
// off-screen (environments without IO run ungated). The cursor's own rAF
// animation stops naturally in background tabs.

import { el } from '../../util/dom';
import { setDemoSilent } from '../../tasks/complete';
import { buildDemoShell, type DemoShell } from './shell';
import { GhostCursor } from './cursor';
import { danDueTodayCount } from './seed';

interface DemoCtx {
  shell: DemoShell;
  cur: GhostCursor;
}

interface Scene {
  name: string;
  run(ctx: DemoCtx): Promise<void>;
}

const expect = (cond: unknown, msg: string): void => {
  if (!cond) throw new Error(msg);
};

/** Progress marker for the smoke runner: the last beat reached survives on
 *  window, so a timeout error names its exact position in the scene. */
const beat = (name: string): void => {
  (window as unknown as { __demoBeat?: string }).__demoBeat = name;
};

// #region Scenes -------------------------------------------------------------

/** Scene 1 — Dan lands on the Dashboard; the morning briefing arrives bottom-
 *  right. The card is demo chrome (the real popup channel is an OS
 *  notification, which can't render in-page), but its STRINGS are the
 *  scheduler's own daily-agenda copy, computed from the live seed. */
const sceneDashboard: Scene = {
  name: 'dashboard-briefing',
  async run({ shell, cur }) {
    await cur.wait(650);
    await cur.moveTo({ x: 640, y: 320 }, { slow: 1.25 }); // drift in like a hand settling
    const n = danDueTodayCount();
    const brief = el('div', { class: 'lp-demo-brief' });
    const icon = el('img', { src: '/icons/icon.svg', alt: '' });
    const copy = el('div', {});
    copy.append(
      el('div', { class: 'lp-demo-brief-app', text: 'Cobalt · now' }),
      el('div', { class: 'lp-demo-brief-title', text: `Good morning, ${n} task${n === 1 ? '' : 's'} due today` }),
      el('div', { class: 'lp-demo-brief-body', text: 'Open Cobalt to see them.' })
    );
    brief.append(icon, copy);
    shell.body.append(brief);
    await cur.wait(50);
    brief.classList.add('show');
    await cur.wait(2050);
    brief.classList.remove('show');
    await cur.wait(420);
    brief.remove();
  },
};

/** Scene 2 — sidebar → Tasks; the imported variety scrolls past (the Hebrew row
 *  visibly translated); Dan shift-selects the two due-today rows and checks
 *  them off in one click (real bulk complete: shared glide, one undo toast). */
const sceneTasksBulk: Scene = {
  name: 'tasks-bulk-checkoff',
  async run({ shell, cur }) {
    await cur.click(shell.chrome.menu);
    await cur.wait(500); // drawer + stagger settle
    await cur.click(shell.navBtn('tasks'));
    await cur.waitFor('.task-item[data-task-id="dan_read"]', shell.body);
    await cur.wait(350);
    await cur.click(shell.chrome.menu); // tuck the drawer away for the full list
    await cur.wait(400);

    // A slow drift down the list and back: the "profusion of tasks" beat.
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.scrollBy(scroller, 300, 750);
    await cur.wait(420);
    await cur.scrollBy(scroller, -300, 550);
    await cur.wait(250);

    const read = shell.body.querySelector<HTMLElement>('.task-item[data-task-id="dan_read"]')!;
    const lab = shell.body.querySelector<HTMLElement>('.task-item[data-task-id="dan_lab"]')!;
    await cur.click(lab, { shift: true, ax: 0.55, ay: 0.5 });
    await cur.wait(180);
    await cur.click(read, { shift: true, ax: 0.55, ay: 0.5 });
    expect(read.classList.contains('selected') && lab.classList.contains('selected'), 'bulk select did not take');
    await cur.wait(320);

    await cur.click(read.querySelector('.task-cb')!);
    await cur.wait(1500); // the shared glide-out + undo toast

    // The bulk write lands on the app's own clock (820ms after the glide
    // starts), so the outcome is polled, not read once.
    await cur.waitUntil(
      async () => {
        const all = await shell.data.getTasksAll();
        return !!(all['dan_read']?.completed && all['dan_lab']?.completed);
      },
      4000,
      'both due-today tasks completed by the bulk check-off'
    );
  },
};

/** Find a task row by data id (rows re-render constantly; never cache them). */
const row = (shell: DemoShell, id: string): HTMLElement => {
  const r = shell.body.querySelector<HTMLElement>(`.task-item[data-task-id="${id}"]`);
  if (!r) throw new Error(`task row not on screen: ${id}`);
  return r;
};

/** The ⋯ menu on a row → click the entry whose label matches. */
async function moreMenu(ctx: DemoCtx, taskId: string, label: RegExp): Promise<void> {
  const { shell, cur } = ctx;
  await cur.click(row(shell, taskId).querySelector('.act-more')!);
  const menu = await cur.waitFor<HTMLElement>('.row-menu', shell.body);
  const entry = [...menu.querySelectorAll<HTMLElement>('.more-row')].find((r) => label.test(r.textContent ?? ''));
  expect(entry, `no "${label}" entry in the row menu`);
  await cur.wait(260);
  await cur.click(entry!.querySelector('.more-go')!);
}

/** Scene 3 — the History project: Dan duplicates "Research your assigned
 *  figure", renames the copy into an intermediary step, then files the whole
 *  chain into a "History project" folder. Duplicate lives in the ⋯ menu (the
 *  row's real anatomy), rename is the real dblclick inline editor, and the
 *  folder is created inside the real folder picker. */
const sceneHistoryProject: Scene = {
  name: 'history-project-folder',
  async run(ctx) {
    const { shell, cur } = ctx;
    await moreMenu(ctx, 'dan_hp2', /duplicate/i);

    // The copy appears with a fresh dup_ id; find it in the DATA, then on screen.
    let dupId = '';
    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      const hit = Object.values(all).find((t) => t.id.startsWith('dup_') && t.title === 'Research your assigned figure');
      if (hit) dupId = hit.id;
      return !!hit;
    }, 4000, 'duplicate created');
    await cur.waitFor(`.task-item[data-task-id="${dupId}"]`, shell.body);
    await cur.wait(350);

    // Rename the copy: dblclick title → inline editor (opens with the old value
    // selected) → retype → Enter.
    await cur.dblclick(row(shell, dupId).querySelector('.task-title')!);
    const editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.retype(editor, 'Find reliable sources');
    await cur.wait(160);
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(async () => (await shell.data.getTasksAll())[dupId]?.title === 'Find reliable sources', 4000, 'duplicate renamed');
    await cur.wait(300);

    // Cherry-pick the five chain rows (ctrl-click: the precise multi-select).
    const chain = ['dan_hp1', 'dan_hp2', dupId, 'dan_hp3', 'dan_hp4'];
    for (const id of chain) {
      await cur.click(row(shell, id), { ctrl: true, ax: 0.6 });
      await cur.wait(120);
    }
    expect(chain.every((id) => row(shell, id).classList.contains('selected')), 'history chain not fully selected');

    // File them: ⋯ → Add to folder → "+ New folder…" → type the name → Enter.
    await moreMenu(ctx, 'dan_hp1', /folder/i);
    await cur.waitFor('.folder-pick', shell.body);
    const nameIn = shell.body.querySelector<HTMLTextAreaElement>('.folder-pick-input')!;
    await cur.moveTo(nameIn);
    await cur.typeInto(nameIn, 'History project');
    await cur.wait(140);
    cur.pressKey(nameIn, 'Enter');

    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      const fids = new Set(chain.map((id) => all[id]?.folderId).filter(Boolean));
      return fids.size === 1;
    }, 4000, 'all five chain tasks filed into one folder');
    await cur.waitFor('.task-folder-name', shell.body);
    await cur.wait(650); // let the folder block read
  },
};

/** Scene 4 — the quick-add parser: one line in, a fully tagged task out.
 *  `h`, not `hi`: `hi` is deliberately NOT a priority token (priorities.ts). */
const sceneQuickAdd: Scene = {
  name: 'quickadd-parse',
  async run({ shell, cur }) {
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.scrollBy(scroller, -scroller.scrollTop, 500);
    const input = shell.body.querySelector<HTMLTextAreaElement>('.quick-add textarea')!;
    await cur.click(input);
    await cur.typeInto(input, 'study for algebra 2 test math tod h');
    await cur.wait(420); // a beat to let the line read before it transforms
    cur.pressKey(input, 'Enter');
    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      return Object.values(all).some(
        (t) => t.title === 'study for algebra 2 test' && t.course === 'Math' && t.priority === 'high' && !!t.dueDate
      );
    }, 4000, 'quick-add parsed course/date/priority out of the typed line');
    await cur.wait(500);
  },
};

/** Scene 5 — Dan shapes the "get cobalt premium" task: due today, very high
 *  priority; then builds a real `cobalt` course in Settings (name, color,
 *  parse word `cob`) and tags the task with it by typing the parse word. */
const scenePremiumAndCourse: Scene = {
  name: 'premium-edits-cobalt-course',
  async run({ shell, cur }) {
    // Due date: the row's "+ due date" chip → inline editor → today's M/D.
    const today = new Date();
    const md = `${today.getMonth() + 1}/${today.getDate()}`;
    await cur.click(row(shell, 'dan_prem').querySelector('.meta-date')!);
    let editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.typeInto(editor, md);
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(async () => !!(await shell.data.getTasksAll())['dan_prem']?.dueDate, 4000, 'premium task dated today');
    await cur.wait(300);

    // Priority: the permanent arrow button → Very High.
    await cur.click(row(shell, 'dan_prem').querySelector('.task-actions button[title="Priority"]')!);
    await cur.waitFor('.priority-option', shell.body);
    const veryHigh = [...shell.body.querySelectorAll<HTMLElement>('.priority-option')].find((b) => /very high/i.test(b.textContent ?? ''));
    expect(veryHigh, 'Very High missing from the priority popup');
    await cur.wait(240);
    await cur.click(veryHigh!);
    await cur.waitUntil(async () => (await shell.data.getTasksAll())['dan_prem']?.priority === 'highest', 4000, 'priority set to Very High');
    await cur.wait(350);

    // Settings ▸ Courses: gear → Courses tab → + Add course → name/color/parse word.
    await cur.click(shell.chrome.gear);
    const coursesBtn = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.settings-side-btn')].find((b) => /courses/i.test(b.textContent ?? '')),
      4000,
      'settings sidebar rendered'
    );
    await cur.wait(400);
    await cur.click(coursesBtn);
    await cur.wait(350);
    await cur.click(await cur.waitFor('.settings-add', shell.body));
    const nameIn = await cur.waitFor<HTMLTextAreaElement>('.course-row:last-child .course-name', shell.body);
    await cur.moveTo(nameIn);
    await cur.retype(nameIn, 'cobalt');
    await cur.wait(200);

    // Color: the swatch is a native color input; a script can't open the OS
    // picker, so the pick is the programmatic equivalent (same input/change
    // events the picker fires). Gem blue, obviously.
    const swatch = shell.body.querySelector<HTMLInputElement>('.course-row:last-child .course-color')!;
    await cur.moveTo(swatch);
    await cur.wait(260);
    swatch.value = '#3d7fe8';
    swatch.dispatchEvent(new Event('input', { bubbles: true }));
    swatch.dispatchEvent(new Event('change', { bubbles: true }));
    await cur.wait(240);

    // Parse word `cob` (typing it moves focus off the name field → its blur saves).
    const wordIn = shell.body.querySelector<HTMLTextAreaElement>('.course-row:last-child .parse-add')!;
    await cur.click(wordIn);
    await cur.typeInto(wordIn, 'cob');
    cur.pressKey(wordIn, 'Enter');
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; parseWords?: string[] }> }>('courses');
      const c = prof?.list?.find((x) => x.name === 'cobalt');
      return !!c && (c.parseWords ?? []).includes('cob');
    }, 4000, 'cobalt course saved with parse word cob');
    await cur.wait(450);

    // Back to Tasks; tag the task by typing the parse word into its course chip.
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('tasks'));
    await cur.waitFor('.task-item[data-task-id="dan_prem"]', shell.body);
    await cur.wait(250);
    await cur.click(shell.chrome.menu);
    await cur.wait(380);
    await cur.click(row(shell, 'dan_prem').querySelector('.course-chip')!);
    editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.retype(editor, 'cob');
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(async () => (await shell.data.getTasksAll())['dan_prem']?.course === 'cobalt', 4000, 'parse word retagged the task to cobalt');
    await cur.wait(500);
  },
};

/** Scene 6 — the essay's description (auto-linked rubric URL at the end) and
 *  attachments: the Rubric is ALREADY there (the import's link extraction put
 *  it there), Dan adds his own "essay doc" link beside it. */
const sceneEssayAttachments: Scene = {
  name: 'essay-description-attachments',
  async run({ shell, cur }) {
    await cur.click(row(shell, 'dan_essay').querySelector('.task-actions button[title="Description"]')!);
    const back = await cur.waitFor<HTMLElement>('.popup-backdrop', shell.body);
    expect(back.querySelector('a[href*="rubric" i], a[href*="docs.google" i]'), 'description did not auto-link the rubric URL');
    await cur.wait(1500); // reading beat
    await cur.click(back, { ax: 0.07, ay: 0.5 }); // backdrop click closes
    await cur.wait(350);

    await cur.click(row(shell, 'dan_essay').querySelector('.task-actions button[title="Attachments"]')!);
    const pop = await cur.waitFor<HTMLElement>('.popup-backdrop', shell.body);
    expect(/rubric/i.test(pop.textContent ?? ''), 'seeded Rubric attachment missing');
    await cur.wait(700);
    await cur.click(pop.querySelector('.attach-add')!);
    const editing = await cur.waitFor<HTMLElement>('.attach-item.editing', shell.body);
    const fields = editing.querySelectorAll<HTMLTextAreaElement>('.attach-input');
    await cur.click(fields[0]);
    await cur.typeInto(fields[0], 'essay doc');
    await cur.click(fields[1]);
    await cur.typeInto(fields[1], 'https://docs.google.com/document/d/dan-essay-doc');
    const done = [...editing.querySelectorAll<HTMLElement>('button')].find((b) => /done/i.test(b.textContent ?? ''));
    expect(done, 'attachment editor has no Done button');
    await cur.click(done!);
    await cur.waitUntil(async () => ((await shell.data.getTasksAll())['dan_essay']?.notes?.length ?? 0) === 2, 4000, 'essay doc attached');
    await cur.wait(450);
    await cur.click(pop, { ax: 0.07, ay: 0.5 });
    await cur.wait(300);
  },
};

/** Scene 7 — calendar: the list⇄calendar toggle, the History folder's own
 *  scoped calendar, a month hop, and back. */
const sceneCalendar: Scene = {
  name: 'calendar-probe',
  async run({ shell, cur }) {
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.scrollBy(scroller, -scroller.scrollTop, 400);
    await cur.click(shell.body.querySelector('.tasks-mode-btn')!);
    await cur.waitFor('.cal-bar', shell.body);
    await cur.wait(600);

    // The History folder carries its OWN calendar in this mode — open it.
    const folderHead = [...shell.body.querySelectorAll<HTMLElement>('.task-folder-head')].find((h) => /history project/i.test(h.textContent ?? ''));
    expect(folderHead, 'History project folder missing in calendar mode');
    if (!folderHead!.closest('.task-folder')!.classList.contains('open')) {
      await cur.click(folderHead!);
    }
    await cur.waitFor('.task-folder-body.cal-scope .cal-grid', shell.body);
    await cur.wait(900); // the scoped calendar is the beat — let it land
    await cur.scrollBy(scroller, 240, 600);
    await cur.wait(500);
    await cur.scrollBy(scroller, -240, 450);

    // Hop a month out and back on the shared toolbar.
    const label = shell.body.querySelector<HTMLElement>('.cal-label')!;
    const before = label.textContent;
    const navBtns = shell.body.querySelectorAll<HTMLElement>('.cal-nav-btn');
    await cur.click(navBtns[navBtns.length - 1]); // ›
    await cur.waitUntil(() => shell.body.querySelector('.cal-label')?.textContent !== before, 3000, 'calendar advanced a month');
    await cur.wait(750);
    await cur.click(shell.body.querySelectorAll<HTMLElement>('.cal-nav-btn')[0]); // ‹
    await cur.wait(600);
    await cur.click(shell.body.querySelector('.tasks-mode-btn')!); // back to list
    await cur.waitFor('.quick-add', shell.body);
    await cur.wait(300);
  },
};

/** Scene 8 — bookmarks: add Desmos + GeoGebra, group them into a colored
 *  "Math" group, and give Desmos an in-app keyboard shortcut (the capture UI
 *  accepts the combo exactly as the real one does). */
const sceneBookmarks: Scene = {
  name: 'bookmarks-group-shortcut',
  async run({ shell, cur }) {
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('bookmarks'));
    await cur.waitFor('.bm-add-btn', shell.body);
    await cur.wait(300);
    await cur.click(shell.chrome.menu);
    await cur.wait(380);

    const addLink = async (name: string, url: string): Promise<void> => {
      await cur.click(shell.body.querySelector('.bm-add-btn')!);
      const modal = await cur.waitFor<HTMLElement>('.bm-modal', shell.body);
      const inputs = modal.querySelectorAll<HTMLTextAreaElement>('.bm-input');
      await cur.click(inputs[0]);
      await cur.typeInto(inputs[0], name);
      await cur.click(inputs[1]);
      await cur.typeInto(inputs[1], url);
      await cur.wait(150);
      await cur.click([...modal.querySelectorAll<HTMLElement>('button')].find((b) => /^save$/i.test(b.textContent ?? ''))!);
      await cur.waitUntil(async () => {
        const prof = await shell.data.getProfile<{ list?: Array<{ name: string }> }>('bookmarks');
        return !!prof?.list?.some((b) => b.name === name);
      }, 4000, `${name} bookmark saved`);
      await cur.wait(350);
    };
    await addLink('Desmos', 'https://desmos.com/calculator');
    await addLink('GeoGebra', 'https://geogebra.org');

    const cardOf = (name: string): HTMLElement => {
      const card = [...shell.body.querySelectorAll<HTMLElement>('.bm-card')].find((c) => (c.textContent ?? '').includes(name));
      if (!card) throw new Error(`bookmark card missing: ${name}`);
      return card;
    };

    // New "Math" group from the Desmos card's "+ Group" chip.
    await cur.click(cardOf('Desmos').querySelector('.bm-chip-btn')!);
    await cur.waitFor('.bm-mini-input', shell.body);
    const groupColor = shell.body.querySelector<HTMLInputElement>('.bm-group-color')!;
    await cur.moveTo(groupColor);
    groupColor.value = '#3a7d5d';
    groupColor.dispatchEvent(new Event('input', { bubbles: true }));
    groupColor.dispatchEvent(new Event('change', { bubbles: true }));
    const groupName = shell.body.querySelector<HTMLTextAreaElement>('.bm-mini-input')!;
    await cur.click(groupName);
    await cur.typeInto(groupName, 'Math');
    await cur.click(shell.body.querySelector('.bm-mini-btn')!);
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; groupId?: string }>; groups?: Array<{ name: string }> }>('bookmarks');
      return !!prof?.groups?.some((g) => g.name === 'Math') && !!prof?.list?.find((b) => b.name === 'Desmos')?.groupId;
    }, 4000, 'Math group created around Desmos');
    await cur.wait(400);

    // GeoGebra joins the existing group.
    await cur.click(cardOf('GeoGebra').querySelector('.bm-chip-btn')!);
    await cur.waitFor('.bm-backdrop', shell.body);
    const mathRow = [...shell.body.querySelectorAll<HTMLElement>('.bm-backdrop button')].find((b) => /math/i.test(b.textContent ?? '') && !/create/i.test(b.textContent ?? ''));
    expect(mathRow, 'existing Math group not offered in the picker');
    await cur.wait(260);
    await cur.click(mathRow!);
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; groupId?: string }> }>('bookmarks');
      const [d, g] = [prof?.list?.find((b) => b.name === 'Desmos'), prof?.list?.find((b) => b.name === 'GeoGebra')];
      return !!d?.groupId && d.groupId === g?.groupId;
    }, 4000, 'GeoGebra joined the Math group');
    await cur.wait(400);

    // The in-app shortcut: capture box → Alt+Shift+D → Save. (Alt+D is on the
    // app's own reserved-combo blocklist — the browser owns it — and the demo
    // must only show combos the real recorder accepts.)
    const chips = cardOf('Desmos').querySelectorAll<HTMLElement>('.bm-chip-btn');
    await cur.click(chips[1]);
    const keysBox = await cur.waitFor<HTMLElement>('.bm-keys-box', shell.body);
    await cur.click(keysBox); // focuses the box — the recorder requires it
    await cur.wait(350);
    cur.pressKey(keysBox, 'd', { alt: true, shift: true });
    await cur.wait(500);
    const saveBtn = [...shell.body.querySelectorAll<HTMLElement>('.bm-backdrop button')].find((b) => /^save$/i.test(b.textContent ?? ''));
    expect(saveBtn, 'shortcut modal has no Save');
    await cur.click(saveBtn!);
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; shortcut?: string }> }>('bookmarks');
      return /alt\+shift\+d/i.test(prof?.list?.find((b) => b.name === 'Desmos')?.shortcut ?? '');
    }, 4000, 'Alt+Shift+D saved onto Desmos');
    await cur.wait(500);
  },
};

/** Dial a wheel column to a value: click the rung (the pretty path — the
 *  wheel's own handler smooth-scrolls it to center), then verify via
 *  scrollTop and hard-set if the smooth scroll didn't run (headless smoke
 *  environments render no frames). Setting scrollTop fires the wheel's real
 *  scroll listener, so its snap + value logic stay in charge either way. */
async function dialWheel(cur: GhostCursor, col: HTMLElement, text: string): Promise<void> {
  const wheel = col.querySelector<HTMLElement>('.focus-wheel')!;
  const items = [...wheel.querySelectorAll<HTMLElement>('.focus-wheel-item')];
  const matches = items.map((it, i) => ({ it, i })).filter((x) => x.it.textContent === text);
  expect(matches.length, `wheel has no rung "${text}"`);
  const ITEM_H = 34; // WHEEL_ITEM_H (focus/wheel.ts)
  const current = Math.round(wheel.scrollTop / ITEM_H);
  const nearest = matches.reduce((a, b) => (Math.abs(a.i - current) <= Math.abs(b.i - current) ? a : b));
  await cur.click(nearest.it);
  await cur.wait(650); // smooth roll + the 120ms snap
  if (Math.round(wheel.scrollTop / ITEM_H) !== nearest.i) {
    // Headless fallback (smoke runs): frame-less documents run neither smooth
    // scrolling NOR the scroll steps, so no scroll event ever fires on its own.
    // Set the position and dispatch the event by hand — the wheel's own
    // listener + snap timer then do their normal work.
    wheel.scrollTop = nearest.i * ITEM_H;
    wheel.dispatchEvent(new Event('scroll'));
    await new Promise((r) => setTimeout(r, 260)); // real time: the 120ms snap needs it
  }
}

/** Scene 9 — Focus setup: dial 1:45, SAVE IT AS A PRESET (a real feature),
 *  import the premium task and the first History task, pick Romantic Piano
 *  (a real library genre), scroll past the custom playlists, and start. */
const sceneFocusSetup: Scene = {
  name: 'focus-setup-preset-import-music',
  async run({ shell, cur }) {
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('focus'));
    await cur.waitFor('.focus-carousel', shell.body);
    await cur.wait(400);
    await cur.click(shell.chrome.menu);
    await cur.wait(360);

    // 1:45 on the H/M wheels, then "+ Preset" — the button appears carrying
    // data-seconds=6300, which doubles as the dial's own verification.
    const cols = [...shell.body.querySelectorAll<HTMLElement>('.focus-wheel-col')];
    await dialWheel(cur, cols[0], '01');
    await dialWheel(cur, cols[1], '45');
    await cur.wait(250);
    await cur.click(shell.body.querySelector('.focus-add-preset')!);
    await cur.waitFor('.focus-preset.custom[data-seconds="6300"]', shell.body);
    await cur.wait(500);

    // Import the two tasks for this session.
    await cur.click(shell.body.querySelector('.focus-import')!);
    await cur.waitFor('.focus-import-task', shell.body);
    const importByTitle = async (title: string): Promise<void> => {
      const row = await cur.waitForResult(
        () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes(title)),
        4000,
        `import row: ${title}`
      );
      await cur.click(row.querySelector('.focus-import-add')!);
      await cur.wait(320);
    };
    await importByTitle('get cobalt premium');
    // "Pick a historical figure" lives in the History project folder now, so it
    // sits under the panel's FOLDERS section: expand the folder row, then
    // import the single member (the + on the folder row would import all five).
    const folderRow = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-bulk')].find((r) => /history project/i.test(r.textContent ?? '')),
      4000,
      'History project row in the import panel'
    );
    await cur.click(folderRow, { ax: 0.35 });
    const member = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes('Pick a historical figure')),
      4000,
      'folder member: Pick a historical figure'
    );
    await cur.wait(300);
    await cur.click(member.querySelector('.focus-import-add')!);
    // Setup-screen todo rows are .focus-todo-row (the session's are .focus-todo-item).
    await cur.waitUntil(() => shell.body.querySelectorAll('.focus-todo-row').length >= 2, 4000, 'both imports landed in the session list');
    await cur.click(shell.body.querySelector('.focus-import')!); // tuck the panel away
    await cur.wait(350);

    // Romantic Piano — then drift DOWN past the custom playlists on the way to
    // Start (the vault note's "boasting a whole bunch of custom playlists").
    const romantic = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-music-coll')].find((r) => /romantic piano/i.test(r.textContent ?? '')),
      4000,
      'Romantic Piano row'
    );
    await cur.click(romantic);
    await cur.waitUntil(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-music-coll.active')].some((r) => /romantic piano/i.test(r.textContent ?? '')),
      3000,
      'Romantic Piano selected'
    );
    const musicList = shell.body.querySelector<HTMLElement>('.focus-music-list')!;
    await cur.scrollBy(musicList, 420, 800); // the customs scroll past
    await cur.wait(500);
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.scrollBy(scroller, scroller.scrollHeight, 700);
    await cur.click(shell.body.querySelector('.focus-start')!);
    await cur.waitFor('.focus-overlay', shell.body);
    await cur.wait(900); // the session lands — let the ring read
  },
};

/** Scene 10 — in session: import the algebra task from inside, reorder the two
 *  loose todos by drag, append to the premium todo's title, add a parsed todo
 *  ("in 2 days") and course it via the `misc` parse word, switch to the
 *  cross-genre custom playlist + volume nudge + favorite a track, trim exactly
 *  8 minutes with the ✎ wheels, minimize to the in-tab float and drag it, then
 *  head home to the Dashboard (the loop's landing pad). */
const sceneFocusSession: Scene = {
  name: 'focus-session-full',
  async run({ shell, cur }) {
    const ov = shell.body.querySelector<HTMLElement>('.focus-overlay')!;

    // Import "study for algebra 2 test" from the session's own Import panel.
    await cur.click(ov.querySelector('.focus-import')!);
    const impRow = await cur.waitForResult(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes('study for algebra 2 test')),
      4000,
      'in-session import row'
    );
    await cur.click(impRow.querySelector('.focus-import-add')!);
    await cur.waitUntil(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-text')].some((t) => (t.textContent ?? '').includes('study for algebra 2 test')),
      4000,
      'algebra task imported into the session'
    );
    await cur.click(ov.querySelector('.focus-import')!);
    await cur.wait(400);

    // Reorder the two LOOSE todos (premium + algebra; the History import lives
    // in its folder block and drags never cross groups — the app's own rule).
    const looseRows = (): HTMLElement[] =>
      [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].filter((r) => {
        const txt = r.textContent ?? '';
        return txt.includes('get cobalt premium') || txt.includes('study for algebra 2 test');
      });
    beat('reorder-start');
    let rows = looseRows();
    expect(rows.length === 2, 'expected the two loose session todos');
    const orderBefore = rows.map((r) => (r.textContent ?? '').includes('premium') ? 'prem' : 'math').join(',');
    await cur.dragRow(rows[0], rows[0].querySelector('.focus-todo-handle')!, rows[1]);
    await cur.waitUntil(() => {
      const now = looseRows().map((r) => (r.textContent ?? '').includes('premium') ? 'prem' : 'math').join(',');
      return now !== orderBefore && now.length === orderBefore.length;
    }, 4000, 'loose todos reordered by drag');
    await cur.wait(400);

    // Append to the premium todo's title (dblclick → the editor opens with the
    // text; typing appends; Enter commits).
    const premText = await cur.waitForResult(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-text')].find((t) => (t.textContent ?? '').includes('get cobalt premium')),
      3000,
      'premium todo'
    );
    beat('premium-append-dblclick');
    await cur.dblclick(premText);
    const editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', ov);
    beat('premium-append-editor-open');
    await cur.typeInto(editor, ' right after completing homework');
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-text')].some((t) => /right after completing homework/.test(t.textContent ?? '')),
      4000,
      'premium todo title appended'
    );
    await cur.wait(350);

    // Add a todo that PARSES: "in 2 days" becomes a real due date relative to
    // the visitor's today; then course it by typing the misc parse word.
    const input = ov.querySelector<HTMLTextAreaElement>('.focus-todo-input')!;
    await cur.click(input);
    await cur.typeInto(input, 'start working on speech in 2 days');
    await cur.wait(300);
    await cur.click(ov.querySelector('.focus-add-btn')!);
    const speechRow = await cur.waitForResult(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].find((r) => (r.textContent ?? '').includes('start working on speech')),
      4000,
      'speech todo added (date parsed out of the title)'
    );
    expect(!/in 2 days/.test(speechRow.querySelector('.focus-todo-text')?.textContent ?? ''), 'date words should have parsed OUT of the title');

    // The auto-translate pass runs on every typed task and its write-back
    // REDRAWS the todo list a beat later — clicking a chip captured before
    // that redraw lands on a detached row. Wait for the pass to settle, then
    // find the row FRESH.
    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      const t = Object.values(all).find((x) => x.title === 'start working on speech');
      return !!t && t.translationChecked === true;
    }, 6000, 'translate pass settled on the speech task');
    await cur.wait(300);
    const speechRowFresh = await cur.waitForResult(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].find((r) => (r.textContent ?? '').includes('start working on speech')),
      3000,
      'speech todo (post-translate redraw)'
    );
    beat('speech-course-chip');
    await cur.click(speechRowFresh.querySelector('.course-chip.empty')!);
    const courseEd = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', ov);
    beat('speech-course-editor-open');
    await cur.typeInto(courseEd, 'misc');
    cur.pressKey(courseEd, 'Enter');
    await cur.waitUntil(
      () => /miscellaneous/i.test(speechRow.textContent ?? '') || [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].some((r) => (r.textContent ?? '').includes('start working on speech') && /miscellaneous/i.test(r.textContent ?? '')),
      4000,
      'speech todo coursed via the misc parse word'
    );
    await cur.wait(400);

    // Music: 🎵 menu → Switch ▸ → the cross-genre custom playlist → volume
    // nudge → heart a track → close.
    const musicBtn = [...ov.querySelectorAll<HTMLElement>('.focus-music-ctrl')].find((b) => b.textContent === '🎵')!;
    await cur.click(musicBtn);
    // Scope EVERYTHING to the menu element: the setup screen's music list still
    // exists in the tab panel behind the overlay and matches similar text.
    const menu = await cur.waitFor<HTMLElement>('.focus-music-menu', shell.body);
    await cur.click(await cur.waitFor('.focus-menu-switch', menu));
    const mix = await cur.waitForResult(
      () => [...menu.querySelectorAll<HTMLElement>('.focus-menu-track')].find((r) => /deep work mix/i.test(r.textContent ?? '')),
      4000,
      'Deep Work Mix row in the browse menu'
    );
    await cur.click(mix);
    await cur.waitUntil(
      () => /deep work mix/i.test(menu.querySelector('.focus-menu-switch-label')?.textContent ?? ''),
      4000,
      'queue switched to Deep Work Mix'
    );
    beat('mix-switched');
    const vol = await cur.waitFor<HTMLInputElement>('.focus-vol-slider', menu);
    await cur.moveTo(vol);
    vol.value = String(Math.max(0, Number(vol.value) * 0.75));
    vol.dispatchEvent(new Event('input', { bubbles: true }));
    await cur.wait(300);
    const heart = await cur.waitForResult(
      () => menu.querySelector<HTMLElement>('.focus-menu-track .focus-fav'),
      3000,
      'a track heart in the queue'
    );
    await cur.click(heart);
    await cur.wait(350);
    await cur.click(musicBtn); // close the menu
    await cur.wait(300);

    // Trim EXACTLY 8 minutes via the ✎ wheels (defaults to 5 → dial 08 → Trim).
    const timeText = (): string => ov.querySelector('.focus-time')?.textContent ?? '';
    const toSecs = (t: string): number => t.split(':').map(Number).reduce((a, b) => a * 60 + b, 0);
    const before = toSecs(timeText());
    await cur.click(ov.querySelector('.focus-extend-row.trim .focus-extend-btn.custom')!);
    const modal = await cur.waitFor<HTMLElement>('.focus-extend-modal', shell.body);
    const mCols = [...modal.querySelectorAll<HTMLElement>('.focus-wheel-col')];
    await dialWheel(cur, mCols[1], '08');
    const trimBtn = [...modal.querySelectorAll<HTMLElement>('button')].find((b) => /^trim$/i.test(b.textContent ?? ''));
    expect(trimBtn, 'Trim confirm missing from the custom popup');
    await cur.click(trimBtn!);
    await cur.waitUntil(() => {
      const d = before - toSecs(timeText());
      return d >= 470 && d <= 495; // 8:00 minus the seconds that ticked by
    }, 4000, 'timer trimmed by exactly 8 minutes');
    await cur.wait(600);

    // Minimize → the in-tab float (sample mode never grabs a real PiP window),
    // drag it toward the corner, then home to the Dashboard. The float rides
    // over the app — exactly what the mini session does for real.
    await cur.click(ov.querySelector('.focus-min-btn')!);
    const widget = await cur.waitFor<HTMLElement>('.focus-widget', shell.body);
    await cur.wait(500);
    await cur.dragPointer(widget, 150, 100);
    await cur.wait(400);
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('dashboard'));
    await cur.wait(600);
    await cur.click(shell.chrome.menu);
    await cur.wait(500); // rest on the dashboard: the loop's seam hides here
  },
};

const SCENES: Scene[] = [
  sceneDashboard,
  sceneTasksBulk,
  sceneHistoryProject,
  sceneQuickAdd,
  scenePremiumAndCourse,
  sceneEssayAttachments,
  sceneCalendar,
  sceneBookmarks,
  sceneFocusSetup,
  sceneFocusSession,
];
// #endregion

// #region Runner ---------------------------------------------------------------

export interface HeroDemo {
  stop(): void;
}

export interface HeroDemoOpts {
  /** Smoke-test mode: no animation, no delays, throw on first scene failure. */
  instant?: boolean;
  /** Loop at most this many times (default: forever). */
  loops?: number;
  /** Called after each full loop (the smoke runner uses this). */
  onLoop?: (loop: number) => void;
}

/** scaleToFit, demo copy: same contract as landing/view.ts's (module-local
 *  there). Kept tiny and private — the stage is the only consumer here. */
function fitInto(stage: HTMLElement, target: HTMLElement, designWidth: number): void {
  const wrap = el('div', { class: 'lp-fit' });
  wrap.append(target);
  const apply = (): void => {
    const w = wrap.clientWidth;
    if (!w) return;
    const s = Math.min(1, w / designWidth);
    target.style.transform = s < 1 ? `scale(${s})` : 'translateZ(0)';
    wrap.style.height = s < 1 ? `${target.offsetHeight * s}px` : '';
  };
  const ro = new ResizeObserver(apply);
  ro.observe(wrap);
  ro.observe(target);
  stage.replaceChildren(wrap);
  apply();
}

export function startHeroDemo(stage: HTMLElement, opts: HeroDemoOpts = {}): HeroDemo {
  // MUTE THE APP'S INCIDENTAL SOUNDS FOR AS LONG AS THE DEMO RUNS. The ghost cursor
  // dispatches real events, so a scripted check-off rang the real chime — on a
  // loop, on the landing page, with no way for a visitor to turn it off (see
  // tasks/complete.ts setDemoSilent).
  setDemoSilent(true);
  let stopped = false;
  let shell: DemoShell | null = null;
  let cur: GhostCursor | null = null;

  // Visibility gate — default OPEN so environments without IO still run.
  let visible = true;
  if ('IntersectionObserver' in window && !opts.instant) {
    const io = new IntersectionObserver(([e]) => (visible = e.isIntersecting), { threshold: 0.12 });
    io.observe(stage);
  }
  const gate = async (): Promise<void> => {
    while (!visible && !stopped) await new Promise((r) => setTimeout(r, 350));
  };

  const loop = async (): Promise<void> => {
    let n = 0;
    while (!stopped && stage.isConnected && (opts.loops === undefined || n < opts.loops)) {
      shell = await buildDemoShell();
      cur = new GhostCursor(shell.body, { instant: opts.instant });
      fitInto(stage, shell.root, 1040);
      // Let first paint + the views' initial subscriptions settle.
      await new Promise((r) => setTimeout(r, opts.instant ? 30 : 350));

      for (const scene of SCENES) {
        if (stopped || !stage.isConnected) break;
        await gate();
        try {
          await scene.run({ shell, cur });
        } catch (err) {
          if (opts.instant) throw new Error(`[${scene.name}] ${(err as Error).message}`); // smoke mode: fail loudly, name the scene
          console.warn(`[cobalt demo] scene "${scene.name}" failed, restarting loop:`, err);
          break;
        }
      }

      n++;
      opts.onLoop?.(n);
      if (stopped || !stage.isConnected) break;

      // The seam: fade the whole screen, rebuild the world, fade back in. The
      // next loop opens on the same Dashboard the last scene returned to, so
      // the restart reads as a cut in one continuous session.
      if (!opts.instant) {
        shell.root.classList.add('leaving');
        await new Promise((r) => setTimeout(r, 650));
      }
      cur.destroy();
      shell.destroy();
      shell = null;
      cur = null;
    }
    cur?.destroy();
    shell?.destroy();
  };

  void loop();

  return {
    stop() {
      stopped = true;
      setDemoSilent(false); // hand the app's sounds back
      cur?.destroy();
      shell?.destroy();
    },
  };
}
// #endregion
