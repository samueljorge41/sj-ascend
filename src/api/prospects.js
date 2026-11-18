const API = "/api/prospects";

async function request(url, options) {
  const response = await fetch(url, options);
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Erro na requisição.");
  return data;
}

function jsonOptions(method, body) {
  return {
    method,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(body),
  };
}

export async function getProspects() {
  const data = await request(API);
  return data.prospects || [];
}

export async function getAcquisitionLeadList() {
  const data = await request(`${API}/list`);
  return data.leads || [];
}

export async function createAcquisitionLead(lead) {
  const data = await request(`${API}/list`, jsonOptions("POST", lead));
  return data.lead;
}

export async function updateAcquisitionLead(id, patch) {
  const data = await request(`${API}/list/${id}`, jsonOptions("PATCH", patch));
  return data.lead;
}

export async function getProspectStages() {
  const data = await request(`${API}/stages`);
  return data.stages || [];
}

export async function getProspectSources() {
  const data = await request(`${API}/sources`);
  return data.sources || [];
}

export async function getProspectAnalytics() {
  const [prospects, analytics] = await Promise.all([
    getProspects(),
    request(`${API}/analytics`),
  ]);
  return { ...analytics, prospects };
}

export async function createProspectSource(name) {
  const data = await request(`${API}/sources`, jsonOptions("POST", { name }));
  return data.source;
}

export async function createProspect(prospect) {
  const data = await request(API, jsonOptions("POST", prospect));
  return data.prospect;
}

export async function updateProspect(id, patch) {
  const data = await request(`${API}/${id}`, jsonOptions("PATCH", patch));
  return data.prospect;
}

export async function deleteProspect(id) {
  return request(`${API}/${id}`, { method: "DELETE" });
}

export async function getProspectInteractions(id) {
  const data = await request(`${API}/${id}/interactions`);
  return data.interactions || [];
}

export async function getProspectHistory(id) {
  const data = await request(`${API}/${id}/history`);
  return data.stages || [];
}

export async function updateProspectStageDate(prospectId, historyId, enteredAt, isEstimated = false) {
  const data = await request(`${API}/${prospectId}/history/${historyId}`, jsonOptions("PATCH", { entered_at: enteredAt, is_estimated: isEstimated }));
  return data.stage;
}

export async function completeProspectAction(id, whatsapp = null) {
  return request(`${API}/${id}/complete-action`, whatsapp
    ? jsonOptions("POST", { whatsapp })
    : { method: "POST" });
}

export async function completeProspectActionManually(id) {
  return request(`${API}/${id}/complete-action`, jsonOptions("POST", { manual: true }));
}

export async function addProspectInteraction(id, interaction) {
  const data = await request(`${API}/${id}/interactions`, jsonOptions("POST", interaction));
  return data.interaction;
}

export async function convertProspect(id, client, stageId) {
  return request(`${API}/${id}/convert`, jsonOptions("POST", { client, stage_id: stageId }));
}
