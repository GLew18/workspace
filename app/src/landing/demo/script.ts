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
    // NO DRIFT-AND-PARK (Gabe, 9/2/26: at the open "his cursor just hovers over
    // today's task, not doing anything"). The dashboard is the establishing shot and
    // it reads on its own; a hand crossing the screen to stop on a row it will not
    // touch is the exact dead beat he keeps striking out. One short hold, then the
    // story starts — the cursor stays where it began and travels on its first real
    // errand, the hamburger, in the next scene.
    await cur.wait(900);
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
    // (The extra post-drawer hold died 9/1/26 — it was the ghost of the removed
    // scroll tour, exactly the "cursor parked, nothing happening" beat Gabe cut.)

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
/** A priority option in a popup that is still OPEN. A dismissed popup stays in the
 *  DOM for its fade-out, and in instant mode the next scene opens its own popup
 *  inside that fade, so a plain `.priority-option` lookup found the dying popup's
 *  button first and set the wrong task (9/23). */
const LIVE_POPUP = '.popup-backdrop:not(.closing)';

/** Focus to-do rows. Since 9/25 a to-do with a task behind it is drawn as the
 *  Tasks tab's own row (.focus-task-row, title in .task-title); the older Focus
 *  row is still what an unlinked to-do gets. Each selector takes either. */
const SETUP_ROW = '.focus-todo-list .focus-todo-row, .focus-todo-list .focus-task-row';
const SESSION_ROW = '.focus-todo-item, .focus-overlay-todos .focus-task-row';
const TODO_TEXT = '.focus-todo-text, .focus-task-row .task-title';
const LIVE_PRIORITY_OPT = `${LIVE_POPUP} .priority-option`;

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
async function pickColor(ctx: DemoCtx, swatch: Element, dx = 34, dy = -20, hueDx = 26): Promise<void> {
  const { shell, cur } = ctx;
  await cur.click(swatch);
  const pop = await cur.waitFor<HTMLElement>('.cp-pop', shell.body);
  const sq = pop.querySelector<HTMLElement>('.cp-sq')!;
  // dx/dy steer the circle: +x = more saturated, -y = brighter. The default
  // rides toward richer + brighter; the Cobalt course passes a gentler dx so
  // its color lands slightly LIGHTER (Gabe, 9/1/26).
  await cur.dragPointer(sq, dx, dy);
  await cur.wait(300);
  // hueDx walks the hue bar: a short slide stays in the blues, a long one carries
  // it round to red (the bookmarks Math group, 9/2/26).
  const hue = pop.querySelector<HTMLElement>('.cp-hue')!;
  await cur.dragPointer(hue, hueDx, 0);
  await cur.wait(450); // the chosen color reads on the live chip
}

/** The ⋯ menu on a row → click the entry whose label matches.
 *  The row is staged HIGH first (240px of headroom): the menu always opens
 *  DOWNWARD (render.ts dropdown), and in the app a clipped menu is reachable by
 *  scrolling the page — the demo frame cannot scroll, so a low row put the menu
 *  half outside the screen (Gabe, 9/1/26: the folder popup was clipped). */
async function moreMenu(ctx: DemoCtx, taskId: string, label: RegExp): Promise<void> {
  const { shell, cur } = ctx;
  const scroller = shell.body.querySelector<HTMLElement>('.app')!;
  await cur.ensureInView(scroller, row(shell, taskId), 240);
  await cur.click(row(shell, taskId).querySelector('.act-more')!);
  const menu = await cur.waitFor<HTMLElement>('.row-menu', shell.body);
  const entry = [...menu.querySelectorAll<HTMLElement>('.more-row')].find((r) => label.test(r.textContent ?? ''));
  expect(entry, `no "${label}" entry in the row menu`);
  await cur.wait(260);
  await cur.click(entry!.querySelector('.more-go')!);
}

