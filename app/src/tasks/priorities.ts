// Cobalt: task priorities (spec §6.3).

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
//
// NO SINGLE LETTER IS A PRIORITY WORD (Gabe, 8/19). One letter is far too small a
// target for a matcher that runs over every word you type: "h", "l", "m" and "n"
// are all real things to write in a task title, and losing one silently changed
// the title AND the priority. Two letters is the floor. "n" and "m" cost nothing
// to lose anyway: normal is the DEFAULT, so neither did anything you could not
// get by saying nothing at all.
//
// "hi" IS back (Gabe, 8/19), reversing its 8/10 removal. It was pulled as part of
// the same worry, but the worry was really about single letters: "hi" is short
// without being a hair trigger, and it is the abbreviation people reach for.
export const PRIORITY_SINGLE: Record<string, Priority> = {
  high: 'high',
  hi: 'high',
  med: 'normal',
  medium: 'normal',
  normal: 'normal',
  norm: 'normal',
  low: 'low',
  lo: 'low',
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
