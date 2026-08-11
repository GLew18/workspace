// Cobalt: course-learning model (Layer 1b).
//
// Learns WHICH WORDS/PHRASES in an assignment's title + description go with which
// course, from the student's own corrections. Every correction reinforces it.
//
// The model is a simple, robust weighted feature→course count table:
//   { [feature]: { [courseName]: count } }
// This format is intentionally ANONYMOUS and MERGEABLE: it holds no raw
// descriptions and no student identity — just "phrase X co-occurs with course Y,
// N times". When Firebase + FERPA sign-off land, per-student tables sum into one
// shared per-school model (general learning for all students) by adding counts.

import type { Data } from '../db';

type FeatureCounts = Record<string, Record<string, number>>;

let model: FeatureCounts = {};
let data: Data | null = null;

// Confidence gates — conservative on purpose: leave blank rather than guess wrong.
const MIN_EVIDENCE = 2; // need at least this much weight behind the winner
const MIN_CONFIDENCE = 0.6; // winner must hold ≥60% of the total score

const STOP = new Set([
  'the', 'a', 'an', 'and', 'or', 'for', 'to', 'of', 'in', 'on', 'at', 'by', 'with',
  'your', 'you', 'this', 'that', 'these', 'those', 'from', 'into', 'is', 'are', 'be',
  'will', 'have', 'has', 'do', 'does', 'please', 'about', 'as', 'it', 'its', 'if',
  'complete', 'submit', 'finish', 'read', 'bring', 'work', 'due', 'class', 'today',
  'tomorrow', 'page', 'pages', 'here', 'tonight', 'night', 'week', 'day',
]);

/** Pull unigram + bigram features from text (lowercased, de-punctuated, stopworded). */
export function extractFeatures(title: string, description = ''): string[] {
  const words = `${title} ${description}`
    .toLowerCase()
    .replace(/[^a-z0-9'\s]/g, ' ')
    .split(/\s+/)
    .filter((w) => w.length >= 3 && !STOP.has(w));
  const feats = new Set<string>();
  for (let i = 0; i < words.length; i++) {
    feats.add(words[i]);
    if (i + 1 < words.length) feats.add(words[i] + ' ' + words[i + 1]); // bigram
  }
  return [...feats];
}

export async function initLearn(d: Data): Promise<void> {
  data = d;
  const stored = await d.getProfile<{ model: FeatureCounts }>('courseModel');
  model = stored?.model ?? {};
}

async function persist(): Promise<void> {
  if (data) await data.setProfile('courseModel', { model });
}

/**
 * Predict a course from the learned model, or '' if not confident.
 * Score each course by summed feature evidence; require both a minimum amount of
 * evidence and a clear majority share, so weak/ambiguous cases stay blank.
 */
export function predictCourse(title: string, description = ''): string {
  const feats = extractFeatures(title, description);
  const score: Record<string, number> = {};
  let total = 0;
  for (const f of feats) {
    const row = model[f];
    if (!row) continue;
    for (const course in row) {
      score[course] = (score[course] || 0) + row[course];
      total += row[course];
    }
  }
  let best = '';
  let bestScore = 0;
  for (const course in score) {
    if (score[course] > bestScore) {
      bestScore = score[course];
      best = course;
    }
  }
  if (!best || bestScore < MIN_EVIDENCE) return '';
  if (bestScore / total < MIN_CONFIDENCE) return '';
  return best;
}

/** Reinforce the model: every feature of this item now points a bit more at `course`. */
export async function reinforce(title: string, description: string, course: string): Promise<void> {
  if (!course) return;
  for (const f of extractFeatures(title, description)) {
    (model[f] ??= {})[course] = (model[f][course] || 0) + 1;
  }
  await persist();
}

/** The raw count table (for a future merge into the shared per-school model). */
export function exportModel(): FeatureCounts {
  return model;
}
