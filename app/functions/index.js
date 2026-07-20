// WorkSpace — Cloud Function: closed-app reminders (push + email).
//
// While WorkSpace is OPEN, src/notify/scheduler.ts fires reminders locally. While
// it's CLOSED, THIS function runs every 5 minutes and delivers the same TIME-BASED
// reminders through two channels:
//   • PUSH   → admin.messaging().send() → the service worker (public/sw.js 'push'
//              handler) shows the notification; a click opens the app at /#tasks.
//   • EMAIL  → a doc written to the Firestore `mail` collection, which the
//              "Trigger Email from Firestore" extension delivers.
//
// It mirrors the client's three time-based Task rules — due-soon (multi-lead, ACROSS
// DAYS: leads go up to 72h), daily agenda, tomorrow preview — and the client's
// delivery rule exactly: a channel fires iff the notification's OWN {popup,gmail}
// channel is on (the "All reminders" master is a UI select-all, never a gate), push
// additionally needs an enrolled device token, email a CONFIRMED stored address.
// Legacy profile shapes are normalized here the same way the client migrates them
// (see channelsView below), so users who haven't re-saved settings still get served.
// (New-assignment alerts need import tracking that only exists while the app is
// open; focus-session cheers are an in-app event — neither applies when closed.)
//
// DEDUPE: each user's ledger entries are written to users/{uid}/notifySent BEFORE
// their sends go out (at-most-once): a crash mid-delivery can't double-fire on the
// next run. The deliberate trade-off is that a send that then fails has consumed its
// key. The client keeps its OWN localStorage ledger, so when the app is open a
// reminder can arrive at most once from EACH side. Acceptable in v1.
//
// TIMEZONE: dueDate/dueTime are the student's local wall time with no zone info.
// Every WorkSpace user is a Heschel student, so we evaluate in America/New_York.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

const TZ = 'America/New_York';
const LEDGER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
const CATCHUP_MIN = 60; // a due-soon lead fires only within ~1h of its moment
const MAX_LEAD_DAYS = 3; // leads go up to 72h → scan tasks due today..today+3
const MAIL_COLLECTION = 'mail'; // watched by the Trigger Email extension

const WEEKDAYS = ['Sun', 'Mon', 'Tue', 'Wed', 'Thu', 'Fri', 'Sat'];
const pad = (n) => String(n).padStart(2, '0');
const cap = (s) => (s ? s.charAt(0).toUpperCase() + s.slice(1) : s);

/** Current date ('YYYY-MM-DD') + minutes-since-midnight, in the app's timezone. */
function nowInTz() {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit',
    hour: '2-digit', minute: '2-digit', hour12: false,
  }).formatToParts(new Date());
  const get = (t) => parts.find((p) => p.type === t).value;
  return {
    today: `${get('year')}-${get('month')}-${get('day')}`,
    minutes: Number(get('hour')) * 60 + Number(get('minute')),
  };
}

/** Add `n` days to a 'YYYY-MM-DD' wall-clock date (UTC math avoids DST drift). */
function addDays(ymd, n) {
  const [y, m, d] = ymd.split('-').map(Number);
  const dt = new Date(Date.UTC(y, m - 1, d));
  dt.setUTCDate(dt.getUTCDate() + n);
  return `${dt.getUTCFullYear()}-${pad(dt.getUTCMonth() + 1)}-${pad(dt.getUTCDate())}`;
}

/** Short weekday name for a 'YYYY-MM-DD' date. */
function weekdayOf(ymd) {
  const [y, m, d] = ymd.split('-').map(Number);
  return WEEKDAYS[new Date(Date.UTC(y, m - 1, d)).getUTCDay()];
}

function fmt12h(hhmm) {
  const [h, m] = hhmm.split(':').map(Number);
  const ampm = h >= 12 ? 'PM' : 'AM';
  return `${h % 12 || 12}:${pad(m)} ${ampm}`;
}
function leadLabel(mins) {
  if (mins < 60) return `${mins} minutes`;
  const h = mins / 60;
  return `${h} hour${h === 1 ? '' : 's'}`;
}

/** Due-soon body honoring the appearance toggles — mirrors notify.ts reminderBody.
 *  Names the due DAY when the reminder fires on an earlier calendar day. */
function reminderBody(t, lead, a, sameDay) {
  const parts = [];
  if (a.course && t.course) parts.push(t.course);
  if (a.priority && t.priority) parts.push(`${cap(t.priority)} priority`);
  const when = sameDay ? fmt12h(t.dueTime) : `${weekdayOf(t.dueDate)} ${fmt12h(t.dueTime)}`;
  parts.push(a.dueTime ? `Due ${when} (in ${leadLabel(lead)})` : `Due in ${leadLabel(lead)}`);
  return parts.join(' · ');
}

