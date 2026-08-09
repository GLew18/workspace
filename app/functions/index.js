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
// key. The client reads and writes THIS SAME node (src/notify/notify.ts
// attachLedger), so a reminder arrives at most once no matter which side sends it.
// It used to keep a separate localStorage ledger, which is why reminders arrived
// twice whenever a tab was open.
//
// TIMEZONE: dueDate/dueTime are the student's local wall time with no zone info.
// Every WorkSpace user is a Heschel student, so we evaluate in America/New_York.

const { onSchedule } = require('firebase-functions/v2/scheduler');
const admin = require('firebase-admin');

admin.initializeApp();

const TZ = 'America/New_York';
const LEDGER_KEEP_MS = 7 * 24 * 60 * 60 * 1000;
// (CATCHUP_MIN is gone: due-soon leads are WINDOWS now, not instants, so there is
// no exact moment for a cron run to miss and no grace period to need.)
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
/** Mirrors the client's reminderBody (src/notify/notify.ts) so the same task reads
 *  the same whether the app was open or closed.
 *  `remaining` is the ACTUAL minutes left, not the lead setting: a lead is a window
 *  now, so a 72h lead can fire on a task due in 36 hours, and printing "in 72 hours"
 *  there would simply be false. `untimed` tasks never show a clock, because that
 *  midnight is our convention, not something the user typed. */