/** Scene 3 — the Social Studies project: Dan duplicates "Research your assigned
 *  figure", renames the copy into an intermediary step, then files the whole
 *  chain into a "Social-Studies-project" folder. Duplicate lives in the ⋯ menu (the
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

    // Ctrl-click picks EXACTLY the chain (Gabe, 9/1/26): control adds one row
    // at a time, so the essay never gets dragged in and there is nothing to
    // deselect — the old shift-sweep-then-fix beat is gone.
    const chain = [dupId, 'dan_hp2'];
    await cur.click(row(shell, chain[0]), { ctrl: true, ax: 0.6 });
    await cur.wait(220);
    await cur.click(row(shell, chain[1]), { ctrl: true, ax: 0.6 });
    await cur.wait(200);
    expect(
      chain.every((id) => row(shell, id).classList.contains('selected')) &&
        !row(shell, 'dan_essay').classList.contains('selected'),
      'exactly the two chain rows ctrl-selected'
    );

    // File them: ⋯ → Add to folder → "+ New folder…" → type the name → Enter.
    // HYPHENS, not spaces (Gabe, 9/1/26): folder names refuse spaces (the f:
    // token reads one word), and hyphens are what keeps the space-guard toast
    // out of the shot entirely.
    await moreMenu(ctx, 'dan_hp2', /folder/i);
    await cur.waitFor('.folder-pick', shell.body);
    const nameIn = shell.body.querySelector<HTMLTextAreaElement>('.folder-pick-input')!;
    // A real hand CLICKS the field before typing (nothing autofocuses it).
    await cur.click(nameIn);
    await cur.wait(180);
    await cur.typeInto(nameIn, 'Social-Studies-project');
    await cur.wait(140);
    cur.pressKey(nameIn, 'Enter');

    await cur.waitUntil(async () => {
      const all = await shell.data.getTasksAll();
      const fids = new Set(chain.map((id) => all[id]?.folderId).filter(Boolean));
      return fids.size === 1;
    }, 4000, 'all chain tasks filed into one folder');
    await cur.waitFor('.task-folder-name', shell.body);
    await cur.wait(550); // let the folder block read
    // The selection survives a folder action (that's the app's contract) — Dan
    // clears it the way the bar itself says to: one click on "Deselect all".
    const clearBtn = shell.body.querySelector<HTMLElement>('.selbar-clear');
    if (clearBtn) {
      await cur.click(clearBtn);
      await cur.wait(300);
    }

    // AUTO-FILE (new, 9/1/26): the open folder's caption offers to file this
    // course's future Schoology imports here. Dan ticks the checkmark ON…
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    const autoWrap = await cur.waitFor<HTMLElement>('.task-folder-autofile', shell.body);
    await cur.ensureInView(scroller, autoWrap, 40);
    await cur.click(
      await cur.fresh(() => shell.body.querySelector<HTMLElement>('.task-folder-autofile .autofile-cb'), 'auto-file checkmark')
    );
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; autoFile?: boolean }> }>('taskFolders');
      return !!prof?.list?.some((f) => f.name === 'Social-Studies-project' && f.autoFile);
    }, 4000, 'auto-file ticked on');
    await cur.wait(900); // the caption lights up — let the switch read
    // NO COURSE-RETYPE HERE (Gabe, 9/2/26). Retyping the caption to another course
    // is a real feature and it stays in the app; showing it on a folder called
    // Social-Studies-project meant filing MATH assignments into it, which reads as
    // nonsense to anyone watching. The tick alone is the beat.

    // MANUAL PRIORITY, demonstrated here (Gabe, 8/17: imports arrive normal,
    // Dan is the only priority-setter): the research task gets a High arrow,
    // right in the folder block he just built, fully in view.
    await cur.ensureInView(scroller, row(shell, 'dan_hp2'));
    await cur.click(row(shell, 'dan_hp2').querySelector('.task-actions button[title="Priority"]')!);
    await cur.waitFor(LIVE_PRIORITY_OPT, shell.body);
    const high = [...shell.body.querySelectorAll<HTMLElement>(LIVE_PRIORITY_OPT)].find(
      (b) => /high/i.test(b.textContent ?? '') && !/very/i.test(b.textContent ?? '')
    );
    expect(high, 'High missing from the priority popup');
    await cur.wait(240);
    await cur.click(
      await cur.fresh(
        () => [...shell.body.querySelectorAll<HTMLElement>(LIVE_PRIORITY_OPT)].find((b) => /high/i.test(b.textContent ?? '') && !/very/i.test(b.textContent ?? '')),
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

    // Priority: the permanent arrow button → Very High.
    await cur.click(row(shell, 'dan_prem').querySelector('.task-actions button[title="Priority"]')!);
    await cur.waitFor(LIVE_PRIORITY_OPT, shell.body);
    const veryHigh = [...shell.body.querySelectorAll<HTMLElement>(LIVE_PRIORITY_OPT)].find((b) => /very high/i.test(b.textContent ?? ''));
    expect(veryHigh, 'Very High missing from the priority popup');
    await cur.wait(240);
    await cur.click(
      await cur.fresh(
        () => [...shell.body.querySelectorAll<HTMLElement>(LIVE_PRIORITY_OPT)].find((b) => /very high/i.test(b.textContent ?? '')),
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
    await pickColor({ shell, cur }, swatch, 14, -30); // gentler drag = slightly lighter Cobalt (Gabe, 9/1/26)

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

    // …and one of his OWN beside it (Gabe, 9/1/26): the chips can be accepted
    // OR invented — Dan types "co" into the parse-word box and commits it.
    const wordIn = await cur.fresh(
      () => shell.body.querySelector<HTMLTextAreaElement>('.course-row:last-child .parse-add'),
      'parse-word box'
    );
    await cur.ensureInView(scroller, wordIn);
    await cur.click(wordIn);
    await cur.typeInto(wordIn, 'co');
    await cur.wait(200);
    cur.pressKey(wordIn, 'Enter');
    await cur.waitUntil(async () => {
      const prof = await shell.data.getProfile<{ list?: Array<{ name: string; parseWords?: string[] }> }>('courses');
      const c = prof?.list?.find((x) => x.name === 'Cobalt');
      return !!c && (c.parseWords ?? []).includes('co');
    }, 4000, 'Dan’s own parse word "co" saved onto Cobalt');
    await cur.wait(450); // the new chip joins the row — let it read

    // WHEEL BACK UP BEFORE LEAVING, and that is the fix for the jump Gabe saw right
    // after the Cobalt colour (9/2/26). Opening a tab parks it at its top — real app
    // behaviour, and correct — but the reset is INSTANT, so switching away from a
    // scrolled Settings screen read as the page snapping upward on its own. Doing
    // the scroll here, as a visible gesture with the hand on it, means there is
    // nothing left for the tab switch to reset.
    if (scroller.scrollTop > 0) await cur.scrollBy(scroller, -scroller.scrollTop, 700);

    // Back to Tasks; tag the task by typing the parse word into its course chip.
    await cur.click(shell.chrome.menu);
    await cur.wait(480);
    await cur.click(shell.navBtn('tasks'));
    await cur.waitFor('.task-item[data-task-id="dan_prem"]', shell.body);
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

/** Scene 6 — TWO translated descriptions (Gabe, 9/1/26: the Spanish task's and
 *  the Hebrew task's, each shown in its language with the translation under it —
 *  descriptions get the same pass titles do), then the essay's attachments: the
 *  Rubric is ALREADY there (the import's link extraction), Dan adds "essay doc". */
