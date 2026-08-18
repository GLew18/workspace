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
import { setDemoSilent } from '../../util/silence';
import { buildDemoShell, type DemoShell } from './shell';
import { GhostCursor } from './cursor';

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

// The 8/16 callout/pulse emphasis layer was REMOVED on 8/17 (Gabe: no popups,
// no highlight glows). Emphasis now comes from realism alone: every marquee
// beat is STAGED so its input and output stay inside the visible frame from
// start to finish, and the pace lingers on the output before moving on.

// #region Scenes -------------------------------------------------------------

/** Scene 1 — Dan lands on the Dashboard and takes it in: greeting, quote,
 *  today's tasks, the week's schedule — all inside one un-scrolled view.
 *  (The briefing-notification card was REMOVED entirely, Gabe 8/17.) */
const sceneDashboard: Scene = {
  name: 'dashboard-open',
  async run({ shell, cur }) {
    // The whole dashboard must fit the fold — the smoke run guards it so a
    // future seed change can't quietly push the schedule card off screen.
    const app = shell.body.querySelector<HTMLElement>('.app')!;
    expect(app.scrollHeight <= app.clientHeight + 1, 'dashboard (incl. schedule) must fit the frame without scrolling');
    await cur.wait(650);
    await cur.moveTo({ x: 640, y: 320 }, { slow: 1.25 }); // drift in like a hand settling
    await cur.wait(1900); // the screen reads on its own
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
    await cur.fresh(
      () => [...shell.body.querySelectorAll<HTMLElement>('.task-item[data-task-id="dan_read"]')].find((x) => x.offsetParent !== null),
      'tasks list rendered'
    );
    await cur.wait(350);
    await cur.click(shell.chrome.menu); // tuck the drawer away for the full list
    await cur.wait(400);

    // No scroll tour: the seed is sized to fit one view (Gabe, 8/16), so the
    // list reads at a glance and the selection is the first beat.
    await cur.wait(500);

    // Query at USE time (the view re-renders once its async load settles; a
    // row captured before that redraw is detached and its rect is garbage),
    // and VISIBLE only (the hidden dashboard panel holds look-alike rows).
    const freshRow = (id: string): Promise<HTMLElement> =>
      cur.fresh(
        () =>
          [...shell.body.querySelectorAll<HTMLElement>(`.task-item[data-task-id="${id}"]`)].find(
            (x) => x.offsetParent !== null
          ),
        id
      );
    await cur.click(await freshRow('dan_lab'), { shift: true, ax: 0.55, ay: 0.5 });
    await cur.wait(180);
    await cur.click(await freshRow('dan_read'), { shift: true, ax: 0.55, ay: 0.5 });
    expect(
      (await freshRow('dan_read')).classList.contains('selected') && (await freshRow('dan_lab')).classList.contains('selected'),
      'bulk select did not take'
    );
    await cur.wait(320);

    await cur.click(await cur.fresh(() => row(shell, 'dan_read').querySelector<HTMLElement>('.task-cb'), 'read checkbox'));
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
    await cur.wait(500);
  },
};

/** Find the VISIBLE task row by data id. The dashboard's hidden tab panel
 *  keeps its own .task-item rows in the DOM, so a bare querySelector can hand
 *  back an invisible duplicate — always filter to the row that's actually on
 *  screen. (Rows also re-render constantly; never cache them.) */
const row = (shell: DemoShell, id: string): HTMLElement => {
  const r = [...shell.body.querySelectorAll<HTMLElement>(`.task-item[data-task-id="${id}"]`)].find(
    (x) => x.offsetParent !== null
  );
  if (!r) throw new Error(`task row not on screen: ${id}`);
  return r;
};

/** Cobalt's OWN color card (ui/colorPicker.ts — built 8/17 so color picking
 *  could be a real, in-frame, draggable interaction instead of the OS dialog):
 *  open it from a swatch, DRAG the circle across the square, slide the hue,
 *  and leave the choice set. The caller's next outside click closes the card,
 *  exactly how the control works in the app. */
async function pickColor(ctx: DemoCtx, swatch: Element): Promise<void> {
  const { shell, cur } = ctx;
  await cur.click(swatch);
  const pop = await cur.waitFor<HTMLElement>('.cp-pop', shell.body);
  const sq = pop.querySelector<HTMLElement>('.cp-sq')!;
  await cur.dragPointer(sq, 34, -20); // the circle rides toward richer + brighter
  await cur.wait(300);
  const hue = pop.querySelector<HTMLElement>('.cp-hue')!;
  await cur.dragPointer(hue, 26, 0); // and the hue bar gets its own slide
  await cur.wait(450); // the chosen color reads on the live chip
}

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

