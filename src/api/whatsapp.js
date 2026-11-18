import { appParams } from "@/lib/app-params";

const API = "/api/whatsapp";

export function getWhatsAppCredentials() {
  const token = typeof window === "undefined"
    ? appParams.token
    : window.localStorage.getItem("base44_access_token")
      || window.localStorage.getItem("token")
      || appParams.token;
  return { token, appId: appParams.appId };
}

async function request(path, options = {}) {
  const { token, appId } = getWhatsAppCredentials();
  const response = await fetch(`${API}${path}`, {
    ...options,
    headers: {
      Authorization: token ? `Bearer ${token}` : "",
      "X-App-Id": appId || "",
      ...(options.body ? { "Content-Type": "application/json" } : {}),
      ...options.headers,
    },
  });
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível conectar ao WhatsApp.");
  return data;
}

export const getWhatsAppStatus = () => request("/status").then((data) => data.status);
export const connectWhatsApp = () => request("/connect", { method: "POST" }).then((data) => data.status);
export const reconnectWhatsApp = () => request("/reconnect", { method: "POST" }).then((data) => data.status);
export const logoutWhatsApp = () => request("/logout", { method: "POST" }).then((data) => data.status);

export function getWhatsAppChats(search = "") {
  const query = new URLSearchParams();
  if (search) query.set("search", search);
  return request(`/chats${query.size ? `?${query}` : ""}`).then((data) => data.chats || []);
}

export function getWhatsAppMessages(jid, offset = 0) {
  const query = new URLSearchParams({ offset: String(offset) });
  return request(`/chats/${encodeURIComponent(jid)}/messages?${query}`).then((data) => ({
    jid: data.jid || jid,
    messages: data.messages || [],
  }));
}

export function sendWhatsAppMessage(jid, text, requestId = window.crypto.randomUUID()) {
  return request(`/chats/${encodeURIComponent(jid)}/messages`, {
    method: "POST",
    body: JSON.stringify({ text, requestId }),
  }).then((data) => data.message);
}

export function markWhatsAppChatRead(jid) {
  return request(`/chats/${encodeURIComponent(jid)}/read`, { method: "POST" });
}
