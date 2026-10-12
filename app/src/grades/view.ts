// Cobalt: Grades tab (Gabe, 10/11/26).
//
// A grid of every course with its exact Schoology grade and a small trend line; click
// one for the full graph (hover it to read the grade on any day), its categories (the
// same Engagement / Quizzes / Tests folders Schoology has) with every assignment, and
// the Cobalt-only what-if tools built INTO those rows: type a score on any assignment,
// change what it is out of, add a made-up one with +; and one What-if card at the bottom.
//
// The grades are read live through the student's own Schoology connection
// (functions/index.js sgyGrades) and held in memory only: never in the database,
// never in browser storage, gone when the tab closes. Nothing here refreshes by hand:
// the tab re-reads on its own when it has been away a few minutes.
//
// A LETTER APPEARS ONLY WHEN SCHOOLOGY SENT THE COURSE'S GRADING SCALE (calc.ts).

import type { Data } from '../db';
import { el } from '../util/dom';
import { getCourseColor, getCourses, onRegistryChange } from '../courses/registry';
import { emailTeacherUrlFor } from '../tasks/teachers';
import { MAIL_BTN_SVG, SCHOOLOGY_SVG } from '../tasks/rowIcons';
import { fetchSgyGrades, getSgyApiState, sgyErrorText } from '../schoology/api';
import {
  applyEdits,
  categoryPct,
  defaultPeriod,
  emptyEdits,
  fmtPct,
  hasEdits,
  headline,
  isMissing,
  lastChange,
  letterFor,
  letterScale,
  monotoneCurve,
  nextLevel,
  points,
  pointsNeeded,
  RANGES,
  windowSeries,
  projectAdd,
  series,
  shownGrade,
  type Edits,
  type GAssign,
  type GCategory,
  type GCourse,
  type GScale,
  type RangeId,
  type Windowed,
  type GPeriod,
  type GradesPayload,
  type SeriesPoint,
} from './calc';

const STALE_MS = 5 * 60_000;
const SVG_NS = 'http://www.w3.org/2000/svg';
const MONTHS = ['January', 'February', 'March', 'April', 'May', 'June', 'July', 'August', 'September', 'October', 'November', 'December'];

type State =
  | { kind: 'loading' }
  | { kind: 'notConnected' }
  | { kind: 'blocked' }
  | { kind: 'error'; message: string }
  | { kind: 'ready'; payload: GradesPayload };

interface Calc {
  mode: 'score' | 'want'; // which question the What-if card is answering
  cat: string;
  earned: number; // points the student tries
  max: number; // what it is out of
  target: number | null; // percent the student wants to reach
}

const CLOCK =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>';
const CARET = '<svg viewBox="0 0 24 24" width="16" height="16" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 6l6 6-6 6"/></svg>';

export class GradesView {
  private data: Data;
  private goToTab: (id: string) => void;
  private panel: HTMLElement | null = null;
  private state: State = { kind: 'loading' };
  private loadedAt = 0;
  private loading = false;
  /** Open course (Schoology section id) or null for the grid. */
  private openId: string | null = null;
  private periodPick = new Map<string, string>();
  /** What-if edits, per course. Gone with the page: never saved. */
  private edits = new Map<string, Edits>();
  private openCats = new Set<string>();
  private calcState = new Map<string, Calc>();
  /** The graph's timescale, and the trend number on every course with it. */
  private range: RangeId = 'month';
  private host = '';
  private off: (() => void) | null = null;

  constructor(data: Data, goToTab: (id: string) => void) {
    this.data = data;
    this.goToTab = goToTab;
  }

  mount(panel: HTMLElement): void {
    this.panel = panel;
    this.off?.();
    this.off = onRegistryChange(() => this.paint());
    this.paint();
    void this.load(false);
    void this.data.getProfile<string>('gradesRange').then((v) => {
      if (RANGES.some((r) => r.id === v) && v !== this.range) {
        this.range = v as RangeId;
        if (this.state.kind === 'ready') this.paint();
      }
    });
  }

  onShow(): void {
    if (this.panel && Date.now() - this.loadedAt > STALE_MS) void this.load(false);
  }

  // #region Loading ---------------------------------------------------------------

  private async load(force: boolean): Promise<void> {
    if (this.loading) return;
    if (!force && this.state.kind === 'ready' && Date.now() - this.loadedAt < STALE_MS) return;
    this.loading = true;
    // Keep what is on screen while a re-read runs; only a first load shows the skeleton.
    if (this.state.kind !== 'ready') {
      this.state = { kind: 'loading' };
      this.paint();
    }
    try {
      const sample = await devSample();
      if (sample) {
        this.state = { kind: 'ready', payload: sample };
      } else {
        const sgy = await getSgyApiState(this.data).catch(() => null);
        if (!sgy?.connected) {
          this.state = { kind: 'notConnected' };
        } else {
          const raw = (await fetchSgyGrades()) as GradesPayload | null;
          if (!raw || raw.blocked) this.state = { kind: 'blocked' };
          else this.state = { kind: 'ready', payload: { ...raw, courses: (Array.isArray(raw.courses) ? raw.courses : []).map((c) => ({ ...c, scale: letterScale(c.scale) })) } };
        }
      }
      this.host = this.state.kind === 'ready' ? this.state.payload.host ?? '' : '';
      this.loadedAt = Date.now();
    } catch (err) {
      if (this.state.kind !== 'ready') this.state = { kind: 'error', message: sgyErrorText(err) };
    } finally {
      this.loading = false;
      // Never repaint under a student who is typing a what-if score.
      if (!(this.panel && this.panel.contains(document.activeElement) && document.activeElement instanceof HTMLInputElement)) this.paint();
    }
  }