/** Scene 3 — the Social Studies project: Dan duplicates "Research your assigned
 *  figure", renames the copy into an intermediary step, then files the whole
 *  chain into a "Social Studies project" folder. Duplicate lives in the ⋯ menu (the
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
    // ax 0.1: the title DIV spans the whole row width — its center is blank
    // space half a screen from the words. Land the hand ON the text.
    await cur.dblclick(row(shell, dupId).querySelector('.task-title')!, { ax: 0.1 });
    const editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.retype(editor, 'Find reliable sources');
    await cur.wait(160);
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(async () => (await shell.data.getTasksAll())[dupId]?.title === 'Find reliable sources', 4000, 'duplicate renamed');
    // The output: a duplicated row wearing its new name.
    await cur.wait(600);

    // Sources come BEFORE research: Dan pulls the copy two days earlier via
    // the real inline date editor. The row physically moves to its own day —
    // an input whose output is the list re-sorting itself.
    const dd = new Date();
    dd.setDate(dd.getDate() + 2);
    const dupMd = `${dd.getMonth() + 1}/${dd.getDate()}`;
    const dupIso = `${dd.getFullYear()}-${String(dd.getMonth() + 1).padStart(2, '0')}-${String(dd.getDate()).padStart(2, '0')}`;
    await cur.click(row(shell, dupId).querySelector('.meta-date')!);
    const dateEd = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.retype(dateEd, dupMd);
    await cur.wait(220); // the human beat before committing
    cur.pressKey(dateEd, 'Enter');
    await cur.waitUntil(async () => (await shell.data.getTasksAll())[dupId]?.dueDate === dupIso, 4000, 'duplicate re-dated two days out');
    await cur.wait(700);

    // Range-select the chain the way the app actually works (Gabe, 8/16):
    // ctrl-click anchors the first row, shift-click the last row sweeps
    // EVERYTHING between — the essay's day sits between the two chain days,
    // so it gets swept in. Dan then deselects the one row that doesn't
    // belong. No skipping, ever.
    const chain = [dupId, 'dan_hp2'];
    const chainRows = [...shell.body.querySelectorAll<HTMLElement>('.task-item[data-task-id]')]
      .filter((r) => chain.includes(r.dataset.taskId!));
    await cur.click(chainRows[0], { ctrl: true, ax: 0.6 });
    await cur.wait(200);
    await cur.click(chainRows[chainRows.length - 1], { shift: true, ax: 0.6 });
    expect(
      row(shell, 'dan_essay').classList.contains('selected'),
      'the essay sits inside the range and must select with it (real range behavior)'
    );
    await cur.wait(420); // let the over-selection read before Dan fixes it
    await cur.click(row(shell, 'dan_essay'), { ctrl: true, ax: 0.6 });
    await cur.wait(160);
    expect(
      chain.every((id) => row(shell, id).classList.contains('selected')) &&
        !row(shell, 'dan_essay').classList.contains('selected'),
      'history chain selected with the essay toggled back off'
    );

    // File them: ⋯ → Add to folder → "+ New folder…" → type the name → Enter.
    await moreMenu(ctx, 'dan_hp2', /folder/i);
    await cur.waitFor('.folder-pick', shell.body);
    const nameIn = shell.body.querySelector<HTMLTextAreaElement>('.folder-pick-input')!;
    // A real hand CLICKS the field before typing (nothing autofocuses it).
    await cur.click(nameIn);
    await cur.wait(180);
    await cur.typeInto(nameIn, 'Social Studies project');
    await cur.wait(140);
    cur.pressKey(nameIn, 'Enter');

    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      const fids = new Set(chain.map((id) => all[id]?.folderId).filter(Boolean));
      return fids.size === 1;
    }, 4000, 'all chain tasks filed into one folder');
    await cur.waitFor('.task-folder-name', shell.body);
    await cur.wait(650); // let the folder block read
    // The selection survives a folder action (that's the app's contract) — Dan
    // clears it the way the bar itself says to: one click on "Deselect all".
    const clearBtn = shell.body.querySelector<HTMLElement>('.selbar-clear');
    if (clearBtn) {
      await cur.click(clearBtn);
      await cur.wait(300);
    }

    // MANUAL PRIORITY, demonstrated here (Gabe, 8/17: imports arrive normal,
    // Dan is the only priority-setter): the research task gets a High arrow,
    // right in the folder block he just built, fully in view.
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.ensureInView(scroller, row(shell, 'dan_hp2'));
    await cur.click(row(shell, 'dan_hp2').querySelector('.task-actions button[title="Priority"]')!);
    await cur.waitFor('.priority-option', shell.body);
    const high = [...shell.body.querySelectorAll<HTMLElement>('.priority-option')].find(
      (b) => /high/i.test(b.textContent ?? '') && !/very/i.test(b.textContent ?? '')
    );
    expect(high, 'High missing from the priority popup');
    await cur.wait(240);
    await cur.click(
      await cur.fresh(
        () => [...shell.body.querySelectorAll<HTMLElement>('.priority-option')].find((b) => /high/i.test(b.textContent ?? '') && !/very/i.test(b.textContent ?? '')),
        'High option'
      )
    );
    await cur.waitUntil(async () => (await shell.data.getTasksAll())['dan_hp2']?.priority === 'high', 4000, 'research task set to High by hand');
    await cur.wait(600);

    // Park the list at the top before the quick-add beat: its input and
    // output must both be in frame BEFORE the typing starts (marquee rule).
    if (scroller.scrollTop > 0) await cur.scrollBy(scroller, -scroller.scrollTop, 600);
  },
};

/** Scene 4 — the quick-add parser: one line in, a fully tagged task out.
 *  `h`, not `hi`: `hi` is deliberately NOT a priority token (priorities.ts). */
