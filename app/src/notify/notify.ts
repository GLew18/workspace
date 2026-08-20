// Cobalt: notification plumbing (assignment reminders).
//
// Device-local system notifications via the Web Notifications API. They fire while
// Cobalt is OPEN (a tab or the installed PWA). True push-while-closed needs a
// server (Firebase Cloud Messaging) and comes with hosting later.
//
// The LEDGER is the important part: every notification has a stable key recorded in
// localStorage before it's shown, so a reload / re-render / second evaluation can
// never fire the same reminder twice. Entries are date-stamped and pruned after a
// few days so the ledger can't grow forever.

import { NOTIF_ICON } from './icon';
import { logNotification } from './log';
import { scopedKey } from '../util/userScope';

/** What details each task-notification includes (one setting, applied to every
 *  independent-task notification). */
export interface NotifyAppearance {
  course: boolean; // the course name
  priority: boolean; // the task's priority
  dueTime: boolean; // the due date + time
}

/** The two delivery channels every notification can independently use. A notification
 *  with both off is effectively "off". */
export interface Channels {
  popup: boolean; // a browser / OS pop-up notification
  gmail: boolean; // an email (via the Firestore "Trigger Email" extension)
}

/** How a burst of simultaneous reminders is delivered — see NotifySettings. */
export type BurstMode = 'each' | 'summary' | 'silent';

export interface NotifySettings {
  // "All reminders" — a linked SELECT-ALL, not an independent gate. Clicking a master
  // channel sets that channel on EVERY notification below; it shows gold only while
  // ALL of them have it on (one child turned off un-lights the master). It is always
  // re-derived from the children on load (normalizeNotifySettings), so delivery logic
  // reads each notification's OWN channels — never the master.
  master: Channels;
  // NOTE: the Gmail channel always delivers to the SIGNED-IN ACCOUNT email — there is
  // deliberately no stored/editable address (an editable field would let a user point
  // notifications at someone else's inbox). The client learns the address from the
  // auth session; the Cloud Function from Firebase Auth.
  appearance: NotifyAppearance;
  /** Should a DUPLICATED task be able to notify you? Off by default, because a
   *  duplicate normally carries the original's due date, so every copy would
   *  reproduce the original's reminders: duplicate a task three times and the
   *  same deadline pings you four times. Turning this on treats copies as
   *  ordinary tasks. Gates every task-driven reminder at once (due-soon, daily
   *  agenda, tomorrow preview) since they all read the same task list. */
  notifyDuplicates: boolean;
  /** How reminders interrupt you (Gabe, 8/10, extended 8/19). Bulk actions can
   *  make many come due at the same instant: move twelve tasks onto today, or
   *  create a batch of them, and twelve pop-ups (and twelve emails) fire back to
   *  back.
   *    'each'    — no grouping, every reminder interrupts you separately.
   *    'summary' — DEFAULT. A burst becomes one message naming them all.
   *    'silent'  — NOTHING interrupts you, one reminder or twenty.
   *  Silent covers single reminders as well as bursts on purpose (Gabe, 8/19):
   *  "no pop-ups for a bulk change, but yes for the same task on its own" is not
   *  a rule anyone could hold in their head, and a student who says silence means
   *  it. Nothing is lost in any mode — the 🔔 log still lists every one. */
  burstMode: BurstMode;
  // Each notification carries its OWN Popup/Gmail choice (the per-card grid). A pop-up
  // fires iff its popup channel is on (and the browser granted permission); an email
  // fires iff its gmail channel is on (and the account has an email). Config fields
  // (leads/times/mode) are unchanged.
  dueSoon: { channels: Channels; leads: number[] };
  dailyAgenda: { channels: Channels; hour: number; minute: number };
  tomorrow: { channels: Channels; hour: number; minute: number };
  newAssignment: { channels: Channels; mode: 'each' | 'batched'; intervalMins: number };
  focusSession: { channels: Channels };
}