  // #endregion

  // #region Paint -----------------------------------------------------------------

  private paint(): void {
    if (!this.panel) return;
    const keep = this.panel.scrollTop;
    const root = el('div', { class: 'grades' });
    const st = this.state;
    if (st.kind === 'loading') root.append(this.title(), this.skeleton());
    else if (st.kind === 'notConnected') root.append(this.title(), this.notice('Connect Schoology to see your grades here.', 'Open Settings', () => this.goToTab('settings')));
    else if (st.kind === 'blocked')
      root.append(this.title(), this.notice('Schoology isn’t sharing grades with Cobalt for your account. Some schools hide grades from students.'));
    else if (st.kind === 'error') root.append(this.title(), this.notice(st.message, 'Try again', () => void this.load(true)));
    else {
      const courses = st.payload.courses ?? [];
      const open = this.openId ? courses.find((c) => c.id === this.openId) : null;
      if (open) root.append(this.detail(open));
      else {
        this.openId = null;
        root.append(this.grid(courses));
      }
    }
    this.panel.replaceChildren(root);
    this.panel.scrollTop = keep;
  }

  private title(): HTMLElement {
    return el('div', { class: 'grades-head' }, [el('h2', { class: 'grades-title', text: 'Grades' })]);
  }

  private notice(text: string, btn?: string, onClick?: () => void): HTMLElement {
    const box = el('div', { class: 'grades-card grades-notice' }, [el('div', { class: 'grades-note', text })]);
    if (btn && onClick) {
      const b = el('button', { class: 'grades-btn', type: 'button', text: btn });
      b.addEventListener('click', onClick);
      box.append(b);
    }
    return box;
  }

  private skeleton(): HTMLElement {
    const wrap = el('div', { class: 'grades-grid' });
    for (let i = 0; i < 6; i++) wrap.append(el('div', { class: 'grades-card grades-skel' }));
    return wrap;
  }

  // #endregion

  // #region The grid of courses ---------------------------------------------------

  private grid(courses: GCourse[]): HTMLElement {
    const root = el('div', { class: 'grades-body' }, [this.title()]);
    if (!courses.length) {
      root.append(this.notice('No graded courses yet. Grades show up here as your teachers post them.'));
      return root;
    }
    root.append(el('div', { class: 'grades-label', text: 'Courses' }));
    const grid = el('div', { class: 'grades-grid' });
    for (const c of courses) grid.append(this.card(c, defaultPeriod(c)));
    root.append(grid);
    return root;
  }

  private card(c: GCourse, p: GPeriod): HTMLElement {
    const name = displayName(c.name);
    const color = getCourseColor(name);
    const now = headline(p, c.categories);
    const pts = series(c.categories, p.assignments);
    const win = windowSeries(pts, this.days());
    const btn = el('button', { class: 'grades-card grades-course', type: 'button' });
    btn.style.setProperty('--course', color);
    btn.append(
      el('div', { class: 'grades-course-top' }, [
        el('div', { class: 'grades-course-l' }, [el('span', { class: 'grades-course-name', text: name })]),
        el('div', { class: 'grades-course-r' }, [gradeEl(now, c.scale, 'grades-course-pct'), this.trendEl(win)]),
      ]),
      areaSpark(win, color)
    );
    const ts = lastChange(p.assignments);
    if (ts) btn.append(agoEl('Updated ', ts));
    btn.addEventListener('click', () => {
      this.openId = c.id;
      this.paint();
      this.panel?.scrollTo?.({ top: 0 });
    });
    return btn;
  }

  private days(): number | null {
    return RANGES.find((r) => r.id === this.range)?.days ?? null;
  }

  /** Week | Month | 3 months | All. One choice for the whole tab: the graph's span and
   *  the up/down number on every course follow it. */
  private rangeSeg(): HTMLElement {
    const seg = el('div', { class: 'tasks-mode-seg grades-range', role: 'tablist' });
    for (const r of RANGES) {
      const b = el('button', { class: 'tasks-mode-opt' + (r.id === this.range ? ' active' : ''), role: 'tab', type: 'button', text: r.label });
      b.addEventListener('click', () => {
        if (this.range === r.id) return;
        this.range = r.id;
        void this.data.setProfile('gradesRange', r.id).catch(() => {});
        this.paint();
      });
      seg.append(b);
    }
    return seg;
  }

  /** The red or green change under a grade, for the chosen timescale. */
  private trendEl(win: Windowed | null): HTMLElement {
    const phrase = RANGES.find((r) => r.id === this.range)?.phrase ?? '';
    const ch = win?.change;
    if (ch === null || ch === undefined) return el('span', { class: 'grades-trend' });
    if (Math.abs(ch) < 0.05) return el('span', { class: 'grades-trend' }, [el('span', { class: 'grades-trend-n', text: 'No change' }), ' ' + phrase]);
    const up = ch > 0;
    return el('span', { class: 'grades-trend ' + (up ? 'up' : 'down') }, [
      el('span', { class: 'grades-trend-n', text: `${up ? '▲' : '▼'} ${Math.abs(Math.round(ch * 10) / 10)}` }),
      el('span', { class: 'grades-trend-t', text: ' ' + phrase }),
    ]);
  }