const sceneEssayAttachments: Scene = {
  name: 'descriptions-attachments',
  async run({ shell, cur }) {
    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    // The reading beat is the ONE sanctioned pause, and it stays short
    // (Gabe, 9/1/26: two–three seconds, not a stall).
    const readDescription = async (id: string, translated: RegExp): Promise<void> => {
      await cur.ensureInView(scroller, row(shell, id));
      await cur.click(row(shell, id).querySelector('.task-actions button[title="Description"]')!);
      const back = await cur.waitFor<HTMLElement>(LIVE_POPUP, shell.body);
      // Polled, not read once: the popup body fills in on its own frame, and an
      // instant read raced it (the visual auditor caught the flake, 9/1/26).
      await cur.waitUntil(
        () => translated.test(back.textContent ?? ''),
        3000,
        `description popup missing the translation for ${id}`
      );
      await cur.wait(2300);
      await cur.click(back, { ax: 0.07, ay: 0.5 }); // backdrop click closes
      await cur.wait(300);
    };
    await readDescription('dan_spanish', /irregular verbs/i);
    await readDescription('dan_ivrit', /chapter 5 in the book/i);

    await cur.ensureInView(scroller, row(shell, 'dan_essay'));
    await cur.click(row(shell, 'dan_essay').querySelector('.task-actions button[title="Attachments"]')!);
    const pop = await cur.waitFor<HTMLElement>(LIVE_POPUP, shell.body);
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
    // Fresh at use (9/1/26): the typed tasks' translate write-backs redraw the
    // header on their own schedule, and a toggle captured before that redraw is
    // a corpse — the click lands nowhere, the waitFor times out, and the loop
    // restarts mid-flow (the "cut off before bookmarks" Gabe saw).
    await cur.click(await cur.fresh(() => shell.body.querySelector<HTMLElement>('.tasks-mode-opt[data-mode="calendar"]'), 'calendar toggle'));
    await cur.waitFor('.cal-bar', shell.body);
    await cur.wait(600);

    // The History folder carries its OWN calendar in this mode — open it via
    // the ▶ arrow: the head's center is the name span, where the real click
    // handler deliberately does nothing (an off-limits pixel for a real mouse).
    const folderHead = [...shell.body.querySelectorAll<HTMLElement>('.task-folder-head')].find((h) => /social-studies-project/i.test(h.textContent ?? ''));
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
      [...shell.body.querySelectorAll<HTMLElement>('.task-folder-head')].find((h) => /social-studies-project/i.test(h.textContent ?? ''))!;
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
    // Back to list — fresh for the same redraw-race reason as the way in.
    await cur.click(await cur.fresh(() => shell.body.querySelector<HTMLElement>('.tasks-mode-opt[data-mode="list"]'), 'list toggle'));
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
    await cur.click(shell.chrome.menu);
    await cur.wait(380);

    const scroller = shell.body.querySelector<HTMLElement>('.app')!;
    const addLink = async (name: string, url: string): Promise<void> => {
      const addBtn = shell.body.querySelector<HTMLElement>('.bm-add-btn')!;
      // Since 9/6/26 the button lives in the search row at the TOP of the tab, so
      // this scrolls back up to it rather than chasing it down past the new cards.
      await cur.ensureInView(scroller, addBtn);
      await cur.click(addBtn);
      // An open dialog only: the previous link's dialog is still fading out (see LIVE_POPUP).
      const modal = await cur.waitFor<HTMLElement>('.bm-backdrop:not(.closing) .bm-modal', shell.body);
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
    // A red-ward drag (Gabe, 9/2/26): the Math group used to land in the same blue
    // family as everything else on the page, so the colour picking had nothing to
    // show for itself. Positive hue slide, deep into saturation.
    await pickColor({ shell, cur }, groupColor, 46, -26, 74);
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
      const before = shell.body.querySelectorAll(SETUP_ROW).length;
      for (let attempt = 0; attempt < 4; attempt++) {
        const r = await cur.fresh(find, label);
        const panelBody = r.closest<HTMLElement>('.focus-import-body');
        await cur.ensureInView(scroller, r, 24);
        if (panelBody) await cur.ensureInView(panelBody, r, 12);
        await cur.wait(250);
        if (!r.isConnected) continue; // a redraw won the race — re-find, never ghost-click
        await cur.click(r.querySelector('.focus-import-add')!);
        try {
          await cur.waitUntil(() => shell.body.querySelectorAll(SETUP_ROW).length > before, 2500, `${label} imported`);
          return;
        } catch {
          /* the press landed on a corpse after all — go around */
        }
      }
      throw new Error(`[focus-setup] could not visibly import: ${label}`);
    };
    // FOLDER FIRST, then the loose task (Gabe, 9/2/26): the panel lists folders
    // above loose tasks, so importing bottom-up made the hand jump back up the
    // list for no reason. Take them in the order they are on screen.
    //
    // The research task lives in the Social-Studies-project folder now, so it sits
    // under the panel's FOLDERS section: expand the folder row, then import the
    // single member (the + on the folder row would import them all).
    const folderRow = await cur.waitForResult(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-bulk')].find((r) => /social-studies-project/i.test(r.textContent ?? '')),
      4000,
      'Social-Studies-project row in the import panel'
    );
    await cur.click(folderRow, { ax: 0.35 });
    await cur.wait(350); // the folder unfolds
    await pressImportPlus(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes('Research your assigned figure')),
      'Research your assigned figure'
    );
    await cur.wait(500); // the row landed — let cause and effect read
    await pressImportPlus(
      () => [...shell.body.querySelectorAll<HTMLElement>('.focus-import-task')].find((r) => (r.textContent ?? '').includes('get cobalt premium')),
      'get cobalt premium'
    );
    // Setup-screen rows (see SETUP_ROW); the session's are SESSION_ROW.
    await cur.waitUntil(() => shell.body.querySelectorAll(SETUP_ROW).length >= 2, 4000, 'both imports landed in the session list');
    await cur.wait(700); // both rows sit in the list BEFORE the panel folds — the tuck must not read as the cause
    await cur.click(shell.body.querySelector('.focus-import')!); // tuck the panel away
    // The output: BOTH imported rows in frame (Gabe, 8/17 — the first fix
    // only guaranteed one). Stage to the last row, then check the first
    // still fits; the pair is ~120px, so one gentle scroll covers both.
    const todoRows = (): HTMLElement[] => [...shell.body.querySelectorAll<HTMLElement>(SETUP_ROW)];
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
    await cur.wait(250);
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
      () => [...ov.querySelectorAll<HTMLElement>(TODO_TEXT)].some((t) => (t.textContent ?? '').includes('study for algebra 2 test')),
      4000,
      'algebra task imported into the session'
    );
    await cur.click(ov.querySelector('.focus-import')!);
    // The output ON CAMERA (Gabe, 8/17): the imported row must be visible in
    // the session's own list, not below its internal fold.
    const sessionTodos = ov.querySelector<HTMLElement>('.focus-overlay-todos');
    const importedRow = [...ov.querySelectorAll<HTMLElement>(SESSION_ROW)].find((r) =>
      (r.textContent ?? '').includes('study for algebra 2 test')
    );
    if (sessionTodos && importedRow) await cur.ensureInView(sessionTodos, importedRow, 20);
    await cur.wait(900);

    // Reorder the two LOOSE todos (premium + algebra; the History import lives
    // in its folder block and drags never cross groups — the app's own rule).
    const looseRows = (): HTMLElement[] =>
      [...ov.querySelectorAll<HTMLElement>(SESSION_ROW)].filter((r) => {
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
      () => [...ov.querySelectorAll<HTMLElement>(TODO_TEXT)].find((t) => (t.textContent ?? '').includes('get cobalt premium')),
      'premium todo'
    );
    beat('premium-append-dblclick');
    await cur.dblclick(premText);
    const editor = await cur.waitFor<HTMLTextAreaElement>('.inline-edit-block', ov);
    beat('premium-append-editor-open');
    // THE DOUBLE-CLICK'S OWN SELECTION, ON SCREEN (Gabe, 9/2/26). The app opens
    // every inline editor with its text selected, and the old beat appended
    // straight onto the end — which no keyboard can do while a selection is live,
    // and which hid the highlight the gesture is known by. retype() shows the
    // selection, holds it, then replaces it, exactly as typing over one does.
    await cur.wait(420); // the highlight reads before a key lands on it
    await cur.retype(editor, 'get cobalt premium right after completing homework');
    cur.pressKey(editor, 'Enter');
    await cur.waitUntil(
      () => [...ov.querySelectorAll<HTMLElement>(TODO_TEXT)].some((t) => /right after completing homework/.test(t.textContent ?? '')),
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
      () => [...ov.querySelectorAll<HTMLElement>(SESSION_ROW)].find((r) => (r.textContent ?? '').includes('start working on speech')),
      4000,
      'speech todo added (date parsed out of the title)'
    );
    expect(!/in 2 days/.test(speechRow.querySelector(TODO_TEXT)?.textContent ?? ''), 'date words should have parsed OUT of the title');
    // Same rule as the quick-add: the parse OUTPUT gets its own moment — and
    // it must be IN FRAME (new rows land at the list's bottom; scroll the
    // session list, not hope).
    const todosPanel = ov.querySelector<HTMLElement>('.focus-overlay-todos');
    // Fresh at use: the auto-translate write-back can redraw the list between
    // capture and this moment, leaving speechRow a detached corpse.
    const findSpeechRow = (): HTMLElement | undefined =>
      [...ov.querySelectorAll<HTMLElement>(SESSION_ROW)].find((r) => (r.textContent ?? '').includes('start working on speech'));
    // STABLE, not merely fresh (Gabe's audit, 9/3/26: the hand never reached this
    // row, every loop). The list is redrawn a beat after the row first appears, in
    // the gap between the staging scroll and the move — so the node found here was
    // a corpse by the time the hand set off, and since a corpse has no box the hand
    // did not set off at all: it stood on the add button through the whole 1s hold.
    // Wait for the node to hold still, stage it, then move to it re-found, because
    // the staging scroll can itself land in a redraw.
    const speechRowNow = await cur.stable(findSpeechRow, 'speech todo row (settled)');
    if (todosPanel) await cur.ensureInView(todosPanel, speechRowNow, 20);
    await cur.moveTo(await cur.stable(findSpeechRow, 'speech todo row (after staging)'));
    await cur.wait(1000);

    // The auto-translate pass on a typed task writes back on ITS OWN schedule
    // (network round-trip) and each write-back redraws the todo list, which can
    // detach a row captured moments earlier. No waiting on the network here —
    // find fresh, click, and if the redraw won the race, find fresh again.
    beat('speech-course-chip');
    let courseEd: HTMLTextAreaElement | null = null;
    for (let attempt = 0; attempt < 5 && !courseEd; attempt++) {
      const fresh = await cur.waitForResult(
        () => [...ov.querySelectorAll<HTMLElement>(SESSION_ROW)].find((r) => (r.textContent ?? '').includes('start working on speech')),
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
      () => /miscellaneous/i.test(speechRow.textContent ?? '') || [...ov.querySelectorAll<HTMLElement>(SESSION_ROW)].some((r) => (r.textContent ?? '').includes('start working on speech') && /miscellaneous/i.test(r.textContent ?? '')),
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
    // Opening the menu draws it once, then refreshes the music library and draws it
    // AGAIN when that resolves (openMenu, focus/view.ts). The Switch row found the
    // instant the menu exists is replaced before the hand arrives, so the click fired
    // from wherever the hand was standing (Gabe's audit, 9/3/26: every loop). Take
    // the row that survives the second draw.
    await cur.click(await cur.stable(() => menu.querySelector('.focus-menu-switch'), 'Switch row (settled)'));
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
interface Fit {
  /** Take over a screen that is ALREADY a child of the wrapper (the loop seam's
   *  crossfaded-in world) and fit it where it stands. Never detaches anything. */
  adopt(next: HTMLElement): void;
}
function fitInto(stage: HTMLElement, target: HTMLElement, designWidth: number): Fit {
  const wrap = el('div', { class: 'lp-fit' });
  wrap.append(target);
  let cur = target;
  const apply = (): void => {
    const w = wrap.clientWidth;
    if (!w) return;
    const s = Math.min(1, w / designWidth);
    cur.style.transform = s < 1 ? `scale(${s})` : 'translateZ(0)';
    wrap.style.height = s < 1 ? `${cur.offsetHeight * s}px` : '';
  };
  const ro = new ResizeObserver(apply);
  ro.observe(wrap);
  ro.observe(target);
  stage.replaceChildren(wrap);
  apply();
  return {
    adopt(next) {
      ro.unobserve(cur);
      cur = next;
      ro.observe(cur);
      apply();
    },
  };
}

/**
 * THE STAGES A DEMO IS CURRENTLY DRIVING, and the two prototype patches that read
 * this set — installed ONCE for the life of the page, never per demo.
 *
 * Both patches exist to keep the app's own scrolling out of the frame: `focus` must
 * not scroll a field into view (it can move the LANDING PAGE, which is what made the
 * hero "spawn" the viewer back up to the headline), and `scrollIntoView` must do
 * nothing at all inside the stage (several views reveal what they just opened that
 * way — right in the app, wrong here, where the frame lurches with the cursor
 * standing still). The scenes stage their own shots with visible wheel gestures.
 *
 * A SET AND A ONE-TIME INSTALL rather than wrap-and-restore per demo (found by the
 * code auditor, 9/2/26): startHeroDemo's returned controller is never stopped by the
 * landing, so wrapping on every call stacked a new layer of wrappers on the
 * prototype each time a visitor came back to the landing page. Membership is what
 * turns the patch on and off now, and a stage that goes away just leaves the set.
 */
const activeStages = new Set<HTMLElement>();
let patchesInstalled = false;
function installStagePatches(): void {
  if (patchesInstalled) return;
  patchesInstalled = true;
  const inStage = (n: Node): boolean => {
    for (const s of activeStages) if (s.contains(n)) return true;
    return false;
  };
  const origFocus = HTMLElement.prototype.focus;
  HTMLElement.prototype.focus = function (this: HTMLElement, options?: FocusOptions) {
    origFocus.call(this, inStage(this) ? { ...options, preventScroll: true } : options);
  };
  const origSIV = Element.prototype.scrollIntoView;
  Element.prototype.scrollIntoView = function (this: Element, arg?: boolean | ScrollIntoViewOptions) {
    if (inStage(this)) return;
    origSIV.call(this, arg as ScrollIntoViewOptions);
  };
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

  // NEVER SCROLL THE VISITOR'S PAGE (Gabe, 9/1/26: watching the demo kept
  // "spawning" him back up to the hero text). The app's own code focuses fields
  // it just opened (folder picker, modals, inline editors), and a plain .focus()
  // lets the browser scroll the real window to reveal the field inside the
  // scaled frame. For the demo's lifetime, any focus INSIDE the stage runs with
  // preventScroll; everything outside the stage is untouched.
  activeStages.add(stage);
  installStagePatches();

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
    let pending: DemoShell | null = null; // a world the seam pre-built and faded in
    let pendingMounted = false; // …and already put on the stage, so don't re-wrap it
    let fit: Fit | null = null; // the stage's one wrapper, kept for the life of the demo
    while (!stopped && stage.isConnected && (opts.loops === undefined || n < opts.loops)) {
      shell = pending ?? (await buildDemoShell());
      const alreadyMounted = pendingMounted;
      pending = null;
      pendingMounted = false;
      // speed 1.25 = a quarter slower than scripted (Gabe, 8/17: the loop ran
      // too fast to process; every wait, glide, and keystroke stretches).
      cur = new GhostCursor(shell.body, { instant: opts.instant, speed: 1.25 });
      // Re-wrapping a shell the seam already mounted would tear it out of the DOM
      // and put it back, which is a visible flash at the exact moment the loop is
      // trying to look seamless.
      // 1280, up from 1040 (Gabe, 9/3/26): matches .lp-frame.lp-demoshell's design
      // width in landing.css — the two must stay in sync.
      if (!alreadyMounted) fit = fitInto(stage, shell.root, 1280);
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

      // THE SEAM (Gabe, 8/17, rebuilt 9/2/26): Dan drags the mini player out through
      // the frame's right edge (the ONE legal off-screen move), and the SCREEN
      // dissolves and reforms inside a frame that never moves.
      //
      // ONE WINDOW, EVER. This used to append the incoming shell into the same
      // wrapper as the outgoing one, absolutely positioned and centred by
      // `margin: 0 auto`, and fade it in on top. The outgoing frame is a FLEX ITEM,
      // so those two rules put it somewhere else entirely: a second window appeared
      // offset to the right, and stripping the inline styles at the end snapped it
      // into place — Gabe watched it duplicate and slide, every loop. Nothing
      // overlays anything now; only the body's opacity moves, so there is no second
      // box that can be a few pixels out.
      if (!opts.instant) {
        const widget = shell.body.querySelector<HTMLElement>('.lp-pip-window, .focus-widget');
        try {
          if (widget) {
            // DAN TAKES THE MINI PLAYER WITH HIM (Gabe, 9/3/26: "Dan's cursor isn't on
            // the pip when he brings it off screen"). The window used to slide off on
            // its own 0.55s transition while the hand crossed from the hamburger to
            // the right edge, far above it. Now the hand lands on the window's title
            // bar — where a real PiP is grabbed — presses, and drags it out, the two
            // moving as one. The distance clears the window's own width plus its
            // 18px inset, so nothing of it is left inside the frame.
            const grip = widget.querySelector<HTMLElement>('.lp-pip-titlebar') ?? widget;
            await cur.carry(widget, grip, widget.offsetWidth + 40);
          } else {
            await cur.exit();
          }
        } catch {
          // The cursor was killed mid-scene (the scene-jump hook), so every primitive
          // throws from here on, this glide included. Nothing catches a throw at this
          // level, so without this the loop's promise died and the demo froze on
          // whatever frame it was showing, for good (Gabe's audit, 9/3/26: every seek
          // on the old chapter bar did exactly this).
        }
        await new Promise((r) => setTimeout(r, 420));
        // Built BEFORE the dissolve starts, so the swap lands on a frame that is
        // already invisible and the viewer never waits on a blank screen.
        const next = await buildDemoShell();
        // The visitor can sign in mid-seam (~1.9s), which detaches the stage. Without
        // this the freshly built world would be mounted into a dead tree and then
        // orphaned, its view subscriptions never torn down (code auditor, 9/2/26).
        if (stopped || !stage.isConnected) {
          next.destroy();
          cur.destroy();
          shell.destroy();
          shell = null;
          cur = null;
          break;
        }
        const FADE = 520;
        const EASE = 'cubic-bezier(0.4, 0, 0.2, 1)';
        // A TRUE CROSSFADE — the new world fades in ON TOP of the old one, which
        // stays fully opaque underneath until it is covered (Gabe, 9/2/26: the end
        // must not fade to an empty blue frame and back; one shot dissolves straight
        // into the next). Fading the outgoing OUT first is what showed the frame's
        // own background through the middle of the transition.
        //
        // Pinned by the outgoing frame's OWN offset and transform, which is the part
        // that went wrong before: `left/right: 0` with `margin: 0 auto` centres an
        // absolute box in the wrapper, while the outgoing box is placed by flex, and
        // those two landed in different places — a second window, offset to the
        // right, that snapped into position when the styles came off.
        const wrap = shell.root.parentElement;
        const incoming = next.root;
        if (wrap) {
          incoming.style.position = 'absolute';
          incoming.style.left = `${shell.root.offsetLeft}px`;
          incoming.style.top = `${shell.root.offsetTop}px`;
          incoming.style.margin = '0';
          incoming.style.transform = shell.root.style.transform;
          incoming.style.transformOrigin = getComputedStyle(shell.root).transformOrigin;
          incoming.style.opacity = '0';
          wrap.append(incoming);
          // The frame's ring gradient drifts on a 9s loop. A fresh frame starts that
          // loop from zero, so the ring would visibly skip to a different phase the
          // moment the new frame covered the old one. Start it where the old one is.
          const drift = (n: HTMLElement): CSSAnimation | undefined =>
            n.getAnimations().find((a): a is CSSAnimation => a instanceof CSSAnimation && a.animationName === 'lp-stage-drift');
          const phase = drift(shell.root)?.currentTime;
          const mine = drift(incoming);
          if (phase != null && mine) mine.currentTime = phase;
          // Two frames so the starting opacity is committed before the transition is
          // armed, or the browser collapses both into one paint and nothing animates.
          await new Promise((r) => requestAnimationFrame(() => requestAnimationFrame(() => r(null))));
          incoming.style.transition = `opacity ${FADE}ms ${EASE}`;
          incoming.style.opacity = '1';
          await new Promise((r) => setTimeout(r, FADE + 40));
        }
        // The old world leaves from UNDER a frame that already covers it, so nothing
        // about this is visible.
        cur.destroy();
        shell.destroy();
        for (const p of ['position', 'left', 'top', 'margin', 'opacity', 'transition', 'transformOrigin'] as const) {
          incoming.style.removeProperty(p);
        }
        // IN PLACE (Gabe, 9/3/26: after the fade "the app sort of has a reload moment
        // ... goes blank for like literally a millisecond ... refreshes all the
        // content"). This used to call fitInto again, which built a NEW wrapper, moved
        // the new world into it, and swapped the wrappers — all in one synchronous
        // step, so no blank frame was ever painted, and the code auditor cleared it on
        // those grounds. But a subtree taken out of the DOM and put back restarts
        // every CSS animation inside it, and the active tab panel has a 0.3s fade-in
        // of its own (components.css): the whole screen replayed its entrance the
        // instant the crossfade finished. That is the "reload". adopt() re-measures
        // the world where it already stands, and nothing restarts.
        fit?.adopt(incoming);
        shell = null;
        cur = null;
        pending = next; // the next iteration adopts the already-built, already-mounted world
        pendingMounted = true;
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
      activeStages.delete(stage); // the patches go inert for this stage (see installStagePatches)
      cur?.destroy();
      shell?.destroy();
    },
  };
}
// #endregion