const sceneQuickAdd: Scene = {
  name: 'quickadd-parse',
  async run({ shell, cur }) {
    // MARQUEE RULE (Gabe, 8/17): the input (quick-add bar) and the output (the
    // new row, which lands in Today directly beneath it) are BOTH in frame
    // before typing starts, and the camera never moves until the beat is over.
    // Scene 3 already parked the list at the top — zero scrolling here.
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    expect(scroller.scrollTop === 0, 'quick-add beat must open with the list parked at the top');
    // Fresh at use: scene 3's writes are still committing, and each commit
    // redraws the panel (a stale textarea = typing into a detached corpse).
    const input = await cur.fresh(() => shell.body.querySelector<HTMLTextAreaElement>('.quick-add textarea'), 'quick-add bar');
    await cur.click(input);
    // Natural language WITH the priority token (Gabe, 8/17): the parser eats
    // "math" (course), "today" (date) AND "high" — the new row outranks the
    // 8am tasks and lands at the very top of Today, fully in view. (Manual
    // priority got its own beat back in the folder scene.)
    await cur.typeInto(input, 'study for algebra 2 test math today high');
    await cur.wait(420); // a beat to let the line read before it transforms
    cur.pressKey(input, 'Enter');
    let newId = '';
    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      const hit = Object.values(all).find(
        (t) => t.title === 'study for algebra 2 test' && t.course === 'Math' && !!t.dueDate && t.priority === 'high'
      );
      if (hit) newId = hit.id;
      return !!hit;
    }, 4000, 'quick-add parsed course + date + priority out of the typed line');
    // The output is born in view: the cursor walks from the bar to the new row
    // and lingers on it so the words → task transformation registers.
    const newRow = await cur.fresh(
      () =>
        [...shell.body.querySelectorAll<HTMLElement>(`.task-item[data-task-id="${newId}"]`)].find(
          (x) => x.offsetParent !== null
        ),
      'new task row on screen'
    );
    // The marquee rule, ASSERTED: the born row must sit inside the visible
    // viewport (the folder block above it eats ~300px, so this is a real check).
    const rowRect = newRow.getBoundingClientRect();
    const scRect = scroller.getBoundingClientRect();
    expect(rowRect.bottom <= scRect.bottom + 2 && rowRect.top >= scRect.top - 2, 'the new task must be born IN VIEW');
    await cur.moveTo(newRow);
    // The token did ALL the work — course, date, AND the red High arrow are
    // already on the row. No redundant arrow re-set (Gabe, 8/17): manual
    // priority has its own beat in the folder scene.
    await cur.wait(1600); // let the birth read before anything else moves
  },
};

/** Scene 5 — Dan shapes the "get cobalt premium" task: due today, very high
 *  priority; then builds a real `cobalt` course in Settings (name, color,
 *  parse word `cob`) and tags the task with it by typing the parse word. */
const scenePremiumAndCourse: Scene = {
  name: 'premium-edits-cobalt-course',
  async run({ shell, cur }) {
    // The premium row lives in the LAST group (no due date) — bring it into
    // frame with a real wheel scroll BEFORE touching it (marquee rule).
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.ensureInView(scroller, row(shell, 'dan_prem'));
    // Due date: the row's "+ due date" chip → inline editor → today's M/D.
    const today = new Date();
    const md = `${today.getMonth() + 1}/${today.getDate()}`;
    await cur.click(row(shell, 'dan_prem').querySelector('.meta-date')!);
    let editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.typeInto(editor, md);
    await cur.wait(220);
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(async () => !!(await shell.data.getTasksAll())['dan_prem']?.dueDate, 4000, 'premium task dated today');
    // Dating the task MOVED it: it re-sorted out of "No due date" into the
    // Today group near the top. Re-stage before touching it again — clicking
    // the row at its OLD position is exactly the off-screen bug (Gabe, 8/17).
    await cur.ensureInView(scroller, row(shell, 'dan_prem'));
    await cur.wait(300);

    // Priority: the permanent arrow button → Very High.
    await cur.click(row(shell, 'dan_prem').querySelector('.task-actions button[title="Priority"]')!);
    await cur.waitFor('.priority-option', shell.body);
    const veryHigh = [...shell.body.querySelectorAll<HTMLElement>('.priority-option')].find((b) => /very high/i.test(b.textContent ?? ''));
    expect(veryHigh, 'Very High missing from the priority popup');
    await cur.wait(240);
    await cur.click(
      await cur.fresh(
        () => [...shell.body.querySelectorAll<HTMLElement>('.priority-option')].find((b) => /very high/i.test(b.textContent ?? '')),
        'Very High option'
      )
    );
    await cur.waitUntil(async () => (await shell.data.getTasksAll())['dan_prem']?.priority === 'highest', 4000, 'priority set to Very High');
    await cur.wait(350);

    // Settings ▸ Courses: gear → Courses tab → + Add course → name/color/parse word.
    await cur.click(shell.chrome.gear);
    const coursesBtn = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.settings-side-btn')].find((b) => /courses/i.test(b.textContent ?? '')),
      4000,
      'settings sidebar rendered'
    );
    // The shared .app scroller carries the Tasks tab's position in — park it.
    if (scroller.scrollTop > 0) await cur.scrollBy(scroller, -scroller.scrollTop, 400);
    await cur.wait(400);
    await cur.click(coursesBtn);
    await cur.wait(600); // orientation: a new screen deserves a beat
    // Seven seeded courses put "+ Add course" ~250px below the fold — wheel
    // down to it for real before clicking (no off-frame clicks, ever).
    const addCourse = await cur.waitFor<HTMLElement>('.settings-add', shell.body);
    // 170px of headroom: the new course card is INSERTED ABOVE this button and
    // needs the room, or it's born straddling the fold.
    await cur.ensureInView(scroller, addCourse, 170);
    await cur.click(addCourse);
    const nameIn = await cur.waitFor<HTMLTextAreaElement>('.course-row:last-child .course-name', shell.body);
    // The WHOLE new course card in frame (name, color, parse words + the
    // recommendation chips that appear under it) before anything is typed.
    await cur.ensureInView(scroller, shell.body.querySelector('.course-row:last-child')!, 110);
    await cur.moveTo(nameIn);
    await cur.retype(nameIn, 'Cobalt');
    await cur.wait(200);

    // Color: Cobalt's own color card — Dan drags the circle and slides the
    // hue for real (Gabe, 8/17). The swatch click also blurs the name field,
    // which commits "Cobalt" and makes the recommendation chips appear.
    const swatch = await cur.fresh(
      () => shell.body.querySelector<HTMLElement>('.course-row:last-child .course-color'),
      'course color swatch'
    );
    await pickColor({ shell, cur }, swatch);

    // Parse word: Dan ACCEPTS the app's own recommendation — the "+coba" chip
    // the row suggests for "Cobalt" (Gabe, 8/17: press it, don't type it). The
    // chips render once the name lands, which the color-swatch click's blur
    // already committed.
    const recChip = await cur.waitForResult(
      () =>
        [...shell.body.querySelectorAll<HTMLElement>('.course-row:last-child .parse-rec')].find((b) =>
          (b.textContent ?? '').includes('coba')
        ),
      4000,
      'the "+coba" recommendation chip'
    );
    await cur.ensureInView(scroller, recChip);
    await cur.click(recChip);
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; parseWords?: string[] }> }>('courses');
      const c = prof?.list?.find((x) => x.name === 'Cobalt');
      return !!c && (c.parseWords ?? []).includes('coba');
    }, 4000, 'Cobalt course saved with the recommended parse word coba');
    await cur.wait(450);

    // Back to Tasks; tag the task by typing the parse word into its course chip.
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('tasks'));
    await cur.waitFor('.task-item[data-task-id="dan_prem"]', shell.body);
    // Park the inherited Settings scroll before the first visible beat.
    if (scroller.scrollTop > 0) await cur.scrollBy(scroller, -scroller.scrollTop, 400);
    await cur.wait(250);
    await cur.click(shell.chrome.menu);
    await cur.wait(380);
    // The row was re-dated to TODAY a moment ago, so it now lives in the Today
    // group — still, never assume: stage it into frame before the chip click.
    await cur.ensureInView(scroller, row(shell, 'dan_prem'));
    await cur.click(row(shell, 'dan_prem').querySelector('.course-chip')!);
    editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', shell.body);
    await cur.retype(editor, 'coba');
    await cur.wait(200);
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(async () => (await shell.data.getTasksAll())['dan_prem']?.course === 'Cobalt', 4000, 'parse word retagged the task to Cobalt');
    // The output: the chip flips to the course Dan just invented. Show it.
    await cur.wait(1000);
  },
};

