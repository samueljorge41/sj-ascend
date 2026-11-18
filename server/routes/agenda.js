import express from "express";
import fs from "node:fs/promises";
import path from "node:path";
import { randomUUID } from "node:crypto";
import db from "../database/db.js";
import { databasePath } from "../config/paths.js";
import { getGoogleCalendarEvents, getSubidoProCalendarEvents } from "../googleCalendar.js";
import {
  beginGoogleCalendarAuthorization,
  completeGoogleCalendarAuthorization,
  ensureGoogleCalendarWatch,
  getGoogleCalendarApiEvents,
  getGoogleCalendarConnection,
  getGoogleCalendarLinkedSources,
  handleGoogleCalendarNotification,
  removeGoogleCalendarEvent,
  updateGoogleCalendarEvent,
  updateGoogleCalendarEventColor,
} from "../googleCalendarSync.js";
import { requireWhatsAppAuth } from "../whatsapp/base44Auth.js";

const router = express.Router();
const planningDraftPath = path.join(path.dirname(databasePath), "agenda-planning-draft.json");
const ITEM_TYPES = new Set(["appointment", "task"]);
const AREAS = new Set(["personal", "professional"]);
const PRIORITIES = new Set(["low", "normal", "high"]);
const STATUSES = {
  appointment: new Set(["scheduled", "cancelled"]),
  task: new Set(["pending", "in_progress", "completed", "not_done"]),
};

function validId(value) {
  const parsed = Number(value);
  return Number.isInteger(parsed) && parsed > 0 ? parsed : null;
}

function normalizeDate(value, label) {
  if (value == null || value === "") return null;
  const normalized = String(value).trim();
  if (!/^\d{4}-\d{2}-\d{2}$/.test(normalized)) throw new Error(`${label} deve estar no formato YYYY-MM-DD.`);
  const parsed = new Date(`${normalized}T00:00:00Z`);
  if (Number.isNaN(parsed.getTime()) || parsed.toISOString().slice(0, 10) !== normalized) throw new Error(`${label} inválida.`);
  return normalized;
}

function optionalText(value, label, maxLength) {
  const normalized = String(value || "").trim();
  if (normalized.length > maxLength) throw new Error(`${label} deve ter no máximo ${maxLength} caracteres.`);
  return normalized;
}

function normalizeItem(input, existing = {}) {
  const merged = { ...existing, ...input };
  const itemType = String(merged.item_type || "").trim();
  const area = String(merged.area || "").trim();
  const title = optionalText(merged.title, "O título", 200);
  if (!title) throw new Error("Informe o título.");
  if (!ITEM_TYPES.has(itemType)) throw new Error("Tipo de item inválido.");
  if (!AREAS.has(area)) throw new Error("Selecione uma área válida.");

  const plannedDate = normalizeDate(merged.planned_date, "A data agendada");
  const dueDate = normalizeDate(merged.due_date, "O prazo final");
  const startTime = String(merged.start_time || "").trim() || null;
  const endTime = String(merged.end_time || "").trim() || null;
  const category = optionalText(merged.category, "A categoria", 80);
  const description = optionalText(merged.description, "A descrição", 4000);
  const observations = optionalText(merged.observations, "As observações", 4000);
  const priority = String(merged.priority || "normal").trim();
  const status = String(merged.status || (itemType === "appointment" ? "scheduled" : "pending")).trim();
  if (!PRIORITIES.has(priority)) throw new Error("Prioridade inválida.");
  if (!STATUSES[itemType].has(status)) throw new Error("Status inválido para este tipo de item.");

  if (itemType === "appointment") {
    if (!plannedDate) throw new Error("Compromissos precisam de uma data.");
    if (!startTime || !endTime) throw new Error("Informe os horários de início e término.");
  }
  if (itemType === "task" && !plannedDate && !dueDate) throw new Error("Informe uma data agendada ou um prazo final.");
  if ((startTime && !endTime) || (!startTime && endTime)) throw new Error("Informe os horários de início e término.");
  if (startTime && (!/^([01]\d|2[0-3]):[0-5]\d$/.test(startTime) || !/^([01]\d|2[0-3]):[0-5]\d$/.test(endTime))) throw new Error("Informe horários válidos no formato HH:MM.");
  if (startTime && endTime <= startTime) throw new Error("O término deve ser depois do início.");
  if (startTime && !plannedDate) throw new Error("Para reservar um horário, informe a data agendada.");
  if (plannedDate && dueDate && dueDate < plannedDate) throw new Error("O prazo final não pode ser anterior à data agendada.");

  let clientId = null;
  if (merged.client_id != null && merged.client_id !== "") {
    clientId = validId(merged.client_id);
    if (!clientId) throw new Error("Cliente inválido.");
    if (!db.prepare("SELECT id FROM clients WHERE id = ?").get(clientId)) throw new Error("Cliente não encontrado.");
  }
  if (itemType === "task" && clientId) throw new Error("Vínculos de tarefas com clientes continuam sendo gerenciados pela Gestão de Clientes.");

  return {
    item_type: itemType,
    title,
    description,
    area,
    category,
    planned_date: plannedDate,
    due_date: dueDate,
    start_time: startTime,
    end_time: endTime,
    priority,
    status,
    observations,
    client_id: clientId,
  };
}

