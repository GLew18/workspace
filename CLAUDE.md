# Cobalt (Work Wave) — project rules

## Deploying (standing rule, Gabe 9/3/26)

**Any change a visitor can see ships to the live site in the same session, without being asked.** Gabe should never have to request a deploy for work that is already finished and verified.

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

**The real domain is `cobaltstudy.com`** — it is what the app displays everywhere a URL is shown. As of 9/3/26 it is registered at Namecheap but still points at their parking page; connecting it (Firebase Hosting custom domain + DNS) and adding it to Firebase Auth → Authorized domains are Gabe's to do. Until then, deploys land on the `.web.app` URL and that is the one to verify against.

## The landing demo

`app/src/landing/demo/` drives a real, miniature Cobalt in the hero. Two standing rules:
- **The demo may never show something the real app does not do.** Fabricated chrome is allowed only where the browser itself owns it (the mini player's Picture-in-Picture title bar) and must be labelled as such in the code.
- **No dead beats.** The ghost cursor never parks doing nothing.
