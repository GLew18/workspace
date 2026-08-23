// Cobalt: the 🌐 language picker.
//
// Which languages a task title may be translated FROM. An allowlist, not a
// blocklist (see prefs.ts translateFrom for why): chips for what is on, a search
// box over the whole catalog for adding more.
//
// IT LIVES HERE BECAUSE ONBOARDING SHOWS THE SAME ONE (Gabe, 8/22). Translation is
// a substantial part of Cobalt and it is personal, but it was reachable only from
// Settings, which students rarely open. So the sign-up flow now asks for a couple
// of languages using this exact control, on the same principle as the courses step:
// what you build during onboarding is the very thing you will edit in Settings
// later, down to the markup. A second, onboarding-shaped copy of a picker would
// drift from the real one within a week.

import { el, textInput } from '../util/dom';
import { searchLanguages, findLanguage, type LanguageDef } from '../util/languages';
import { resetTranslationCache } from '../util/translate';

export interface LanguagePickerOpts {
  /** The codes currently on. Read live, so the caller owns the state. */
  get: () => string[];
  /** Called after every add or remove, with the whole new list. */
  set: (codes: string[]) => void;
  /** Overrides the standing explanation above the chips. */
  lead?: string;
  /** Placeholder for the search box. */
  placeholder?: string;
  /** What the chips row says when nothing is picked. */
  emptyText?: string;
  /**
   * Stop accepting new languages after this many (Gabe, 8/22). Onboarding asks for
   * two, which is what the free tier gives, so once two are on the search greys out
   * rather than letting a student pick five and lose three later. The chips keep
   * their ✕, so swapping one for another still works. Settings passes nothing and
   * stays unlimited.
   */
  max?: number;
}

const DEFAULT_LEAD =
  'Titles written in these languages get an English translation. Everything else is left alone, which is what keeps a short English word from being read as a foreign one.';

export function buildLanguagePicker(opts: LanguagePickerOpts): HTMLElement {
  const wrap = el('div', { class: 'lang-picker' });
  const chips = el('div', { class: 'lang-chips' });
  const searchWrap = el('div', { class: 'lang-search' });
  const results = el('div', { class: 'lang-results' });

  const commit = (codes: string[]): void => {
    opts.set(codes);
    // The session cache holds verdicts reached under the OLD list, so a title
    // judged English because Spanish was off would stay that way until a reload.
    resetTranslationCache();
  };

  const input = textInput({
    class: 'settings-input lang-input',
    placeholder: opts.placeholder ?? 'Add a language…',
  });
  let query = '';

  const drawResults = (): void => {
    results.replaceChildren();
    const open = !atLimit() && (document.activeElement === input || !!query);
    results.hidden = !open;
    if (!open) return;
    const picked = new Set(opts.get().map((c) => findLanguage(c)?.code ?? c));
    const hits = searchLanguages(query).filter((l) => !picked.has(l.code));
    if (!hits.length) {
      results.append(
        el('div', {
          class: 'lang-empty',
          text: query ? 'No language matches that.' : 'All of them are already on.',
        })
      );
      return;
    }
    // NO cap. The list used to stop at 8, which made a 100-language catalog look
    // like a 8-language one (Gabe, 8/15). The box scrolls instead.
    for (const l of hits) {
      const row = el('button', { class: 'lang-result' });
      row.append(
        el('span', { class: 'lang-result-name', text: l.label }),
        el('span', { class: 'lang-result-native', text: l.native })
      );
      row.addEventListener('mousedown', (e) => e.preventDefault()); // keep focus so blur doesn't close first
      row.addEventListener('click', () => {
        commit([...opts.get(), l.code]);
        query = '';
        input.value = '';
        draw();
        input.focus();
      });
      results.append(row);
    }
  };

  const atLimit = (): boolean => opts.max !== undefined && opts.get().length >= opts.max;

  const draw = (): void => {
    chips.replaceChildren();
    const codes = opts.get();
    // FULL: the box greys out and says so, instead of silently accepting a third.
    const full = atLimit();
    input.disabled = full;
    input.placeholder = full
      ? `That’s ${opts.max}. Remove one to swap it.`
      : opts.placeholder ?? 'Add a language…';
    wrap.classList.toggle('lang-picker-full', full);
    if (!codes.length) {
      chips.append(
        el('div', {
          class: 'lang-off',
          text: opts.emptyText ?? 'None. Task titles are left exactly as they arrive.',
        })
      );
    }
    for (const code of codes) {
      const def: LanguageDef | undefined = findLanguage(code);
      const chip = el('span', { class: 'lang-chip' });
      chip.append(el('span', { class: 'lang-chip-name', text: def?.label ?? code.toUpperCase() }));
      if (def) chip.append(el('span', { class: 'lang-chip-native', text: def.native }));
      const x = el('button', {
        class: 'lang-chip-x',
        text: '✕',
        title: `Stop translating ${def?.label ?? code}`,
      });
      x.addEventListener('click', () => {
        commit(opts.get().filter((c) => c !== code));
        draw();
      });
      chip.append(x);
      chips.append(chip);
    }
    drawResults();
  };

  input.addEventListener('input', () => {
    query = input.value;
    drawResults();
  });
  input.addEventListener('focus', () => drawResults());
  input.addEventListener('blur', () => {
    // A frame's grace so a click on a result lands before the list closes.
    window.setTimeout(() => {
      if (document.activeElement === input) return;
      query = '';
      input.value = '';
      drawResults();
    }, 120);
  });
  input.addEventListener('keydown', (e) => {
    if (e.key === 'Escape') input.blur();
  });

  searchWrap.append(input, results);
  // An EMPTY lead means the caller has already said it above the control (the
  // onboarding screen does), so the row is omitted rather than left blank.
  const lead = opts.lead ?? DEFAULT_LEAD;
  if (lead) wrap.append(el('div', { class: 'lang-lead', text: lead }));
  wrap.append(chips, searchWrap);
  draw();
  return wrap;
}
