// Cobalt Settings: one scrolling page (Name · Schoology · Courses).
//
// Every field saves itself the moment you change it — there's no Save button.
// The one exception is the Schoology calendar link: because changing it re-imports
// your assignments, it stays behind an explicit "Save & sync" action with a
// confirmation, so a stray keystroke can't wipe your feed. Each field has a "?"
// that explains what it does (the seed of the larger in-app briefing system).

// #region Imports & types — dependencies, the draft model, the options object
import type { Data } from '../db';
import type { CourseConfig, SchoologySettings } from '../types';
import { el, textInput, escapeHtml, enterConfirms, fadeRemove } from '../util/dom';
import { attachColorPicker } from '../ui/colorPicker';
import { openAtTop } from '../ui/tabs';
import { confirmDanger } from '../ui/confirm';
import { genId } from '../util/ids';
import type { SettingsSection } from '../util/router';
import { capitalizeName } from '../util/names';
import { getCourses, replaceCourses } from '../courses/registry';
import { recommendedSet } from '../courses/recommend';
import { nextCourseColor } from '../courses/colors';
import { runSync } from '../schoology/sync';
import { isSchoologyIcalUrl } from '../schoology/ical';
import {
  signOut,
  needsEmailVerification,
  resendEmailVerification,
  hasPasswordProvider,
  sendPasswordReset,
  sendSetPasswordEmail,
} from '../auth';
import { getPrefs, setPrefsCache, PREFS_EVENT, type AppPrefs } from '../prefs';
import { buildLanguagePicker } from './languagePicker';
import { END_SOUNDS, DEFAULT_END_SOUND, DEFAULT_END_VOLUME, playEndSound, FOCUS_SOUND_EVENT } from '../focus/sounds';
import { armAudioContext } from '../focus/timer';
import { LIBRARY_TRACKS, MUSIC_GENRES } from '../focus/library';
import { loadPlaylists, playlistEmoji, playlistKey, type CustomPlaylist } from '../focus/playlists';
import { focusSessionLive } from '../focus/persist';
import { NOTIFY_GUIDES_MAC, NOTIFY_GUIDES_WINDOWS } from './notifyGuides';
import { cobaltIconSvg, chromeIconSvg } from '../ui/appIcon';
import { detectOS } from '../util/os';
import {
  type NotifySettings,
  type NotifyAppearance,
  type BurstMode,
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
  /** The address bar, when there is one to keep in step: `section` reads the slug
   *  the current path is asking for, `onSection` reports the one now on screen.
   *  Supplied by the real app only — the landing demo runs this same class inside
   *  its device frame and must leave the browser's URL alone. */
  route?: {
    section: () => SettingsSection | null;
    /** `replace` distinguishes the section this page OPENED on (which is a detail
     *  of the /settings entry already in the history, so it rewrites it) from one
     *  the student CLICKED (a place of its own, so it gets its own entry and Back
     *  walks between sections). Without the split, opening Settings left two
     *  entries — /settings and /settings/profile — and Back bounced off the first
     *  straight into the second. */
    onSection: (slug: SettingsSection, replace: boolean) => void;
  };
  /** Popup host override (the landing demo passes its device-frame body so
   *  overlays like the color card mount INSIDE the frame). Real app: omit. */
  host?: () => HTMLElement | null | undefined;
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
    text: 'The login this Cobalt belongs to. It’s set by how you signed in (Google, later) and can’t be changed here. Your data is tied to it.',
  },
  name: {
    title: 'Your name',
    text: 'What Cobalt calls you, in your greeting and across the app. It’s always capitalized, and you can change it anytime.',
  },
  ical: {
    title: 'Schoology calendar link',
    text: 'Your personal Schoology calendar (iCal) link. Cobalt uses it to import your assignments automatically. Find it in Schoology under Settings → your calendar feed, then paste it here.\n\nIt’s read-only and has no password in it. Cobalt never sees your Schoology login, and you can reset the link in Schoology anytime.',
  },
  course: {
    title: 'Course name',
    text: 'A class you take. Cobalt labels and color-codes its assignments with this name so your work is easy to scan.',
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

    // NO PER-TAB PAGE HEAD (Gabe, 8/26). Each tab used to open with its own title
    // and a one-line purpose ("Profile / Your account and how Cobalt behaves for
    // you."). Both were already on screen: the side nav names the tab and shows it
    // highlighted, so the title was the same word twice, and the description was a
    // sentence nobody re-reads after the first visit. Between them they pushed ~60px
    // of dead space above every tab, which is exactly where the first REAL setting
    // now sits, level with the "Settings" title in the sidebar.

    const content = el('div', { class: 'settings-content' });
    for (const [, sec] of tabs) content.append(sec);

    // Vertical side navigation: the "Settings" title on top, one tab per section.
    const side = el('aside', { class: 'settings-side' });
    side.append(el('h2', { class: 'settings-side-title', text: 'Settings' }));
    const navButtons: HTMLButtonElement[] = [];
    // The side tabs ARE the second level of the app's path (/settings/courses), so
    // each one needs a slug. Lowercasing the label is the whole rule; SLUGS keeps
    // the two orders locked together, since both are indexed by position.
    const SLUGS = tabs.map(([label]) => label.toLowerCase() as SettingsSection);
    const show = (idx: number, opening = false) => {
      tabs.forEach(([, sec], i) => (sec.hidden = i !== idx));
      navButtons.forEach((b, i) => b.classList.toggle('active', i === idx));
      this.opts.route?.onSection(SLUGS[idx], opening);
      // .settings-content is not the scroller — the shell's .app-below is — so
      // this line alone never moved anything, and the sections read as
      // scroll-linked (Gabe, 8/21). openAtTop walks up to the real one.
      content.scrollTop = 0;
      openAtTop(content);
    };
    // PREMIUM group (Gabe, 8/13): paid-tier tabs sit at the bottom of the
    // sidebar under their own "Premium" subheader in a separated block. The
    // block is NEUTRAL: a full violet theme was tried and pulled the same day;
    // the one violet mark is the ACTIVE state on these buttons (settings.css),
    // violet where every other tab goes blue. Hover is the standard white.
    // Today that's Notifications; future premium tabs just join this set.
    const PREMIUM_TABS = new Set(['Notifications']);
    const premWrap = el('div', { class: 'settings-side-prem' });
    premWrap.append(el('div', { class: 'settings-side-subhead', text: 'Premium' }));
    tabs.forEach(([label], i) => {
      const b = el('button', { class: 'settings-side-btn' }) as HTMLButtonElement;
      if (PREMIUM_TABS.has(label)) b.classList.add('premium');
      b.innerHTML = NAV_ICONS[label] ?? '';
      b.append(el('span', { text: label }));
      b.addEventListener('click', () => show(i));
      navButtons.push(b);
      (PREMIUM_TABS.has(label) ? premWrap : side).append(b);
    });
    side.append(premWrap);

    const shell = el('div', { class: 'settings-shell' });
    shell.append(side, content);
    page.append(shell);
    panel.replaceChildren(page); // swap in the finished page in one shot (no blank flash)
    // Open the section the path names, Profile otherwise. This also covers Back and
    // Forward between two settings sections: the tab re-mounts on every visit, so
    // reading the path here is the only place that has to know about them.
    const asked = this.opts.route?.section() ?? null;
    const at = asked ? SLUGS.indexOf(asked) : -1;
    show(at >= 0 ? at : 0, true);
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
    const next = {
      key: this.draft.endSound,
      volume: this.draft.endVolume,
      enabled: this.draft.endSoundEnabled,
    };
    // Announce BEFORE the write, like savePrefs does: a running session should go
    // quiet the instant the switch flips, not after a database round-trip.
    window.dispatchEvent(new CustomEvent(FOCUS_SOUND_EVENT, { detail: next }));
    await this.data.setProfile('focusEndSound', next);
  }

  /** App prefs — update the live cache first (so views repaint synchronously on
   *  the event), then persist. */
  private async savePrefs(): Promise<void> {
    setPrefsCache(structuredClone(this.draft.prefs));
    window.dispatchEvent(new CustomEvent(PREFS_EVENT, { detail: this.draft.prefs }));
    await this.data.setProfile('prefs', this.draft.prefs);
  }

  /**
   * Settings ▸ Tasks ▸ Languages: chips for what's on, a search box to add more.
   *
   * Chips rather than a list of switches because the ON set is short (four by
   * default) and the OFF set is the entire catalog. A switch per language would be
   * thirty-five rows to express four choices.
   */
  /** The 🌐 language picker. The control itself moved to settings/languagePicker.ts
   *  when onboarding started showing the same one; this is the Settings binding of
   *  it. Nothing about the markup or behaviour changed in the move. */
  private languagePicker(): HTMLElement {
    const p = this.draft.prefs;
    return buildLanguagePicker({
      get: () => p.tasks.translateFrom,
      set: (codes) => {
        p.tasks.translateFrom = codes;
        void this.savePrefs();
      },
    });
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

  /**
   * Mark a row (or a block of them) as belonging to the row above it: indented
   * behind a rail, and folded away when the parent is off (Gabe, 8/22).
   *
   * Returns the wrapper to append and the setter the parent's switch calls.
   * Disabling as well as hiding is belt and braces — `hidden` already takes the
   * controls out of the tab order — but it makes the state true rather than merely
   * invisible, which matters to anything that walks the form.
   */
  private childBlock(...rows: HTMLElement[]): { wrap: HTMLElement; show: (on: boolean) => void } {
    const wrap = el('div', { class: 'srow-child' });
    wrap.append(...rows);
    const show = (on: boolean): void => {
      wrap.hidden = !on;
      wrap.querySelectorAll('button, input, select, textarea').forEach((c) => {
        (c as HTMLButtonElement).disabled = !on;
      });
    };
    return { wrap, show };
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
    // ONE ROW OF EQUAL COLUMNS, ALWAYS. auto-fit was tried on 8/15 and reverted: it
    // reflowed each control at whatever width its own option count happened to hit,
    // so a two-option row went vertical while a four-option row beside it stayed
    // horizontal. Reflowing is now the ROW's job, at one shared breakpoint (see
    // settings.css), which is what makes every row look the same at every width.
    // minmax(0, 1fr), not 1fr: a plain 1fr track has an automatic MINIMUM of its
    // content, so at a narrow width the buttons refused to shrink and the control
    // spilled out of its card instead. The zero floor lets them give ground.
    seg.style.gridTemplateColumns = `repeat(${options.length}, minmax(0, 1fr))`;
    seg.style.maxWidth = `${options.length * 116}px`; // don't stretch on a wide row
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

    // Reject anything that is not a real Schoology calendar feed before anything
    // persists. A YouTube link is a valid URL, which is exactly why the old
    // syntax-only check was not enough. Empty = removing the link.
    if (next && !isSchoologyIcalUrl(next)) {
      this.setIcalError(true);
      return;
    }
    this.setIcalError(false);

    // Safeguard: changing or removing an EXISTING link needs a confirm.
    if (prev && next !== prev) {
      this.confirmDanger(
        next
          ? 'Change your Schoology link? This re-imports your assignments from the new feed.'
          : 'Remove your Schoology link? Cobalt will stop importing your assignments.',
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

  /** A red, can't-miss confirmation for destructive/sensitive changes. The dialog
   *  itself moved to ui/confirm.ts when the Task Archives needed the same one; this
   *  stays as the thin call-through so the many call sites below are untouched. */
  private confirmDanger(title: string, onYes: () => void): void {
    confirmDanger(title, onYes);
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
        'Open Cobalt to',
        'Which tab greets you when the app loads.',
        this.prefSeg(
          // Same order as the sidebar: Focus outranks Bookmarks (Gabe, 8/12).
          [['dashboard', 'Dashboard'], ['tasks', 'Tasks'], ['focus', 'Focus'], ['bookmarks', 'Bookmarks']],
          () => p.openTo,
          (v) => {
            p.openTo = v;
            save();
          }
        )
      )
    );
    sec.append(
      this.prefRow(
        'Open links in a new window',
        'Attachments and bookmarks open in their own window instead of a new tab.',
        this.prefSwitch(p.openLinksInNewWindow, (on) => {
          p.openLinksInNewWindow = on;
          save();
        })
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
    // SETTERS, not elements: the settings child folds away through childBlock's own
    // show() (which disables its controls as well as hiding them), while the preview's
    // quote line is a plain element that only needs hiding. One list, two behaviours.
    const quoteChildren: Array<(on: boolean) => void> = [];
    sec.append(
      this.prefRow(
        'Daily quote',
        'Show a rotating quote beneath your greeting.',
        this.prefSwitch(p.dash.quote, (on) => {
          p.dash.quote = on;
          quoteChildren.forEach((set) => set(on));
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
    // A CHILD of Daily quote: which kind of quote rotates is not a question worth
    // asking of someone who has turned quotes off.
    const quoteChild = this.childBlock(styleRow);
    quoteChildren.push(quoteChild.show);
    sec.append(quoteChild.wrap);

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
    quoteChildren.push((on) => { pvQuoteWrap.style.display = on ? '' : 'none'; });
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
    quoteChildren.forEach((set) => set(p.dash.quote));
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

    // PASSWORD — permanent home for what the top-of-app banner only offers in
    // passing (Gabe, 8/9). The banner appears exactly once, after the Google merge
    // deletes a password, and only until dismissed. This row is always here, and
    // it also serves the case the banner can never reach: a Google-only student
    // who simply WANTS a password and previously had no way to ask for one.
    //
    // The row adapts to what the account actually has, because the two cases need
    // different words for the same Firebase action (see authMailDoc's reset/set):
    //   has a password → "Change password"  (reset)
    //   has none       → "Set a password"   (set)
    const pwRow = el('div');
    sec.append(pwRow);
    void hasPasswordProvider().then((has) => {
      const btn = el('button', {
        class: 'settings-save',
        text: has ? 'Change password' : 'Set a password',
      }) as HTMLButtonElement;
      const idle = has
        ? 'We’ll email you a link to choose a new one.'
        : 'You sign in with Google. Add a password so you can sign in either way.';
      const row = this.prefRow('Password', idle, btn);
      // Feedback goes in THIS row's own subtitle. (Not this.setStatus — that
      // writes the "Last synced…" caption under the Schoology link, a different
      // section entirely; sending password mail must not post messages there.)
      const sub = row.querySelector('.srow-sub');
      btn.addEventListener('click', () => {
        const mail = this.opts.email;
        if (!mail) return;
        btn.disabled = true;
        btn.textContent = 'Sending…';
        void (has ? sendPasswordReset(mail) : sendSetPasswordEmail(mail))
          .then(() => {
            btn.textContent = 'Sent ✓';
            if (sub) sub.textContent = `Sent to ${mail}. Open the link to choose a password. It can take a minute, and it sometimes lands in spam.`;
          })
          .catch((err: Error) => {
            btn.disabled = false;
            btn.textContent = has ? 'Change password' : 'Set a password';
            if (sub) sub.textContent = err.message;
          });
      });
      pwRow.append(row);
    });

    const outBtn = el('button', { class: 'sdanger', text: 'Sign out' });
    outBtn.addEventListener('click', () =>
      this.confirmDanger('Sign out of Cobalt on this device?', () => void signOut())
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
        'Sync when I open Cobalt',
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

    // --- Sound. Lives on the TASKS tab (Gabe, 8/15), not Focus, because the only
    // sound it governs is the task check-off chime. The Focus tab owns the END
    // SOUND, which is a different, deliberately-chosen sound with its own switch.
    sec.append(el('div', { class: 'settings-group-label', text: '🔉 Sound' }));
    sec.append(
      this.prefRow(
        'Check-off sound',
        'The short chime when you check a task off.',
        // Reads AND writes the draft, like every other pref row here. Reading the
        // live cache instead would show a stale value against unsaved edits.
        this.prefSwitch(this.draft.prefs.sound.system, (on) => {
          this.draft.prefs.sound.system = on;
          void this.savePrefs();
        })
      )
    );

    // --- Languages. Which languages a task title may be translated FROM. See
    // prefs.ts translateFrom for why this is an allowlist and not a blocklist.
    sec.append(el('div', { class: 'settings-group-label', text: '🌐 Languages' }));
    sec.append(this.languagePicker());

    // --- Editing (the intrinsic-field lock; see tasks/render.ts editingUnlocked) ---
    sec.append(el('div', { class: 'settings-group-label', text: '✏️ Editing' }));
    sec.append(
      this.prefRow(
        'Edit task details',
        'Allow changing a task’s title, course, and due date (double-click them).',
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
    if (this.icalErr)
      this.icalErr.textContent = on
        ? 'That is not a Schoology calendar link. It looks like webcal://yourschool.schoology.com/calendar/feed/ical/…'
        : '';
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
      // A NOVEL COLOUR, not the same grey every time (Gabe, 8/22). The colour is
      // how a class is recognised without reading, and two courses born identical
      // is the one thing that breaks that. See courses/colors.ts.
      const color = nextCourseColor(this.draft.courses.map((x) => x.color));
      this.draft.courses.push({ id, name: 'New course', color, parseWords: [] });
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
          soundChildren.hidden = !on;
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
    // A CHILD of End Sound: which sound, and how loud, only exist while there is
    // one. Indented so the pair reads as belonging to the switch above them.
    soundChildren.classList.add('srow-child');
    soundChildren.hidden = !this.draft.endSoundEnabled;
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
    sec.append(
      this.prefRow(
        'Keep running after a refresh',
        'Reloading the page mid-session keeps the clock going instead of coming back paused. Off means a reload always lands paused, so nothing runs while you are away from it.',
        this.prefSwitch(p.focus.resumeAfterReload, (on) => {
          p.focus.resumeAfterReload = on;
          save();
        })
      )
    );
    // UNCLICKABLE, NOT REFUSED (Gabe, 8/20). Locking it out while a session runs is
    // the whole feature, and a control that argues with you afterwards still invites
    // the argument. A dead switch settles it before the click: nothing to push
    // against, nothing to be talked out of.
    // Only the OFF direction is ever locked, so the switch is dead only when it is
    // already on and a session is live. Turning it ON mid-session stays available.
    const lockAccountability = p.focus.timeAccountability && focusSessionLive();
    let sw: HTMLButtonElement;
    sec.append(
      this.prefRow(
        'Time accountability',
        'Removes the +/- buttons during a session, so the length you commit to is the length you serve. It cannot be switched off while a session is running.',
        (sw = this.prefSwitch(p.focus.timeAccountability, (on) => {
          // OFF IS THE GUARDED DIRECTION, and only that one. Turning it ON mid
          // session is fine, it only tightens the commitment. Turning it off is
          // exactly the negotiation the setting exists to prevent, so the switch
          // refuses and puts itself back (Gabe, 8/20).
          // The switch is disabled in this state, so this is only reachable if a
          // session STARTED while Settings was already open. Silent, deliberately:
          // the same "no" the disabled switch gives, without a popup about it.
          if (!on && focusSessionLive()) {
            sw.setAttribute('aria-checked', 'true');
            return;
          }
          p.focus.timeAccountability = on;
          save();
        }))
      )
    );
    if (lockAccountability) {
      sw!.disabled = true;
      sw!.title = 'Locked while a focus session is running. That is the point of it.';
    }
    sec.append(
      this.prefRow(
        'Group completed tasks',
        'On, completed session tasks collect under a "Completed" drawer so the work left stays on top. Off, they simply sit at the bottom of the list where you can see them.',
        this.prefSwitch(p.focus.groupFinished, (on) => {
          p.focus.groupFinished = on;
          save();
        })
      )
    );
    sec.append(
      this.prefRow(
        'Link Focus and Tasks',
        'On, they are one list: a task added in Focus appears in Tasks, and edits travel both ways. Off, the Focus list is private to Focus, and Import Tasks is the only thing that crosses over. Checking off always counts on both sides either way, so an imported task you finish in Focus is done in Tasks too.',
        this.prefSwitch(p.focus.linkTasks, (on) => {
          p.focus.linkTasks = on;
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
    const back = el('div', { class: 'bm-backdrop' });
    const box = el('div', { class: 'bm-modal playlist-editor' });

    box.append(el('h3', { class: 'bm-modal-title', text: existing ? 'Edit playlist' : 'New playlist' }));
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

    const actions = el('div', { class: 'bm-modal-footer' });
    const cancel = el('button', { class: 'bm-btn', text: 'Cancel' });
    cancel.addEventListener('click', () => fadeRemove(back));
    const save = el('button', { class: 'bm-btn bm-btn-primary', text: 'Save' });
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
        fadeRemove(back);
        void this.drawPlaylists(host);
      });
    });
    actions.append(el('div', { class: 'bm-modal-spacer' }), cancel, save);
    box.append(actions);

    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) fadeRemove(back);
    });
    enterConfirms(back, () => save); // Enter = Save (no-ops until name + a song exist)
    document.body.append(back);
    nameIn.focus(); // focus INTO the dialog so Enter reaches Save, not the opener
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

    // The gmail channel REQUIRES a verified address (these emails carry task
    // titles, so an unproven address could be a stranger's). Without this notice
    // the toggles below would look on and silently deliver nothing — exactly the
    // kind of silent failure that makes people think the app is broken. So say it
    // here, next to the switches, and offer the fix inline.
    const verifyWarn = el('div', { class: 'ngmail-note ngmail-warn' });
    verifyWarn.hidden = true;
    void needsEmailVerification().then((needs) => {
      if (!needs) return;
      verifyWarn.replaceChildren();
      verifyWarn.append(
        el('span', {
          text: '⚠ Email reminders are paused until you verify this address. They include your task titles, so we only send them once we know the inbox is yours.',
        })
      );
      const send = el('button', { class: 'nverify-send', text: 'Send verification email' }) as HTMLButtonElement;
      send.addEventListener('click', () => {
        send.disabled = true;
        send.textContent = 'Sending…';
        void resendEmailVerification()
          .then(() => {
            send.textContent = 'Sent ✓';
          })
          .catch((err: Error) => {
            send.textContent = err.message;
            send.disabled = false;
          });
      });
      verifyWarn.append(send);
      verifyWarn.hidden = false;
    });

    // --- appearance checklist ---
    const appear = el('div', { class: 'nappear' });
    appear.append(el('div', { class: 'nappear-title', text: 'What each notification shows' }));
    // One srow + gold nswitch per field, the same control every other setting in
    // this tab uses (Gabe, 8/8). The old compact ✓-checklist was the odd one out.
    const checkDefs: [keyof NotifyAppearance, string, string][] = [
      ['course', 'Course', 'Show which course the task belongs to.'],
      ['priority', 'Priority', 'Show the task’s priority level.'],
      ['dueTime', 'Due time', 'Show the time of day it’s due, not just the date.'],
    ];
    for (const [key, label, sub] of checkDefs) {
      appear.append(
        this.prefRow(
          label,
          sub,
          this.prefSwitch(n.appearance[key], (on) => {
            n.appearance[key] = on;
            refreshPreviews();
            save();
          })
        )
      );
    }

    // --- what's ALLOWED to notify you ---
    // Separate block from the checklist above on purpose: that one changes what a
    // notification LOOKS like, this one changes whether one is sent at all.
    const sources = el('div', { class: 'nappear' });
    sources.append(el('div', { class: 'nappear-title', text: 'What can notify you' }));
    sources.append(
      this.prefRow(
        'Duplicated tasks',
        'A copy keeps the original due date, so leaving this off stops one deadline reminding you once per copy.',
        this.prefSwitch(n.notifyDuplicates, (on) => {
          n.notifyDuplicates = on;
          save();
        })
      )
    );
    // TWO QUESTIONS, NOT ONE (Gabe, 8/22). "Silent" used to be a third option
    // inside Bulk edits, which asked "how should a burst arrive?" and answered
    // "there are no bursts" — a different question hiding inside the answers to
    // this one. Whether reminders fire at all is now its own switch, and Bulk edits
    // is its child: with the parent off there is no burst to shape, so the row
    // collapses away instead of sitting there inert.
    const bulkSeg = this.prefSeg<BurstMode>(
      [
        ['each', 'Each'],
        ['summary', 'One summary'],
      ],
      () => n.burstMode,
      (v) => {
        n.burstMode = v;
        save();
      }
    );
    const bulkRow = this.prefRow(
      'Bulk edits',
      'Changing the due dates of many tasks at once can put several of them inside a reminder window together. Send each reminder on its own, or fold the whole burst into a single message naming them all. Every reminder is listed in the notification log either way.',
      bulkSeg
    );
    // The wrapper that folds away with the parent (see .srow-child in settings.css
    // for why this is `hidden` rather than an animated collapse).
    const bulkWrap = el('div', { class: 'srow-child' });
    bulkWrap.append(bulkRow);

    const syncBulk = (on: boolean): void => {
      bulkWrap.hidden = !on;
      // Disabled as well as hidden. `hidden` already takes it out of the tab order,
      // so this is belt and braces — but it is also what makes the state true rather
      // than merely invisible, and the row is read by anything that walks the form.
      bulkSeg.querySelectorAll('button').forEach((b) => ((b as HTMLButtonElement).disabled = !on));
    };

    sources.append(
      this.prefRow(
        'Your creations and edits',
        'Adding a task, or moving one’s due date, is what puts it inside a reminder window. On, anything you create or edit that lands in one of your windows reminds you. Off, none of them do, and nothing is written to the notification log either. Your daily agenda, new assignments, and Focus notifications are separate and keep working.',
        this.prefSwitch(n.notifyEdits, (on) => {
          n.notifyEdits = on;
          syncBulk(on);
          save();
        })
      )
    );
    sources.append(bulkWrap);
    syncBulk(n.notifyEdits);

    // --- shared preview + test builders ---
    const previewRefreshers: (() => void)[] = [];
    const refreshPreviews = (): void => previewRefreshers.forEach((f) => f());

    // OS-FAITHFUL MOCK (Gabe, 8/31). The mock must look like the popup the student
    // will ACTUALLY get, or the preview reads as broken: on Windows that's the
    // Chrome toast (app icon left, source line at the bottom); on a Mac it's a
    // compact translucent card with Chrome's roundel on the left, the origin under
    // the title, and the site favicon on the right. util/os.ts decides once per
    // build; unknown OSes read as Mac (the userbase mostly is).
    const macMock = detectOS() === 'mac';
    const buildToast = (): { el: HTMLElement; set: (t: string, m: string) => void; get: () => { title: string; body: string } } => {
      const frame = el('div', { class: 'nprev' });
      frame.append(el('div', { class: 'nprev-tag', text: 'What the popup looks like' }));
      const stage = el('div', { class: 'nprev-stage' });
      let title: HTMLElement;
      let msg: HTMLElement;
      if (macMock) {
        const toast = el('div', { class: 'ntoast-mac' });
        const icon = el('div', { class: 'ntoast-mac-icon' });
        icon.innerHTML = CHROME_ICON_SVG;
        const body = el('div', { class: 'ntoast-mac-body' });
        title = el('div', { class: 'ntoast-mac-title' });
        msg = el('div', { class: 'ntoast-mac-msg' });
        body.append(title, el('div', { class: 'ntoast-mac-src', text: 'cobaltstudy.com' }), msg);
        const fav = el('div', { class: 'ntoast-mac-fav' });
        fav.innerHTML = wsIconSvg();
        toast.append(icon, body, fav);
        stage.append(toast);
      } else {
        const toast = el('div', { class: 'ntoast' });
        const icon = el('div', { class: 'ntoast-icon' });
        icon.innerHTML = wsIconSvg();
        const body = el('div', { class: 'ntoast-body' });
        title = el('div', { class: 'ntoast-title' });
        msg = el('div', { class: 'ntoast-msg' });
        body.append(title, msg, el('div', { class: 'ntoast-src', text: 'cobaltstudy.com' }));
        toast.append(icon, body);
        stage.append(toast);
      }
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
      av.innerHTML = wsIconSvg(); // the computer logo — the app's real avatar, not a letter
      const meta = el('div', { class: 'nmail-meta' });
      const fromRow = el('div', { class: 'nmail-fromrow' });
      fromRow.append(el('span', { class: 'nmail-from', text: 'Cobalt' }), el('span', { class: 'nmail-time', text: 'now' }));
      const toLine = el('div', { class: 'nmail-to', text: 'to me' });
      meta.append(fromRow, toLine);
      top.append(av, meta);
      const subj = el('div', { class: 'nmail-subj' });
      const body = el('div', { class: 'nmail-body' });
      const foot = el('div', { class: 'nmail-foot', text: 'Sent by Cobalt · manage in Settings ▸ Notifications' });
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
    naCard.append(this.notifyBar('inbox', 'New assignments', 'When Cobalt imports new work from Schoology.', naChan.el));
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
      fsToast.set('Focus session complete!', '25 min focused • 3/4 tasks done');
      fsMail.set('Focus session complete!', '25 min focused • 3/4 tasks done');
    };
    const fsCap = el('div', { class: 'nwheel-cap', text: 'Fires when your focus timer reaches zero. No setup. It just cheers you on.' });
    const fsTest = buildTest(() => fsToast.get());
    const fsEmailTest = buildTest(() => fsToast.get(), 'gmail');
    fsInner.append(fsCap, fsToast.el, fsTest, fsMail.el, fsEmailTest);
    fsDetail.append(fsInner);
    fsCard.append(fsDetail);
    previewRefreshers.push(refreshFs);

    // --- "Troubleshoot" button (top) — opens the animated fix-it guides ---
    const howToBtn = el('button', { class: 'notify-howto', text: 'Notifications not allowed? Open the fix-it guides →' }) as HTMLButtonElement;
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

    // PERM CAPTION FIRST, THEN THE GUIDES (Gabe, 8/22). The caption is what tells you
    // whether anything is wrong; the button is what you do about it. Reading "Blocked
    // by your browser" and then finding the fix directly beneath it is the order the
    // student actually needs, and it stops the button reading as a standing question
    // when the answer is already "Allowed ✓".
    sec.append(perm, howToBtn, master, gmailNote, verifyWarn, appear, sources, groups);
    refreshAll();
    return sec;
  }

  /** Notification troubleshooting guides — an overlay listing every cause that can
   *  block notifications, ordered most-likely-first. Each opens a slideshow where
   *  every step is an ANIMATED mockup (cursor glides, click ripples, the setting
   *  flips) with a caption — a looping mini-video of exactly what to do. Data +
   *  scenes live in settings/notifyGuides.ts. Esc/backdrop/✕ close; ←/→ page. */
  private openNotifyGuides(): void {
    const overlay = el('div', { class: 'ngd guide-scrim' });
    const card = el('div', { class: 'ngd-card guide-sheet' });
    // Which OS's guide list is showing (8/31). Defaults to the DETECTED OS
    // (util/os.ts — unknown reads as Mac); the Mac/Windows switcher on the index
    // covers school machines and wrong guesses. Switching resets to the index,
    // which is the only place the switcher renders — mid-guide the two lists'
    // steps don't correspond, so there's nothing sensible to switch to.
    let os = detectOS();
    const guides = () => (os === 'mac' ? NOTIFY_GUIDES_MAC : NOTIFY_GUIDES_WINDOWS);
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
      const g = guides()[gi];
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
          el('div', { class: 'ngd-title', text: 'Notifications not allowed?' }), // plural, matching the button that opens this (Gabe, 8/22)
          el('div', { class: 'ngd-sub', text: 'Work down this list. It’s ordered by how often each cause is the culprit. Every guide plays the fix step by step.' })
        );
        // Mac/Windows switcher — the fixes live in different settings apps.
        const osSeg = el('div', { class: 'ngd-os', role: 'group', 'aria-label': 'Which computer' });
        ([
          ['mac', 'Mac'],
          ['windows', 'Windows'],
        ] as const).forEach(([val, label]) => {
          const b = el('button', { class: `ngd-os-btn${os === val ? ' active' : ''}`, text: label }) as HTMLButtonElement;
          b.addEventListener('click', () => {
            if (os === val) return;
            os = val;
            render();
          });
          osSeg.append(b);
        });
        card.append(osSeg);
        const list = el('div', { class: 'ngd-list' });
        guides().forEach((g, i) => {
          const item = el('button', { class: 'ngd-item' }) as HTMLButtonElement;
          item.style.setProperty('--gda', g.color); // likelihood heat color (red → purple)
          // Wears the shared .count-badge recipe (9/7/26 — see .ngd-num in
          // settings.css for why this circle needed it too).
          const num = el('div', { class: 'count-badge ngd-num', text: String(i + 1) });
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
      const g = guides()[gi];
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
      const nav = el('div', { class: 'bm-modal-footer' });
      const prev = el('button', { class: 'bm-btn', text: 'Back' }) as HTMLButtonElement;
      prev.style.visibility = si === 0 ? 'hidden' : 'visible';
      prev.addEventListener('click', () => go(-1));
      const spacer = el('div', { class: 'bm-modal-spacer' });
      const next = el('button', { class: 'bm-btn bm-btn-primary', text: si === g.steps.length - 1 ? 'Done, next cause' : 'Next' }) as HTMLButtonElement;
      next.addEventListener('click', () => {
        if (si < g.steps.length - 1) go(1);
        else {
          gi = -1; // finished — back to the list so the next cause is one tap away
          render();
        }
      });
      nav.append(prev, spacer, next);
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
    /** Park the wheel on the value it currently holds. Not a user action: `last` is
     *  untouched, so the settle above sees no change and saves nothing. */
    const home = (): void => {
      w.scrollTop = last * ROW;
      mark();
    };
    requestAnimationFrame(home);
    // ...but a wheel is usually born where it CANNOT scroll. The Notifications tab
    // starts hidden (display:none until you click it) and a card whose channels are
    // off is a zero-height grid row, and scrollTop is a silent no-op on a box with
    // no layout. So every wheel used to open showing its FIRST value while the
    // caption underneath read the real setting: "5:00 PM" over "Sends at 8:00 PM"
    // (Gabe, 8/12). Re-home the instant the wheel actually gains a size.
    let seenH = 0;
    new ResizeObserver(() => {
      const h = w.clientHeight;
      const revealed = seenH === 0 && h > 0;
      seenH = h;
      if (revealed) home();
    }).observe(w);
    return w;
  }

  private courseRow(c: CourseConfig, redraw: () => void): HTMLElement {
    const row = el('div', { class: 'course-row' });

    const color = el('button', { type: 'button', class: 'course-color', title: 'Course color' });
    attachColorPicker(color, {
      value: () => toHex(c.color),
      host: this.opts.host,
      onChange: (hex) => {
        c.color = hex; // live preview while dragging in the picker
      },
      onClose: (changed) => {
        if (changed) void this.saveCourses(); // persist when the picker closes
      },
    });

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
      const recs = recommendedSet(named, used);
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
    const wordInput = textInput({ class: 'parse-add', placeholder: 'parse word' });
    const addWord = (): void => {
      const w = wordInput.value.trim().toLowerCase();
      if (!w) {
        wordInput.focus();
        return;
      }
      const conflict = this.draft.courses.find((x) => x.id !== c.id && x.parseWords.includes(w));
      if (conflict) {
        err.textContent = `Already used in "${conflict.name}".`;
        return;
      }
      if (!c.parseWords.includes(w)) c.parseWords.push(w);
      this.refocusParseId = c.id; // keep the cursor here for the next word
      void this.saveCourses();
      redraw();
    };
    wordInput.addEventListener('keydown', (e) => {
      if (e.key !== 'Enter') return;
      addWord();
    });
    // The commit button (Gabe, 8/26 — "rather than it just being enter"). It sits
    // flush against the box as one pill so the pair reads as a single control and
    // not as a fourth chip type in a row that already has three. The + on the
    // placeholder and the + on the button are never on screen together: typing the
    // first character replaces one with the other.
    const addWordBtn = el('button', { type: 'button', class: 'parse-add-go', text: '+', title: 'Add parse word' });
    // mousedown cancels the focus move only; click does the work, so Space/Enter on
    // the focused button works too (see the note in tasks/render.ts).
    addWordBtn.addEventListener('mousedown', (e) => e.preventDefault());
    addWordBtn.addEventListener('click', () => addWord());
    const addWrap = el('div', { class: 'parse-add-wrap' });
    addWrap.append(wordInput, addWordBtn);

    // One chip row (artifact style): saved words, then gold "+ word" suggestions,
    // then the "+ parse word" input and its commit button — all flowing inline.
    chips.append(recsHost, addWrap);
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
    box.append(el('h3', { class: 'bm-modal-title', text: h.title }), el('p', { class: 'help-text', text: h.text }));
    const ok = el('button', { class: 'bm-btn bm-btn-primary', text: 'Got it' });
    ok.addEventListener('click', () => fadeRemove(back));
    const footer = el('div', { class: 'bm-modal-footer' });
    footer.append(el('div', { class: 'bm-modal-spacer' }), ok);
    box.append(footer);
    back.append(box);
    back.addEventListener('click', (e) => {
      if (e.target === back) fadeRemove(back);
    });
    enterConfirms(back, () => null); // stacked-popup guard (see util/dom.ts)
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

// The REAL Cobalt app icon and the official Chrome roundel now live in
// ui/appIcon.ts, shared with the guide slides so the preview toast and the
// slide toasts stay pixel-identical (Gabe, 8/31). On a Mac popup, Chrome sits
// on the LEFT and the site's identity (Cobalt) rides on the RIGHT as the large
// favicon; on Windows the Cobalt icon leads.
// Fresh id suffix per mount — five toast previews sit in the DOM at once, and
// duplicate gradient ids, while visually harmless, are invalid markup.
let wsIconN = 0;
const wsIconSvg = (): string => cobaltIconSvg(`set${wsIconN++}`);
const CHROME_ICON_SVG = chromeIconSvg();

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


// #endregion