export const DEFAULT_NOTIFY_SETTINGS: NotifySettings = {
  master: { popup: false, gmail: false }, // derived — see normalizeNotifySettings
  appearance: { course: true, priority: false, dueTime: true },
  notifyDuplicates: false, // OFF by default, per Gabe
  burstMode: 'summary', // a storm of pop-ups is never wanted
  // Popup defaults on for the core reminders — still inert until the user grants the
  // browser permission (the real opt-in). Gmail is opt-in per card + confirmation.
  dueSoon: { channels: { popup: true, gmail: false }, leads: [60] },
  dailyAgenda: { channels: { popup: true, gmail: false }, hour: 7, minute: 0 },
  tomorrow: { channels: { popup: false, gmail: false }, hour: 8, minute: 0 },
  newAssignment: { channels: { popup: false, gmail: false }, mode: 'each', intervalMins: 60 },
  focusSession: { channels: { popup: true, gmail: false } },
};

/** Read a Channels object from stored data, falling back to `dflt` per field. */
function readChannels(raw: unknown, dflt: Channels): Channels {
  const r = raw as { popup?: unknown; gmail?: unknown } | undefined;
  if (!r || typeof r !== 'object') return { ...dflt };
  return {
    popup: typeof r.popup === 'boolean' ? r.popup : dflt.popup,
    gmail: typeof r.gmail === 'boolean' ? r.gmail : dflt.gmail,
  };
}

/** Coerce a stored value — the NEW {master, …channels} shape, the OLD {enabled, email,
 *  …enabled} shape, the ANCIENT {leadMins, digest} shape, or junk — into a complete
 *  NotifySettings, so existing users keep working across the channel-grid redesign.
 *  The master is always RE-DERIVED from the children here (gold = every child on), so
 *  a drifted stored value can never make the UI lie. */
