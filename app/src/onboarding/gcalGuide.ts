// Cobalt: the "where is my Google Calendar secret address" slideshow.
//
// The schedule screen's counterpart to icalGuide.ts (Gabe, 10/8: "very similar to
// what the iCal used to look like", an animated slideshow instead of a list of
// steps). Five slides along the real route in Google Calendar on the web:
//
//   1. Google Calendar: press the gear in the top right.
//   2. The menu opens: press Settings.
//   3. Settings: under "Settings for my calendars", press your own calendar.
//   4. That calendar's page: scroll down.
//   5. "Integrate calendar": copy "Secret address in iCal format", paste it back.
//
// Same fidelity rules as the Schoology guide: the slides copy Google Calendar's
// own light UI (Google's whites, greys and blue), only the instructional layer
// (cursor, highlights, arrows) is Cobalt's accent, nothing is school-specific,
// and every element drawn exists on the real page. Slides 4 and 5 render the
// "Integrate calendar" section from ONE snippet so the scroll in slide 4 reveals
// exactly what slide 5 dwells on.
//
// Engine, timing classes and player are icalGuide.ts's, imported, not copied.

import { scene, T, B, cursor, hl, arrow, openSlideGuide, type Slide } from './icalGuide';

// ---- palette: Google Calendar's ----------------------------------------------
const PAGE = '#ffffff';
const LINE = '#dadce0';
const TXT = '#3c4043';
const DIM = '#5f6368';
const BLUE = '#1a73e8'; // Google blue
const SEL = '#e8f0fe'; // the selected sidebar row
const FIELD = '#f1f3f4'; // read-only field fill
const CAL = '#039be5'; // the default calendar colour ("Peacock")

// ---- shared Google Calendar chrome ------------------------------------------
/** The calendar's top bar: menu, logo, Today, arrows, month; search, help, the
 *  gear, the view switcher and the account circle on the right. */
function topBar(gearHot = false): string {
  return (
    B(0, 43, 460, 1, LINE, 0) +
    T(16, 28, 13, DIM, '≡', 700) +
    // the calendar logo: a blue-edged tile with the date
    B(36, 13, 20, 20, PAGE, 3, `stroke="${BLUE}" stroke-width="1.5"`) +
    T(46, 28, 9, BLUE, '31', 800, 'middle') +
    T(62, 28, 12, DIM, 'Calendar', 500) +
    B(128, 15, 40, 18, PAGE, 9, `stroke="${LINE}"`) +
    T(148, 27, 8, TXT, 'Today', 600, 'middle') +
    T(178, 28, 11, DIM, '‹  ›', 600) +
    T(204, 28, 11, TXT, 'October 2026', 500) +
    T(320, 28, 11, DIM, '🔍') +
    T(342, 28, 11, DIM, '?', 700) +
    (gearHot ? `<circle cx="365" cy="24" r="10" fill="#eef0f1"/>` : '') +
    T(365, 28.5, 13, DIM, '⚙', 500, 'middle') +
    B(382, 15, 44, 18, PAGE, 9, `stroke="${LINE}"`) +
    T(404, 27, 8, TXT, 'Week ⌄', 600, 'middle') +
    `<circle cx="442" cy="24" r="9" fill="#7b61c4"/>`
  );
}

/** Faint week grid under the bar so the first two slides read as the calendar. */
function weekBody(): string {
  let g = '';
  for (let d = 0; d < 5; d++) {
    const x = 70 + d * 76;
    g += T(x + 30, 62, 7, DIM, ['MON', 'TUE', 'WED', 'THU', 'FRI'][d], 600, 'middle');
    g += B(x, 70, 1, 180, LINE, 0);
  }
  for (let h = 0; h < 5; h++) g += B(60, 90 + h * 34, 390, 1, '#eef0f1', 0);
  return (
    g +
    B(74, 98, 66, 26, '#9fc3f2', 4) +
    B(150, 132, 66, 26, '#9fc3f2', 4) +
    B(226, 98, 66, 26, '#9fc3f2', 4) +
    B(302, 166, 66, 26, '#9fc3f2', 4)
  );
}

/** The Settings page: its header and the left-hand list, with your own calendar
 *  under "Settings for my calendars". `selected` paints the row Google highlights
 *  once that calendar is open. */
function settingsFrame(selected: boolean): string {
  return (
    B(0, 43, 460, 1, LINE, 0) +
    T(16, 28, 12, DIM, '←', 600) +
    T(36, 28, 12, TXT, 'Settings', 500) +
    T(16, 64, 8.5, TXT, 'General', 600) +
    T(16, 84, 8.5, TXT, 'Add calendar', 600) +
    T(16, 104, 8.5, TXT, 'Import &amp; export', 600) +
    T(16, 128, 8.5, TXT, 'Settings for my calendars', 700) +
    (selected ? B(0, 136, 148, 20, SEL, 0) : '') +
    `<circle cx="24" cy="146" r="4" fill="${CAL}"/>` +
    T(34, 149, 8.5, selected ? BLUE : TXT, 'Your Name', selected ? 700 : 500) +
    B(150, 44, 1, 216, LINE, 0)
  );
}

