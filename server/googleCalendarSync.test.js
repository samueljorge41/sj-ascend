import assert from "node:assert/strict";
import crypto from "node:crypto";
import fs from "node:fs";
import os from "node:os";
import path from "node:path";
import test, { after, before } from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sj-google-calendar-sync-"));
process.env.DATABASE_PATH = path.join(testRoot, "calendar.sqlite");
process.env.UPLOADS_PATH = path.join(testRoot, "uploads");
process.env.GOOGLE_CALENDAR_CLIENT_ID = "test-client";
process.env.GOOGLE_CALENDAR_CLIENT_SECRET = "test-secret";
process.env.GOOGLE_CALENDAR_REDIRECT_URI = "https://api.example.test/api/agenda/google-auth/callback";
process.env.GOOGLE_CALENDAR_WEBHOOK_URL = "https://api.example.test/api/agenda/google-webhook";
process.env.GOOGLE_CALENDAR_TOKEN_KEY = crypto.randomBytes(32).toString("base64");
process.env.GOOGLE_CALENDAR_ID = "primary";

const [{ default: db }, calendarSync] = await Promise.all([
  import("./database/db.js"),
  import("./googleCalendarSync.js"),
]);

const originalFetch = globalThis.fetch;
const emitted = [];
const calendarEvents = new Map([
  ["timed", {
    id: "timed",
    summary: "Reunião",
    colorId: "1",
    hangoutLink: "https://meet.google.com/abc-defg-hij",
    start: { dateTime: "2026-11-06T09:30:00-03:00" },
    end: { dateTime: "2026-11-06T10:45:00-03:00" },
  }],
  ["all-day", {
    id: "all-day",
    summary: "Feriado",
    start: { date: "2026-11-07" },
    end: { date: "2026-11-08" },
  }],
  ["subido-pro", {
    id: "subido-pro",
    summary: "1ª Reunião",
    eventLabelId: "5C53B84F-53F3-485C-8173-B25445B4487F",
    start: { dateTime: "2026-11-06T16:30:00-03:00" },
    end: { dateTime: "2026-11-06T17:00:00-03:00" },
  }],
  ["prospecting", {
    id: "prospecting",
    summary: "PROSPECÇÃO & FOLLOW-UP",
    eventLabelId: "437709b2-1a38-4ca1-a91f-31ccd6846506",
    start: { dateTime: "2026-11-06T17:00:00-03:00" },
    end: { dateTime: "2026-11-06T17:30:00-03:00" },
  }],
]);
let deltaEvents = [];
let nextEventId = 1;
let syncSequence = 0;
let grantedOAuthScope = "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly";
let authorizationExpiresIn = 3600;
let rejectRefreshToken = false;
let watchRequest;
let retainDeletedEventInList = false;

