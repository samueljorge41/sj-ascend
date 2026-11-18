import assert from "node:assert/strict";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sj-google-calendar-"));
process.env.DATABASE_PATH = path.join(testRoot, "calendar.sqlite");
process.env.UPLOADS_PATH = path.join(testRoot, "uploads");
process.env.GOOGLE_CALENDAR_ICAL_URL = "https://calendar.google.com/calendar/ical/example/private/basic.ics";
process.env.SUBIDO_PRO_CALENDAR_ICAL_URL = "https://calendar.google.com/calendar/ical/calendariosubidopro%40gmail.com/public/basic.ics";

const [{ default: db }, { default: express }, { default: agendaRouter }] = await Promise.all([
  import("./database/db.js"),
  import("express"),
  import("./routes/agenda.js"),
]);

const calendarText = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:api-event
SUMMARY:Compromisso integrado
DTSTART;TZID=America/Sao_Paulo:20261106T090000
DTEND;TZID=America/Sao_Paulo:20261106T100000
END:VEVENT
END:VCALENDAR`;
const subidoProCalendarText = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:subido-pro-api-event
SUMMARY:Reunião Subido PRO
DTSTART;TZID=America/Sao_Paulo:20261106T140000
DTEND;TZID=America/Sao_Paulo:20261106T150000
END:VEVENT
END:VCALENDAR`;
const originalFetch = globalThis.fetch;
let calendarFetches = 0;
const fetchedFeeds = [];
let server;
let baseUrl;

globalThis.fetch = async (input, options) => {
  if (new URL(input).hostname === "calendar.google.com") {
    calendarFetches += 1;
    const url = new URL(input);
    fetchedFeeds.push(url.pathname);
    assert.equal(options.redirect, "error");
    const content = url.pathname.includes("calendariosubidopro") ? subidoProCalendarText : calendarText;
    return new Response(content, { status: 200, headers: { "content-type": "text/calendar" } });
  }
  return originalFetch(input, options);
};

before(async () => {
  const app = express();
  app.use(express.json());
  app.use("/api/agenda", agendaRouter);
  server = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  globalThis.fetch = originalFetch;
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedTestRoot = path.resolve(testRoot);
  if (resolvedTestRoot.startsWith(`${tempRoot}${path.sep}`)) {
    fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
  }
});

test("Google Agenda endpoint requires a valid application session outside localhost", async () => {
  const response = await fetch(`${baseUrl}/api/agenda/google-events?from=2026-11-06&until=2026-11-06`, {
    headers: { Origin: "https://example.com" },
  });

  assert.equal(response.status, 401);
  assert.equal(calendarFetches, 0);
});

test("Google Agenda endpoint returns read-only event data without its iCal address", async () => {
  db.prepare(`
    INSERT INTO google_calendar_event_links (
      source_type, source_id, google_event_id, archived_at
    ) VALUES ('agenda', 123, 'deleted-event', CURRENT_TIMESTAMP)
  `).run();
  const response = await fetch(`${baseUrl}/api/agenda/google-events?from=2026-11-06&until=2026-11-06`, {
    headers: { Origin: baseUrl },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].title, "Compromisso integrado");
  assert.equal(body.events[0].start_time, "09:00");
  assert.deepEqual(body.linkedSources, [{ sourceType: "agenda", sourceId: 123, archived: true }]);
  assert.equal(JSON.stringify(body).includes("private"), false);
  assert.equal(calendarFetches, 1);
});

test("Google Agenda endpoint rejects malformed date ranges", async () => {
  const response = await fetch(`${baseUrl}/api/agenda/google-events?from=2026-02-30&until=2026-03-01`, {
    headers: { Origin: baseUrl },
  });

  assert.equal(response.status, 400);
  assert.equal(calendarFetches, 1);
});

test("Subido PRO public calendar endpoint returns its own read-only feed", async () => {
  const response = await fetch(`${baseUrl}/api/agenda/subido-pro-events?from=2026-11-06&until=2026-11-06`, {
    headers: { Origin: baseUrl },
  });
  const body = await response.json();

  assert.equal(response.status, 200);
  assert.equal(body.configured, true);
  assert.equal(body.events.length, 1);
  assert.equal(body.events[0].title, "Reunião Subido PRO");
  assert.equal(body.events[0].start_time, "14:00");
  assert.equal(JSON.stringify(body).includes("calendariosubidopro"), false);
  assert.equal(calendarFetches, 2);
  assert.ok(fetchedFeeds.some((pathname) => pathname.includes("calendariosubidopro")));
});