export function normalizeNotifySettings(raw: unknown): NotifySettings {
  const d = DEFAULT_NOTIFY_SETTINGS;
  const out: NotifySettings = {
    master: { ...d.master },
    appearance: { ...d.appearance },
    notifyDuplicates: d.notifyDuplicates,
    burstMode: d.burstMode,
    dueSoon: { channels: { ...d.dueSoon.channels }, leads: [...d.dueSoon.leads] },
    dailyAgenda: { channels: { ...d.dailyAgenda.channels }, hour: d.dailyAgenda.hour, minute: d.dailyAgenda.minute },
    tomorrow: { channels: { ...d.tomorrow.channels }, hour: d.tomorrow.hour, minute: d.tomorrow.minute },
    newAssignment: { channels: { ...d.newAssignment.channels }, mode: d.newAssignment.mode, intervalMins: d.newAssignment.intervalMins },
    focusSession: { channels: { ...d.focusSession.channels } },
  };
  const deriveMaster = (): void => {
    const kids = [out.dueSoon.channels, out.dailyAgenda.channels, out.tomorrow.channels, out.newAssignment.channels, out.focusSession.channels];
    out.master = { popup: kids.every((c) => c.popup), gmail: kids.every((c) => c.gmail) };
  };
  if (!raw || typeof raw !== 'object') {
    deriveMaster();
    return out;
  }
  const r = raw as Record<string, unknown>;

  // Config fields (same names in every shape): appearance, leads, times, mode/interval.
  const ap = r.appearance as Partial<NotifyAppearance> | undefined;
  if (ap && typeof ap === 'object') out.appearance = { course: ap.course ?? d.appearance.course, priority: ap.priority ?? d.appearance.priority, dueTime: ap.dueTime ?? d.appearance.dueTime };
  // Boolean, so `?? default` (not `||`) — a stored `false` must survive the read.
  if (typeof r.notifyDuplicates === 'boolean') out.notifyDuplicates = r.notifyDuplicates;
  // burstMode replaced the groupBursts boolean on 8/19. Read both: an existing
  // user's stored `false` still means "every reminder, separately".
  if (r.burstMode === 'each' || r.burstMode === 'summary' || r.burstMode === 'silent') out.burstMode = r.burstMode;
  else if (typeof r.groupBursts === 'boolean') out.burstMode = r.groupBursts ? 'summary' : 'each';
  const ds = r.dueSoon as { leads?: unknown } | undefined;
  if (ds) { const leads = Array.isArray(ds.leads) ? ds.leads.filter((n): n is number => typeof n === 'number') : []; if (leads.length) out.dueSoon.leads = leads; }
  // Digest times are held to what the pickers can actually SHOW: hour 5-11 (the
  // agenda reads it as AM, the preview adds 12 for PM) and minutes in steps of 5.
  // A value outside that is unrepresentable on the wheel, so it would sit there
  // displaying something other than the setting it is meant to be editing.
  // (NaN falls back to the default rather than poisoning the clock string.)
  const digestHour = (h: number, dflt: number): number => (Number.isFinite(h) ? Math.min(11, Math.max(5, Math.round(h))) : dflt);
  const digestMin = (m: number, dflt: number): number => (Number.isFinite(m) ? Math.min(55, Math.max(0, Math.round(m / 5) * 5)) : dflt);
  const da = r.dailyAgenda as { hour?: unknown; minute?: unknown } | undefined;
  if (da) { if (typeof da.hour === 'number') out.dailyAgenda.hour = digestHour(da.hour, d.dailyAgenda.hour); if (typeof da.minute === 'number') out.dailyAgenda.minute = digestMin(da.minute, d.dailyAgenda.minute); }
  const tm = r.tomorrow as { hour?: unknown; minute?: unknown } | undefined;
  if (tm) { if (typeof tm.hour === 'number') out.tomorrow.hour = digestHour(tm.hour, d.tomorrow.hour); if (typeof tm.minute === 'number') out.tomorrow.minute = digestMin(tm.minute, d.tomorrow.minute); }
  const na = r.newAssignment as { mode?: unknown; intervalMins?: unknown } | undefined;
  if (na) { out.newAssignment.mode = na.mode === 'batched' ? 'batched' : 'each'; if (typeof na.intervalMins === 'number' && na.intervalMins >= 30) out.newAssignment.intervalMins = na.intervalMins; }

  if (r.master) {
    // NEW shape — read the children's channels directly. (A previously-stored
    // emailAddress/emailConfirmed is deliberately IGNORED: the Gmail channel always
    // targets the signed-in account email now.)
    out.dueSoon.channels = readChannels((r.dueSoon as { channels?: unknown } | undefined)?.channels, d.dueSoon.channels);
    out.dailyAgenda.channels = readChannels((r.dailyAgenda as { channels?: unknown } | undefined)?.channels, d.dailyAgenda.channels);
    out.tomorrow.channels = readChannels((r.tomorrow as { channels?: unknown } | undefined)?.channels, d.tomorrow.channels);
    out.newAssignment.channels = readChannels((r.newAssignment as { channels?: unknown } | undefined)?.channels, d.newAssignment.channels);
    out.focusSession.channels = readChannels((r.focusSession as { channels?: unknown } | undefined)?.channels, d.focusSession.channels);
  } else {
    // OLD shape — the single {enabled} master and {email.enabled} were hard gates, so
    // fold them INTO each child's channels: a child was effectively popping up only if
    // the master was on AND its own toggle was on (same for email). Children MISSING
    // from the stored record (ancient records, or records from before a type existed)
    // fall back to that era's default enable — still folded through the same gates, so
    // a user whose master was OFF can never migrate into receiving anything.
    const em = r.email as { enabled?: unknown; address?: unknown } | undefined;
    const masterOn = !!r.enabled;
    const emailOn = !!(em && em.enabled); // the old email opt-in still gates the gmail channels
    const mig = (node: unknown, defaultEnabled: boolean): Channels => {
      const n2 = node as { enabled?: unknown } | undefined;
      const on = n2 ? !!n2.enabled : defaultEnabled;
      return { popup: masterOn && on, gmail: emailOn && on };
    };
    // Old-era defaults: due-soon + daily agenda + focus were on; tomorrow + new-work off.
    out.dueSoon.channels = mig(r.dueSoon, true);
    out.dailyAgenda.channels = mig(r.dailyAgenda, true);
    out.tomorrow.channels = mig(r.tomorrow, false);
    out.newAssignment.channels = mig(r.newAssignment, false);
    out.focusSession.channels = mig(r.focusSession, true);
    // ANCIENT {leadMins, digest}: no per-type nodes at all. leadMins was the one
    // due-soon lead; digest (a boolean, default true) was the daily agenda's enable.
    if (typeof r.leadMins === 'number' && !r.dueSoon) out.dueSoon.leads = [r.leadMins];
    if (r.digest === false && !r.dailyAgenda) out.dailyAgenda.channels = { popup: false, gmail: false };
  }
  deriveMaster();
  return out;
}

