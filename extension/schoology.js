// Cobalt Premium: Schoology course-labeling content script.
//
// Runs on https://*.schoology.com/* at document_idle. The iCal feed the app
// imports has NO course names, so the app guesses courses heuristically. This
// script reads the REAL course labels from the student's own logged-in pages
// (the same session access Schoology's UI itself uses) and ships them to the
// background SW, which persists them under chrome.storage.local['sgy:data'].
//
// The join key: Schoology links every assignment as /assignment/<id>, and the
// app's imported task ids are 'ical_assign_' + that same id — so the
// assignmentId -> courseName map here labels tasks EXACTLY, no fuzzy matching.
//
// Ground rules (non-negotiable):
//   • Read-only. Never mutates the Schoology page, never blocks load, never
//     throws into the host page — every entry point is try/caught and failure
//     degrades to silence (partial payloads still get sent, with diag).
//   • Session cookies ride along implicitly on same-origin fetch. We never
//     read, store, or transmit cookies — and never touch credentials.
//   • Scrapes ONLY the signed-in student's own pages. Logged-out? Bail quietly.
//
// Payload shape (must match app/src/schoology + background.js EXACTLY):
//   SgyCourse  = { id, name }                      // id from /course/<id>
//   SgyPayload = { host, icalUrl?, courses: SgyCourse[],
//                  labels: { [assignmentId]: courseName },
//                  scrapedAt, diag? }
//
// Testability: the extractors are PURE (Document/HTML-string in, data out) and
// exposed on globalThis.__wsSgy so they can be unit-tested against fixture HTML
// outside Chrome. Return shapes:
//   parseAssignmentId(href)            -> string | null
//   parseCourseId(href)                -> string | null
//   extractCoursesFromDoc(doc)         -> SgyCourse[]
//   extractLabelsFromDoc(doc, courses?)-> { labels: {id:name}, counts: {...} }
//   extractAssignmentIdsFromDoc(doc)   -> string[]
//   extractIcalUrlFromDoc(docOrHtml)   -> string | null
//   isLoginDoc(doc)                    -> boolean

