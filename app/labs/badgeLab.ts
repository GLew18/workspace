// Cobalt: Badge Lab — the badge tier ladder and every tier with sample
// emblems, for design review (Gabe, 10/2: one structure; bronze, silver, gold,
// cobalt by difficulty, each tier adding components, sparkle and shine; the
// emblem changes per achievement). Renders the REAL art in
// src/store/badgeArt.ts with the REAL shine CSS.
//
// Build: node scripts/build-lab.mjs badges   (from app/)

import '../src/ui/theme.css';
import '../src/ui/badges.css';
import './checkoffLab.css';
import './badgeLab.css';
import { badgeSvg, BADGE_TIERS, type BadgeEmblem, type BadgeTier } from '../src/store/badgeArt';

const TIER_INFO: Record<BadgeTier, { name: string; note: string; adds: string }> = {
  bronze: { name: 'Bronze', note: 'Easy to earn', adds: 'Plain medal, faint slow shine' },
  silver: { name: 'Silver', note: 'Takes some work', adds: 'Riveted band, ring, brighter shine, a sparkle' },
  gold: { name: 'Gold', note: 'Hard to earn', adds: 'Engraved rays, two set gems, warm glow, bright shine' },
  cobalt: { name: 'Cobalt', note: 'The hardest', adds: 'Blue metal, platinum rim, crown gem and diamonds, double shine, pulsing glow' },
};

// Sample emblems only. The real badge list is drafted later.
const SAMPLES: { emblem: BadgeEmblem; name: string }[] = [
  { emblem: { kind: 'plus' }, name: 'Cobalt Plus' },
  { emblem: { kind: 'number', value: 20 }, name: '20 assignments' },
  { emblem: { kind: 'eye' }, name: 'Focus session' },
  { emblem: { kind: 'check' }, name: 'First check-off' },
  { emblem: { kind: 'number', value: 100 }, name: '100 assignments' },
];

const root = document.getElementById('lab')!;
root.className = 'lab';
root.innerHTML =
  `<header><h1 class="lab-title">Cobalt Badges</h1>` +
  `<p class="lab-sub">One medal shape for every badge. Each tier up adds detail, gems, sparkle and shine; the emblem shows what it's for. Sample emblems only.</p></header>`;

// The ladder: one emblem through all four tiers, side by side.
const ladder = document.createElement('section');
ladder.className = 'lab-card badge-row';
ladder.innerHTML =
  `<header class="lab-head"><span class="lab-name">Tier ladder</span><span class="lab-price">Easiest to hardest</span></header>` +
  `<div class="badge-ladder">` +
  BADGE_TIERS.map(
    (t) =>
      `<figure class="badge-step">${badgeSvg(t, { kind: 'number', value: 20 }, `${t} badge`)}` +
      `<figcaption><strong>${TIER_INFO[t].name}</strong><span>${TIER_INFO[t].adds}</span></figcaption></figure>`
  ).join('') +
  `</div>`;
root.append(ladder);

for (const tier of BADGE_TIERS) {
  const { name, note } = TIER_INFO[tier];
  const sec = document.createElement('section');
  sec.className = 'lab-card badge-row';
  sec.innerHTML =
    `<header class="lab-head"><span class="lab-name">${name}</span><span class="lab-price">${note}</span></header>` +
    `<div class="badge-grid">` +
    SAMPLES.map(
      (s) => `<figure class="badge-cell">${badgeSvg(tier, s.emblem, `${tier} ${s.name} badge`)}<figcaption>${s.name}</figcaption></figure>`
    ).join('') +
    `</div>`;
  root.append(sec);
}

// The same badges at the size a profile or store grid would show them.
const small = document.createElement('section');
small.className = 'lab-card badge-row';
small.innerHTML =
  `<header class="lab-head"><span class="lab-name">At small size</span><span class="lab-price">48px wide</span></header>` +
  `<div class="badge-strip">` +
  BADGE_TIERS.flatMap((t) => SAMPLES.slice(0, 3).map((s) => `<span class="badge-small">${badgeSvg(t, s.emblem)}</span>`)).join('') +
  `</div>`;
root.append(small);
