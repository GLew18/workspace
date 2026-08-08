// WorkSpace — the 🔔 Notifications screen (a full tab, like Settings).
//
// A plain history of what WorkSpace has told you, newest first, grouped by day.
// One row per notification — NOT one per channel: a reminder that went out as both
// a pop-up and an email is a single event, with small icons saying which routes it
// took. Reading the same sentence twice would be pure noise.
//
// The list is device-local (see log.ts) and repaints on NOTIFY_LOG_EVENT, so a
// reminder that fires while the screen is open slides in without a refresh.

import { el } from '../util/dom';
import {
  readNotifyLog,
  clearNotifyLog,
  markNotifyLogSeen,
  NOTIFY_LOG_EVENT,
  type NotifyLogEntry,
} from './log';
import { getPrefs } from '../prefs';

/** "2:05 PM" / "14:05", honoring the time-format pref. */
function clock(ms: number): string {
  const d = new Date(ms);
  if (getPrefs().timeFormat === '24h') {
    return `${String(d.getHours()).padStart(2, '0')}:${String(d.getMinutes()).padStart(2, '0')}`;
  }
  const h = d.getHours() % 12 || 12;
  const suffix = d.getHours() < 12 ? 'AM' : 'PM';
  return `${h}:${String(d.getMinutes()).padStart(2, '0')} ${suffix}`;
}

/** Day heading: Today / Yesterday / "Mon, Aug 4". */
function dayLabel(ms: number): string {
  const d = new Date(ms);
  const today = new Date();
  const startOf = (x: Date) => new Date(x.getFullYear(), x.getMonth(), x.getDate()).getTime();
  const diffDays = Math.round((startOf(today) - startOf(d)) / 86_400_000);
  if (diffDays === 0) return 'Today';
  if (diffDays === 1) return 'Yesterday';
  return d.toLocaleDateString(undefined, { weekday: 'short', month: 'short', day: 'numeric' });
}

export class NotificationLogView {
  private host: HTMLElement | null = null;
  private onLogChange = (): void => this.draw();

  /** Mounted fresh on every visit (the tab uses onShow), so the listener is
   *  re-registered each time and removed when the panel is replaced. */
  mount(panel: HTMLElement): void {
    window.removeEventListener(NOTIFY_LOG_EVENT, this.onLogChange);
    window.addEventListener(NOTIFY_LOG_EVENT, this.onLogChange);

    const page = el('div', { class: 'nlog-page' });
    this.host = page;
    panel.replaceChildren(page);
    this.draw();
    // Opening the screen IS reading it: clears the bell's unread dot. Done after
    // the first draw so entries that arrived while away still render normally.
    markNotifyLogSeen();
  }

  private draw(): void {
    const host = this.host;
    if (!host) return;
    const entries = readNotifyLog();
    host.replaceChildren();

    // Title over description, then "Clear all" off to the right — the same page
    // head shape Settings uses, so the two screens read as one app.
    const head = el('div', { class: 'nlog-head' });
    const headText = el('div', { class: 'nlog-head-text' });
    headText.append(
      el('div', { class: 'nlog-title', text: 'Notifications' }),
      el('div', {
        class: 'nlog-desc',
        text: 'Everything WorkSpace has sent you on this device, newest first.',
      })
    );
    head.append(headText);
    if (entries.length) {
      const clear = el('button', { class: 'nlog-clear', text: 'Clear all' });
      clear.addEventListener('click', () => clearNotifyLog());
      head.append(clear);
    }
    host.append(head);

    if (!entries.length) {
      const empty = el('div', { class: 'nlog-empty' });
      empty.append(
        el('div', { class: 'nlog-empty-bell', text: '🔔' }),
        el('div', { class: 'nlog-empty-title', text: 'Nothing yet' }),
        el('div', {
          class: 'nlog-empty-sub',
          text: 'Reminders you receive will collect here. Turn them on in Settings ▸ Notifications.',
        })
      );
      host.append(empty);
      return;
    }

    // Group consecutive entries by day. The list is already newest-first, so a
    // day heading is emitted whenever the label changes as we walk down.
    let lastDay = '';
    for (const e of entries) {
      const label = dayLabel(e.at);
      if (label !== lastDay) {
        lastDay = label;
        host.append(el('div', { class: 'nlog-day', text: label }));
      }
      host.append(this.row(e));
    }
  }

  private row(e: NotifyLogEntry): HTMLElement {
    const row = el('div', { class: 'nlog-row' });

    const time = el('div', { class: 'nlog-time', text: clock(e.at) });

    const main = el('div', { class: 'nlog-main' });
    main.append(el('div', { class: 'nlog-row-title', text: e.title }));
    if (e.body) main.append(el('div', { class: 'nlog-body', text: e.body }));

    // Delivery routes, as chips. Both can be on: one notification, two routes.
    const routes = el('div', { class: 'nlog-routes' });
    // NOTE the `is-` prefix: a bare `.popup` here also matched the app's popup
    // MODAL class in components.css (width:100%; max-width:360px; display:flex),
    // which stretched this chip across the row. Namespaced modifiers only.
    if (e.popup) routes.append(el('span', { class: 'nlog-route is-popup', text: '🔔 Popup', title: 'Shown as a system notification' }));
    if (e.gmail) routes.append(el('span', { class: 'nlog-route is-email', text: '✉ Email', title: 'Sent to your account email' }));
    main.append(routes);

    row.append(time, main);
    return row;
  }
}
