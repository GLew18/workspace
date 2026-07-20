// WorkSpace — Dashboard tab (landing screen).
// Time-aware greeting, the daily quote (style picked in Settings; library in
// src/quotes.ts), and the "due today" + schedule cards.

import type { Data } from '../db';
import type { Task, TaskMap, ScheduleItem } from '../types';
import { el } from '../util/dom';
import { todayStr, addDays, scheduleMonday, formatTimeOfDay } from '../util/dates';
import { getPrefs, PREFS_EVENT } from '../prefs';
import { quoteOfDay, type Quote } from '../quotes';
import { sortTasks } from '../tasks/store';
import { getCourseColor, onRegistryChange } from '../courses/registry';
import { openAttachment } from '../tasks/attachments';
import { runSync } from '../schoology/sync';


// The landing preview shows ONE fixed, hand-picked pair — it's a showcase, not a
// day-to-day surface, so every visitor sees the same screen. The signed-in app
// keeps the rotating greeting + quote-of-the-day.
const SAMPLE_GREETING = "Let's do this";
const SAMPLE_QUOTE: Quote = {
  text: 'Begin — to begin is half the work.',
  author: 'Marcus Aurelius',
};

// Greetings shown ANY time of day. Sentence case throughout (only the first word
// capitalized) — each reads as a warm, clear nudge toward getting to work.
const ANYTIME_GREETINGS = [
  "Let's lock in",
  'Time to get after it',
  'Welcome back',
  "Let's make it count",
  'Good to see you',
  'Time to focus',
  'Back at it',
  "Let's do this",
  'Onwards and upwards',
  "Let's get to work",
  "Let's build something",
  'Time to shine',
  'Make today yours',
  "Let's get it",
  "You've got this",
  "Let's go",
  'Another day, another win',
  'Ready when you are',
  'One task at a time',
  'Great to have you here',
];

/** How long one greeting stays before rotating to the next (4 hours). */
const GREETING_ROTATE_MS = 4 * 60 * 60 * 1000;

/**
 * The five time-of-day greetings (late-night, early-bird, morning, afternoon,
 * evening) only enter the pool inside their hour range; the 20 above are always
 * eligible. The pick is a deterministic time bucket — the SAME greeting for a
 * 4-hour window, across sign-ins and reloads — then it rotates to the next.
 */
function greetingPhrase(): string {
  const h = new Date().getHours();
  const pool = [...ANYTIME_GREETINGS];
  if (h >= 21 || h < 4) pool.push('Late night focus');
  else if (h < 7) pool.push('Early bird gets the worm');
  else if (h < 12) pool.push('Good morning');
  else if (h < 17) pool.push('Good afternoon');
  else pool.push('Good evening');
  const bucket = Math.floor(Date.now() / GREETING_ROTATE_MS);
  return pool[bucket % pool.length];
}

function greeting(name: string): string {
  return `${greetingPhrase()}, ${name}`;
}

export class DashboardView {
  private data: Data;
  private firstName: string;
  private goToTab: (id: string) => void;
  private dueBox!: HTMLElement;
  private scheduleBox!: HTMLElement;
  private greetingEl: HTMLElement | null = null;
  private sample: boolean; // landing preview → external links (schedule) are inert
  private panelEl: HTMLElement | null = null; // kept so a prefs change can re-render
  private wired = false; // watchTasks/onRegistryChange subscribed exactly once
  private onPrefsChange = (): void => {
    if (this.panelEl) this.mount(this.panelEl);
  };

  constructor(data: Data, displayName: string, goToTab: (id: string) => void, sample = false) {
    this.data = data;
    this.firstName = (displayName || 'there').trim().split(/\s+/)[0];
    this.goToTab = goToTab;
    this.sample = sample;
  }

  /** Update the displayed name live (e.g. after a rename in Settings). */
  setName(displayName: string): void {
    this.firstName = (displayName || 'there').trim().split(/\s+/)[0];
    if (this.greetingEl) {
      this.greetingEl.textContent =
        this.sample || getPrefs().dash.greetName ? greeting(this.firstName) : greetingPhrase();
    }
  }

  mount(panel: HTMLElement): void {
    // Re-render live when Settings changes a dashboard pref (greeting/quote/cards).
    this.panelEl = panel;
    window.removeEventListener(PREFS_EVENT, this.onPrefsChange);
    window.addEventListener(PREFS_EVENT, this.onPrefsChange);

    const prefs = getPrefs().dash;
    panel.replaceChildren();
    const wrap = el('div', { class: 'dash' });

    this.greetingEl = el('h1', {
      class: 'dash-greeting',
      text: this.sample
        ? `${SAMPLE_GREETING}, ${this.firstName}`
        : prefs.greetName
          ? greeting(this.firstName)
          : greetingPhrase(),
    });
    wrap.append(this.greetingEl);

    if (this.sample || prefs.quote) {
      const q = this.sample ? SAMPLE_QUOTE : quoteOfDay(prefs.quoteStyle);
      const quoteEl = el('div', { class: 'dash-quote' });
      quoteEl.append(
        el('div', { class: 'dash-quote-text', text: `“${q.text}”` }),
        el('div', { class: 'dash-quote-author', text: `— ${q.author}` })
      );
      wrap.append(quoteEl);
    }

    // The boxes always exist (update()/refreshSchedule() write into them); the
    // Settings toggles decide whether they're APPENDED — an off card renders into
    // a detached node, harmlessly.
    this.dueBox = el('div', { class: 'dash-due' });
    if (this.sample || prefs.tasksCard) wrap.append(this.dueBox);

    this.scheduleBox = el('div', { class: 'dash-schedule' });
    if (this.sample || prefs.scheduleCard) wrap.append(this.scheduleBox);

    panel.append(wrap);

    // Subscribe once — re-mounts (prefs changes) reuse the same callbacks, which
    // read the CURRENT dueBox/scheduleBox fields.
    if (!this.wired) {
      this.wired = true;
      this.data.watchTasks((u) => {
        this.update(u.tasks);
        void this.refreshSchedule(); // a sync that adds tasks also refreshes the schedule
      });
      onRegistryChange(() => this.update(this.data.getTasks()));
    } else {
      this.update(this.data.getTasks());
    }
    void this.refreshSchedule();
  }

