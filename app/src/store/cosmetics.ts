// Cobalt: Store — ownership, equip state, and the real effects an equipped
// item produces (not just its store-card preview).
//
// "It works both ways" (Gabe, 9/29/26): an item shows in its store container
// AND, once equipped, actually changes the app — the wordmark's gem, or what
// plays when a task is checked off. This module is the one source of truth
// both the Store screen and the real app read from.

import type { Data } from '../db';
import type { Task } from '../types';
import { spendGems } from '../gems/gems';

const PROFILE_KEY = 'cosmetics';

interface CosmeticsRecord {
  owned: string[];
  equippedGem?: string;
  equippedCheckoff?: string;
}

let data: Data | null = null;
let record: CosmeticsRecord = { owned: [] };
const subscribers = new Set<() => void>();

export function onCosmeticsChange(cb: () => void): () => void {
  subscribers.add(cb);
  return () => subscribers.delete(cb);
}

export async function initCosmetics(d: Data): Promise<void> {
  data = d;
  const stored = await d.getProfile<CosmeticsRecord>(PROFILE_KEY);
  record = stored ?? { owned: [] };
}

async function persist(): Promise<void> {
  if (data) await data.setProfile(PROFILE_KEY, record);
  subscribers.forEach((cb) => cb());
}

export function isOwned(id: string): boolean {
  return record.owned.includes(id);
}
export function getEquippedGem(): string | undefined {
  return record.equippedGem;
}
export function getEquippedCheckoff(): string | undefined {
  return record.equippedCheckoff;
}

/** Buys an item with Gems if not already owned. Returns false only when the
 *  balance can't cover it — never throws, so the store can just disable the
 *  button on a false rather than handle an exception. */
export async function purchaseItem(id: string, price: number): Promise<boolean> {
  if (record.owned.includes(id)) return true;
  if (!spendGems(price)) return false;
  record = { ...record, owned: [...record.owned, id] };
  await persist();
  return true;
}

/** Equip/unequip a Cobalt Gem Alternative. undefined = the default stone. */
export async function equipGem(id: string | undefined): Promise<void> {
  record = { ...record, equippedGem: id };
  await persist();
}

/** Equip/unequip a checkoff animation. undefined = none (silent, as today). */
export async function equipCheckoff(id: string | undefined): Promise<void> {
  record = { ...record, equippedCheckoff: id };
  await persist();
}

// --- the real effect: what actually plays when a task is checked off ------

/**
 * Called from the one shared checkbox click handler (tasks/render.ts
 * renderTask), which is the single code path for both the Tasks tab and any
 * embedded task row (including Focus's — see "Focus rows = real Tasks rows",
 * 9/26). Gated the same way Gems are (Task.source !== 'manual'): the effect is
 * part of the same real-homework incentive, so a hand-typed task doesn't get
 * the celebration either.
 *
 * NOT wired into Focus's separate pre-session checklist (FocusTodo rows,
 * mirrored via FocusView.syncLinkedTasks) — that path has no single DOM row to
 * animate over. Gems still award there correctly (they run off the data
 * stream, not this), only the flourish is skipped on that one surface.
 */
export function playCheckoffEffect(row: HTMLElement, task: Task): void {
  if (task.source === 'manual') return;
  const id = record.equippedCheckoff;
  if (!id) return;
  switch (id) {
    case 'confetti':
      return playConfetti(row);
    case 'goldflash':
      return playGoldFlash(row);
    case 'gemburst':
      return playGemBurst(row);
    case 'smokepuff':
      return playSmokePuff(row);
    case 'lightsweep':
      return playLightSweep(row);
    case 'starburst':
      return playStarburstPulse(row);
    case 'ripple':
      return playRipple(row);
  }
}

/**
 * Clones `row`'s current rendered look into a fixed-position overlay sitting
 * exactly on top of it, appended to <body>. THE REAL BUG BEHIND GOLD FLASH
 * "NOT WORKING" (Gabe, 10/1/26): checking off a task re-renders the list IN
 * PLACE and re-sorts the row to the bottom of its day group (tasks/render.ts
 * toggleDone, the 9/26 redesign) — that re-render replaces the row's DOM node
 * almost immediately. An effect that mutates the live row directly (adding a
 * class, animating its filter) was getting its target element destroyed
 * mid-animation and was never actually seen. Every OTHER checkoff effect
 * (Confetti, Gem Burst, Smoke Puff, Starburst, Ripple) was already immune to
 * this because they spawn independent elements rather than touching the row —
 * this gives the two row-mutating effects the same immunity.
 */
function cloneRowOverlay(row: HTMLElement): HTMLElement {
  const r = row.getBoundingClientRect();
  const clone = row.cloneNode(true) as HTMLElement;
  clone.classList.add('gems-row-clone');
  clone.style.cssText = `position:fixed;left:${r.left}px;top:${r.top}px;width:${r.width}px;height:${r.height}px;margin:0;`;
  document.body.append(clone);
  return clone;
}

/**
 * The WHOLE row turns gold — background, text, icons, everything — holds,
 * shakes, then fades back (Gabe, 9/30/26: "not just a small flash... pretty
 * dramatic and cool"). A CSS `filter` on the row is what makes the text turn
 * gold too, not just a tint sitting on top of it — applied to a clone now,
 * not the live row (see cloneRowOverlay).
 */
function playGoldFlash(row: HTMLElement): void {
  const clone = cloneRowOverlay(row);
  clone.classList.add('gems-goldflash-row');
  clone.addEventListener('animationend', () => clone.remove());
  setTimeout(() => clone.remove(), 1400); // reduced-motion never fires animationend — don't leak the clone
}

