# WorkSpace — v1 Build Plan

> Productivity space that makes work more convenient and fun.
> Multi-user Tasks + Focus app. Derived from the StudyFlow spec; **product name is WorkSpace**.

## Confirmed decisions (from Gabe)
- **Build now:** plan first, then code on approval.
- **Stack:** Vite + vanilla TypeScript (modular, multi-file). Firebase JS SDK v9 (modular). PWA.
- **Auth:** Google sign-in only.
- **AI features:** kept in v1 (emoji-picking / small niceties) via a serverless proxy — never ships the key client-side.

## Progress
- ✅ **Dashboard tab** (default landing) — time-aware greeting, full daily-rotating stoic quote set (with author), the daily lightbulb, and a live "tasks due today" box.
- ✅ **Lightbulb logo** (`app/src/ui/bulb.ts`) — minimalist bulb in the header and on the Dashboard; brightness tracks the share of TODAY's tasks completed (dim at 0%, luminescent at 100%). Empty day = fully lit. Richer animation deferred to the styling pass. Completed tasks are now retained for the day (hidden from lists) so the bulb can measure progress, and auto-purged once the day rolls over.
- ✅ **Due-state colors** — overdue & today headers/badges are red; tomorrow is orange.
- ✅ **Phase 0** — Vite+TS scaffold, dark Inter design system, tab shell, auth gate (Google in Firebase mode / named local profiles otherwise), per-uid data layer with anti-wipe guard + rolling backups, security rules.
- ✅ **Phase 1** — Task engine: NL parser, 5 priorities, course colors + fuzzy normalize, attachments, day grouping/badges, complete-with-undo. *Verified live.*
- ✅ **Phase 4** — Focus sessions: wall-clock timer + ring, crash-safe persistence + boot-restore, YouTube music engine, draggable floating widget, Import Tasks with two-way task↔todo completion linkage. *Verified live.*
- 🟡 **Phase 2** (Schoology iCal import) — **client-side import built & verified** against Gabe's real Heschel feed. Preferences screen (courses/colors/parse-words with conflict block + Schoology link + Sync now), iCal parser (deep-links, descriptions→details, quiz/test events), 3-layer course tagger (parse-word rules + AI stub + "Help our AI" learning), bulk import, on-open auto-sync, 2-week import window, dashboard "This Week's Schedule" card. *Remaining:* move the same parse/tag pipeline into a scheduled Cloud Function for the 30-min background sync (needs Firebase Blaze), and wire the AI layer to a real `/api/ask-claude` proxy + key.
- Phase 3 (extension) and Phases 5–6 remain as planned.

### Verified Schoology feed facts (Heschel, from Gabe's real iCal)
- District **allows** the personal iCal feed (200 OK, ~817 events).
- Each event has `URL` → **direct deep-link** to the exact assignment (Tier 1). `http→https` upgraded on import.
- `DESCRIPTION` carries full assignment instructions → imported into `task.details` (ⓘ button).
- **No course/teacher/room fields exist** — course is recovered by the 3-layer tagger, not parsed.
- Two event types: `/assignment/<id>` (→ tasks) and `/event/<id>/profile` (→ tasks only if title matches quiz/test/exam/midterm/final; "Schedule - Week of…" → dashboard card).
- Dev CORS bypass: Vite proxies `/sgy` → `https://heschel.schoology.com` (single-school v1).

### v1 refinements (from Gabe's feedback, applied)
- AI/custom emojis live **only on music tracks**, not tasks. Task titles are plain text.
- Removed the example hint under the quick-add box.
- Removed the `t:` free-text time-label syntax entirely.
- Removed the pencil button — **double-click** any task component (title/time/date/course) to edit.
- Task due-info and action icons share **one line**.
- A Schoology launch button appears in a task's actions when it has a Schoology URL (imported tasks).
- Time editing shows/parses friendly **12-hour** time (never army time); accepts `230pm`, `6:30 am`, `1430`, etc.