globalThis.fetch = async (input, options = {}) => {
  const url = new URL(input);
  if (url.hostname === "oauth2.googleapis.com") {
    const form = new URLSearchParams(options.body);
    if (form.get("grant_type") === "authorization_code") {
      return Response.json({
        access_token: "unit-test-access-token",
        refresh_token: "unit-test-refresh-token",
        expires_in: authorizationExpiresIn,
        scope: grantedOAuthScope,
      });
    }
    if (form.get("grant_type") === "refresh_token") {
      if (rejectRefreshToken) {
        return Response.json({
          error: "invalid_grant",
          error_description: "Token has been expired or revoked.",
        }, { status: 400 });
      }
      return Response.json({
        access_token: "unit-test-refreshed-access-token",
        expires_in: 3600,
      });
    }
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/events/watch")) {
    watchRequest = JSON.parse(options.body);
    return Response.json({
      resourceId: "unit-test-resource",
      expiration: Date.now() + 7 * 24 * 60 * 60 * 1000,
    });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/colors")) {
    return Response.json({
      event: { "1": { background: "#a4bdfc", foreground: "#1d1d1d" } },
    });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/events") && options.method === "POST") {
    const event = { ...JSON.parse(options.body), id: `created-${nextEventId++}`, status: "confirmed" };
    calendarEvents.set(event.id, event);
    deltaEvents.push(event);
    return Response.json(event);
  }
  if (url.hostname === "www.googleapis.com" && /\/events\/[^/]+$/.test(url.pathname) && options.method === "PATCH") {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const previous = calendarEvents.get(id);
    const patch = JSON.parse(options.body);
    const event = { ...previous, ...patch, id };
    // Google PATCH retains nested fields unless explicitly cleared with null.
    for (const field of ['start', 'end']) {
      event[field] = { ...previous[field], ...patch[field] };
      for (const [key, value] of Object.entries(event[field])) {
        if (value === null) delete event[field][key];
      }
      if (Boolean(event[field].date) === Boolean(event[field].dateTime)) {
        return Response.json({ error: { message: `Invalid ${field} time.` } }, { status: 400 });
      }
    }
    calendarEvents.set(id, event);
    deltaEvents.push(event);
    return Response.json(event);
  }
  if (url.hostname === "www.googleapis.com" && /\/events\/[^/]+$/.test(url.pathname) && options.method === "DELETE") {
    const id = decodeURIComponent(url.pathname.split("/").at(-1));
    const event = { ...calendarEvents.get(id), id, status: "cancelled" };
    if (!retainDeletedEventInList) calendarEvents.delete(id);
    retainDeletedEventInList = false;
    deltaEvents.push(event);
    return new Response(null, { status: 204 });
  }
  if (url.hostname === "www.googleapis.com" && url.pathname.endsWith("/events")) {
    if (url.searchParams.has("syncToken")) {
      const changes = deltaEvents;
      deltaEvents = [];
      syncSequence += 1;
      return Response.json({ items: changes, nextSyncToken: `sync-${syncSequence}` });
    }
    if (!url.searchParams.has("timeMin")) {
      return Response.json({ items: [...calendarEvents.values()], nextSyncToken: `sync-${++syncSequence}` });
    }
    return Response.json({
      items: [...calendarEvents.values()],
    });
  }
  throw new Error(`Unexpected fetch ${url.hostname}${url.pathname}`);
};

before(() => {
  calendarSync.setGoogleCalendarRealtime({
    emit: (...args) => emitted.push(args),
  });
});

after(() => {
  globalThis.fetch = originalFetch;
  db.close();
  const tempRootPath = path.resolve(os.tmpdir());
  const resolvedRoot = path.resolve(testRoot);
  if (resolvedRoot.startsWith(`${tempRootPath}${path.sep}`)) {
    fs.rmSync(resolvedRoot, { recursive: true, force: true });
  }
});

test("OAuth consent creates an encrypted connection and a calendar push channel", async () => {
  const authorizationUrl = new URL(calendarSync.beginGoogleCalendarAuthorization());
  const state = authorizationUrl.searchParams.get("state");

  assert.equal(authorizationUrl.searchParams.get("scope"), "https://www.googleapis.com/auth/calendar.events https://www.googleapis.com/auth/calendar.calendarlist.readonly");
  assert.equal(authorizationUrl.searchParams.get("access_type"), "offline");
  assert.equal(authorizationUrl.searchParams.get("include_granted_scopes"), "true");
  assert.ok(state);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM google_calendar_oauth_states").get().count, 1);

  await calendarSync.completeGoogleCalendarAuthorization({ code: "authorization-code", state });

  assert.equal(calendarSync.getGoogleCalendarConnection().connected, true);
  assert.equal(calendarSync.getGoogleCalendarConnection().writeAccess, true);
  assert.equal(calendarSync.getGoogleCalendarConnection().colorReadAccess, true);
  assert.equal(calendarSync.getGoogleCalendarConnection().watchActive, true);
  assert.equal(watchRequest.type, "web_hook");
  assert.equal(watchRequest.address, process.env.GOOGLE_CALENDAR_WEBHOOK_URL);
  assert.ok(watchRequest.token);
  assert.equal(db.prepare("SELECT token_ciphertext FROM google_calendar_tokens WHERE id = 1").get().token_ciphertext.includes("unit-test-refresh-token"), false);
});

