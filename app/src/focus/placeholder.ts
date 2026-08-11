// Cobalt: Focus tab placeholder (full implementation lands in Phase 4).

import { el } from '../util/dom';

export function renderFocusPlaceholder(panel: HTMLElement): void {
  const wrap = el('div', { class: 'empty-state' });
  wrap.append(
    el('div', { text: '⏳', style: 'font-size:40px;margin-bottom:10px' }),
    el('div', { text: 'Focus sessions arrive in Phase 4.' }),
    el('div', {
      class: 'quick-add-hint',
      text: 'Deep-work timer, focus music, and "Import Tasks" from your list.',
      style: 'margin-top:8px',
    })
  );
  panel.append(wrap);
}
