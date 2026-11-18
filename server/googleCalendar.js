import ical from "node-ical";

const TIME_ZONE = "America/Sao_Paulo";
const CACHE_DURATION = 5 * 60 * 1000;
const MAX_FEED_SIZE = 5 * 1024 * 1024;
const MAX_RANGE_DAYS = 90;
const SUBIDO_PRO_CALENDAR_ICAL_URL = "https://calendar.google.com/calendar/ical/calendariosubidopro%40gmail.com/public/basic.ics";
const cachedCalendars = new Map();
const pendingCalendars = new Map();

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function calendarUrl(value) {
  let url;
  try {
    url = new URL(value);
  } catch {
    throw new Error("O endereço iCal do Google Agenda não é válido.");
  }
  if (url.protocol !== "https:" || url.hostname !== "calendar.google.com" || url.port || url.username || url.password || !url.pathname.startsWith("/calendar/ical/")) {
    throw new Error("O endereço iCal deve ser um link HTTPS do Google Agenda.");
  }
  return url;
}

function dateParts(date, dateOnly = false) {
  if (dateOnly) {
    return {
      date: date.toISOString().slice(0, 10),
      time: null,
    };
  }
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

function dateFromWallTime(date, timeZone) {
  const targetTime = Date.UTC(
    date.getUTCFullYear(),
    date.getUTCMonth(),
    date.getUTCDate(),
    date.getUTCHours(),
    date.getUTCMinutes(),
    date.getUTCSeconds(),
  );
  let adjusted = new Date(targetTime);
  for (let attempt = 0; attempt < 2; attempt += 1) {
    const parts = new Intl.DateTimeFormat("en-CA", {
      timeZone,
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
      hourCycle: "h23",
    }).formatToParts(adjusted).reduce((result, part) => {
      result[part.type] = part.value;
      return result;
    }, {});
    const representedTime = Date.UTC(
      Number(parts.year),
      Number(parts.month) - 1,
      Number(parts.day),
      Number(parts.hour),
      Number(parts.minute),
      Number(parts.second),
    );
    adjusted = new Date(adjusted.getTime() + targetTime - representedTime);
  }
  return adjusted;
}

function addDays(value, amount) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function eventItem(event, instance = event) {
  if (!(instance.start instanceof Date)) return null;
  const start = dateParts(instance.start, Boolean(instance.isFullDay || instance.start.dateOnly));
  const endDate = instance.end instanceof Date
    ? dateParts(instance.end, Boolean(instance.isFullDay || instance.end.dateOnly))
    : start;
  const isAllDay = !start.time;
  return {
    id: `${event.uid || event.summary || "google-event"}-${instance.start.toISOString()}`,
    title: String(instance.summary || event.summary || "Evento do Google Agenda").slice(0, 200),
    description: String(instance.description || event.description || "").slice(0, 4000),
    location: String(instance.location || event.location || "").slice(0, 500),
    start_date: start.date,
    end_date_exclusive: isAllDay
      ? endDate.date > start.date ? endDate.date : addDays(start.date, 1)
      : endDate.time === "00:00" && endDate.date > start.date ? endDate.date : addDays(endDate.date, 1),
    start_time: isAllDay ? null : start.time,
    end_time: isAllDay ? null : endDate.time,
    all_day: isAllDay,
  };
}

function overlapsRange(event, from, until) {
  return event.start_date <= until && event.end_date_exclusive > from;
}

export function parseGoogleCalendarEvents(calendar, from, until, exclusions = new Map()) {
  if (!validDate(from) || !validDate(until) || from > until) {
    throw new Error("O período solicitado para o Google Agenda é inválido.");
  }
  if ((new Date(`${until}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new Error("O período solicitado para o Google Agenda é muito longo.");
  }
  const rangeStart = new Date(`${addDays(from, -1)}T00:00:00Z`);
  const rangeEnd = new Date(`${addDays(until, 2)}T00:00:00Z`);
  const events = [];
  for (const event of Object.values(calendar)) {
    if (event.type !== "VEVENT" || event.status === "CANCELLED" || event.recurrenceid) continue;
    const excludedDates = exclusions.get(event.uid);
    const instances = event.rrule
      ? event.rrule.between(rangeStart, rangeEnd, true)
        .filter((date) => !excludedDates?.has(date.toISOString()) && !excludedDates?.has(date.toISOString().slice(0, 10)))
        .map((recurrenceStart) => {
        const recurrenceKey = recurrenceStart.toISOString().slice(0, 10);
        const override = event.recurrences?.[recurrenceKey];
        if (override) return override.status === "CANCELLED" ? null : override;
        const start = event.start?.tz ? dateFromWallTime(recurrenceStart, event.start.tz) : recurrenceStart;
        if (event.start?.tz) start.tz = event.start.tz;
        const duration = event.end instanceof Date && event.start instanceof Date
          ? event.end.getTime() - event.start.getTime()
          : 0;
        return {
          ...event,
          start,
          end: new Date(start.getTime() + duration),
          isFullDay: Boolean(event.start?.dateOnly),
          recurrenceKey: recurrenceStart.toISOString(),
        };
      })
      : [event];
    for (const instance of instances) {
      if (!instance) continue;
      const item = eventItem(event, instance);
      if (item && overlapsRange(item, from, until)) events.push(item);
    }
  }
  return events.sort((a, b) => a.start_date.localeCompare(b.start_date)
    || String(a.start_time || "").localeCompare(String(b.start_time || ""))
    || a.title.localeCompare(b.title, "pt-BR"));
}

function parseExclusions(content) {
  const exclusions = new Map();
  const lines = content.replace(/\r?\n[ \t]/g, "").split(/\r?\n/);
  let uid = "";
  let inEvent = false;
  for (const line of lines) {
    if (line === "BEGIN:VEVENT") {
      inEvent = true;
      uid = "";
      continue;
    }
    if (line === "END:VEVENT") {
      inEvent = false;
      uid = "";
      continue;
    }
    if (!inEvent) continue;
    const uidMatch = line.match(/^UID:(.+)$/i);
    if (uidMatch) {
      uid = uidMatch[1].trim();
      continue;
    }
    const exdateMatch = line.match(/^EXDATE(?:;[^:]*)?:(.+)$/i);
    if (!uid || !exdateMatch) continue;
    if (!exclusions.has(uid)) exclusions.set(uid, new Set());
    for (const value of exdateMatch[1].split(",")) {
      const match = value.trim().match(/^(\d{4})(\d{2})(\d{2})(?:T(\d{2})(\d{2})(\d{2})Z?)?$/);
      if (!match) continue;
      const day = `${match[1]}-${match[2]}-${match[3]}`;
      const time = match[4] ? `T${match[4]}:${match[5]}:${match[6]}.000Z` : "";
      exclusions.get(uid).add(time ? `${day}${time}` : day);
    }
  }
  return exclusions;
}

export async function parseGoogleCalendarFeed(content, from, until) {
  const calendar = await ical.async.parseICS(content);
  return parseGoogleCalendarEvents(calendar, from, until, parseExclusions(content));
}

async function fetchCalendar(url) {
  const response = await fetch(url, {
    headers: { Accept: "text/calendar" },
    redirect: "error",
    signal: AbortSignal.timeout(10_000),
  });
  if (!response.ok) throw new Error("O Google Agenda não retornou o feed iCal.");
  const contentLength = Number(response.headers.get("content-length"));
  if (Number.isFinite(contentLength) && contentLength > MAX_FEED_SIZE) {
    throw new Error("O feed do Google Agenda excede o tamanho permitido.");
  }
  const chunks = [];
  let totalSize = 0;
  const reader = response.body.getReader();
  while (true) {
    const { done, value } = await reader.read();
    if (done) break;
    totalSize += value.byteLength;
    if (totalSize > MAX_FEED_SIZE) {
      await reader.cancel();
      throw new Error("O feed do Google Agenda excede o tamanho permitido.");
    }
    chunks.push(value);
  }
  const content = Buffer.concat(chunks).toString("utf8");
  return {
    calendar: await ical.async.parseICS(content),
    exclusions: parseExclusions(content),
  };
}

async function getCalendar(url) {
  const cacheKey = url.href;
  const cached = cachedCalendars.get(cacheKey);
  if (cached?.expiresAt > Date.now()) return cached.data;
  let pending = pendingCalendars.get(cacheKey);
  if (!pending) {
    pending = fetchCalendar(url)
      .then((data) => {
        cachedCalendars.set(cacheKey, { data, expiresAt: Date.now() + CACHE_DURATION });
        return data;
      })
      .finally(() => {
        if (pendingCalendars.get(cacheKey) === pending) pendingCalendars.delete(cacheKey);
      });
    pendingCalendars.set(cacheKey, pending);
  }
  return pending;
}

export async function getGoogleCalendarEvents({ from, until, feedUrl = process.env.GOOGLE_CALENDAR_ICAL_URL } = {}) {
  if (!feedUrl) return { configured: false, events: [] };
  if (!validDate(from) || !validDate(until) || from > until) {
    throw new Error("O período solicitado para o Google Agenda é inválido.");
  }
  if ((new Date(`${until}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000 > MAX_RANGE_DAYS) {
    throw new Error("O período solicitado para o Google Agenda é muito longo.");
  }
  const url = calendarUrl(feedUrl);
  const { calendar, exclusions } = await getCalendar(url);
  return { configured: true, events: parseGoogleCalendarEvents(calendar, from, until, exclusions) };
}

export async function getSubidoProCalendarEvents({ from, until } = {}) {
  const feedUrl = process.env.SUBIDO_PRO_CALENDAR_ICAL_URL?.trim() || SUBIDO_PRO_CALENDAR_ICAL_URL;
  return getGoogleCalendarEvents({ from, until, feedUrl });
}