// --- shared formatting (scheduler + settings preview both use these) ----------

/** "1 hour", "30 minutes", "24 hours" — friendly lead-time label. */
export function leadLabel(mins: number): string {
  if (mins < 60) return `${mins} minutes`;
  // Round to whole hours/days: this now also renders REAL remaining time (see
  // reminderBody), which is rarely a clean multiple, and "in 35.65 hours" reads
  // like a machine talking.
  const h = Math.round(mins / 60);
  if (h < 48) return `${h} hour${h === 1 ? '' : 's'}`;
  const d = Math.round(h / 24);
  return `${d} day${d === 1 ? '' : 's'}`;
}

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
function fmtClock(d: Date): string {
  let h = d.getHours();
  const m = d.getMinutes();
  const ap = h >= 12 ? 'PM' : 'AM';
  h = h % 12 || 12;
  return `${h}:${String(m).padStart(2, '0')} ${ap}`;
}
function sameDay(a: Date, b: Date): boolean {
  return a.getFullYear() === b.getFullYear() && a.getMonth() === b.getMonth() && a.getDate() === b.getDate();
}

/** Body line for a due-soon reminder, honoring the appearance toggles — e.g.
 *  "Science · Due Fri 3:00 PM (in 24 hours)". The due date is named only when the
 *  reminder fires on an earlier calendar day than the due time. */
export function reminderBody(
  opts: {
    course?: string;
    priority?: string;
    nowMs: number;
    dueMs: number;
    leadMins: number;
    /** The task has a due DATE but no due time (dueMs is a synthetic end-of-day).
     *  Then the clock is ours, not the user's, so it is never shown. */
    untimed?: boolean;
  },
  a: NotifyAppearance
): string {
  const parts: string[] = [];
  if (a.course && opts.course) parts.push(opts.course);
  if (a.priority && opts.priority) parts.push(`${opts.priority} priority`);
  // The countdown is measured from the ACTUAL time left, not from the lead
  // setting. A lead is a window now, so a 72h lead can fire on a task due in 36
  // hours — printing "in 72 hours" there would simply be false.
  const remaining = Math.round((opts.dueMs - opts.nowMs) / 60_000);
  if (a.dueTime) {
    const now = new Date(opts.nowMs);
    const due = new Date(opts.dueMs);
    const day = sameDay(now, due) ? '' : WEEKDAYS[due.getDay()];
    const when = opts.untimed ? day || 'today' : [day, fmtClock(due)].filter(Boolean).join(' ');
    // An untimed task due today is past its own midnight, so a countdown would
    // read "in 0 minutes". The date alone says everything that's true.
    parts.push(remaining > 0 ? `Due ${when} (in ${leadLabel(remaining)})` : `Due ${when}`);
  } else {
    parts.push(remaining > 0 ? `Due in ${leadLabel(remaining)}` : 'Due today');
  }
  return parts.join(' · ');
}

/** Body for a new-assignment notification — course/priority/due date+time, no
 *  countdown (it fires at import time, not relative to the due time). */
export function taskInfoBody(opts: { course?: string; priority?: string; dueMs?: number | null }, a: NotifyAppearance): string {
  const parts: string[] = [];
  if (a.course && opts.course) parts.push(opts.course);
  if (a.priority && opts.priority) parts.push(`${opts.priority} priority`);
  if (a.dueTime && opts.dueMs) {
    const due = new Date(opts.dueMs);
    parts.push(`Due ${WEEKDAYS[due.getDay()]} ${fmtClock(due)}`);
  }
  return parts.join(' · ') || 'Imported from Schoology';
}

/** "30 min", "1 hr", "12 hr" — batch-interval label. */
export function intervalLabel(mins: number): string {
  return mins < 60 ? `${mins} min` : `${mins / 60} hr`;
}

/** Fired (on window) by Settings when notification prefs are saved, so the running
 *  scheduler picks up changes without re-reading the profile on a timer. */
export const NOTIFY_SETTINGS_EVENT = 'ws:notify-settings';

export function notificationsSupported(): boolean {
  return 'Notification' in window;
}

