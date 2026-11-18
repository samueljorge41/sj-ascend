import crypto from "node:crypto";
import db from "./database/db.js";

const TIME_ZONE = "America/Sao_Paulo";
const API_BASE = "https://www.googleapis.com/calendar/v3";
const TOKEN_URL = "https://oauth2.googleapis.com/token";
const AUTH_URL = "https://accounts.google.com/o/oauth2/v2/auth";
const SCOPE = "https://www.googleapis.com/auth/calendar.events";
const COLOR_SCOPE = "https://www.googleapis.com/auth/calendar.calendarlist.readonly";
const EVENT_COLORS = {
  "1": { background: "#a4bdfc", foreground: "#1d1d1d" },
  "2": { background: "#7ae7bf", foreground: "#1d1d1d" },
  "3": { background: "#dbadff", foreground: "#1d1d1d" },
  "4": { background: "#ff887c", foreground: "#1d1d1d" },
  "5": { background: "#fbd75b", foreground: "#1d1d1d" },
  "6": { background: "#ffb878", foreground: "#1d1d1d" },
  "7": { background: "#46d6db", foreground: "#1d1d1d" },
  "8": { background: "#929292", foreground: "#1d1d1d" },
  "9": { background: "#5484ed", foreground: "#ffffff" },
  "10": { background: "#51b749", foreground: "#1d1d1d" },
  "11": { background: "#dc2127", foreground: "#ffffff" },
};
const EVENT_LABEL_COLORS = {
  "5C53B84F-53F3-485C-8173-B25445B4487F": { background: "#352ef2", foreground: "#ffffff" },
  "437709b2-1a38-4ca1-a91f-31ccd6846506": { background: "#ea4335", foreground: "#ffffff" },
};
const CHANNEL_TTL_SECONDS = 7 * 24 * 60 * 60;
const RENEW_BEFORE_MS = 24 * 60 * 60 * 1000;
let realtime = null;
let renewalTimer = null;
let synchronizationTimer = null;
let synchronizationPromise = null;
let calendarColorsCache = null;

const selectStoredTokens = db.prepare(`
  SELECT token_iv, token_auth_tag, token_ciphertext
  FROM google_calendar_tokens WHERE id = 1
`);
const saveStoredTokens = db.prepare(`
  INSERT INTO google_calendar_tokens (id, token_iv, token_auth_tag, token_ciphertext)
  VALUES (1, @iv, @auth_tag, @ciphertext)
  ON CONFLICT(id) DO UPDATE SET
    token_iv = excluded.token_iv,
    token_auth_tag = excluded.token_auth_tag,
    token_ciphertext = excluded.token_ciphertext,
    updated_at = CURRENT_TIMESTAMP
`);

function config() {
  const missing = [
    ["GOOGLE_CALENDAR_CLIENT_ID", process.env.GOOGLE_CALENDAR_CLIENT_ID],
    ["GOOGLE_CALENDAR_CLIENT_SECRET", process.env.GOOGLE_CALENDAR_CLIENT_SECRET],
    ["GOOGLE_CALENDAR_REDIRECT_URI", process.env.GOOGLE_CALENDAR_REDIRECT_URI],
    ["GOOGLE_CALENDAR_TOKEN_KEY", process.env.GOOGLE_CALENDAR_TOKEN_KEY],
  ].filter(([, value]) => !value?.trim()).map(([name]) => name);
  return {
    missing,
    configured: missing.length === 0,
    clientId: process.env.GOOGLE_CALENDAR_CLIENT_ID?.trim(),
    clientSecret: process.env.GOOGLE_CALENDAR_CLIENT_SECRET?.trim(),
    redirectUri: process.env.GOOGLE_CALENDAR_REDIRECT_URI?.trim(),
    webhookUrl: process.env.GOOGLE_CALENDAR_WEBHOOK_URL?.trim(),
    webhookConfigured: Boolean(process.env.GOOGLE_CALENDAR_WEBHOOK_URL?.trim()),
    calendarId: process.env.GOOGLE_CALENDAR_ID?.trim() || "primary",
    returnUrl: process.env.GOOGLE_CALENDAR_RETURN_URL?.trim()
      || (process.env.BASE44_APP_BASE_URL ? `${process.env.BASE44_APP_BASE_URL.replace(/\/$/, "")}/agenda` : ""),
  };
}

function encryptionKey() {
  const encoded = process.env.GOOGLE_CALENDAR_TOKEN_KEY?.trim();
  const key = Buffer.from(encoded || "", "base64");
  if (key.length !== 32) throw new Error("GOOGLE_CALENDAR_TOKEN_KEY deve ser uma chave persistente de 32 bytes em Base64.");
  return key;
}

function encrypt(value) {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), "utf8"), cipher.final()]);
  return {
    iv: iv.toString("base64"),
    auth_tag: cipher.getAuthTag().toString("base64"),
    ciphertext: ciphertext.toString("base64"),
  };
}