const selectItem = db.prepare(`
  SELECT id, item_type, title, description, area, category, planned_date, due_date,
    start_time, end_time, priority, status, observations, client_id, recurrence_rule,
    created_at, updated_at
  FROM agenda_items WHERE id = ?
`);

function validatePlanningDraft(items) {
  if (!Array.isArray(items) || items.length > 500) {
    throw new Error("O rascunho deve conter uma lista de até 500 linhas.");
  }
  const seenIds = new Set();
  for (const item of items) {
    if (!item || typeof item.id !== "string" || !item.id.trim() || item.id.length > 100
      || typeof item.text !== "string" || item.text.length > 200 || seenIds.has(item.id)) {
      throw new Error("Uma ou mais linhas do rascunho são inválidas.");
    }
    seenIds.add(item.id);
  }
  return items.map(({ id, text }) => ({ id, text }));
}

router.get("/colors", (req, res) => {
  const colors = db.prepare(`
    SELECT source_type AS sourceType, source_id AS sourceId, color_id AS colorId
    FROM agenda_event_color_overrides
  `).all();
  return res.json({ colors });
});

router.patch("/colors", requireWhatsAppAuth, async (req, res) => {
  const sourceType = String(req.body?.source_type || "").trim();
  const sourceId = String(req.body?.source_id || "").trim();
  const colorId = req.body?.color_id == null || req.body.color_id === ""
    ? null
    : String(req.body.color_id);
  const googleEventId = String(req.body?.google_event_id || "").trim();
  const allowedSources = new Set(["agenda", "client_demand", "prospect", "google_calendar"]);
  if (!allowedSources.has(sourceType) || !sourceId) {
    return res.status(400).json({ error: "Informe um evento válido para alterar a cor." });
  }
  if (colorId != null && !/^(?:[1-9]|1[01])$/.test(colorId)) {
    return res.status(400).json({ error: "Selecione uma cor válida da agenda." });
  }

  if (sourceType === "google_calendar") {
    if (googleEventId && googleEventId !== sourceId) {
      return res.status(400).json({ error: "O evento Google informado não corresponde ao evento selecionado." });
    }
  } else {
    const tables = {
      agenda: "agenda_items",
      client_demand: "client_demands",
      prospect: "prospects",
    };
    if (!db.prepare(`SELECT id FROM ${tables[sourceType]} WHERE id = ?`).get(Number(sourceId))) {
      return res.status(404).json({ error: "O item de origem não foi encontrado." });
    }
    if (googleEventId) {
      const link = db.prepare(`
        SELECT id FROM google_calendar_event_links
        WHERE source_type = ? AND source_id = ? AND google_event_id = ? AND archived_at IS NULL
      `).get(sourceType, Number(sourceId), googleEventId);
      if (!link) return res.status(400).json({ error: "O vínculo com o evento Google não é válido." });
    }
  }

  try {
    const eventId = sourceType === "google_calendar" ? sourceId : googleEventId;
    if (eventId) await updateGoogleCalendarEventColor(eventId, colorId);

    if (sourceType !== "google_calendar") {
      if (colorId == null) {
        db.prepare(`
          DELETE FROM agenda_event_color_overrides
          WHERE source_type = ? AND source_id = ?
        `).run(sourceType, sourceId);
      } else {
        db.prepare(`
          INSERT INTO agenda_event_color_overrides (source_type, source_id, color_id)
          VALUES (?, ?, ?)
          ON CONFLICT(source_type, source_id) DO UPDATE SET
            color_id = excluded.color_id, updated_at = CURRENT_TIMESTAMP
        `).run(sourceType, sourceId, colorId);
      }
    }
    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao atualizar a cor da Agenda:", error.message);
    return res.status(error.status ? 502 : 400)
      .json({ error: `Não foi possível atualizar a cor: ${error.message}` });
  }
});