test("OAuth rejects missing write scope and keeps existing token state", async () => {
  const authorizationUrl = new URL(calendarSync.beginGoogleCalendarAuthorization());
  const previousToken = db.prepare("SELECT token_ciphertext FROM google_calendar_tokens WHERE id = 1").get().token_ciphertext;
  grantedOAuthScope = "https://www.googleapis.com/auth/calendar.events.readonly";

  await assert.rejects(
    calendarSync.completeGoogleCalendarAuthorization({
      code: "authorization-code",
      state: authorizationUrl.searchParams.get("state"),
    }),
    /não concedeu a permissão de edição/,
  );
  grantedOAuthScope = "https://www.googleapis.com/auth/calendar.events";

  assert.equal(db.prepare("SELECT token_ciphertext FROM google_calendar_tokens WHERE id = 1").get().token_ciphertext, previousToken);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM google_calendar_oauth_states").get().count, 0);
});

test("Calendar API events map local timed and all-day dates", async () => {
  const events = await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });

  assert.equal(events.length, 4);
  assert.deepEqual(
    { date: events[0].start_date, start: events[0].start_time, end: events[0].end_time, allDay: events[0].all_day },
    { date: "2026-11-06", start: "09:30", end: "10:45", allDay: false },
  );
  assert.equal(events[0].color_hex, "#a4bdfc");
  assert.equal(events[0].color_foreground, "#1d1d1d");
  assert.equal(events[0].meet_link, "https://meet.google.com/abc-defg-hij");
  assert.equal(events[1].color_hex, null);
  assert.equal(events[1].color_foreground, null);
  assert.deepEqual(
    { date: events[1].start_date, end: events[1].end_date_exclusive, allDay: events[1].all_day },
    { date: "2026-11-07", end: "2026-11-08", allDay: true },
  );
  const subidoProEvent = events.find((event) => event.title === "1ª Reunião");
  assert.equal(subidoProEvent.color_hex, "#352ef2");
  assert.equal(subidoProEvent.color_foreground, "#ffffff");
  const prospectingEvent = events.find((event) => event.title === "PROSPECÇÃO & FOLLOW-UP");
  assert.equal(prospectingEvent.color_hex, "#ea4335");
  assert.equal(prospectingEvent.color_foreground, "#ffffff");
});