function decrypt(record) {
  const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), Buffer.from(record.token_iv, "base64"));
  decipher.setAuthTag(Buffer.from(record.token_auth_tag, "base64"));
  return JSON.parse(Buffer.concat([
    decipher.update(Buffer.from(record.token_ciphertext, "base64")),
    decipher.final(),
  ]).toString("utf8"));
}

function readTokens() {
  const record = selectStoredTokens.get();
  return record ? decrypt(record) : null;
}

function writeTokens(tokens) {
  saveStoredTokens.run(encrypt(tokens));
}

function hash(value) {
  return crypto.createHash("sha256").update(value).digest("hex");
}

function safeEqual(left, right) {
  const a = Buffer.from(String(left || ""));
  const b = Buffer.from(String(right || ""));
  return a.length === b.length && crypto.timingSafeEqual(a, b);
}

async function fetchJson(url, options = {}) {
  const response = await fetch(url, { ...options, signal: AbortSignal.timeout(15_000) });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) {
    const message = data.error_description || data.error?.message || data.error || "A API do Google Agenda retornou um erro.";
    const error = new Error(String(message).slice(0, 300));
    error.status = response.status;
    error.code = typeof data.error === "string" ? data.error : data.error?.status;
    throw error;
  }
  return data;
}

async function exchangeToken(parameters) {
  const settings = config();
  const body = new URLSearchParams({
    client_id: settings.clientId || "",
    client_secret: settings.clientSecret || "",
    ...parameters,
  });
  return fetchJson(TOKEN_URL, {
    method: "POST",
    headers: { "Content-Type": "application/x-www-form-urlencoded" },
    body,
  });
}

async function accessToken() {
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error("Conecte uma conta Google para carregar a agenda.");
  if (tokens.access_token && tokens.expires_at > Date.now() + 60_000) return tokens.access_token;
  let refreshed;
  try {
    refreshed = await exchangeToken({
      grant_type: "refresh_token",
      refresh_token: tokens.refresh_token,
    });
  } catch (error) {
    if (error.code !== "invalid_grant") throw error;
    const reconnectError = new Error("A autorização do Google Agenda expirou ou foi revogada. Clique em Reconectar Google para entrar novamente.");
    reconnectError.status = error.status;
    throw reconnectError;
  }
  writeTokens({
    ...tokens,
    ...refreshed,
    refresh_token: refreshed.refresh_token || tokens.refresh_token,
    expires_at: Date.now() + Number(refreshed.expires_in || 3600) * 1000,
  });
  return refreshed.access_token;
}

function addDays(date, amount) {
  const value = new Date(`${date}T00:00:00Z`);
  value.setUTCDate(value.getUTCDate() + amount);
  return value.toISOString().slice(0, 10);
}

function localParts(value) {
  const date = new Date(value);
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
    hour: "2-digit",
    minute: "2-digit",
    hourCycle: "h23",
  }).formatToParts(date).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return {
    date: `${parts.year}-${parts.month}-${parts.day}`,
    time: `${parts.hour}:${parts.minute}`,
  };
}

function mapEvent(event) {
  if (!event.start || event.status === "cancelled") return null;
  if (event.start.date) {
    const startDate = event.start.date;
    const endDate = event.end?.date || addDays(startDate, 1);
    return {
      id: event.id,
      color_id: event.colorId || null,
      event_label_id: event.eventLabelId || null,
      title: String(event.summary || "Evento do Google Agenda").slice(0, 200),
      description: String(event.description || "").slice(0, 4000),
      location: String(event.location || "").slice(0, 500),
      meet_link: event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || null,
      start_date: startDate,
      end_date_exclusive: endDate > startDate ? endDate : addDays(startDate, 1),
      start_time: null,
      end_time: null,
      all_day: true,
    };
  }
  if (!event.start.dateTime) return null;
  const start = localParts(event.start.dateTime);
  const end = localParts(event.end?.dateTime || event.start.dateTime);
  return {
    id: event.id,
    color_id: event.colorId || null,
    event_label_id: event.eventLabelId || null,
    title: String(event.summary || "Evento do Google Agenda").slice(0, 200),
    description: String(event.description || "").slice(0, 4000),
    location: String(event.location || "").slice(0, 500),
    meet_link: event.hangoutLink || event.conferenceData?.entryPoints?.find((entry) => entry.entryPointType === "video")?.uri || null,
    start_date: start.date,
    end_date: end.date,
    end_date_exclusive: end.time === "00:00" && end.date > start.date ? end.date : addDays(end.date, 1),
    start_time: start.time,
    end_time: end.time,
    all_day: false,
  };
}

