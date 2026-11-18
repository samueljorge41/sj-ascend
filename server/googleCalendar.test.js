import assert from "node:assert/strict";
import test from "node:test";
import { parseGoogleCalendarFeed } from "./googleCalendar.js";

const calendarText = `BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:timed-event
SUMMARY:Reunião de equipe
DTSTART;TZID=America/Sao_Paulo:20261106T090000
DTEND;TZID=America/Sao_Paulo:20261106T100000
LOCATION:Escritório
DESCRIPTION:Alinhamento semanal
END:VEVENT
BEGIN:VEVENT
UID:all-day-event
SUMMARY:Feriado local
DTSTART;VALUE=DATE:20261107
DTEND;VALUE=DATE:20261108
END:VEVENT
BEGIN:VEVENT
UID:weekly-event
SUMMARY:Revisão recorrente
DTSTART;TZID=America/Sao_Paulo:20261106T110000
DTEND;TZID=America/Sao_Paulo:20261106T113000
RRULE:FREQ=WEEKLY;COUNT=3
EXDATE;TZID=America/Sao_Paulo:20261113T110000
END:VEVENT
END:VCALENDAR`;

test("maps timed and all-day Google events in São Paulo local time", async () => {
  const events = await parseGoogleCalendarFeed(calendarText, "2026-11-06", "2026-11-07");

  assert.deepEqual(events.map(({ title, start_date, end_date_exclusive, start_time, end_time, all_day }) => ({
    title, start_date, end_date_exclusive, start_time, end_time, all_day,
  })), [
    {
      title: "Reunião de equipe",
      start_date: "2026-11-06",
      end_date_exclusive: "2026-11-07",
      start_time: "09:00",
      end_time: "10:00",
      all_day: false,
    },
    {
      title: "Revisão recorrente",
      start_date: "2026-11-06",
      end_date_exclusive: "2026-11-07",
      start_time: "11:00",
      end_time: "11:30",
      all_day: false,
    },
    {
      title: "Feriado local",
      start_date: "2026-11-07",
      end_date_exclusive: "2026-11-08",
      start_time: null,
      end_time: null,
      all_day: true,
    },
  ]);
});

test("converts UTC iCal event times to São Paulo time", async () => {
  const events = await parseGoogleCalendarFeed(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:utc-event
SUMMARY:Evento UTC
DTSTART:20261106T130000Z
DTEND:20261106T150000Z
END:VEVENT
END:VCALENDAR`, "2026-11-06", "2026-11-06");

  assert.equal(events.length, 1);
  assert.equal(events[0].start_date, "2026-11-06");
  assert.equal(events[0].start_time, "10:00");
  assert.equal(events[0].end_time, "12:00");
});

test("expands recurring events and omits excluded dates", async () => {
  const events = await parseGoogleCalendarFeed(calendarText, "2026-11-06", "2026-11-20");
  const recurring = events.filter((event) => event.title === "Revisão recorrente");

  assert.deepEqual(recurring.map((event) => event.start_date), ["2026-11-06", "2026-11-20"]);
  assert.ok(recurring.every((event) => event.start_time === "11:00"));
});

test("includes events that span into the requested period", async () => {
  const events = await parseGoogleCalendarFeed(`BEGIN:VCALENDAR
VERSION:2.0
BEGIN:VEVENT
UID:multi-day
SUMMARY:Evento de vários dias
DTSTART;VALUE=DATE:20261105
DTEND;VALUE=DATE:20261108
END:VEVENT
END:VCALENDAR`, "2026-11-06", "2026-11-06");

  assert.equal(events.length, 1);
  assert.equal(events[0].start_date, "2026-11-05");
  assert.equal(events[0].end_date_exclusive, "2026-11-08");
});

test("rejects invalid date ranges", async () => {
  await assert.rejects(() => parseGoogleCalendarFeed(calendarText, "2026-02-30", "2026-03-01"), /inválido/);
});