(() => {
  'use strict';

  // Idempotency, same pattern as content.js's __wsShortcutsLoaded: this file can
  // arrive via BOTH the manifest entry and programmatic re-injection from
  // background.js, and the second copy must be a no-op. globalThis (not window)
  // so the guard also works when the file is loaded in a Node/jsdom test.
  if (globalThis.__wsSgyLoaded) return;
  globalThis.__wsSgyLoaded = true;

  // ============================ pure extractors =============================
  // Schoology markup varies by school AND by era (legacy server-rendered vs
  // newer React shells), so every extractor stacks several selector strategies.
  // Selectors use [class*=...] substring matching on purpose: React builds
  // suffix class names ("upcoming-list_xyz"), legacy uses plain ones.

  const ASSIGN_RE = /\/assignment\/(\d+)/i; // mirrors app/src/schoology/ical.ts
  const COURSE_RE = /\/course\/(\d+)/i;

  function parseAssignmentId(href) {
    if (typeof href !== 'string') return null;
    const m = href.match(ASSIGN_RE);
    return m ? m[1] : null;
  }

  function parseCourseId(href) {
    if (typeof href !== 'string') return null;
    const m = href.match(COURSE_RE);
    return m ? m[1] : null;
  }

  function textOf(el) {
    return el && el.textContent ? el.textContent.replace(/\s+/g, ' ').trim() : '';
  }

  // Course-link anchors also point at subpages (/course/<id>/materials) whose
  // link TEXT is "Materials"/"Grades"/etc. — real course ids, junk names. This
  // filter keeps the id harvest while rejecting the junk as a display name.
  const NON_NAME_RE = /^(materials?|updates?|grades?|grade report|members?|assignments?|attendance|badges|courses?|all courses|see all|more|options|course options|upcoming|overdue|calendar|info|admin)$/i;

  function plausibleCourseName(t) {
    if (!t || t.length < 2 || t.length > 120) return false;
    if (NON_NAME_RE.test(t)) return false;
    if (/^\d+$/.test(t)) return false; // bare ids are not names
    return true;
  }

  /**
   * COURSES — every /course/<id> reference with a human-readable title.
   * Dedupes by id; on conflict keeps the LONGEST name (fidelity: "Algebra 2:
   * Section 3" beats a truncated dropdown "Algebra 2"). No suffix-stripping —
   * the section suffix is real information and guessing what's "redundant"
   * across schools is exactly the cleverness that breaks silently.
   */
  function extractCoursesFromDoc(doc) {
    const byId = new Map();
    const add = (id, name) => {
      if (!id || !plausibleCourseName(name)) return;
      const cur = byId.get(id);
      if (!cur || name.length > cur.length) byId.set(id, name);
    };

    try {
      // Strategy 1: any anchor into a course realm — covers the courses
      // dropdown, the /courses page, sidebars, and breadcrumbs in one sweep.
      for (const a of doc.querySelectorAll('a[href*="/course/"]')) {
        add(parseCourseId(a.getAttribute('href') || ''), textOf(a));
      }
      // Strategy 2: realm/course title elements that WRAP or SIT BESIDE the
      // link instead of being the link (the newer React card markup).
      for (const el of doc.querySelectorAll('[class*="realm-title"], [class*="course-title"]')) {
        const name = textOf(el);
        if (!plausibleCourseName(name)) continue;
        const a =
          (el.closest && el.closest('a[href*="/course/"]')) ||
          el.querySelector('a[href*="/course/"]') ||
          (el.parentElement && el.parentElement.querySelector('a[href*="/course/"]'));
        if (a) add(parseCourseId(a.getAttribute('href') || ''), name);
      }
    } catch (_e) {
      /* partial results are fine */
    }

    const out = [];
    for (const [id, name] of byId) out.push({ id, name });
    return out;
  }

  /**
   * Nearest course text for an assignment anchor: walk up a few ancestors and
   * accept a container that names EXACTLY ONE course. More than one course-ish
   * element in the container means we've climbed into a page-level list where
   * any pick would be a guess — refuse rather than mislabel (a wrong label is
   * worse than no label; the app's heuristic still covers unlabeled tasks).
   */
  function courseTextNear(start) {
    let node = start;
    for (let depth = 0; node && node.querySelectorAll && depth < 7; depth++, node = node.parentElement) {
      const hits = node.querySelectorAll('[class*="realm-title"], [class*="course-title"], a[href*="/course/"]');
      const names = [];
      for (const h of hits) {
        const t = textOf(h);
        if (plausibleCourseName(t) && names.indexOf(t) === -1) names.push(t);
      }
      if (names.length === 1) return names[0];
      if (names.length > 1) return null; // ambiguous container — bail
    }
    return null;
  }

  /** Fallback when sibling markup names nothing: does the event's own text or
   *  title attribute CONTAIN a known course name? Longest match wins so
   *  "AP Biology" beats "Biology" when both exist. */
  function matchKnownCourse(text, courses) {
    if (!text || !courses || !courses.length) return null;
    const t = text.toLowerCase();
    let best = null;
    for (const c of courses) {
      const n = (c.name || '').toLowerCase();
      // 4-char minimum keeps short names ("Art") from substring-matching noise.
      if (n.length >= 4 && t.indexOf(n) !== -1 && (!best || n.length > best.length)) best = c.name;
    }
    return best;
  }

  /**
   * LABELS — assignmentId -> courseName from one rendered page. Strategies in
   * confidence order; first hit per id wins and later strategies never
   * overwrite. `courses` (optional) enables the known-course text match.
   * Returns { labels, counts } so callers can see which strategy produced what.
   */
  function extractLabelsFromDoc(doc, courses) {
    const labels = Object.create(null);
    const counts = { calendar: 0, upcoming: 0, generic: 0, knownCourse: 0 };

    const claim = (a, bucket) => {
      const id = parseAssignmentId(a.getAttribute('href') || '');
      if (!id || labels[id]) return;
      // fullcalendar events: the anchor may BE the .fc-event, so start the
      // ancestor walk from the event element, not the bare anchor.
      const host = (a.closest && a.closest('[class*="fc-event"]')) || a;
      let name = courseTextNear(host);
      let via = bucket;
      if (!name) {
        // fc events often carry the course only in text/title ("Course: HW 12").
        name = matchKnownCourse(textOf(host) + ' ' + (a.getAttribute('title') || ''), courses);
        via = name ? 'knownCourse' : via;
      }
      if (name) {
        labels[id] = name;
        counts[via]++;
      }
    };

    try {
      // (i) Calendar view (fullcalendar) — anchor may be a.fc-event itself
      // (legacy fc3) or nested inside the event element (newer builds).
      for (const a of doc.querySelectorAll('a.fc-event[href*="/assignment/"], [class*="fc-event"] a[href*="/assignment/"]')) {
        claim(a, 'calendar');
      }
      // (ii) Home "Upcoming" sidebar.
      for (const a of doc.querySelectorAll('[class*="upcoming"] a[href*="/assignment/"], [id*="upcoming"] a[href*="/assignment/"]')) {
        claim(a, 'upcoming');
      }
      // (iii) Any other assignment anchor whose container names one course.
      for (const a of doc.querySelectorAll('a[href*="/assignment/"]')) {
        claim(a, 'generic');
      }
    } catch (_e) {
      /* keep whatever was claimed before the throw */
    }

    return { labels, counts };
  }

  /** All assignment ids in a page's COURSE CONTENT region — used on per-course
   *  materials pages where course identity comes from the URL we fetched.
   *
   *  Scoping is not optional: every Schoology page also renders global chrome (the
   *  "Upcoming" sidebar, notification dropdowns, recent-activity widgets) whose
   *  assignment links belong to OTHER courses. Harvesting the whole document would
   *  stamp this course's name onto those — and since materials labels outrank
   *  DOM-derived ones, a single contaminated anchor would beat a correct label.
   *  Wrong labels are the exact failure this feature exists to eliminate. */
  const CHROME_ANCESTOR_SEL =
    '[class*="upcoming"], [id*="upcoming"], [class*="sidebar"], [id*="sidebar"], [class*="right-col"], [id*="right"], [class*="notification"], [role="complementary"], nav, header, footer';

  function extractAssignmentIdsFromDoc(doc, root) {
    const ids = [];
    const seen = Object.create(null);
    try {
      const scope =
        root ||
        doc.querySelector('#main, [role="main"], [class*="materials"], #course-profile-materials') ||
        doc;
      for (const a of scope.querySelectorAll('a[href*="/assignment/"]')) {
        // Even inside the main region, skip anything sitting in page chrome.
        try {
          if (a.closest && a.closest(CHROME_ANCESTOR_SEL)) continue;
        } catch (_e) {
          /* closest unsupported on this node — keep the anchor */
        }
        const id = parseAssignmentId(a.getAttribute('href') || '');
        if (id && !seen[id]) {
          seen[id] = true;
          ids.push(id);
        }
      }
    } catch (_e) {
      /* partial is fine */
    }
    return ids;
  }

  /**
   * ICAL URL — regex over raw HTML rather than the DOM because the feed URL
   * often hides in an <input value=...>, a data- attribute, or inline JS for
   * the export dialog. Accepts a Document or an HTML string.
   */
  function extractIcalUrlFromDoc(input) {
    let html = '';
    if (typeof input === 'string') html = input;
    else if (input && input.documentElement) html = input.documentElement.outerHTML || '';
    if (!html) return null;
    // Only the personal-feed shape on a Schoology host. A bare ".ics anywhere in
    // the page" fallback used to live here and was removed deliberately: teachers
    // post Google/district calendar links in course updates, and this URL gets
    // written into the account's feed setting first-write-wins — capturing a
    // stranger's calendar would silently import the wrong assignments forever.
    const m = html.match(/(?:https?|webcal):\/\/[^"'\s<>\\]+\/calendar\/feed\/ical[^"'\s<>\\]*/i);
    if (!m) return null;
    // The URL was lifted out of HTML source, so entity-decode the separators.
    const url = m[0].replace(/&amp;/g, '&');
    try {
      const host = new URL(url.replace(/^webcal:/i, 'https:')).hostname.toLowerCase();
      if (host !== 'schoology.com' && !host.endsWith('.schoology.com')) return null;
    } catch (_e) {
      return null; // unparseable → not trustworthy enough to configure an account with
    }
    return url;
  }

  /** Logged-out detection: a login form means every scrape below would read a
   *  sign-in page as "no courses" and poison the throttle window. */
  function isLoginDoc(doc) {
    try {
      if (doc.querySelector('form[action*="login"], #login-form, #s-user-login-form')) return true;
      // React sign-in shell. Judge on POSITIVE evidence — a password field inside a
      // form that calls itself a login — rather than "password box and no header":
      // real sign-in pages carry classes like "login-header", so the negative test
      // inverted exactly when it mattered and let a scrape run on the sign-in page
      // (poisoning the throttle right as the student signed in).
      const pw = doc.querySelector('input[type="password"]');
      if (pw) {
        const form = pw.closest ? pw.closest('form') : null;
        const hints = form
          ? (form.getAttribute('action') || '') + ' ' + (form.id || '') + ' ' + (form.className || '')
          : '';
        if (/log ?in|sign ?in|auth/i.test(hints)) return true;
        // A password field with no signed-in markers anywhere is still a sign-in page.
        if (!doc.querySelector('a[href*="logout"], a[href*="/user/"]')) return true;
      }
    } catch (_e) {
      /* fall through */
    }
    return false;
  }

  // ===================== internal-API helpers (primary path) =================
  // Schoology's own web app talks to a REST API at /v1/... using nothing but the
  // session cookie. Called from inside the page it needs no key and no OAuth, and
  // it returns STRUCTURED events carrying section_id/course_id — which is how we
  // get a course name that is a fact rather than a reading of sibling markup.
  // (Proven in a prior extension running against this exact school for a year.)
  // The DOM extractors above stay as the fallback for when the API says no.

  /** Schoology sometimes hands back a login redirect instead of a real link:
   *  ".../login?destination=assignment%2F123". Recover the true target, and always
   *  keep the school host (app.schoology.com 404s for these). */
  function repairSchoologyUrl(url, host) {
    if (typeof url !== 'string' || !url) return '';
    let out = url;
    const m = url.match(/[?&]destination=([^&]+)/i);
    if (m) {
      try {
        out = decodeURIComponent(m[1]);
      } catch (_e) {
        out = m[1];
      }
      if (!/^https?:\/\//i.test(out)) out = 'https://' + (host || 'app.schoology.com') + '/' + out.replace(/^\/+/, '');
    }
    if (host) out = out.replace(/^https?:\/\/[^/]+/i, 'https://' + host);
    return out;
  }

  /** The signed-in user's numeric id, needed for /v1/users/<id>/events. A prior
   *  extension hardcoded it (single user); Cobalt is multi-user, so it must be
   *  discovered — several ways, because markup differs by Schoology era. */
  function extractUserIdFromDoc(doc, html) {
    try {
      const text = typeof html === 'string' ? html : (doc && doc.documentElement && doc.documentElement.outerHTML) || '';
      // Legacy (Drupal-era) pages embed it in inline JS settings.
      const inJs = text.match(/"(?:uid|user_id|userId)"\s*:\s*"?(\d{4,})"?/);
      if (inJs) return inJs[1];
      // Otherwise the profile/avatar link points at the student's own page.
      if (doc && doc.querySelectorAll) {
        for (const a of doc.querySelectorAll('a[href*="/user/"]')) {
          const m = (a.getAttribute('href') || '').match(/\/user\/(\d{4,})/);
          if (m) return m[1];
        }
      }
    } catch (_e) {
      /* fall through */
    }
    return null;
  }

  /** An event worth turning into a task: real assignments, plus calendar events
   *  whose title reads like graded work (mirrors app/src/schoology/ical.ts, which
   *  applies the same rule to the feed). */
  const GRADED_RE = /\b(quiz|quizzes|test|exam|exams|midterm|final|finals|project)\b/i;
  function isTaskEvent(e) {
    if (!e || typeof e !== 'object') return false;
    if (e.type === 'assignment') return true;
    return e.type === 'event' && GRADED_RE.test(String(e.title || ''));
  }

  /** Course name out of a /v1/sections/<id> or /v1/courses/<id> body.
   *  NOTE: the prior extension also stripped a trailing number ("Torah 9" -> "Torah")
   *  and alias-mapped onto ~30 canonical Heschel names. Both are deliberately NOT
   *  copied: stripping would wreck real titles like "Algebra 2", and a hardcoded
   *  school-specific alias map cannot work for other schools. Cobalt keeps the
   *  school's own wording verbatim and lets the user's course registry do the
   *  aliasing it already does. */
  function courseNameFromApi(obj) {
    if (!obj || typeof obj !== 'object') return '';
    const name = obj.course_title || obj.section_title || obj.title || '';
    return typeof name === 'string' ? name.trim() : '';
  }

  /** The assignment id Cobalt joins on: prefer the one inside web_url (it is
   *  literally the /assignment/<id> the iCal feed carries), else the event id. */
  function assignmentIdFromEvent(e, host) {
    const fromUrl = parseAssignmentId(repairSchoologyUrl(String(e && e.web_url ? e.web_url : ''), host));
    if (fromUrl) return fromUrl;
    const id = e && (e.id || e.assignment_id);
    return id != null && /^\d+$/.test(String(id)) ? String(id) : null;
  }

  /** Schoology wraps list responses ({ event: [...] }); tolerate bare arrays too. */
  function apiList(json, key) {
    if (Array.isArray(json)) return json;
    if (json && Array.isArray(json[key])) return json[key];
    if (json && Array.isArray(json[key + 's'])) return json[key + 's'];
    return [];
  }

  // Exposed for the orchestrator's fixture-HTML unit tests.
  globalThis.__wsSgy = {
    parseAssignmentId,
    parseCourseId,
    extractCoursesFromDoc,
    extractLabelsFromDoc,
    extractAssignmentIdsFromDoc,
    extractIcalUrlFromDoc,
    isLoginDoc,
    repairSchoologyUrl,
    extractUserIdFromDoc,
    isTaskEvent,
    courseNameFromApi,
    assignmentIdFromEvent,
    apiList,
  };

  // ========================= impure scrape pipeline =========================
  // Everything below needs a real page + chrome.* — skip wiring entirely when
  // loaded in a test runner (no chrome.runtime) so the pure exports stay usable.

  const hasChrome =
    typeof chrome !== 'undefined' && !!(chrome.runtime && chrome.runtime.id) && !!(chrome.storage && chrome.storage.local);
  const hasWindow = typeof window !== 'undefined' && typeof document !== 'undefined';
  if (!hasChrome || !hasWindow) return;

  const STORAGE_KEY = 'sgy:data'; // background merges + persists under this key
  const THROTTLE_MS = 10 * 60 * 1000; // full re-scrape at most every 10 min
  const FORCE_COOLDOWN_MS = 10 * 1000; // SGY_SCRAPE_NOW spam guard
  const MAX_MATERIALS_FETCHES = 12; // per-course fetch cap — polite, not a crawler
  const FETCH_SPACING_MS = 300; // ...and spaced out, never a burst

  let lastScrapeAt = 0; // module-level; chrome.storage backstops across page loads
  let inFlight = false;

  const sleep = (ms) => new Promise((r) => setTimeout(r, ms));

  function storageGet(key) {
    return new Promise((resolve) => {
      try {
        chrome.storage.local.get(key, (items) => {
          resolve(chrome.runtime.lastError ? null : items);
        });
      } catch (_e) {
        resolve(null); // context invalidated — treat as "nothing stored"
      }
    });
  }

  /** Same-origin credentialed fetch -> { text, doc } or null. The session
   *  cookie rides along implicitly; we never see it. */
  async function fetchDoc(path) {
    try {
      const res = await fetch(path, { credentials: 'same-origin', headers: { Accept: 'text/html' } });
      if (!res.ok) return null;
      const text = await res.text();
      return { text, doc: new DOMParser().parseFromString(text, 'text/html') };
    } catch (_e) {
      return null;
    }
  }

  /** Same-origin credentialed JSON fetch against Schoology's internal API. */
  async function fetchJson(path) {
    try {
      const res = await fetch(path, {
        credentials: 'same-origin',
        headers: { Accept: 'application/json' },
      });
      if (!res.ok) return null;
      const ct = res.headers.get('content-type') || '';
      if (!/json/i.test(ct)) return null; // a login page HTML answer, not data
      return await res.json();
    } catch (_e) {
      return null;
    }
  }

  const ymd = (d) => d.toISOString().slice(0, 10);

  /** Find the signed-in user's id: this page first (free), then the API. */
  async function discoverUserId() {
    const fromPage = extractUserIdFromDoc(document);
    if (fromPage) return { id: fromPage, from: 'page' };
    const me = await fetchJson('/v1/users/me');
    const id = me && (me.uid || me.id);
    if (id && /^\d+$/.test(String(id))) return { id: String(id), from: 'api' };
    return { id: null, from: 'none' };
  }

  /**
   * PRIMARY strategy: ask Schoology's own API what is coming up, then resolve each
   * event's section/course to a real title. One events call covers a 30-DAY window,
   * so a single visit labels a month of assignments at once — which is what makes
   * this useful to someone who mostly lives on their phone: they can go weeks
   * between desktop visits and still have accurate courses.
   */
  async function apiHarvest(diag) {
    const labels = {};
    const courses = [];
    const host = location.hostname;
    const who = await discoverUserId();
    diag.api = { uid: who.from, events: 0, kept: 0, sections: 0, labels: 0 };
    if (!who.id) {
      diag.api.error = 'no-user-id';
      return { labels, courses };
    }

    const now = new Date();
    const end = new Date(now.getTime() + 30 * 24 * 60 * 60 * 1000);
    const events = apiList(
      await fetchJson(
        '/v1/users/' + who.id + '/events?start_date=' + ymd(now) + '&end_date=' + ymd(end) + '&limit=100'
      ),
      'event'
    );
    diag.api.events = events.length;
    if (!events.length) {
      diag.api.error = 'no-events';
      return { labels, courses };
    }

    // Group the keepers by the realm that owns them, so each section/course is
    // resolved ONCE no matter how many assignments it has.
    const bySection = new Map();
    const byCourse = new Map();
    for (const e of events) {
      if (!isTaskEvent(e)) continue;
      const aid = assignmentIdFromEvent(e, host);
      if (!aid) continue;
      diag.api.kept++;
      const sid = e.section_id != null ? String(e.section_id) : '';
      const cid = e.course_id != null ? String(e.course_id) : '';
      if (sid) {
        if (!bySection.has(sid)) bySection.set(sid, []);
        bySection.get(sid).push(aid);
      } else if (cid) {
        if (!byCourse.has(cid)) byCourse.set(cid, []);
        byCourse.get(cid).push(aid);
      }
    }

    const seenCourse = new Set();
    const resolve = async (path, id, aids) => {
      await sleep(FETCH_SPACING_MS);
      const name = courseNameFromApi(await fetchJson(path + id));
      diag.api.sections++;
      if (!name) return;
      if (!seenCourse.has(id)) {
        seenCourse.add(id);
        courses.push({ id, name });
      }
      for (const aid of aids) {
        labels[aid] = name;
        diag.api.labels++;
      }
    };
    for (const [sid, aids] of bySection) await resolve('/v1/sections/', sid, aids);
    for (const [cid, aids] of byCourse) await resolve('/v1/courses/', cid, aids);

    return { labels, courses };
  }

  // ============================== the sync badge =============================
  // A pill in the bottom-right of the Schoology page reporting what this scrape
  // found, expanding to the per-course breakdown. It is the ONLY place the whole
  // pipeline is visible: without it a school whose markup or API differs fails
  // silently and the student just sees vaguely-wrong courses in Cobalt.
  //
  // Rendered inside a shadow root so Schoology's stylesheet cannot reach in (and
  // ours cannot leak out) — the earlier extension used inline styles on a plain
  // div, which works until a host page sets something like `* { all: revert }`.
  const BADGE_HOST_ID = 'ws-sgy-badge-host';
  const GREEN = '#27ae60';
  const AMBER = '#e6a817'; // Cobalt gold, doubling as the "nothing found" warning
  const RED = '#e53935';

  function appUrl(cb) {
    // The shortcuts config records the Cobalt origin the user actually runs.
    try {
      chrome.storage.local.get('wsConfig', (cur) => {
        const origin = cur && cur.wsConfig && cur.wsConfig.origin;
        cb(typeof origin === 'string' && /^https?:\/\//.test(origin) ? origin : '');
      });
    } catch (_e) {
      cb('');
    }
  }

  function showSyncBadge(payload, diag) {
    try {
      if (window.top !== window) return; // top frame only
      const prev = document.getElementById(BADGE_HOST_ID);
      if (prev) prev.remove(); // each scrape rebuilds, collapsed again

      const labelCount = Object.keys(payload.labels || {}).length;
      const courseNames = new Map(); // course -> how many assignments
      for (const name of Object.values(payload.labels || {})) {
        courseNames.set(name, (courseNames.get(name) || 0) + 1);
      }
      const ok = labelCount > 0;
      const accent = ok ? GREEN : AMBER;

      const host = document.createElement('div');
      host.id = BADGE_HOST_ID;
      host.style.cssText = 'all:initial; position:fixed; z-index:2147483647;';
      const root = host.attachShadow({ mode: 'open' });

      const css = `
        :host { all: initial; }
        .pill, .panel { font-family: Inter, system-ui, -apple-system, "Segoe UI", sans-serif; box-sizing: border-box; }
        .pill {
          position: fixed; bottom: 20px; right: 20px; z-index: 2147483647;
          background: ${accent}; color: ${ok ? '#fff' : '#1a1205'};
          border-radius: 10px; padding: 10px 16px; font-size: 13px; font-weight: 600;
          box-shadow: 0 4px 12px rgba(0,0,0,.3); cursor: pointer; user-select: none;
          border: none; max-width: 340px; text-align: left;
        }
        .panel {
          position: fixed; bottom: 60px; right: 20px; z-index: 2147483647;
          width: 320px; max-height: 400px; overflow-y: auto; display: none;
          background: #1a1a1a; color: #fff; border: 1px solid rgba(255,255,255,.1);
          border-radius: 12px; box-shadow: 0 8px 32px rgba(0,0,0,.5); padding: 12px;
        }
        .panel.open { display: block; }
        .head { font-size: 11px; font-weight: 700; letter-spacing: 1px; text-transform: uppercase;
                color: rgba(255,255,255,.5); margin: 2px 0 8px; }
        .row { display: flex; align-items: baseline; justify-content: space-between; gap: 10px;
               padding: 7px 8px; border-radius: 8px; }
        .row:hover { background: rgba(255,255,255,.06); }
        .cname { font-size: 13px; font-weight: 600; }
        .ccount { font-size: 11px; color: rgba(255,255,255,.4); white-space: nowrap; }
        .empty { color: rgba(255,255,255,.55); font-size: 12.5px; line-height: 1.5; padding: 6px 8px; }
        .empty b { color: #fff; }
        .diag { margin-top: 10px; padding-top: 8px; border-top: 1px solid rgba(255,255,255,.08);
                font: 11px/1.5 ui-monospace, Consolas, monospace; color: rgba(255,255,255,.35);
                word-break: break-word; }
        .cta { display: block; width: 100%; margin-top: 10px; background: ${AMBER}; color: #1a1205;
               border: none; border-radius: 8px; padding: 9px 12px; font-size: 12.5px; font-weight: 700;
               cursor: pointer; font-family: inherit; }
      `;

      const style = document.createElement('style');
      style.textContent = css;
      root.append(style);

      const pill = document.createElement('button');
      pill.className = 'pill';
      pill.textContent = ok
        ? `✓ ${labelCount} assignment${labelCount === 1 ? '' : 's'} labeled · ${courseNames.size} course${courseNames.size === 1 ? '' : 's'}`
        : '⚠ Cobalt found no courses. Click';

      const panel = document.createElement('div');
      panel.className = 'panel';

      if (courseNames.size) {
        const h = document.createElement('div');
        h.className = 'head';
        h.textContent = `${courseNames.size} course${courseNames.size === 1 ? '' : 's'} synced to Cobalt`;
        panel.append(h);
        for (const [name, n] of [...courseNames.entries()].sort((a, b) => b[1] - a[1])) {
          const row = document.createElement('div');
          row.className = 'row';
          const cn = document.createElement('span');
          cn.className = 'cname';
          cn.textContent = name;
          const cc = document.createElement('span');
          cc.className = 'ccount';
          cc.textContent = `${n} assignment${n === 1 ? '' : 's'}`;
          row.append(cn, cc);
          panel.append(row);
        }
      } else {
        const e = document.createElement('div');
        e.className = 'empty';
        e.innerHTML =
          "<b>No course labels found on this page.</b> Open your Schoology <b>Calendar</b> or a course page and this will retry. If it keeps failing, send Claude the line below.";
        panel.append(e);
      }

      const d = document.createElement('div');
      d.className = 'diag';
      d.textContent = JSON.stringify({ primary: diag.strategies && diag.strategies.primary, api: diag.api, dom: diag.strategies && diag.strategies.labelsDom, ical: diag.strategies && diag.strategies.ical, ms: diag.ms });
      panel.append(d);

      const cta = document.createElement('button');
      cta.className = 'cta';
      cta.textContent = '📋 Open Cobalt';
      appUrl((origin) => {
        cta.style.display = origin ? '' : 'none';
        cta.onclick = () => origin && window.open(origin, '_blank', 'noopener');
      });
      panel.append(cta);

      pill.addEventListener('click', () => panel.classList.toggle('open'));
      root.append(pill, panel);
      document.body.appendChild(host);

      // Only the failure state nags-then-leaves; a successful badge stays put for
      // the life of the page (it is also the "yes, this is working" signal).
      if (!ok) {
        setTimeout(() => {
          if (!panel.classList.contains('open')) host.remove();
        }, 15000);
      }
    } catch (_e) {
      /* the badge must never break the page */
    }
  }

  function sendCapture(payload) {
    try {
      chrome.runtime.sendMessage({ type: 'SGY_CAPTURE', payload }, () => {
        void chrome.runtime.lastError; // SW asleep/torn down — nothing to do
      });
    } catch (_e) {
      /* extension context invalidated; next page load gets a fresh script */
    }
  }

  async function recentlyScraped() {
    if (Date.now() - lastScrapeAt < THROTTLE_MS) return true;
    const items = await storageGet(STORAGE_KEY);
    const d = items && items[STORAGE_KEY];
    return !!(
      d &&
      d.host === location.host &&
      typeof d.scrapedAt === 'number' &&
      Date.now() - d.scrapedAt < THROTTLE_MS
    );
  }

  /**
   * The full scrape. Always sends whatever partial payload exists — even after
   * an internal failure — because partial labels still beat the heuristic, and
   * diag is how the user learns WHY a school produced nothing.
   * Returns true if a payload was sent.
   */
  async function scrape() {
    const t0 = Date.now();
    const diag = { path: location.pathname, strategies: {} };
    const payload = {
      host: location.host,
      courses: [],
      labels: Object.create(null),
      scrapedAt: t0,
      diag,
    };

    try {
      // Logged out? Bail WITHOUT sending and WITHOUT touching lastScrapeAt, so
      // the scrape right after the student signs in isn't throttled away.
      if (/\/login/i.test(location.pathname) || isLoginDoc(document)) return false;

      // ---- PRIMARY: Schoology's own API (structured, no selectors to break) ----
      const api = await apiHarvest(diag);
      Object.assign(payload.labels, api.labels);
      const apiWorked = Object.keys(api.labels).length > 0;

      // ---- courses: API first, then live DOM + the /courses page for the rest ----
      // (the header dropdown truncates long course lists behind "See All").
      let courses = api.courses.slice();
      const haveId = new Set(courses.map((c) => c.id));
      const addCourses = (list) => {
        for (const c of list) if (!haveId.has(c.id)) { haveId.add(c.id); courses.push(c); }
      };
      addCourses(extractCoursesFromDoc(document));
      diag.strategies.coursesNav = courses.length;
      const coursesPage = await fetchDoc('/courses');
      if (coursesPage && !isLoginDoc(coursesPage.doc)) {
        const fetched = extractCoursesFromDoc(coursesPage.doc);
        diag.strategies.coursesFetch = fetched.length;
        addCourses(fetched);
      } else {
        diag.strategies.coursesFetch = coursesPage ? 'logged-out' : 'fetch-failed';
      }
      payload.courses = courses;

      // ---- labels from THIS page's DOM: a supplement, never an override ----
      // The API's answer comes from the assignment's own section record, so it
      // outranks any reading of sibling markup; DOM labels only fill gaps.
      const domLabels = extractLabelsFromDoc(document, courses);
      for (const [id, name] of Object.entries(domLabels.labels)) {
        if (!payload.labels[id]) payload.labels[id] = name;
      }
      diag.strategies.labelsDom = domLabels.counts;

      // ---- ical feed URL: current page first, then calendar surfaces ----
      let icalUrl = extractIcalUrlFromDoc(document);
      let icalFrom = icalUrl ? 'page' : null;
      if (!icalUrl) {
        for (const path of ['/calendar', '/calendar/export']) {
          await sleep(FETCH_SPACING_MS);
          const got = await fetchDoc(path);
          icalUrl = got ? extractIcalUrlFromDoc(got.text) : null;
          if (icalUrl) {
            icalFrom = path;
            break;
          }
        }
      }
      if (icalUrl) payload.icalUrl = icalUrl;
      diag.strategies.ical = icalFrom || 'not-found';

      // ---- FALLBACK: per-course materials pages ----
      // Only when the API produced nothing (a school or Schoology build where
      // /v1 is unavailable). It costs a dozen page fetches for the same answer the
      // API gives in two, so it is skipped entirely on the happy path.
      //
      // Course identity comes from the URL WE chose to fetch, not from sibling
      // markup, so these are trusted over DOM-derived labels — but only when the
      // two AGREE or the DOM had nothing. A genuine disagreement means one of the
      // two readings is wrong and we cannot tell which, so the label is DROPPED:
      // an unlabeled task falls back to the heuristic engine, while a confidently
      // wrong course is exactly the failure this feature exists to prevent.
      let materialsLabels = 0;
      let conflicts = 0;
      let fetched = 0;
      for (const course of apiWorked ? [] : courses) {
        if (fetched >= MAX_MATERIALS_FETCHES) break;
        fetched++;
        await sleep(FETCH_SPACING_MS);
        const got = await fetchDoc('/course/' + course.id + '/materials');
        if (!got) continue;
        if (isLoginDoc(got.doc)) break; // session died mid-scrape — stop fetching
        for (const id of extractAssignmentIdsFromDoc(got.doc)) {
          const domSaid = domLabels.labels[id];
          if (domSaid && domSaid !== course.name) {
            delete payload.labels[id];
            conflicts++;
            continue;
          }
          payload.labels[id] = course.name;
          materialsLabels++;
        }
      }
      diag.strategies.labelsMaterials = materialsLabels;
      diag.strategies.labelConflicts = conflicts;
      diag.strategies.materialsFetched = fetched;
      diag.strategies.primary = apiWorked ? 'api' : 'dom';
    } catch (e) {
      // Never rethrow into the page; record why and ship what we have.
      diag.error = e && e.message ? String(e.message) : 'unknown';
    }

    diag.ms = Date.now() - t0;
    lastScrapeAt = Date.now();
    sendCapture(payload);
    showSyncBadge(payload, diag);
    return true;
  }

  /** force=true (SGY_SCRAPE_NOW) skips the 10-min throttle but still refuses
   *  overlapping runs and rapid-fire repeats. */
  async function runScrape(force) {
    if (inFlight) return false;
    if (force) {
      if (Date.now() - lastScrapeAt < FORCE_COOLDOWN_MS) return false;
    } else if (await recentlyScraped()) {
      return false;
    }
    inFlight = true;
    try {
      return await scrape();
    } catch (_e) {
      return false; // scrape() shouldn't throw, but the host page must never see it
    } finally {
      inFlight = false;
    }
  }

  // On-demand rescrape, relayed from the app's SGY_REFRESH by the background SW.
  try {
    chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
      if (!msg || msg.type !== 'SGY_SCRAPE_NOW') return;
      runScrape(true).then(
        (scraped) => {
          try {
            sendResponse({ ok: true, scraped });
          } catch (_e) {
            /* channel already closed */
          }
        },
        () => {
          try {
            sendResponse({ ok: false, scraped: false });
          } catch (_e) {
            /* ignore */
          }
        }
      );
      return true; // async response — hold the channel until the scrape settles
    });
  } catch (_e) {
    /* context invalidated */
  }

  // Scrape once per page load, top frame only (Schoology iframes course
  // content; scraping every frame would multiply fetches for identical data).
  // The delay lets the React shell finish painting the dropdown/sidebar that
  // document_idle alone doesn't guarantee.
  let isTop = true;
  try {
    isTop = window.top === window;
  } catch (_e) {
    isTop = false; // cross-origin top — we're framed, skip
  }
  if (isTop) {
    const kickoff = () => {
      setTimeout(() => {
        runScrape(false);
      }, 2500);
    };
    if (document.readyState === 'complete') kickoff();
    else window.addEventListener('load', kickoff, { once: true });
  }
})();