  // #endregion

  // #region One course ------------------------------------------------------------

  private editsFor(id: string): Edits {
    let e = this.edits.get(id);
    if (!e) this.edits.set(id, (e = emptyEdits()));
    return e;
  }

  private detail(c: GCourse): HTMLElement {
    const name = displayName(c.name);
    const color = getCourseColor(name);
    const pid = this.periodPick.get(c.id);
    const p = c.periods.find((x) => x.id === pid) ?? defaultPeriod(c);
    const key = c.id + ':' + p.id;
    const ed = this.editsFor(key);
    const base = p.assignments;
    const mod = applyEdits(base, ed);
    const now = headline(p, c.categories);
    const edited = hasEdits(ed);
    const shown = edited ? shownGrade(c.categories, base, mod, now) : now;
    const root = el('div', { class: 'grades-body grades-detail' });
    root.style.setProperty('--course', color);

    const back = el('button', { class: 'grades-link', type: 'button', text: '‹ All courses' });
    back.addEventListener('click', () => {
      this.openId = null;
      this.paint();
    });
    root.append(back);

    // Header: name and when it last changed.
    const ts = lastChange(base);
    root.append(
      el('div', { class: 'grades-hero' }, [
        el('div', { class: 'grades-hero-l' }, [
          el('h2', { class: 'grades-title', text: name }),
          ts ? agoEl('Last updated ', ts) : '',
        ]),
      ])
    );

    if (c.periods.length > 1) {
      const seg = el('div', { class: 'tasks-mode-seg', role: 'tablist' });
      for (const per of c.periods) {
        const b = el('button', { class: 'tasks-mode-opt' + (per.id === p.id ? ' active' : ''), role: 'tab', type: 'button', text: per.title });
        b.addEventListener('click', () => {
          this.periodPick.set(c.id, per.id);
          this.paint();
        });
        seg.append(b);
      }
      root.append(el('div', { class: 'grades-seg-wrap' }, [seg]));
    }

    // The course grade banner. A what-if shows the pretend grade and how to undo it.
    const cats = c.categories.filter((k) => base.some((a) => a.cat === k.id)).length || (base.length ? 1 : 0);
    const bannerR = el('div', { class: 'grades-banner-r' }, [
      gradeEl(shown, c.scale, 'grades-banner-grade'),
      this.trendEl(windowSeries(series(c.categories, base), this.days())),
    ]);
    if (edited) {
      const reset = el('button', { class: 'grades-link', type: 'button', text: 'Reset what-if' });
      reset.addEventListener('click', () => {
        this.edits.set(key, emptyEdits());
        this.paint();
      });
      bannerR.append(el('span', { class: 'grades-banner-was', text: now === null ? 'What-if' : 'What-if · now ' + fmtPct(now) }), reset);
    }
    root.append(
      el('div', { class: 'grades-card grades-banner' + (edited ? ' whatif' : '') }, [
        el('div', { class: 'grades-banner-l' }, [
          el('span', { class: 'grades-label', text: 'Course grade' }),
          el('span', { class: 'grades-course-sub', text: `${plural(cats, 'category', 'categories')} · ${plural(base.length, 'assignment')}` }),
        ]),
        bannerR,
      ])
    );

    root.append(this.graphCard(series(c.categories, base), color, c.scale));
    root.append(this.categories(c, p, key, mod));
    root.append(this.whatIf(c, key, mod, shown));
    return root;
  }