## Next up (agreed with Gabe, July 2026)
1. **Focus song database** — a proper shared library of focus tracks for the Focus music engine, beyond the hand-seeded list.
2. **Onboarding plan** — design the full new-user funnel (the post-sign-in card is already merged to one screen; plan what a brand-new student sees and does first).
3. **Notifications** — build external notifications for new assignments, upcoming due dates, and more, per `NOTIFICATIONS_PLAN.md`.
4. **Premium tier** — after the above ship, define the paid tier and decide what falls behind the price gate (keyboard shortcuts are already earmarked premium).

## Still open (won't block starting; decide before the phase that needs it)
- **Hosting/domain:** Netlify vs Firebase Hosting; what domain. *(Needed before Phase 2 deploy.)*
- **Focus-lock windows / 7:20 wake (§7.6):** recommend opt-in, later phase.
- **Import Schoology completion state:** original ignores it — recommend we ignore it too in v1.
- **Teacher/adult sign-off** before any non-Gabe classmate's data lands in the DB (FERPA). Product gate, not a code gate.

---

## What I need from you, and when
| When | I need | Why |
|---|---|---|
| Start of Phase 0 | A Firebase project + its web config (apiKey, authDomain, databaseURL, projectId, etc.), Google sign-in enabled in Auth | Can't connect to a real backend without it. I'll scaffold against `.env` placeholders so the app builds before you paste real values. |
| Phase 2 | Firebase **Blaze** (pay-as-you-go) plan + your own Schoology iCal link | Scheduled function needs outbound fetch + Admin SDK; your link is the first test fixture. |
| AI (any phase) | An Anthropic API key (goes in serverless env, never client) | Powers emoji-picking via the proxy. |
| Phase 2 | Hosting/domain pick | To deploy the scheduled importer + app. |

Until you provide Firebase config, **everything runs locally against an in-memory/localStorage store** so you can play with Tasks + Focus immediately. Firebase is a swap-in behind `db.ts`, not a rewrite.

---

## Repo layout
```
work-wave/
  app/
    index.html
    package.json  vite.config.ts  tsconfig.json  .env.example
    public/manifest.webmanifest  public/icons/...
    src/
      main.ts                 # boot: firebase init, auth gate, mount tabs
      firebase.ts             # SDK init from env; export auth + db
      auth.ts                 # Google sign-in/out, onAuthStateChanged, current uid
      db.ts                   # per-uid refs, scoped read/write, anti-wipe guard, self-echo suppression
      backup.ts               # localStorage rolling backups (14 snapshots, ~4MB cap, restore())
      store-local.ts          # in-memory/localStorage backend used until Firebase config is provided
      types.ts                # Task, Note, FocusState, Profile
      util/{ids,dates,dom}.ts # genId, dateHash | formatDate/todayStr/parse helpers | small DOM helpers
      courses/{maps,normalize}.ts   # COURSE_COLORS/ABBR/TABGROUP + normalizeCourse/getCourseColor/levenshtein
      tasks/
        parser.ts             # natural-language quick-add (the big one) + parseShortDate + parseTimeOrLabel
        priorities.ts         # 5 levels, arrows, colors, sort weights
        store.ts              # task CRUD (scoped child writes), dedup, _manual* edit-protection
        attachments.ts        # notes model, detectAttachmentType, open-as-tab-group / mobile rewrites
        render.ts             # list render, day grouping, due badges, super-task collapse
        quickadd.ts           # input handling, tryAddTask, submit guard (no past dates)
        complete.ts           # complete-with-undo, sound, animation
        emoji.ts              # AI emoji niceties via /api/ask-claude (with spend cap)
      focus/
        timer.ts              # end-timestamp ticker (wall-clock), pre-armed AudioContext
        session.ts            # lifecycle: setup -> start -> complete/end, stats toast
        persist.ts            # focus:state:v1 crash-safe localStorage (per-device)
        music.ts              # YouTube IFrame engine: muted-autoplay trick, auto-advance, in-place swap
        link.ts               # session todo <-> task completion linkage (Import Tasks)
        render.ts             # full-screen overlay + draggable floating widget
      ui/{tabs.ts,theme.css,components.css}   # tab nav + goToTab; dark Inter design system (verbatim palette)
  functions/
    import-ical.ts            # scheduled: fetch each user's ICS -> tasks via Admin SDK (PRIMARY import)
    ask-claude.ts             # Anthropic proxy (origin allow-list, Haiku default, validates messages)
  extension/                  # Phase 3, OPTIONAL — scaffolded empty for now
  firebase.rules.json
  README.md
  BUILD_PLAN.md               # this file
```

