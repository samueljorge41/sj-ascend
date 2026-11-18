const API = "/api/automations";

async function request(path, options) {
  const response = await fetch(`${API}${path}`, options);
  const data = await response.json().catch(() => ({}));
  if (!response.ok) throw new Error(data.error || "Não foi possível salvar as automações.");
  return data;
}

const jsonOptions = (method, body) => ({
  method,
  headers: { "Content-Type": "application/json" },
  body: JSON.stringify(body),
});

export const getAutomationScripts = () => request("/scripts").then((data) => data.scripts || []);
export const getAutomationRules = () => request("/rules").then((data) => data.rules || []);

export function saveAutomationScript(script) {
  const { id, ...body } = script;
  return request(id ? `/scripts/${id}` : "/scripts", jsonOptions(id ? "PATCH" : "POST", body))
    .then((data) => data.script);
}

export const deleteAutomationScript = (id) => request(`/scripts/${id}`, { method: "DELETE" });

export function saveAutomationRule(rule) {
  return request("/rules", jsonOptions("PATCH", rule)).then((data) => data.rule);
}
