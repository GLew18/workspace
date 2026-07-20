// WorkSpace — first-run onboarding (what "Try now" leads to, right after sign-in).
//
// A guided three-step card over the app's dark-blue gradient:
//   1. NAME     — pre-filled from the Google email; one field, one Continue.
//   2. CONNECT  — the Schoology iCal link, with a built-in "where do I find this?"
//                 walkthrough (the step students actually get stuck on) and a
//                 Skip path. Soft validation only — a wrong link never traps you.
//   3. FINISH   — the account is saved the moment this step opens (so a closed
//                 tab can't lose onboarding), the first sync runs live with a
//                 "✓ N assignments imported" payoff, and a three-line primer
//                 hands over to the app.
//
// Contract (unchanged from the single-card version): saves profile/account with
// onboarded: true + markOnboardedLocally(), saves profile/schoology when a link is
// given, runs the first sync, then calls onDone(name).

import type { Data } from '../db';
import { el, textInput } from '../util/dom';
import { capitalizeName, nameFromEmail } from '../util/names';
import { runSync } from '../schoology/sync';
import { createWordmark } from '../ui/laurel';

interface OnboardingOpts {
  data: Data;
  email: string;
  fallbackName: string;
  onDone: (displayName: string) => void;
}

/** Soft link check — catches "I pasted my password" mistakes, never blocks a real
 *  feed URL (Schoology's come as webcal://… or https://…/ical/…). */
function looksLikeIcalLink(v: string): boolean {
  return /^(webcal|https?):\/\/\S+/i.test(v.trim());
}

