// Cobalt: privacy policy page, at the route /privacy.
//
// WHY THIS EXISTS AS ITS OWN THING, NOT A TAB. Every other view in this app is
// either the signed-out landing page or one of the signed-in tabs in
// util/router.ts, both of which assume an auth state. This page must render
// identically whichever state the visitor is in, and without ever touching
// Firebase — Google's own reviewer has to be able to load it cold, signed out,
// with no account. So main.ts intercepts "/privacy" before any auth wiring
// runs at all (see isPrivacyPath there) and mounts this in isolation.
//
// Reuses the landing page's nav/footer chrome and CSS tokens (landing.css,
// theme.css) rather than inventing a second look. Every fact below was read
// out of the real source before being written — see the audit trail in the
// session that built this file — not assumed from what the app "probably"
// does.

import { el } from '../util/dom';
import { createWordmark } from '../ui/laurel';

const UPDATED = 'October 7, 2026';

/** The one public contact address, for support, suggestions and data requests.
 *  A forwarding alias on the cobaltstudy.com domain, so no personal address is
 *  ever published (Gabe, 10/7). */
const CONTACT = 'help@cobaltstudy.com';
const contactLink = (): HTMLElement => el('a', { href: `mailto:${CONTACT}`, text: CONTACT });

/** Renders the full policy page. Pure and stateless: no data reads, no auth
 *  calls, nothing that could fail for a signed-out or account-less visitor. */
export function renderPrivacyPage(): HTMLElement {
  const root = el('div', { class: 'landing lp-legal-page' });

  // A minimal version of the landing nav: wordmark + a single "Back to Cobalt"
  // link. Real <a> elements, not click handlers into router.ts — this page is
  // not part of the signed-in tab system, so a plain navigation is the honest
  // mechanism rather than a second router bolted on for one link.
  const nav = el('nav', { class: 'lp-nav' });
  const brand = el('a', { class: 'lp-nav-brand', href: '/', 'aria-label': 'Cobalt, back to home' });
  brand.append(createWordmark().el);
  const back = el('a', { class: 'lp-nav-cta', href: '/', text: 'Back to Cobalt' });
  nav.append(brand, el('div', { class: 'lp-nav-links' }), el('div', { class: 'lp-nav-actions' }, [back]));
  root.append(nav);

  const main = el('main', { class: 'lp-legal' });
  main.append(
    el('h1', { text: 'Privacy Policy' }),
    el('p', { class: 'lp-legal-updated', text: `Last updated: ${UPDATED}` })
  );

  for (const section of SECTIONS) main.append(...renderSection(section));
  root.append(main);

  const footer = el('footer', { class: 'lp-footer' });
  footer.append(
    el('div', { class: 'lp-footer-rule' }),
    el('div', { class: 'lp-footer-base' }, [
      '© 2026 Cobalt · All rights reserved',
    ])
  );
  root.append(footer);

  return root;
}

interface Section {
  heading: string;
  paragraphs: (string | (string | HTMLElement)[])[];
  list?: string[];
}

function renderSection(s: Section): HTMLElement[] {
  const out: HTMLElement[] = [el('h2', { text: s.heading })];
  for (const p of s.paragraphs) {
    out.push(typeof p === 'string' ? el('p', { text: p }) : el('p', {}, p));
  }
  if (s.list) {
    const ul = el('ul');
    for (const item of s.list) ul.append(el('li', { text: item }));
    out.push(ul);
  }
  return out;
}

