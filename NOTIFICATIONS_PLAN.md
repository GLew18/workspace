# WorkSpace — External Notifications (Design Draft)

> Proactively reach students **outside** the app — when the tab is closed — so nothing
> slips: new assignments surface, deadlines approach, and each day/week gets a heads-up.
> Helpful, never spammy, and fully under the student's control.

## Why this needs a server
Notifications have to fire when the app is **closed**, so an open tab can't do it. That
means a scheduled server job + a push service. This dovetails with the already-planned
Phase 2 **scheduled Cloud Function** (the background iCal importer): the same ~30-min job
that imports assignments can diff what's *new* and *due soon* and emit notifications.
(Needs Firebase **Blaze** — already enabled.)

## Delivery channels
1. **Web Push (primary)** — via Firebase Cloud Messaging (FCM) + the existing PWA service
   worker (`public/sw.js`). Works on desktop Chrome/Edge/Firefox and installed Android
   PWAs. On iOS, web push works **only for installed "Add to Home Screen" PWAs (iOS 16.4+)**,
   so we prompt iPhone users to install the app first.
2. **Email (fallback + digests)** — for anyone who declines push or is on an unsupported
   browser; ideal for the daily/weekly digest. Sent from the same Cloud Function via a
   transactional email API.
3. **SMS (later, opt-in)** — for critical "due in 1 hour" nudges. Costs money → gate behind
   explicit opt-in.

## Notification types (each independently toggleable)
1. **New assignment posted** — fires when the importer sees a task it hasn't seen before for
   this student. Batches several new items from one sync into one message.
   *"📥 3 new assignments — incl. 'Complete page 16' (Ivrit), due Fri."*
2. **Due soon** — configurable lead times (default 24h + 2h before due).
   *"⏰ Due tomorrow 9:00am — Read Ch. 7 & annotate (ELA)."*
3. **Daily digest (morning)** — one summary at a chosen time (default 7:30am).
   *"Good morning — 4 due today, 2 tomorrow. First up: …"*
4. **Weekly look-ahead (Sun evening)** — the week's schedule + big-ticket items, mirroring
   the dashboard "Schedule - Week of …" card.
5. **Overdue nudge** — gentle, once, the morning after something's missed. *Off by default*
   (some students find it stressful).
6. **Focus / streak (optional)** — *"You're on a 3-day focus streak 🔥"* or an end-of-day
   *"2 tasks left — want a 25-min focus session?"* Off by default.

## Architecture (fits the Firebase stack)
**Client (on opt-in):** request OS notification permission → get an FCM token → store it at
`users/{uid}/push/{tokenId}`. Add a `push` handler in `public/sw.js` that renders the
notification and routes clicks (deep-link straight to the task or schedule).

**Server (scheduled Cloud Function; ~30-min tick + a daily cron for digests):**
1. For each student with notifications on, run the existing import/diff.
2. Compute events: new task UIDs, tasks crossing a due-soon threshold, overdue, digest windows.
3. Respect per-type toggles, **quiet hours**, and the student's timezone.
4. Send via FCM and/or email; prune dead FCM tokens on send failure.

**State in Realtime Database:**
- `users/{uid}/notifPrefs` — toggles, lead times, quiet hours, digest time, channel prefs, timezone.
- `users/{uid}/notifLog` — a **dedupe ledger** (which task + threshold already fired) so a re-run
  never double-notifies.

## User controls (Settings → Notifications)
- Master on/off + per-type toggles.
- Due-soon lead times (24h / 2h / custom).
- Digest time + weekly look-ahead on/off.
- **Quiet hours** (e.g. 9pm–7am): never push during these — queue for the morning digest.
- Channel: push (this device) / email / both.
- Per-course mute ("don't notify me about Gym").
- A **"Send me a test notification"** button.

## Anti-spam principles (non-negotiable)
- **Batch** — collapse multiple same-type events from one sync into a single notification.
- **Dedupe** — never notify twice for the same task + threshold (the `notifLog` ledger).
- **Quiet hours** — hard rule; defer to the next allowed window.
- **Frequency cap** — at most N pushes/day; overflow rolls into the digest.
- **Easy off** — every notification (and the app) links straight to notification settings.

## Privacy / safety
- **Opt-in only** — nothing sends until the student enables it *and* grants OS permission.
- Store only what's needed (FCM token + prefs). Assignment content never leaves your infra
  except inside the notification the student asked for.
- FERPA: same posture as the app — data stays scoped to `users/{uid}`; a classmate's
  onboarding still needs the adult sign-off gate.

## Phased rollout
- **v1 (MVP):** Web Push for (a) *new assignment* and (b) *due-soon 24h*. Reuses the Phase 2
  importer, adds the `notifLog`, a minimal Settings panel, and the `sw.js` push handler.
- **v2:** Daily digest + weekly look-ahead + quiet hours + email fallback.
- **v3:** Overdue nudge, focus/streak, per-course mute, SMS (opt-in).

## What it needs from you
- **Firebase Blaze** (already set) — Cloud Functions + outbound FCM/email.
- Enable **Cloud Messaging** in the Firebase project; generate a **Web Push (VAPID)** key pair;
  add the public key to the client.
- (For email) a transactional email provider + API key — **server-side env only, never a
  `VITE_` variable** (those ship to the browser).
- A call on defaults. *Recommended:* New assignment **ON**, Due-soon 24h **ON**, morning digest
  7:30am **ON**, overdue **OFF**, quiet hours **9pm–7am**.
