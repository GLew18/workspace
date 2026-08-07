// WorkSpace — Settings: one scrolling page (Name · Schoology · Courses).
//
// Every field saves itself the moment you change it — there's no Save button.
// The one exception is the Schoology calendar link: because changing it re-imports
// your assignments, it stays behind an explicit "Save & sync" action with a
// confirmation, so a stray keystroke can't wipe your feed. Each field has a "?"
// that explains what it does (the seed of the larger in-app briefing system).

// #region Imports & types — dependencies, the draft model, the options object
import type { Data } from '../db';
import type { CourseConfig, SchoologySettings } from '../types';
import { el, textInput, escapeHtml, enterConfirms } from '../util/dom';
import { genId } from '../util/ids';
import { capitalizeName } from '../util/names';
import { getCourses, replaceCourses } from '../courses/registry';
import { runSync } from '../schoology/sync';
import { signOut } from '../auth';
import { getPrefs, setPrefsCache, PREFS_EVENT, type AppPrefs } from '../prefs';
import { END_SOUNDS, DEFAULT_END_SOUND, DEFAULT_END_VOLUME, playEndSound } from '../focus/sounds';
import { armAudioContext } from '../focus/timer';
import { LIBRARY_TRACKS, MUSIC_GENRES } from '../focus/library';
import { loadPlaylists, playlistEmoji, playlistKey, type CustomPlaylist } from '../focus/playlists';
import { NOTIFY_GUIDES } from './notifyGuides';
import {
  type NotifySettings,
  type NotifyAppearance,
  type Channels,
  NOTIFY_SETTINGS_EVENT,
  normalizeNotifySettings,
  reminderBody,
  taskInfoBody,
  leadLabel,
  intervalLabel,
  ensureNotificationPermission,
  notificationPermission,
  sendNotification,
  setEmailAddress,
} from '../notify/notify';

// Preview button glyphs: a play triangle and a two-bar pause, drawn as SVG so
// they stay crisp and monochrome (inherit the button's accent color).
const PLAY_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><path d="M8 5v14l11-7z" fill="currentColor"/></svg>';
const PAUSE_SVG =
  '<svg viewBox="0 0 24 24" width="13" height="13" aria-hidden="true"><rect x="6" y="5" width="4" height="14" rx="1" fill="currentColor"/><rect x="14" y="5" width="4" height="14" rx="1" fill="currentColor"/></svg>';

const NEW_COURSE_COLOR = '#9ca3af';

// Sidebar tab icons (19px line icons, stroke follows the button's text color).
const NAV_ICONS: Record<string, string> = {
  Profile:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" aria-hidden="true"><circle cx="12" cy="8" r="4"/><path d="M4 21c0-4.5 4-7 8-7s8 2.5 8 7"/></svg>',
  // NOTE: these keys ARE the tab labels — NAV_ICONS[label] and DESCS[label] both
  // look up by the visible string, so renaming a tab means renaming all three.
  Tasks:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M2 8l10-4 10 4-10 4z"/><path d="M6 10v5c0 1.6 3 3 6 3s6-1.4 6-3v-5"/></svg>',
  Courses:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 6C10 5 6 5 4 6v13c2-1 6-1 8 0 2-1 6-1 8 0V6c-2-1-6-1-8 0z"/><path d="M12 6v13"/></svg>',
  Focus:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" aria-hidden="true"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.6"/></svg>',
  Notifications:
    '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M18 8A6 6 0 0 0 6 8c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>',
};

interface SettingsOpts {
  displayName: string;
  email: string;
  onNameChange: (name: string) => void;
}

interface Draft {
  name: string;
  icalUrl: string;
  courses: CourseConfig[];
  endSound: string;
  endVolume: number; // 0..1, the Focus end-sound Volume slider
  endSoundEnabled: boolean; // the End Sound master switch (children hide when off)
  // Assignment reminders (see src/notify) — the whole settings object, saved the
  // moment any of it changes, like every field.
  notify: NotifySettings;
  // App-wide preferences (see src/prefs): dashboard toggles, syncing, import
  // filters, focus toggles. Saved instantly; PREFS_EVENT repaints live views.
  prefs: AppPrefs;
}
// #endregion

// #region Help content — copy shown by the "?" popups next to each field
const HELP: Record<string, { title: string; text: string }> = {
  account: {
    title: 'Your account',
    text: 'The login this WorkSpace belongs to. It’s set by how you signed in (Google, later) and can’t be changed here. Your data is tied to it.',
  },
  name: {
    title: 'Your name',
    text: 'What WorkSpace calls you, in your greeting and across the app. It’s always capitalized, and you can change it anytime.',
  },
  ical: {
    title: 'Schoology calendar link',
    text: 'Your personal Schoology calendar (iCal) link. WorkSpace uses it to import your assignments automatically. Find it in Schoology under Settings → your calendar feed, then paste it here.\n\nIt’s read-only and has no password in it. WorkSpace never sees your Schoology login, and you can reset the link in Schoology anytime.',
  },
  course: {
    title: 'Course name',
    text: 'A class you take. WorkSpace labels and color-codes its assignments with this name so your work is easy to scan.',
  },
  color: {
    title: 'Course color',
    text: 'The color shown for this course: its dot and label in Tasks, the Dashboard, and Focus.',
  },
  parseWords: {
    title: 'Parse words',
    text: 'Keywords that automatically file an assignment into this course: a teacher’s name, a room number, or a word that keeps showing up. If an assignment’s title or description contains one, it’s tagged to this course automatically.\n\nThe same word can’t belong to two courses.',
  },
  endSound: {
    title: 'Focus end sound',
    text: 'The sound that plays when a focus session finishes: a clear, several-seconds-long cue so you know the session is over. Drag Volume to set how loud it is. Tap ▶ to preview any option (tap again to stop), then tap a sound to choose it. Your choice saves the moment you make it.',
  },
};
// #endregion

export class SettingsView {
  // #region State & lifecycle — fields, constructor, full-page render (mount)
  private data: Data;
  private opts: SettingsOpts;
  private icalInput?: HTMLTextAreaElement;
  private icalErr?: HTMLElement;
  private syncIcalBtn?: () => void; // refreshes the iCal button's label to match the field
  private statusEl?: HTMLElement; // the "Last synced …" caption under the link
  private draft: Draft = {
    name: '',
    icalUrl: '',
    courses: [],
    endSound: DEFAULT_END_SOUND,
    endVolume: DEFAULT_END_VOLUME,
    endSoundEnabled: true,
    notify: normalizeNotifySettings(null),
    prefs: structuredClone(getPrefs()),
  };
  private schoologyMeta: SchoologySettings | null = null;
  private preview?: { btn: HTMLElement; stop: () => void; setVolume: (v: number) => void; timer: number }; // active sound preview
  private newCourseIds = new Set<string>(); // courses added this session — they get parse-word recommendations
  private refocusParseId: string | null = null; // after adding a parse word, return the cursor to that course's "+ parse word" input

  constructor(data: Data, opts: SettingsOpts) {
    this.data = data;
    this.opts = opts;
  }

  /** Render Settings as a full screen into a tab panel. */
  async mount(panel: HTMLElement): Promise<void> {
    // NOTE: don't clear the panel yet — keep the current view on screen during
    // the async read below, then swap it out atomically (panel.replaceChildren
    // at the end). Clearing up front left a blank panel flashing during load.

    // Load current values into a working draft; each field then saves itself on change.
    // ONE read for the whole profile collection: three separate getProfile()
    // calls each re-fetch it (a network round-trip apiece in Firebase mode),
    // which is what made opening Settings lag behind a blank panel.
    const profile = await this.data.getProfileAll();
    const account = profile['account'] as { displayName?: string } | undefined;
    this.schoologyMeta = (profile['schoology'] as SchoologySettings | undefined) || {
      icalUrl: '',
      lastSyncAt: null,
    };
    const savedSound = profile['focusEndSound'] as { key: string; volume?: number; enabled?: boolean } | undefined;
    this.draft = {
      name: account?.displayName || this.opts.displayName,
      icalUrl: this.schoologyMeta.icalUrl,
      courses: getCourses().map((c) => ({ ...c, parseWords: [...(c.parseWords ?? [])] })),
      endSound: savedSound?.key || DEFAULT_END_SOUND,
      endVolume: savedSound?.volume ?? DEFAULT_END_VOLUME,
      endSoundEnabled: savedSound?.enabled ?? true,
      notify: normalizeNotifySettings(profile['notifications']),
      prefs: structuredClone(getPrefs()), // boot loaded + normalized it already
    };
    // Recommendations are only for courses created in this Settings session; saved
    // courses (reloaded above) start clean each visit.
    this.newCourseIds.clear();

    const page = el('div', { class: 'settings-page' });

    // Build every section once; the side tabs reveal one at a time (like the app
    // sidebar / most settings pages), instead of one long scrolling column.
    const secProfile = this.sectionProfile();
    const secSchool = this.sectionSchoology();
    const secCourses = this.sectionCourses();
    const secSound = this.sectionSound();
    const secNotify = this.sectionNotify();
    const tabs: [string, HTMLElement][] = [
      ['Profile', secProfile],
      ['Tasks', secSchool],
      ['Courses', secCourses],
      ['Focus', secSound],
      ['Notifications', secNotify],
    ];

    // Artifact-style page heads: each tab opens with its title + a one-line purpose.
    const DESCS: Record<string, string> = {
      Profile: 'Your account and how WorkSpace behaves for you.',
      Tasks: 'Where your assignments come from, what gets imported, and how the calendar looks.',
      Courses: "Name, color, and auto-file each class's assignments with parse words.",
      Focus: 'Defaults for your focus sessions: sound, timer, and music.',
      Notifications: 'Assignment reminders and daily digests, with a live preview of each.',
    };
    for (const [label, sec] of tabs) {
      const head = el('div', { class: 'settings-page-head' });
      head.append(
        el('div', { class: 'settings-page-title', text: label }),
        el('div', { class: 'settings-page-desc', text: DESCS[label] ?? '' })
      );
      sec.prepend(head);
    }

    const content = el('div', { class: 'settings-content' });
    for (const [, sec] of tabs) content.append(sec);

    // Vertical side navigation: the "Settings" title on top, one tab per section.
    const side = el('aside', { class: 'settings-side' });
    side.append(el('h2', { class: 'settings-side-title', text: 'Settings' }));
    const navButtons: HTMLButtonElement[] = [];
    const show = (idx: number) => {
      tabs.forEach(([, sec], i) => (sec.hidden = i !== idx));
      navButtons.forEach((b, i) => b.classList.toggle('active', i === idx));
      content.scrollTop = 0;
    };
    tabs.forEach(([label], i) => {
      const b = el('button', { class: 'settings-side-btn' }) as HTMLButtonElement;
      b.innerHTML = NAV_ICONS[label] ?? '';
      b.append(el('span', { text: label }));
      b.addEventListener('click', () => show(i));
      navButtons.push(b);
      side.append(b);
    });

    const shell = el('div', { class: 'settings-shell' });
    shell.append(side, content);
    page.append(shell);
    panel.replaceChildren(page); // swap in the finished page in one shot (no blank flash)
    show(0); // Profile tab active by default
  }
  // #endregion

  // #region Auto-save — each field persists itself; the iCal link stays gated
  /** Display name — capitalized, propagated to the greeting/header. Saved on blur. */
  private async saveName(): Promise<void> {
    const name = capitalizeName(this.draft.name) || 'Student';
    this.draft.name = name;
    await this.data.setProfile('account', { displayName: name, onboarded: true });
    this.opts.displayName = name;
    this.opts.onNameChange(name);
  }

