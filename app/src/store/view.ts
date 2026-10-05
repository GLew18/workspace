// Cobalt: the Gems store.
//
// "It works both ways" (Gabe, 9/29/26): every item shows here in its own
// container — a picture, a name, a price — AND, once bought and equipped,
// actually changes the real app (the wordmark's gem, or what plays when a
// task is checked off). This screen only ever reads/writes through
// gems/gems.ts and store/cosmetics.ts, which are the real source of truth.
//
// THREE AT A TIME (Gabe, 10/3: the full grids were "stressing me out"). Each
// section shows three cards with arrows either side; → steps toward pricier,
// more advanced items. Every card shows the item in use underneath its icon:
// the real wordmark wearing the gem, or a real "Test Task" row whose checkbox
// plays the animation when clicked.

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
  getEquippedRing,
  getEquippedAccent,
  equipRing,
  equipAccent,
  onCosmeticsChange,
} from '../store/cosmetics';
import { STONE_SVG, createWordmark } from '../ui/laurel';
import { GEM_ALTS, type GemAlt } from './gemArt';
import { CHECKOFF_EFFECTS, type CheckoffEffect } from './checkoffArt';
import { playCheckoffById } from './checkoffEffects';
import { RING_SKINS, ringMarkup } from './ringSkins';
import { ACCENTS, COBALT_BLUE } from './accents';

