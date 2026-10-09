// Cobalt: Dashboard tab (landing screen).
// Time-aware greeting, the daily quote (style picked in Settings; library in
// src/quotes.ts), and the "due today" + schedule cards.

import type { Data } from '../db';
import type { ScheduleItem } from '../types';
import { el, textInput } from '../util/dom';
import { todayStr, addDays, scheduleMonday, formatWallClock } from '../util/dates';
import { getPrefs, PREFS_EVENT } from '../prefs';
import { quoteOfDay, type Quote } from '../quotes';
import { openAttachment, normalizeUrl } from '../tasks/attachments';
import { isAssessmentTask } from '../tasks/store';
import { TasksView } from '../tasks/render';
import { addCourse, getCourses, matchByParseWords } from '../courses/registry';
import { nextCourseColor } from '../courses/colors';
import type { CourseConfig } from '../types';
import { openPopup, tabScopedOverlay } from '../ui/popup';
import {
  type ScheduleBlock,
  type ScheduleFeed,
  FEED_EVENT,
  calendarDayUrl,
  currentCourses,
  dayOf,
  dayToShow,
  getFeed,
  isGoogleCalendarIcalUrl,
  loadBlocks,
  readCache,
  refreshFeed,
  saveFeed,
} from '../schedule/feed';