  /** Courses, colors & parse words — the whole list persists as one profile key. */
  private async saveCourses(): Promise<void> {
    await replaceCourses(this.draft.courses.map((c) => ({ ...c, name: c.name.trim() })));
  }

  /** Focus end-sound choice + volume + on/off. */
  private async saveSound(): Promise<void> {
    await this.data.setProfile('focusEndSound', {
      key: this.draft.endSound,
      volume: this.draft.endVolume,
      enabled: this.draft.endSoundEnabled,
    });
  }

  /** App prefs — update the live cache first (so views repaint synchronously on
   *  the event), then persist. */
  private async savePrefs(): Promise<void> {
    setPrefsCache(structuredClone(this.draft.prefs));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: this.draft.prefs }));
    await this.data.setProfile('prefs', this.draft.prefs);
  }

  // --- shared pref-row builders (artifact-style rows: title + sub | control) ---

  private prefRow(title: string, sub: string, ctrl: HTMLElement, soon = false): HTMLElement {
    const row = el('div', { class: 'srow' });
    const main = el('div', { class: 'srow-main' });
    const t = el('div', { class: 'srow-title', text: title });
    if (soon) t.append(el('span', { class: 'settings-soon', text: 'soon' }));
    main.append(t, el('div', { class: 'srow-sub', text: sub }));
    const c = el('div', { class: 'srow-ctrl' });
    c.append(ctrl);
    row.append(main, c);
    return row;
  }

  private prefSwitch(initial: boolean, onToggle: (on: boolean) => void): HTMLButtonElement {
    const sw = el('button', { class: 'nswitch' }) as HTMLButtonElement;
    sw.setAttribute('role', 'switch');
    sw.setAttribute('aria-checked', String(initial));
    sw.addEventListener('click', () => {
      const on = sw.getAttribute('aria-checked') !== 'true';
      sw.setAttribute('aria-checked', String(on));
      onToggle(on);
    });
    return sw;
  }

  private prefSeg<T extends string | number>(
    options: [T, string][],
    current: () => T,
    onPick: (v: T) => void
  ): HTMLElement {
    const seg = el('div', { class: 'nseg' });
    seg.style.gridTemplateColumns = `repeat(${options.length}, 1fr)`;
    const btns = options.map(([v, label]) => {
      const b = el('button', { class: 'nseg-btn', text: label }) as HTMLButtonElement;
      b.addEventListener('click', () => {
        onPick(v);
        btns.forEach((x, i) => x.classList.toggle('active', options[i][0] === v));
      });
      seg.append(b);
      return b;
    });
    btns.forEach((x, i) => x.classList.toggle('active', options[i][0] === current()));
    return seg;
  }

  /** Assignment-reminder prefs — persist, then tell the live scheduler (no polling). */
  private async saveNotify(): Promise<void> {
    const notify = this.draft.notify;
    await this.data.setProfile('notifications', notify);
    window.dispatchEvent(new CustomEvent(NOTIFY_SETTINGS_EVENT, { detail: notify }));
  }

  /** The calendar link is the ONE gated field: validate, confirm a change to an
   *  existing link (it re-imports everything), then commit + sync. */
  private applyIcal(): void {
    const prev = (this.schoologyMeta?.icalUrl || '').trim();
    const next = this.draft.icalUrl.trim().replace(/^webcal:\/\//i, 'https://');

    // Reject non-calendar syntax before anything persists. Empty = removing the link.
    if (next && !isValidIcalUrl(next)) {
      this.setIcalError(true);
      return;
    }
    this.setIcalError(false);

    // Safeguard: changing or removing an EXISTING link needs a confirm.
    if (prev && next !== prev) {
      this.confirmDanger(
        next
          ? 'Change your Schoology link? This re-imports your assignments from the new feed.'
          : 'Remove your Schoology link? WorkSpace will stop importing your assignments.',
        () => void this.commitIcal(next)
      );
      return;
    }
    void this.commitIcal(next);
  }

  private async commitIcal(icalUrl: string): Promise<void> {
    this.setIcalError(false);
    const schoology = { ...(this.schoologyMeta || { lastSyncAt: null }), icalUrl };
    await this.data.setProfile('schoology', schoology);
    this.schoologyMeta = schoology;
    this.draft.icalUrl = icalUrl;
    if (this.icalInput) this.icalInput.value = icalUrl; // reflect webcal→https normalization
    this.syncIcalBtn?.(); // link now matches what's saved → button returns to "Sync now"

    if (icalUrl) {
      this.setSyncStatus('Syncing…');
      try {
        const r = await runSync(this.data);
        this.schoologyMeta = (await this.data.getProfile<SchoologySettings>('schoology')) || this.schoologyMeta;
        this.setSyncStatus(
          `Synced: ${r.added} new${r.updated ? `, ${r.updated} updated` : ''}${r.skipped - r.updated > 0 ? `, ${r.skipped - r.updated} unchanged` : ''}.`
        );
      } catch (err) {
        this.setSyncStatus('Sync failed: ' + (err as Error).message, true);
      }
    } else {
      this.setSyncStatus('Not synced yet.');
    }
  }

  /** A red, can't-miss confirmation for destructive/sensitive changes. */
  private confirmDanger(title: string, onYes: () => void): void {
    const back = el('div', { class: 'confirm-backdrop' });
    const box = el('div', { class: 'confirm-box' });
    box.append(el('h3', { class: 'confirm-title', text: title }));
    const row = el('div', { class: 'confirm-actions' });
    const cancel = el('button', { class: 'confirm-cancel', text: 'Cancel' });
    cancel.addEventListener('click', () => back.remove());
    const yes = el('button', { class: 'confirm-yes', text: 'Yes' });
    yes.addEventListener('click', () => {
      back.remove();
      onYes();
    });
    row.append(cancel, yes);
    box.append(row);
    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) back.remove();
    });
    enterConfirms(back, () => yes); // Enter = Yes (the confirm's whole point)
    document.body.append(back);
  }
  // #endregion

  // #region Field builders — the Profile / Schoology / Courses sections + their status
  // --- sections -----------------------------------------------------------

  private sectionProfile(): HTMLElement {
    const sec = el('section', { class: 'settings-section', id: 'sec-profile' });

    // Login email — read-only (set by how you signed in). Self-explanatory, no help.
    sec.append(el('div', { class: 'settings-label', text: 'Account' }));
    const email = el('div', { class: 'settings-readonly' });
    email.textContent = this.opts.email || 'Signed in locally';
    sec.append(email);

    // Display name — editable.
    const nameLabel = el('div', { class: 'settings-label', text: 'Display name' });
    nameLabel.style.marginTop = '14px';
    sec.append(nameLabel);
    const input = textInput({ class: 'settings-input', value: this.draft.name });
    input.addEventListener('input', () => {
      this.draft.name = input.value;
      refreshPreview();
    });
    // Save when you leave the field (and tidy the display to the capitalized form).
    input.addEventListener('blur', () => {
      void this.saveName().then(() => {
        input.value = this.draft.name;
        refreshPreview();
      });
    });
    sec.append(input);

    const p = this.draft.prefs;
    const save = (): void => void this.savePrefs();

    // --- Preferences ---
    sec.append(el('div', { class: 'settings-group-label', text: '⚙️ Preferences' }));
    sec.append(
      this.prefRow(
        'Time format',
        'How due times, sync, and Focus show the clock.',
        this.prefSeg([['12h', '12-hour'], ['24h', '24-hour']], () => p.timeFormat, (v) => {
          p.timeFormat = v;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Open WorkSpace to',
        'Which tab greets you when the app loads.',
        this.prefSeg(
          [['dashboard', 'Dashboard'], ['tasks', 'Tasks'], ['bookmarks', 'Bookmarks'], ['focus', 'Focus']],
          () => p.openTo,
          (v) => {
            p.openTo = v;
            save();
          }
        )
      )
    );

    // --- Dashboard toggles + a live preview that mirrors the real greeting/quote ---
    sec.append(el('div', { class: 'settings-group-label', text: '📊 Dashboard' }));
    sec.append(
      this.prefRow(
        'Personalized greeting',
        'Use your name in the rotating greeting.',
        this.prefSwitch(p.dash.greetName, (on) => {
          p.dash.greetName = on;
          refreshPreview();
          save();
        })
      )
    );
    const quoteChildren: HTMLElement[] = [];
    sec.append(
      this.prefRow(
        'Daily quote',
        'Show a rotating quote beneath your greeting.',
        this.prefSwitch(p.dash.quote, (on) => {
          p.dash.quote = on;
          quoteChildren.forEach((c) => (c.style.display = on ? '' : 'none'));
          refreshPreview();
          save();
        })
      )
    );
    const styleSel = el('select', { class: 'settings-input spv-select' }) as HTMLSelectElement;
    const STYLES: [AppPrefs['dash']['quoteStyle'], string][] = [
      ['stoic', '🏛️ Stoic'],
      ['modern', '💡 Modern'],
      ['literary', '📖 Literary'],
      ['science', '🔬 Science & discovery'],
      ['mixed', '🎲 Mixed'],
    ];
    for (const [v, label] of STYLES) styleSel.append(el('option', { value: v, text: label }));
    styleSel.value = p.dash.quoteStyle;
    styleSel.addEventListener('change', () => {
      p.dash.quoteStyle = styleSel.value as AppPrefs['dash']['quoteStyle'];
      refreshPreview();
      save();
    });
    const styleRow = this.prefRow('Quote style', 'Which kind of quote rotates each day.', styleSel);
    quoteChildren.push(styleRow);
    sec.append(styleRow);

    // Preview card — greeting + quote exactly as the Dashboard will render them.
    const preview = el('div', { class: 'spv' });
    preview.append(el('div', { class: 'spv-tag', text: 'What it looks like' }));
    // The REAL dashboard greeting class — identical font/gradient by construction.
    const pvGreet = el('div', { class: 'dash-greeting' });
    const pvQuoteWrap = el('div', { class: 'spv-quote-wrap' });
    const pvQuote = el('div', { class: 'spv-quote' });
    const pvAuthor = el('div', { class: 'spv-author' });
    pvQuoteWrap.append(pvQuote, pvAuthor);
    preview.append(pvGreet, pvQuoteWrap);
    quoteChildren.push(pvQuoteWrap);
    sec.append(preview);

    const SAMPLE_QUOTES: Record<AppPrefs['dash']['quoteStyle'], [string, string]> = {
      stoic: ['Begin. To begin is half the work.', 'Marcus Aurelius'],
      modern: ['The way to get started is to quit talking and begin doing.', 'Walt Disney'],
      literary: ['It is our choices that show what we truly are.', 'J.K. Rowling'],
      science: ['Somewhere, something incredible is waiting to be known.', 'Carl Sagan'],
      mixed: ['Well done is better than well said.', 'Benjamin Franklin'],
    };
    const refreshPreview = (): void => {
      const first = (this.draft.name || 'there').trim().split(/\s+/)[0];
      pvGreet.textContent = p.dash.greetName ? `Let's lock in, ${first}` : "Let's lock in";
      const q = SAMPLE_QUOTES[p.dash.quoteStyle];
      pvQuote.textContent = `“${q[0]}”`;
      pvAuthor.textContent = `— ${q[1]}`;
    };
    quoteChildren.forEach((c) => (c.style.display = p.dash.quote ? '' : 'none'));
    refreshPreview();

    sec.append(
      this.prefRow(
        "Today's Tasks",
        "Show the list of what's due today.",
        this.prefSwitch(p.dash.tasksCard, (on) => {
          p.dash.tasksCard = on;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Schedule',
        "Show this week's Schoology schedule card.",
        this.prefSwitch(p.dash.scheduleCard, (on) => {
          p.dash.scheduleCard = on;
          save();
        })
      )
    );

    // --- Account ---
    sec.append(el('div', { class: 'settings-group-label', text: '🔑 Account' }));
    const outBtn = el('button', { class: 'sdanger', text: 'Sign out' });
    outBtn.addEventListener('click', () =>
      this.confirmDanger('Sign out of WorkSpace on this device?', () => void signOut())
    );
    sec.append(this.prefRow('Sign out', 'End your session on this device.', outBtn));

    return sec;
  }

  private sectionSchoology(): HTMLElement {
    const sec = el('section', { class: 'settings-section', id: 'sec-school' });
    sec.append(this.labelWithHelp('Calendar (iCal) link', 'ical'));
    const input = textInput({
      class: 'settings-input',
      placeholder: 'webcal://… or https://…/ical.ics',
      value: this.draft.icalUrl,
    });
    this.icalInput = input;
    const icalErr = el('div', { class: 'settings-field-error' });
    this.icalErr = icalErr;

    // The one gated field. The button's label reflects whether the typed link
    // differs from what's saved: an unsaved change reads "Save & sync"; otherwise
    // it just re-runs the import ("Sync now").
    const btn = el('button', { class: 'settings-save settings-ical-btn', text: 'Sync now' }) as HTMLButtonElement;
    const syncBtnLabel = () => {
      const saved = (this.schoologyMeta?.icalUrl || '').trim();
      const typed = this.draft.icalUrl.trim().replace(/^webcal:\/\//i, 'https://');
      const changed = typed !== saved;
      btn.textContent = changed ? (typed ? 'Save & sync' : 'Remove link') : 'Sync now';
      btn.classList.toggle('changed', changed);
      btn.disabled = !typed && !saved; // nothing to do with an empty field and no saved link
    };
    this.syncIcalBtn = syncBtnLabel;
    btn.addEventListener('click', () => this.applyIcal());

    input.addEventListener('input', () => {
      this.draft.icalUrl = input.value;
      this.setIcalError(false); // typing clears the invalid-link warning
      syncBtnLabel();
    });

    const actions = el('div', { class: 'settings-ical-actions' });
    actions.append(btn);

    const status = el('div', { class: 'settings-status' });
    this.statusEl = status;
    // The button runs the import. This caption shows the last-synced time, then
    // progress/result the moment "Save & sync" (or "Sync now") is pressed.
    this.setSyncStatus(
      this.schoologyMeta?.lastSyncAt
        ? `Last synced ${formatSyncTime(this.schoologyMeta.lastSyncAt)} · ${this.schoologyMeta.lastSyncCount ?? 0} assignments`
        : 'Not synced yet.'
    );

    syncBtnLabel(); // initial state
    sec.append(input, icalErr, actions, status);

    const p = this.draft.prefs;
    const save = (): void => void this.savePrefs();

    // --- Syncing ---
    sec.append(el('div', { class: 'settings-group-label', text: '🔄 Syncing' }));
    const intervalSeg = this.prefSeg(
      [[15, '15m'], [30, '30m'], [60, '60m']],
      () => p.sync.intervalMins,
      (v) => {
        p.sync.intervalMins = v;
        save();
      }
    );
    const autoRow = el('div', { class: 'srow' });
    const autoMain = el('div', { class: 'srow-main' });
    autoMain.append(
      el('div', { class: 'srow-title', text: 'Auto-sync' }),
      el('div', { class: 'srow-sub', text: 'Refresh your assignments in the background while the app is open.' })
    );
    const autoCtrl = el('div', { class: 'srow-ctrl' });
    intervalSeg.style.display = p.sync.auto ? '' : 'none'; // child: shown only while auto-sync is on
    autoCtrl.append(
      intervalSeg,
      this.prefSwitch(p.sync.auto, (on) => {
        p.sync.auto = on;
        intervalSeg.style.display = on ? '' : 'none';
        save();
      })
    );
    autoRow.append(autoMain, autoCtrl);
    sec.append(autoRow);
    sec.append(
      this.prefRow(
        'Sync when I open WorkSpace',
        'Always start with the latest.',
        this.prefSwitch(p.sync.onOpen, (on) => {
          p.sync.onOpen = on;
          save();
        })
      )
    );

    // --- Import ---
    sec.append(el('div', { class: 'settings-group-label', text: '📥 Import' }));
    sec.append(
      this.prefRow('Assignments', 'Regular Schoology assignments.', this.prefSwitch(p.importPrefs.assignments, (on) => {
        p.importPrefs.assignments = on;
        save();
      }))
    );
    sec.append(
      this.prefRow('Tests & exams', 'Calendar events that look like tests, exams, midterms, or finals.', this.prefSwitch(p.importPrefs.assessments, (on) => {
        p.importPrefs.assessments = on;
        save();
      }))
    );
    sec.append(
      this.prefRow('Quizzes', 'Calendar events that look like quizzes.', this.prefSwitch(p.importPrefs.quizzes, (on) => {
        p.importPrefs.quizzes = on;
        save();
      }))
    );
    sec.append(
      this.prefRow(
        'Import window',
        'How far ahead to pull.',
        this.prefSeg([[14, '14d'], [30, '30d'], [60, '60d']], () => p.importPrefs.windowDays, (v) => {
          p.importPrefs.windowDays = v;
          save();
        })
      )
    );

    // --- Editing (the intrinsic-field lock; see tasks/render.ts editingUnlocked) ---
    sec.append(el('div', { class: 'settings-group-label', text: '✏️ Editing' }));
    sec.append(
      this.prefRow(
        'Edit task details',
        'Allow changing a task’s title, course, and due date (double-click them). Off keeps them exactly as posted; priority, folders, and attachments stay editable either way.',
        this.prefSwitch(p.tasks.allowEdit, (on) => {
          p.tasks.allowEdit = on;
          save();
        })
      )
    );

    // --- Calendar (the Tasks tab's calendar mode) ---
    sec.append(el('div', { class: 'settings-group-label', text: '🗓️ Calendar' }));
    sec.append(
      this.prefRow(
        'Default screen',
        'Which layout the Tasks tab opens in.',
        this.prefSeg([['list', 'List'], ['calendar', 'Calendar']], () => p.calendar.defaultScreen, (v) => {
          p.calendar.defaultScreen = v;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Week starts on',
        'The first column of the month and week grids.',
        this.prefSeg([[0, 'Sunday'], [1, 'Monday']], () => p.calendar.weekStart, (v) => {
          p.calendar.weekStart = v;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Default calendar view',
        'The layout the calendar opens in.',
        this.prefSeg([['month', 'Month'], ['week', 'Week']], () => p.calendar.defaultView, (v) => {
          p.calendar.defaultView = v;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Density',
        'How many chips a month cell shows before "+N more".',
        this.prefSeg([['comfortable', 'Comfortable'], ['compact', 'Compact']], () => p.calendar.density, (v) => {
          p.calendar.density = v;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Show completed tasks',
        'Keep checked-off chips on the calendar (crossed out).',
        this.prefSwitch(p.calendar.showCompleted, (on) => {
          p.calendar.showCompleted = on;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Jump to earliest task',
        'Opening the calendar lands on the first month with an active task.',
        this.prefSwitch(p.calendar.jumpToEarliest, (on) => {
          p.calendar.jumpToEarliest = on;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Color chips by',
        'What the color strip on each chip encodes.',
        this.prefSeg([['priority', 'Priority'], ['course', 'Course']], () => p.calendar.colorBy, (v) => {
          p.calendar.colorBy = v;
          save();
        })
      )
    );

    // --- Danger ---
    sec.append(el('div', { class: 'settings-group-label', text: '⚠️ Danger' }));
    const removeBtn = el('button', { class: 'sdanger', text: 'Remove all' }) as HTMLButtonElement;
    removeBtn.addEventListener('click', () =>
      this.confirmDanger(
        'Remove every task imported from Schoology? Manual tasks stay, and removed items won’t re-import on future syncs.',
        () => void this.removeAllImported(removeBtn)
      )
    );
    sec.append(
      this.prefRow('Remove all imported', 'Clears everything pulled from Schoology. Manual tasks stay.', removeBtn)
    );

    return sec;
  }

  /** Delete every Schoology-imported task. The seen-ledger is left intact, so the
   *  removed items don't resurrect on the next sync. */
  private async removeAllImported(btn: HTMLButtonElement): Promise<void> {
    btn.disabled = true;
    btn.textContent = 'Removing…';
    try {
      const all = await this.data.getTasksAll();
      const imported = Object.values(all).filter((t) => t.source === 'schoology-ical');
      for (const t of imported) await this.data.removeTask(t.id);
      btn.textContent = `Removed ${imported.length}`;
    } catch {
      btn.textContent = 'Failed, try again';
    } finally {
      btn.disabled = false;
      window.setTimeout(() => (btn.textContent = 'Remove all'), 2500);
    }
  }

  /** Update the sync caption under the link field (last-synced / progress / error). */
  private setSyncStatus(text: string, isError = false): void {
    if (!this.statusEl) return;
    this.statusEl.textContent = text;
    this.statusEl.classList.toggle('settings-status-error', isError);
  }

  /** Toggle the inline "invalid iCal link" warning on the link field. */
  private setIcalError(on: boolean): void {
    if (this.icalErr) this.icalErr.textContent = on ? 'Invalid iCal link.' : '';
    this.icalInput?.classList.toggle('invalid', on);
  }

  private sectionCourses(): HTMLElement {
    const sec = el('section', { class: 'settings-section', id: 'sec-courses' });
    const host = el('div', { class: 'settings-courses' });
    const draw = () => {
      host.replaceChildren();
      for (const c of this.draft.courses) host.append(this.courseRow(c, draw));
    };
    draw();
    const add = el('button', { class: 'settings-add', text: '+ Add course' });
    add.addEventListener('click', () => {
      const id = 'course_' + genId();
      this.draft.courses.push({ id, name: 'New course', color: NEW_COURSE_COLOR, parseWords: [] });
      this.newCourseIds.add(id); // flag it so its row shows parse-word recommendations
      void this.saveCourses();
      draw();
      // Select the placeholder name so the user types their course straight over it
      // (which is also what drives the live recommendations).
      const nameInput = host.querySelector<HTMLInputElement>('.course-row:last-child .course-name');
      nameInput?.focus();
      nameInput?.select();
    });
    sec.append(host, add);
    return sec;
  }

  /** Focus end-of-session sound picker. A Volume slider sets how loud cues play;
   *  the ▶ button previews (and toggles to ⏸ while playing); click a row to select.
   *  Both the choice and the volume save the moment they change. */
  private sectionSound(): HTMLElement {
    const sec = el('section', { class: 'settings-section', id: 'sec-sound' });
    sec.append(el('div', { class: 'settings-group-label', text: '🔊 End Sound' }));

    // Parent switch: the sound picker + volume below exist only while this is on.
    const soundChildren = el('div');
    sec.append(
      this.prefRow(
        'End Sound',
        'Play a cue when a session finishes.',
        this.prefSwitch(this.draft.endSoundEnabled, (on) => {
          this.draft.endSoundEnabled = on;
          soundChildren.style.display = on ? '' : 'none';
          if (!on) this.stopPreview();
          void this.saveSound();
        })
      )
    );

    // Volume — applies to every cue (preview and the real end-of-session sound).
    const volRow = el('div', { class: 'sound-volume' });
    const slider = el('input', {
      type: 'range',
      min: '0',
      max: '100',
      step: '1',
      value: String(Math.round(this.draft.endVolume * 100)),
      class: 'sound-volume-slider',
    }) as HTMLInputElement;
    const volPct = el('span', { class: 'sound-volume-pct', text: `${Math.round(this.draft.endVolume * 100)}%` });
    slider.addEventListener('input', () => {
      this.draft.endVolume = Number(slider.value) / 100;
      volPct.textContent = `${slider.value}%`;
      this.preview?.setVolume(this.draft.endVolume); // live-adjust a sound that's playing
    });
    // Persist once the drag ends (change fires on release), not on every tick.
    slider.addEventListener('change', () => void this.saveSound());
    volRow.append(el('span', { class: 'sound-volume-label', text: 'Volume' }), slider, volPct);

    const list = el('div', { class: 'sound-list' });
    const draw = () => {
      list.replaceChildren();
      for (const s of END_SOUNDS) {
        const row = el('div', { class: `sound-row${this.draft.endSound === s.key ? ' selected' : ''}` });

        const pick = el('button', { class: 'sound-pick' });
        pick.append(
          el('span', { class: 'sound-emoji', text: s.emoji }),
          el('span', { class: 'sound-name', text: s.label }),
          el('span', { class: 'sound-desc', text: s.desc })
        );
        if (this.draft.endSound === s.key) pick.append(el('span', { class: 'sound-check', text: '✓' }));
        pick.addEventListener('click', () => {
          this.stopPreview(); // redraw below detaches buttons; don't leave one mid-play
          this.draft.endSound = s.key;
          void this.saveSound();
          draw();
        });

        const preview = el('button', { class: 'sound-preview', title: `Preview ${s.label}` });
        preview.innerHTML = PLAY_SVG;
        preview.addEventListener('click', (e) => {
          e.stopPropagation();
          const wasThis = this.preview?.btn === preview;
          this.stopPreview(); // only one preview plays at a time
          if (wasThis) return; // a second click on the playing one just stops it
          armAudioContext(); // this click is the user gesture that unlocks audio
          const handle = playEndSound(s.key, this.draft.endVolume);
          preview.innerHTML = PAUSE_SVG;
          // Auto-revert to ▶ when the cue finishes on its own.
          const timer = window.setTimeout(() => this.stopPreview(), handle.durationMs + 150);
          this.preview = { btn: preview, stop: handle.stop, setVolume: handle.setVolume, timer };
        });

        row.append(pick, preview);
        list.append(row);
      }
    };
    draw();
    soundChildren.append(list, volRow);
    soundChildren.style.display = this.draft.endSoundEnabled ? '' : 'none';
    sec.append(soundChildren);

    const p = this.draft.prefs;
    const save = (): void => void this.savePrefs();

    // --- Session ---
    sec.append(el('div', { class: 'settings-group-label', text: '⏱️ Session' }));
    sec.append(
      this.prefRow(
        'Show seconds',
        'Count seconds in the ring, carousel, and presets.',
        this.prefSwitch(p.focus.showSeconds, (on) => {
          p.focus.showSeconds = on;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Keep screen awake',
        'Stop the display from sleeping during a session (Screen Wake Lock).',
        this.prefSwitch(p.focus.keepAwake, (on) => {
          p.focus.keepAwake = on;
          save();
        })
      )
    );

    // --- Music ---
    sec.append(el('div', { class: 'settings-group-label', text: '🎵 Music' }));
    sec.append(
      this.prefRow(
        'Auto-start music with session',
        'Your chosen focus music begins the moment the timer starts.',
        this.prefSwitch(p.focus.autoStartMusic, (on) => {
          p.focus.autoStartMusic = on;
          save();
        })
      )
    );

    // Roadmap note (artifact parity): the music section grows once playlists land.
    // --- Custom playlists ---
    const plHost = el('div', { class: 'settings-playlists' });
    sec.append(plHost);
    void this.drawPlaylists(plHost);

    // Tucked at the very bottom, deliberately understated: a faint link to the full
    // music-credits page (the CC-BY tracks need attribution, but it shouldn't shout).
    const creditsLink = el('button', { class: 'settings-credits-link', text: 'Music credits & licenses' });
    creditsLink.addEventListener('click', () => this.openCreditsPage());
    sec.append(creditsLink);

    return sec;
  }

  /** Render the user's custom playlists (name · count · Edit · delete) + a
   *  "New playlist" button. Reads live from the focus data. */
  private async drawPlaylists(host: HTMLElement): Promise<void> {
    const focus = await this.data.getFocusAll<Record<string, unknown>>();
    const playlists = loadPlaylists(focus);
    host.replaceChildren();
    for (const pl of playlists) {
      const row = el('div', { class: 'settings-playlist-row' });
      const emoji = el('div', { class: 'settings-playlist-emoji', text: playlistEmoji(pl) });
      const main = el('div', { class: 'settings-playlist-main' });
      main.append(
        el('div', { class: 'settings-playlist-name', text: pl.name }),
        el('div', { class: 'settings-playlist-count', text: `${pl.trackIds.length} song${pl.trackIds.length === 1 ? '' : 's'}` })
      );
      const edit = el('button', { class: 'settings-playlist-btn', text: 'Edit' });
      edit.addEventListener('click', () => this.openPlaylistEditor(pl, host));
      const del = el('button', { class: 'settings-playlist-btn danger', text: '✕', title: 'Delete' });
      del.addEventListener('click', () =>
        this.confirmDanger(`Delete the "${pl.name}" playlist?`, () => void this.data.removeFocus(playlistKey(pl.id)).then(() => this.drawPlaylists(host)))
      );
      row.append(emoji, main, edit, del);
      host.append(row);
    }
    const addBtn = el('button', { class: 'settings-add', text: '+ New custom playlist' });
    addBtn.addEventListener('click', () => this.openPlaylistEditor(null, host));
    host.append(addBtn);
  }

  /** Create/edit a playlist: a name + a searchable list of all 99 library songs to
   *  include (tap to toggle). Saved through the Data layer as a 'playlist_*' record. */
  private openPlaylistEditor(existing: CustomPlaylist | null, host: HTMLElement): void {
    const chosen = new Set<string>(existing?.trackIds ?? []);
    const back = el('div', { class: 'editor-backdrop' });
    const box = el('div', { class: 'playlist-editor' });

    box.append(el('h3', { class: 'playlist-editor-title', text: existing ? 'Edit playlist' : 'New playlist' }));
    const nameRow = el('div', { class: 'playlist-editor-namerow' });
    const emojiWrap = el('div', { class: 'playlist-emoji-wrap' });
    // The emoji box is a pure SELECTOR (a button that opens the menu) — not
    // typable. The chosen emoji lives in this variable, not in any input.
    let chosenEmoji = existing?.emoji ?? '';
    const emojiBtn = el('button', { class: 'playlist-emoji-btn', title: 'Pick a playlist emoji (🎵 if none picked)' });
    const paintEmoji = (): void => {
      emojiBtn.textContent = chosenEmoji || '🎵';
      // The 🎵 shown with nothing picked is a "placeholder" — dim it like one.
      emojiBtn.classList.toggle('default', !chosenEmoji);
    };
    paintEmoji();

    const EMOJI_CHOICES = [
      '🎵', '🎶', '🎧', '🎹', '🎸', '🎻', '🎺', '🥁',
      '🌌', '🌙', '⭐', '☀️', '🌅', '🌊', '🌿', '❄️',
      '🔥', '⚡', '💫', '🌸', '☕', '🕯️', '🧠', '📚',
      '✏️', '💻', '🔬', '🎯', '🏃', '😌', '🎮', '❤️',
    ];
    const pick = (val: string) => {
      chosenEmoji = val;
      paintEmoji();
      closePicker();
    };
    const picker = el('div', { class: 'emoji-picker' });
    for (const em of EMOJI_CHOICES) {
      const opt = el('button', { class: 'emoji-picker-opt', text: em });
      opt.addEventListener('mousedown', (ev) => {
        ev.preventDefault();
        pick(em);
      });
      picker.append(opt);
    }
    const clearOpt = el('button', { class: 'emoji-picker-clear', text: 'None (use the 🎵 default)' });
    clearOpt.addEventListener('mousedown', (ev) => {
      ev.preventDefault();
      pick('');
    });
    picker.append(clearOpt);

    let pickerOpen = false;
    const onDocDown = (ev: MouseEvent) => {
      if (!emojiWrap.contains(ev.target as Node)) closePicker();
    };
    const openPicker = (): void => {
      if (pickerOpen) return;
      pickerOpen = true;
      emojiWrap.append(picker);
      document.addEventListener('mousedown', onDocDown);
    };
    const closePicker = (): void => {
      if (!pickerOpen) return;
      pickerOpen = false;
      picker.remove();
      document.removeEventListener('mousedown', onDocDown);
    };
    emojiBtn.addEventListener('click', () => (pickerOpen ? closePicker() : openPicker()));
    emojiBtn.addEventListener('keydown', (ev) => {
      if (ev.key === 'Escape') closePicker();
    });

    emojiWrap.append(emojiBtn);
    const nameIn = textInput({ class: 'settings-input', placeholder: 'Playlist name', value: existing?.name ?? '' });
    nameRow.append(emojiWrap, nameIn);
    box.append(nameRow);

    const search = textInput({ class: 'settings-input playlist-search', placeholder: 'Search songs or composers…' });
    box.append(search);
    const countCap = el('div', { class: 'playlist-editor-count' });
    box.append(countCap);

    const list = el('div', { class: 'playlist-editor-list' });
    box.append(list);
    const draw = (): void => {
      const q = search.value.trim().toLowerCase();
      list.replaceChildren();
      countCap.textContent = `${chosen.size} selected`;
      for (const t of LIBRARY_TRACKS) {
        if (q && !`${t.title} ${t.authors.join(' ')}`.toLowerCase().includes(q)) continue;
        const on = chosen.has(t.id);
        const row = el('button', { class: `playlist-song${on ? ' on' : ''}` });
        row.append(
          el('span', { class: 'playlist-song-check', text: on ? '✓' : '' }),
          el('span', { class: 'playlist-song-emoji', text: t.emoji }),
          el('span', { class: 'playlist-song-name', text: t.title }),
          el('span', { class: 'playlist-song-artist', text: t.authorsShort.join(', ') })
        );
        row.addEventListener('click', () => {
          if (chosen.has(t.id)) chosen.delete(t.id);
          else chosen.add(t.id);
          draw();
        });
        list.append(row);
      }
    };
    draw();
    search.addEventListener('input', draw);

    const actions = el('div', { class: 'confirm-actions' });
    const cancel = el('button', { class: 'confirm-cancel', text: 'Cancel' });
    cancel.addEventListener('click', () => back.remove());
    const save = el('button', { class: 'playlist-editor-save', text: 'Save' });
    save.addEventListener('click', () => {
      const name = nameIn.value.trim();
      if (!name || !chosen.size) return; // need a name + at least one song
      // Keep the existing order for retained tracks, then append newly-added ones.
      const kept = existing?.trackIds.filter((id) => chosen.has(id)) ?? [];
      const added = [...chosen].filter((id) => !kept.includes(id));
      // Only store emoji when one was picked (Firebase rejects undefined fields;
      // absent = the 🎵 default via playlistEmoji()).
      const emoji = chosenEmoji;
      const pl: CustomPlaylist = { id: existing?.id ?? 'pl_' + genId(), name, trackIds: [...kept, ...added], ...(emoji ? { emoji } : {}) };
      void this.data.putFocus(playlistKey(pl.id), pl).then(() => {
        back.remove();
        void this.drawPlaylists(host);
      });
    });
    actions.append(cancel, save);
    box.append(actions);

    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) back.remove();
    });
    enterConfirms(back, () => save); // Enter = Save (no-ops until name + a song exist)
    document.body.append(back);
  }

  /** Stop any in-progress sound preview and reset its button to the play icon. */
  private stopPreview(): void {
    if (!this.preview) return;
    this.preview.stop();
    clearTimeout(this.preview.timer);
    this.preview.btn.innerHTML = PLAY_SVG;
    this.preview = undefined;
  }

  /** Assignment reminders — master switch, appearance chips, and the Due-soon +
   *  Daily-agenda types. Each type expands when on to reveal its options, a live
   *  preview of the REAL notification, and a Test button. Everything saves the
   *  moment it changes; enabling reminders doubles as the permission-prompt gesture. */
  private sectionNotify(): HTMLElement {
    const sec = el('section', { class: 'settings-section', id: 'sec-notify' });
    const n = this.draft.notify;
    const save = (): void => void this.saveNotify();

    // Browser-permission caption.
    const perm = el('div', { class: 'settings-status notify-perm' });
    const refreshPerm = (): void => {
      const p = notificationPermission();
      perm.classList.toggle('settings-status-error', p === 'denied');
      perm.textContent =
        p === 'granted'
          ? 'Allowed by your browser ✓'
          : p === 'denied'
            ? 'Blocked by your browser. Allow notifications for this site, then reload.'
            : p === 'unsupported'
              ? 'This browser doesn’t support notifications.'
              : 'Your browser will ask permission when you turn reminders on.';
    };
    refreshPerm();

    // Each notification (and the master) picks its channels with a 2-button grid:
    // [🔔 Popup] [✉ Gmail]. A button is gold when its channel is on. Returns
    // { el, sync } — sync() re-reads the pressed state via `get`, so refreshAll()
    // keeps every grid in step after any change (including master↔child linking).
    const BELL = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M18 8a6 6 0 0 0-12 0c0 7-3 9-3 9h18s-3-2-3-9"/><path d="M13.7 21a2 2 0 0 1-3.4 0"/></svg>';
    const ENVELOPE = '<svg width="15" height="15" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>';
    const channelGrid = (get: () => Channels, onToggle: (key: keyof Channels) => void): { el: HTMLElement; sync: () => void } => {
      const grid = el('div', { class: 'nchan' });
      const btns: [keyof Channels, HTMLButtonElement][] = [];
      const mk = (key: keyof Channels, icon: string, label: string): void => {
        const b = el('button', { class: 'nchan-btn' }) as HTMLButtonElement;
        b.innerHTML = `<span class="nchan-ico">${icon}</span>${label}`;
        b.addEventListener('click', () => onToggle(key));
        btns.push([key, b]);
        grid.append(b);
      };
      mk('popup', BELL, 'Popup');
      mk('gmail', ENVELOPE, 'Gmail');
      const sync = (): void => {
        const ch = get();
        btns.forEach(([k, b]) => b.setAttribute('aria-pressed', String(ch[k])));
      };
      sync();
      return { el: grid, sync };
    };

    // --- master ↔ child LINKING ("All reminders" overrides everything) -----------
    // The master is a linked select-all: clicking a master channel sets that channel
    // on EVERY notification; it shows gold only while ALL of them have it on, so
    // turning any single one off un-lights the master. Firing logic reads only the
    // children — the master is pure control + indicator.
    const CHILD_CHANNELS: Channels[] = [
      n.dueSoon.channels,
      n.dailyAgenda.channels,
      n.tomorrow.channels,
      n.newAssignment.channels,
      n.focusSession.channels,
    ];
    const syncMasterFromChildren = (): void => {
      n.master.popup = CHILD_CHANNELS.every((c) => c.popup);
      n.master.gmail = CHILD_CHANNELS.every((c) => c.gmail);
    };
    syncMasterFromChildren(); // normalize also derives this, but never trust a drifted draft
    // One toggle handler per child card; the master gets its own bulk handler below.
    const childToggle = (ch: Channels) => (key: keyof Channels): void => {
      ch[key] = !ch[key];
      if (key === 'popup' && ch.popup) void ensureNotificationPermission().then(refreshPerm);
      syncMasterFromChildren();
      refreshAll();
      save();
    };

    // --- master ("All reminders") — one press flips that channel EVERYWHERE ---
    const masterGrid = channelGrid(
      () => n.master,
      (key) => {
        const next = !n.master[key];
        n.master[key] = next;
        for (const c of CHILD_CHANNELS) c[key] = next;
        if (key === 'popup' && next) void ensureNotificationPermission().then(refreshPerm);
        refreshAll();
        save();
      }
    );
    const master = el('div', { class: 'nmaster' });
    const masterText = el('div', { class: 'nmaster-text' });
    masterText.append(
      el('div', { class: 'nmaster-title', text: 'All reminders' }),
      el('div', { class: 'nmaster-desc', text: 'One press turns that channel on or off for every notification below.' })
    );
    master.append(masterText, masterGrid.el);
    // Where the Gmail channel goes — READ-ONLY, always the signed-in account email.
    // Deliberately no input: an editable address would let notifications be aimed at
    // someone else's inbox.
    const gmailNote = el('div', { class: 'ngmail-note' });
    gmailNote.innerHTML = `✉ Gmail notifications go to <b>${escapeHtml(this.opts.email || 'your account email')}</b>, your sign-in email.`;

    // --- appearance checklist ---
    const appear = el('div', { class: 'nappear' });
    appear.append(el('div', { class: 'nappear-title', text: 'What each notification shows' }));
    const checklist = el('div', { class: 'nchecklist' });
    const checkDefs: [keyof NotifyAppearance, string][] = [
      ['course', 'Course'],
      ['priority', 'Priority'],
      ['dueTime', 'Due time'],
    ];
    for (const [key, label] of checkDefs) {
      const row = el('button', { class: 'ncheck' }) as HTMLButtonElement;
      row.setAttribute('role', 'checkbox');
      row.setAttribute('aria-checked', String(n.appearance[key]));
      row.append(el('span', { class: 'ncheck-box', text: '✓' }), el('span', { class: 'ncheck-label', text: label }));
      row.addEventListener('click', () => {
        n.appearance[key] = !n.appearance[key];
        row.setAttribute('aria-checked', String(n.appearance[key]));
        refreshPreviews();
        save();
      });
      checklist.append(row);
    }
    appear.append(checklist);

    // --- shared preview + test builders ---
    const previewRefreshers: (() => void)[] = [];
    const refreshPreviews = (): void => previewRefreshers.forEach((f) => f());

    const buildToast = (): { el: HTMLElement; set: (t: string, m: string) => void; get: () => { title: string; body: string } } => {
      const frame = el('div', { class: 'nprev' });
      frame.append(el('div', { class: 'nprev-tag', text: 'What the popup looks like' }));
      const stage = el('div', { class: 'nprev-stage' });
      const toast = el('div', { class: 'ntoast' });
      const icon = el('div', { class: 'ntoast-icon' });
      icon.innerHTML = WS_ICON_SVG;
      const body = el('div', { class: 'ntoast-body' });
      const title = el('div', { class: 'ntoast-title' });
      const msg = el('div', { class: 'ntoast-msg' });
      body.append(title, msg, el('div', { class: 'ntoast-src', text: 'workspace.app' }));
      toast.append(icon, body);
      stage.append(toast);
      frame.append(stage);
      return {
        el: frame,
        set: (t, m) => {
          title.textContent = t;
          msg.textContent = m;
        },
        get: () => ({ title: title.textContent || '', body: msg.textContent || '' }),
      };
    };

    const buildTest = (
      getContent: () => { title: string; body: string },
      channel: 'popup' | 'gmail' = 'popup'
    ): HTMLElement => {
      const isEmail = channel === 'gmail';
      const label = isEmail ? 'Test out email' : 'Test out notification';
      const btn = el('button', { class: 'notify-test ntest', text: label }) as HTMLButtonElement;
      let timer = 0;
      btn.addEventListener('click', async () => {
        const c = getContent();
        if (isEmail) {
          // Send a REAL email through the Trigger Email pipeline: queueEmail writes a
          // doc to the `mail` collection and the extension delivers it, to the signed-in
          // account's email. No notification permission needed — that's popup-only.
          setEmailAddress(this.opts.email || '');
          sendNotification(c.title, c.body, { gmail: true });
        } else {
          const ok = await ensureNotificationPermission();
          refreshPerm();
          if (!ok) return;
          sendNotification(c.title, c.body, { popup: true });
        }
        btn.textContent = 'Sent ✓';
        btn.classList.add('sent');
        clearTimeout(timer);
        timer = window.setTimeout(() => {
          btn.textContent = label;
          btn.classList.remove('sent');
        }, 2200);
      });
      return btn;
    };

    // Gmail-style preview of the email a notification sends — light card (like a real
    // inbox), gold W avatar, subject = the notification title, body = its message.
    // Shown on a card whenever its ✉ Gmail channel is on.
    const buildMail = (): { el: HTMLElement; set: (t: string, m: string) => void; setTo: (a: string) => void } => {
      const frame = el('div', { class: 'nprev' });
      frame.append(el('div', { class: 'nprev-tag', text: 'What the email looks like' }));
      const card = el('div', { class: 'nmail' });
      const top = el('div', { class: 'nmail-top' });
      const av = el('div', { class: 'nmail-av' });
      av.innerHTML = WS_ICON_SVG; // the computer logo — the app's real avatar, not a letter
      const meta = el('div', { class: 'nmail-meta' });
      const fromRow = el('div', { class: 'nmail-fromrow' });
      fromRow.append(el('span', { class: 'nmail-from', text: 'WorkSpace' }), el('span', { class: 'nmail-time', text: 'now' }));
      const toLine = el('div', { class: 'nmail-to', text: 'to me' });
      meta.append(fromRow, toLine);
      top.append(av, meta);
      const subj = el('div', { class: 'nmail-subj' });
      const body = el('div', { class: 'nmail-body' });
      const foot = el('div', { class: 'nmail-foot', text: 'Sent by WorkSpace · manage in Settings ▸ Notifications' });
      card.append(top, subj, body, foot);
      frame.append(card);
      return {
        el: frame,
        set: (t, m) => {
          subj.textContent = t;
          body.textContent = m;
        },
        setTo: (a) => {
          toLine.textContent = `to ${a || 'you'}`;
        },
      };
    };

    // --- Due-soon card ---
    const LEADS: [number, string][] = [
      [30, '30m'], [60, '1h'], [120, '2h'], [180, '3h'], [360, '6h'],
      [720, '12h'], [1440, '24h'], [2880, '48h'], [4320, '72h'],
    ];
    const dueCard = el('div', { class: 'ncard' });
    const dueChan = channelGrid(() => n.dueSoon.channels, childToggle(n.dueSoon.channels));
    dueCard.append(this.notifyBar('clock', 'Due-soon reminders', 'A heads-up before a task that has a due time.', dueChan.el));
    const dueDetail = el('div', { class: 'ncard-detail' });
    const dueInner = el('div', { class: 'ncard-detail-inner' });
    dueInner.append(el('div', { class: 'nopt-label', text: 'Remind me before it’s due · pick any' }));
    const leadGrid = el('div', { class: 'nlead-grid' });
    const dueCap = el('div', { class: 'nwheel-cap' });
    const dueToast = buildToast();
    const dueMail = buildMail();
    const refreshDue = (): void => {
      const leads = [...n.dueSoon.leads].sort((a, b) => a - b);
      const soonest = leads[0] ?? 60;
      const now = Date.now();
      const body = reminderBody(
        { course: 'Science', priority: 'High', nowMs: now, dueMs: now + soonest * 60_000, leadMins: soonest },
        n.appearance
      );
      dueToast.set('Due soon: Science lab writeup', body);
      dueMail.set('Due soon: Science lab writeup', body);
      const names = [...n.dueSoon.leads].sort((a, b) => b - a).map((m) => leadLabel(m));
      dueCap.innerHTML = names.length ? `A reminder fires <b>${joinList(names)}</b> before it’s due.` : '';
    };
    const drawLeads = (): void => {
      leadGrid.replaceChildren();
      for (const [mins, label] of LEADS) {
        const b = el('button', { class: 'nlead', text: label }) as HTMLButtonElement;
        b.setAttribute('aria-pressed', String(n.dueSoon.leads.includes(mins)));
        b.addEventListener('click', () => {
          if (n.dueSoon.leads.includes(mins)) {
            if (n.dueSoon.leads.length === 1) return; // minimum one — due-soon needs a duration
            n.dueSoon.leads = n.dueSoon.leads.filter((x) => x !== mins);
          } else {
            n.dueSoon.leads = [...n.dueSoon.leads, mins];
          }
          drawLeads();
          refreshDue();
          save();
        });
        leadGrid.append(b);
      }
    };
    drawLeads();
    const dueTest = buildTest(() => dueToast.get());
    const dueEmailTest = buildTest(() => dueToast.get(), 'gmail');
    dueInner.append(leadGrid, dueCap, dueToast.el, dueTest, dueMail.el, dueEmailTest);
    dueDetail.append(dueInner);
    dueCard.append(dueDetail);
    previewRefreshers.push(refreshDue);

    // --- Daily-agenda card ---
    const agCard = el('div', { class: 'ncard' });
    const agChan = channelGrid(() => n.dailyAgenda.channels, childToggle(n.dailyAgenda.channels));
    agCard.append(this.notifyBar('sun', 'Daily agenda', 'A morning rundown of everything due today.', agChan.el));
    const agDetail = el('div', { class: 'ncard-detail' });
    const agInner = el('div', { class: 'ncard-detail-inner' });
    agInner.append(el('div', { class: 'nopt-label', text: 'Send each morning at' }));
    const hourVals = ['5', '6', '7', '8', '9', '10', '11'];
    const minVals = Array.from({ length: 12 }, (_, i) => String(i * 5).padStart(2, '0'));
    const wheels = el('div', { class: 'nwheels' });
    const hourWheel = this.buildWheel(hourVals, Math.max(0, hourVals.indexOf(String(n.dailyAgenda.hour))), (i) => {
      n.dailyAgenda.hour = Number(hourVals[i]);
      refreshAg();
      save();
    });
    const minWheel = this.buildWheel(minVals, Math.max(0, minVals.indexOf(String(n.dailyAgenda.minute).padStart(2, '0'))), (i) => {
      n.dailyAgenda.minute = Number(minVals[i]);
      refreshAg();
      save();
    });
    wheels.append(hourWheel, el('div', { class: 'nwheel-colon', text: ':' }), minWheel, el('div', { class: 'nwheel-fixed', text: 'AM' }));
    const agCap = el('div', { class: 'nwheel-cap' });
    const agToast = buildToast();
    const agMail = buildMail();
    const refreshAg = (): void => {
      agToast.set(`Good morning, ${this.draft.name || 'there'}`, '3 tasks due today');
      agMail.set(`Good morning, ${this.draft.name || 'there'}`, '3 tasks due today');
      agCap.innerHTML = `Sends at <b>${n.dailyAgenda.hour}:${String(n.dailyAgenda.minute).padStart(2, '0')} AM</b>`;
    };
    const agTest = buildTest(() => agToast.get());
    const agEmailTest = buildTest(() => agToast.get(), 'gmail');
    agInner.append(wheels, agCap, agToast.el, agTest, agMail.el, agEmailTest);
    agDetail.append(agInner);
    agCard.append(agDetail);
    previewRefreshers.push(refreshAg);

    // --- Tomorrow-preview card (evening digest of tomorrow's tasks) ---
    const tmCard = el('div', { class: 'ncard' });
    const tmChan = channelGrid(() => n.tomorrow.channels, childToggle(n.tomorrow.channels));
    tmCard.append(this.notifyBar('moon', 'Tomorrow preview', 'An evening look at what’s due tomorrow.', tmChan.el));
    const tmDetail = el('div', { class: 'ncard-detail' });
    const tmInner = el('div', { class: 'ncard-detail-inner' });
    tmInner.append(el('div', { class: 'nopt-label', text: 'Send each evening at' }));
    const tmWheels = el('div', { class: 'nwheels' });
    const tmHourWheel = this.buildWheel(hourVals, Math.max(0, hourVals.indexOf(String(n.tomorrow.hour))), (i) => {
      n.tomorrow.hour = Number(hourVals[i]);
      refreshTm();
      save();
    });
    const tmMinWheel = this.buildWheel(minVals, Math.max(0, minVals.indexOf(String(n.tomorrow.minute).padStart(2, '0'))), (i) => {
      n.tomorrow.minute = Number(minVals[i]);
      refreshTm();
      save();
    });
    tmWheels.append(tmHourWheel, el('div', { class: 'nwheel-colon', text: ':' }), tmMinWheel, el('div', { class: 'nwheel-fixed', text: 'PM' }));
    const tmCap = el('div', { class: 'nwheel-cap' });
    const tmToast = buildToast();
    const tmMail = buildMail();
    const refreshTm = (): void => {
      const d = new Date();
      d.setDate(d.getDate() + 1);
      const wd = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'][d.getDay()];
      tmToast.set('Heads-up for tomorrow', `2 tasks due tomorrow (${wd})`);
      tmMail.set('Heads-up for tomorrow', `2 tasks due tomorrow (${wd})`);
      tmCap.innerHTML = `Sends at <b>${n.tomorrow.hour}:${String(n.tomorrow.minute).padStart(2, '0')} PM</b>`;
    };
    const tmTest = buildTest(() => tmToast.get());
    const tmEmailTest = buildTest(() => tmToast.get(), 'gmail');
    tmInner.append(tmWheels, tmCap, tmToast.el, tmTest, tmMail.el, tmEmailTest);
    tmDetail.append(tmInner);
    tmCard.append(tmDetail);
    previewRefreshers.push(refreshTm);

    // --- New-assignment card (as-they-arrive vs batched) ---
    const INTERVALS: [number, string][] = [[30, '30m'], [60, '1h'], [120, '2h'], [180, '3h'], [360, '6h'], [720, '12h']];
    const sampleDue = (() => {
      const d = new Date();
      d.setDate(d.getDate() + 3);
      d.setHours(15, 0, 0, 0);
      return d.getTime();
    })();
    const naCard = el('div', { class: 'ncard' });
    const naChan = channelGrid(() => n.newAssignment.channels, childToggle(n.newAssignment.channels));
    naCard.append(this.notifyBar('inbox', 'New assignments', 'When WorkSpace imports new work from Schoology.', naChan.el));
    const naDetail = el('div', { class: 'ncard-detail' });
    const naInner = el('div', { class: 'ncard-detail-inner' });
    naInner.append(el('div', { class: 'nopt-label', text: 'How new assignments arrive' }));
    const seg = el('div', { class: 'nseg' });
    const segArrive = el('button', { class: 'nseg-btn', text: 'As they arrive' }) as HTMLButtonElement;
    const segBatch = el('button', { class: 'nseg-btn', text: 'Batched' }) as HTMLButtonElement;
    seg.append(segArrive, segBatch);
    const naIntervalWrap = el('div', { class: 'na-interval' });
    naIntervalWrap.append(el('div', { class: 'nopt-label', text: 'Check for new work every' }));
    const naGrid = el('div', { class: 'nlead-grid' });
    const naCap = el('div', { class: 'nwheel-cap' });
    const naToast = buildToast();
    const naMail = buildMail();
    const refreshNa = (): void => {
      const batched = n.newAssignment.mode === 'batched';
      segArrive.classList.toggle('active', !batched);
      segBatch.classList.toggle('active', batched);
      naIntervalWrap.style.display = batched ? '' : 'none';
      if (batched) {
        naToast.set('3 new assignments', `Imported in the last ${intervalLabel(n.newAssignment.intervalMins)}.`);
        naMail.set('3 new assignments', `Imported in the last ${intervalLabel(n.newAssignment.intervalMins)}.`);
      } else {
        const body = taskInfoBody({ course: 'History', priority: 'Normal', dueMs: sampleDue }, n.appearance);
        naToast.set('New assignment: Essay outline', body);
        naMail.set('New assignment: Essay outline', body);
      }
      naCap.innerHTML = `Checks for new work every <b>${intervalLabel(n.newAssignment.intervalMins)}</b>.`;
    };
    const drawNaGrid = (): void => {
      naGrid.replaceChildren();
      for (const [mins, label] of INTERVALS) {
        const b = el('button', { class: 'nlead', text: label }) as HTMLButtonElement;
        b.setAttribute('aria-pressed', String(n.newAssignment.intervalMins === mins));
        b.addEventListener('click', () => {
          n.newAssignment.intervalMins = mins;
          drawNaGrid();
          refreshNa();
          save();
        });
        naGrid.append(b);
      }
    };
    drawNaGrid();
    naIntervalWrap.append(naGrid, naCap);
    segArrive.addEventListener('click', () => {
      n.newAssignment.mode = 'each';
      refreshNa();
      save();
    });
    segBatch.addEventListener('click', () => {
      n.newAssignment.mode = 'batched';
      refreshNa();
      save();
    });
    const naTest = buildTest(() => naToast.get());
    const naEmailTest = buildTest(() => naToast.get(), 'gmail');
    naInner.append(seg, naIntervalWrap, naToast.el, naTest, naMail.el, naEmailTest);
    naDetail.append(naInner);
    naCard.append(naDetail);
    previewRefreshers.push(refreshNa);

    // --- Focus-session card (a "session complete!" cheer when a focus timer ends) ---
    // Unlike the others this notification is fired from the Focus tab, not the
    // scheduler — but it's surfaced here so it's controllable in the same place.
    const fsCard = el('div', { class: 'ncard' });
    const fsChan = channelGrid(() => n.focusSession.channels, childToggle(n.focusSession.channels));
    fsCard.append(this.notifyBar('target', 'Focus sessions', 'A “session complete!” cheer when a focus timer finishes.', fsChan.el));
    const fsDetail = el('div', { class: 'ncard-detail' });
    const fsInner = el('div', { class: 'ncard-detail-inner' });
    const fsToast = buildToast();
    const fsMail = buildMail();
    const refreshFs = (): void => {
      fsToast.set('⏰ Focus session complete!', '25 min focused • 3/4 tasks done');
      fsMail.set('⏰ Focus session complete!', '25 min focused • 3/4 tasks done');
    };
    const fsCap = el('div', { class: 'nwheel-cap', text: 'Fires when your focus timer reaches zero. No setup. It just cheers you on.' });
    const fsTest = buildTest(() => fsToast.get());
    const fsEmailTest = buildTest(() => fsToast.get(), 'gmail');
    fsInner.append(fsCap, fsToast.el, fsTest, fsMail.el, fsEmailTest);
    fsDetail.append(fsInner);
    fsCard.append(fsDetail);
    previewRefreshers.push(refreshFs);

    // --- "Troubleshoot" button (top) — opens the animated fix-it guides ---
    const howToBtn = el('button', { class: 'notify-howto', text: 'Notification not showing? Open the fix-it guides →' }) as HTMLButtonElement;
    howToBtn.addEventListener('click', () => this.openNotifyGuides());

    // --- Tasks / Focus: plain subheaders (like the other tabs) over each stack of
    //     channel-grid cards. No group toggle — the master + per-card grids are the
    //     only controls. ---
    const tasksTypes = el('div', { class: 'ntypes' });
    tasksTypes.append(dueCard, agCard, tmCard, naCard);
    const focusTypes = el('div', { class: 'ntypes' });
    focusTypes.append(fsCard);

    const groups = el('div', { class: 'ngroups' });
    groups.append(
      el('div', { class: 'settings-group-label', text: '📚 Tasks' }),
      tasksTypes,
      el('div', { class: 'settings-group-label', text: '🎯 Focus' }),
      focusTypes
    );

    // A card expands when it has ANY channel on. Inside, the popup preview (+ its test
    // button) shows only while Popup is on, and the email preview only while Gmail is
    // on — both when both.
    const cardOn = (ch: Channels): boolean => ch.popup || ch.gmail;
    const addr = (): string => this.opts.email || 'you'; // always the account email
    const vis = (
      card: HTMLElement,
      ch: Channels,
      toast: { el: HTMLElement },
      test: HTMLElement,
      mail: { el: HTMLElement; setTo: (a: string) => void },
      emailTest: HTMLElement
    ): void => {
      card.classList.toggle('open', cardOn(ch));
      toast.el.style.display = ch.popup ? '' : 'none';
      test.style.display = ch.popup ? '' : 'none';
      mail.el.style.display = ch.gmail ? '' : 'none';
      emailTest.style.display = ch.gmail ? '' : 'none';
      mail.setTo(addr());
    };
    const refreshAll = (): void => {
      masterGrid.sync();
      dueChan.sync();
      agChan.sync();
      tmChan.sync();
      naChan.sync();
      fsChan.sync();
      vis(dueCard, n.dueSoon.channels, dueToast, dueTest, dueMail, dueEmailTest);
      vis(agCard, n.dailyAgenda.channels, agToast, agTest, agMail, agEmailTest);
      vis(tmCard, n.tomorrow.channels, tmToast, tmTest, tmMail, tmEmailTest);
      vis(naCard, n.newAssignment.channels, naToast, naTest, naMail, naEmailTest);
      vis(fsCard, n.focusSession.channels, fsToast, fsTest, fsMail, fsEmailTest);
      refreshPreviews();
    };

    sec.append(howToBtn, perm, master, gmailNote, appear, groups);
    refreshAll();
    return sec;
  }

  /** Notification troubleshooting guides — an overlay listing every cause that can
   *  block notifications, ordered most-likely-first. Each opens a slideshow where
   *  every step is an ANIMATED mockup (cursor glides, click ripples, the setting
   *  flips) with a caption — a looping mini-video of exactly what to do. Data +
   *  scenes live in settings/notifyGuides.ts. Esc/backdrop/✕ close; ←/→ page. */
  private openNotifyGuides(): void {
    const overlay = el('div', { class: 'ngd' });
    const card = el('div', { class: 'ngd-card' });
    let gi = -1; // -1 = the index list; otherwise the open guide
    let si = 0; // step within the open guide

    const close = (): void => {
      overlay.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
      else if (gi >= 0 && e.key === 'ArrowRight') go(1);
      else if (gi >= 0 && e.key === 'ArrowLeft') go(-1);
    };
    document.addEventListener('keydown', onKey);
    const go = (delta: number): void => {
      const g = NOTIFY_GUIDES[gi];
      if (!g) return;
      si = Math.max(0, Math.min(g.steps.length - 1, si + delta));
      render();
    };

    const render = (): void => {
      card.replaceChildren();
      const closeBtn = el('button', { class: 'ngd-close', text: '✕', 'aria-label': 'Close' });
      closeBtn.addEventListener('click', close);
      card.append(closeBtn);

      if (gi < 0) {
        // ---- index: every cause, most likely first ----
        card.append(
          el('div', { class: 'ngd-title', text: 'Notification not showing?' }),
          el('div', { class: 'ngd-sub', text: 'Work down this list. It’s ordered by how often each cause is the culprit. Every guide plays the fix step by step.' })
        );
        const list = el('div', { class: 'ngd-list' });
        NOTIFY_GUIDES.forEach((g, i) => {
          const item = el('button', { class: 'ngd-item' }) as HTMLButtonElement;
          item.style.setProperty('--gda', g.color); // likelihood heat color (red → purple)
          const num = el('div', { class: 'ngd-num', text: String(i + 1) });
          const main = el('div', { class: 'ngd-item-main' });
          main.append(el('div', { class: 'ngd-item-title', text: `${g.emoji} ${g.title}` }), el('div', { class: 'ngd-item-blurb', text: g.blurb }));
          const tag = el('div', { class: 'ngd-tag', text: g.tag });
          item.append(num, main, tag, el('div', { class: 'ngd-chev', text: '›' }));
          item.addEventListener('click', () => {
            gi = i;
            si = 0;
            render();
          });
          list.append(item);
        });
        card.append(list);
        return;
      }

      // ---- player: one guide, one animated step at a time ----
      const g = NOTIFY_GUIDES[gi];
      card.style.setProperty('--gda', g.color); // guide accent colors the tag + dots
      const head = el('div', { class: 'ngd-head' });
      const back = el('button', { class: 'ngd-back', text: '‹ All causes' });
      back.addEventListener('click', () => {
        gi = -1;
        render();
      });
      head.append(back, el('div', { class: 'ngd-head-title', text: `${g.emoji} ${g.title}` }), el('div', { class: 'ngd-tag', text: g.tag }));
      const stage = el('div', { class: 'ngd-stage' });
      stage.innerHTML = g.steps[si].svg; // trusted static scenes from notifyGuides.ts
      const caption = el('div', { class: 'ngd-caption', text: g.steps[si].caption });
      const dots = el('div', { class: 'ngd-dots' });
      g.steps.forEach((_, k) => dots.append(el('span', { class: `ngd-dot${k === si ? ' on' : ''}` })));
      const nav = el('div', { class: 'ngd-nav' });
      const prev = el('button', { class: 'ngd-btn', text: 'Back' }) as HTMLButtonElement;
      prev.style.visibility = si === 0 ? 'hidden' : 'visible';
      prev.addEventListener('click', () => go(-1));
      const next = el('button', { class: 'ngd-btn ngd-next', text: si === g.steps.length - 1 ? 'Done, next cause' : 'Next' }) as HTMLButtonElement;
      next.addEventListener('click', () => {
        if (si < g.steps.length - 1) go(1);
        else {
          gi = -1; // finished — back to the list so the next cause is one tap away
          render();
        }
      });
      nav.append(prev, next);
      card.append(head, stage, caption, dots, nav);
    };

    overlay.append(card);
    // Deliberately NO backdrop-click close: hopping between tabs/apps causes stray
    // clicks on the page, and those must never dismiss the guide mid-read. Only the
    // ✕ (or Escape) closes it.
    render();
    document.body.append(overlay);
  }

  /** Full-screen music-credits page, opened from the faint link at the bottom of the
   *  Focus tab. Every focus track is CC0 / CC-BY / public-domain; the CC-BY ones
   *  REQUIRE attribution, so we list every track with its composer and a link to its
   *  exact license — built straight from LIBRARY_TRACKS so it always matches the
   *  shipped library. Closes on the back button, the backdrop, or Escape. */
  private openCreditsPage(): void {
    const page = el('div', { class: 'credits-page' });
    const close = (): void => {
      page.remove();
      document.removeEventListener('keydown', onKey);
    };
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') close();
    };
    document.addEventListener('keydown', onKey);

    const bar = el('div', { class: 'credits-page-bar' });
    const back = el('button', { class: 'credits-page-back', title: 'Back' });
    back.innerHTML =
      '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M15 18l-6-6 6-6"/></svg>';
    back.addEventListener('click', close);
    bar.append(back, el('div', { class: 'credits-page-title', text: 'Music credits' }));

    const body = el('div', { class: 'credits-page-body' });
    body.append(this.buildCreditsBody());

    page.append(bar, body);
    page.addEventListener('click', (e) => {
      if (e.target === page) close();
    });
    document.body.append(page);
  }

  /** The credits list itself (intro + tally + per-genre track rows). */
  private buildCreditsBody(): HTMLElement {
    const sec = el('section', { class: 'settings-credits' });

    const byLicense = new Map<string, number>();
    for (const t of LIBRARY_TRACKS) byLicense.set(t.license, (byLicense.get(t.license) ?? 0) + 1);
    const licenseSummary = [...byLicense.entries()].sort().map(([l, n]) => `${n} ${l}`).join(' · ');

    sec.append(
      el('p', {
        class: 'settings-credits-intro',
        text:
          `The focus-music library is ${LIBRARY_TRACKS.length} tracks. Every musical work is in the public ` +
          `domain; each recording is used under a Creative Commons or public-domain license. Where a license ` +
          `requires attribution (CC-BY), the composer and license are credited below.`,
      }),
      el('p', { class: 'settings-credits-tally', text: licenseSummary })
    );

    for (const g of MUSIC_GENRES) {
      const tracks = LIBRARY_TRACKS.filter((t) => t.genreId === g.id);
      if (!tracks.length) continue;
      const group = el('div', { class: 'settings-credits-group' });
      group.append(el('div', { class: 'settings-credits-genre', text: `${g.emoji} ${g.label} · ${tracks.length}` }));
      for (const t of tracks) {
        const row = el('div', { class: 'settings-credits-row' });
        const main = el('div', { class: 'settings-credits-main' });
        main.append(
          el('span', { class: 'settings-credits-title', text: t.title }),
          el('span', { class: 'settings-credits-composer', text: t.authors.join(', ') })
        );
        const lic = t.licenseUrl
          ? el('a', { class: 'settings-credits-lic', href: t.licenseUrl, target: '_blank', rel: 'noopener noreferrer', text: t.license })
          : el('span', { class: 'settings-credits-lic', text: t.license });
        row.append(main, lic);
        group.append(row);
      }
      sec.append(group);
    }
    return sec;
  }

  /** One notification-type header row: icon + title/description + its on/off switch. */
  private notifyBar(icon: keyof typeof NICONS, title: string, desc: string, sw: HTMLElement): HTMLElement {
    const bar = el('div', { class: 'ncard-bar' });
    const ico = el('div', { class: 'ncard-ico' });
    ico.innerHTML = NICONS[icon];
    const main = el('div', { class: 'ncard-main' });
    main.append(el('div', { class: 'ncard-title', text: title }), el('div', { class: 'ncard-desc', text: desc }));
    bar.append(ico, main, sw);
    return bar;
  }

  /** A scroll-snap wheel column (like the Focus carousels): drag it or tap a rung
   *  above/below the center to roll that value into place. Calls onChange(index). */
  private buildWheel(values: string[], sel: number, onChange: (i: number) => void): HTMLElement {
    const ROW = 34;
    const w = el('div', { class: 'nwheel' });
    w.append(el('div', { class: 'nwheel-spacer' }));
    const items = values.map((v) => {
      const it = el('div', { class: 'nwheel-item', text: v });
      w.append(it);
      return it;
    });
    w.append(el('div', { class: 'nwheel-spacer' }));
    const mark = (): void => {
      const i = Math.round(w.scrollTop / ROW);
      items.forEach((it, j) => it.classList.toggle('sel', j === i));
    };
    let t = 0;
    let last = sel; // so the initial programmatic settle (and no-op re-snaps) don't fire a save
    w.addEventListener('scroll', () => {
      mark();
      clearTimeout(t);
      t = window.setTimeout(() => {
        const i = Math.max(0, Math.min(values.length - 1, Math.round(w.scrollTop / ROW)));
        mark();
        if (i === last) return;
        last = i;
        onChange(i);
      }, 90);
    });
    items.forEach((it, i) => it.addEventListener('click', () => w.scrollTo({ top: i * ROW, behavior: 'smooth' })));
    requestAnimationFrame(() => {
      w.scrollTop = sel * ROW;
      mark();
    });
    return w;
  }

  private courseRow(c: CourseConfig, redraw: () => void): HTMLElement {
    const row = el('div', { class: 'course-row' });

    const color = el('input', { type: 'color', class: 'course-color', value: toHex(c.color) }) as HTMLInputElement;
    color.addEventListener('input', () => {
      c.color = color.value; // live preview while dragging in the picker
    });
    color.addEventListener('change', () => void this.saveCourses()); // persist when the picker closes

    const name = textInput({ class: 'course-name', value: c.name });
    name.addEventListener('input', () => {
      c.name = name.value;
      drawRecs(); // suggestions follow the name as it's typed
    });
    name.addEventListener('blur', () => void this.saveCourses());

    const del = el('button', { class: 'course-del', title: 'Remove', text: '✕' });
    del.addEventListener('click', () => {
      this.draft.courses = this.draft.courses.filter((x) => x.id !== c.id);
      void this.saveCourses();
      redraw();
    });

    const top = el('div', { class: 'course-row-top' });
    top.append(color, name, del);

    const chips = el('div', { class: 'parse-chips' });
    for (const w of c.parseWords) {
      const chip = el('span', { class: 'parse-chip', text: w });
      const x = el('button', { class: 'parse-chip-x', text: '×' });
      x.addEventListener('click', () => {
        c.parseWords = c.parseWords.filter((p) => p !== w);
        void this.saveCourses();
        redraw();
      });
      chip.append(x);
      chips.append(chip);
    }

    // Recommended parse words (acronyms/abbreviations from the name) — shown only
    // for newly added courses, as distinct "+ word" suggestions to accept.
    const recsHost = el('div', { class: 'parse-recs' });
    const drawRecs = () => {
      recsHost.replaceChildren();
      if (!this.newCourseIds.has(c.id)) return;
      const named = c.name.trim();
      if (!named || named.toLowerCase() === 'new course') return; // wait for a real name
      const used = new Set(this.draft.courses.flatMap((x) => x.parseWords));
      const recs = recommendParseWords(named, used);
      if (!recs.length) return;
      for (const w of recs) {
        const rec = el('button', { class: 'parse-rec', title: `Add “${w}”` });
        rec.append(el('span', { class: 'parse-rec-plus', text: '+' }), el('span', { text: w }));
        rec.addEventListener('click', () => {
          if (!c.parseWords.includes(w)) c.parseWords.push(w);
          this.refocusParseId = c.id; // land the cursor in the input for the next word
          void this.saveCourses();
          redraw();
        });
        recsHost.append(rec);
      }
    };
    drawRecs();

    const err = el('div', { class: 'parse-error' });
    const wordInput = textInput({ class: 'parse-add', placeholder: '+ parse word' });
    wordInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      const w = wordInput.value.trim().toLowerCase();
      if (!w) return;
      const conflict = this.draft.courses.find((x) => x.id !== c.id && x.parseWords.includes(w));
      if (conflict) {
        err.textContent = `Already used in "${conflict.name}".`;
        return;
      }
      if (!c.parseWords.includes(w)) c.parseWords.push(w);
      this.refocusParseId = c.id; // keep the cursor here for the next word
      void this.saveCourses();
      redraw();
    });

    // One chip row (artifact style): saved words, then gold "+ word" suggestions,
    // then the "+ parse word" input — all flowing inline.
    chips.append(recsHost, wordInput);
    // After adding a word the whole list re-renders, wiping focus. If THIS course
    // is the one just edited, drop the cursor back into its "+ parse word" input so
    // several words can be typed in a row (Enter, type, Enter, type…) with no clicks.
    if (this.refocusParseId === c.id) {
      this.refocusParseId = null;
      requestAnimationFrame(() => wordInput.focus());
    }
    row.append(top, chips, err);
    return row;
  }
  // #endregion

  // #region Help popups — field label + "?" icon + the explanation modal
  // --- help ---------------------------------------------------------------

  private labelWithHelp(text: string, topic: string): HTMLElement {
    const wrap = el('div', { class: 'settings-label' });
    wrap.append(el('span', { text }), this.helpIcon(topic));
    return wrap;
  }

  private helpIcon(topic: string): HTMLElement {
    const btn = el('button', { class: 'help-icon', text: '?', title: 'What’s this?' });
    btn.addEventListener('click', (e) => {
      e.preventDefault();
      this.showHelp(topic);
    });
    return btn;
  }

  private showHelp(topic: string): void {
    const h = HELP[topic];
    if (!h) return;
    const back = el('div', { class: 'help-backdrop' });
    const box = el('div', { class: 'help-box' });
    box.append(el('h3', { text: h.title }), el('p', { class: 'help-text', text: h.text }));
    const ok = el('button', { class: 'btn-primary', text: 'Got it' });
    ok.addEventListener('click', () => back.remove());
    box.append(ok);
    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) back.remove();
    });
    document.body.append(back);
  }
  // #endregion
}

// #region Module helpers — link validation, time formatting, color

/** "a", "a & b", "a, b & c" — human list join for the reminder caption. */
function joinList(items: string[]): string {
  if (items.length <= 1) return items[0] ?? '';
  return `${items.slice(0, -1).join(', ')} & ${items[items.length - 1]}`;
}

// The REAL WorkSpace app icon (navy square + gold monitor + dotted keyboard),
// copied from public/icons/icon.svg so the notification preview shows the true icon.
const WS_ICON_SVG =
  '<svg viewBox="0 0 120 120" xmlns="http://www.w3.org/2000/svg"><rect x="0" y="0" width="120" height="120" rx="26" fill="#0e1730"/><g transform="translate(60 60) scale(1.02) translate(-50 -49.75)" fill="#e6a817"><rect x="16" y="10" width="68" height="54" rx="12" fill="none" stroke="#e6a817" stroke-width="9"/><path d="M44 64 L56 64 L60 75 L40 75 Z"/><path fill-rule="evenodd" d="M23 75 L77 75 L87 94 L13 94 Z M23.99 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M32.2 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M40.4 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M48.6 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M56.8 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M65 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M73.21 79 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M21.89 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M29.52 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M37.15 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M44.78 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M52.42 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M60.05 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M67.68 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M75.31 83 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M19.78 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M26.99 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M34.19 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M41.4 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M48.6 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M55.8 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M63.01 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M70.21 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M77.42 87 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M17.68 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M24.55 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M31.42 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M38.29 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M45.16 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M52.04 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M58.91 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M65.78 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M72.65 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z M79.52 91 a1.4 1.4 0 1 0 2.8 0 a1.4 1.4 0 1 0 -2.8 0 Z"/></g></svg>';

// Small line-icons for the notification type rows.
const NICONS = {
  clock:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><path d="M12 7v5l3 2"/></svg>',
  sun: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="4"/><path d="M12 2v2M12 20v2M4.9 4.9l1.4 1.4M17.7 17.7l1.4 1.4M2 12h2M20 12h2M4.9 19.1l1.4-1.4M17.7 6.3l1.4-1.4"/></svg>',
  moon: '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/></svg>',
  inbox:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M22 12h-6l-2 3h-4l-2-3H2"/><path d="M5.5 5.5 2 12v6a2 2 0 0 0 2 2h16a2 2 0 0 0 2-2v-6l-3.5-6.5A2 2 0 0 0 16.8 4H7.2a2 2 0 0 0-1.7 1.5z"/></svg>',
  target:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><circle cx="12" cy="12" r="9"/><circle cx="12" cy="12" r="5"/><circle cx="12" cy="12" r="1.5"/></svg>',
  mail:
    '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><rect x="3" y="5" width="18" height="14" rx="2"/><path d="m3 7 9 6 9-6"/></svg>',
} as const;

/** A syntactic check that a string is a calendar feed URL (http/https/webcal
 *  scheme + a real domain). Catches non-links like "johnny". It does NOT fetch
 *  — a well-formed link that 404s is caught later by Sync. */
function isValidIcalUrl(raw: string): boolean {
  const s = raw.trim().replace(/^webcal:\/\//i, 'https://');
  try {
    const u = new URL(s);
    return (u.protocol === 'http:' || u.protocol === 'https:') && u.hostname.includes('.');
  } catch {
    return false;
  }
}

/** "M/D/YYYY h:mm am/pm" — exact date + time of the last sync. */
function formatSyncTime(iso: string): string {
  const d = new Date(iso);
  const date = `${d.getMonth() + 1}/${d.getDate()}/${d.getFullYear()}`;
  const min = String(d.getMinutes()).padStart(2, '0');
  if (getPrefs().timeFormat === '24h') {
    return `${date} ${String(d.getHours()).padStart(2, '0')}:${min}`;
  }
  const ampm = d.getHours() >= 12 ? 'pm' : 'am';
  const h = d.getHours() % 12 || 12;
  return `${date} ${h}:${min} ${ampm}`;
}

/** Coerce any CSS color string to a #rrggbb the <input type=color> accepts. */
function toHex(color: string): string {
  if (/^#[0-9a-f]{6}$/i.test(color)) return color;
  const ctx = document.createElement('canvas').getContext('2d');
  if (ctx) {
    ctx.fillStyle = '#9ca3af';
    ctx.fillStyle = color;
    if (/^#[0-9a-f]{6}$/i.test(ctx.fillStyle)) return ctx.fillStyle;
  }
  return '#9ca3af';
}

/**
 * Up to 3 sensible parse-word suggestions for a course name — an acronym plus
 * abbreviations / significant words — skipping any already in use. Examples:
 *   "English Language Arts" → ela, english, language
 *   "Mathematics"           → mathematics, math, mat
 *   "Social Studies"        → ss, social, studies
 */
function recommendParseWords(name: string, exclude: Set<string>): string[] {
  const STOP = new Set(['of', 'the', 'and', 'a', 'an', 'for', 'to', 'in', 'on', '&']);
  const words = name
    .toLowerCase()
    .split(/\s+/)
    .map((w) => w.replace(/[^a-z0-9]/g, ''))
    .filter((w) => w && !STOP.has(w));
  if (!words.length) return [];

  const candidates: string[] = [];
  if (words.length >= 2) {
    candidates.push(words.map((w) => w[0]).join('')); // acronym, e.g. "ela"
    for (const w of words) if (w.length >= 3) candidates.push(w); // each significant word
  } else {
    const w = words[0];
    candidates.push(w); // the word itself
    if (w.length > 4) candidates.push(w.slice(0, 4)); // 4-letter abbreviation
    if (w.length > 3) candidates.push(w.slice(0, 3)); // 3-letter abbreviation
  }

  // The course NAME is already an implicit parse word (the parser matches an exact
  // course name outright), so never recommend it — that'd be redundant/obvious.
  const nameKey = name.toLowerCase().replace(/[^a-z0-9]/g, '');

  const seen = new Set<string>();
  const out: string[] = [];
  for (const w of candidates) {
    if (w.length < 2 || w === nameKey || seen.has(w) || exclude.has(w)) continue;
    seen.add(w);
    out.push(w);
    if (out.length === 3) break;
  }
  return out;
}
// #endregion