  // #region Graph
  private graphCard(pts: SeriesPoint[], color: string, scale: GScale | null | undefined): HTMLElement {
    const head = el('div', { class: 'grades-card-head' }, [el('h3', { class: 'grades-h', text: 'Over time' }), this.rangeSeg()]);
    const card = el('div', { class: 'grades-card grades-graphcard' }, [head]);
    const win = windowSeries(pts, RANGES.find((r) => r.id === this.range)?.days ?? null);
    if (pts.length < 2 || !win) {
      card.append(el('div', { class: 'grades-note', text: 'The graph appears once two graded assignments are in.' }));
      return card;
    }
    const W = 760;
    const H = 220;
    const L = 44;
    const R = 14;
    const T = 14;
    const B = 28;
    const vals = win.pts.map((q) => q.pct);
    const lo = Math.max(0, Math.floor((Math.min(...vals) - 4) / 5) * 5);
    const hi = Math.min(100, Math.max(lo + 10, Math.ceil((Math.max(...vals) + 2) / 5) * 5));
    const t0 = win.start;
    const t1 = win.end;
    const xAt = (ms: number): number => L + ((ms - t0) / (t1 - t0 || 1)) * (W - L - R);
    const y = (v: number): number => T + (1 - (v - lo) / (hi - lo)) * (H - T - B);

    const svg = document.createElementNS(SVG_NS, 'svg');
    svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
    svg.setAttribute('class', 'grades-graph');
    svg.setAttribute('role', 'img');
    svg.setAttribute('aria-label', 'Grade over time. Hover the line to read the grade on any day.');
    const add = (tag: string, attrs: Record<string, string>, text?: string): SVGElement => {
      const n = document.createElementNS(SVG_NS, tag);
      for (const [k, v] of Object.entries(attrs)) n.setAttribute(k, v);
      if (text) n.textContent = text;
      svg.append(n);
      return n as SVGElement;
    };
    const step = hi - lo > 30 ? 10 : 5;
    for (let v = lo; v <= hi; v += step) {
      add('line', { x1: String(L), x2: String(W - R), y1: String(y(v)), y2: String(y(v)), class: 'grades-grid-line' });
      add('text', { x: String(L - 8), y: String(y(v) + 4), class: 'grades-axis', 'text-anchor': 'end' }, v + '%');
    }
    const dateLabel = (ms: number): string => {
      const dt = new Date(ms);
      return `${MONTHS[dt.getMonth()].slice(0, 3)} ${dt.getDate()}`;
    };
    // Along the bottom: days for a short range, weeks for a month, months beyond that.
    const spanDays = (t1 - t0) / 86_400_000;
    if (spanDays <= 45) {
      const every = spanDays <= 8 ? 1 : spanDays <= 16 ? 2 : 7;
      for (let k = 0; t0 + k * every * 86_400_000 <= t1; k++) {
        const ms = t0 + k * every * 86_400_000;
        add('line', { x1: String(xAt(ms)), x2: String(xAt(ms)), y1: String(T), y2: String(H - B), class: 'grades-grid-line v' });
        add('text', { x: String(xAt(ms) + (k === 0 ? 0 : 4)), y: String(H - 8), class: 'grades-axis' }, dateLabel(ms));
      }
    } else {
      const first = new Date(t0);
      const marks: { ms: number; label: number }[] = [];
      for (let d = new Date(first.getFullYear(), first.getMonth() + 1, 1); d.getTime() <= t1; d = new Date(d.getFullYear(), d.getMonth() + 1, 1)) {
        marks.push({ ms: d.getTime(), label: d.getMonth() });
      }
      const monthName = (m: number): string => (marks.length > 4 ? MONTHS[m].slice(0, 3) : MONTHS[m]);
      add('text', { x: String(L), y: String(H - 8), class: 'grades-axis' }, monthName(first.getMonth()));
      for (const m of marks) {
        add('line', { x1: String(xAt(m.ms)), x2: String(xAt(m.ms)), y1: String(T), y2: String(H - B), class: 'grades-grid-line v' });
        add('text', { x: String(xAt(m.ms) + 4), y: String(H - 8), class: 'grades-axis' }, monthName(m.label));
      }
    }
    // One smooth line through the real grades (calc.ts monotoneCurve): it glides
    // between them and never goes above the higher or below the lower.
    const curve = monotoneCurve(win.pts.map((q) => q.ms), vals);
    const first_ = xAt(win.pts[0].ms);
    let d = `M${first_.toFixed(1)} ${y(win.pts[0].pct).toFixed(1)}`;
    for (const g of curve.segs) {
      d += ` C${xAt(g.c1x).toFixed(1)} ${y(g.c1y).toFixed(1)} ${xAt(g.c2x).toFixed(1)} ${y(g.c2y).toFixed(1)} ${xAt(g.x1).toFixed(1)} ${y(g.y1).toFixed(1)}`;
    }
    d += ` H${xAt(t1).toFixed(1)}`;
    add('path', { d: `${d} V${H - B} H${first_} Z`, fill: color, opacity: '0.12' });
    add('path', { d, fill: 'none', stroke: color, 'stroke-width': '2.5', 'stroke-linejoin': 'round' });
    const real = win.pts.filter((q) => q.src);
    for (const q of real) add('circle', { cx: String(xAt(q.ms)), cy: String(y(q.pct)), r: '4', fill: color, class: 'grades-dot' });
    const guide = add('line', { y1: String(T), y2: String(H - B), class: 'grades-guide' });
    const cursor = add('circle', { r: '5', fill: 'var(--bg)', stroke: color, 'stroke-width': '2.5' });
    guide.style.display = 'none';
    cursor.style.display = 'none';

    const tip = el('div', { class: 'grades-tip' });
    tip.hidden = true;
    const wrap = el('div', { class: 'grades-graph-wrap' }, [svg, tip]);

    const onMove = (ev: PointerEvent): void => {
      const r = svg.getBoundingClientRect();
      const px = ((ev.clientX - r.left) / r.width) * W;
      if (px < L || px > W - R) return onLeave();
      const ms = t0 + ((px - L) / (W - L - R)) * (t1 - t0);
      // Snap to a change when the pointer is close to one; otherwise read the line.
      let near: (typeof real)[number] | null = null;
      for (const q of real) if (Math.abs(xAt(q.ms) - px) * (r.width / W) < 12) near = q;
      const shownPct = near ? near.pct : curve.at(ms);
      const gx = near ? xAt(near.ms) : px;
      guide.setAttribute('x1', String(gx));
      guide.setAttribute('x2', String(gx));
      cursor.setAttribute('cx', String(gx));
      cursor.setAttribute('cy', String(y(shownPct)));
      guide.style.display = '';
      cursor.style.display = '';
      // Grade first (white), then the assignment when this is a grade change (bold, in
      // the course's color), then the day. No dividers.
      const letter = letterFor(shownPct, scale);
      tip.replaceChildren(el('div', { class: 'grades-tip-t', text: fmtPct(Math.round(shownPct * 100) / 100) + (letter ? ` (${letter})` : '') }));
      if (near?.src) {
        tip.append(el('div', { class: 'grades-tip-task', text: near.src.title }));
        const dl = near.src.delta;
        tip.append(el('div', { class: 'grades-tip-s', text: dateLabel(near.ms) + (dl ? `  ·  ${dl >= 0 ? '+' : '−'}${Math.abs(Math.round(dl * 100) / 100)}` : '') }));
      } else tip.append(el('div', { class: 'grades-tip-s', text: dateLabel(ms) }));
      tip.hidden = false;
      const wr = wrap.getBoundingClientRect();
      const left = Math.min(Math.max(((gx / W) * r.width) - tip.offsetWidth / 2, 0), wr.width - tip.offsetWidth);
      tip.style.left = left + 'px';
      tip.style.top = Math.max(0, (y(shownPct) / H) * r.height - tip.offsetHeight - 14 + (r.top - wr.top)) + 'px';
    };
    const onLeave = (): void => {
      guide.style.display = 'none';
      cursor.style.display = 'none';
      tip.hidden = true;
    };
    svg.addEventListener('pointermove', onMove);
    svg.addEventListener('pointerleave', onLeave);
    card.append(wrap);
    return card;
  }
  // #endregion