test("System agenda items synchronize both ways and Google deletion archives the source", async () => {
  const clientId = db.prepare(`
    INSERT INTO clients (account_id, name, active)
    VALUES ('test-calendar-client', 'Cliente de teste', 1)
  `).run().lastInsertRowid;
  db.prepare(`
    INSERT INTO client_demands (client_id, title, type, demand_date, observation, status)
    VALUES (?, 'Revisar campanha', 'analysis', '2026-11-06', 'Nota da demanda', 'pending')
  `).run(clientId);
  const stageId = db.prepare("SELECT id FROM acquisition_stages WHERE stage_key = 'new'").get().id;
  db.prepare(`
    INSERT INTO prospects (
      company_name, stage_id, next_action, next_action_date,
      next_action_start_time, next_action_end_time, notes
    ) VALUES ('Prospect teste', ?, 'Fazer follow-up', '2026-11-06', '15:00', '15:30', 'Nota comercial')
  `).run(stageId);
  db.prepare(`
    INSERT INTO agenda_items (
      item_type, title, description, area, planned_date, start_time, end_time, status
    ) VALUES ('appointment', 'Consulta', 'Descrição inicial', 'personal',
      '2026-11-06', '11:00', '12:00', 'scheduled')
  `).run();

  await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });
  const link = db.prepare(`
    SELECT * FROM google_calendar_event_links WHERE source_type = 'agenda'
  `).get();
  const demandLink = db.prepare(`
    SELECT * FROM google_calendar_event_links WHERE source_type = 'client_demand'
  `).get();
  const prospectLink = db.prepare(`
    SELECT * FROM google_calendar_event_links WHERE source_type = 'prospect'
  `).get();
  assert.ok(link);
  assert.ok(demandLink);
  assert.ok(prospectLink);
  assert.equal(calendarEvents.get(link.google_event_id).summary, "Consulta");
  assert.equal(calendarEvents.get(demandLink.google_event_id).start.date, "2026-11-06");
  assert.equal(calendarEvents.get(prospectLink.google_event_id).start.dateTime, "2026-11-06T15:00:00-03:00");

  await calendarSync.updateGoogleCalendarEventColor(link.google_event_id, "4");
  assert.equal(calendarEvents.get(link.google_event_id).colorId, "4");
  assert.equal(db.prepare(`
    SELECT color_id FROM agenda_event_color_overrides WHERE source_type = 'agenda' AND source_id = ?
  `).get(String(link.source_id)).color_id, "4");

  const changedEvent = {
    ...calendarEvents.get(link.google_event_id),
    summary: "Consulta alterada no Google",
    description: "Atualização externa",
    colorId: "10",
    start: { dateTime: "2026-11-06T13:00:00-03:00" },
    end: { dateTime: "2026-11-06T14:00:00-03:00" },
  };
  calendarEvents.set(link.google_event_id, changedEvent);
  deltaEvents.push(changedEvent);
  await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });
  const agendaItem = db.prepare("SELECT * FROM agenda_items WHERE id = 1").get();
  assert.equal(agendaItem.title, "Consulta alterada no Google");
  assert.equal(agendaItem.start_time, "13:00");
  assert.equal(agendaItem.end_time, "14:00");
  assert.equal(db.prepare(`
    SELECT color_id FROM agenda_event_color_overrides WHERE source_type = 'agenda' AND source_id = ?
  `).get(String(link.source_id)).color_id, "10");

  const changedProspectEvent = {
    ...calendarEvents.get(prospectLink.google_event_id),
    summary: "Follow-up alterado",
    start: { dateTime: "2026-11-06T16:00:00-03:00" },
    end: { dateTime: "2026-11-06T16:30:00-03:00" },
  };
  calendarEvents.set(prospectLink.google_event_id, changedProspectEvent);
  deltaEvents.push(changedProspectEvent);
  await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });
  const prospect = db.prepare("SELECT * FROM prospects WHERE company_name = 'Prospect teste'").get();
  assert.equal(prospect.next_action, "Follow-up alterado");
  assert.equal(prospect.next_action_start_time, "16:00");
  assert.equal(prospect.next_action_end_time, "16:30");

  deltaEvents.push({ id: link.google_event_id, status: "cancelled" });
  await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });
  assert.equal(db.prepare("SELECT id FROM agenda_items WHERE id = 1").get().id, 1);
  assert.equal(db.prepare("SELECT archived_at FROM google_calendar_event_links WHERE id = ?").get(link.id).archived_at != null, true);
});

test("A Google event created before an interrupted sync is linked without creating it again", async () => {
  const sourceId = Number(db.prepare(`
    INSERT INTO agenda_items (
      item_type, title, area, planned_date, start_time, end_time, status
    ) VALUES ('appointment', 'Linha arrastada', 'personal',
      '2026-11-06', '10:00', '11:00', 'scheduled')
  `).run().lastInsertRowid);
  const event = {
    id: 'created-before-interruption',
    summary: 'Linha arrastada',
    start: { dateTime: '2026-11-06T10:00:00-03:00' },
    end: { dateTime: '2026-11-06T11:00:00-03:00' },
    extendedProperties: { private: { sj_ascend_source: `agenda:${sourceId}` } },
  };
  calendarEvents.set(event.id, event);
  deltaEvents.push(event);
  const beforeCreateCount = nextEventId;

  const events = await calendarSync.getGoogleCalendarApiEvents({ from: '2026-11-06', until: '2026-11-07' });
  assert.equal(nextEventId, beforeCreateCount);
  assert.equal(events.find((item) => item.id === event.id).source_id, sourceId);
  assert.equal(db.prepare(`
    SELECT google_event_id FROM google_calendar_event_links
    WHERE source_type = 'agenda' AND source_id = ?
  `).get(sourceId).google_event_id, event.id);

  await calendarSync.synchronizeGoogleCalendar();
  assert.equal(nextEventId, beforeCreateCount);
});