/** The top of a calendar's own settings page, what you land on after picking it. */
function calendarSettingsTop(): string {
  return (
    T(170, 66, 10, TXT, 'Calendar settings', 600) +
    T(170, 88, 7.5, DIM, 'Name') +
    B(170, 92, 260, 18, FIELD, 4) +
    T(176, 104, 7.5, TXT, 'Your Name') +
    T(170, 128, 7.5, DIM, 'Description') +
    B(170, 132, 260, 26, FIELD, 4) +
    T(170, 178, 7.5, DIM, 'Time zone') +
    B(170, 182, 260, 18, FIELD, 4) +
    T(170, 222, 10, TXT, 'Access permissions for events', 600)
  );
}

/** "Integrate calendar", the section the guide exists to find. ONE definition,
 *  shown by slide 4 (revealed by the scroll) and slide 5, so they are identical.
 *  The secret address is hidden behind dots on the real page, with the show
 *  (eye) and copy buttons beside it. */
function integrateSection(): string {
  return (
    T(170, 66, 10, TXT, 'Integrate calendar', 600) +
    T(170, 86, 7.5, DIM, 'Calendar ID') +
    B(170, 90, 260, 16, FIELD, 4) +
    T(170, 122, 7.5, DIM, 'Public address in iCal format') +
    B(170, 126, 260, 16, FIELD, 4) +
    T(170, 162, 7.5, TXT, 'Secret address in iCal format', 700) +
    B(170, 167, 214, 20, FIELD, 4) +
    T(178, 180, 9, DIM, '••••••••••••••••••••••••••••') +
    // show + copy, the two buttons beside the field
    `<circle cx="398" cy="177" r="9" fill="none" stroke="${LINE}"/>` +
    T(398, 180.5, 8.5, DIM, '◉', 500, 'middle') +
    `<circle cx="420" cy="177" r="9" fill="none" stroke="${LINE}"/>` +
    B(415.5, 172, 7, 8, PAGE, 1.5, `stroke="${DIM}"`) +
    B(418, 174.5, 7, 8, PAGE, 1.5, `stroke="${DIM}"`) +
    T(170, 204, 7, DIM, 'Warning: Only share this address with those you trust')
  );
}

// ---- the slides --------------------------------------------------------------
const SLIDES: Slide[] = [
  // 1 · the gear
  {
    cap: 'Open <b>Google Calendar</b> on a computer, signed in with your <b>school account</b>. Press the <b>gear</b> in the top right.',
    svg: scene(topBar() + weekBody() + hl(352, 11, 26, 26) + cursor(220, 170, 361, 22), PAGE),
  },
  // 2 · Settings
  {
    cap: 'A menu opens. Press <b>Settings</b>.',
    svg: scene(
      topBar(true) +
        weekBody() +
        B(300, 40, 110, 96, PAGE, 6, `stroke="${LINE}"`) +
        B(300, 48, 110, 22, '#f1f3f4', 0) +
        T(314, 63, 9, TXT, 'Settings', 500) +
        T(314, 87, 9, TXT, 'Trash', 500) +
        T(314, 107, 9, TXT, 'Appearance', 500) +
        T(314, 127, 9, TXT, 'Print', 500) +
        hl(298, 46, 114, 26) +
        cursor(361, 22, 336, 58),
      PAGE
    ),
  },
  // 3 · your own calendar
  {
    cap: 'On the left, under <b>Settings for my calendars</b>, press <b>your own calendar</b> (it has your name).',
    svg: scene(settingsFrame(false) + hl(4, 136, 142, 20) + cursor(260, 120, 60, 144), PAGE),
  },
  // 4 · scroll (the top of the page fades out, the section fades in, simulating
  //     the scroll; the section is the SAME snippet slide 5 shows)
  {
    cap: 'That calendar’s settings open. <b>Scroll down</b> to <b>Integrate calendar</b>.',
    svg: scene(
      settingsFrame(true) +
        `<g class="bf">${calendarSettingsTop()}</g>` +
        `<g class="af">${integrateSection()}</g>` +
        arrow(300, 228, 300, 252),
      PAGE
    ),
  },
  // 5 · the address (no copy animation on purpose, same as the Schoology guide:
  //     students know how to copy; the guide only has to show WHERE it lives)
  {
    cap: 'Copy the <b>Secret address in iCal format</b> with the copy button, then paste it back in Cobalt. <a href="https://calendar.google.com/calendar/r/settings" target="_blank" rel="noopener">Open Google Calendar settings →</a>',
    svg: scene(settingsFrame(true) + integrateSection() + hl(166, 152, 268, 40), PAGE),
  },
];

/** Open the slideshow. `onClose` fires on any dismissal, so the caller can put
 *  the caret back in the address field. */
export function openGcalGuide(onClose?: () => void): void {
  openSlideGuide(
    {
      slides: SLIDES,
      label: 'Where to find your Google Calendar address',
      title: 'Where your calendar address lives',
      sub: 'Three clicks and a scroll. About 20 seconds.',
    },
    onClose
  );
}