/** Scene 6 — the essay's description (auto-linked rubric URL at the end) and
 *  attachments: the Rubric is ALREADY there (the import's link extraction put
 *  it there), Dan adds his own "essay doc" link beside it. */
const sceneEssayAttachments: Scene = {
  name: 'essay-description-attachments',
  async run({ shell, cur }) {
    // Stage the essay row into frame first — the list has grown by a folder
    // block and two new tasks since the last time it was at the top.
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.ensureInView(scroller, row(shell, 'dan_essay'));
    await cur.click(row(shell, 'dan_essay').querySelector('.task-actions button[title="Description"]')!);
    const back = await cur.waitFor<HTMLElement>('.popup-backdrop', shell.body);
    expect(back.querySelector('a[href*="rubric" i], a[href*="docs.google" i]'), 'description did not auto-link the rubric URL');
    await cur.wait(3400); // an actual READING beat: the auto-linked rubric URL is the payoff
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
    await cur.paste(fields[1], 'https://docs.google.com/document/d/dan-essay-doc');
    const done = [...editing.querySelectorAll<HTMLElement>('button')].find((b) => /done/i.test(b.textContent ?? ''));
    expect(done, 'attachment editor has no Done button');
    await cur.click(done!);
    await cur.waitUntil(async () => ((await shell.data.getTasksAll())['dan_essay']?.notes?.length ?? 0) === 2, 4000, 'essay doc attached');
    // The output: a second attachment row, sitting next to the auto-imported
    // Rubric. Give it its pulse before the popup closes.
    await cur.wait(1000);
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

    // The History folder carries its OWN calendar in this mode — open it via
    // the ▶ arrow: the head's center is the name span, where the real click
    // handler deliberately does nothing (an off-limits pixel for a real mouse).
    const folderHead = [...shell.body.querySelectorAll<HTMLElement>('.task-folder-head')].find((h) => /social studies project/i.test(h.textContent ?? ''));
    expect(folderHead, 'Social Studies project folder missing in calendar mode');
    if (!folderHead!.closest('.task-folder')!.classList.contains('open')) {
      const arrowEl = folderHead!.querySelector<HTMLElement>('.task-folder-arrow');
      await cur.click(arrowEl ?? folderHead!, { ax: arrowEl ? 0.5 : 0.9 });
    }
    await cur.waitFor('.task-folder-body.cal-scope .cal-grid', shell.body);
    await cur.wait(1400); // the scoped calendar is the beat — the whole month fits the frame now

    // …and CLOSE it again (Gabe, 8/17): open-then-close is what tells the
    // viewer the folder OWNS its own calendar inside the bigger one.
    const headNow = (): HTMLElement =>
      [...shell.body.querySelectorAll<HTMLElement>('.task-folder-head')].find((h) => /social studies project/i.test(h.textContent ?? ''))!;
    const closeArrow = headNow().querySelector<HTMLElement>('.task-folder-arrow');
    await cur.click(closeArrow ?? headNow(), { ax: closeArrow ? 0.5 : 0.9 });
    await cur.waitUntil(() => !shell.body.querySelector('.task-folder-body.cal-scope .cal-grid'), 3000, 'scoped calendar folded away');
    await cur.wait(500);

    // The GENERAL calendar (every unfoldered task) sits right below — bring it
    // fully into frame and let it read.
    const generalGrid = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.cal-grid')].find((g) => !g.closest('.task-folder-body')),
      3000,
      'the general calendar grid'
    );
    await cur.ensureInView(scroller, generalGrid, 30);
    await cur.wait(1200);

    // Hop a month out and back on the shared toolbar. The Today button joins
    // .cal-nav-btn the moment the view leaves this month — select the REAL
    // arrows by exclusion or the way back lands on Today instead of ‹.
    const arrows = (): HTMLElement[] =>
      [...shell.body.querySelectorAll<HTMLElement>('.cal-nav-btn:not(.cal-today)')];
    const barEl = shell.body.querySelector<HTMLElement>('.cal-bar')!;
    await cur.ensureInView(scroller, barEl, 30); // the arrows must be ON screen to be pressed
    const label = shell.body.querySelector<HTMLElement>('.cal-label')!;
    const before = label.textContent;
    await cur.click(arrows()[arrows().length - 1]); // ›
    await cur.waitUntil(() => shell.body.querySelector('.cal-label')?.textContent !== before, 3000, 'calendar advanced a month');
    await cur.wait(750);
    await cur.click(arrows()[0]); // ‹
    await cur.waitUntil(() => shell.body.querySelector('.cal-label')?.textContent === before, 3000, 'calendar returned to this month');
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
    // Park the inherited scroll on entry (shared .app scroller).
    const bmScroller = shell.body.querySelector<HTMLElement>('.app')!;
    if (bmScroller.scrollTop > 0) await cur.scrollBy(bmScroller, -bmScroller.scrollTop, 400);
    await cur.wait(300);
    await cur.click(shell.chrome.menu);
    await cur.wait(380);

    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    const addLink = async (name: string, url: string): Promise<void> => {
      const addBtn = shell.body.querySelector<HTMLElement>('.bm-add-btn')!;
      await cur.ensureInView(scroller, addBtn); // it drifts down as cards land
      await cur.click(addBtn);
      const modal = await cur.waitFor<HTMLElement>('.bm-modal', shell.body);
      const inputs = modal.querySelectorAll<HTMLTextAreaElement>('.bm-input');
      await cur.click(inputs[0]);
      await cur.typeInto(inputs[0], name);
      await cur.click(inputs[1]);
      await cur.paste(inputs[1], url);
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

    // BULK SELECT both new cards (the 8/16 feature), then one group action
    // covers the pair. The selection bar must appear INSIDE the demo screen.
    await cur.click(cardOf('Desmos'), { ctrl: true, ay: 0.2 });
    await cur.wait(200);
    await cur.click(cardOf('GeoGebra'), { ctrl: true, ay: 0.2 });
    await cur.waitUntil(() => {
      const bar = shell.body.querySelector<HTMLElement>('.selbar');
      return !!bar && !bar.hidden && /2 links selected/i.test(bar.textContent ?? '');
    }, 3000, 'selection bar shows 2 links selected inside the frame');
    await cur.wait(500);
    await cur.click(cardOf('Desmos').querySelector('.bm-chip-btn')!);
    // The picker shares the Tasks folder-picker anatomy (8/16 rebuild): color
    // well + "+ New group…" input, Enter creates and assigns to the selection.
    const picker = await cur.waitFor<HTMLElement>('.bm-backdrop .folder-pick', shell.body);
    // Group color via Cobalt's own color card — same drag-the-circle gesture
    // as the course color (Gabe, 8/17: the rgb card is integral everywhere).
    const groupColor = [...picker.querySelectorAll<HTMLElement>('.folder-pick-color')].pop()!; // the NEW-group well is last
    await pickColor({ shell, cur }, groupColor);
    const groupName = picker.querySelector<HTMLTextAreaElement>('.folder-pick-input')!;
    await cur.click(groupName); // this outside click also folds the color card away
    await cur.typeInto(groupName, 'Math');
    await cur.wait(150);
    cur.pressKey(groupName, 'Enter');
    // ONE action, BOTH cards: the picker applies to the whole selection.
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; groupId?: string }>; groups?: Array<{ name: string }> }>('bookmarks');
      const d = prof?.list?.find((b) => b.name === 'Desmos');
      const g = prof?.list?.find((b) => b.name === 'GeoGebra');
      return !!prof?.groups?.some((gr) => gr.name === 'Math') && !!d?.groupId && d.groupId === g?.groupId;
    }, 4000, 'bulk group action put BOTH links into Math');
    await cur.wait(450);
    // Creating auto-assigns and closes the picker (view.ts pick()). The group
    // block now leads the page — let the reflow (incl. the popup-guide button
    // appearing) settle so the money shot lands on a still frame.
    await cur.wait(900);
    // Clear the selection the way the bar itself says to: one click on its
    // own "Deselect all" (the shortcut chip is gated while a multi-selection
    // is live, and that gate is real app behavior).
    await cur.click(shell.body.querySelector('.selbar-clear')!);
    await cur.waitUntil(() => !shell.body.querySelector('.bm-card.selected'), 3000, 'selection cleared before the shortcut beat');
    await cur.wait(250);

    // The in-app shortcut: capture box → Alt+Shift+D → Save. (Alt+D is on the
    // app's own reserved-combo blocklist — the browser owns it — and the demo
    // must only show combos the real recorder accepts.)
    const chips = cardOf('Desmos').querySelectorAll<HTMLElement>('.bm-chip-btn');
    await cur.click(chips[1]);
    const keysBox = await cur.waitFor<HTMLElement>('.bm-keys-box', shell.body);
    await cur.click(keysBox); // focuses the box — the recorder requires it
    await cur.wait(350);
    // A real keyboard lands the combo one key at a time, and the recorder's
    // building label ("Alt + …") narrates each step — show that.
    cur.pressKey(keysBox, 'Alt', { alt: true });
    await cur.wait(260);
    cur.pressKey(keysBox, 'Shift', { alt: true, shift: true });
    await cur.wait(260);
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

