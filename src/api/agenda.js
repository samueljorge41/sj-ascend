import { getWhatsAppCredentials } from "@/api/whatsapp";

const API = "/api/agenda/items";
const GOOGLE_API = "/api/agenda/google-events";
const SUBIDO_PRO_API = "/api/agenda/subido-pro-events";
const GOOGLE_AUTH_API = "/api/agenda/google-auth";
const PLANNING_DRAFT_API = "/api/agenda/planning-draft";

async function request(url, options, { allowCreatedResponseWithoutJson = false } = {}) {
  const response = await fetch(url, options);
  let data;
  try {
    const body = await response.text();
    data = allowCreatedResponseWithoutJson && response.status === 201 && !body.trim()
      ? {}
      : JSON.parse(body);
  } catch {
    if (allowCreatedResponseWithoutJson && response.status === 201) {
      data = {};
    } else {
      const contentType = response.headers.get("content-type");
      throw new Error(`O servidor retornou uma resposta inválida (HTTP ${response.status}${contentType ? `, ${contentType}` : ""}). Atualize a agenda e tente novamente.`);
    }
  }
  if (!response.ok) throw new Error(data?.error || "Não foi possível salvar os dados da agenda.");
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function getAgendaItems({ from, until } = {}) {
  const search = new URLSearchParams();
  if (from) search.set("from", from);
  if (until) search.set("until", until);
  const suffix = search.size ? `?${search}` : "";
  const data = await request(`${API}${suffix}`);
  return data.items || [];
}

function planningDraftHeaders() {
  const { token, appId } = getWhatsAppCredentials();
  return {
    Authorization: token ? `Bearer ${token}` : "",
    "X-App-Id": appId || "",
  };
}

export async function getAgendaPlanningDraft() {
  const data = await request(PLANNING_DRAFT_API, {
    headers: planningDraftHeaders(),
  });
  return data.items || [];
}

export async function saveAgendaPlanningDraft(items) {
  return request(PLANNING_DRAFT_API, {
    ...jsonOptions("PUT", { items }),
    headers: { ...planningDraftHeaders(), "Content-Type": "application/json" },
  });
}

export async function getAgendaItemColors() {
  const data = await request("/api/agenda/colors");
  return data.colors || [];
}

export async function updateAgendaItemColor({ sourceType, sourceId, googleEventId, colorId }) {
  const { token, appId } = getWhatsAppCredentials();
  const options = jsonOptions("PATCH", {
    source_type: sourceType,
    source_id: sourceId,
    google_event_id: googleEventId || "",
    color_id: colorId,
  });
  options.headers.Authorization = token ? `Bearer ${token}` : "";
  options.headers["X-App-Id"] = appId || "";
  return request("/api/agenda/colors", options);
}

export async function getGoogleCalendarEvents({ from, until }) {
  const search = new URLSearchParams({ from, until });
  const { token, appId } = getWhatsAppCredentials();
  const data = await request(`${GOOGLE_API}?${search}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "X-App-Id": appId || "",
    },
  });
  return data;
}

export async function getSubidoProCalendarEvents({ from, until }) {
  const search = new URLSearchParams({ from, until });
  const { token, appId } = getWhatsAppCredentials();
  return request(`${SUBIDO_PRO_API}?${search}`, {
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "X-App-Id": appId || "",
    },
  });
}

export async function updateGoogleCalendarEvent(id, event) {
  const { token, appId } = getWhatsAppCredentials();
  const options = jsonOptions("PATCH", event);
  options.headers.Authorization = token ? `Bearer ${token}` : "";
  options.headers["X-App-Id"] = appId || "";
  const data = await request(`${GOOGLE_API}/${encodeURIComponent(id)}`, options);
  return data.event;
}

export async function deleteGoogleCalendarEvent(id) {
  const { token, appId } = getWhatsAppCredentials();
  return request(`${GOOGLE_API}/${encodeURIComponent(id)}`, {
    method: "DELETE",
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "X-App-Id": appId || "",
    },
  });
}

export function getGoogleCalendarConnection() {
  return request(`${GOOGLE_AUTH_API}/status`);
}

export function connectGoogleCalendar() {
  return request(`${GOOGLE_AUTH_API}/connect`, jsonOptions("POST", {}));
}

export function renewGoogleCalendarWatch() {
  return request(`${GOOGLE_AUTH_API}/watch`, jsonOptions("POST", {}));
}

export async function createAgendaItem(item) {
  const data = await request(API, jsonOptions("POST", item), { allowCreatedResponseWithoutJson: true });
  return data.item;
}

export async function updateAgendaItem(id, patch) {
  const data = await request(`${API}/${id}`, jsonOptions("PATCH", patch));
  return data.item;
}

export async function deleteAgendaItem(id) {
  return request(`${API}/${id}`, { method: "DELETE" });
}