export function notificationPermission(): NotificationPermission | 'unsupported' {
  return notificationsSupported() ? Notification.permission : 'unsupported';
}

/** Ask for permission (must be called from a user gesture — the Enable click).
 *  Resolves true iff notifications may be shown. */
export async function ensureNotificationPermission(): Promise<boolean> {
  if (!notificationsSupported()) return false;
  if (Notification.permission === 'granted') return true;
  if (Notification.permission === 'denied') return false;
  try {
    return (await Notification.requestPermission()) === 'granted';
  } catch {
    return false;
  }
}

// --- email mirror (optional) -------------------------------------------------
// When the user turns on "also email me", every notification is ALSO mirrored to
// an email. notify.ts stays backend-agnostic: main.ts injects the real sender via
// setEmailSink (which writes to the Firestore "mail" collection the Trigger Email
// extension watches), and the scheduler keeps the live prefs in sync via
// setEmailPrefs. The two channels are independent — email can fire even when the
// browser blocked the desktop toast, so email-only is a valid setup.
let emailAddress = ''; // where the Gmail channel sends — set by the scheduler from settings/account
let emailSink: ((to: string, subject: string, body: string) => void) | null = null;

/** Inject the email sender once at app boot (null in local/no-Firebase mode). */
export function setEmailSink(fn: ((to: string, subject: string, body: string) => void) | null): void {
  emailSink = fn;
}
/** Set the address the Gmail channel delivers to. Called by the scheduler on load
 *  and whenever notification settings are saved. */
export function setEmailAddress(address: string): void {
  emailAddress = address || '';
}

/** Deliver a notification on the requested channels. `popup` shows a browser pop-up
 *  (only when permission is granted); `gmail` sends an email (only when an address +
 *  sender are wired). The caller decides the channels (master cap × the notification's
 *  own choice); the two are independent. Clicking the pop-up focuses Cobalt, then
 *  runs `onClick` (e.g. jump to the Tasks tab). */
// --- burst grouping (NotifySettings.groupBursts) -----------------------------
//
// A bulk action can make many reminders come due in the same instant: drop
// twelve tasks onto today, and twelve pop-ups and twelve emails fire back to
// back. The rule (Gabe, 8/10) is ONE interruption for the whole burst, not a
// few individual ones plus a summary: everything that fires together becomes a
// single "Due soon: multiple assignments" naming every task.
//
// So every notification is held for one short quiet gap. When the gap closes,
// a lone notification goes out exactly as it always did (the delay is
// imperceptible and nothing is reworded), and two or more become the combined
// one. The 🔔 log still records each notification separately, so the history
// is complete and only the interruption is merged.
const BURST_FLUSH_MS = 1_200; // quiet gap that closes a burst

interface Queued {
  title: string;
  body: string;
  /** The bare task name, when the caller has one. The combined message lists
   *  THESE, not the titles: a title reads "Due soon: Lab report", and repeating
   *  that phrase down a comma-separated list under a heading that already says
   *  "Due soon" was the ugly part (Gabe, 8/10). */
  name?: string;
  popup: boolean;
  gmail: boolean;
  onClick?: () => void;
}
let burstQueue: Queued[] = [];
let burstTimer: number | null = null;
let burstMode: BurstMode = 'summary'; // mirrors NotifySettings.burstMode

/** Point the burst grouper at the current setting (called wherever settings load). */
export function setBurstMode(mode: BurstMode): void {
  burstMode = mode;
}

/** Close the burst: one notification either way. */
function flushBurst(): void {
  burstTimer = null;
  const q = burstQueue;
  burstQueue = [];
  if (!q.length) return;
  if (q.length === 1) {
    // A lone reminder is itself, untouched (deliver() logs it).
    deliver(q[0].title, q[0].body, q[0]);
    return;
  }
  // Many at once → each is logged individually, so the 🔔 screen still shows the
  // real history, and then ONE interruption lists them all. The combined message
  // is the delivery, not a log entry of its own (they were just logged).
  // ('silent' never reaches here: sendNotification logs and returns.)
  for (const item of q) {
    logNotification({ title: item.title, body: item.body, popup: item.popup, gmail: item.gmail });
  }
  // Body = the task NAMES, nothing else. The heading carries "Due soon" once.
  deliver(
    'Due soon: multiple assignments',
    q.map((i) => i.name || i.title).join(', '),
    { popup: q.some((i) => i.popup), gmail: q.some((i) => i.gmail) },
    false // already logged, per item
  );
}