export async function getGoogleCalendarApiEvents({ from, until }) {
  const settings = config();
  if (!settings.configured) throw new Error("A integração oficial do Google Agenda não está configurada no servidor.");
  await synchronizeGoogleCalendar();
  const token = await accessToken();
  const calendarId = encodeURIComponent(settings.calendarId);
  const timeMin = new Date(`${from}T00:00:00-03:00`).toISOString();
  const timeMax = new Date(`${addDays(until, 1)}T00:00:00-03:00`).toISOString();
  const events = [];
  const eventSourceKeys = new Map();
  let pageToken = "";
  do {
    const query = new URLSearchParams({
      singleEvents: "true",
      showDeleted: "false",
      orderBy: "startTime",
      timeMin,
      timeMax,
      timeZone: TIME_ZONE,
      maxResults: "2500",
    });
    if (pageToken) query.set("pageToken", pageToken);
    const result = await fetchJson(`${API_BASE}/calendars/${calendarId}/events?${query}`, {
      headers: { Authorization: `Bearer ${token}` },
    });
    for (const event of result.items || []) {
      eventSourceKeys.set(event.id, event.extendedProperties?.private?.sj_ascend_source);
      const mapped = mapEvent(event);
      if (mapped) events.push(mapped);
    }
    pageToken = result.nextPageToken || "";
  } while (pageToken);
  let eventColors = EVENT_COLORS;
  let colorWarning = "";
  if (readTokens()?.scope?.split(/\s+/).includes(COLOR_SCOPE)) {
    try {
      if (!calendarColorsCache || calendarColorsCache.expiresAt <= Date.now()) {
        const palette = await fetchJson(`${API_BASE}/colors`, {
          headers: { Authorization: `Bearer ${token}` },
        });
        calendarColorsCache = {
          eventColors: palette.event || {},
          expiresAt: Date.now() + 60 * 60 * 1000,
        };
      }
      eventColors = calendarColorsCache.eventColors;
    } catch (error) {
      colorWarning = `Não foi possível carregar as cores do Google Agenda: ${error.message}`;
      console.error(colorWarning);
    }
  }
  const hiddenEventIds = new Set(db.prepare(`
    SELECT google_event_id FROM google_calendar_hidden_events
  `).all().map(({ google_event_id }) => google_event_id));
  const eventsWithColors = events.filter((event) => !hiddenEventIds.has(event.id)).map((event) => {
    const color = event.color_id
      ? (event.color_id === "8"
        ? EVENT_COLORS["8"]
        : eventColors[event.color_id] || EVENT_COLORS[event.color_id] || null)
      : EVENT_LABEL_COLORS[event.event_label_id] || null;
    return {
      ...event,
      color_hex: color?.background || null,
      color_foreground: color?.foreground || null,
      color_warning: colorWarning,
    };
  });
  const links = db.prepare(`
    SELECT google_event_id, source_type, source_id
    FROM google_calendar_event_links
    WHERE archived_at IS NULL
  `).all();
  const linksByEvent = new Map(links.map((link) => [link.google_event_id, link]));
  const linksBySource = new Map(links.map((link) => [sourceKey(link.source_type, link.source_id), link]));
  return eventsWithColors.filter((event) => {
    // An interrupted older sync may have left an extra Google copy of a linked item.
    const link = linksBySource.get(eventSourceKeys.get(event.id));
    return !link || link.google_event_id === event.id;
  }).map((event) => {
    const link = linksByEvent.get(event.id);
    return link ? { ...event, source_type: link.source_type, source_id: link.source_id } : event;
  });
}

function getCalendarSourceItems() {
  const agendaItems = db.prepare(`
    SELECT id, item_type, title, description, planned_date, due_date, start_time, end_time
    FROM agenda_items
    WHERE COALESCE(planned_date, due_date) IS NOT NULL
  `).all().map((record) => ({
    sourceType: "agenda",
    sourceId: record.id,
    title: record.title,
    description: record.description || "",
    date: record.planned_date || record.due_date,
    startTime: record.start_time,
    endTime: record.end_time,
    itemType: record.item_type,
  }));
  const demands = db.prepare(`
    SELECT d.id, d.title, d.observation, d.demand_date, d.start_time, d.end_time
    FROM client_demands d
    JOIN clients c ON c.id = d.client_id
    WHERE c.active = 1
  `).all().map((record) => ({
    sourceType: "client_demand",
    sourceId: record.id,
    title: record.title,
    description: record.observation || "",
    date: record.demand_date,
    startTime: record.start_time,
    endTime: record.end_time,
  }));
  const prospects = db.prepare(`
    SELECT p.id, p.next_action, p.next_action_date, p.next_action_start_time,
      p.next_action_end_time, p.notes
    FROM prospects p
    JOIN acquisition_stages s ON s.id = p.stage_id
    WHERE p.next_action_date <> '' AND s.is_won = 0 AND s.is_lost = 0
  `).all().map((record) => ({
    sourceType: "prospect",
    sourceId: record.id,
    title: record.next_action || "Ação comercial",
    description: record.notes || "",
    date: record.next_action_date,
    startTime: record.next_action_start_time,
    endTime: record.next_action_end_time,
  }));
  return [...agendaItems, ...demands, ...prospects].filter((item) => item.date);
}

function sourceKey(sourceType, sourceId) {
  return `${sourceType}:${sourceId}`;
}

function sourceSnapshot(source) {
  return {
    title: source.title,
    description: source.description || "",
    date: source.date,
    startTime: source.startTime || null,
    endTime: source.endTime || null,
  };
}

