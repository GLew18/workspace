// Cobalt: Onboarding Preview — the REAL onboarding flow (src/onboarding/view.ts)
// on sample data, for auditing every screen without making an account (Gabe, 10/8:
// "create an artifact of the entire onboarding verbatim").
//
// The screens, their CSS and their behaviour are the app's own. Two things are
// added for the audit and are not part of the app: the jump bar along the bottom,
// and seeded courses (as a Schoology connection would find them), so the Courses
// screen can be seen without connecting. Anything that talks to a server
// (connecting Schoology, reading a calendar, the final import) fails here.
//
// Build:   node scripts/build-lab.mjs onboarding   (from app/)
// Dev:     /onbpreview.html on the dev server

// Every stylesheet main.ts loads, in the same order, so nothing renders unstyled.
import '../src/ui/theme.css';
import '../src/ui/components.css';
import '../src/ui/colorPicker.css';
import '../src/ui/focus.css';
import '../src/ui/dashboard.css';
import '../src/ui/settings.css';
import '../src/ui/notifylog.css';
import '../src/ui/bookmarks.css';
import '../src/ui/tests.css';
import '../src/ui/landing.css';
import '../src/ui/auth.css';
import '../src/ui/onboarding.css';
import './onbPreview.css';
import { runOnboarding } from '../src/onboarding/view';
import { createSandboxData } from '../src/landing/sandbox';
import { nextCourseColor } from '../src/courses/colors';
import type { CourseConfig } from '../src/types';
import ICON from '../public/icons/icon.svg';

const NAMES = ['Lab Seminar', 'Biology', 'Mathematics', 'English Language & Composition', 'World History'];
const LABELS = ['Welcome', 'Auto-import', 'Connect', 'Courses', 'Schedule', 'Languages', 'Done'];

// The welcome mark is an absolute /icons path in the app; the preview has no such
// path, so it is swapped for the same file inlined.
new MutationObserver(() => {
  for (const img of document.querySelectorAll<HTMLImageElement>('img[src="/icons/icon.svg"]')) img.src = ICON;
}).observe(document.body, { childList: true, subtree: true });

// The direct Schoology connection is behind ?sgyapi=1 until PowerSchool publishes
// the app, and that version of the Connect screen is the one being audited.
try {
  history.replaceState(null, '', location.pathname + '?sgyapi=1' + location.hash);
} catch {
  /* a frame that refuses it still gets the flag from storage below */
}
try {
  localStorage.setItem('cobalt:sgyApi', '1');
} catch {
  /* blocked storage: the address above carries it */
}

void (async () => {
  const data = await createSandboxData({ profile: { account: { displayName: '', onboarded: false } } });
  runOnboarding({
    data,
    email: 'dan.sample@example.com',
    fallbackName: 'Dan',
    onDone: () => location.reload(),
    preview: ({ go, count, draft }) => {
      const courses: CourseConfig[] = [];
      for (const name of NAMES) {
        courses.push({ id: 'course_' + courses.length, name, color: nextCourseColor(courses.map((c) => c.color)), parseWords: [] });
      }
      draft.courses = courses;

      const bar = document.createElement('nav');
      bar.className = 'onbp-bar';
      bar.append(Object.assign(document.createElement('span'), { className: 'onbp-tag', textContent: 'Preview' }));
      for (let i = 0; i < count; i++) {
        const b = document.createElement('button');
        b.textContent = `${i + 1} · ${LABELS[i] ?? 'Screen'}`;
        b.addEventListener('click', () => go(i));
        bar.append(b);
      }
      document.body.append(bar);
    },
  });
})();