function reminderBody(t, remaining, a, sameDay, untimed) {
  const parts = [];
  if (a.course && t.course) parts.push(t.course);
  if (a.priority && t.priority) parts.push(`${cap(t.priority)} priority`);
  if (a.dueTime) {
    const day = sameDay ? '' : weekdayOf(t.dueDate);
    const when = untimed ? day || 'today' : [day, fmt12h(t.dueTime)].filter(Boolean).join(' ');
    // An untimed task due today is past its own midnight, so a countdown would read
    // "in 0 minutes". The date alone says everything that's true.
    parts.push(remaining > 0 ? `Due ${when} (in ${leadLabel(remaining)})` : `Due ${when}`);
  } else {
    parts.push(remaining > 0 ? `Due in ${leadLabel(remaining)}` : 'Due today');
  }
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
    // VERIFIED ONLY (Gabe, 8/9). These emails carry TASK TITLES. If a student
    // typo'd their address at signup, an unverified send mails their assignments
    // to a stranger who never asked for them, and nothing would ever surface the
    // mistake. Verification is the only proof the inbox is actually theirs, so it
    // is a precondition for the gmail channel — not merely a nag in the UI.
    //
    // Pop-ups are unaffected: they go to an enrolled device, which is already
    // proof of possession.
    const tokens = Object.keys((u.profile && u.profile.pushTokens) || {});
    const canPopup = tokens.length > 0;
    const anyGmail = view.dueSoon.gmail || view.dailyAgenda.gmail || view.tomorrow.gmail;
    const rec = anyGmail
      ? await admin.auth().getUser(uid).then((r) => r).catch(() => null)
      : null;
    const authEmail = rec && rec.emailVerified ? rec.email || null : null;
    const canGmail = !!authEmail;
    if (!canPopup && !canGmail) continue;

    const a = settings.appearance || { course: true, priority: false, dueTime: true };
    const anyOn = (ch) => !!(ch && (ch.popup || ch.gmail));
    // Duplicates are excluded unless the user turned them on (default off, and an
    // absent field reads as off). Must match the client's scheduler.ts filter: if
    // only one side gated them, closing the app would change which reminders you
    // get. A copy carries the original's due date, so without this one deadline
    // reminds once per copy.
    const notifyDupes = (settings && settings.notifyDuplicates) === true;
    const tasks = Object.values((u && u.tasks) || {}).filter(
      (t) => t && (notifyDupes || !t._isDuplicate)
    );
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

    // --- 1. due-soon reminders. THE SAME RULE AS THE CLIENT (src/notify/scheduler.ts):
    //
    //   • A lead is a WINDOW, not an instant. "72 hours" means "72 hours or less
    //     away". Inside the window, it reminds.
    //   • When several enabled windows contain a task, only the SMALLEST fires, so
    //     two reminders never arrive together.
    //   • An untimed task is due at 00:00 of its due date, the midnight that BEGINS
    //     that day. It used to be skipped outright here (`!t.dueTime`), which is why
    //     an untimed task got no closed-app reminder at all.
    //   • ONE exception, same as the client: an untimed task due TODAY. Its midnight
    //     is already behind us, so by the letter of the rule it is "overdue" and
    //     would go silent, backwards for the task that matters most today. It stays
    //     in play and lands in the tightest enabled window.
    //
    // The window model also retires the old CATCHUP_MIN hack: firing at an exact
    // instant needed a grace period in case the cron missed that minute. A window
    // plus the ledger cannot miss, and still fires exactly once.
    if (anyOn(view.dueSoon) && view.leads.length) {
      const leads = [...view.leads].sort((x, y) => x - y); // tightest first
      for (const t of tasks) {
        if (!t || t.completed || !t.dueDate) continue;
        const off = dayOffset[t.dueDate];
        if (off === undefined) continue; // not due within the lead horizon
        const dueTime = String(t.dueTime || '');
        const untimed = !dueTime;
        let h = 0;
        let m = 0;
        if (!untimed) {
          [h, m] = dueTime.split(':').map(Number);
          if (Number.isNaN(h) || Number.isNaN(m)) continue; // malformed — never crash the loop
        }
        const dueAbs = off * 1440 + h * 60 + m; // minutes from today 00:00
        const remaining = dueAbs - nowMin;
        const dueTodayUntimed = untimed && off === 0;
        if (remaining <= 0 && !dueTodayUntimed) continue; // genuinely overdue → silent
        const lead = leads.find((l) => remaining <= l);
        if (lead === undefined) continue; // still outside every window
        // Ledger key must match the client's byte for byte — both write the SAME
        // ledger, and that shared key is what stops the two from double-sending.
        // Hence String(t.dueTime || ''): the client stores '' for untimed, and an
        // `undefined` here would stringify to "undefined" and miss the match.
        fire(
          `rem|${t.id}|${t.dueDate}|${dueTime}|${lead}`,
          `Due soon — ${t.title}`,
          reminderBody(t, remaining, a, off === 0, untimed),
          view.dueSoon
        );
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

// ---------------------------------------------------------------------------
// AUTH EMAILS — password reset + email verification, sent as WorkSpace.
//
// WHY THIS EXISTS: Firebase's built-in auth mailer sends from a shared,
// unbrandable sender, and those messages were landing in Gabe's spam while the
// reminder emails from the Trigger Email extension were landing in Primary. So
// auth mail now takes the SAME route as every other WorkSpace email: this
// generates the action link with the Admin SDK and writes a branded doc to the
// `mail` collection the extension already watches.
//
// ENUMERATION: this ALWAYS resolves {ok: true}, whether or not the address has an
// account. Reporting "no such user" would turn a public endpoint into a way to
// test which emails are registered.
//
// ABUSE: it is callable while signed out (a password reset has to be), so it is
// throttled per address in the database — see THROTTLE below. Without that it
// would be an open email-bombing endpoint.
// ---------------------------------------------------------------------------

const { onCall, HttpsError } = require('firebase-functions/v2/https');

const AUTH_MAIL_MIN_GAP_MS = 60_000; // one send per address per minute
const AUTH_MAIL_DAILY_CAP = 8; // and no more than this per address per day

// THE WORDMARK ICON: the gold computer standing in for the "o", from
// createWordmark() in src/ui/laurel.ts, rasterized to a 64px PNG because Gmail
// strips <svg> entirely.
//
// GABE IS HAND-TUNING THIS (8/9/26) — a fully flattened whole-wordmark image was
// tried and STILL didn't look right in his actual Gmail, despite matching in
// every check on this end (plain-browser render, pixel sampling). Rather than
// guess a third time, this reverted to real HTML text + a CSS-positioned icon,
// so HE can edit the numbers below and redeploy himself, watching his own inbox
// instead of relaying screenshots back and forth. THE CSS LIVES RIGHT HERE, in
// the wordmark `<div>` inside authMailDoc(), a few lines down: font-size,
// vertical-align, margin, width/height are all plain inline styles.
//
// Ships as an INLINE ATTACHMENT (cid:), not a hosted URL and not a data: URI.
// Gmail rewrites data: URIs away, and a hosted URL would need the app deployed
// AND survive image-blocking. A cid attachment travels inside the message, so it
// renders on first open with nothing to fetch.
const WORDMARK_O_B64 = require('fs')
  .readFileSync(require('path').join(__dirname, 'wordmark-o.b64'), 'utf8')
  .trim();

// FLAT WORDMARK (Gabe, 8/9). One image containing "W" + the computer + "rkSpace",
// instead of live text with the icon inlined between the letters.
//
// WHY: Gmail proxies and fetches the icon over the network, so the letters painted
// instantly and the computer popped in a beat later — the lockup visibly assembled
// itself in two pieces. A single image can't do that: it's either not there yet or
// fully there, which is how every other email logo behaves.
//
// It was composited FROM the split version's own measured geometry (same Segoe UI
// fallback Gmail actually uses, same 22px, same vertical-align:-8px, same margins),
// so it preserves the alignment we settled on rather than re-deriving it. Rendered
// at 2x for retina, displayed at 123x32.
//
// ── REVERT ──────────────────────────────────────────────────────────────────────
// Flip this to false and the split text+icon version comes back, untouched. Both
// assets stay on disk. Nothing else needs changing.
const WORDMARK_FLAT = true;
const WORDMARK_FULL_B64 = require('fs')
  .readFileSync(require('path').join(__dirname, 'wordmark-full.b64'), 'utf8')
  .trim();
const WORDMARK_FULL_W = 123;
const WORDMARK_FULL_H = 32;

/** The branded HTML both auth emails share. */
function authMailDoc(to, kind, link) {
  // THREE kinds, not two. 'reset' and 'set' send the SAME link and perform the
  // same action — Firebase has one "choose a password" flow — but they are worded
  // differently because they answer different questions:
  //
  //   reset  → "you have a password and want a new one"      (Forgot password?)
  //   set    → "you have NO password and want one"           (after the Google
  //            merge deleted it, or a Google-only account adding one)
  //
  // Calling the second one "Reset your password" was incoherent: it told someone
  // to reset a password that does not exist, and implied their current one was
  // about to change when there was nothing to change. Same mechanism, honest words.
  const isVerify = kind === 'verify';
  const isSet = kind === 'set';
  const subject = isVerify
    ? 'Verify your email for WorkSpace'
    : isSet
      ? 'Set your WorkSpace password'
      : 'Reset your WorkSpace password';
  const heading = isVerify ? 'Verify your email' : isSet ? 'Set a password' : 'Reset your password';
  const blurb = isVerify
    ? 'Tap the button to confirm this address so your password keeps working.'
    : isSet
      ? 'Your account signs in with Google and has no password yet. Tap the button to choose one, so you can sign in either way. The link works once and expires in an hour.'
      : 'Tap the button to choose a new password. The link works once and expires in an hour.';
  const cta = isVerify ? 'Verify email' : isSet ? 'Set password' : 'Reset password';
  const ignore = isVerify
    ? 'Didn’t sign up for WorkSpace? You can ignore this email.'
    : isSet
      ? 'Didn’t ask for this? Ignore this email — your account keeps working with Google exactly as it does now.'
      : 'Didn’t ask for this? Ignore this email and your password stays exactly as it is.';

  const text = `${heading}\n\n${blurb}\n\n${link}\n\n${ignore}\n\nWorkSpace`;
  const html =
    `<div style="font-family:system-ui,-apple-system,'Segoe UI',Roboto,sans-serif;background:#0b1220;padding:32px 16px">` +
    `<div style="max-width:480px;margin:0 auto;background:#111a2e;border:1px solid #22304d;border-radius:16px;padding:32px 28px">` +
    // The wordmark. ONE FLAT IMAGE by default; flip WORDMARK_FLAT (above) to false
    // to bring back live text with the icon inlined between the letters.
    //
    // GABE: if you go back to the split version, its CSS is in the `: ` branch
    // below. vertical-align on the img is the vertical nudge (NEGATIVE moves the
    // icon DOWN, currently -8px). Do NOT use `position:relative; top:` there —
    // Gmail strips `position` outright, the offset vanishes, and the icon jumps
    // back to baseline, which sits too high. That shipped once and looked worse
    // than the bug it was meant to fix. The asymmetric margin compensates for
    // Gmail substituting Segoe UI/Arial for Inter, whose W has a wider right
    // sidebearing.
    (WORDMARK_FLAT
      ? `<img src="cid:wsmark" width="${WORDMARK_FULL_W}" height="${WORDMARK_FULL_H}" alt="WorkSpace" ` +
        `style="display:block;width:${WORDMARK_FULL_W}px;height:${WORDMARK_FULL_H}px;margin:0 0 22px">`
      : `<div style="font-size:22px;font-weight:700;color:#ffffff;letter-spacing:-0.01em;margin:0 0 22px;white-space:nowrap">` +
        `W<img src="cid:wsmark" width="22" height="22" alt="o" ` +
        `style="width:22px;height:22px;vertical-align:-8px;margin:0 -0.44px 0 -0.22px;background:#111a2e">rkSpace</div>`) +
    `<h1 style="margin:0 0 10px;font-size:19px;font-weight:700;color:#f4f7ff">${heading}</h1>` +
    `<p style="margin:0 0 24px;font-size:15px;line-height:1.5;color:#9fb0cc">${blurb}</p>` +
    `<a href="${link}" style="display:inline-block;background:#e6a817;color:#1a1206;text-decoration:none;` +
    `font-weight:700;font-size:15px;padding:13px 26px;border-radius:10px">${cta}</a>` +
    `<p style="margin:24px 0 0;font-size:13px;line-height:1.5;color:#7b8aa6">${ignore}</p>` +
    `<p style="margin:18px 0 0;font-size:12px;color:#5d6b85;word-break:break-all">` +
    `Button not working? Paste this into your browser:<br>${link}</p>` +
    `</div></div>`;
  return {
    to: [to],
    message: {
      subject,
      text,
      html,
      attachments: [
        {
          filename: 'workspace.png',
          content: WORDMARK_FLAT ? WORDMARK_FULL_B64 : WORDMARK_O_B64,
          encoding: 'base64',
          cid: 'wsmark', // matches src="cid:wsmark" above
          contentDisposition: 'inline', // inline, so it isn't listed as a download
        },
      ],
    },
  };
}

/**
 * Per-address throttle, stored at authMailThrottle/{sha of email}. Keyed by a hash
 * so the node names never expose the address list.
 */
async function throttleOk(email) {
  const key = require('crypto').createHash('sha256').update(email).digest('hex').slice(0, 32);
  const ref = admin.database().ref(`authMailThrottle/${key}`);
  const now = Date.now();
  const snap = await ref.get();
  const cur = snap.val() || {};
  const today = new Date(now).toISOString().slice(0, 10);
  const count = cur.day === today ? Number(cur.count) || 0 : 0;
  if (cur.last && now - Number(cur.last) < AUTH_MAIL_MIN_GAP_MS) return false;
  if (count >= AUTH_MAIL_DAILY_CAP) return false;
  await ref.set({ last: now, day: today, count: count + 1 });
  return true;
}

exports.sendAuthEmail = onCall({ region: 'us-central1' }, async (req) => {
  const email = String((req.data && req.data.email) || '').trim().toLowerCase();
  const raw = req.data && req.data.kind;
  // 'set' shares reset's mechanism (same generated link) but its own wording.
  const kind = raw === 'verify' ? 'verify' : raw === 'set' ? 'set' : 'reset';
  if (!/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email)) {
    throw new HttpsError('invalid-argument', 'That doesn’t look like a valid email.');
  }
  // BOTH kinds are callable signed-out, and that is deliberate.
  //
  // `verify` used to require a signed-in caller matching the address. That was
  // stricter than the reset path right next to it — which is unauthenticated,
  // standard, and sends a far more sensitive email — and it broke a real case:
  // the very user this banner warns about. If a Google sign-in dropped their
  // unverified password credential, they may be UNABLE to sign in, and so unable
  // to reach the one button that would send them the verification mail.
  //
  // The protections that actually matter are unchanged and cover both kinds:
  //   • per-address throttle (1/min, 8/day) — no email bombing
  //   • existence check that reports success either way — no account enumeration
  //   • the mail only ever goes TO the address in question, never anywhere the
  //     caller chooses, so an attacker gains nothing by asking
  if (!(await throttleOk(email))) {
    throw new HttpsError('resource-exhausted', 'Too many requests. Wait a minute, then try again.');
  }

  // EXISTENCE CHECK FIRST, deliberately.
  //
  // generatePasswordResetLink does NOT report an unknown address as a not-found
  // error; it throws auth/internal-error ("Unable to create the email action
  // link"), which is indistinguishable from a genuine outage. An earlier version
  // matched on 'not-found' and so returned INTERNAL for unregistered addresses —
  // exactly the enumeration leak this is supposed to prevent. (Found by probing
  // the deployed endpoint, not by reading the code.)
  //
  // getUserByEmail throws a clean auth/user-not-found, so ask it instead.
  try {
    await admin.auth().getUserByEmail(email);
  } catch (err) {
    const code = String((err && (err.code || (err.errorInfo && err.errorInfo.code))) || '');
    if (code.includes('not-found')) return { ok: true }; // silent, claims success
    console.error('sendAuthEmail lookup failed', code, err && err.message);
    throw new HttpsError('internal', 'Couldn’t send that email. Try again in a moment.');
  }

  let link;
  try {
    link =
      kind === 'verify'
        ? await admin.auth().generateEmailVerificationLink(email)
        // 'reset' and 'set' are the same Firebase action — choosing a password.
        : await admin.auth().generatePasswordResetLink(email);
  } catch (err) {
    const code = String((err && (err.code || (err.errorInfo && err.errorInfo.code))) || '');
    console.error('sendAuthEmail failed', code, err && err.message);
    throw new HttpsError('internal', 'Couldn’t send that email. Try again in a moment.');
  }

  await admin.firestore().collection(MAIL_COLLECTION).add(authMailDoc(email, kind, link));
  return { ok: true };
});

// ---------------------------------------------------------------------------
// SCHOOLOGY iCAL FETCH — the server-side half of the calendar import.
//
// WHY THIS EXISTS: the client imports assignments by fetching the student's iCal
// feed directly in the browser. That works on localhost only because vite.config
// proxies /sgy → heschel.schoology.com in DEV. Schoology sends no
// Access-Control-Allow-Origin header, so from any deployed origin the browser
// blocks the request outright ("No 'Access-Control-Allow-Origin' header is
// present" — verified in a real browser, not assumed). Without this function,
// every import path breaks the moment the frontend is hosted: onboarding's
// Connect step, Settings' sync, the Dashboard button, Tasks' refresh, and the
// boot sync.
//
// Server-to-server requests aren't subject to CORS, which is the whole trick:
// the same fetch the browser is forbidden to make, we make here and hand back.
//
// THIS IS NOT A GENERAL URL FETCHER, and must never become one. An endpoint that
// fetches arbitrary URLs on request is an SSRF hole: it could be pointed at cloud
// metadata services (169.254.169.254), private network ranges, or used as an
// anonymous proxy. So it is locked down three ways:
//   1. signed-in callers only,
//   2. the URL must be an https Schoology calendar-feed URL — host is
//      schoology.com or a subdomain, path contains /calendar/feed/,
//   3. the response is capped, so a huge body can't be used to run up cost.
// ---------------------------------------------------------------------------

const ICAL_MAX_BYTES = 5 * 1024 * 1024; // a year of assignments is well under 1MB
const ICAL_TIMEOUT_MS = 20_000;

/** Mirrors isSchoologyIcalUrl in src/schoology/ical.ts, minus http:// — a server
 *  fetch has no excuse to leave TLS. Returns the normalized https URL, or null. */
function safeSchoologyIcalUrl(raw) {
  try {
    // webcal:// is what Schoology's Copy button hands out; it is https with the
    // scheme swapped as a hint to open a calendar app (see toHttps on the client).
    const u = new URL(String(raw || '').trim().replace(/^webcal:/i, 'https:'));
    if (u.protocol !== 'https:') return null;
    const host = u.hostname.toLowerCase();
    if (host !== 'schoology.com' && !host.endsWith('.schoology.com')) return null;
    if (!/\/calendar\/feed\//i.test(u.pathname)) return null;
    return u.toString();
  } catch {
    return null;
  }
}

exports.fetchSchoologyIcal = onCall({ region: 'us-central1' }, async (req) => {
  if (!req.auth) {
    throw new HttpsError('unauthenticated', 'Sign in first.');
  }
  const url = safeSchoologyIcalUrl(req.data && req.data.url);
  if (!url) {
    throw new HttpsError(
      'invalid-argument',
      'That is not a Schoology calendar link. It looks like webcal://<school>.schoology.com/calendar/feed/ical/…'
    );
  }

  let res;
  const ctl = new AbortController();
  const timer = setTimeout(() => ctl.abort(), ICAL_TIMEOUT_MS);
  try {
    res = await fetch(url, {
      signal: ctl.signal,
      redirect: 'follow',
      // Ask for the calendar, not the HTML page a browser would get.
      headers: { Accept: 'text/calendar, text/plain;q=0.9, */*;q=0.8' },
    });
  } catch (err) {
    clearTimeout(timer);
    console.error('fetchSchoologyIcal network failure', err && err.message);
    throw new HttpsError('unavailable', 'Couldn’t reach Schoology. Try again in a moment.');
  }
  clearTimeout(timer);

  if (!res.ok) {
    // Pass the status through: the client turns it into a sentence for the student.
    return { ok: false, status: res.status, text: '' };
  }

  const buf = Buffer.from(await res.arrayBuffer());
  if (buf.length > ICAL_MAX_BYTES) {
    throw new HttpsError('resource-exhausted', 'That calendar is unexpectedly large.');
  }
  // The BODY is returned as-is. Every judgement about it — is it iCal, is it the
  // "no events in this calendar" page, is it an HTML login page — stays on the
  // client in fetchIcal(), so both paths (dev proxy and this) produce identical
  // messages and there is exactly ONE place that decides what a feed means.
  return { ok: true, status: res.status, text: buf.toString('utf8') };
});