  // #region Categories + assignments
  private categories(c: GCourse, p: GPeriod, key: string, mod: GAssign[]): HTMLElement {
    const list = el('div', { class: 'grades-cats' });
    const known = new Set(c.categories.map((k) => k.id));
    const cats: GCategory[] = c.categories.filter((k) => mod.some((a) => a.cat === k.id) || (k.weight ?? 0) > 0);
    if (mod.some((a) => !known.has(a.cat))) cats.push({ id: '', title: 'Other', weight: null });
    const totalW = cats.reduce((s, k) => s + (k.weight ?? 0), 0);
    const edited = hasEdits(this.editsFor(key));
    if (!cats.length) list.append(el('div', { class: 'grades-card grades-note', text: 'No graded assignments yet.' }));

    for (const cat of cats) {
      const items = mod.filter((a) => (cat.id === '' ? !known.has(a.cat) : a.cat === cat.id));
      const ck = key + ':' + cat.id;
      const open = this.openCats.has(ck);
      const pct = edited ? categoryPct(cat.id, items) : p.catPct[cat.id] ?? categoryPct(cat.id, items);
      const w = cat.weight && totalW > 0 ? Math.round((cat.weight / totalW) * 100) + '%' : '';

      const block = el('div', { class: 'grades-card grades-cat' + (open ? ' open' : '') });
      const head = el('div', { class: 'grades-cat-head' });
      const toggle = el('button', { class: 'grades-cat-toggle', type: 'button', 'aria-expanded': String(open) });
      const caret = el('span', { class: 'grades-cat-caret' });
      caret.innerHTML = CARET;
      toggle.append(
        caret,
        el('span', { class: 'grades-cat-id' }, [
          el('span', { class: 'grades-cat-name', text: cat.title }),
          el('span', { class: 'grades-course-sub', text: w ? 'Weight ' + w : 'No weight' }),
        ])
      );
      toggle.addEventListener('click', () => {
        if (!this.openCats.delete(ck)) this.openCats.add(ck);
        this.paint();
      });
      head.append(
        toggle,
        el('span', { class: 'grades-pill', text: pct === null ? 'N/A' : gradeText(pct, c.scale) })
      );
      block.append(head);
      if (open) {
        const body = el('div', { class: 'grades-assigns' });
        const sorted = [...items].sort((a, b) => (b.due || '9999').localeCompare(a.due || '9999') || b.ts - a.ts);
        if (!sorted.length) body.append(el('div', { class: 'grades-note', text: 'Nothing graded here yet.' }));
        for (const a of sorted) body.append(this.assignRow(c, key, a));
        block.append(body);
      }
      list.append(block);
    }
    return list;
  }

  private assignRow(c: GCourse, key: string, a: GAssign): HTMLElement {
    const ed = this.editsFor(key);
    const overridden = ed.set.has(a.id);
    const row = el('div', { class: 'grades-assign' });

    // Beside the title: open it in Schoology, and email the teacher about it. Nothing
    // else belongs here: the row is for reading a grade.
    const titleLine = el('div', { class: 'grades-assign-title' }, [el('span', { class: 'grades-assign-t', text: a.title })]);
    if (this.host) {
      const link = el('a', { class: 'grades-open grades-open-sgy', href: `https://${this.host}/assignment/${a.id}`, target: '_blank', rel: 'noopener noreferrer', title: 'Open in Schoology', 'aria-label': 'Open ' + a.title + ' in Schoology' });
      link.innerHTML = SCHOOLOGY_SVG;
      titleLine.append(link);
    }
    const mailUrl = emailTeacherUrlFor(displayName(c.name), a.title);
    if (mailUrl) {
      const mail = el('a', { class: 'grades-open', href: mailUrl, target: '_blank', rel: 'noopener noreferrer', title: 'Email teacher', 'aria-label': 'Email the teacher about ' + a.title });
      mail.innerHTML = MAIL_BTN_SVG;
      titleLine.append(mail);
    }
    const meta = el('div', { class: 'grades-assign-meta' });
    const when = a.ts ? 'Graded ' + ago(a.ts * 1000) : '';
    const due = a.due ? 'Due ' + a.due.slice(5, 7) + '/' + a.due.slice(8, 10) + '/' + a.due.slice(2, 4) : '';
    if (when) meta.append(clock());
    meta.append(el('span', { text: [when, due].filter(Boolean).join(' / ') }));
    const left = el('div', { class: 'grades-assign-l' }, [titleLine, meta]);

    if (overridden) {
      const b = el('button', { class: 'grades-mini', type: 'button', text: 'Undo what-if' });
      b.addEventListener('click', () => {
        ed.set.delete(a.id);
        this.paint();
      });
      left.append(el('div', { class: 'grades-assign-actions' }, [b]));
    }

    row.append(left, this.scorePill(c, key, a, overridden));
    return row;
  }

