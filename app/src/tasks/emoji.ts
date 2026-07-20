// WorkSpace — AI emoji niceties (spec §9.6).
//
// Picks a single leading emoji for a task. If an AI proxy is configured
// (VITE_AI_PROXY_URL) it asks Claude (Haiku), with a per-day spend cap.
// Otherwise it falls back to a local keyword heuristic so the feature always
// works, even with no backend.

import { todayStr } from '../util/dates';

const PROXY = import.meta.env.VITE_AI_PROXY_URL as string | undefined;
const DAILY_CAP = 150;

const HEURISTIC: [RegExp, string][] = [
  [/lawn|garden|plant|water|yard/i, '🌱'],
  [/essay|write|read|book|english|ela|paper/i, '📖'],
  [/math|geometry|algebra|equation/i, '📐'],
  [/test|quiz|exam|study/i, '📝'],
  [/lab|science|bio|chem|physics/i, '🔬'],
  [/code|coding|program|dev|cs/i, '💻'],
  [/art|draw|paint|design/i, '🎨'],
  [/music|song|practice|instrument/i, '🎵'],
  [/run|gym|workout|exercise|pe/i, '🏃'],
  [/clean|laundry|dishes|chore/i, '🧹'],
  [/email|message|call|text|reply/i, '✉️'],
  [/buy|shop|grocery|store/i, '🛒'],
  [/meeting|meet|appointment/i, '📅'],
  [/torah|tanach|ivrit|hebrew|mishna/i, '📜'],
];

function localEmoji(title: string, course: string): string {
  const hay = `${title} ${course}`;
  for (const [re, emoji] of HEURISTIC) if (re.test(hay)) return emoji;
  return '✅';
}

function bumpSpendCap(): boolean {
  const key = `ws:aiSpend:${todayStr()}`;
  const used = +(localStorage.getItem(key) || '0');
  if (used >= DAILY_CAP) return false;
  localStorage.setItem(key, String(used + 1));
  return true;
}

/** Pick a single emoji for a task. Never rejects — always resolves to something. */
export async function pickEmoji(title: string, course: string): Promise<string> {
  if (!PROXY || !bumpSpendCap()) return localEmoji(title, course);

  try {
    const res = await fetch(PROXY, {
      method: 'POST',
      headers: { 'content-type': 'application/json' },
      body: JSON.stringify({
        messages: [
          {
            role: 'user',
            content: `Reply with exactly ONE emoji that best represents this task. No words.\nTask: "${title}"${course ? `\nCourse: ${course}` : ''}`,
          },
        ],
      }),
    });
    if (!res.ok) return localEmoji(title, course);
    const data = await res.json();
    const text: string = data?.content?.[0]?.text ?? data?.text ?? '';
    const emoji = [...text.trim()][0];
    return emoji || localEmoji(title, course);
  } catch {
    return localEmoji(title, course);
  }
}
