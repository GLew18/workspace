// Cobalt: the Gems store.
//
// "It works both ways" (Gabe, 9/29/26): every item shows here in its own
// container — a picture, a name, a price — AND, once bought and equipped,
// actually changes the real app (the wordmark's gem, or what plays when a
// task is checked off). This screen only ever reads/writes through
// gems/gems.ts and store/cosmetics.ts, which are the real source of truth.

import type { Data } from '../db';
import { el } from '../util/dom';
import { getGemsBalance, onGemsChange } from '../gems/gems';
import {
  isOwned,
  getEquippedGem,
  getEquippedCheckoff,
  purchaseItem,
  equipGem,
  equipCheckoff,
  onCosmeticsChange,
} from '../store/cosmetics';
import { STONE_SVG } from '../ui/laurel';
import { GEM_ALTS, type GemAlt } from './gemArt';
import { CHECKOFF_EFFECTS, type CheckoffEffect } from './checkoffArt';

const NONE_CHECKOFF_SVG =
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
  `<circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="4" opacity="0.35"/>` +
  `<line x1="26" y1="26" x2="74" y2="74" stroke="currentColor" stroke-width="4" opacity="0.35"/>` +
  `</svg>`;

export class StoreView {
  private data: Data;
  private unsubGems?: () => void;
  private unsubCosmetics?: () => void;
  private panel?: HTMLElement;

  constructor(data: Data) {
    this.data = data;
  }

  async mount(panel: HTMLElement): Promise<void> {
    void this.data; // no per-user data lives here beyond gems/cosmetics, already loaded at boot
    this.panel = panel;
    this.unsubGems?.();
    this.unsubCosmetics?.();
    this.unsubGems = onGemsChange(() => this.paint());
    this.unsubCosmetics = onCosmeticsChange(() => this.paint());
    this.paint();
  }

  private paint(): void {
    const panel = this.panel;
    if (!panel) return;
    panel.replaceChildren();

    const wrap = el('div', { class: 'store-view' });
    const balance = getGemsBalance();

    const balanceRow = el('div', { class: 'store-balance' });
    const icon = el('span', { class: 'store-balance-icon' });
    icon.innerHTML = STONE_SVG;
    balanceRow.append(
      icon,
      el('span', { class: 'store-balance-count', text: String(balance) }),
      el('span', { class: 'store-balance-label', text: 'Gems' })
    );
    wrap.append(balanceRow);

    wrap.append(this.gemSection(balance));
    wrap.append(this.checkoffSection(balance));
    wrap.append(this.badgesSection());

    panel.append(wrap);
  }

  // --- Cobalt Gem Alternatives ---------------------------------------------

  private gemSection(balance: number): HTMLElement {
    const equipped = getEquippedGem();
    const grid = el('div', { class: 'store-grid' });
    grid.append(
      this.card({
        icon: STONE_SVG,
        name: 'Default',
        price: 0,
        owned: true,
        equipped: !equipped,
        canAfford: true,
        onBuyOrEquip: () => void equipGem(undefined),
      })
    );
    for (const g of GEM_ALTS) grid.append(this.gemCard(g, equipped, balance));
    return this.section('Cobalt Gem Alternatives', grid);
  }

  private gemCard(g: GemAlt, equipped: string | undefined, balance: number): HTMLElement {
    const owned = isOwned(g.id);
    return this.card({
      icon: g.svg,
      name: g.name,
      price: g.price,
      owned,
      equipped: equipped === g.id,
      canAfford: balance >= g.price,
      onBuyOrEquip: async () => {
        if (owned) void equipGem(g.id);
        else if (await purchaseItem(g.id, g.price)) void equipGem(g.id);
      },
    });
  }

  // --- Checkoff Animations ---------------------------------------------

  private checkoffSection(balance: number): HTMLElement {
    const equipped = getEquippedCheckoff();
    const grid = el('div', { class: 'store-grid' });
    grid.append(
      this.card({
        icon: NONE_CHECKOFF_SVG,
        name: 'None',
        price: 0,
        owned: true,
        equipped: !equipped,
        canAfford: true,
        onBuyOrEquip: () => void equipCheckoff(undefined),
      })
    );
    for (const e of CHECKOFF_EFFECTS) grid.append(this.checkoffCard(e, equipped, balance));
    return this.section('Checkoff Animations', grid);
  }

  private checkoffCard(e: CheckoffEffect, equipped: string | undefined, balance: number): HTMLElement {
    const owned = isOwned(e.id);
    return this.card({
      icon: e.svg,
      name: e.name,
      price: e.price,
      owned,
      equipped: equipped === e.id,
      canAfford: balance >= e.price,
      onBuyOrEquip: async () => {
        if (owned) void equipCheckoff(e.id);
        else if (await purchaseItem(e.id, e.price)) void equipCheckoff(e.id);
      },
    });
  }

  // --- Badges (empty for now) ----------------------------------------------

  private badgesSection(): HTMLElement {
    return this.section(
      'Badges',
      el('div', {
        class: 'store-empty',
        text: 'Badges are on the way — achievements for things you do in Cobalt, not Gems you spend.',
      })
    );
  }

  // --- shared card + section chrome ----------------------------------------

  private section(title: string, body: HTMLElement): HTMLElement {
    const sec = el('div', { class: 'store-section' });
    sec.append(el('h2', { class: 'store-section-title', text: title }), body);
    return sec;
  }

  private card(opts: {
    icon: string;
    name: string;
    price: number;
    owned: boolean;
    equipped: boolean;
    canAfford: boolean;
    onBuyOrEquip: () => void;
  }): HTMLElement {
    const c = el('div', { class: `store-card${opts.equipped ? ' equipped' : ''}` });
    const iconWrap = el('span', { class: 'store-card-icon' });
    iconWrap.innerHTML = opts.icon;
    c.append(iconWrap, el('div', { class: 'store-card-name', text: opts.name }));

    const btn = el('button', { class: 'store-card-btn', type: 'button' });
    if (opts.equipped) {
      btn.textContent = 'Equipped';
      btn.disabled = true;
    } else if (opts.owned) {
      btn.textContent = 'Equip';
      btn.addEventListener('click', opts.onBuyOrEquip);
    } else {
      const priceGem = el('span', { class: 'store-card-icon-inline' });
      priceGem.innerHTML = STONE_SVG;
      btn.append(priceGem, el('span', { text: String(opts.price) }));
      btn.disabled = !opts.canAfford;
      if (opts.canAfford) btn.addEventListener('click', opts.onBuyOrEquip);
    }
    c.append(btn);
    return c;
  }
}