/** Shared setup for every particle-burst effect: a zero-size anchor div
 *  centered on `anchorEl`, appended to <body> (so particles can fly outside
 *  the row's own bounds without being clipped by a scrolling list),
 *  auto-removed after `life` ms. The caller fills it with whatever particles
 *  it wants. Callers pass either the whole row (Confetti, Gem Burst, Smoke
 *  Puff — never described as coming from one specific spot) or the checkbox
 *  itself (Starburst Pulse, Ripple — a visual-audit pass on 10/1/26 found
 *  both centering on the row instead of "from the checkbox" as described). */
function burstAnchor(anchorEl: HTMLElement, className: string, life: number): HTMLElement {
  const r = anchorEl.getBoundingClientRect();
  const burst = document.createElement('div');
  burst.className = className;
  burst.style.cssText = `left:${(r.left + r.width / 2).toFixed(1)}px;top:${(r.top + r.height / 2).toFixed(1)}px;`;
  document.body.append(burst);
  setTimeout(() => burst.remove(), life);
  return burst;
}

/** The checkbox inside a task row, if findable — falls back to the row itself
 *  so a markup change elsewhere can't make these effects throw. */
function checkboxOf(row: HTMLElement): HTMLElement {
  return row.querySelector<HTMLElement>('.task-cb') ?? row;
}

const CONFETTI_COLORS = ['#7db4ff', '#ffd25b', '#ff6f91', '#6ee7a0', '#c792ff'];

function playConfetti(row: HTMLElement): void {
  const burst = burstAnchor(row, 'gems-confetti-burst', 900);
  for (let i = 0; i < 16; i++) {
    const piece = document.createElement('span');
    piece.className = 'gems-confetti-piece';
    const angle = Math.random() * 360 - 180;
    const dist = 40 + Math.random() * 55;
    const rad = (angle * Math.PI) / 180;
    piece.style.setProperty('--dx', `${(Math.cos(rad) * dist).toFixed(1)}px`);
    piece.style.setProperty('--dy', `${(Math.sin(rad) * dist - 18).toFixed(1)}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 480 - 240)}deg`);
    piece.style.background = CONFETTI_COLORS[i % CONFETTI_COLORS.length];
    piece.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;
    burst.append(piece);
  }
}

const GEM_BURST_COLORS = ['#7db4ff', '#9ad8ff', '#5a9bef', '#c3e6ff'];

/** The task "turns into currency" (Gabe, 9/30/26's own idea): small diamond
 *  shapes fly outward in brand blue, same physics as Confetti. */
function playGemBurst(row: HTMLElement): void {
  const burst = burstAnchor(row, 'gems-confetti-burst', 900);
  for (let i = 0; i < 14; i++) {
    const piece = document.createElement('span');
    piece.className = 'gems-gemburst-piece';
    const angle = Math.random() * 360 - 180;
    const dist = 35 + Math.random() * 50;
    const rad = (angle * Math.PI) / 180;
    piece.style.setProperty('--dx', `${(Math.cos(rad) * dist).toFixed(1)}px`);
    piece.style.setProperty('--dy', `${(Math.sin(rad) * dist - 16).toFixed(1)}px`);
    piece.style.setProperty('--rot', `${Math.round(Math.random() * 360 - 180)}deg`);
    piece.style.background = GEM_BURST_COLORS[i % GEM_BURST_COLORS.length];
    piece.style.animationDelay = `${Math.round(Math.random() * 60)}ms`;
    burst.append(piece);
  }
}

/** A few soft gray puffs rise and dissipate, like the task vanished in smoke. */
function playSmokePuff(row: HTMLElement): void {
  const burst = burstAnchor(row, 'gems-confetti-burst', 1200);
  for (let i = 0; i < 6; i++) {
    const puff = document.createElement('span');
    puff.className = 'gems-smoke-puff';
    const dx = Math.round(Math.random() * 50 - 25);
    const size = 14 + Math.round(Math.random() * 16);
    puff.style.setProperty('--dx', `${dx}px`);
    puff.style.width = `${size}px`;
    puff.style.height = `${size}px`;
    puff.style.marginLeft = `${-size / 2}px`;
    puff.style.marginTop = `${-size / 2}px`;
    puff.style.animationDelay = `${Math.round(Math.random() * 120)}ms`;
    burst.append(puff);
  }
}

/** One bright diagonal light bar sweeps across the row once, with a soft glow
 *  halo at the checkbox end — same clone technique as Gold Flash, same bug it
 *  was equally vulnerable to. */
function playLightSweep(row: HTMLElement): void {
  const clone = cloneRowOverlay(row);
  clone.classList.add('gems-lightsweep-row');
  clone.addEventListener('animationend', () => clone.remove());
  setTimeout(() => clone.remove(), 1200); // reduced-motion never fires animationend — don't leak the clone
}

/** A quick radial pop of light rays from the checkbox — punchier and faster
 *  than Light Sweep, like a tiny camera flash. */
function playStarburstPulse(row: HTMLElement): void {
  const burst = burstAnchor(checkboxOf(row), 'gems-starburst-burst', 500);
  for (let i = 0; i < 10; i++) {
    const ray = document.createElement('span');
    ray.className = 'gems-starburst-ray';
    ray.style.setProperty('--angle', `${Math.round((i / 10) * 360)}deg`);
    ray.style.animationDelay = `${Math.round(Math.random() * 40)}ms`;
    burst.append(ray);
  }
}

/** A soft ring expands outward from the checkbox and fades, like a drop in
 *  water — calmer than the others on purpose (Gabe, 9/30/26's draft list). */
function playRipple(row: HTMLElement): void {
  const burst = burstAnchor(checkboxOf(row), 'gems-ripple-burst', 700);
  const ring = document.createElement('span');
  ring.className = 'gems-ripple-ring';
  burst.append(ring);
}