  /** The score on the right, in the course's color. Click it to try a different score
   *  AND a different out-of: a teacher can change what an assignment is worth, so both
   *  are open. */
  private scorePill(c: GCourse, key: string, a: GAssign, overridden: boolean): HTMLElement {
    const ed = this.editsFor(key);
    const wrap = el('div', { class: 'grades-score' });
    const edit = (): void => {
      const earned = el('input', { class: 'grades-input grades-score-in', type: 'number', min: '0', step: 'any', value: a.earned === null ? '' : String(a.earned) }) as HTMLInputElement;
      const max = el('input', { class: 'grades-input grades-score-in', type: 'number', min: '0', step: 'any', value: a.max === null ? '' : String(a.max) }) as HTMLInputElement;
      earned.setAttribute('aria-label', 'Score for ' + a.title);
      max.setAttribute('aria-label', 'Points ' + a.title + ' is out of');
      let done = false;
      const commit = (): void => {
        if (done) return;
        done = true;
        const e = earned.value.trim();
        const m = max.value.trim();
        const en = Number(e);
        const mn = Number(m);
        if (e === '' || !Number.isFinite(en) || en < 0 || !Number.isFinite(mn) || mn <= 0) return this.paint();
        ed.set.set(a.id, { earned: en, max: mn });
        this.paint();
      };
      const onKey = (ev: KeyboardEvent): void => {
        if (ev.key === 'Enter') commit();
        else if (ev.key === 'Escape') {
          done = true;
          this.paint();
        }
      };
      earned.addEventListener('keydown', onKey);
      max.addEventListener('keydown', onKey);
      // Leaving the pair (not just hopping from one box to the other) commits.
      wrap.addEventListener('focusout', (ev) => {
        const to = ev.relatedTarget as Node | null;
        if (!to || !wrap.contains(to)) commit();
      });
      wrap.replaceChildren(earned, el('span', { class: 'grades-score-of', text: '/' }), max);
      earned.focus();
      earned.select();
    };

    const pt = points(a);
    const btn = el('button', { class: 'grades-score-pill' + (overridden ? ' whatif' : '') + (isMissing(a) ? ' missing' : ''), type: 'button', title: 'Click to try a different score or out-of' });
    if (isMissing(a)) btn.append(el('span', { class: 'grades-score-main', text: 'Missing' }));
    else if (a.earned === null) btn.append(el('span', { class: 'grades-score-main', text: 'N/A' }));
    else {
      btn.append(el('span', { class: 'grades-score-main', text: `${trimNum(a.earned)} / ${trimNum(a.max ?? 0)}` }));
      if (pt && pt.m > 0) {
        const pct = (pt.e / pt.m) * 100;
        const l = letterFor(pct, c.scale);
        btn.append(el('span', { class: 'grades-score-sub', text: fmtPct(pct) + (l ? ` (${l})` : '') }));
      }
    }
    btn.addEventListener('click', edit);
    wrap.append(btn);
    return wrap;
  }
  // #endregion

