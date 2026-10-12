---
name: landupdate
description: Bring the whole Cobalt landing page and hero demo ("Dan") up to date with the real app. Part 1 carries the changes just made into every place the landing hard-codes the app (what /land-integrate used to do). Part 2 then sweeps the ENTIRE landing (hero, feature cards, feature strip, word cloud, Cobalt vs Schoology table, demo scenes, mini-demos, copy) for anything outdated, and for new features worth adding to a section. Use when Gabe says /landupdate, /land-update, "land update", "update the landing", "scrape the landing", and also on the old triggers /land-integrate, "land integrate", "put this in the demo", "make sure the demo has this", or after finishing any change a user can see in Cobalt. Cobalt only.
---

# /landupdate — the landing shows today's Cobalt

Two parts, always both, in order. Part 1 is the change at hand; Part 2 is everything
else. (Part 1 is the former `/land-integrate`, merged in on 10/11/26.)

## Part 1 — integrate what just changed

The demo mounts the REAL views, so most changes carry over by themselves. What does
not carry over is everything the landing HARD-CODES. Walk that list for the change at
hand (or, with no argument, for everything changed this session) and fix each place
in the same pass.

### 1a. Know what changed

With an argument, that is the change. Without one, read the session's real diff
(`git diff` plus anything already committed today) and list each user-visible change
in one line: added, removed, renamed, moved, restyled.

### 1b. Walk every hard-coded surface, for EACH change

| Surface | File | What to check |
|---|---|---|
| Scene script | `app/src/landing/demo/script.ts` | Selectors, titles (`button[title="…"]`), menu labels, flows that changed shape. A REMOVED feature's beat comes out. A NEW feature worth showing gets a beat (ask Gabe if it is not obvious where). |
| Replica header | `app/src/landing/demo/shell.ts` | Top bar, tabs, icons. |
| Dan's data | `app/src/landing/demo/seed.ts` | Fields a new feature needs; dates; tasks a removed feature used. |
| Feature strip + word cloud | `app/src/landing/view.ts` (`FUNCTIONS`, the word list above it) | Add new features, drop removed ones, keep icons and order identical to the real row. |
| Replica task rows | `app/src/landing/view.ts` (the hand-built `.task-actions` cards) | Same buttons, same order, same icons as `renderTask` in `app/src/tasks/render.ts`. |
| Landing mini-demos | `app/src/landing/focusDemo.ts`, `app/src/landing/sandbox.ts`, `app/src/ui/landing.css` (`.lpf-*`, `.lp-*` replicas) | Any replica of a control that changed. |
| Landing copy | `app/src/landing/view.ts` (feature cards, sections, the Cobalt vs Schoology table and its footer line) | A sentence the change made FALSE, or a card that should now mention it. |

A feature that only exists for a connected account (Schoology API) or with real
services needs a **demo mode** in the real component (popup mounts in the demo host,
no server call), never a fake copy of the UI. See `openPhotoSubmit`'s `DemoOpts` in
`app/src/schoology/submitPhoto.ts` for the pattern.

## Part 2 — sweep the whole landing

Every run, not only when something changed: the landing drifts in ways no single
change reveals. The landing spans several large files, so hand the reading to ONE
sub-agent (Sonnet is enough) with this brief, then verify every finding against the
real file before repeating it.

**Brief for the sweep agent.** Read the whole landing (`app/src/landing/view.ts`,
`landing/demo/script.ts`, `demo/seed.ts`, `demo/shell.ts`, `focusDemo.ts`,
`sandbox.ts`) and, for every claim, control, replica and feature mention, check it
against the real app code. Report, each with file:line:
1. **Outdated:** a claim that is false now, a feature named that was removed or
   renamed, a replica that no longer matches the real control, a number that changed
   (track counts, prices, limits).
2. **Missing:** a real, shipped feature the landing never mentions, and the ONE
   section it fits best (feature card bullet, feature strip pill, word cloud, the
   Cobalt vs Schoology table, a demo beat).
3. **Inconsistent:** the same thing named two different ways across the landing.
   NOT the top menu: its labels ("Gamification", "Why Cobalt", "Try it"…) differ
   from their section headings ON PURPOSE (Gabe, 10/11). Never flag or change them.
Plain words, no code jargon. Only things that are true of the code today.

Known sources of truth to compare against: the app's tabs (`app/src/main.ts`),
the task row (`app/src/tasks/render.ts` `renderTask`), Focus (`app/src/focus/view.ts`),
the Shop (`app/src/store/`), Settings (`app/src/settings/view.ts`), the Schoology
features (`app/src/schoology/`).

## Who decides what (both parts)

- **Fix without asking:** anything mechanical that must match the app: replicas,
  selectors, icons, order, Dan's data, removed features' mentions, wrong numbers.
- **Propose, do not rewrite:** marketing copy (headlines, blurbs, the table's
  wording). Name the sentence, give the replacement, let Gabe pick. A small factual
  addition he asked for (e.g. one bullet) is fine to make.
- **Ask:** a new demo beat, a new section, or reordering a section.

## Standing rules (from `CLAUDE.md`, do not restate them elsewhere)

- The demo may never show something the real app does not do.
- No dead beats: the ghost cursor never parks doing nothing.
- Every new beat ASSERTS the app actually did the thing (`expect`, `waitUntil`), and
  sets a `beat('…')` marker.

## Verify and ship

1. `npx tsc --noEmit -p .` from `app/`.
2. Grep the built demo chunk (`dist/assets/script-*.js`) and the main bundle for each
   change, the same check the deploy section of `CLAUDE.md` describes.
3. Run `app/demosmoke.html` on the dev server; it must end in PASS. If the browser is
   unavailable, say so plainly in the done message: the smoke test was NOT run.
4. Deploy per `CLAUDE.md` and verify on `https://cobaltstudy.com`.
5. Ask Gabe whether to apply the changes to the landing artifacts (the standing
   question in `CLAUDE.md`, "The landing artifacts").

## Report

Numbered bullets: one per surface fixed (Part 1 and Part 2 fixes together), then the
proposals awaiting Gabe's pick (each: the sentence now, the replacement), then what
was not verified. Say how many sweep findings were dropped as false.