const NONE_CHECKOFF_SVG =
  `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
  `<circle cx="50" cy="50" r="38" fill="none" stroke="currentColor" stroke-width="4" opacity="0.35"/>` +
  `<line x1="26" y1="26" x2="74" y2="74" stroke="currentColor" stroke-width="4" opacity="0.35"/>` +
  `</svg>`;

// Same check glyph the real task row uses (tasks/render.ts CHECK_SVG).
const CHECK_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3.5" stroke-linecap="round" stroke-linejoin="round"><path d="M5 13l4 4L19 7"/></svg>';

const ARROW_SVG =
  '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15 5l-7 7 7 7"/></svg>';

const PER_PAGE = 3;

type CarouselKey = 'gem' | 'checkoff' | 'ring' | 'accent';

interface CardOpts {
  icon: string;
  name: string;
  price: number;
  owned: boolean;
  equipped: boolean;
  canAfford: boolean;
  /** What it looks like in use: the real wordmark, or the Test Task row. */
  preview: () => HTMLElement;
  onBuyOrEquip: () => void;
}

export class StoreView {
  private data: Data;
  private unsubGems?: () => void;
  private unsubCosmetics?: () => void;
  private panel?: HTMLElement;
  /** Which page of three each carousel is on. Kept on the instance because every
   *  balance or equip change repaints the whole screen, and buying something must
   *  not throw you back to page one. Undefined = open on the equipped item. */
  private pages: Record<CarouselKey, number | undefined> = { gem: undefined, checkoff: undefined, ring: undefined, accent: undefined };

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

    const top = el('div', { class: 'store-top' });
    const balanceRow = el('div', { class: 'store-balance' });
    const icon = el('span', { class: 'store-balance-icon' });
    icon.innerHTML = STONE_SVG;
    balanceRow.append(
      icon,
      el('span', { class: 'store-balance-count', text: String(balance) }),
      el('span', { class: 'store-balance-label', text: 'Gems' })
    );
    top.append(balanceRow);
    wrap.append(top);

    wrap.append(this.gemSection(balance));
    wrap.append(this.checkoffSection(balance));
    wrap.append(this.ringSection(balance));
    wrap.append(this.accentSection(balance));

    panel.append(wrap);
  }

  // --- Cobalt Gem Alternatives ---------------------------------------------

  private gemSection(balance: number): HTMLElement {
    const equipped = getEquippedGem();
    const items: CardOpts[] = [
      {
        icon: STONE_SVG,
        name: 'Gem', // the standard stone (Gabe, 10/4: "Gem", not "Default")
        price: 0,
        owned: true,
        equipped: !equipped,
        canAfford: true,
        preview: () => this.wordmarkPreview(STONE_SVG),
        onBuyOrEquip: () => void equipGem(undefined),
      },
      ...GEM_ALTS.map((g) => this.gemCard(g, equipped, balance)),
    ];
    return this.section('Cobalt Gem Alternatives', this.carousel('gem', items));
  }

  private gemCard(g: GemAlt, equipped: string | undefined, balance: number): CardOpts {
    const owned = isOwned(g.id);
    return {
      icon: g.svg,
      name: g.name,
      price: g.price,
      owned,
      equipped: equipped === g.id,
      canAfford: balance >= g.price,
      preview: () => this.wordmarkPreview(g.svg),
      onBuyOrEquip: async () => {
        if (owned) void equipGem(g.id);
        else if (await purchaseItem(g.id, g.price)) void equipGem(g.id);
      },
    };
  }

  /** The real "Cobalt" wordmark wearing this gem, exactly as the header would. */
  private wordmarkPreview(svg: string): HTMLElement {
    const box = el('div', { class: 'store-preview store-preview-mark' });
    box.append(createWordmark(svg).el);
    return box;
  }

  // --- Checkoff Animations ---------------------------------------------

  private checkoffSection(balance: number): HTMLElement {
    const equipped = getEquippedCheckoff();
    const items: CardOpts[] = [
      {
        icon: NONE_CHECKOFF_SVG,
        name: 'None',
        price: 0,
        owned: true,
        equipped: !equipped,
        canAfford: true,
        preview: () => this.taskPreview(undefined),
        onBuyOrEquip: () => void equipCheckoff(undefined),
      },
      ...CHECKOFF_EFFECTS.map((e) => this.checkoffCard(e, equipped, balance)),
    ];
    return this.section('Checkoff Animations', this.carousel('checkoff', items));
  }

  private checkoffCard(e: CheckoffEffect, equipped: string | undefined, balance: number): CardOpts {
    const owned = isOwned(e.id);
    return {
      icon: e.svg,
      name: e.name,
      price: e.price,
      owned,
      equipped: equipped === e.id,
      canAfford: balance >= e.price,
      preview: () => this.taskPreview(e.id),
      onBuyOrEquip: async () => {
        if (owned) void equipCheckoff(e.id);
        else if (await purchaseItem(e.id, e.price)) void equipCheckoff(e.id);
      },
    };
  }

  /** "Test Task" (Gabe, 10/3): the most basic task there is (no due date, no
   *  course, Normal priority), built with the real row markup and CSS. Clicking
   *  its checkbox plays the effect for real, then the task un-checks itself so
   *  it can be tried again. */
  private taskPreview(effectId: string | undefined): HTMLElement {
    const list = el('div', { class: 'task-list store-preview store-preview-task' });
    const row = el('div', { class: 'task-item' });
    row.dataset.taskId = `store_preview_${effectId ?? 'none'}`; // row effects follow the row by this id
    row.innerHTML =
      `<div class="task-priority normal" title="Priority: Normal"></div>` +
      `<button class="task-cb" type="button" aria-label="Try this animation">${CHECK_SVG}</button>` +
      `<div class="task-info"><div class="task-title">Test Task</div>` +
      `<div class="task-bottom-row"><div class="task-meta-wrap"></div>` +
      `<div class="task-actions"><span class="store-preview-prio" title="Priority: Normal">—</span></div></div></div>`;
    const cb = row.querySelector<HTMLElement>('.task-cb')!;
    let timer = 0;
    const set = (done: boolean) => {
      row.classList.toggle('completed', done);
      cb.classList.toggle('checked', done);
    };
    cb.addEventListener('click', () => {
      window.clearTimeout(timer);
      if (row.classList.contains('completed')) return set(false);
      set(true);
      if (effectId) playCheckoffById(effectId, row);
      timer = window.setTimeout(() => set(false), 2600);
    });
    list.append(row);
    return list;
  }

  // --- Focus Ring Skins and Accent Colors (Gabe, 10/4) ------------------------
  // First drafted as two sub-rows under one "Miscellaneous" header; each is now
  // a full section with its own header, like the two above (Gabe, 10/4).

  private ringSection(balance: number): HTMLElement {
    return this.section('Focus Ring Skins', this.carousel('ring', this.ringItems(balance)));
  }

  private accentSection(balance: number): HTMLElement {
    return this.section('Accent Colors', this.carousel('accent', this.accentItems(balance)));
  }

  private ringItems(balance: number): CardOpts[] {
    const equipped = getEquippedRing();
    const card = (id: string | undefined, name: string, price: number): CardOpts => {
      const owned = !id || isOwned(id);
      return {
        icon: '', // the preview below IS the ring; a second, smaller one only repeated it
        name,
        price,
        owned,
        equipped: equipped === id,
        canAfford: balance >= price,
        preview: () => this.ringPreview(id),
        onBuyOrEquip: async () => {
          if (owned) void equipRing(id);
          else if (id && (await purchaseItem(id, price))) void equipRing(id);
        },
      };
    };
    return [card(undefined, 'Standard', 0), ...RING_SKINS.map((s) => card(s.id, s.name, s.price))];
  }

  /** A ring skin, drawn at about two-thirds done like a session in progress. */
  private ringSvg(skin: string | undefined): string {
    const R = 130;
    const circ = 2 * Math.PI * R;
    const svg = `<svg class="focus-ring" viewBox="0 0 280 280">${ringMarkup(skin, R, circ)}</svg>`;
    return svg.replace(/stroke-dashoffset="0"/g, `stroke-dashoffset="${(circ * 0.33).toFixed(2)}"`);
  }

  /** What it looks like in use: the ring on the Focus session's own background,
   *  with a time in the middle. */
  private ringPreview(skin: string | undefined): HTMLElement {
    const box = el('div', { class: 'store-preview store-preview-ring' });
    const wrap = el('div', { class: 'focus-ring-wrap' });
    wrap.innerHTML = this.ringSvg(skin);
    wrap.append(el('div', { class: 'focus-time', text: '16:40' }));
    box.append(wrap);
    return box;
  }

  private accentItems(balance: number): CardOpts[] {
    const equipped = getEquippedAccent();
    const card = (id: string | undefined, name: string, price: number, hex: string, rgb: string, on: string): CardOpts => {
      const owned = !id || isOwned(id);
      return {
        icon:
          `<svg viewBox="0 0 100 100" aria-hidden="true" focusable="false">` +
          `<circle cx="50" cy="50" r="38" fill="${hex}"/>` +
          `<ellipse cx="38" cy="34" rx="15" ry="9" fill="#fff" opacity="0.3"/></svg>`,
        name,
        price,
        owned,
        equipped: equipped === id,
        canAfford: balance >= price,
        preview: () => this.accentPreview(hex, rgb, on),
        onBuyOrEquip: async () => {
          if (owned) void equipAccent(id);
          else if (id && (await purchaseItem(id, price))) void equipAccent(id);
        },
      };
    };
    return [
      card(undefined, 'Cobalt Blue', 0, COBALT_BLUE, '125, 180, 255', '#071433'),
      ...ACCENTS.map((a) => card(a.id, a.name, a.price, a.hex, a.rgb, a.on)),
    ];
  }

  /** A few real-looking controls painted in this accent: a filled button, a
   *  switch that's on, and a selected chip. */
  private accentPreview(hex: string, rgb: string, on: string): HTMLElement {
    const box = el('div', { class: 'store-preview store-preview-accent' });
    box.style.setProperty('--pa', hex);
    box.style.setProperty('--pa-rgb', rgb);
    box.style.setProperty('--pa-on', on);
    box.innerHTML =
      `<span class="pa-btn">Start</span>` +
      `<span class="pa-switch" aria-hidden="true"><span></span></span>` +
      `<span class="pa-chip">Selected</span>`;
    return box;
  }

  // --- shared chrome ---------------------------------------------------------

  private section(title: string, body: HTMLElement): HTMLElement {
    const sec = el('div', { class: 'store-section' });
    sec.append(el('h2', { class: 'store-section-title', text: title }), body);
    return sec;
  }

  /** Three cards in view, arrows either side; → steps toward pricier items. */
  private carousel(key: CarouselKey, items: CardOpts[]): HTMLElement {
    const last = Math.max(0, Math.ceil(items.length / PER_PAGE) - 1);
    if (this.pages[key] === undefined) {
      const eq = items.findIndex((it) => it.equipped);
      this.pages[key] = Math.floor(Math.max(0, eq) / PER_PAGE);
    }
    const prev = el('button', { class: 'store-arrow', type: 'button', 'aria-label': 'Cheaper' });
    const next = el('button', { class: 'store-arrow next', type: 'button', 'aria-label': 'More advanced' });
    prev.innerHTML = ARROW_SVG;
    next.innerHTML = ARROW_SVG;
    const row = el('div', { class: 'store-row' });
    const count = el('div', { class: 'store-page-count' });
    const show = () => {
      const page = Math.min(this.pages[key]!, last);
      row.replaceChildren(...items.slice(page * PER_PAGE, (page + 1) * PER_PAGE).map((it) => this.card(it)));
      prev.disabled = page === 0;
      next.disabled = page === last;
      count.textContent = `${page + 1} of ${last + 1}`;
    };
    const go = (d: number) => {
      this.pages[key] = Math.min(last, Math.max(0, this.pages[key]! + d));
      show();
    };
    prev.addEventListener('click', () => go(-1));
    next.addEventListener('click', () => go(1));
    show();
    const carousel = el('div', { class: 'store-carousel' });
    carousel.append(prev, row, next);
    const outer = el('div');
    outer.append(carousel, count);
    return outer;
  }

  private card(opts: CardOpts): HTMLElement {
    const c = el('div', { class: `store-card${opts.equipped ? ' equipped' : ''}` });
    const iconWrap = el('span', { class: 'store-card-icon' });
    iconWrap.innerHTML = opts.icon;
    c.append(iconWrap, el('div', { class: 'store-card-name', text: opts.name }), opts.preview());

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