/** Dial a wheel column to a value BY SCROLLING it — the way a hand actually
 *  works a picker wheel. (The old approach clicked the target rung, but the
 *  mask hides everything beyond ~1 rung from center: the cursor was clicking
 *  rungs the viewer literally cannot see.) scrollBy hovers the wheel, eases
 *  scrollTop, and the wheel's own scroll listener does recenter/snap/value —
 *  the same code path a real trackpad drives. */
async function dialWheel(cur: GhostCursor, col: HTMLElement, text: string): Promise<void> {
  const wheel = col.querySelector<HTMLElement>('.focus-wheel')!;
  const items = [...wheel.querySelectorAll<HTMLElement>('.focus-wheel-item')];
  const matches = items.map((it, i) => ({ it, i })).filter((x) => x.it.textContent === text);
  expect(matches.length, `wheel has no rung "${text}"`);
  const ITEM_H = 34; // WHEEL_ITEM_H (focus/wheel.ts)
  const current = Math.round(wheel.scrollTop / ITEM_H);
  const nearest = matches.reduce((a, b) => (Math.abs(a.i - current) <= Math.abs(b.i - current) ? a : b));
  const dy = nearest.i * ITEM_H - wheel.scrollTop;
  await cur.scrollBy(wheel, dy, Math.min(900, 260 + Math.abs(dy) * 0.9));
  await cur.wait(360);
  if (Math.round(wheel.scrollTop / ITEM_H) !== nearest.i) {
    // Belt + braces: if easing/recenter left us off-rung, place it exactly —
    // the wheel's own listener still does the committing.
    wheel.scrollTop = nearest.i * ITEM_H;
    wheel.dispatchEvent(new Event('scroll'));
  }
  // REAL time, even in instant mode: the wheel commits its value on its own
  // 120ms snap timer, and the next beat (e.g. "+ Preset") reads that value.
  await new Promise((r) => setTimeout(r, 300));
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
    // The shared .app scroller carries the LAST tab's position — every tab
    // entry parks at the top before its first beat (8/17 visibility audit).
    const setupScroller = shell.body.querySelector<HTMLElement>('.app')!;
    await cur.scrollBy(setupScroller, -setupScroller.scrollTop, 400);

    // 1:45 on the H/M wheels, then "+ Preset" — the button appears carrying
    // data-seconds=6300, which doubles as the dial's own verification.
    const cols = [...shell.body.querySelectorAll<HTMLElement>('.focus-wheel-col')];
    await dialWheel(cur, cols[0], '01');
    await dialWheel(cur, cols[1], '45');
    await cur.wait(250);
    await cur.click(shell.body.querySelector('.focus-add-preset')!);
    await cur.waitFor('.focus-preset.custom[data-seconds="6300"]', shell.body);
    await cur.wait(500);

    // Import the two tasks for this session. THE marquee-visibility fix
    // (Gabe, 8/17: "the whole focus import mechanism isn't even on screen"):
    // the Import button lives ~590px down a 574px viewport — wheel down so
    // the todo list, the button, AND the panel it opens share one frame.
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    const importBtn = shell.body.querySelector<HTMLElement>('.focus-import')!;
    await cur.ensureInView(scroller, importBtn, 30);
    await cur.scrollBy(scroller, 130, 450); // room below for the panel to grow into
    await cur.click(importBtn);
    await cur.waitFor('.focus-import-task', shell.body);
    await cur.ensureInView(scroller, shell.body.querySelector('.focus-import-panel') ?? importBtn, 24);
    // GUARD-RETRY import (Gabe, 8/17: "the social studies task isn't even
    // clicked"): the panel redraws after every import, and a click on a row it
    // just replaced dispatches with the hand standing still — a ghost import.
    // Re-find the LIVE row, stage it, and only press a + that is connected and
    // squarely in frame; the todo-count assert proves the press did it.
    const pressImportPlus = async (find: () => HTMLElement | undefined, label: string): Promise<void> => {
      const before = shell.body.querySelectorAll('.focus-todo-row').length;
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await cur.fresh(find, label);
        const panelBody = r.closest<HTMLElement>('.focus-import-body');
        await cur.ensureInView(scroller, r, 24);
        if (panelBody) await cur.ensureInView(panelBody, r, 12);
        await cur.wait(250);
        if (!r.isConnected) continue; // a redraw won the race — re-find, never ghost-click
        await cur.click(r.querySelector('.focus-import-add')!);
        try {
          await cur.waitUntil(() => shell.body.querySelectorAll('.focus-todo-row').length > before, 2500, `${label} imported`);
          return;
        } catch {
          /* the press landed on a corpse after all — go around */
        }
      }
      throw new Error(`[focus-setup] could not visibly import: ${label}`);
    };
    await pressImportPlus(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes('get cobalt premium')),
      'get cobalt premium'
    );
    await cur.wait(500); // the row landed — let cause and effect read
    // The research task lives in the Social Studies project folder now, so it sits
    // under the panel's FOLDERS section: expand the folder row, then import
    // the single member (the + on the folder row would import them all).
    const folderRow = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-bulk')].find((r) => /social studies project/i.test(r.textContent ?? '')),
      4000,
      'Social Studies project row in the import panel'
    );
    await cur.click(folderRow, { ax: 0.35 });
    await cur.wait(350); // the folder unfolds
    await pressImportPlus(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes('Research your assigned figure')),
      'Research your assigned figure'
    );
    // Setup-screen todo rows are .focus-todo-row (the session's are .focus-todo-item).
    await cur.waitUntil(() => shell.body.querySelectorAll('.focus-todo-row').length >= 2, 4000, 'both imports landed in the session list');
    await cur.wait(700); // both rows sit in the list BEFORE the panel folds — the tuck must not read as the cause
    await cur.click(shell.body.querySelector('.focus-import')!); // tuck the panel away
    // The output: BOTH imported rows in frame (Gabe, 8/17 — the first fix
    // only guaranteed one). Stage to the last row, then check the first
    // still fits; the pair is ~120px, so one gentle scroll covers both.
    const todoRows = (): HTMLElement[] => [...shell.body.querySelectorAll<HTMLElement>('.focus-todo-row')];
    await cur.ensureInView(scroller, todoRows()[todoRows().length - 1]);
    await cur.ensureInView(scroller, todoRows()[0]);
    await cur.wait(1000);

    // Romantic Piano — then drift DOWN past the custom playlists on the way to
    // Start (the vault note's "boasting a whole bunch of custom playlists").
    const musicList = shell.body.querySelector<HTMLElement>('.focus-music-list')!;
    await cur.ensureInView(scroller, musicList, 30);
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
    await cur.scrollBy(musicList, 420, 800); // the customs scroll past
    await cur.wait(500);
    const startBtn = shell.body.querySelector<HTMLElement>('.focus-start')!;
    await cur.ensureInView(scroller, startBtn, 40);
    await cur.click(startBtn);
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
    const impBody = impRow.closest<HTMLElement>('.focus-import-body');
    if (impBody) await cur.ensureInView(impBody, impRow, 12);
    await cur.click(impRow.querySelector('.focus-import-add')!);
    await cur.waitUntil(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-text')].some((t) => (t.textContent ?? '').includes('study for algebra 2 test')),
      4000,
      'algebra task imported into the session'
    );
    await cur.click(ov.querySelector('.focus-import')!);
    // The output ON CAMERA (Gabe, 8/17): the imported row must be visible in
    // the session's own list, not below its internal fold.
    const sessionTodos = ov.querySelector<HTMLElement>('.focus-overlay-todos');
    const importedRow = [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].find((r) =>
      (r.textContent ?? '').includes('study for algebra 2 test')
    );
    if (sessionTodos && importedRow) await cur.ensureInView(sessionTodos, importedRow, 20);
    await cur.wait(900);

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
    const premText = await cur.fresh(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-text')].find((t) => (t.textContent ?? '').includes('get cobalt premium')),
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
    // Fresh at use: the title-append write-back may have redrawn the panel.
    const input = await cur.fresh(() => ov.querySelector<HTMLTextAreaElement>('.focus-todo-input'), 'session add-todo input');
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
    // Same rule as the quick-add: the parse OUTPUT gets its own moment — and
    // it must be IN FRAME (new rows land at the list's bottom; scroll the
    // session list, not hope).
    const todosPanel = ov.querySelector<HTMLElement>('.focus-overlay-todos');
    // Fresh at use: the auto-translate write-back can redraw the list between
    // capture and this moment, leaving speechRow a detached corpse.
    const speechRowNow = await cur.fresh(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].find((r) => (r.textContent ?? '').includes('start working on speech')),
      'speech todo row (fresh)'
    );
    if (todosPanel) await cur.ensureInView(todosPanel, speechRowNow, 20);
    await cur.moveTo(speechRowNow);
    await cur.wait(1000);

    // The auto-translate pass on a typed task writes back on ITS OWN schedule
    // (network round-trip) and each write-back redraws the todo list, which can
    // detach a row captured moments earlier. No waiting on the network here —
    // find fresh, click, and if the redraw won the race, find fresh again.
    beat('speech-course-chip');
    let courseEd: HTMLTextAreaElement | null = null;
    for (let attempt = 0; attempt < 5 && !courseEd; attempt++) {
      const fresh = await cur.waitForResult(
        () => [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].find((r) => (r.textContent ?? '').includes('start working on speech')),
        3000,
        'speech todo row'
      );
      if (todosPanel) await cur.ensureInView(todosPanel, fresh, 20); // the redraw may have re-stacked the list
      // A write-back can land BETWEEN the staging scroll and the click, reset
      // the list's scroll, and detach the row — never click a row that isn't
      // squarely inside its panel; go around and re-find instead.
      const fr = fresh.getBoundingClientRect();
      const pr = (todosPanel ?? ov).getBoundingClientRect();
      if (!fresh.isConnected || fr.bottom > pr.bottom + 4 || fr.top < pr.top - 4) continue;
      await cur.click(fresh.querySelector('.course-chip.empty') ?? fresh.querySelector('.course-chip')!);
      try {
        courseEd = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', ov, 1300);
      } catch {
        /* the write-back redraw raced the click — loop and re-find */
      }
    }
    if (!courseEd) throw new Error('[focus-session-full] course editor never opened on the speech todo');
    beat('speech-course-editor-open');
    await cur.typeInto(courseEd, 'misc');
    await cur.wait(200);
    cur.pressKey(courseEd, 'Enter');
    await cur.waitUntil(
      () => /miscellaneous/i.test(speechRow.textContent ?? '') || [...ov.querySelectorAll<HTMLElement>('.focus-todo-item')].some((r) => (r.textContent ?? '').includes('start working on speech') && /miscellaneous/i.test(r.textContent ?? '')),
      4000,
      'speech todo coursed via the misc parse word'
    );
    await cur.wait(800); // the chip lands — one beat, not dead air

    // Music: 🎵 menu → Switch ▸ → the cross-genre custom playlist → volume
    // nudge → heart a track → close.
    const musicBtn = await cur.fresh(
      () => [...ov.querySelectorAll<HTMLElement>('.focus-music-ctrl')].find((b) => b.textContent === '🎵'),
      'music menu button'
    );
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
    // The volume nudge: a real hand CLICKS the track where it wants the thumb
    // (the one honest single-gesture way to move a range input).
    const vol = await cur.waitFor<HTMLInputElement>('.focus-vol-slider', menu);
    const volTarget = Math.max(0, Number(vol.value) * 0.75);
    const frac = Math.min(1, Math.max(0, volTarget / (Number(vol.max) || 100)));
    await cur.click(vol, { ax: frac });
    vol.value = String(volTarget);
    vol.dispatchEvent(new Event('input', { bubbles: true }));
    await cur.wait(350);
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
    // then home to the Dashboard with the float riding over the app — exactly
    // what the mini session does for real. NO drag (8/17 audit: makeDraggable
    // maps window coordinates into the scaled frame, so a scripted drag
    // teleports the float — the one gesture the demo can't do honestly).
    await cur.click(ov.querySelector('.focus-min-btn')!);
    await cur.waitFor('.focus-widget', shell.body);
    await cur.wait(1100); // the payoff: the whole session, folded into a corner
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('dashboard'));
    await cur.wait(600);
    await cur.click(shell.chrome.menu);
    // Park the shared scroller so the loop's final shot opens at the top.
    const homeScroller = shell.body.querySelector<HTMLElement>('.app')!;
    if (homeScroller.scrollTop > 0) await cur.scrollBy(homeScroller, -homeScroller.scrollTop, 400);
    await cur.wait(1100); // rest on the dashboard, float in the corner: the seam hides here
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