  // #region What-if grades (under everything else)
  /** One card at the bottom with TWO separate questions, picked at the top:
   *   "If I score…"        you give a score, it shows the grade you would have;
   *   "I want a grade…"    you give a grade, it shows what you need in each category. */
  private whatIf(c: GCourse, key: string, mod: GAssign[], shown: number | null): HTMLElement {
    const weighted = c.categories.filter((k) => (k.weight ?? 0) > 0);
    const cats = weighted.length ? weighted : c.categories.length ? c.categories : [{ id: '', title: 'Any assignment', weight: null }];
    let cs = this.calcState.get(key);
    if (!cs) {
      const lastCat = cats[cats.length - 1].id;
      const worth = typicalMax(mod.filter((a) => a.cat === lastCat));
      const up = shown === null ? null : nextLevel(shown, c.scale);
      cs = { mode: 'score', cat: lastCat, earned: Math.round(worth * 0.9 * 100) / 100, max: worth, target: up ? up.cutoff : shown === null ? null : Math.min(100, Math.floor(shown) + 1) };
      this.calcState.set(key, cs);
    }
    const st = cs;

    const card = el('div', { class: 'grades-card grades-wi' });
    const seg = el('div', { class: 'tasks-mode-seg grades-wi-seg', role: 'tablist' });
    for (const [id, label] of [['score', 'If I score…'], ['want', 'I want a grade…']] as const) {
      const b = el('button', { class: 'tasks-mode-opt' + (st.mode === id ? ' active' : ''), role: 'tab', type: 'button', text: label });
      b.addEventListener('click', () => {
        if (st.mode === id) return;
        st.mode = id;
        this.paint();
      });
      seg.append(b);
    }
    card.append(
      el('div', { class: 'grades-card-head' }, [el('h3', { class: 'grades-h', text: 'What-if grades' }), seg]),
      el('div', { class: 'grades-note', text: st.mode === 'score' ? 'Try a score on one more assignment and see your grade. Nothing here changes your real grade.' : 'Pick the grade you want and see what you would need in each category. Nothing here changes your real grade.' })
    );

    const numBox = (value: number, label: string, on: (n: number) => void): HTMLInputElement => {
      const i = el('input', { class: 'grades-input grades-wi-num', type: 'number', min: '0', step: 'any', value: String(value) }) as HTMLInputElement;
      i.setAttribute('aria-label', label);
      i.addEventListener('input', () => {
        const n = Number(i.value);
        if (i.value !== '' && Number.isFinite(n) && n >= 0) on(n);
      });
      return i;
    };
    const row = (label: string, body: HTMLElement[], out: HTMLElement | null): HTMLElement =>
      el('div', { class: 'grades-wi-row' }, [el('span', { class: 'grades-wi-label', text: label }), el('div', { class: 'grades-wi-body' }, body), out ?? '']);

    if (st.mode === 'score') {
      // Which category the new assignment would be in.
      const chips = el('div', { class: 'grades-chips' });
      for (const k of cats) {
        const b = el('button', { class: 'grades-chip' + (k.id === st.cat ? ' on' : ''), type: 'button', text: k.title });
        b.addEventListener('click', () => {
          st.cat = k.id;
          st.max = typicalMax(mod.filter((a) => a.cat === k.id));
          st.earned = Math.round(st.max * 0.9 * 100) / 100;
          this.paint();
        });
        chips.append(b);
      }
      const out = el('div', { class: 'grades-wi-out' });
      const update = (): void => {
        const proj = st.max > 0 ? projectAdd(c.categories, mod, shown, { cat: st.cat, earned: st.earned, max: st.max }) : null;
        out.replaceChildren();
        if (proj === null) out.append(el('span', { class: 'grades-note', text: 'Not enough graded work yet.' }));
        else {
          const delta = shown === null ? 0 : proj - shown;
          out.append(
            el('span', { class: 'grades-wi-big', text: gradeText(Math.round(proj * 100) / 100, c.scale) }),
            shown === null ? '' : el('span', { class: 'grades-trend ' + (delta > 0.004 ? 'up' : delta < -0.004 ? 'down' : '') }, [el('span', { class: 'grades-trend-n', text: `${delta >= 0 ? '+' : '−'}${Math.abs(Math.round(delta * 100) / 100)}` })])
          );
        }
      };
      card.append(
        row('On a', [chips], null),
        row('If I score', [numBox(st.earned, 'Points you score', (n) => ((st.earned = n), update())), el('span', { class: 'grades-score-of', text: '/' }), numBox(st.max, 'Points it is out of', (n) => ((st.max = n), update()))], out)
      );
      update();
      return card;
    }

    // "I want a grade…": the grade, then the score needed in each category.
    if (shown === null) {
      card.append(el('div', { class: 'grades-note', text: 'Not enough graded work yet.' }));
      return card;
    }
    const levels = c.scale ? c.scale.levels.filter((l) => l.cutoff > shown + 1e-9).slice(-4) : [];
    const list = el('div', { class: 'grades-wi-need' });
    const fill = (): void => {
      list.replaceChildren();
      if (st.target === null) return;
      for (const k of cats) {
        const worth = typicalMax(mod.filter((a) => a.cat === k.id));
        const need = pointsNeeded(c.categories, mod, shown, st.target, { cat: k.id, max: worth });
        const out = el('div', { class: 'grades-wi-out' });
        if (!need) out.append(el('span', { class: 'grades-note', text: 'Not enough graded work yet.' }));
        else if (need.kind === 'already') out.append(el('span', { class: 'grades-wi-big', text: 'Already there' }));
        else if (need.kind === 'impossible') out.append(el('span', { class: 'grades-wi-big muted', text: 'Out of reach' }), el('span', { class: 'grades-note', text: `Full marks gets ${gradeText(Math.round(need.best * 100) / 100, c.scale)}` }));
        else out.append(el('span', { class: 'grades-wi-big', text: `${trimNum(need.earned)} / ${trimNum(worth)}` }), el('span', { class: 'grades-note', text: fmtPct(Math.round(need.pct * 100) / 100) }));
        list.append(el('div', { class: 'grades-wi-need-row' }, [el('span', { class: 'grades-wi-need-t', text: `On a ${k.title}` }), out]));
      }
    };
    let target: HTMLElement[];
    if (levels.length) {
      const box = el('div', { class: 'grades-chips' });
      for (const l of levels) {
        const b = el('button', { class: 'grades-chip' + (st.target !== null && Math.abs(st.target - l.cutoff) < 1e-6 ? ' on' : ''), type: 'button', text: `${l.title} (${l.cutoff}%)` });
        b.addEventListener('click', () => {
          st.target = l.cutoff;
          this.paint();
        });
        box.append(b);
      }
      target = [box];
    } else {
      target = [numBox(st.target ?? Math.min(100, Math.floor(shown) + 1), 'Grade you want, percent', (n) => ((st.target = n), fill())), el('span', { class: 'grades-score-of', text: '%' })];
    }
    card.append(row('I want', target, null), list);
    fill();
    return card;
  }
  // #endregion

