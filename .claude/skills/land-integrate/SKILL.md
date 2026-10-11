---
name: land-integrate
description: Carry every Cobalt UI or behavior change into the landing page and the hero demo ("Dan"), so the landing never shows an older app than the real one. Use when Gabe says /land-integrate, "land integrate", "put this in the demo", "make sure the demo has this", or after finishing any change a user can see in Cobalt (toolbox, icons, popups, menus, new features, removed features, copy). Cobalt only.
---

# /land-integrate — the landing and the demo match the real app

The demo mounts the REAL views, so most changes carry over by themselves. What does
not carry over is everything the landing HARD-CODES. This skill walks that list for
the change at hand (or, with no argument, for everything changed this session) and
fixes each place in the same pass.

## 1. Know what changed

With an argument, that is the change. Without one, read the session's real diff
(`git diff` plus anything already committed today) and list each user-visible change
in one line: added, removed, renamed, moved, restyled.

## 2. Walk every hard-coded surface, for EACH change

| Surface | File | What to check |
|---|---|---|
| Scene script | `app/src/landing/demo/script.ts` | Selectors, titles (`button[title="…"]`), menu labels, flows that changed shape. A REMOVED feature's beat comes out. A NEW feature worth showing gets a beat (ask Gabe if it is not obvious where). |
| Replica header | `app/src/landing/demo/shell.ts` | Top bar, tabs, icons. |
| Dan's data | `app/src/landing/demo/seed.ts` | Fields a new feature needs; dates; tasks a removed feature used. |
| Feature strip + word cloud | `app/src/landing/view.ts` (`FUNCTIONS`, the word list above it) | Add new features, drop removed ones, keep icons and order identical to the real row. |
| Replica task rows | `app/src/landing/view.ts` (the hand-built `.task-actions` cards) | Same buttons, same order, same icons as `renderTask` in `app/src/tasks/render.ts`. |
| Landing mini-demos | `app/src/landing/focusDemo.ts`, `app/src/landing/sandbox.ts`, `app/src/ui/landing.css` (`.lpf-*`, `.lp-*` replicas) | Any replica of a control that changed. |
| Landing copy | `app/src/landing/view.ts` (sections, the Cobalt vs Schoology table and its footer line) | A sentence the change made FALSE. Do not rewrite marketing copy on your own: name the sentence and propose a replacement for Gabe. |

A feature that only exists for a connected account (Schoology API) or with real
services needs a **demo mode** in the real component (popup mounts in the demo host,
no server call), never a fake copy of the UI. See `openPhotoSubmit`'s `DemoOpts` in
`app/src/schoology/submitPhoto.ts` for the pattern.

## 3. Standing rules (from `CLAUDE.md`, do not restate them elsewhere)

- The demo may never show something the real app does not do.
- No dead beats: the ghost cursor never parks doing nothing.
- Every new beat ASSERTS the app actually did the thing (`expect`, `waitUntil`), and
  sets a `beat('…')` marker.

## 4. Verify and ship

1. `npx tsc --noEmit -p .` from `app/`.
2. Grep the built demo chunk (`dist/assets/script-*.js`) and the main bundle for each
   change, the same check the deploy section of `CLAUDE.md` describes.
3. Run `app/demosmoke.html` on the dev server; it must end in PASS. If the browser is
   unavailable, say so plainly in the done message: the smoke test was NOT run.
4. Deploy per `CLAUDE.md` and verify on `https://cobaltstudy.com`.

## 5. Report

Numbered bullets, one per surface touched, plus any landing sentence that is now
false (with the proposed replacement). Name what was not verified.
