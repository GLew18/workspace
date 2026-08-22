// Cobalt: the 🔔 Notifications screen (a full tab, like Settings).
//
// A plain history of what Cobalt has told you, newest first, grouped by day.
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
// The timestamp and day-heading formatters used to live here as private
// functions. The Task Archives is the same shape of screen and wanted both
// verbatim, so they moved to util/dates.ts rather than being copied: two private
// copies of "what day is this" is how the two screens end up disagreeing about
// where Yesterday ends.
import { formatWallClock, formatDayHeading } from '../util/dates';

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
    // OPEN AT THE TOP (Gabe, 8/10) is now every tab's behaviour, not this
    // screen's private fix: mountTabs calls openAtTop after onShow (ui/tabs.ts).
    // The document-wide `.app-below` lookup that used to live here is gone with
    // it — it could reach into the landing demo's own shell.
    //
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
        text: 'Everything Cobalt has sent you on this device, newest first.',
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
      const label = formatDayHeading(e.at);
      if (label !== lastDay) {
        lastDay = label;
        host.append(el('div', { class: 'nlog-day', text: label }));
      }
      host.append(this.row(e));
    }
  }

  private row(e: NotifyLogEntry): HTMLElement {
    const row = el('div', { class: 'nlog-row' });

    const time = el('div', { class: 'nlog-time', text: formatWallClock(e.at) });

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