/** Scene names in play order — the (temporary) audit controls build their
 *  "play from scene" picker from this. */
export const SCENE_NAMES: string[] = SCENES.map((s) => s.name);
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

  // TEMPORARY audit hook: "play from scene N". A live app can't rewind, so a
  // jump kills the running cursor (the scene throws, the world rebuilds) and
  // the next pass FAST-FORWARDS instantly through scenes 0..N-1, then plays N
  // at speed. The UI writes __demoRestartFrom and calls __demoAbort.
  const wa = window as unknown as { __demoRestartFrom?: number | null; __demoAbort?: () => void };
  wa.__demoAbort = () => cur?.kill();

  const loop = async (): Promise<void> => {
    let n = 0;
    let pending: DemoShell | null = null; // a world the seam pre-built and crossfaded in
    while (!stopped && stage.isConnected && (opts.loops === undefined || n < opts.loops)) {
      shell = pending ?? (await buildDemoShell());
      pending = null;
      // speed 1.25 = a quarter slower than scripted (Gabe, 8/17: the loop ran
      // too fast to process; every wait, glide, and keystroke stretches).
      cur = new GhostCursor(shell.body, { instant: opts.instant, speed: 1.25 });
      fitInto(stage, shell.root, 1040);
      // Let first paint + the views' initial subscriptions settle.
      await new Promise((r) => setTimeout(r, opts.instant ? 30 : 350));
      // Audit telemetry (temporary): the hero's clock resets on this counter
      // and labels itself with the running scene.
      const w = window as unknown as { __demoLoopN?: number; __demoScene?: string };
      w.__demoLoopN = (w.__demoLoopN ?? 0) + 1;
      const startIdx = !opts.instant && typeof wa.__demoRestartFrom === 'number' ? wa.__demoRestartFrom : 0;
      wa.__demoRestartFrom = null;

      for (let si = 0; si < SCENES.length; si++) {
        const scene = SCENES[si];
        if (stopped || !stage.isConnected) break;
        await gate();
        // Fast-forward the prefix of a jump: instant events, zero animation.
        cur.setInstant(opts.instant || si < startIdx);
        w.__demoScene = si < startIdx ? `» ${scene.name}` : scene.name;
        const wt = window as unknown as { __demoSceneIdx?: number; __demoFF?: boolean };
        wt.__demoSceneIdx = si;
        wt.__demoFF = si < startIdx;
        try {
          await scene.run({ shell, cur });
        } catch (err) {
          if (opts.instant) throw new Error(`[${scene.name}] ${(err as Error).message}`); // smoke mode: fail loudly, name the scene
          console.warn(`[cobalt demo] scene "${scene.name}" ended early, restarting loop:`, err);
          break;
        }
      }

      n++;
      opts.onLoop?.(n);
      if (stopped || !stage.isConnected) break;

      // THE SEAM (Gabe, 8/17): no fade-to-black cut. The cursor exits the
      // frame (the ONE legal off-screen move), the mini session slides off
      // with it, and the incoming world crossfades in OVER the outgoing one.
      // Both frames share identical chrome (browser bar, header, sidebar), so
      // the only pixels that change are the dashboard's content — the end
      // melts into the start, YouTube-loop style.
      if (!opts.instant) {
        const widget = shell.body.querySelector<HTMLElement>('.focus-widget');
        if (widget) {
          widget.style.transition = 'transform 0.55s ease, opacity 0.55s ease';
          widget.style.transform = 'translateX(420px)';
          widget.style.opacity = '0';
        }
        await cur.exit();
        await new Promise((r) => setTimeout(r, 650));
        const next = await buildDemoShell();
        const wrap = shell.root.parentElement; // the .lp-fit wrapper (position: relative)
        if (wrap) {
          const incoming = next.root;
          incoming.style.position = 'absolute';
          incoming.style.top = '0';
          incoming.style.left = '0';
          incoming.style.right = '0';
          incoming.style.margin = '0 auto';
          incoming.style.opacity = '0';
          incoming.style.transition = 'opacity 0.5s ease';
          incoming.style.transform = shell.root.style.transform; // pixel-aligned overlay
          wrap.append(incoming);
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
          incoming.style.opacity = '1';
          await new Promise((r) => setTimeout(r, 560));
          // Hand the incoming frame back to normal flow before fitInto re-wraps it.
          for (const p of ['position', 'top', 'left', 'right', 'margin', 'opacity', 'transition'] as const) {
            incoming.style.removeProperty(p);
          }
        }
        cur.destroy();
        shell.destroy();
        shell = null;
        cur = null;
        pending = next; // the next iteration adopts the already-built world
      } else {
        cur.destroy();
        shell.destroy();
        shell = null;
        cur = null;
      }
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