test("Existing extra Google copies are not displayed as independent system appointments", async () => {
  const original = calendarEvents.get('created-before-interruption');
  const duplicate = { ...original, id: 'extra-copy-after-interruption', summary: 'Cópia antiga' };
  const independent = { ...original, id: 'independent-same-title', extendedProperties: {} };
  calendarEvents.set(duplicate.id, duplicate);
  calendarEvents.set(independent.id, independent);
  deltaEvents.push(duplicate, independent);

  const events = await calendarSync.getGoogleCalendarApiEvents({ from: '2026-11-06', until: '2026-11-07' });
  assert.ok(events.some((event) => event.id === original.id));
  assert.ok(events.some((event) => event.id === independent.id));
  assert.equal(events.some((event) => event.id === duplicate.id), false);
  assert.ok(calendarEvents.has(duplicate.id));
  const sourceId = Number(original.extendedProperties.private.sj_ascend_source.split(':')[1]);
  assert.equal(db.prepare('SELECT title FROM agenda_items WHERE id = ?').get(sourceId).title, original.summary);
  deltaEvents.push({ ...duplicate, status: 'cancelled' });
  await calendarSync.synchronizeGoogleCalendar();
  assert.equal(db.prepare(`
    SELECT archived_at FROM google_calendar_event_links WHERE source_type = 'agenda' AND source_id = ?
  `).get(sourceId).archived_at, null);
});

test("Google events can be edited and deleted through the Calendar API", async () => {
  const updated = await calendarSync.updateGoogleCalendarEvent("timed", {
    title: "Evento editado",
    description: "Descrição atualizada",
    location: "São Paulo",
    start_date: "2026-11-06",
    end_date: "2026-11-06",
    end_date_exclusive: "2026-11-07",
    start_time: "18:00",
    end_time: "19:15",
    all_day: false,
  });
  assert.equal(updated.summary, "Evento editado");
  assert.equal(updated.start.dateTime, "2026-11-06T18:00:00-03:00");
  assert.equal(updated.end.dateTime, "2026-11-06T19:15:00-03:00");

  await calendarSync.updateGoogleCalendarEventColor("timed", "8");
  assert.equal(calendarEvents.get("timed").colorId, "8");
  const [recolored] = await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });
  assert.equal(recolored.color_hex, "#929292");

  retainDeletedEventInList = true;
  await calendarSync.removeGoogleCalendarEvent("timed");
  assert.equal(calendarEvents.has("timed"), true);
  const afterDelete = await calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" });
  assert.equal(afterDelete.some((event) => event.id === "timed"), false);
  assert.equal(db.prepare("SELECT google_event_id FROM google_calendar_hidden_events WHERE google_event_id = 'timed'").get().google_event_id, "timed");
  await assert.rejects(
    calendarSync.updateGoogleCalendarEvent("timed", {
      title: "",
      start_date: "2026-11-06",
      end_date_exclusive: "2026-11-07",
      all_day: true,
    }),
    /título deve ter/,
  );
});

test("Push notifications accept the active channel and reject invalid tokens", () => {
  const headers = {
    "x-goog-channel-id": watchRequest.id,
    "x-goog-resource-id": "unit-test-resource",
    "x-goog-channel-token": watchRequest.token,
    "x-goog-resource-state": "exists",
  };

  assert.equal(calendarSync.handleGoogleCalendarNotification(headers), true);
  assert.deepEqual(emitted.at(-1), ["google-calendar:changed"]);
  assert.equal(calendarSync.handleGoogleCalendarNotification({ ...headers, "x-goog-channel-token": "invalid" }), false);
});

