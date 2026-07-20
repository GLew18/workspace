// WorkSpace — task priorities (spec §6.3).

import type { Priority } from '../types';

export interface PriorityDef {
  key: Priority;
  label: string;
  arrow: string;
  color: string;
}

export const PRIORITIES: PriorityDef[] = [
  { key: 'highest', label: 'Very High', arrow: '⇈', color: '#ef4444' },
  { key: 'high', label: 'High', arrow: '↑', color: '#e85d04' },
  { key: 'normal', label: 'Normal', arrow: '—', color: '#f0c030' },
  { key: 'low', label: 'Low', arrow: '↓', color: '#60a5fa' },
  { key: 'lowest', label: 'Very Low', arrow: '⇊', color: 'rgba(255,255,255,0.4)' },
];

/** Sort tiebreaker weights (lower = more urgent). */
export const PRIORITY_WEIGHT: Record<Priority, number> = {
  highest: 0,
  high: 1,
  normal: 2,
  low: 3,
  lowest: 4,
};

export const priorityDef = (key: Priority): PriorityDef =>
  PRIORITIES.find((p) => p.key === key)!;

// Token maps used by the natural-language parser.
export const PRIORITY_SINGLE: Record<string, Priority> = {
  high: 'high',
  hi: 'high',
  h: 'high',
  med: 'normal',
  medium: 'normal',
  normal: 'normal',
  norm: 'normal',
  n: 'normal',
  m: 'normal',
  low: 'low',
  lo: 'low',
  l: 'low',
};

export const PRIORITY_MULTI: Record<string, Priority> = {
  'very high': 'highest',
  vh: 'highest',
  'very-high': 'highest',
  'v-high': 'highest',
  'v-hi': 'highest',
  'v-h': 'highest',
  'very low': 'lowest',
  vl: 'lowest',
  'very-low': 'lowest',
  'v-low': 'lowest',
  'v-lo': 'lowest',
  'v-l': 'lowest',
};