  private update(tasks: TaskMap): void {
    this.renderDue(tasks);
  }

  private renderDue(tasks: TaskMap): void {
    const today = todayStr();
    // The app's ONE task ordering (tasks/store.ts). All of these share today's date,
    // so it reduces to priority → time → addedAt → id; the deterministic tail keeps
    // tied tasks from shuffling when a Firebase snapshot re-orders the map.
    const due: Task[] = sortTasks(Object.values(tasks).filter((t) => !t.completed && t.dueDate === today));

    this.dueBox.replaceChildren();
    const count = due.length;
    const header = el('div', { class: 'dash-due-header' });
    header.append(el('span', { text: "Today's Tasks" }));
    this.dueBox.append(header);

    if (count === 0) {
      this.dueBox.append(el('div', { class: 'dash-due-empty', text: 'All clear today' }));
      return;
    }

    const list = el('div', { class: 'dash-due-list' });
    for (const t of due) {
      const row = el('div', { class: 'dash-due-item' });
      const dot = el('span', { class: 'dash-due-dot' });
      dot.style.background = getCourseColor(t.course); // dot = course color
      row.append(dot, el('span', { class: 'dash-due-title', text: t.title }));
      if (t.dueTime) row.append(el('span', { class: 'dash-due-time', text: this.fmtTime(t.dueTime) }));
      row.addEventListener('click', () => this.goToTab('tasks'));
      list.append(row);
    }
    this.dueBox.append(list);
  }

  /** A "Refresh schedule" button that re-pulls the Schoology iCal on demand.
   *  On success runSync() calls data.refresh(), which re-runs refreshSchedule and
   *  rebuilds this button fresh (back to idle). We only restore state on error. */
  private makeRefreshBtn(label: string): HTMLButtonElement {
    // Icon-only (↻). The label lives in the tooltip; states are single glyphs so
    // the button never changes width: spins while loading, ⚠ on failure.
    const btn = el('button', { class: 'dash-refresh-btn', text: '↻', title: label }) as HTMLButtonElement;
    if (this.sample) {
      // Landing preview: the button is scenery — looks real, does nothing.
      // (CSS also disables pointer events; skipping the listener + tab stop
      // covers keyboard activation.)
      btn.tabIndex = -1;
      return btn;
    }
    btn.addEventListener('click', async () => {
      btn.disabled = true;
      btn.classList.add('spinning');
      try {
        await runSync(this.data); // success → data.refresh() rebuilds this button fresh
      } catch {
        btn.classList.remove('spinning');
        btn.textContent = '⚠';
        setTimeout(() => {
          btn.disabled = false;
          btn.textContent = '↻';
        }, 1800);
      }
    });
    return btn;
  }

  // --- schedule (Monday-anchored, matching Schoology's weekly posts) -------
  // Mon–Fri shows THIS week's schedule; Sat & Sun show NEXT week's, so students
  // can prep ahead. See scheduleMonday() in util/dates.

  private async refreshSchedule(): Promise<void> {
    const stored = await this.data.getProfile<{ list: ScheduleItem[] }>('schedule');
    const items = stored?.list ?? [];
    const monday = scheduleMonday();
    const weekEnd = addDays(monday, 5); // Mon…Sat window catches any weekday-dated post
    // Items in the target week, de-duplicated by title (the feed posts one per weekday).
    const seen = new Set<string>();
    const week = items
      .filter((it) => it.date >= monday && it.date <= weekEnd)
      .filter((it) => (seen.has(it.title) ? false : (seen.add(it.title), true)))
      .sort((a, b) => a.date.localeCompare(b.date));

    this.scheduleBox.replaceChildren();
    const header = el('div', { class: 'dash-schedule-header' });
    header.append(el('span', { text: 'Schedule' }));
    header.append(this.makeRefreshBtn('Refresh schedule'));
    this.scheduleBox.append(header);

    if (!week.length) {
      this.scheduleBox.append(el('div', { class: 'dash-schedule-empty', text: 'No schedule this week.' }));
      return;
    }

    const list = el('div', { class: 'dash-schedule-list' });
    for (const it of week) {
      const row = el('a', { class: 'dash-schedule-item' });
      row.append(el('span', { class: 'dash-schedule-title', text: it.title }));
      row.append(el('span', { class: 'dash-schedule-open', text: 'View Schedule →' }));
      if (it.url && !this.sample) row.addEventListener('click', () => openAttachment(it.url));
      list.append(row);
    }
    this.scheduleBox.append(list);
  }

  private fmtTime(hhmm: string): string {
    return formatTimeOfDay(hhmm); // honors the Time-format pref (12h/24h)
  }
}