export function sendNotification(
  title: string,
  body: string,
  opts: { popup?: boolean; gmail?: boolean; name?: string; onClick?: () => void } = {}
): void {
  if (burstMode === 'silent') {
    // Logged, never delivered — and the log says so, because the popup/gmail
    // flags it records are the routes that ACTUALLY ran. Applies to a lone
    // reminder too, not just a burst (see NotifySettings.burstMode).
    deliver(title, body, { ...opts, popup: false, gmail: false });
    return;
  }
  if (burstMode === 'each') {
    deliver(title, body, opts);
    return;
  }
  burstQueue.push({
    title,
    body,
    name: opts.name,
    popup: !!opts.popup,
    gmail: !!opts.gmail,
    onClick: opts.onClick,
  });
  if (burstTimer !== null) clearTimeout(burstTimer);
  burstTimer = window.setTimeout(flushBurst, BURST_FLUSH_MS);
}

/** The actual delivery: pop-up, email, and (unless the caller already did it
 *  per item) the log entry. */
function deliver(
  title: string,
  body: string,
  opts: { popup?: boolean; gmail?: boolean; onClick?: () => void } = {},
  log = true
): void {
  if (opts.popup) {
    try {
      if (notificationsSupported() && Notification.permission === 'granted') {
        // NOTIF_ICON, not a URL: a referenced icon is fetched when the popup is
        // shown, so a slow or failed request produces a logo-less notification.
        const n = new Notification(title, { body, icon: NOTIF_ICON, badge: NOTIF_ICON });
        n.onclick = () => {
          try {
            window.focus();
            opts.onClick?.();
            n.close();
          } catch {
            /* ignore */
          }
        };
      }
    } catch {
      /* Notification constructor can throw (e.g. some Android webviews) — never fatal */
    }
  }
  let emailed = false;
  if (opts.gmail && emailAddress && emailSink) {
    try {
      emailSink(emailAddress, title, body);
      emailed = true;
    } catch {
      /* email is best-effort; never break the notification path */
    }
  }
  // Record it for the 🔔 log — ONE entry per notification, carrying which routes
  // actually delivered. This is the single choke point every notification in the
  // app (scheduler reminders and focus-session cues alike) passes through, so
  // logging here can't miss one or double-count a pop-up + email pair.
  const shown = !!opts.popup && notificationsSupported() && Notification.permission === 'granted';
  if (log && (shown || emailed)) logNotification({ title, body, popup: shown, gmail: emailed });
}

// --- sent-ledger (SHARED with the Cloud Function) ---------------------------
//
// This used to be localStorage-only, and the Cloud Function used
// users/{uid}/notifySent. Two ledgers that couldn't see each other, so every
// reminder could send TWICE: once from an open tab, once from the server. Gabe's
// inbox showed the pair (the differing punctuation is what gave it away).
//
// Now both read and write the SAME node. `attachLedger` is called once at
// sign-in with the Data layer; until then the local map is all we have, which is
// the correct fallback for local mode and for the moment before the first read
// lands. Entries are mirrored to localStorage too, so a reload mid-session can't
// re-fire a reminder while the cloud copy is still loading.

// Per-account (see util/userScope.ts): the keys embed task ids, and two accounts
// sharing one ledger would suppress each other's reminders.
const LEDGER_KEY = () => scopedKey('notify:sent:v1');
const LEDGER_KEEP_DAYS = 7;

interface Ledger {
  [key: string]: string; // key → 'YYYY-MM-DD' the entry was recorded (for pruning)
}

/** Cloud writer, installed by attachLedger(). Null in local mode. */
let ledgerWrite: ((key: string, day: string) => void) | null = null;
/** In-memory view: localStorage seed, then merged with the cloud copy. */
let ledger: Ledger = loadLocal();

function loadLocal(): Ledger {
  try {
    return JSON.parse(localStorage.getItem(LEDGER_KEY()) || '{}');
  } catch {
    return {};
  }
}