function sourceEvent(source) {
  const key = sourceKey(source.sourceType, source.sourceId);
  const event = {
    summary: source.title,
    description: source.description || "",
    extendedProperties: { private: { sj_ascend_source: key } },
  };
  const colorOverride = db.prepare(`
    SELECT color_id FROM agenda_event_color_overrides
    WHERE source_type = ? AND source_id = ?
  `).get(source.sourceType, String(source.sourceId));
  if (colorOverride) event.colorId = colorOverride.color_id;
  if (source.startTime && source.endTime) {
    event.start = {
      date: null,
      dateTime: `${source.date}T${source.startTime}:00-03:00`,
      timeZone: TIME_ZONE,
    };
    event.end = {
      date: null,
      dateTime: `${source.date}T${source.endTime}:00-03:00`,
      timeZone: TIME_ZONE,
    };
  } else {
    // PATCH keeps omitted fields, so clear the previous timed representation.
    event.start = { date: source.date, dateTime: null, timeZone: null };
    event.end = { date: addDays(source.date, 1), dateTime: null, timeZone: null };
  }
  return event;
}

function eventSnapshot(event) {
  const mapped = mapEvent(event);
  if (!mapped) return null;
  return {
    title: mapped.title,
    description: mapped.description,
    date: mapped.start_date,
    startTime: mapped.start_time,
    endTime: mapped.end_time,
    endDateExclusive: mapped.end_date_exclusive,
    allDay: mapped.all_day,
    colorId: mapped.color_id,
    eventLabelId: mapped.event_label_id,
  };
}

function readSyncSnapshot(value) {
  try {
    const snapshot = JSON.parse(value || "{}");
    return {
      local: snapshot.local || null,
      google: snapshot.google || null,
    };
  } catch {
    throw new Error("O estado da sincronização do Google Agenda está inválido.");
  }
}

function updateLinkSnapshot(linkId, local, google) {
  db.prepare(`
    UPDATE google_calendar_event_links
    SET last_synced_json = ?, updated_at = CURRENT_TIMESTAMP
    WHERE id = ?
  `).run(JSON.stringify({ local, google }), linkId);
}