export function runOnboarding({ data, email, fallbackName, onDone }: OnboardingOpts): void {
  // Auto-suggest the name from the email (e.g. zaki@… → "Zaki"); user can change it.
  const suggested = capitalizeName(nameFromEmail(email) || fallbackName || '');

  // Draft state survives Back/Continue hops between steps.
  const draft = { name: suggested, ical: '' };
  let accountSaved = false;

  const backdrop = el('div', { class: 'onb-backdrop' });
  const card = el('div', { class: 'onb-card' });
  backdrop.append(card);
  document.body.append(backdrop);

  // --- shared chrome: wordmark + progress dots, redrawn with every step ---------
  const paintShell = (step: 1 | 2 | 3): HTMLElement => {
    card.replaceChildren();
    const mark = el('div', { class: 'onb-mark' });
    mark.append(createWordmark().el);
    const dots = el('div', { class: 'onb-dots' });
    for (let i = 1; i <= 3; i++) {
      dots.append(el('span', { class: `onb-dot${i < step ? ' done' : ''}${i === step ? ' active' : ''}` }));
    }
    const body = el('div', { class: 'onb-step-body' });
    card.append(mark, dots, body);
    return body;
  };

  // ---------------------------------------------------------------- step 1: name
  const stepName = (): void => {
    const body = paintShell(1);
    body.append(
      el('h2', { class: 'onb-title', text: 'Welcome to WorkSpace 👋' }),
      el('p', { class: 'onb-sub', text: 'Two quick questions and you’re in.' }),
      el('div', { class: 'onb-label', text: 'What should we call you?' })
    );
    const nameInput = textInput({ class: 'onb-input', value: draft.name });
    body.append(nameInput);

    const next = el('button', { class: 'btn-primary onb-btn onb-btn-full', text: 'Continue' });
    const go = () => {
      draft.name = capitalizeName(nameInput.value) || 'Student';
      stepConnect();
    };
    next.addEventListener('click', go);
    nameInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    body.append(next);

    nameInput.focus();
    nameInput.select();
  };

  // ---------------------------------------------------- step 2: connect Schoology
  const stepConnect = (): void => {
    const body = paintShell(2);
    body.append(
      el('h2', { class: 'onb-title', text: `Connect Schoology, ${draft.name}` }),
      el('p', {
        class: 'onb-sub',
        text: 'Paste your calendar (iCal) link and every assignment imports itself — automatically, forever. No password is ever stored.',
      })
    );

    const icalInput = textInput({
      class: 'onb-input',
      placeholder: 'webcal://… or https://…/ical.ics',
      value: draft.ical,
    });
    body.append(icalInput);
    const error = el('div', { class: 'onb-error' });
    body.append(error);

    // The step students get stuck on — a built-in walkthrough, closed by default.
    const help = el('details', { class: 'onb-help' });
    help.append(el('summary', { text: 'Where do I find this link?' }));
    const steps = el('ol', { class: 'onb-help-steps' });
    for (const s of [
      'Open Schoology and click Calendar in the left sidebar.',
      'Look for the calendar’s settings / export option.',
      'Choose “Enable iCal feed” and copy the link it shows.',
      'Come back here and paste it below — that’s it.',
    ]) {
      steps.append(el('li', { text: s }));
    }
    help.append(steps);
    body.append(help);

    const actions = el('div', { class: 'onb-actions' });
    const back = el('button', { class: 'onb-back', text: '← Back' });
    back.addEventListener('click', () => {
      draft.ical = icalInput.value.trim();
      stepName();
    });
    const skip = el('button', { class: 'onb-skip', text: 'Skip for now' });
    skip.addEventListener('click', () => {
      draft.ical = '';
      void stepFinish();
    });
    const connect = el('button', { class: 'btn-primary onb-btn', text: 'Connect' });
    const go = () => {
      const v = icalInput.value.trim();
      if (!v) {
        error.textContent = 'Paste a link — or use “Skip for now” and add it later in Settings.';
        icalInput.focus();
        return;
      }
      if (!looksLikeIcalLink(v)) {
        error.textContent = 'That doesn’t look like a link — it should start with webcal:// or https://.';
        icalInput.focus();
        icalInput.select();
        return;
      }
      draft.ical = v;
      void stepFinish();
    };
    connect.addEventListener('click', go);
    icalInput.addEventListener('keydown', (e) => {
      if (e.key === 'Enter') go();
    });
    icalInput.addEventListener('input', () => (error.textContent = ''));
    actions.append(back, skip, connect);
    body.append(actions);

    icalInput.focus();
  };

  // ------------------------------------------- step 3: save, first sync, hand-off
  const stepFinish = async (): Promise<void> => {
    const body = paintShell(3);
    body.append(el('h2', { class: 'onb-title', text: `You’re in, ${draft.name}!` }));
    const status = el('div', { class: 'onb-status' });
    body.append(status);

    // Save the account FIRST — from this moment onboarding can never be lost,
    // even if the tab closes mid-sync.
    if (!accountSaved) {
      accountSaved = true;
      await data.setProfile('account', { displayName: draft.name, onboarded: true });
      data.markOnboardedLocally(); // survives a transient blank read (never re-onboard)
    }

    if (draft.ical) {
      const url = draft.ical.replace(/^webcal:\/\//i, 'https://');
      await data.setProfile('schoology', { icalUrl: url, lastSyncAt: null });
      status.textContent = '⏳ Importing your assignments…';
      try {
        const result = await runSync(data);
        status.textContent =
          result.added > 0
            ? `✓ ${result.added} assignment${result.added === 1 ? '' : 's'} imported`
            : '✓ Connected — new assignments will import automatically';
        status.classList.add('ok');
      } catch {
        status.textContent = '⚠ Couldn’t reach Schoology — your link is saved; retry from Settings.';
      }
    } else {
      status.textContent = 'Connect Schoology anytime in Settings → Calendar link.';
    }

    // A 30-second map of the app, then hand over.
    const primer = el('div', { class: 'onb-primer' });
    for (const [emoji, title, blurb] of [
      ['📊', 'Dashboard', 'Today at a glance — due tasks, schedule, a quote.'],
      ['✅', 'Tasks', 'Every assignment, organized by when it’s due.'],
      ['🎯', 'Focus', 'A deep-work timer that pulls in your tasks.'],
    ] as const) {
      const row = el('div', { class: 'onb-primer-row' });
      row.append(
        el('span', { class: 'onb-primer-emoji', text: emoji }),
        el('span', { class: 'onb-primer-title', text: title }),
        el('span', { class: 'onb-primer-blurb', text: blurb })
      );
      primer.append(row);
    }
    body.append(primer);

    const enter = el('button', { class: 'btn-primary onb-btn onb-btn-full', text: 'Enter WorkSpace' });
    enter.addEventListener('click', () => {
      backdrop.remove();
      onDone(draft.name);
    });
    body.append(enter);
    enter.focus();
  };

  stepName();
}