// The landing preview shows ONE fixed, hand-picked pair — it's a showcase, not a
// day-to-day surface, so every visitor sees the same screen. The signed-in app
// keeps the rotating greeting + quote-of-the-day.
const SAMPLE_GREETING = "Let's do this";
const SAMPLE_QUOTE: Quote = {
  text: 'Begin. To begin is half the work.',
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

/**
 * The schedule QUICK LINK, stored at profile/scheduleLink. Many schools keep the
 * timetable outside Schoology (Heschel's lives in Veracross, on a per-student
 * page whose URL never changes), so the card takes that page's URL once and
 * then opens it in a click from every sign-in (Gabe, 9/12/26). Nothing is
 * fetched or parsed: the page needs the student's own school login, which only
 * their browser has. Removing the link (the ✕ on the row) clears the profile key.
 */
interface ScheduleLink {
  url: string;
}
const SCHEDULE_LINK_KEY = 'scheduleLink';

/** Calendar glyph with an outward arrow: "open this day in Google Calendar". */
const GCAL_SVG =
  '<svg viewBox="0 0 24 24" width="14" height="14" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="16" rx="2"/><path d="M16 3v4M8 3v4M3 11h18"/><path d="M12 15h4m0 0-1.5-1.5M16 15l-1.5 1.5"/></svg>';

export class DashboardView {
  private data: Data;
  private firstName: string;
  private goToTab: (id: string) => void;
  private dueBox!: HTMLElement;
  private scheduleBox!: HTMLElement;
  /** Last rendered schedule week, kept so a REMOUNT can paint the card instantly.
   *  Without it, every remount built an empty .dash-schedule and only filled it
   *  once getProfile('schedule') resolved, so the card visibly blinked out and
   *  back (Gabe, 8/13, spotted when pinning a task-row action, which fires
   *  PREFS_EVENT → mount()). null = never fetched, so there is nothing to paint. */
  private scheduleWeek: ScheduleItem[] | null = null;
  /** The saved quick link, cached beside scheduleWeek for the same instant repaint. */
  private scheduleLink: ScheduleLink | null = null;
  /** True while the "paste a link" form is open, so a repaint keeps it open. */
  private linkFormOpen = false;
  /** The connected Google Calendar schedule (schedule/feed.ts), or null. When set,
   *  the card is "Current Schedule": the real day, block by block (Gabe, 10/5/26). */
  private feed: ScheduleFeed | null = null;
  private feedBlocks: ScheduleBlock[] | null = null;
  private feedError = '';
  /** The form's own error line, kept across repaints. */
  private linkFormError = '';
  private linkFormBusy = false;
  /** Repaints the card once a minute so "now" moves on its own. */
  private tick = 0;
  /** A day chosen from the header's day picker (YYYY-MM-DD), or null for the
   *  automatic one (today while it has blocks left, else the next day with any). */
  private pickedDay: string | null = null;
  private greetingEl: HTMLElement | null = null;
  private sample: boolean; // landing preview → external links (schedule) are inert
  private panelEl: HTMLElement | null = null; // kept so a prefs change can re-render
  private wired = false; // watchTasks/onRegistryChange subscribed exactly once
  // The excerpt views' own containers. Built once each, then moved between
  // rebuilt cards, so their subscriptions are never duplicated.
  private dueBody: HTMLElement | null = null;
  private overdueBox!: HTMLElement;
  private overdueBody: HTMLElement | null = null;
  private onFeedChange = (): void => {
    this.pickedDay = null;
    void this.refreshSchedule();
  };
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
    // Settings → Courses changed or removed the Google Calendar link: refetch.
    window.removeEventListener(FEED_EVENT, this.onFeedChange);
    window.addEventListener(FEED_EVENT, this.onFeedChange);

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
    // OVERDUE sits ABOVE Current Tasks (Gabe, 8/11) and shouts in red: it is the
    // one thing on this screen that is already going wrong. It rides the same
    // Settings toggle as the tasks card, since it is the same family of card.
    this.overdueBox = el('div', { class: 'dash-overdue' });
    if (this.sample || prefs.tasksCard) wrap.append(this.overdueBox);

    this.dueBox = el('div', { class: 'dash-due' });
    if (this.sample || prefs.tasksCard) wrap.append(this.dueBox);

    this.scheduleBox = el('div', { class: 'dash-schedule' });
    if (this.sample || prefs.scheduleCard) wrap.append(this.scheduleBox);
    // Paint the cached week SYNCHRONOUSLY, before this frame is shown. The async
    // refreshSchedule() below still runs and quietly replaces it with fresh data;
    // this just means the card is never briefly blank on a remount.
    if (this.scheduleWeek) this.renderSchedule(this.scheduleWeek);

    panel.append(wrap);

    // The Today's-Tasks card no longer needs a task subscription of its own: the
    // excerpt view inside it watches tasks, folders and the course registry
    // directly. This one stays for the SCHEDULE card.
    this.renderOverdue();
    this.renderDue();
    if (!this.wired) {
      this.wired = true;
      this.data.watchTasks(() => {
        void this.refreshSchedule(); // a sync that adds tasks also refreshes the schedule
      });
    }
    void this.refreshSchedule();
  }

  /**
   * "Current Tasks" (Gabe 9/26; "Today's Tasks" until 9/22, then "Due Today &
   * Tomorrow", which read as a promise to list everything due, finished work
   * included, while the card shows only what is still open) is a REAL
   * EXCERPT of the Tasks tab (Gabe, 8/10), not a lookalike: it mounts a
   * TasksView in excerpt mode filtered to today and tomorrow, so the rows are
   * byte-for-byte the Tasks-tab rows (course chip, due time, badges,
   * attachments, priority, editing, multi-select) and can never drift from
   * them. Tasks living in folders are compiled in alongside the loose ones,
   * because "due today or tomorrow" is one question, not one per folder.
   *
   * Mounted ONCE and left alone: the excerpt view has its own watchTasks
   * subscription, so it repaints itself on the same tick as the Tasks tab.
   * renderDue only builds the card's header the first time.
   */
  /**
   * The OVERDUE card: the same real-excerpt trick as Current Tasks, filtered to
   * anything dated before today and still open, in red.
   *
   * It HIDES ITSELF when nothing is overdue (the count comes from the excerpt
   * view's own filter, via onCount). A permanent red panel reading "nothing
   * overdue" would be a daily false alarm, and emphasis only works when it is
   * rare. On a clean day the dashboard looks exactly as it did before.
   */
  private renderOverdue(): void {
    this.overdueBox.replaceChildren();
    const header = el('div', { class: 'dash-schedule-header dash-overdue-header' });
    const link = el('button', { class: 'dash-due-link', text: 'Overdue' });
    link.addEventListener('click', () => this.goToTab('tasks'));
    header.append(link);
    this.overdueBox.append(header);
    if (!this.overdueBody) {
      this.overdueBody = el('div', { class: 'dash-due-list' });
      new TasksView(this.data, this.sample ? { host: this.overdueBody } : undefined, {
        // Dated, in the past, still open. todayStr() is read per render so the
        // card rolls over correctly on a session left open past midnight.
        // Assessments are exempt: a test whose day passed happened, it isn't
        // late (Gabe, 9/1/26) — same rule the Tasks list applies.
        filter: (t) => !!t.dueDate && t.dueDate < todayStr() && !isAssessmentTask(t),
        empty: '', // never seen: the card hides itself at zero
        onCount: (n) => this.overdueBox.classList.toggle('on', n > 0),
      }).mount(this.overdueBody);
    }
    this.overdueBox.append(this.overdueBody);
  }

  private renderDue(): void {
    this.dueBox.replaceChildren();
    // SAME CLASS as the Schedule card's header (Gabe, 8/10) so the two cards are
    // one design: identical size, weight, color and spacing, no second rule to
    // keep in step. The title is still the way over to the full list (the rows
    // themselves are real task rows now, so clicking one edits, not navigates),
    // and .dash-due-link strips the button chrome so it reads as the heading.
    const header = el('div', { class: 'dash-schedule-header' });
    const link = el('button', { class: 'dash-due-link', text: 'Current Tasks' });
    link.addEventListener('click', () => this.goToTab('tasks'));
    header.append(link);
    this.dueBox.append(header);
    if (!this.dueBody) {
      this.dueBody = el('div', { class: 'dash-due-list' });
      // todayStr() is read per render (not captured), so a session left open
      // past midnight rolls over to the new day on the next repaint. In the
      // landing preview, popups mount INSIDE the frame, as the Tasks preview does.
      // Tomorrow is included alongside today (Gabe, 9/22) because a task due
      // tomorrow is usually due in the morning, which in practice means it has
      // to get done tonight.
      new TasksView(this.data, this.sample ? { host: this.dueBody } : undefined, {
        filter: (t) => t.dueDate === todayStr() || t.dueDate === addDays(todayStr(), 1),
        empty: 'All clear today and tomorrow',
      }).mount(this.dueBody);
    }
    // A prefs change re-mounts the dashboard and rebuilds dueBox. RE-USE the same
    // element and the same view: constructing a second one would add a second
    // watchTasks subscription every time (Data has no unsubscribe).
    this.dueBox.append(this.dueBody);
  }

  // --- schedule (Monday-anchored, matching Schoology's weekly posts) -------
  // Mon–Fri shows THIS week's schedule; Sat & Sun show NEXT week's, so students
  // can prep ahead. See scheduleMonday() in util/dates.

  private async refreshSchedule(): Promise<void> {
    const [stored, link, feed] = await Promise.all([
      this.data.getProfile<{ list: ScheduleItem[] }>('schedule'),
      this.data.getProfile<ScheduleLink>(SCHEDULE_LINK_KEY),
      this.sample ? Promise.resolve(null) : getFeed(this.data),
    ]);
    this.scheduleLink = link?.url ? link : null;
    this.feed = feed;
    if (!feed) this.feedBlocks = null; // never carry one link's days into the next
    if (feed) {
      // Paint from the cache at once; loadBlocks refetches only when it is stale.
      this.feedBlocks = readCache(feed.url)?.blocks ?? this.feedBlocks;
      void loadBlocks(feed.url).then((r) => {
        if (this.feed?.url !== feed.url) return; // disconnected meanwhile
        this.feedBlocks = r.blocks;
        this.feedError = r.error;
        this.renderSchedule(this.scheduleWeek ?? []);
      });
      this.startTick();
    }
    const items = stored?.list ?? [];
    const monday = scheduleMonday();
    const weekEnd = addDays(monday, 5); // Mon…Sat window catches any weekday-dated post
    // Items in the target week, de-duplicated by title (the feed posts one per weekday).
    const seen = new Set<string>();
    const week = items
      .filter((it) => it.date >= monday && it.date <= weekEnd)
      .filter((it) => (seen.has(it.title) ? false : (seen.add(it.title), true)))
      .sort((a, b) => a.date.localeCompare(b.date));

    this.scheduleWeek = week; // cached so the next mount() can paint without waiting
    this.renderSchedule(week);
  }

  /** Build the Schedule card's contents. Split out of refreshSchedule so it can
   *  run synchronously from the cache on mount, with no await in front of it. */
  private renderSchedule(week: ScheduleItem[]): void {
    this.scheduleBox.replaceChildren();
    if (this.feed) {
      this.renderCurrentSchedule();
      return;
    }
    // No refresh icon (Gabe, 9/12): the quick link below is a manual paste, not a
    // Schoology sync, so there is nothing here for a refresh to re-pull.
    const header = el('div', { class: 'dash-schedule-header' });
    header.append(el('span', { text: 'Schedule' }));
    this.scheduleBox.append(header);

    const link = this.scheduleLink;
    // The quick link IS the whole timetable, so it gets one plain button, not a
    // titled row (Gabe, 9/12: "My schedule" + "View Schedule" read as redundant).
    if (link) {
      const row = el('div', { class: 'dash-schedule-linkrow' });
      const view = el('a', { class: 'dash-schedule-view-btn', text: 'View Schedule →' });
      if (!this.sample) view.addEventListener('click', () => openAttachment(link.url));
      const remove = el('button', { class: 'dash-schedule-link-x', text: '✕', title: 'Remove schedule link' });
      remove.addEventListener('click', () => void this.saveScheduleLink(null));
      row.append(view, remove);
      this.scheduleBox.append(row);
    }

    // Schoology-fed weekly posts (rare: Heschel's own schedule lives in Veracross,
    // so this list is normally empty; other schools may still post it there).
    if (week.length) {
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

    // No link yet: offer the one-time paste, no "no schedule" caption (Gabe, 9/12:
    // it isn't needed — the add button already says what's missing). The landing
    // preview never shows it, since nothing there can be saved.
    if (!link && !this.sample) {
      this.scheduleBox.append(this.linkFormOpen ? this.buildLinkForm() : this.buildLinkAddBtn());
    }
  }

  private buildLinkAddBtn(): HTMLElement {
    const btn = el('button', { class: 'dash-schedule-add', text: '+ Connect your schedule' });
    btn.addEventListener('click', () => {
      this.linkFormOpen = true;
      this.renderSchedule(this.scheduleWeek ?? []);
      this.scheduleBox.querySelector<HTMLTextAreaElement>('.dash-schedule-link-input')?.focus();
    });
    return btn;
  }

  /** Paste box + Save/Cancel. Enter saves, Escape cancels. A blank Save is a no-op. */
  private buildLinkForm(): HTMLElement {
    const form = el('div', { class: 'dash-schedule-link-form' });
    const input = textInput({
      class: 'dash-schedule-link-input',
      placeholder: 'Paste your Google Calendar secret address, or any schedule page',
      'aria-label': 'Schedule link',
    });
    const save = el('button', { class: 'dash-schedule-link-save', text: 'Save' });
    const cancel = el('button', { class: 'dash-schedule-link-cancel', text: 'Cancel' });
    const err = el('div', { class: 'dash-schedule-link-err', text: this.linkFormError });
    const submit = () => {
      if (this.linkFormBusy) return;
      // A Google Calendar feed becomes the live Current Schedule; anything else is
      // the old one-click quick link to a schedule page.
      if (isGoogleCalendarIcalUrl(input.value)) {
        void this.connectFeed(input.value);
        return;
      }
      const url = normalizeUrl(input.value);
      if (!url) return;
      this.linkFormOpen = false;
      void this.saveScheduleLink({ url });
    };
    const close = () => {
      this.linkFormOpen = false;
      this.linkFormError = '';
      this.renderSchedule(this.scheduleWeek ?? []);
    };
    save.addEventListener('click', submit);
    cancel.addEventListener('click', close);
    input.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') {
        e.preventDefault();
        submit();
      } else if (e.key === 'Escape') close();
    });
    if (this.linkFormBusy) {
      save.textContent = 'Connecting…';
      save.setAttribute('disabled', '');
    }
    const help = el('div', {
      class: 'dash-schedule-link-help',
      text: 'Google Calendar: Settings → your calendar → Integrate calendar → copy "Secret address in iCal format".',
    });
    form.append(input, help, err, el('div', { class: 'dash-schedule-link-btns' }, [save, cancel]));
    return form;
  }

  /** Validate a pasted Google Calendar address by actually reading it, then save. */
  private async connectFeed(raw: string): Promise<void> {
    this.linkFormBusy = true;
    this.linkFormError = '';
    this.renderSchedule(this.scheduleWeek ?? []);
    try {
      const blocks = await refreshFeed(raw);
      await saveFeed(this.data, raw);
      this.linkFormOpen = false;
      this.feed = await getFeed(this.data);
      this.feedBlocks = blocks;
      this.feedError = '';
      this.startTick();
    } catch (e) {
      this.linkFormError = e instanceof Error ? e.message : 'Couldn’t read that calendar.';
    }
    this.linkFormBusy = false;
    this.renderSchedule(this.scheduleWeek ?? []);
  }

  private startTick(): void {
    if (this.tick) return;
    this.tick = window.setInterval(() => {
      if (this.feed && this.scheduleBox?.isConnected) this.renderSchedule(this.scheduleWeek ?? []);
    }, 60_000);
  }

  // --- Current Schedule (the connected Google Calendar feed) --------------

  /** A block's color: its course's color for a class, one neutral gray for
   *  everything that is not a course (Gabe, 10/5). The schedule's course names
   *  ("Accelerated Biology") need not equal the student's own ("Biology"), so an
   *  exact match is tried first, then containment either way, then the student's
   *  parse words. */
  private matchCourse(name: string): CourseConfig | undefined {
    const lower = name.toLowerCase();
    const courses = getCourses();
    const byWord = matchByParseWords(name);
    return (
      courses.find((c) => c.name.toLowerCase() === lower) ??
      courses.find(
        (c) => c.name.length >= 3 && (lower.includes(c.name.toLowerCase()) || c.name.toLowerCase().includes(lower))
      ) ??
      (byWord ? courses.find((c) => c.name === byWord) : undefined)
    );
  }

  private blockColor(b: ScheduleBlock): string {
    if (!b.isClass) return 'var(--sched-neutral)';
    const hit = this.matchCourse(b.name);
    if (hit) return hit.color;
    // Not one of the student's courses yet: a steady color of its own (from the
    // name), so it never reads as the gray of a non-class block.
    let h = 0;
    for (const ch of b.name) h = (h * 31 + ch.charCodeAt(0)) >>> 0;
    return `hsl(${h % 360} 65% 62%)`;
  }

  /** A small menu hanging below `anchor`, right-aligned to it: the Tasks row
   *  menu's idiom (backdrop catches the outside click, Esc closes, leaving the
   *  tab closes), reusing its .row-menu styles. */
  private dropdown(anchor: HTMLElement, build: (menu: HTMLElement, close: () => void) => void): void {
    const doc = anchor.ownerDocument;
    const back = el('div', { class: 'row-menu-back' });
    const menu = el('div', { class: 'row-menu' });
    back.append(menu);
    doc.body.append(back);
    const close = tabScopedOverlay(() => {
      back.remove();
      doc.removeEventListener('keydown', onKey, true);
    });
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        close();
      }
    };
    doc.addEventListener('keydown', onKey, true);
    back.addEventListener('click', (e) => {
      if (e.target === back) close();
    });
    build(menu, close);
    const a = anchor.getBoundingClientRect();
    const b = back.getBoundingClientRect();
    const m = menu.getBoundingClientRect();
    const left = Math.max(8, Math.min(a.right - b.left - m.width, back.offsetWidth - m.width - 8));
    const top = Math.max(8, Math.min(a.bottom - b.top + 6, back.offsetHeight - m.height - 8));
    menu.style.left = `${left}px`;
    menu.style.top = `${top}px`;
  }

  /** "More days…": a month grid in the app's popup where any day that has a
   *  schedule can be picked (Gabe, 10/7). Days without one are dimmed and inert;
   *  ‹ › walk the months the calendar covers. */
  private openDayCalendar(days: string[], shownDate: string, today: string, pick: (date: string) => void): void {
    const avail = new Set(days);
    const first = days[0];
    const last = days[days.length - 1];
    const monthOf = (date: string): string => date.slice(0, 7);
    let month = monthOf(shownDate); // 'YYYY-MM'
    openPopup('Pick a day', (body, close) => {
      const wrap = el('div', { class: 'dash-cal' });
      body.append(wrap);
      const draw = (): void => {
        wrap.replaceChildren();
        const [y, m] = month.split('-').map(Number);
        const nav = el('div', { class: 'dash-cal-nav' });
        const prev = el('button', { class: 'dash-cal-btn', text: '‹', title: 'Previous month' });
        const next = el('button', { class: 'dash-cal-btn', text: '›', title: 'Next month' });
        prev.disabled = month <= monthOf(first);
        next.disabled = month >= monthOf(last);
        const shift = (by: number): void => {
          const d = new Date(y, m - 1 + by, 1);
          month = `${d.getFullYear()}-${String(d.getMonth() + 1).padStart(2, '0')}`;
          draw();
        };
        prev.addEventListener('click', () => shift(-1));
        next.addEventListener('click', () => shift(1));
        nav.append(
          prev,
          el('span', { class: 'dash-cal-title', text: new Date(y, m - 1, 1).toLocaleDateString(undefined, { month: 'long', year: 'numeric' }) }),
          next
        );
        wrap.append(nav);
        const grid = el('div', { class: 'dash-cal-grid' });
        for (const wd of ['S', 'M', 'T', 'W', 'T', 'F', 'S']) grid.append(el('span', { class: 'dash-cal-wd', text: wd }));
        const lead = new Date(y, m - 1, 1).getDay();
        for (let i = 0; i < lead; i++) grid.append(el('span'));
        const count = new Date(y, m, 0).getDate();
        for (let d = 1; d <= count; d++) {
          const date = `${month}-${String(d).padStart(2, '0')}`;
          const on = avail.has(date);
          const cell = el('button', {
            class: `dash-cal-day${on ? '' : ' off'}${date === shownDate ? ' on' : ''}${date === today ? ' today' : ''}`,
            text: String(d),
          });
          if (!on) cell.disabled = true;
          else
            cell.addEventListener('click', () => {
              close();
              pick(date);
            });
          grid.append(cell);
        }
        wrap.append(grid);
      };
      draw();
    });
  }

  /** One schedule row: start time with the end time beneath it (Gabe, 10/7),
   *  the color bar, name + meta, and "N min left" while it is on. `pinned` is
   *  the duplicate at the top of the card, which never dims as past. */
  private buildBlockRow(b: ScheduleBlock, now: number, pinned: boolean): HTMLElement {
    const isNow = b.start <= now && now < b.end;
    const past = !pinned && b.end <= now;
    const row = el('div', {
      class: `dash-sched-row${b.isClass ? '' : ' misc'}${isNow ? ' now' : ''}${past ? ' past' : ''}${pinned ? ' pinned' : ''}`,
    });
    row.style.setProperty('--c', this.blockColor(b));
    const time = el('span', { class: 'dash-sched-time' });
    time.append(
      el('span', { class: 'dash-sched-t-start', text: formatWallClock(b.start) }),
      el('span', { class: 'dash-sched-t-end', text: formatWallClock(b.end) })
    );
    row.append(time);
    row.append(el('span', { class: 'dash-sched-bar' }));
    const main = el('div', { class: 'dash-sched-main' });
    main.append(el('div', { class: 'dash-sched-name', text: b.name }));
    const meta = [b.period, b.detail, b.room && (/^\d/.test(b.room) ? `Room ${b.room}` : b.room), b.teachers.join(', ')].filter(Boolean).join(' · ');
    if (meta) main.append(el('div', { class: 'dash-sched-meta', text: meta }));
    row.append(main);
    if (isNow) {
      const left = Math.max(1, Math.round((b.end - now) / 60_000));
      row.append(el('span', { class: 'dash-sched-now', text: `${left} min left` }));
    }
    return row;
  }

  private renderCurrentSchedule(): void {
    const now = Date.now();
    const blocks = this.feedBlocks ?? [];
    const auto = this.feedBlocks ? dayToShow(this.feedBlocks, now) : null;
    // Every day the calendar still has ahead (the cache holds ~5 weeks), for the
    // day picker (Gabe, 10/7). A picked day that has passed falls back to auto.
    const days = auto ? [...new Set(blocks.filter((b) => dayOf(b.start) >= auto.date).map((b) => dayOf(b.start)))].sort() : [];
    if (this.pickedDay && !days.includes(this.pickedDay)) this.pickedDay = null;
    const shown =
      this.pickedDay && this.pickedDay !== auto?.date
        ? { date: this.pickedDay, blocks: blocks.filter((b) => dayOf(b.start) === this.pickedDay) }
        : auto;

    const header = el('div', { class: 'dash-schedule-header' });
    header.append(el('span', { text: 'Current Schedule' }));
    const right = el('div', { class: 'dash-sched-head-right' });
    // The shown day's weekday and date, always (Gabe, 10/7). A day that is not
    // today keeps its own weekday; tomorrow says so in place of the weekday.
    // The label is a button that drops down every available day.
    const dayLabel = (dateStr: string, long: boolean): string => {
      const d = new Date(dateStr + 'T12:00:00');
      const md = d.toLocaleDateString(undefined, { month: 'short', day: 'numeric' });
      if (dayOf(now + 86_400_000) === dateStr) return `Tomorrow, ${md}`;
      if (long && dayOf(now) === dateStr) return `Today, ${md}`;
      return `${d.toLocaleDateString(undefined, { weekday: 'long' })}, ${md}`;
    };
    const shownDate = shown?.date ?? dayOf(now);
    const dayBtn = el('button', { class: 'dash-sched-day', title: 'Choose a day', 'aria-haspopup': 'menu' });
    dayBtn.append(el('span', { text: dayLabel(shownDate, false) }));
    const pick = (date: string): void => {
      this.pickedDay = date === auto?.date ? null : date;
      this.renderSchedule(this.scheduleWeek ?? []);
    };
    if (days.length > 1) {
      dayBtn.append(el('span', { class: 'dash-sched-day-caret', text: '▾' }));
      dayBtn.addEventListener('click', () =>
        this.dropdown(dayBtn, (menu, close) => {
          // The next seven days only, then "More days…" opens a calendar for the
          // rest (Gabe, 10/7: the full list crowded the menu).
          for (const date of days.slice(0, 7)) {
            const item = el('button', { class: `more-go dash-sched-day-opt${date === shownDate ? ' on' : ''}` });
            item.append(el('span', { class: 'more-label', text: dayLabel(date, true) }));
            if (date === shownDate) item.append(el('span', { class: 'dash-sched-day-check', text: '✓' }));
            item.addEventListener('click', () => {
              close();
              pick(date);
            });
            menu.append(item);
          }
          if (days.length > 7) {
            const more = el('button', { class: 'more-go dash-sched-day-opt dash-sched-day-more' });
            more.append(el('span', { class: 'more-label', text: 'More days…' }));
            more.addEventListener('click', () => {
              close();
              this.openDayCalendar(days, shownDate, dayOf(now), pick);
            });
            menu.append(more);
          }
        })
      );
    } else {
      dayBtn.setAttribute('disabled', '');
    }
    right.append(dayBtn);
    // Quick hop to the same day in Google Calendar, to cross-check the schedule
    // (Gabe, 10/7). Same idea as the ↗ on a task that opens it in Schoology.
    const gcal = el('button', { class: 'dash-schedule-link-x dash-sched-gcal', title: 'Open in Google Calendar' });
    gcal.innerHTML = GCAL_SVG;
    gcal.addEventListener('click', () => {
      if (this.sample || !this.feed) return;
      openAttachment(calendarDayUrl(this.feed.url, shownDate));
    });
    right.append(gcal);
    // No ✕ here (Gabe, 10/7): changing or removing the link lives in Settings → Courses.
    header.append(right);
    this.scheduleBox.append(header);

    if (!shown) {
      this.scheduleBox.append(
        el('div', {
          class: 'dash-sched-empty',
          text:
            this.feedBlocks === null
              ? this.feedError || 'Loading your schedule…'
              : 'Nothing on your schedule in the next few weeks.',
        })
      );
      return;
    }

    const isToday = shown.date === dayOf(now);

    // The current period, pinned above the schedule in its own container
    // (Gabe, 10/7): the first thing seen. During a gap between periods the slot
    // shows the next one instead, so it never blinks out mid-day.
    if (isToday) {
      const current = shown.blocks.find((b) => b.start <= now && now < b.end);
      const next = current ? null : shown.blocks.find((b) => b.start > now);
      const b = current ?? next;
      if (b) {
        const pin = el('div', { class: 'dash-sched-pin' });
        const label = current
          ? 'Now'
          : `Up next · in ${Math.max(1, Math.round((b.start - now) / 60_000))} min`;
        pin.append(el('div', { class: 'dash-sched-pin-label', text: label }));
        pin.append(this.buildBlockRow(b, now, true));
        this.scheduleBox.append(pin);
      }
    }

    const list = el('div', { class: 'dash-sched-list' });
    for (const b of shown.blocks) list.append(this.buildBlockRow(b, now, false));
    this.scheduleBox.append(list);

    // Schedule courses Cobalt doesn't know yet: one click adds them all, each in a
    // color nothing else is wearing, so the schedule and the task list match.
    const missing = currentCourses(this.feedBlocks ?? []).filter((n) => !this.matchCourse(n));
    if (missing.length) {
      const add = el('button', {
        class: 'dash-schedule-add',
        text: `+ Add ${missing.length} course${missing.length === 1 ? '' : 's'} from your schedule`,
        title: missing.join(', '),
      });
      add.addEventListener('click', () => {
        add.setAttribute('disabled', '');
        void (async () => {
          for (const name of missing) {
            await addCourse(name, nextCourseColor(getCourses().map((c) => c.color)));
          }
          this.renderSchedule(this.scheduleWeek ?? []);
        })();
      });
      this.scheduleBox.append(add);
    }
  }

  /** Write (or clear, with null) the quick link and repaint the card from cache. */
  private async saveScheduleLink(link: ScheduleLink | null): Promise<void> {
    this.scheduleLink = link;
    this.renderSchedule(this.scheduleWeek ?? []); // optimistic: the row appears at once
    await this.data.setProfile(SCHEDULE_LINK_KEY, link ?? { url: '' });
  }
}