  // #endregion
}

// #region Small builders
/** Schoology's section title, resolved to the student's own Cobalt course name when
 *  one matches (so the color and the Tasks tab agree), else as Schoology says it. */
function displayName(name: string): string {
  const lower = name.trim().toLowerCase();
  const hit = getCourses().find((k) => k.name.toLowerCase() === lower);
  return hit ? hit.name : name.trim();
}

/** "90.91% (A-)": the number first, the school's letter in parentheses after it. */
function gradeText(pct: number, scale: GScale | null | undefined): string {
  const l = letterFor(pct, scale);
  return fmtPct(pct) + (l ? ` (${l})` : '');
}

/** The same, as a heading: the number big, the letter small beside it on one line. */
function gradeEl(pct: number | null, scale: GScale | null | undefined, cls: string): HTMLElement {
  if (pct === null) return el('span', { class: cls, text: 'N/A' });
  const l = letterFor(pct, scale);
  return el('span', { class: cls }, [fmtPct(pct), l ? el('span', { class: 'grades-letter', text: ` (${l})` }) : '']);
}

/** "Updated 2 days ago", in the course's color when it changed in the last 2 hours. */
function agoEl(prefix: string, ts: number): HTMLElement {
  const fresh = Date.now() - ts * 1000 < 2 * 3_600_000;
  return el('div', { class: 'grades-ago' + (fresh ? ' fresh' : '') }, [clock(), el('span', { text: prefix + ago(ts * 1000) })]);
}

const trimNum = (n: number): string => String(Math.round(n * 100) / 100);
const plural = (n: number, one: string, many = one + 's'): string => `${n} ${n === 1 ? one : many}`;

function clock(): HTMLElement {
  const s = el('span', { class: 'grades-clock' });
  s.innerHTML = CLOCK;
  return s;
}

/** "2 days ago" style. */
function ago(ms: number): string {
  const s = Math.max(0, (Date.now() - ms) / 1000);
  const m = Math.floor(s / 60);
  const h = Math.floor(m / 60);
  const d = Math.floor(h / 24);
  if (s < 90) return 'just now';
  if (m < 60) return `${m} minutes ago`;
  if (h < 24) return h === 1 ? '1 hour ago' : `${h} hours ago`;
  if (d < 7) return d === 1 ? '1 day ago' : `${d} days ago`;
  if (d < 14) return 'last week';
  if (d < 60) return `${Math.floor(d / 7)} weeks ago`;
  return `${Math.floor(d / 30)} months ago`;
}

function typicalMax(items: GAssign[]): number {
  const m = items.filter((a) => a.max).map((a) => a.max as number);
  if (!m.length) return 100;
  m.sort((a, b) => a - b);
  return m[Math.floor(m.length / 2)];
}

/** The course card's trend: a line over a soft fill, as wide as the card. */
function areaSpark(win: Windowed | null, color: string): HTMLElement {
  const wrap = el('div', { class: 'grades-spark' });
  if (!win || win.pts.length < 1) return wrap;
  const W = 300;
  const H = 56;
  const ms = win.pts.map((q) => q.ms);
  const vals = win.pts.map((q) => q.pct);
  const lo = Math.min(...vals);
  const hi = Math.max(...vals);
  const span = Math.max(hi - lo, 4);
  // The same range, the same dates and the same smooth curve as the big graph.
  const X = (v: number): number => ((v - win.start) / (win.end - win.start || 1)) * W;
  const Y = (v: number): number => H - 6 - ((v - lo) / span) * (H - 14);
  const curve = monotoneCurve(ms, vals);
  let line = `M${X(ms[0]).toFixed(1)} ${Y(vals[0]).toFixed(1)}`;
  for (const g of curve.segs) line += ` C${X(g.c1x).toFixed(1)} ${Y(g.c1y).toFixed(1)} ${X(g.c2x).toFixed(1)} ${Y(g.c2y).toFixed(1)} ${X(g.x1).toFixed(1)} ${Y(g.y1).toFixed(1)}`;
  line += ` H${W}`;
  const svg = document.createElementNS(SVG_NS, 'svg');
  svg.setAttribute('viewBox', `0 0 ${W} ${H}`);
  svg.setAttribute('preserveAspectRatio', 'none');
  svg.setAttribute('aria-hidden', 'true');
  const area = document.createElementNS(SVG_NS, 'path');
  area.setAttribute('d', `${line} L${W} ${H} L${X(ms[0]).toFixed(1)} ${H} Z`);
  area.setAttribute('fill', color);
  area.setAttribute('opacity', '0.14');
  const path = document.createElementNS(SVG_NS, 'path');
  path.setAttribute('d', line);
  path.setAttribute('fill', 'none');
  path.setAttribute('stroke', color);
  path.setAttribute('stroke-width', '2');
  path.setAttribute('vector-effect', 'non-scaling-stroke');
  path.setAttribute('stroke-linejoin', 'round');
  svg.append(area, path);
  wrap.append(svg);
  return wrap;
}

/** Local-only sample gradebook for looking at the screen without a connection:
 *  `npm run dev`, then add ?gradesSample=1. Absent from the production bundle. */
async function devSample(): Promise<GradesPayload | null> {
  if (!import.meta.env.DEV || !/[?&]gradesSample=1/.test(location.search)) return null;
  return (await import('./sample')).sampleGrades();
}
// #endregion
