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

const UPDATED = 'September 7, 2026';

/** Renders the full policy page. Pure and stateless: no data reads, no auth
 *  calls, nothing that could fail for a signed-out or account-less visitor. */
export function renderPrivacyPage(): HTMLElement {
  const root = el('div', { class: 'landing' });

  // A minimal version of the landing nav: wordmark + a single "Back to Cobalt"
  // link. Real <a> elements, not click handlers into router.ts — this page is
  // not part of the signed-in tab system, so a plain navigation is the honest
  // mechanism rather than a second router bolted on for one link.
  const nav = el('nav', { class: 'lp-nav' });
  const brand = el('a', { class: 'lp-nav-brand', href: '/', 'aria-label': 'Cobalt, back to home' });
  brand.append(createWordmark().el);
  const back = el('a', { class: 'lp-nav-login', href: '/', text: 'Back to Cobalt' });
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
      '© 2026 Cobalt · ',
      el('a', { href: '/', text: 'cobaltstudy.com' }),
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
      'Cobalt is a study tool built for high school students to organize Schoology assignments, run focus sessions, and keep useful links in one place. It was built for and is used by students at the Abraham Joshua Heschel School, though anyone with a Schoology account can use it.',
      'Cobalt does not claim compliance with any specific children’s privacy or student-records law, including COPPA or FERPA. If your school requires that kind of certification before you can use Cobalt, check with your school before signing up.',
    ],
  },
  {
    heading: 'Your account',
    paragraphs: [
      'Creating an account uses Firebase Authentication, Google’s account and sign-in service. You can sign up with an email address and password, or with an existing Google account. Either way, Cobalt receives your email address and, if you use Google, your Google display name and profile photo.',
      'If you sign up with a password, Cobalt sends you a verification email and, if you ever need one, a password reset email. Both are sent by Cobalt itself (see “Email” below), not by a generic Firebase sender.',
    ],
  },
  {
    heading: 'What Cobalt stores',
    paragraphs: [
      'Once you’re signed in, Cobalt stores the data your account holds in Firebase Realtime Database, under a record tied to your account. That includes:',
    ],
    list: [
      'Your tasks: titles, due dates, courses, priorities, notes, and any links you attach to them.',
      'Your Focus session settings and history.',
      'Your bookmarks and bookmark groups.',
      'Your profile (display name, course list and colors) and app preferences.',
      'If you connect Schoology, the calendar feed link Schoology gives you, and the sync history for it.',
    ],
  },
  {
    heading: 'Connecting Schoology',
    paragraphs: [
      'To import your assignments, you give Cobalt your personal Schoology calendar link (an iCal feed Schoology generates for your account). When you sync, a Cobalt server function fetches that link on your behalf and reads back the calendar file. That fetch happens on the server, not in your browser, so the link itself is never exposed to anyone else. The server does not keep a copy of the raw calendar file: it hands the contents straight back to your device, where Cobalt turns each event into a task in your account. Only the resulting tasks are stored.',
      'If you install the companion Cobalt Chrome extension, it can additionally read your own, already-logged-in Schoology pages to pick up real course names (Schoology’s calendar feed does not include them), so your imported assignments show actual class names instead of a guess. See “The Cobalt Chrome extension” below for what that extension can access.',
    ],
  },
  {
    heading: 'Task title translation',
    paragraphs: [
      'If a task title looks like it isn’t in English, Cobalt can translate it for you. Translating a title sends that title’s text to Google Cloud’s Translation API, a third-party service, which returns the English translation. This happens through a Cobalt server function, never with an API key exposed in your browser.',
      'To avoid translating the same assignment title over and over for every student who imports it, Cobalt caches translations in its own database, keyed to a scrambled (hashed) version of the text rather than to you or your account. Translated titles you’ve accepted are stored on the task itself, in your account, the same way any other task field is.',
    ],
  },
  {
    heading: 'Email',
    paragraphs: [
      'Cobalt sends account email (verification, password reset) and, if you turn them on, assignment reminder emails. All of it goes through a Firebase extension ("Trigger Email") that delivers mail on Cobalt’s behalf; every message is sent from Cobalt’s own address, never a shared or generic one. Reminder emails go only to the email address on your account, and only once it’s verified.',
      'Cobalt also has an in-app feedback box. A message you send there is delivered directly to the developer without your name, email, or account id attached.',
    ],
  },
  {
    heading: 'Push notifications',
    paragraphs: [
      'If you enable push notifications, your browser issues a device token (through Firebase Cloud Messaging) that Cobalt stores against your account so a server function can deliver reminders to that device while the app is closed. The token identifies your browser installation, not you personally, and it’s only ever used to send you the reminders you configured.',
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
      'Cobalt Premium, the optional companion extension, requests broad browser permissions because two of its features are genuinely cross-site: opening a saved bookmark from anywhere with a keyboard shortcut, and grouping your bookmark tabs together when you open them. In practice:',
    ],
    list: [
      'On any page, it watches for the keyboard shortcuts you’ve configured and opens the matching bookmark. It does not read or transmit the page’s content.',
      'On Schoology pages specifically, once you’re logged in there yourself, it reads your course names and assignment-to-course mapping directly off the page, so Cobalt can label imported assignments correctly. It never reads, stores, or sends your Schoology login cookies or password.',
      'On Cobalt’s own site, it exchanges messages with the Cobalt web app (for example, to sync your shortcut list) and can open a named, colored group of browser tabs when you use “Open all.”',
    ],
  },
  {
    heading: 'What Cobalt does not do',
    paragraphs: [
      'Cobalt does not sell your data, does not run advertising, and does not use any third-party analytics or tracking service. The only outside services your data ever passes through are the ones named above: Firebase (Google) for accounts, hosting and storage, and Google Cloud Translation for the specific feature described above.',
    ],
  },
  {
    heading: 'Deleting your data',
    paragraphs: [
      [
        'To delete your account and everything stored under it, email ',
        el('a', { href: 'mailto:gabriel.lewinsohn@gmail.com', text: 'gabriel.lewinsohn@gmail.com' }),
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
      [
        'Questions about this policy or your data can go to ',
        el('a', { href: 'mailto:gabriel.lewinsohn@gmail.com', text: 'gabriel.lewinsohn@gmail.com' }),
        '.',
      ],
    ],
  },
];