/** A Firestore Trigger-Email doc. */
function mailDoc(to, subject, body) {
  const esc = (s) => String(s).replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c]));
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;font-size:15px;color:#1a2233;line-height:1.5">` +
    `<p style="margin:0 0 6px;font-weight:600;font-size:16px">${esc(subject)}</p>` +
    `<p style="margin:0;color:#4a5568">${esc(body)}</p>` +
    `<p style="margin:18px 0 0;font-size:12px;color:#94a3b8">Sent by WorkSpace · manage in Settings ▸ Notifications</p>` +
    `</div>`;
  return { to: [to], message: { subject, text: body, html } };
}

/**
 * Normalize a stored notifications profile into the channel view this function
 * reads — a trimmed mirror of the client's normalizeNotifySettings, covering the
 * NEW {master, …channels} shape, the OLD {enabled, email, …enabled} shape, and the
 * ANCIENT {leadMins, digest} shape, so legacy users keep getting closed-app
 * reminders without having to re-save their settings.
 */
function channelsView(settings) {
  const readCh = (raw, dflt) =>
    raw && typeof raw === 'object'
      ? {
          popup: typeof raw.popup === 'boolean' ? raw.popup : dflt.popup,
          gmail: typeof raw.gmail === 'boolean' ? raw.gmail : dflt.gmail,
        }
      : { ...dflt };

  // Config fields are named the same in every shape.
  const leads =
    settings.dueSoon && Array.isArray(settings.dueSoon.leads) && settings.dueSoon.leads.length
      ? settings.dueSoon.leads.filter((n) => typeof n === 'number')
      : typeof settings.leadMins === 'number'
        ? [settings.leadMins]
        : [60];
  const agHour = Number(settings.dailyAgenda && settings.dailyAgenda.hour) || 7;
  const agMinute = Number(settings.dailyAgenda && settings.dailyAgenda.minute) || 0;
  const tmHour = Number(settings.tomorrow && settings.tomorrow.hour) || 8;
  const tmMinute = Number(settings.tomorrow && settings.tomorrow.minute) || 0;

  if (settings.master) {
    // NEW shape — channels stored directly. (Any stored emailAddress is IGNORED:
    // the Gmail channel always targets the account's own Auth email — see below.)
    return {
      dueSoon: readCh(settings.dueSoon && settings.dueSoon.channels, { popup: true, gmail: false }),
      dailyAgenda: readCh(settings.dailyAgenda && settings.dailyAgenda.channels, { popup: true, gmail: false }),
      tomorrow: readCh(settings.tomorrow && settings.tomorrow.channels, { popup: false, gmail: false }),
      leads, agHour, agMinute, tmHour, tmMinute,
    };
  }

  // OLD shape — fold the hard gates ({enabled} master + email.enabled) into each
  // child, exactly like the client migration. Missing nodes take that era's default
  // enable, still gated, so an opted-out user can never migrate into reminders.
  const masterOn = !!settings.enabled;
  const em = settings.email || {};
  const emailOn = !!em.enabled;
  const mig = (node, defaultEnabled) => {
    const on = node ? !!node.enabled : defaultEnabled;
    return { popup: masterOn && on, gmail: emailOn && on };
  };
  const view = {
    dueSoon: mig(settings.dueSoon, true),
    dailyAgenda: mig(settings.dailyAgenda, true),
    tomorrow: mig(settings.tomorrow, false),
    leads, agHour, agMinute, tmHour, tmMinute,
  };
  // ANCIENT: digest (boolean, default true) was the daily agenda's enable.
  if (settings.digest === false && !settings.dailyAgenda) view.dailyAgenda = { popup: false, gmail: false };
  return view;
}

