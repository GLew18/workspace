# Cobalt (Work Wave) — project rules

## Deploying (standing rule, Gabe 9/3/26)

**Any change a visitor can see ships to the live site in the same session, without being asked.** Gabe should never have to request a deploy for work that is already finished and verified.

**Deploying is part of the change, not a follow-up (reinforced 9/24).** Gabe, verbatim: *"I should expect it to be deployed. Always deployed."* A done message for a visible change is only sent after the deploy has run and been verified on `https://cobaltstudy.com`, and it says so in one line. He should never have to open the site to find out whether it went out. This includes fixes made after an audit.

Run from `app/`, on either machine:

```bash
npm run build:deploy && firebase deploy --only hosting --project workspace-67029
```

**Per-machine setup this assumes.** The command itself is portable; what differs is only whether the two tools are reachable.
- **node/npm on PATH.** On the Mac they are not on the non-interactive PATH — prepend the location in `~/.claude/MACHINE.md` first (`export PATH="$HOME/.local/node/bin:$PATH"`). On the PC node is installed system-wide and is already on PATH; that `export` line is bash syntax and must not be pasted into PowerShell.
- **The Firebase CLI, logged in as Gabe.** Check with `firebase login:list` before assuming a deploy will work on a machine that has not deployed before; if it is missing, `npm i -g firebase-tools` then `firebase login` (interactive — Gabe has to do that one).

- `build:deploy` is `vite build` followed by `scripts/stage-music.mjs`, which copies the 151 focus tracks (~959 MB) into `dist/music-lib/`. **Never run `vite build` alone before a deploy** — the build empties `dist/`, and without the staging step every music URL falls through the SPA rewrite and the player receives `index.html` instead of an MP3.
- **`--only hosting`, always.** The Cloud Functions in `functions/` are deployed separately and deliberately; a bare `firebase deploy` would push whatever is sitting in that folder.
- Verify against the live site afterwards, not the local build: fetch `/`, read the hashed bundle name out of it, and grep that file for something the change actually introduced. The demo is a lazily loaded chunk (`assets/script-*.js`), so a landing-demo change will NOT appear in `assets/index-*.js`.

**Live URL:** `https://workspace-67029.web.app` (Firebase project `workspace-67029`).

**The real domain is `cobaltstudy.com`, and it is LIVE** (connected to Firebase Hosting 9/3/26; `www` redirects to it; `authDomain` is `cobaltstudy.com` since 9/4/26). It is what the app displays everywhere a URL is shown. Deploys land on both addresses at once; verify against `https://cobaltstudy.com`, the `.web.app` URL is only a fallback.

## Use the allowlisted scripts — never rebuild these commands inline

`.claude/scripts/` holds five shell scripts for the build and `dist/` chores that come up constantly. **Each one is already allowlisted in `.claude/settings.local.json`. Invoke the script; do not compose an equivalent command yourself.**

| Script | What it does |
|---|---|
| `clean-dist-rebuild-deploy.sh` | The main one. `cd app`, wipe `dist/`, `npm run build:deploy` into a log, print the exit code and the last 5 log lines. |
| `rebuild-dist-music-staging.sh` | Same rebuild with diagnostics: greps the previous log for `EPERM`/`error` first, then verifies `dist/music-lib` file count and that `dist/index.html` exists. Use when a build has been failing. |
| `remove-locked-dist-dir.sh` | Just `rm -rf dist`, nothing else. |
| `clear-locked-dist-assets.sh` | Removes only `dist/assets` and `dist/index.html`, **leaving `dist/music-lib` in place.** Use this instead of nuking `dist/` when the code changed but the music did not — it avoids re-staging ~959 MB. |
| `remove-music-lib-folder.sh` | Removes only `dist/music-lib`. |

Call them with an absolute path, which is what the allow rules match:

```bash
bash "C:/Users/jonle/Dropbox/Gabriel/AI Projects/Work Wave/.claude/scripts/clean-dist-rebuild-deploy.sh"
```

**Why this matters, and why a "better" inline version is always worse.** Every one of these is a compound command — `&&`, `;`, `$TEMP`, `rm -rf`. Claude Code statically parses a command to match it against allow rules and cannot verify what a variable or a later chained subcommand will do, so **no settings.json rule can ever suppress a compound command.** The rule matches the *invocation*, not the intent. Writing a fresh `cd app && rm -rf dist && npm run build:deploy ...` interrupts Gabe with a permission dialog even though a working, allowlisted script doing exactly that is sitting in the folder. This has already happened at least once. `rm` is also in Gabe's global **ask** list, which outranks allow, so any inline `rm` prompts regardless of what else is configured.

If one of these scripts is wrong or missing a case, **fix the script** and keep its path. Adding a sixth script means adding a sixth allow rule, which only Gabe can paste into `settings.local.json`.

Not yet covered: the `npm run build:deploy && firebase deploy --only hosting ...` line in the Deploying section above is itself compound and will prompt every time. Worth extracting if it becomes annoying.

## UI conventions

**Every input looks the same, app-wide (standing rule, Gabe 9/12/26).** Text inputs, textareas, and selects all get one look: the dark surface background, a quiet border, and the accent blue on focus. Never a native/white box, never a one-off color. The canonical recipe (also the app-wide default in `app/src/ui/theme.css`, so any field with no look-class of its own gets it automatically):
```css
background: var(--surface);
border: 1px solid var(--border);
border-radius: 10px;
color: var(--text);
/* :focus */
border-color: var(--accent);
box-shadow: 0 0 0 3px var(--gold-glow);
```
This came from the schedule quick-link paste box shipping with no look-class and rendering as a plain white textarea. When adding any new field, either give it that theme.css default for free (no look-class) or match it explicitly if the component needs its own class.

Same continuity rule already applies to every ✕ close/dismiss button (see `.dlg-close` in `app/src/ui/components.css`): rests on `var(--text-dim)`, hovers to `var(--text)`.

## The landing demo

`app/src/landing/demo/` drives a real, miniature Cobalt in the hero. Two standing rules:
- **The demo may never show something the real app does not do.** Fabricated chrome is allowed only where the browser itself owns it (the mini player's Picture-in-Picture title bar) and must be labelled as such in the code.
- **No dead beats.** The ghost cursor never parks doing nothing.
- **Every UI or behavior change reaches the demo in the same change (Gabe, 9/23).** The demo mounts the real views, so most changes carry over by themselves. What does NOT carry over is anything the demo hard-codes: the scripted scenes' selectors (`demo/script.ts`), the replica header (`demo/shell.ts`), Dan's seed data and dates (`demo/seed.ts`), and the landing marquee (`landing/view.ts` FUNCTIONS). Check all four on every UI change, then run `app/demosmoke.html` on the dev server; it must end in PASS. (In Claude's hidden browser pane it stops at the Focus time-wheel scene. Confirmed 9/24 as a pane limit, not a demo bug: a hidden page never delivers native scroll events, and the wheel only saves its value on one. With scroll events emulated, the full loop completes, and a virtual-clock run of all 10 scenes showed zero cursor jumps.)
