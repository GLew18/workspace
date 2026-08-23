// Cobalt: WHICH PIECE OF TEXT ON A TASK IS BEING TRANSLATED.
//
// THE PROBLEM (Gabe, 8/22). Translation was built for the title and only the title:
// every field name, every helper and every render path said "title" out loud. Then
// the description needed the same thing, "everything as title" — the same reading,
// the same language buttons, the same change-your-mind, the same hide toggle.
//
// Copying the pipeline would have meant two of everything, and the second copy would
// have started drifting from the first the next time either changed. So the pipeline
// is parameterised instead: a SLOT says which text is being read and which fields
// hold the answer, and one implementation serves both.
//
// The title's field names are left exactly as they were. They are on every task in
// every account and in the wire format, so renaming them to fit a new abstraction
// would be a migration for no benefit that anyone can see.

import type { Task } from '../types';

export type TxSlotName = 'title' | 'details';

/** The field names one slot's answer lives under. */
export interface TxSlot {
  name: TxSlotName;
  /** The task field holding the text to read. */
  text: keyof Task;
  translated: keyof Task;
  lang: keyof Task;
  checked: keyof Task;
  hidden: keyof Task;
  ambiguous: keyof Task;
  chosen: keyof Task;
  detected: keyof Task;
  ruledOut: keyof Task;
  options: keyof Task;
  verifiedFor: keyof Task;
}

export const TITLE_SLOT: TxSlot = {
  name: 'title',
  text: 'title',
  translated: 'translatedTitle',
  lang: 'translatedLang',
  checked: 'translationChecked',
  hidden: 'translationHidden',
  ambiguous: 'translationAmbiguous',
  chosen: 'translationChosen',
  detected: 'translationDetected',
  ruledOut: 'translationRuledOut',
  options: 'translationOptions',
  verifiedFor: 'translationVerifiedFor',
};

export const DETAILS_SLOT: TxSlot = {
  name: 'details',
  text: 'details',
  translated: 'detailsTranslated',
  lang: 'detailsLang',
  checked: 'detailsChecked',
  hidden: 'detailsHidden',
  ambiguous: 'detailsAmbiguous',
  chosen: 'detailsChosen',
  detected: 'detailsDetected',
  ruledOut: 'detailsRuledOut',
  options: 'detailsOptions',
  verifiedFor: 'detailsVerifiedFor',
};

export const TX_SLOTS: TxSlot[] = [TITLE_SLOT, DETAILS_SLOT];

// --- typed readers ----------------------------------------------------------
// Task's fields are a union of types, so every read through a `keyof Task` needs a
// narrowing. Doing it once here keeps the casts out of the render code.

export function txText(task: Task, slot: TxSlot): string {
  return (task[slot.text] as string | undefined) ?? '';
}
export function txTranslated(task: Task, slot: TxSlot): string {
  return (task[slot.translated] as string | undefined) ?? '';
}
export function txLang(task: Task, slot: TxSlot): string {
  return (task[slot.lang] as string | undefined) ?? '';
}
export function txChecked(task: Task, slot: TxSlot): boolean {
  return !!task[slot.checked];
}
export function txHidden(task: Task, slot: TxSlot): boolean {
  return !!task[slot.hidden];
}
export function txAmbiguous(task: Task, slot: TxSlot): boolean {
  return !!task[slot.ambiguous];
}
export function txChosen(task: Task, slot: TxSlot): boolean {
  return !!task[slot.chosen];
}
export function txDetected(task: Task, slot: TxSlot): string {
  return (task[slot.detected] as string | undefined) ?? '';
}
export function txRuledOut(task: Task, slot: TxSlot): string[] {
  const v = task[slot.ruledOut];
  return Array.isArray(v) ? (v as string[]) : [];
}
export function txOptions(task: Task, slot: TxSlot): Record<string, string> {
  const v = task[slot.options];
  return v && typeof v === 'object' && !Array.isArray(v) ? (v as Record<string, string>) : {};
}
export function txVerifiedFor(task: Task, slot: TxSlot): string {
  return (task[slot.verifiedFor] as string | undefined) ?? '';
}

/**
 * A writer that never leaves `undefined` on the task.
 *
 * Firebase rejects undefined outright, so the codebase's rule is to DELETE a field
 * rather than assign undefined to it. Every write to a slot goes through here so
 * that rule cannot be forgotten in one of twenty call sites.
 */
export function txWrite(
  task: Task,
  slot: TxSlot,
  patch: Partial<{
    translated: string;
    lang: string;
    checked: boolean;
    hidden: boolean;
    ambiguous: boolean;
    chosen: boolean;
    detected: string;
    ruledOut: string[];
    options: Record<string, string>;
    verifiedFor: string;
  }>
): Task {
  const next = { ...task } as Task & Record<string, unknown>;
  const put = (key: keyof Task, value: unknown): void => {
    if (value === undefined) delete next[key as string];
    else next[key as string] = value;
  };
  if ('translated' in patch) put(slot.translated, patch.translated);
  if ('lang' in patch) put(slot.lang, patch.lang);
  if ('checked' in patch) put(slot.checked, patch.checked);
  if ('hidden' in patch) put(slot.hidden, patch.hidden);
  if ('ambiguous' in patch) put(slot.ambiguous, patch.ambiguous);
  if ('chosen' in patch) put(slot.chosen, patch.chosen);
  if ('detected' in patch) put(slot.detected, patch.detected);
  if ('ruledOut' in patch) put(slot.ruledOut, patch.ruledOut);
  if ('options' in patch) put(slot.options, patch.options);
  if ('verifiedFor' in patch) put(slot.verifiedFor, patch.verifiedFor);
  return next as Task;
}

/** Wipe a slot's answer: what an edit to the underlying text has to do, because the
 *  answer belonged to words the task no longer has. */
export function txClear(task: Task, slot: TxSlot): Task {
  return txWrite(task, slot, {
    translated: '',
    lang: '',
    checked: false,
    ambiguous: false,
    chosen: false,
    detected: '',
    ruledOut: [],
    options: {},
    verifiedFor: '',
  });
}

/**
 * HOW MUCH TEXT THE VERIFICATION PASS SENDS.
 *
 * Verification asks the provider to read the text as each candidate language and
 * keeps the ones that come back as English. For a title that is a few words. A
 * description can be several paragraphs, and checking ten languages would mean ten
 * full-length requests per task, per pass.
 *
 * The question being asked is only "can this language read this at all", and the
 * opening of a passage answers it as well as the whole thing does. So verification
 * runs on a leading slice; the reading the student actually presses is fetched in
 * full. Titles are almost always shorter than this and so are unaffected.
 */
export const VERIFY_SAMPLE_CHARS = 220;

export function verifySample(text: string): string {
  return text.length <= VERIFY_SAMPLE_CHARS ? text : text.slice(0, VERIFY_SAMPLE_CHARS);
}