exports.sendReminders = onSchedule({ schedule: 'every 5 minutes', timeZone: TZ }, async () => {
  const db = admin.database();
  const fs = admin.firestore();
  const { today, minutes: nowMin } = nowInTz();
  const tomorrow = addDays(today, 1);
  // Day-offset lookup for cross-day due-soon leads: 'YYYY-MM-DD' → 0..MAX_LEAD_DAYS.
  const dayOffset = {};
  for (let i = 0; i <= MAX_LEAD_DAYS; i++) dayOffset[addDays(today, i)] = i;

  const usersSnap = await db.ref('users').get();
  if (!usersSnap.exists()) return;
  const users = usersSnap.val();

  for (const [uid, u] of Object.entries(users)) {
    const settings = u && u.profile && u.profile.notifications;
    if (!settings) continue;
    const view = channelsView(settings);

    // What can physically deliver: push needs an enrolled device token; email goes
    // ONLY to the account's own email, read from Firebase AUTH — never from the
    // user-writable profile, so notifications can't be aimed at someone else's
    // inbox. Looked up only when some gmail channel is actually on.
    const tokens = Object.keys((u.profile && u.profile.pushTokens) || {});
    const canPopup = tokens.length > 0;
    const anyGmail = view.dueSoon.gmail || view.dailyAgenda.gmail || view.tomorrow.gmail;
    const authEmail = anyGmail
      ? await admin.auth().getUser(uid).then((rec) => rec.email || null).catch(() => null)
      : null;
    const canGmail = !!authEmail;
    if (!canPopup && !canGmail) continue;

    const a = settings.appearance || { course: true, priority: false, dueTime: true };
    const anyOn = (ch) => !!(ch && (ch.popup || ch.gmail));
    const tasks = Object.values((u && u.tasks) || {});
    const ledger = (u && u.notifySent) || {};
    const updates = {}; // ledger writes (dedupe)
    const sends = []; // { title, body, popup, gmail }

    // Record a reminder once and queue it on the channels it resolves to (its own
    // channel × what can physically deliver).
    const fire = (key, title, body, ch) => {
      const popup = canPopup && !!(ch && ch.popup);
      const gmail = canGmail && !!(ch && ch.gmail);
      if (!popup && !gmail) return;
      if (ledger[key] || updates[key]) return;
      updates[key] = { at: Date.now() };
      sends.push({ title, body, popup, gmail });
    };

    // --- 1. due-soon reminders — one per selected lead, ACROSS DAYS (leads reach
    //     72h), within a 1h catch-up window. Minutes are measured from TODAY 00:00
    //     so a lead that crosses midnight still lands on its exact moment.
    if (anyOn(view.dueSoon) && view.leads.length) {
      for (const t of tasks) {
        if (!t || t.completed || !t.dueTime) continue;
        const off = dayOffset[t.dueDate];
        if (off === undefined) continue; // not due within the lead horizon
        const [h, m] = String(t.dueTime).split(':').map(Number);
        if (Number.isNaN(h) || Number.isNaN(m)) continue;
        const dueAbs = off * 1440 + h * 60 + m; // minutes from today 00:00
        for (const lead of view.leads) {
          const fireAbs = dueAbs - lead;
          if (nowMin < fireAbs || nowMin >= dueAbs) continue; // not yet, or already due
          if (nowMin - fireAbs > CATCHUP_MIN) continue; // missed by too much
          fire(`rem|${t.id}|${t.dueDate}|${t.dueTime}|${lead}`, `Due soon — ${t.title}`, reminderBody(t, lead, a, off === 0), view.dueSoon);
        }
      }
    }

    // --- 2. daily agenda — once per day at the chosen morning time
    if (anyOn(view.dailyAgenda)) {
      const dueToday = tasks.filter((t) => t && !t.completed && t.dueDate === today);
      if (dueToday.length && nowMin >= view.agHour * 60 + view.agMinute) {
        const n = dueToday.length;
        fire(`agenda|${today}`, `Good morning — ${n} task${n === 1 ? '' : 's'} due today`, 'Open WorkSpace to see them.', view.dailyAgenda);
      }
    }

    // --- 3. tomorrow preview — once per day at the chosen evening time (hour stored 5-11 = PM)
    if (anyOn(view.tomorrow)) {
      const dueTmr = tasks.filter((t) => t && !t.completed && t.dueDate === tomorrow);
      if (dueTmr.length && nowMin >= (view.tmHour + 12) * 60 + view.tmMinute) {
        const n = dueTmr.length;
        fire(`tomorrow|${today}`, `Heads-up — ${n} task${n === 1 ? '' : 's'} due tomorrow`, 'Open WorkSpace to plan ahead.', view.tomorrow);
      }
    }

    // --- ledger BEFORE send (at-most-once) + prune entries older than a week ----
    for (const [key, v] of Object.entries(ledger)) {
      if (v && v.at && Date.now() - v.at > LEDGER_KEEP_MS) updates[key] = null;
    }
    if (Object.keys(updates).length) await db.ref(`users/${uid}/notifySent`).update(updates);

    // --- deliver — each send only on the channels it resolved to -----------------
    for (const s of sends) {
      if (s.popup) {
        // PUSH: a DATA message so the SW controls the icon + click target.
        for (const token of tokens) {
          try {
            await admin.messaging().send({ token, data: { title: s.title, body: s.body } });
          } catch (err) {
            // Dead token (uninstalled / expired) → clean it up.
            const code = err && err.errorInfo && err.errorInfo.code;
            if (code === 'messaging/registration-token-not-registered') {
              await db.ref(`users/${uid}/profile/pushTokens/${token}`).remove().catch(() => {});
            }
          }
        }
      }
      if (s.gmail) {
        // EMAIL: queue via the Trigger Email extension — to the Auth account email.
        await fs.collection(MAIL_COLLECTION).add(mailDoc(authEmail, s.title, s.body)).catch(() => {});
      }
    }
  }
});