function saveLink(source, event, existingLink = null) {
  const snapshot = JSON.stringify({
    local: sourceSnapshot(source),
    google: eventSnapshot(event),
  });
  if (existingLink) {
    db.prepare(`
      UPDATE google_calendar_event_links
      SET google_event_id = ?, last_synced_json = ?, archived_at = NULL,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(event.id, snapshot, existingLink.id);
    return;
  }
  db.prepare(`
    INSERT INTO google_calendar_event_links (
      source_type, source_id, google_event_id, last_synced_json
    ) VALUES (?, ?, ?, ?)
    ON CONFLICT(source_type, source_id) DO NOTHING
  `).run(source.sourceType, source.sourceId, event.id, snapshot);
}

function findSourceRecord(sourceType, sourceId) {
  if (sourceType === "agenda") {
    const record = db.prepare(`
      SELECT id, item_type, title, description, planned_date, due_date, start_time, end_time
      FROM agenda_items WHERE id = ?
    `).get(sourceId);
    return record ? {
      sourceType, sourceId: record.id, title: record.title,
      description: record.description || "", date: record.planned_date || record.due_date,
      startTime: record.start_time, endTime: record.end_time, itemType: record.item_type,
        planned_date: record.planned_date, due_date: record.due_date,
    } : null;
  }
  if (sourceType === "client_demand") {
    const record = db.prepare(`
      SELECT id, title, observation, demand_date, start_time, end_time
      FROM client_demands WHERE id = ?
    `).get(sourceId);
    return record ? {
      sourceType, sourceId: record.id, title: record.title,
      description: record.observation || "", date: record.demand_date,
      startTime: record.start_time, endTime: record.end_time,
    } : null;
  }
  if (sourceType === "prospect") {
    const record = db.prepare(`
      SELECT id, next_action, next_action_date, next_action_start_time,
        next_action_end_time, notes
      FROM prospects WHERE id = ?
    `).get(sourceId);
    return record ? {
      sourceType, sourceId: record.id, title: record.next_action || "Ação comercial",
      description: record.notes || "", date: record.next_action_date,
      startTime: record.next_action_start_time, endTime: record.next_action_end_time,
    } : null;
  }
  return null;
}

function applyGoogleEventToSource(source, event) {
  const mapped = mapEvent(event);
  if (!mapped) return;
  if (mapped.color_id) {
    db.prepare(`
      INSERT INTO agenda_event_color_overrides (source_type, source_id, color_id)
      VALUES (?, ?, ?)
      ON CONFLICT(source_type, source_id) DO UPDATE SET
        color_id = excluded.color_id, updated_at = CURRENT_TIMESTAMP
    `).run(source.sourceType, String(source.sourceId), mapped.color_id);
  } else {
    db.prepare(`
      DELETE FROM agenda_event_color_overrides
      WHERE source_type = ? AND source_id = ?
    `).run(source.sourceType, String(source.sourceId));
  }
  const title = String(event.summary || "Evento do Google Agenda").slice(0, 200);
  const description = String(event.description || "").slice(0, 4000);
  const startTime = mapped.all_day ? null : mapped.start_time;
  const endTime = mapped.all_day ? null : mapped.end_time;
  if (source.sourceType === "agenda") {
    const hasPlannedDate = source.itemType === "appointment" || Boolean(source.planned_date);
    const dateColumn = hasPlannedDate || (startTime && endTime)
      ? "planned_date"
      : "due_date";
    const dueDate = source.due_date && source.due_date < mapped.start_date
      ? mapped.start_date
      : source.due_date;
    db.prepare(`
      UPDATE agenda_items
      SET title = ?, description = ?, ${dateColumn} = ?, due_date = ?, start_time = ?, end_time = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, description, mapped.start_date, dueDate, startTime, endTime, source.sourceId);
  } else if (source.sourceType === "client_demand") {
    db.prepare(`
      UPDATE client_demands
      SET title = ?, observation = ?, demand_date = ?, start_time = ?, end_time = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, description, mapped.start_date, startTime, endTime, source.sourceId);
  } else if (source.sourceType === "prospect") {
    db.prepare(`
      UPDATE prospects
      SET next_action = ?, notes = ?, next_action_date = ?, next_action_start_time = ?,
        next_action_end_time = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(title, description, mapped.start_date, startTime, endTime, source.sourceId);
  }
}

async function calendarRequest(pathname, token, options = {}) {
  const settings = config();
  return fetchJson(`${API_BASE}/calendars/${encodeURIComponent(settings.calendarId)}/${pathname}`, {
    ...options,
    headers: {
      Authorization: `Bearer ${token}`,
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
}

async function getCalendarChanges(token) {
  const storedState = db.prepare(`
    SELECT sync_token FROM google_calendar_sync_state WHERE id = 1
  `).get();
  const changes = [];
  let pageToken = "";
  let nextSyncToken = "";
  try {
    do {
      const query = new URLSearchParams({ maxResults: "2500" });
      if (storedState?.sync_token) query.set("syncToken", storedState.sync_token);
      else {
        query.set("singleEvents", "false");
        query.set("showDeleted", "true");
      }
      if (pageToken) query.set("pageToken", pageToken);
      const result = await calendarRequest(`events?${query}`, token);
      changes.push(...(result.items || []));
      pageToken = result.nextPageToken || "";
      nextSyncToken = result.nextSyncToken || nextSyncToken;
    } while (pageToken);
  } catch (error) {
    if (storedState?.sync_token && error.status === 410) {
      db.prepare("DELETE FROM google_calendar_sync_state WHERE id = 1").run();
      return getCalendarChanges(token);
    }
    throw error;
  }
  if (!nextSyncToken) throw new Error("O Google Agenda não retornou o cursor de sincronização.");
  return { changes, nextSyncToken };
}

async function deleteCalendarEvent(eventId, token) {
  const settings = config();
  const response = await fetch(
    `${API_BASE}/calendars/${encodeURIComponent(settings.calendarId)}/events/${encodeURIComponent(eventId)}`,
    {
      method: "DELETE",
      headers: { Authorization: `Bearer ${token}` },
      signal: AbortSignal.timeout(15_000),
    },
  );
  if (!response.ok && response.status !== 404 && response.status !== 410) {
    const data = await response.json().catch(() => ({}));
    throw new Error(data.error?.message || `O Google Agenda recusou a exclusão do evento (${response.status}).`);
  }
}

function googleEventInput(input) {
  const title = String(input.title || "").trim();
  const description = String(input.description || "").trim();
  const location = String(input.location || "").trim();
  const startDate = String(input.start_date || "").trim();
  const endDateExclusive = String(input.end_date_exclusive || "").trim();
  let endDate = String(input.end_date || "").trim();
  const startTime = String(input.start_time || "").trim();
  const endTime = String(input.end_time || "").trim();
  const allDay = input.all_day === true;
  const validDate = (value) => /^\d{4}-\d{2}-\d{2}$/.test(value)
    && !Number.isNaN(new Date(`${value}T00:00:00Z`).getTime())
    && new Date(`${value}T00:00:00Z`).toISOString().slice(0, 10) === value;
  if (!title || title.length > 200) throw new Error("O título deve ter entre 1 e 200 caracteres.");
  if (description.length > 4000 || location.length > 500) throw new Error("Descrição ou local excede o limite permitido.");
  if (!validDate(startDate) || !validDate(endDateExclusive) || endDateExclusive <= startDate) {
    throw new Error("Informe datas válidas e um término posterior ao início.");
  }
  const event = { summary: title, description, location };
  if (allDay) {
    event.start = { date: startDate, dateTime: null, timeZone: null };
    event.end = { date: endDateExclusive, dateTime: null, timeZone: null };
    return event;
  }
  if (!endDate) endDate = addDays(endDateExclusive, -1);
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime)
    || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime)
    || !validDate(endDate)
    || endDate < startDate
    || (endDate === startDate && endTime <= startTime && endTime !== "00:00")) {
    throw new Error("Informe datas e horários válidos; o término deve ser depois do início.");
  }
  event.start = { date: null, dateTime: `${startDate}T${startTime}:00-03:00`, timeZone: TIME_ZONE };
  event.end = { date: null, dateTime: `${endDate}T${endTime}:00-03:00`, timeZone: TIME_ZONE };
  return event;
}

export async function updateGoogleCalendarEvent(eventId, input) {
  if (!eventId || typeof eventId !== "string") throw new Error("Evento do Google inválido.");
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error("Conecte uma conta Google para editar eventos.");
  if (!tokens.scope?.split(" ").includes(SCOPE)) {
    throw new Error("Reautorize a conta Google para permitir editar eventos.");
  }
  const event = await calendarRequest(`events/${encodeURIComponent(eventId)}`, await accessToken(), {
    method: "PATCH",
    body: JSON.stringify(googleEventInput(input)),
  });
  await synchronizeGoogleCalendar();
  realtime?.emit("google-calendar:changed");
  return event;
}

export async function updateGoogleCalendarEventColor(eventId, colorId) {
  if (!eventId || typeof eventId !== "string") throw new Error("Evento do Google inválido.");
  if (colorId != null && !/^(?:[1-9]|1[01])$/.test(String(colorId))) {
    throw new Error("Selecione uma cor válida da agenda.");
  }
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error("Conecte uma conta Google para alterar as cores.");
  if (!tokens.scope?.split(/\s+/).includes(SCOPE)) {
    throw new Error("Reautorize a conta Google para permitir alterar as cores.");
  }
  const event = await calendarRequest(`events/${encodeURIComponent(eventId)}`, await accessToken(), {
    method: "PATCH",
    body: JSON.stringify({ colorId: colorId == null ? null : String(colorId) }),
  });
  await synchronizeGoogleCalendar();
  realtime?.emit("google-calendar:changed");
  return event;
}

export async function removeGoogleCalendarEvent(eventId) {
  if (!eventId || typeof eventId !== "string") throw new Error("Evento do Google inválido.");
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error("Conecte uma conta Google para excluir eventos.");
  if (!tokens.scope?.split(" ").includes(SCOPE)) {
    throw new Error("Reautorize a conta Google para permitir excluir eventos.");
  }
  await deleteCalendarEvent(eventId, await accessToken());
  db.prepare(`
    INSERT OR IGNORE INTO google_calendar_hidden_events (google_event_id)
    VALUES (?)
  `).run(eventId);
  await synchronizeGoogleCalendar();
  realtime?.emit("google-calendar:changed");
}

async function syncCalendar() {
  const settings = config();
  if (!settings.configured) throw new Error("A integração oficial do Google Agenda não está configurada no servidor.");
  const tokens = readTokens();
  if (!tokens?.refresh_token) throw new Error("Conecte uma conta Google para sincronizar a agenda.");
  if (!tokens.scope?.split(" ").includes(SCOPE)) {
    throw new Error("Reautorize a conta Google para permitir criar, editar e excluir eventos.");
  }
  const token = await accessToken();
  const sources = getCalendarSourceItems();
  const bySource = new Map(sources.map((source) => [sourceKey(source.sourceType, source.sourceId), source]));
  const linksByEvent = new Map(db.prepare(`
    SELECT * FROM google_calendar_event_links WHERE archived_at IS NULL
  `).all().map((link) => [link.google_event_id, link]));

  const { changes, nextSyncToken } = await getCalendarChanges(token);
  for (const event of changes) {
    let link = linksByEvent.get(event.id);
    if (!link) {
      const propertyKey = event.extendedProperties?.private?.sj_ascend_source;
      const separator = propertyKey?.lastIndexOf(":") ?? -1;
      if (separator > 0) {
        const source = bySource.get(propertyKey);
        if (source && Number(propertyKey.slice(separator + 1)) === Number(source.sourceId)) {
          const existingLink = db.prepare(`
            SELECT id FROM google_calendar_event_links WHERE source_type = ? AND source_id = ?
          `).get(source.sourceType, source.sourceId);
          // Only recover a missing link; extra copies must not replace or archive it.
          if (existingLink) continue;
          saveLink(source, event);
          link = db.prepare(`
            SELECT * FROM google_calendar_event_links WHERE source_type = ? AND source_id = ?
          `).get(source.sourceType, source.sourceId);
          if (link) linksByEvent.set(event.id, link);
        }
      }
    }
    if (!link) continue;
    if (event.status === "cancelled") {
      db.prepare(`
        UPDATE google_calendar_event_links
        SET archived_at = CURRENT_TIMESTAMP, updated_at = CURRENT_TIMESTAMP
        WHERE id = ?
      `).run(link.id);
      linksByEvent.delete(event.id);
      continue;
    }
    const source = findSourceRecord(link.source_type, link.source_id);
    if (!source) continue;
    const snapshot = readSyncSnapshot(link.last_synced_json);
    const remoteSnapshot = eventSnapshot(event);
    if (remoteSnapshot && JSON.stringify(remoteSnapshot) !== JSON.stringify(snapshot.google)) {
      applyGoogleEventToSource(source, event);
      const updatedSource = findSourceRecord(link.source_type, link.source_id);
      updateLinkSnapshot(link.id, sourceSnapshot(updatedSource), remoteSnapshot);
    }
  }

  const currentLinks = db.prepare(`
    SELECT * FROM google_calendar_event_links
  `).all();
  const linksBySource = new Map(currentLinks.map((link) => [
    sourceKey(link.source_type, link.source_id),
    link,
  ]));
  for (const source of getCalendarSourceItems()) {
    const key = sourceKey(source.sourceType, source.sourceId);
    const link = linksBySource.get(key);
    if (link?.archived_at) continue;
    if (!link) {
      const event = await calendarRequest("events", token, {
        method: "POST",
        body: JSON.stringify(sourceEvent(source)),
      });
      saveLink(source, event);
      continue;
    }
    const snapshot = readSyncSnapshot(link.last_synced_json);
    const localSnapshot = sourceSnapshot(source);
    if (JSON.stringify(localSnapshot) === JSON.stringify(snapshot.local)) continue;
    const event = await calendarRequest(`events/${encodeURIComponent(link.google_event_id)}`, token, {
      method: "PATCH",
      body: JSON.stringify(sourceEvent(source)),
    });
    updateLinkSnapshot(link.id, localSnapshot, eventSnapshot(event));
  }

  for (const link of currentLinks) {
    if (!link.archived_at && !bySource.has(sourceKey(link.source_type, link.source_id))) {
      await deleteCalendarEvent(link.google_event_id, token);
      db.prepare("DELETE FROM google_calendar_event_links WHERE id = ?").run(link.id);
    }
  }
  if (nextSyncToken) {
    db.prepare(`
      INSERT INTO google_calendar_sync_state (id, sync_token)
      VALUES (1, ?)
      ON CONFLICT(id) DO UPDATE SET
        sync_token = excluded.sync_token,
        updated_at = CURRENT_TIMESTAMP
    `).run(nextSyncToken);
  }
}

export function synchronizeGoogleCalendar() {
  if (synchronizationPromise) return synchronizationPromise;
  synchronizationPromise = syncCalendar().finally(() => {
    synchronizationPromise = null;
  });
  return synchronizationPromise;
}

export function getGoogleCalendarLinkedSources() {
  return db.prepare(`
    SELECT source_type, source_id, archived_at
    FROM google_calendar_event_links
  `).all().map((link) => ({
    sourceType: link.source_type,
    sourceId: link.source_id,
    archived: Boolean(link.archived_at),
  }));
}

export function getGoogleCalendarConnection() {
  const settings = config();
  let tokens = null;
  if (settings.configured) tokens = readTokens();
  const watch = db.prepare(`
    SELECT channel_id, resource_id, expires_at
    FROM google_calendar_watch_channels
    WHERE expires_at > ?
    ORDER BY expires_at DESC
    LIMIT 1
  `).get(Date.now());
  return {
    configured: settings.configured,
    missingConfiguration: settings.missing,
    webhookConfigured: settings.webhookConfigured,
    connected: Boolean(tokens?.refresh_token),
    writeAccess: Boolean(tokens?.scope?.split(" ").includes(SCOPE)),
    colorReadAccess: Boolean(tokens?.scope?.split(/\s+/).includes(COLOR_SCOPE)),
    watchActive: settings.webhookConfigured && Boolean(watch?.resource_id),
    watchExpiresAt: watch?.expires_at || null,
  };
}

export function beginGoogleCalendarAuthorization() {
  const settings = config();
  if (!settings.configured) throw new Error(`Configure no servidor: ${settings.missing.join(", ")}.`);
  const state = crypto.randomBytes(32).toString("hex");
  const expiresAt = Date.now() + 10 * 60_000;
  db.prepare("DELETE FROM google_calendar_oauth_states WHERE expires_at <= ?").run(Date.now());
  db.prepare(`
    INSERT INTO google_calendar_oauth_states (state_hash, expires_at)
    VALUES (?, ?)
  `).run(hash(state), expiresAt);
  const url = new URL(AUTH_URL);
  url.search = new URLSearchParams({
    client_id: settings.clientId,
    redirect_uri: settings.redirectUri,
    response_type: "code",
    scope: `${SCOPE} ${COLOR_SCOPE}`,
    access_type: "offline",
    prompt: "consent",
    include_granted_scopes: "true",
    state,
  }).toString();
  return url.toString();
}

export async function completeGoogleCalendarAuthorization({ code, state }) {
  const stateHash = hash(state);
  const consumeState = db.transaction(() => {
    const pending = db.prepare(`
      SELECT expires_at FROM google_calendar_oauth_states WHERE state_hash = ?
    `).get(stateHash);
    db.prepare("DELETE FROM google_calendar_oauth_states WHERE state_hash = ?").run(stateHash);
    return pending;
  });
  const pending = consumeState();
  if (!pending || pending.expires_at <= Date.now()) throw new Error("A autorização do Google expirou ou não é válida. Tente conectar novamente.");
  const tokens = await exchangeToken({
    code,
    grant_type: "authorization_code",
    redirect_uri: config().redirectUri,
  });
  const grantedScopes = new Set(String(tokens.scope || "").split(/\s+/).filter(Boolean));
  if (!grantedScopes.has(SCOPE)) {
    throw new Error("O Google não concedeu a permissão de edição do Calendar. Confira a tela de consentimento, marque a permissão solicitada e tente novamente.");
  }
  const existingTokens = readTokens();
  const refreshToken = tokens.refresh_token || existingTokens?.refresh_token;
  if (!refreshToken) throw new Error("O Google não forneceu um token renovável. Revogue o acesso do aplicativo Google e tente conectar novamente.");
  calendarColorsCache = null;
  writeTokens({
    access_token: tokens.access_token,
    refresh_token: refreshToken,
    expires_at: Date.now() + Number(tokens.expires_in || 3600) * 1000,
    scope: tokens.scope,
    token_type: tokens.token_type,
  });
  await ensureGoogleCalendarWatch(true);
}

export async function ensureGoogleCalendarWatch(force = false) {
  const settings = config();
  if (!settings.configured || !readTokens()?.refresh_token) return false;
  if (!settings.webhookConfigured) return false;
  db.prepare("DELETE FROM google_calendar_watch_channels WHERE expires_at <= ?").run(Date.now());
  const current = db.prepare(`
    SELECT channel_id, resource_id, expires_at
    FROM google_calendar_watch_channels
    WHERE expires_at > ?
    ORDER BY expires_at DESC
    LIMIT 1
  `).get(Date.now());
  if (!force && current?.resource_id && current.expires_at > Date.now() + RENEW_BEFORE_MS) return true;

  const channelId = crypto.randomUUID();
  const channelToken = crypto.randomBytes(32).toString("hex");
  db.prepare(`
    INSERT INTO google_calendar_watch_channels (channel_id, token_hash, expires_at)
    VALUES (?, ?, ?)
  `).run(channelId, hash(channelToken), Date.now() + 60_000);
  try {
    const token = await accessToken();
    const response = await fetchJson(`${API_BASE}/calendars/${encodeURIComponent(settings.calendarId)}/events/watch`, {
      method: "POST",
      headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
      body: JSON.stringify({
        id: channelId,
        type: "web_hook",
        address: settings.webhookUrl,
        token: channelToken,
        params: { ttl: String(CHANNEL_TTL_SECONDS) },
      }),
    });
    if (!response.resourceId) throw new Error("O Google não retornou o identificador do canal de notificações.");
    const expiresAt = Number(response.expiration) || Date.now() + CHANNEL_TTL_SECONDS * 1000;
    db.prepare(`
      UPDATE google_calendar_watch_channels
      SET resource_id = ?, expires_at = ?
      WHERE channel_id = ?
    `).run(response.resourceId, expiresAt, channelId);
    if (current) {
      db.prepare("DELETE FROM google_calendar_watch_channels WHERE channel_id = ?").run(current.channel_id);
      try {
        await fetchJson(`${API_BASE}/channels/stop`, {
          method: "POST",
          headers: { Authorization: `Bearer ${token}`, "Content-Type": "application/json" },
          body: JSON.stringify({ id: current.channel_id, resourceId: current.resource_id }),
        });
      } catch (error) {
        console.error("Não foi possível encerrar o canal anterior do Google Agenda:", error.message);
      }
    }
    return true;
  } catch (error) {
    db.prepare("DELETE FROM google_calendar_watch_channels WHERE channel_id = ?").run(channelId);
    throw error;
  }
}

export function handleGoogleCalendarNotification(headers) {
  const channelId = headers["x-goog-channel-id"];
  const resourceId = headers["x-goog-resource-id"];
  const channelToken = headers["x-goog-channel-token"];
  const resourceState = headers["x-goog-resource-state"];
  if (!channelId || !channelToken) return false;
  const channel = db.prepare(`
    SELECT resource_id, token_hash, expires_at
    FROM google_calendar_watch_channels WHERE channel_id = ?
  `).get(channelId);
  if (!channel || channel.expires_at <= Date.now() || !safeEqual(channel.token_hash, hash(channelToken))) return false;
  if (channel.resource_id && channel.resource_id !== resourceId) return false;
  if (resourceState === "exists" || resourceState === "not_exists") realtime?.emit("google-calendar:changed");
  return true;
}

export function setGoogleCalendarRealtime(io) {
  realtime = io;
}

export function startGoogleCalendarWatchRenewal() {
  if (renewalTimer) return;
  const renew = () => ensureGoogleCalendarWatch().catch((error) => {
    console.error("Não foi possível renovar as notificações do Google Agenda:", error.message);
  });
  renew();
  renewalTimer = setInterval(renew, 12 * 60 * 60 * 1000);
  renewalTimer.unref?.();
}

export function startGoogleCalendarBackgroundSync() {
  if (synchronizationTimer) return;
  const synchronize = () => {
    if (!getGoogleCalendarConnection().writeAccess) return;
    synchronizeGoogleCalendar().catch((error) => {
      console.error("Não foi possível sincronizar eventos com o Google Agenda:", error.message);
    });
  };
  synchronize();
  synchronizationTimer = setInterval(synchronize, 30_000);
  synchronizationTimer.unref?.();
}