// Every claim below traces to a real file: app/src/auth.ts, app/src/db.ts,
// app/src/firebase-backend.ts, app/functions/index.js, app/extension/manifest.json
// and its content scripts, and app/functions/extensions/firestore-send-email.env.
const SECTIONS: Section[] = [
  {
    heading: 'Who Cobalt is for',
    paragraphs: [
      'Cobalt is a study tool built for high school students to organize Schoology assignments, run focus sessions, and keep useful links in one place. Anyone with a Schoology account can use it.',
      'Cobalt does not claim compliance with any specific children’s privacy or student-records law, including COPPA or FERPA. If your school requires that kind of certification before you can use Cobalt, check with your school before signing up.',
    ],
  },
  {
    heading: 'Your account',
    paragraphs: [
      'Creating an account uses Firebase Authentication, Google’s account and sign-in service. You can sign up with an email address and password, or with an existing Google account. Either way, Cobalt receives your email address and, if you use Google, your Google display name and profile photo. Cobalt also records which sign-in methods your account uses.',
      'If you sign up with a password, Cobalt sends you a verification email and, if you ever need one, a password reset email. Both are sent by Cobalt itself (see “Reminders and email” below), not by a generic Firebase sender.',
    ],
  },
  {
    heading: 'What Cobalt stores',
    paragraphs: [
      'Once you’re signed in, Cobalt stores the data your account holds in Firebase Realtime Database, under a record only your account can read. That includes:',
    ],
    list: [
      'Your tasks: titles, due dates, courses, priorities, notes, and any links you attach to them.',
      'Your folders, and a record of which assignments have already been imported, so they aren’t imported twice.',
      'Your Focus session settings and history.',
      'Your bookmarks and bookmark groups.',
      'Your profile (display name, course list and colors) and app preferences, including notification settings and your notification history.',
      'The course-matching hints Cobalt learns from your task titles, so new assignments land in the right course.',
      'Your Gems balance, the tasks that earned them, and the cosmetics you own and use.',
      'If you connect Schoology, the calendar feed link Schoology gives you, and the sync history for it.',
      'If you add your class schedule, its Google Calendar feed link and any schedule link you save. Treat a calendar feed link like a password: anyone who has it can read that calendar.',
    ],
  },
  {
    heading: 'Backups on your device',
    paragraphs: [
      'To protect against accidental data loss, your browser keeps up to 14 days of backup copies of your account in its own local storage. These copies stay on your device and are never uploaded anywhere else.',
    ],
  },
  {
    heading: 'Connecting Schoology',
    paragraphs: [
      'There are two ways to bring in your assignments.',
      'With a calendar link: you give Cobalt your personal Schoology calendar link (an iCal feed Schoology generates for your account). When you sync, a Cobalt server function fetches that link on your behalf and reads back the calendar file. The server does not keep a copy of the raw calendar file: it hands the contents straight back to your device, where Cobalt turns each event into a task in your account. Only the resulting tasks are stored. A Google Calendar schedule link is fetched the same way.',
      'By connecting your Schoology account directly: you approve Cobalt on your school’s own Schoology page, so Cobalt never sees your Schoology password. Cobalt’s server then keeps a private access key for your account, which your browser never receives, and uses it to read your upcoming assignments (the next 60 days) and your class names from Schoology. Cobalt also saves your Schoology name, your school’s Schoology address, and when you connected. The access key is deleted when you disconnect, or when Schoology expires it after about 90 days.',
      'If you install the companion Cobalt Chrome extension, it can also read your own, already-logged-in Schoology pages. See “The Cobalt Chrome extension” below for exactly what it reads.',
    ],
  },
  {
    heading: 'Task title translation',
    paragraphs: [
      'If a task title looks like it isn’t in English, Cobalt can translate it for you. Translating a title sends that title’s text to Google Cloud’s Translation API, a third-party service, which returns the English translation. This happens through a Cobalt server function, never with an API key exposed in your browser.',
      'To avoid translating the same assignment title over and over for every student who imports it, Cobalt caches translations in its own database for up to 180 days, keyed to a scrambled (hashed) version of the text rather than to you or your account. To cap usage, Cobalt also keeps a daily count of how many titles you’ve translated, stored under a scrambled version of your account id. Translated titles you’ve accepted are stored on the task itself, in your account, the same way any other task field is.',
    ],
  },
  {
    heading: 'Reminders and email',
    paragraphs: [
      'Cobalt sends account email (verification, password reset) and, if you turn them on, assignment reminder emails. All of it goes through a Firebase extension (“Trigger Email”) that delivers mail on Cobalt’s behalf, from Cobalt’s own address. Reminder emails include the titles of the tasks they remind you about, and go only to the email address on your account, once it’s verified.',
      'So that reminders arrive even when Cobalt is closed, a Cobalt server job checks your tasks and notification settings every 5 minutes.',
      'Every email Cobalt sends, including suggestions (below), is queued in Cobalt’s database to be delivered, and those queued copies are not automatically deleted.',
    ],
  },
  {
    heading: 'Suggestions',
    paragraphs: [
      'Cobalt has an in-app suggestion box. A message you send there is delivered without your name, email, or account id. It does carry a short code made from a scrambled version of your account id, so several messages from the same person can be recognized as coming from one sender (for example, to stop spam), along with the name of the screen you sent it from.',
    ],
  },
  {
    heading: 'Push notifications',
    paragraphs: [
      'If you enable push notifications, your browser issues a device token (through Firebase Cloud Messaging) that Cobalt stores against your account, together with your browser and device type, so a server function can deliver reminders to that device while the app is closed. The token identifies your browser installation, not you personally, and it’s only ever used to send you the reminders you configured.',
    ],
  },
  {
    heading: 'Focus music',
    paragraphs: [
      'The music in Focus sessions is a static library of licensed and public-domain tracks served directly from Cobalt’s own hosting. Playing a track requests that file the same way loading any other part of the page does; it isn’t tied to your account or logged anywhere beyond normal web server access logs.',
    ],
  },
  {
    heading: 'The Cobalt Chrome extension',
    paragraphs: [
      'The optional companion extension (listed in Chrome as “Cobalt Premium”) requests broad browser permissions because two of its features are genuinely cross-site: opening a saved bookmark from anywhere with a keyboard shortcut, and grouping your bookmark tabs together when you open them. In practice:',
    ],
    list: [
      'On any page, it watches for the keyboard shortcuts you’ve configured and opens the matching bookmark. It does not read or transmit the page’s content.',
      'On Schoology pages specifically, once you’re logged in there yourself, it reads your assignments (title, description, due date, and link) and your class names, so Cobalt can import them and label them with the right course. It never reads, stores, or sends your Schoology login cookies or password.',
      'On Cobalt’s own site, it exchanges messages with the Cobalt web app (for example, to sync your shortcut list or pass along what it read from Schoology) and can open a named, colored group of browser tabs when you use “Open all.”',
    ],
  },
  {
    heading: 'Outside services',
    paragraphs: [
      'Cobalt does not sell your data, does not run advertising, and does not use any third-party analytics or tracking service. Besides the services named above (Firebase from Google for accounts, hosting and storage; Google Cloud Translation; Schoology; and Google Calendar), your browser contacts:',
    ],
    list: [
      'Google Fonts, to load the font Cobalt uses. Like loading any web page, this shares your IP address with Google.',
      'Google’s and DuckDuckGo’s website-icon services, to show the icon next to each bookmark. These services see the web addresses of the sites you’ve bookmarked.',
    ],
  },
  {
    heading: 'Deleting your data',
    paragraphs: [
      [
        'To delete your account and everything stored under it, email ',
        contactLink(),
        ' from the address on your account. Cobalt does not yet have a self-serve delete button in the app; a request by email is the current way to ask for one.',
      ],
    ],
  },
  {
    heading: 'Changes to this policy',
    paragraphs: [
      'If this policy changes in a way that matters, the date at the top of this page will change with it. Continuing to use Cobalt after an update means you’ve accepted the current version.',
    ],
  },
  {
    heading: 'Contact',
    paragraphs: [
      ['Questions about this policy or your data can go to ', contactLink(), '.'],
    ],
  },
];