function saveLocal(l: Ledger): void {
  try {
    localStorage.setItem(LEDGER_KEY(), JSON.stringify(l));
  } catch {
    /* quota — worst case a reminder repeats after a reload */
  }
}

/**
 * Point the ledger at the shared cloud node. `seed` is everything the server has
 * already sent; it is MERGED with (never replaces) the local copy, so a reminder
 * recorded by either side counts for both.
 */
export function attachLedger(
  seed: Record<string, unknown>,
  write: (key: string, day: string) => void
): void {
  // The Function writes {at: <ms>} per key; we write 'YYYY-MM-DD'. Only the KEY
  // matters for dedupe, but the value drives pruning, so normalize on the way in
  // or a cloud-shaped entry would never expire.
  const norm: Ledger = {};
  for (const [k, v] of Object.entries(seed)) {
    const ms = typeof v === 'object' && v && 'at' in v ? Number((v as { at: unknown }).at) : NaN;
    norm[k] = Number.isFinite(ms)
      ? new Date(ms).toISOString().slice(0, 10)
      : typeof v === 'string'
        ? v
        : new Date().toISOString().slice(0, 10);
  }
  ledger = { ...ledger, ...norm };
  ledgerWrite = write;
  saveLocal(ledger);
}

export function alreadySent(key: string): boolean {
  return key in ledger;
}

/**
 * Forget every ledger entry whose key starts with `prefix` — i.e. let those
 * reminders fire again.
 *
 * The ledger's whole job is "say this once", and a reminder's key carries the due
 * date it was sent for, so a task moved to a NEW date is a new key and speaks for
 * itself. The gap is a task moved BACK to a date it already reminded for today
 * (Gabe, 8/19): drag it to tomorrow, drag it back, and the old key is still on
 * file, so re-dating a task to today silently did nothing. Re-dating is a
 * deliberate act and deserves an answer, so the scheduler wipes a task's reminder
 * keys whenever its date or time changes.
 *
 * Local only, deliberately: the cloud copy is the Cloud Function's business and it
 * re-reads the task's real date anyway.
 */
export function forgetSent(prefix: string): void {
  let hit = false;
  for (const k of Object.keys(ledger)) {
    if (k.startsWith(prefix)) {
      delete ledger[k];
      hit = true;
    }
  }
  if (hit) saveLocal(ledger);
}

/**
 * Re-read the on-device ledger, so a SECOND TAB can see what this device has
 * already sent (Gabe, 8/11: the same four reminders arrived twice, in two
 * batches with different orderings).
 *
 * `ledger` is a module-level object, so it is per-JS-CONTEXT: two tabs of Cobalt
 * on one machine each hold their own copy. Both evaluate the same tasks, both
 * find their own copy empty, and both send. The cloud ledger does not save it
 * either, since that write is fire-and-forget and lands long after the decision.
 * localStorage IS shared between tabs and is written synchronously by markSent,
 * so re-reading it before an evaluation pass makes the first tab's marks visible
 * to the second.
 *
 * Union, not replace: keys this tab just marked must survive even if the stored
 * copy is momentarily behind.
 */
export function refreshLedger(): void {
  ledger = { ...loadLocal(), ...ledger };
}

// Another tab wrote the ledger → merge it in immediately, so a tab that is
// mid-evaluation still sees it without waiting for its next refresh.
if (typeof window !== 'undefined') {
  window.addEventListener('storage', (e) => {
    if (e.key === LEDGER_KEY()) refreshLedger();
  });
}

/** Record `key` as sent today, pruning entries older than LEDGER_KEEP_DAYS. */
export function markSent(key: string, todayISO: string): void {
  ledger[key] = todayISO;
  const cutoff = new Date(todayISO + 'T00:00:00');
  cutoff.setDate(cutoff.getDate() - LEDGER_KEEP_DAYS);
  for (const [k, day] of Object.entries(ledger)) {
    if (new Date(day + 'T00:00:00') < cutoff) delete ledger[k];
  }
  saveLocal(ledger);
  // Fire-and-forget: the local copy already blocks a repeat on this device, and
  // the cloud write is what stops the Function from re-sending the same one.
  ledgerWrite?.(key, todayISO);
}