---

## Phased roadmap

### Phase 0 — Foundations
- Vite + TS project; PWA manifest + service worker; dark Inter design system (verbatim `:root` palette, `.app` mobile-first column, tab shell with `goToTab`).
- `firebase.ts` (env-driven), `auth.ts` (Google sign-in gate), `db.ts` with **per-uid refs** + **anti-wipe guard** + **self-echo suppression**, `backup.ts` rolling backups.
- `store-local.ts` so the app is fully usable before real Firebase config lands.
- **Security rules** (`firebase.rules.json`): only `auth.uid === $uid` can R/W `users/{uid}`.
- **Done when:** app loads, signs in (or local-stub), shows empty Tasks + Focus tabs, two stub accounts stay isolated.

### Phase 1 — Task engine (manual only) — *the bulk of the work*
- Data model (§6.1), full natural-language parser (§6.2: time-labels `t:`, day map, priority tokens, time formats, dates, course matching), priorities (§6.3), course maps + fuzzy normalize (§6.4 / Appendix 13.1), attachments (§6.5), rendering + due badges + day grouping + super-task collapse + complete-with-undo (§6.6).
- AI emoji niceties wired but degrade gracefully if no key.
- **Done when:** Work Wave is a usable standalone task app; parser matches spec examples; two accounts verified isolated.

### Phase 2 — Schoology import via calendar feed (PRIMARY)
- Onboarding: "paste your Schoology calendar link" → `users/{uid}/profile/schoologyIcalUrl` (stored server-side, secret).
- Scheduled serverless `import-ical.ts`: fetch each `.ics`, parse VEVENTs (node-ical), map → tasks, dedup by `UID` (`ical_<UID>`), respect `_manual*`, write via Admin SDK.
- Graceful handling of expired link / sharing disabled / empty calendar.
- **Done when:** your assignments auto-appear; re-sync respects your manual edits; tested with you + 2–3 classmates (after sign-off).

### Phase 3 — (OPTIONAL) Chrome extension — richer data on personal computers
- MV3, dynamic Schoology user-id detection (`/v1/app-user-info`, no hardcoded id), `schoolDomain` param, token handoff (§4.3), authenticated per-user writes. Power-user bonus; deferred.

### Phase 4 — Focus sessions
- Wall-clock end-timestamp timer + pre-armed AudioContext (§8.2), crash-safe persistence (§8.3), YouTube music engine (§8.4), task linkage with **Import Tasks** (drop Import Habits, §8.5), full-screen overlay + floating widget.
- **Done when:** a session survives tab-switch/refresh, music auto-advances, completing a session todo checks off its linked task.

### Phase 5 — Polish & extras
- Sync alarms, optional focus-lock windows (opt-in), analytics/streaks, PWA install, onboarding, AI spend cap.

### Phase 6 — (Later) Multi-school
- Per-school course/color config keyed by `schoolDomain`; broaden host matches. (v1 assumes one school catalog, per spec.)

---

## Non-negotiable safety (ported before anyone but Gabe onboards)
1. Real Firebase Auth + per-uid security rules — the only thing isolating students.
2. Anti-wipe guard: refuse to render-then-write if remote looks empty but localStorage says this user had data; offer restore.
3. Rolling localStorage backups (never auto-writes to DB except explicit restore).
4. Scoped child writes (`users/{uid}/tasks/{id}`), not whole-object `set()`.
5. **Never** store a Schoology/Google password — calendar link or OAuth only.

---

## Proposed first coding step (on approval)
Phase 0 scaffold + Phase 1 Tasks engine running locally (no Firebase needed yet), so you can type `mow the lawn tom 630am misc` and watch it parse. Then we wire Firebase once you hand me the config.
