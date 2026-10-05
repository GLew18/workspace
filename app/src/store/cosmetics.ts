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
import { playCheckoffById } from './checkoffEffects';
import { applyAccent } from './accents';

const PROFILE_KEY = 'cosmetics';

interface CosmeticsRecord {
  owned: string[];
  equippedGem?: string;
  equippedCheckoff?: string;
  /** Focus ring skin (store/ringSkins.ts). undefined = the standard ring. */
  equippedRing?: string;
  /** Accent color (store/accents.ts). undefined = Cobalt blue. */
  equippedAccent?: string;
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
  applyAccent(record.equippedAccent);
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
export function getEquippedRing(): string | undefined {
  return record.equippedRing;
}
export function getEquippedAccent(): string | undefined {
  return record.equippedAccent;
}

/** Equip/unequip a Focus ring skin. undefined = the standard ring. */
export async function equipRing(id: string | undefined): Promise<void> {
  record = { ...record, equippedRing: id };
  await persist();
}

/** Equip/unequip an accent color, applied app-wide at once. undefined = Cobalt blue. */
export async function equipAccent(id: string | undefined): Promise<void> {
  record = { ...record, equippedAccent: id };
  applyAccent(id);
  await persist();
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
 * 9/26). Plays on EVERY task, hand-typed ones included (Gabe, 10/4). Gems
 * stay gated to imported work; the animation is not.
 *
 * NOT wired into Focus's separate pre-session checklist (FocusTodo rows,
 * mirrored via FocusView.syncLinkedTasks) — that path has no single DOM row to
 * animate over. Gems still award there correctly (they run off the data
 * stream, not this), only the flourish is skipped on that one surface.
 */
export function playCheckoffEffect(row: HTMLElement, _task: Task): void {
  const id = record.equippedCheckoff;
  if (!id) return;
  // afterMove: the row re-draws at the bottom of its day first; play THERE.
  playCheckoffById(id, row, { afterMove: true }); // the effects themselves: store/checkoffEffects.ts
}
