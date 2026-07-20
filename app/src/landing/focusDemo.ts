// WorkSpace — landing Focus demo.
//
// The real Focus session renders as a full-screen overlay on <body>, which would
// hijack the landing page. So the "See it in action → Focus" panel gets this: a
// scaled-down copy of the real overlay (focus/view.ts buildOverlay), slightly
// simplified for the showcase (no minimize button, no music transport) — timer
// cluster left (quote → ring → "⏰ Ends" → Pause/End → ± rows), the "This session"
// panel right. EVERY control is clickable: the clock ticks, ± (and ✎) adjust it,
// todos toggle, the add-box adds, and Import Tasks opens a real list that imports.

import { el, textInput } from '../util/dom';
import { makeWheel } from '../focus/wheel';

const START_SECONDS = 25 * 60; // a classic 25:00 focus block
const R = 54;
const C = 2 * Math.PI * R;

// Same ✓ glyph the real session checkboxes use (they reuse the Tasks .task-cb).
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

interface DemoTodo {
  label: string;
  course: string;
  color: string;
  done: boolean;
}

export function buildFocusDemo(): HTMLElement {
  const root = el('div', { class: 'lpf' });

  const stage = el('div', { class: 'lpf-stage' });
  const left = el('div', { class: 'lpf-left' });

  // Quote spans the FULL width, centered ABOVE the whole stage — matching the real
  // overlay, where it sits over both the timer and task columns (not tucked inside
  // the left column). Built here, appended to the root before the stage below.
  const quote = el('div', { class: 'lpf-quote', text: 'WIN THE NEXT MINUTE' });

  // --- Ring + centered time, with the real ring's 12-o'clock dot ---
  const ringWrap = el('div', { class: 'lpf-ring' });
  ringWrap.innerHTML = `
    <svg viewBox="0 0 120 120">
      <circle cx="60" cy="60" r="${R}" fill="none" stroke="rgba(255,255,255,0.08)" stroke-width="4.3"/>
      <circle class="lpf-ring-fg" cx="60" cy="60" r="${R}" fill="none" stroke="var(--accent)"
        stroke-width="4.3" stroke-linecap="round" stroke-dasharray="${C}" stroke-dashoffset="0"
        transform="rotate(-90 60 60)"/>
      <circle cx="60" cy="6" r="2.6" fill="var(--accent)"/>
    </svg>`;
  const timeText = el('div', { class: 'lpf-time', text: '25:00' });
  ringWrap.append(timeText);
  const ringFg = ringWrap.querySelector('.lpf-ring-fg') as SVGCircleElement;
  left.append(ringWrap);

  // "⏰ Ends 2:34 PM" — like the real buildEndTime, kept current as time shifts.
  const endsText = el('span', { class: 'lpf-endtime-text' });
  const endtime = el('div', { class: 'lpf-endtime' });
  endtime.append(el('span', { text: '⏰' }), endsText);
  left.append(endtime);

  // Controls: gold Pause + red End, styled exactly like the real .focus-ctrl pills.
  // End is inert by design — the demo clock simply auto-resets when it runs out.
  const controls = el('div', { class: 'lpf-controls' });
  const pauseBtn = el('button', { class: 'lpf-ctrl primary', text: '⏸ Pause' });
  const endBtn = el('button', { class: 'lpf-ctrl danger', text: 'End Session' });
  controls.append(pauseBtn, endBtn);
  left.append(controls);

  // --- session clock state (declared before the ± rows that mutate it) ---
  let endTime = Date.now() + START_SECONDS * 1000;
  let total = START_SECONDS; // denominator for the ring, grows/shrinks with ±
  let pausedRemaining: number | null = null; // seconds frozen while paused

  const refreshEnds = () => {
    const endMs = pausedRemaining === null ? endTime : Date.now() + pausedRemaining * 1000;
    endsText.textContent =
      'Ends ' + new Date(endMs).toLocaleTimeString([], { hour: 'numeric', minute: '2-digit' });
  };

  // ± time rows — the real 4-per-row equal-width grid (+2/+5/+10/+✎, −2/−5/−10/−✎).
  // Everything is live; the ✎ "custom" buttons adjust by a fine-grained ±1 minute
  // here (the real ones open an H:M:S picker).
  // The sample session peaks at 25:00 — every add (buttons AND the custom picker)
  // clamps there, so the showcase clock can never run away.
  const DEMO_MAX = START_SECONDS;
  const extend = (deltaSec: number) => {
    total = Math.min(DEMO_MAX, Math.max(60, total + deltaSec));
    if (pausedRemaining !== null) {
      pausedRemaining = Math.min(DEMO_MAX, Math.max(0, pausedRemaining + deltaSec));
      paint(pausedRemaining);
    } else {
      endTime += deltaSec * 1000;
      const maxEnd = Date.now() + DEMO_MAX * 1000;
      if (endTime > maxEnd) endTime = maxEnd; // the 25:00 peak
      if (endTime < Date.now()) endTime = Date.now() + 1000; // trimmed past zero → ~end
    }
    refreshEnds();
  };

  // The ✎ custom buttons open the REAL carousel picker (the same makeWheel the app
  // uses), contained inside this preview frame like every landing popup. Same
  // THREE-column H:M:S layout as the app's picker (the demo's hour range is just
  // shorter — a marketing demo doesn't need 12 hours).
  const openCustomPicker = (sign: 1 | -1) => {
    const host = root.closest('.lp-frame-body') ?? root;
    const back = el('div', { class: 'focus-modal-back' });
    const card = el('div', { class: 'focus-modal focus-extend-modal' });
    card.append(el('div', { class: 'focus-modal-title', text: sign > 0 ? 'Add time' : 'Trim time' }));

    const hourW = makeWheel(Array.from({ length: 2 }, (_, i) => i), () => {});
    const minW = makeWheel(Array.from({ length: 60 }, (_, i) => i), () => {});
    const secW = makeWheel(Array.from({ length: 60 }, (_, i) => i), () => {});
    const col = (label: string, wheel: HTMLElement) => {
      const c = el('div', { class: 'focus-wheel-col' });
      c.append(wheel, el('div', { class: 'focus-wheel-label', text: label }));
      return c;
    };
    const carousel = el('div', { class: 'focus-carousel focus-extend-carousel' });
    carousel.append(col('Hour', hourW.wheel), col('Min', minW.wheel), col('Sec', secW.wheel), el('div', { class: 'focus-carousel-window' }));
    card.append(carousel);

    const actions = el('div', { class: 'focus-modal-actions' });
    const cancel = el('button', { class: 'focus-ctrl', text: 'Cancel' });
    const ok = el('button', {
      class: `focus-ctrl ${sign > 0 ? 'gold' : 'danger'}`,
      text: sign > 0 ? 'Add' : 'Trim',
    });
    const close = () => back.remove();
    cancel.addEventListener('click', close);
    ok.addEventListener('click', () => {
      const amount = hourW.value() * 3600 + minW.value() * 60 + secW.value();
      if (amount > 0) extend(sign * amount);
      close();
    });
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    actions.append(cancel, ok);
    card.append(actions);
    back.append(card);
    host.append(back);
    // Default the picker to 0:05:00 once the wheels are laid out.
    requestAnimationFrame(() => {
      hourW.scrollTo(0);
      minW.scrollTo(5);
      secW.scrollTo(0);
    });
  };
  const extendRows = el('div', { class: 'lpf-extend' });
  for (const sign of [1, -1] as const) {
    const row = el('div', { class: `lpf-extend-row ${sign > 0 ? 'add' : 'trim'}` });
    const sym = sign > 0 ? '+' : '−';
    for (const m of [2, 5, 10]) {
      const b = el('button', { class: 'lpf-extend-btn', text: `${sym}${m}` });
      b.addEventListener('click', () => extend(sign * m * 60));
      row.append(b);
    }
    const custom = el('button', { class: 'lpf-extend-btn custom', text: `${sym}✎`, title: 'Custom amount' });
    custom.addEventListener('click', () => openCustomPicker(sign));
    row.append(custom);
    extendRows.append(row);
  }
  left.append(extendRows);

  // --- Task panel (right column) — content-sized and vertically centered ---
  const panel = el('div', { class: 'lpf-panel' });
  panel.append(el('div', { class: 'lpf-panel-head', text: 'This session' }));

  const todos: DemoTodo[] = [
    { label: 'Outline the essay', course: 'Social Studies', color: '#e05050', done: true },
    { label: 'השלם את עמוד 16', course: 'Ivrit', color: '#70c0e0', done: false },
  ];
  const todoList = el('div', { class: 'lpf-todos' });
  const drawTodos = () => {
    todoList.replaceChildren();
    for (const t of todos) {
      // Verbatim row anatomy: ⋮⋮ handle · square checkbox · [title / course-under].
      const row = el('div', { class: `lpf-todo${t.done ? ' done' : ''}` });
      row.append(el('span', { class: 'lpf-todo-handle', text: '⋮⋮' }));
      const cb = el('button', { class: `task-cb${t.done ? ' checked' : ''}` });
      cb.innerHTML = CHECK_SVG;
      const col = el('span', { class: 'lpf-todo-col' });
      col.append(el('span', { class: 'lpf-todo-label', text: t.label }));
      if (t.course) {
        const chip = el('span', { class: 'lpf-todo-course', text: t.course });
        chip.style.color = t.color;
        col.append(chip);
      } else {
        col.append(el('span', { class: 'lpf-todo-course empty', text: '+ course' }));
      }
      row.append(cb, col);
      row.addEventListener('click', () => {
        t.done = !t.done;
        drawTodos();
      });
      todoList.append(row);
    }
  };
  drawTodos();
  panel.append(todoList);

  // Mid-session add — genuinely works, like the real overlay's add row.
  const addRow = el('div', { class: 'lpf-add' });
  const addInput = textInput({ class: 'lpf-add-input', placeholder: 'Add a task…' });
  const addBtn = el('button', { class: 'lpf-add-btn', text: '+', title: 'Add task' });
  const addNow = () => {
    const v = addInput.value.trim();
    if (!v) return;
    todos.push({ label: v, course: '', color: '', done: false });
    addInput.value = '';
    addInput.focus();
    drawTodos();
  };
  addBtn.addEventListener('click', addNow);
  addInput.addEventListener('keydown', (e) => {
    if (e.key === 'Enter') addNow();
  });
  addRow.append(addInput, addBtn);
  panel.append(addRow);

  // Import Tasks — a real toggle, like the app's: opens a list of the sample
  // tasks; clicking one pulls it into the session.
  const importable: DemoTodo[] = [
    { label: 'Unit 5 Test', course: 'Math', color: '#f0c040', done: false },
    { label: 'tell coach about being late', course: 'Basketball', color: '#e07b3a', done: false },
  ];
  const importBtn = el('button', { class: 'lpf-import', text: 'Import Tasks' });
  const importPanel = el('div', { class: 'lpf-import-panel' });
  // Search filter at the top — mirrors the real import panel's standalone rounded
  // "Search tasks…" input (and it actually filters, like the real one).
  const importSearch = el('input', {
    type: 'text',
    class: 'lpf-import-search',
    placeholder: 'Search tasks…',
    autocomplete: 'off',
  });
  const importList = el('div');
  const drawImport = () => {
    importList.replaceChildren();
    const q = importSearch.value.trim().toLowerCase();
    const shown = importable.filter((t) => !q || t.label.toLowerCase().includes(q) || t.course.toLowerCase().includes(q));
    if (!importable.length) {
      importList.append(el('div', { class: 'lpf-import-empty', text: 'All tasks imported ✓' }));
      return;
    }
    if (!shown.length) {
      importList.append(el('div', { class: 'lpf-import-empty', text: 'No matching tasks.' }));
      return;
    }
    for (const t of shown) {
      const row = el('button', { class: 'lpf-import-item' });
      row.append(el('span', { class: 'lpf-import-plus', text: '+' }), el('span', { text: t.label }));
      row.addEventListener('click', () => {
        todos.push(t);
        importable.splice(importable.indexOf(t), 1);
        drawTodos();
        drawImport();
      });
      importList.append(row);
    }
  };
  importSearch.addEventListener('input', drawImport);
  importPanel.append(importSearch, importList);
  drawImport();
  importPanel.style.display = 'none';
  importBtn.addEventListener('click', () => {
    const open = importPanel.style.display !== 'none';
    importPanel.style.display = open ? 'none' : '';
    importBtn.textContent = open ? 'Import Tasks' : 'Hide Import';
  });
  panel.append(importBtn, importPanel);

  stage.append(left, panel);
  root.append(quote, stage);

  // Music transport, bottom-right — mirrors the session's MUSIC caption + ⏮ ⏸ 🎵 ⏭
  // bar. Play/pause genuinely toggles; the rest are inert demo buttons.
  const music = el('div', { class: 'lpf-music' });
  music.append(el('div', { class: 'lpf-music-cap', text: 'MUSIC' }));
  const musicBar = el('div', { class: 'lpf-music-bar' });
  const playBtn = el('button', { class: 'lpf-music-ctrl play', text: '⏸', title: 'Play / pause' });
  let musicPlaying = true;
  playBtn.addEventListener('click', () => {
    musicPlaying = !musicPlaying;
    playBtn.textContent = musicPlaying ? '⏸' : '▶';
    playBtn.classList.toggle('play', musicPlaying);
  });
  musicBar.append(
    el('button', { class: 'lpf-music-ctrl', text: '⏮', title: 'Previous' }),
    playBtn,
    el('button', { class: 'lpf-music-ctrl', text: '🎵', title: 'Music menu' }),
    el('button', { class: 'lpf-music-ctrl', text: '⏭', title: 'Next' })
  );
  music.append(musicBar);
  root.append(music);

  // --- the live clock -----------------------------------------------------
  const fmt = (secs: number) => {
    const s = Math.max(0, Math.ceil(secs));
    return `${Math.floor(s / 60)}:${String(s % 60).padStart(2, '0')}`;
  };

  const paint = (remaining: number) => {
    timeText.textContent = fmt(remaining);
    const progress = Math.max(0, Math.min(1, remaining / total));
    ringFg.style.strokeDashoffset = String(C * (1 - progress)); // full ring → drains to empty
  };

  // The demo is BUILT before the landing page is appended to the document, so the
  // loop must idle (not die) while detached — it only stops for good after it has
  // been mounted once and then torn down (e.g. after sign-in).
  let wasConnected = false;
  const tick = () => {
    if (!root.isConnected) {
      if (wasConnected) return; // torn down — stop for good
      requestAnimationFrame(tick); // not mounted yet — keep waiting
      return;
    }
    wasConnected = true;
    if (pausedRemaining === null) {
      let remaining = (endTime - Date.now()) / 1000;
      if (remaining <= 0) {
        endTime = Date.now() + START_SECONDS * 1000; // loop so it's always ticking
        total = START_SECONDS;
        remaining = START_SECONDS;
        refreshEnds();
      }
      paint(remaining);
    }
    requestAnimationFrame(tick);
  };

  pauseBtn.addEventListener('click', () => {
    if (pausedRemaining === null) {
      pausedRemaining = (endTime - Date.now()) / 1000;
      pauseBtn.textContent = '▶ Resume';
      root.classList.add('paused');
    } else {
      endTime = Date.now() + pausedRemaining * 1000;
      pausedRemaining = null;
      pauseBtn.textContent = '⏸ Pause';
      root.classList.remove('paused');
    }
    refreshEnds();
  });
  // End is intentionally inert in the demo — the clock auto-resets when it runs out.
  void endBtn;

  paint(START_SECONDS);
  refreshEnds();
  requestAnimationFrame(tick);
  return root;
}
