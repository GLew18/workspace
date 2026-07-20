// WorkSpace — course attribution. Same engine for typed tasks AND calendar imports.
//
//   Layer 1a  explicit parse-word rules (registry) — deterministic, certain.
//   Layer 1b  learned model (courses/learn) — weighted words/phrases from the
//             student's own corrections; conservative (blank unless confident).
//   Layer 2   AI classifier — only on items 1a/1b can't resolve; CONSERVATIVE:
//             returns a course only when confident, else leaves it blank. Degrades
//             to a no-op when the /api/ask-claude proxy isn't configured.
//   Layer 3   "Help our AI" — a correction reinforces Layer 1b (learnCorrection).

import { matchByParseWords, getCourseNames } from '../courses/registry';
import { predictCourse, reinforce } from '../courses/learn';

export interface ClassifyItem {
  id: string;
  title: string;
  description?: string;
}

export interface CourseGuess {
  course: string; // '' = uncategorized
  source: 'rule' | 'learned' | 'ai' | 'none';
}

/** Layers 1a + 1b (synchronous, deterministic). Used for typed tasks and the first import pass. */
export function classifyByRules(title: string, description = ''): string {
  return matchByParseWords(`${title} ${description}`) || predictCourse(title, description);
}

/** Full classify for an import batch: rules/learned for everything, then ONE conservative AI call for leftovers. */
export async function classifyBatch(items: ClassifyItem[]): Promise<Record<string, CourseGuess>> {
  const out: Record<string, CourseGuess> = {};
  const unresolved: ClassifyItem[] = [];

  for (const it of items) {
    const ruleHit = matchByParseWords(`${it.title} ${it.description || ''}`);
    if (ruleHit) {
      out[it.id] = { course: ruleHit, source: 'rule' };
      continue;
    }
    const learned = predictCourse(it.title, it.description);
    if (learned) {
      out[it.id] = { course: learned, source: 'learned' };
      continue;
    }
    unresolved.push(it);
  }

  if (unresolved.length) {
    const ai = await aiClassify(unresolved, getCourseNames());
    for (const it of unresolved) {
      const guess = ai[it.id];
      out[it.id] = guess ? { course: guess, source: 'ai' } : { course: '', source: 'none' };
    }
  }
  return out;
}

/**
 * Layer 2 (conservative): ask the serverless Claude proxy to assign a course ONLY
 * when confident. We instruct it to leave anything ambiguous blank, and we also
 * drop low-confidence results client-side. Returns {} if the proxy is absent.
 */
async function aiClassify(
  items: ClassifyItem[],
  courseNames: string[]
): Promise<Record<string, string>> {
  if (!courseNames.length) return {};
  const MIN_AI_CONFIDENCE = 0.8;
  try {
    const res = await fetch('/api/ask-claude', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        task: 'classify-courses',
        conservative: true, // only answer when confident; otherwise omit / blank
        courses: courseNames,
        items: items.map((i) => ({
          id: i.id,
          title: i.title,
          description: (i.description || '').slice(0, 500),
        })),
      }),
    });
    if (!res.ok) return {};
    const data = (await res.json()) as {
      results?: { id: string; course: string; confidence?: number }[];
    };
    const map: Record<string, string> = {};
    for (const r of data.results ?? []) {
      if (!courseNames.includes(r.course)) continue; // must be a real course
      if (typeof r.confidence === 'number' && r.confidence < MIN_AI_CONFIDENCE) continue;
      map[r.id] = r.course;
    }
    return map;
  } catch {
    return {}; // proxy not configured / offline — graceful no-op
  }
}

/**
 * Layer 3: the user corrected a course → reinforce the learned model so the words
 * and phrases in this assignment point at the right course next time.
 */
export async function learnCorrection(
  title: string,
  description: string,
  courseName: string
): Promise<void> {
  if (courseName) await reinforce(title, description, courseName);
}
