// Cobalt test-calendar relay. Runs on a Heschel student's Google account (script.google.com,
// signed in to the HESCHEL account, not Gmail). Reads every "Grade Test Calendar" the account
// can see and sends the all-day events to Cobalt. Setup: see "Cobalt Calendars Plan" in the vault.
//
// Project Settings > Script properties:  RELAY_SECRET = <the TEST_RELAY_SECRET value>
// Then run install() once (it asks for calendar + external-request permission), which adds the hourly trigger.

const ENDPOINT = 'https://us-central1-workspace-67029.cloudfunctions.net/ingestTestCalendar';

function relayTests() {
  const secret = PropertiesService.getScriptProperties().getProperty('RELAY_SECRET');
  if (!secret) throw new Error('Set the RELAY_SECRET script property first.');
  const from = new Date();
  from.setDate(from.getDate() - 7);
  const to = new Date();
  to.setDate(to.getDate() + 240);
  CalendarApp.getAllCalendars()
    .filter((c) => /grade test calendar/i.test(c.getName()))
    .forEach((cal) => {
      const events = cal.getEvents(from, to).map((e) => {
        // All-day events: the calendar's own date, not a UTC conversion.
        const d = e.isAllDayEvent() ? e.getAllDayStartDate() : e.getStartTime();
        return { title: e.getTitle(), date: Utilities.formatDate(d, Session.getScriptTimeZone(), 'yyyy-MM-dd') };
      });
      const res = UrlFetchApp.fetch(ENDPOINT, {
        method: 'post',
        contentType: 'application/json',
        headers: { 'X-Relay-Secret': secret },
        payload: JSON.stringify({ calendarId: cal.getId(), calendarName: cal.getName(), events }),
        muteHttpExceptions: true,
      });
      console.log(cal.getName(), events.length, 'events ->', res.getResponseCode());
    });
}

function install() {
  ScriptApp.getProjectTriggers().forEach((t) => ScriptApp.deleteTrigger(t));
  ScriptApp.newTrigger('relayTests').timeBased().everyHours(1).create();
  relayTests();
}