function googleCalendarReturnUrl() {
  const value = process.env.GOOGLE_CALENDAR_RETURN_URL?.trim()
    || (process.env.BASE44_APP_BASE_URL ? `${process.env.BASE44_APP_BASE_URL.replace(/\/$/, "")}/agenda` : "");
  if (!value) return null;
  try {
    const url = new URL(value);
    return ["https:", "http:"].includes(url.protocol) ? url : null;
  } catch {
    return null;
  }
}

router.get("/google-events", requireWhatsAppAuth, async (req, res) => {
  let from;
  let until;
  try {
    from = req.query.from ? normalizeDate(req.query.from, "A data inicial") : null;
    until = req.query.until ? normalizeDate(req.query.until, "A data final") : null;
  } catch {
    return res.status(400).json({ error: "Informe datas válidas para carregar o Google Agenda." });
  }
  if (!from || !until || from > until) return res.status(400).json({ error: "Informe um período válido para carregar o Google Agenda." });
  if ((new Date(`${until}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000 > 90) {
    return res.status(400).json({ error: "O período solicitado para o Google Agenda deve ter no máximo 90 dias." });
  }
  try {
    const connection = getGoogleCalendarConnection();
    const events = connection.connected
      ? await getGoogleCalendarApiEvents({ from, until })
      : (await getGoogleCalendarEvents({ from, until })).events;
    res.set("Cache-Control", "private, no-store");
    return res.json({
      configured: connection.connected || connection.configured || Boolean(process.env.GOOGLE_CALENDAR_ICAL_URL),
      connected: connection.connected,
      linkedSources: getGoogleCalendarLinkedSources(),
      events,
    });
  } catch (error) {
    console.error("Erro ao carregar eventos do Google Agenda:", error.message);
    return res.status(502).json({ error: `Sincronização do Google Agenda: ${error.message}` });
  }
});

router.get("/subido-pro-events", requireWhatsAppAuth, async (req, res) => {
  let from;
  let until;
  try {
    from = req.query.from ? normalizeDate(req.query.from, "A data inicial") : null;
    until = req.query.until ? normalizeDate(req.query.until, "A data final") : null;
  } catch {
    return res.status(400).json({ error: "Informe datas válidas para carregar a agenda Subido PRO." });
  }
  if (!from || !until || from > until) return res.status(400).json({ error: "Informe um período válido para carregar a agenda Subido PRO." });
  if ((new Date(`${until}T00:00:00Z`) - new Date(`${from}T00:00:00Z`)) / 86_400_000 > 90) {
    return res.status(400).json({ error: "O período solicitado para a agenda Subido PRO deve ter no máximo 90 dias." });
  }
  try {
    const result = await getSubidoProCalendarEvents({ from, until });
    res.set("Cache-Control", "private, no-store");
    return res.json({ configured: result.configured, events: result.events });
  } catch (error) {
    console.error("Erro ao carregar a agenda Subido PRO:", error.message);
    return res.status(502).json({ error: `Agenda Subido PRO: ${error.message}` });
  }
});

router.patch("/google-events/:id", requireWhatsAppAuth, async (req, res) => {
  try {
    const event = await updateGoogleCalendarEvent(req.params.id, req.body || {});
    res.set("Cache-Control", "private, no-store");
    return res.json({ event });
  } catch (error) {
    console.error("Erro ao atualizar evento do Google Agenda:", error.message);
    return res.status(error.status === 400 ? 400 : error.status ? 502 : 400)
      .json({ error: `Não foi possível atualizar o evento Google: ${error.message}` });
  }
});

router.delete("/google-events/:id", requireWhatsAppAuth, async (req, res) => {
  try {
    await removeGoogleCalendarEvent(req.params.id);
    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao excluir evento do Google Agenda:", error.message);
    return res.status(error.status ? 502 : 400)
      .json({ error: `Não foi possível excluir o evento Google: ${error.message}` });
  }
});

router.get("/google-auth/status", requireWhatsAppAuth, (req, res) => {
  try {
    res.set("Cache-Control", "private, no-store");
    return res.json(getGoogleCalendarConnection());
  } catch (error) {
    console.error("Erro ao verificar a conexão do Google Agenda:", error.message);
    return res.status(503).json({ error: "Não foi possível verificar a conexão do Google Agenda." });
  }
});

router.post("/google-auth/connect", requireWhatsAppAuth, (req, res) => {
  try {
    return res.json({ authorizationUrl: beginGoogleCalendarAuthorization() });
  } catch (error) {
    return res.status(503).json({ error: error.message });
  }
});

router.post("/google-auth/watch", requireWhatsAppAuth, async (req, res) => {
  try {
    const active = await ensureGoogleCalendarWatch(true);
    if (!active) return res.status(409).json({ error: "Conecte uma conta Google antes de ativar as notificações." });
    return res.json({ active: true });
  } catch (error) {
    console.error("Erro ao ativar notificações do Google Agenda:", error.message);
    return res.status(502).json({ error: "Não foi possível ativar as notificações em tempo real do Google Agenda." });
  }
});

router.get("/google-auth/callback", async (req, res) => {
  try {
    if (req.query.error) throw new Error("A autorização do Google foi cancelada.");
    if (typeof req.query.code !== "string" || typeof req.query.state !== "string") {
      throw new Error("A resposta de autorização do Google está incompleta.");
    }
    await completeGoogleCalendarAuthorization({ code: req.query.code, state: req.query.state });
    const redirect = googleCalendarReturnUrl();
    if (!redirect) return res.status(200).send("Google Agenda conectada. Você já pode fechar esta janela.");
    redirect.searchParams.set("google_calendar", "connected");
    return res.redirect(303, redirect.toString());
  } catch (error) {
    console.error("Erro no retorno de autorização do Google Agenda:", error.message);
    const redirect = googleCalendarReturnUrl();
    if (!redirect) return res.status(400).send("Não foi possível concluir a conexão do Google Agenda. Volte à Agenda e tente novamente.");
    redirect.searchParams.set("google_calendar", "error");
    redirect.searchParams.set("google_calendar_message", error.message || "Não foi possível concluir a autorização.");
    return res.redirect(303, redirect.toString());
  }
});

router.post("/google-webhook", (req, res) => {
  if (!handleGoogleCalendarNotification(req.headers)) {
    return res.status(404).end();
  }
  return res.status(204).end();
});

router.get("/items", (req, res) => {
  try {
    const from = req.query.from ? normalizeDate(req.query.from, "A data inicial") : null;
    const until = req.query.until ? normalizeDate(req.query.until, "A data final") : null;
    if (from && until && from > until) return res.status(400).json({ error: "O período informado é inválido." });
    const clauses = [];
    const params = [];
    if (from || until) {
      const period = [];
      if (from) { period.push("COALESCE(planned_date, due_date) >= ?"); params.push(from); }
      if (until) { period.push("COALESCE(planned_date, due_date) <= ?"); params.push(until); }
      clauses.push(`(${period.join(" AND ")})`);
      if (from) {
        clauses.push("(item_type = 'task' AND COALESCE(planned_date, due_date) < ? AND status IN ('pending', 'in_progress'))");
        params.push(from);
      }
    }
    const items = db.prepare(`
      SELECT id, item_type, title, description, area, category, planned_date, due_date,
        start_time, end_time, priority, status, observations, client_id, recurrence_rule,
        created_at, updated_at
      FROM agenda_items ${clauses.length ? `WHERE ${clauses.join(" OR ")}` : ""}
      ORDER BY COALESCE(planned_date, due_date), start_time, id
    `).all(...params);
    res.json({ items });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível carregar a agenda." });
  }
});

router.get("/planning-draft", requireWhatsAppAuth, async (req, res) => {
  try {
    let items = [];
    try {
      const contents = await fs.readFile(planningDraftPath, "utf8");
      const saved = JSON.parse(contents);
      items = validatePlanningDraft(saved);
    } catch (error) {
      if (error.code !== "ENOENT") throw error;
    }
    res.set("Cache-Control", "private, no-store");
    return res.json({ items });
  } catch (error) {
    console.error("Erro ao carregar o rascunho da Agenda:", error.message);
    return res.status(500).json({ error: "Não foi possível carregar o rascunho salvo no servidor." });
  }
});

router.put("/planning-draft", requireWhatsAppAuth, async (req, res) => {
  let items;
  try {
    items = validatePlanningDraft(req.body?.items);
  } catch (error) {
    return res.status(400).json({ error: error.message });
  }
  try {
    await fs.mkdir(path.dirname(planningDraftPath), { recursive: true });
    const temporaryPath = `${planningDraftPath}.${randomUUID()}.tmp`;
    try {
      await fs.writeFile(temporaryPath, `${JSON.stringify(items)}\n`, { encoding: "utf8", flag: "wx" });
      await fs.rename(temporaryPath, planningDraftPath);
    } catch (error) {
      await fs.rm(temporaryPath, { force: true });
      throw error;
    }
    res.set("Cache-Control", "private, no-store");
    return res.json({ success: true });
  } catch (error) {
    console.error("Erro ao salvar o rascunho da Agenda:", error.message);
    return res.status(500).json({ error: "Não foi possível salvar o rascunho em arquivo local." });
  }
});

router.post("/items", (req, res) => {
  try {
    const item = normalizeItem(req.body || {});
    const result = db.prepare(`
      INSERT INTO agenda_items (
        item_type, title, description, area, category, planned_date, due_date,
        start_time, end_time, priority, status, observations, client_id
      ) VALUES (
        @item_type, @title, @description, @area, @category, @planned_date, @due_date,
        @start_time, @end_time, @priority, @status, @observations, @client_id
      )
    `).run(item);
    res.status(201).json({ item: selectItem.get(result.lastInsertRowid) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível criar o item." });
  }
});

router.patch("/items/:id", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID do item inválido." });
  const existing = selectItem.get(id);
  if (!existing) return res.status(404).json({ error: "Item não encontrado." });
  try {
    // Weekly drag-and-drop changes only the scheduled date, preserving any separate deadline and times.
    if (Object.keys(req.body || {}).length === 1 && Object.hasOwn(req.body, "planned_date")) {
      const plannedDate = normalizeDate(req.body.planned_date, "A data agendada");
      if (!plannedDate) throw new Error("Informe uma data agendada.");
      if (existing.item_type === "task" && existing.due_date && existing.due_date < plannedDate) {
        throw new Error("A data agendada não pode ultrapassar o prazo final.");
      }
      db.prepare("UPDATE agenda_items SET planned_date = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?")
        .run(plannedDate, id);
      return res.json({ item: selectItem.get(id) });
    }
    const item = normalizeItem(req.body || {}, existing);
    db.prepare(`
      UPDATE agenda_items SET
        item_type = @item_type, title = @title, description = @description, area = @area,
        category = @category, planned_date = @planned_date, due_date = @due_date,
        start_time = @start_time, end_time = @end_time, priority = @priority,
        status = @status, observations = @observations, client_id = @client_id,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = @id
    `).run({ ...item, id });
    res.json({ item: selectItem.get(id) });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível atualizar o item." });
  }
});

router.delete("/items/:id", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID do item inválido." });
  const result = db.prepare("DELETE FROM agenda_items WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Item não encontrado." });
  db.prepare("DELETE FROM agenda_event_color_overrides WHERE source_type = 'agenda' AND source_id = ?").run(String(id));
  res.json({ success: true });
});

export default router;