test("OAuth connection and automatic polling do not require a public webhook", async () => {
  db.prepare("DELETE FROM google_calendar_watch_channels").run();
  process.env.GOOGLE_CALENDAR_WEBHOOK_URL = "";

  const connection = calendarSync.getGoogleCalendarConnection();
  const watchCreated = await calendarSync.ensureGoogleCalendarWatch(true);

  assert.equal(connection.configured, true);
  assert.equal(connection.connected, true);
  assert.equal(connection.webhookConfigured, false);
  assert.equal(connection.watchActive, false);
  assert.equal(watchCreated, false);
});

test("Editing a Google event converts all-day to timed and back without conflicting fields", async () => {
  const common = {
    title: 'Evento convertido', start_date: '2026-11-16',
    end_date: '2026-11-16', end_date_exclusive: '2026-11-17',
    start_time: '16:00', end_time: '18:00',
  };
  const timed = await calendarSync.updateGoogleCalendarEvent('all-day', { ...common, all_day: false });
  assert.equal(timed.start.dateTime, '2026-11-16T16:00:00-03:00');
  assert.equal(timed.end.dateTime, '2026-11-16T18:00:00-03:00');
  assert.equal(timed.start.date, undefined);
  assert.equal(timed.end.date, undefined);
  const allDay = await calendarSync.updateGoogleCalendarEvent('all-day', { ...common, all_day: true });
  assert.deepEqual(allDay.start, { date: '2026-11-16' });
  assert.deepEqual(allDay.end, { date: '2026-11-17' });
});

test("Scheduling an all-day demand updates the existing Google event and can return to all-day", async () => {
  const link = db.prepare("SELECT * FROM google_calendar_event_links WHERE source_type = 'client_demand'").get();
  const beforeCreateCount = nextEventId;
  const original = calendarEvents.get(link.google_event_id);
  original.hangoutLink = 'https://meet.google.com/abc-defg-hij';
  original.colorId = '4';
  db.prepare("UPDATE client_demands SET demand_date = '2026-11-16', start_time = '16:00', end_time = '18:00' WHERE id = ?").run(link.source_id);
  await calendarSync.synchronizeGoogleCalendar();
  const timed = calendarEvents.get(link.google_event_id);
  assert.equal(timed.start.dateTime, '2026-11-16T16:00:00-03:00');
  assert.equal(timed.end.dateTime, '2026-11-16T18:00:00-03:00');
  assert.equal(timed.start.date, undefined);
  assert.equal(timed.end.date, undefined);
  assert.equal(timed.hangoutLink, original.hangoutLink);
  assert.equal(timed.colorId, '4');
  db.prepare('UPDATE client_demands SET start_time = NULL, end_time = NULL WHERE id = ?').run(link.source_id);
  await calendarSync.synchronizeGoogleCalendar();
  const allDay = calendarEvents.get(link.google_event_id);
  assert.deepEqual(allDay.start, { date: '2026-11-16' });
  assert.deepEqual(allDay.end, { date: '2026-11-17' });
  await calendarSync.synchronizeGoogleCalendar();
  assert.equal(nextEventId, beforeCreateCount);
});

test("Expired Google authorization gives a reconnect instruction", async () => {
  process.env.GOOGLE_CALENDAR_WEBHOOK_URL = "";
  authorizationExpiresIn = 1;
  const authorizationUrl = new URL(calendarSync.beginGoogleCalendarAuthorization());
  await calendarSync.completeGoogleCalendarAuthorization({
    code: "authorization-code",
    state: authorizationUrl.searchParams.get("state"),
  });
  rejectRefreshToken = true;

  await assert.rejects(
    calendarSync.getGoogleCalendarApiEvents({ from: "2026-11-06", until: "2026-11-07" }),
    /autorização do Google Agenda expirou ou foi revogada.*Reconectar Google/,
  );

  rejectRefreshToken = false;
  authorizationExpiresIn = 3600;
  const reconnectUrl = new URL(calendarSync.beginGoogleCalendarAuthorization());
  await calendarSync.completeGoogleCalendarAuthorization({
    code: "authorization-code",
    state: reconnectUrl.searchParams.get("state"),
  });
});
