import express from "express";
import db from "../database/db.js";
import { removeGoogleMapsLinks } from "../acquisitionNotes.js";

const router = express.Router();
const leadListFields = ["company_name", "company_instagram", "phone", "contact_name", "contact_phone", "website", "segment", "city", "source", "notes"];
const prospectFields = [
  "company_name", "segment", "city", "company_instagram", "website", "phone",
  "contact_name", "contact_role", "contact_phone", "contact_instagram", "notes",
  "stage_id", "source", "owner", "potential_value", "offer", "first_contact_at",
  "last_contact_at", "next_action", "next_action_date", "next_action_start_time",
  "next_action_end_time", "loss_reason",
];

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";
const STAGE_ACTIONS = {
  new: { action: "Entrar em contato", date: "today" },
  contacted: { action: "Follow-up", date: "tomorrow" },
  responded: { action: "Confirmar reunião", date: "today" },
  triage_scheduled: { action: "Realizar reunião", date: "meeting" },
  proposal_scheduled: { action: "Enviar proposta", date: "meeting" },
  proposal_sent: { action: "Follow-up da proposta", date: "tomorrow" },
  negotiation: { action: "Follow-up da proposta", date: "preserve-or-tomorrow" },
  future_interest: { action: "Follow-up", date: "provided" },
  closed: { action: "", date: "" },
  lost: { action: "", date: "" },
};
const COMPLETABLE_ACTIONS = new Set([
  "Entrar em contato",
  "Follow-up",
  "Confirmar reunião",
  "Enviar proposta",
  "Follow-up da proposta",
]);

const CLIENT_ORIGINS = new Set(["Avaloon", "SJ Marketing"]);
const CLIENT_PAYMENT_METHODS = new Set(["auto", "prepaid", "credit_card", "other", "unknown"]);
const ACTIVE_PROSPECT_SOURCE = "Prospecção Ativa";

function isUrlSource(value) {
  return /^(https?:\/\/|www\.)/i.test(String(value || "").trim());
}

router.get("/list", (req, res) => {
  const leads = db.prepare("SELECT * FROM acquisition_lead_list ORDER BY updated_at DESC, id DESC").all();
  res.json({ leads });
});

router.post("/list", (req, res) => {
  const companyName = String(req.body.company_name || "").trim();
  if (!companyName) return res.status(400).json({ error: "Informe o nome do negócio." });
  const values = leadListFields.map((field) => field === "company_name" ? companyName : String(req.body[field] || "").trim());
  const result = db.prepare(`INSERT INTO acquisition_lead_list (${leadListFields.join(", ")}) VALUES (${leadListFields.map(() => "?").join(", ")})`).run(...values);
  res.status(201).json({ lead: db.prepare("SELECT * FROM acquisition_lead_list WHERE id = ?").get(result.lastInsertRowid) });
});

router.patch("/list/:id", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID inválido." });
  const existing = db.prepare("SELECT * FROM acquisition_lead_list WHERE id = ?").get(id);
  if (!existing) return res.status(404).json({ error: "Registro não encontrado." });
  const updates = leadListFields.filter((field) => Object.hasOwn(req.body, field));
  const status = Object.hasOwn(req.body, "status") ? String(req.body.status) : existing.status;
  if (!new Set(["pending", "approved", "rejected"]).has(status)) return res.status(400).json({ error: "Status inválido." });
  if (updates.includes("company_name") && !String(req.body.company_name || "").trim()) return res.status(400).json({ error: "Informe o nome do negócio." });
  const save = db.transaction(() => {
    if (updates.length) {
      const values = updates.map((field) => String(req.body[field] || "").trim());
      db.prepare(`UPDATE acquisition_lead_list SET ${updates.map((field) => `${field} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(...values, id);
    }
    let lead = db.prepare("SELECT * FROM acquisition_lead_list WHERE id = ?").get(id);
    if (status === "approved" && !lead.prospect_id) {
      const stage = db.prepare("SELECT * FROM acquisition_stages WHERE stage_key = 'new'").get();
      const prospectResult = db.prepare(`INSERT INTO prospects (company_name, company_instagram, phone, contact_name, contact_phone, website, segment, city, source, notes, stage_id, next_action, next_action_date) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`)
        .run(lead.company_name, lead.company_instagram, lead.phone, lead.contact_name, lead.contact_phone, lead.website, lead.segment, lead.city, ACTIVE_PROSPECT_SOURCE, removeGoogleMapsLinks(lead.notes), stage.id, "Entrar em contato", localDate());
      stageTimestamp(prospectResult.lastInsertRowid, stage);
      db.prepare("UPDATE acquisition_lead_list SET prospect_id = ?, status = 'approved', updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(prospectResult.lastInsertRowid, id);
      lead = db.prepare("SELECT * FROM acquisition_lead_list WHERE id = ?").get(id);
    } else if (status !== "approved" && lead.prospect_id) {
      db.prepare("DELETE FROM prospects WHERE id = ?").run(lead.prospect_id);
      db.prepare("UPDATE acquisition_lead_list SET prospect_id = NULL WHERE id = ?").run(id);
      lead = db.prepare("SELECT * FROM acquisition_lead_list WHERE id = ?").get(id);
    }
    if (status !== lead.status || status === "rejected" || status === "pending") {
      db.prepare("UPDATE acquisition_lead_list SET status = ?, updated_at = CURRENT_TIMESTAMP WHERE id = ?").run(status, id);
      lead = db.prepare("SELECT * FROM acquisition_lead_list WHERE id = ?").get(id);
    }
    return lead;
  });
  res.json({ lead: save() });
});

function localDate(offset = 0) {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE, year: "numeric", month: "2-digit", day: "2-digit",
  }).formatToParts(new Date()).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  const date = new Date(Date.UTC(Number(parts.year), Number(parts.month) - 1, Number(parts.day) + offset));
  return date.toISOString().slice(0, 10);
}

function validDate(value) {
  if (typeof value !== "string" || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return false;
  const date = new Date(`${value}T00:00:00Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function validTime(value) {
  return !value || /^([01]\d|2[0-3]):[0-5]\d$/.test(value);
}

function followingDate(value) {
  const date = new Date(`${value}T00:00:00Z`);
  date.setUTCDate(date.getUTCDate() + 1);
  return date.toISOString().slice(0, 10);
}

function stageTimestamp(id, stage, meetingAt = null) {
  db.prepare(`
    INSERT INTO prospect_stage_history (prospect_id, stage_id, stage_key, stage_name, entered_at, meeting_at)
    VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, ?)
  `).run(id, stage.id, stage.stage_key, stage.name, meetingAt);
}

function getProspect(id) {
  return db.prepare(`
    SELECT p.*, s.name AS stage_name, s.stage_key, s.is_won, s.is_lost,
      c.name AS converted_client_name
    FROM prospects p
    JOIN acquisition_stages s ON s.id = p.stage_id
    LEFT JOIN clients c ON c.id = p.converted_client_id
    WHERE p.id = ?
  `).get(id);
}

function validId(value) {
  const id = Number(value);
  return Number.isInteger(id) && id > 0 ? id : null;
}

router.get("/stages", (req, res) => {
  const stages = db.prepare(`
    SELECT id, stage_key, name, position, is_won, is_lost
    FROM acquisition_stages ORDER BY position, id
  `).all();
  res.json({ stages });
});

router.get("/sources", (req, res) => {
  const sources = db.prepare("SELECT id, name FROM acquisition_sources ORDER BY name COLLATE NOCASE")
    .all().filter((source) => !isUrlSource(source.name));
  res.json({ sources });
});

router.get("/analytics", (req, res) => {
  const stageEvents = db.prepare(`
    SELECT h.id, h.prospect_id, h.stage_key, h.stage_name, h.entered_at, h.meeting_at,
      h.is_estimated, p.source, p.company_name, p.created_at, p.loss_reason
    FROM prospect_stage_history h JOIN prospects p ON p.id = h.prospect_id
    ORDER BY h.entered_at, h.id
  `).all();
  const interactions = db.prepare(`
    SELECT i.id, i.prospect_id, i.interaction_date, i.type, p.source
    FROM prospect_interactions i JOIN prospects p ON p.id = i.prospect_id
    ORDER BY i.interaction_date, i.id
  `).all();
  res.json({ stage_events: stageEvents, interactions });
});

router.post("/sources", (req, res) => {
  const name = String(req.body.name || "").trim();
  if (!name) return res.status(400).json({ error: "Informe o nome da origem." });
  if (isUrlSource(name)) return res.status(400).json({ error: "Informe uma origem, não um endereço de site." });
  try {
    const result = db.prepare("INSERT INTO acquisition_sources (name) VALUES (?)").run(name);
    res.status(201).json({ source: db.prepare("SELECT id, name FROM acquisition_sources WHERE id = ?").get(result.lastInsertRowid) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") {
      return res.status(409).json({ error: "Essa origem já existe." });
    }
    throw error;
  }
});

router.get("/", (req, res) => {
  const prospects = db.prepare(`
    SELECT p.*, s.name AS stage_name, s.stage_key, s.is_won, s.is_lost,
      c.name AS converted_client_name,
      (SELECT h.meeting_at FROM prospect_stage_history h
        WHERE h.prospect_id = p.id AND h.stage_id = p.stage_id
        ORDER BY h.id DESC LIMIT 1) AS meeting_at,
      (SELECT MAX(i.interaction_date) FROM prospect_interactions i WHERE i.prospect_id = p.id) AS latest_interaction
    FROM prospects p
    JOIN acquisition_stages s ON s.id = p.stage_id
    LEFT JOIN clients c ON c.id = p.converted_client_id
    ORDER BY p.updated_at DESC, p.id DESC
  `).all();
  res.json({ prospects });
});

router.post("/", (req, res) => {
  const companyName = String(req.body.company_name || "").trim();
  if (!companyName) return res.status(400).json({ error: "Informe o nome da empresa." });
  const initialStage = db.prepare("SELECT id FROM acquisition_stages WHERE stage_key = 'new'").get();
  const stageId = initialStage?.id;
  if (!stageId || !db.prepare("SELECT id FROM acquisition_stages WHERE id = ?").get(stageId)) {
    return res.status(400).json({ error: "Etapa inválida." });
  }
  const nextAction = String(req.body.next_action || "Entrar em contato").trim();
  const nextActionDate = String(req.body.next_action_date || "").trim();
  if (!validDate(nextActionDate)) return res.status(400).json({ error: "Informe uma data válida para a próxima ação." });
  const actionStartTime = String(req.body.next_action_start_time || "").trim();
  const actionEndTime = String(req.body.next_action_end_time || "").trim();
  if (!validTime(actionStartTime) || !validTime(actionEndTime)) {
    return res.status(400).json({ error: "Informe horários válidos no formato HH:MM." });
  }
  if ((actionStartTime && !actionEndTime) || (!actionStartTime && actionEndTime)) {
    return res.status(400).json({ error: "Informe os horários de início e término." });
  }
  if (actionStartTime && actionEndTime <= actionStartTime) {
    return res.status(400).json({ error: "O término deve ser depois do início." });
  }
  const fields = prospectFields.filter((field) => field !== "stage_id" && field !== "company_name");
  const values = fields.map((field) => {
    if (field === "next_action") return nextAction;
    if (field === "next_action_date") return nextActionDate;
    if (field === "next_action_start_time") return actionStartTime;
    if (field === "next_action_end_time") return actionEndTime;
    if (field === "first_contact_at") return null;
    if (field === "notes") return removeGoogleMapsLinks(req.body[field]);
    return req.body[field] ?? (field === "potential_value" ? null : "");
  });
  const placeholders = fields.map(() => "?").join(", ");
  const save = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO prospects (company_name, ${fields.join(", ")}, stage_id)
      VALUES (?, ${placeholders}, ?)
    `).run(companyName, ...values, stageId);
    const stage = db.prepare("SELECT * FROM acquisition_stages WHERE id = ?").get(stageId);
    stageTimestamp(result.lastInsertRowid, stage);
    return getProspect(result.lastInsertRowid);
  });
  res.status(201).json({ prospect: save() });
});

router.patch("/:id", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID de prospect inválido." });
  const existing = getProspect(id);
  if (!existing) return res.status(404).json({ error: "Prospect não encontrado." });
  const updates = prospectFields.filter((field) => Object.hasOwn(req.body, field));
  if (!updates.length) return res.json({ prospect: existing });
  const changingStage = updates.includes("stage_id") && String(req.body.stage_id) !== String(existing.stage_id);
  const targetStageId = changingStage ? validId(req.body.stage_id) : existing.stage_id;
  const targetStage = db.prepare("SELECT * FROM acquisition_stages WHERE id = ?").get(targetStageId);
  const meetingAt = String(req.body.meeting_at || "").trim();
  if (changingStage && ["triage_scheduled", "proposal_scheduled"].includes(targetStage?.stage_key) && !/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(meetingAt)) {
    return res.status(400).json({ error: "Informe a data e o horário da reunião." });
  }
  if (changingStage && targetStage?.stage_key === "future_interest" && !validDate(String(req.body.next_action_date || "").trim())) {
    return res.status(400).json({ error: "Informe uma data válida para o follow-up." });
  }
  const values = updates.map((field) => {
    if (field === "company_name") return String(req.body[field] || "").trim();
    if (field === "stage_id") return validId(req.body[field]);
    if (field === "potential_value") return req.body[field] === "" || req.body[field] == null ? null : Number(req.body[field]);
    if (field === "notes") return removeGoogleMapsLinks(req.body[field]);
    return req.body[field] == null ? "" : String(req.body[field]).trim();
  });
  if (updates.includes("company_name") && !values[updates.indexOf("company_name")]) {
    return res.status(400).json({ error: "Informe o nome da empresa." });
  }
  if (updates.includes("stage_id")) {
    const stageId = values[updates.indexOf("stage_id")];
    if (!stageId || !db.prepare("SELECT id FROM acquisition_stages WHERE id = ?").get(stageId)) {
      return res.status(400).json({ error: "Etapa inválida." });
    }
  }
  if (updates.includes("potential_value") && values[updates.indexOf("potential_value")] !== null && !Number.isFinite(values[updates.indexOf("potential_value")])) {
    return res.status(400).json({ error: "Valor potencial inválido." });
  }
  if (updates.includes("next_action_date")) {
    const nextDate = values[updates.indexOf("next_action_date")];
    if (nextDate && !validDate(nextDate)) return res.status(400).json({ error: "Data da próxima ação inválida." });
  }
  const startTime = req.body.next_action_start_time !== undefined
    ? String(req.body.next_action_start_time || "").trim()
    : String(existing.next_action_start_time || "").trim();
  const endTime = req.body.next_action_end_time !== undefined
    ? String(req.body.next_action_end_time || "").trim()
    : String(existing.next_action_end_time || "").trim();
  if (!validTime(startTime) || !validTime(endTime)) {
    return res.status(400).json({ error: "Informe horários válidos no formato HH:MM." });
  }
  if ((startTime && !endTime) || (!startTime && endTime)) {
    return res.status(400).json({ error: "Informe os horários de início e término." });
  }
  if (startTime && endTime <= startTime) {
    return res.status(400).json({ error: "O término deve ser depois do início." });
  }
  if (changingStage) {
    const automation = STAGE_ACTIONS[targetStage.stage_key];
    if (automation) {
      const nextDate = automation.date === "today" ? localDate()
        : automation.date === "tomorrow" ? localDate(1)
          : automation.date === "meeting" ? meetingAt.slice(0, 10)
          : automation.date === "preserve-or-tomorrow" ? (existing.next_action_date || localDate(1))
            : automation.date === "provided" ? String(req.body.next_action_date || "").trim() : "";
      for (const field of ["next_action", "next_action_date", "next_action_start_time", "next_action_end_time"]) {
        const index = updates.indexOf(field);
        const value = field === "next_action" ? automation.action
          : field === "next_action_date" ? nextDate : "";
        if (index >= 0) values[index] = value;
        else { updates.push(field); values.push(value); }
      }
    }
    if (targetStage.stage_key === "contacted") {
      const firstContactIndex = updates.indexOf("first_contact_at");
      if (firstContactIndex >= 0) values[firstContactIndex] = existing.first_contact_at || localDate();
      else { updates.push("first_contact_at"); values.push(existing.first_contact_at || localDate()); }
    }
  }
  const save = db.transaction(() => {
    db.prepare(`UPDATE prospects SET ${updates.map((field) => `${field} = ?`).join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...values, id);
    if (changingStage) stageTimestamp(id, targetStage, meetingAt || null);
  });
  save();
  res.json({ prospect: getProspect(id) });
});

router.delete("/:id", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID de prospect inválido." });
  const result = db.prepare("DELETE FROM prospects WHERE id = ?").run(id);
  if (!result.changes) return res.status(404).json({ error: "Prospect não encontrado." });
  res.json({ deleted_id: id });
});

router.get("/:id/interactions", (req, res) => {
  const id = validId(req.params.id);
  if (!id || !db.prepare("SELECT id FROM prospects WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Prospect não encontrado." });
  }
  const interactions = db.prepare(`
    SELECT * FROM prospect_interactions WHERE prospect_id = ?
    ORDER BY interaction_date DESC, id DESC
  `).all(id);
  res.json({ interactions });
});

router.get("/:id/history", (req, res) => {
  const id = validId(req.params.id);
  if (!id || !db.prepare("SELECT id FROM prospects WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Prospect não encontrado." });
  }
  const stages = db.prepare(`
    SELECT id, stage_key, stage_name, entered_at, meeting_at, is_estimated
    FROM prospect_stage_history WHERE prospect_id = ? ORDER BY entered_at DESC, id DESC
  `).all(id);
  res.json({ stages });
});

router.patch("/:id/history/:historyId", (req, res) => {
  const prospectId = validId(req.params.id);
  const historyId = validId(req.params.historyId);
  const enteredAt = req.body.entered_at;
  const isEstimated = req.body.is_estimated === true || req.body.is_estimated === 1 ? 1 : 0;
  if (!prospectId || !historyId) return res.status(400).json({ error: "ID de histórico inválido." });
  if (!validDate(enteredAt)) return res.status(400).json({ error: "Informe uma data válida para a etapa." });
  const history = db.prepare(`
    SELECT id FROM prospect_stage_history WHERE id = ? AND prospect_id = ?
  `).get(historyId, prospectId);
  if (!history) return res.status(404).json({ error: "Etapa do histórico não encontrada." });
  db.prepare("UPDATE prospect_stage_history SET entered_at = ?, is_estimated = ? WHERE id = ? AND prospect_id = ?")
    .run(`${enteredAt}T12:00:00`, isEstimated, historyId, prospectId);
  const stage = db.prepare(`
    SELECT id, stage_key, stage_name, entered_at, meeting_at, is_estimated
    FROM prospect_stage_history WHERE id = ?
  `).get(historyId);
  res.json({ stage });
});

router.post("/:id/interactions", (req, res) => {
  const id = validId(req.params.id);
  const interactionDate = String(req.body.interaction_date || "").trim();
  const type = String(req.body.type || "Contato").trim();
  const notes = String(req.body.notes || "").trim();
  if (!id || !db.prepare("SELECT id FROM prospects WHERE id = ?").get(id)) {
    return res.status(404).json({ error: "Prospect não encontrado." });
  }
  if (!interactionDate || !notes) return res.status(400).json({ error: "Informe a data e o registro da interação." });
  const save = db.transaction(() => {
    const result = db.prepare(`
      INSERT INTO prospect_interactions (prospect_id, interaction_date, type, notes)
      VALUES (?, ?, ?, ?)
    `).run(id, interactionDate, type || "Contato", notes);
    db.prepare(`
      UPDATE prospects SET
        last_contact_at = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(interactionDate, id);
    return db.prepare("SELECT * FROM prospect_interactions WHERE id = ?").get(result.lastInsertRowid);
  });
  res.status(201).json({ interaction: save() });
});

router.post("/:id/complete-action", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID de prospect inválido." });
  const prospect = getProspect(id);
  if (!prospect) return res.status(404).json({ error: "Prospect não encontrado." });
  const sentMessage = req.body?.whatsapp && typeof req.body.whatsapp === "object" ? req.body.whatsapp : null;
  const manualCompletion = req.body?.manual === true;
  const whatsappMessageId = String(sentMessage?.message_id || "").trim();
  if (whatsappMessageId) {
    const priorInteraction = db.prepare(`
      SELECT * FROM prospect_interactions WHERE prospect_id = ? AND whatsapp_message_id = ?
    `).get(id, whatsappMessageId);
    if (priorInteraction) return res.json({ interaction: priorInteraction, prospect });
  }
  const automationRule = db.prepare(`
    SELECT open_message_modal FROM acquisition_automation_rules WHERE stage_key = ? AND action = ?
  `).get(prospect.stage_key, prospect.next_action);
  if (automationRule?.open_message_modal && !sentMessage && !manualCompletion) {
    return res.status(409).json({ error: "Envie a mensagem pelo WhatsApp antes de concluir esta ação." });
  }
  if (!COMPLETABLE_ACTIONS.has(prospect.next_action) || !prospect.next_action_date || prospect.is_won || prospect.is_lost) {
    return res.status(400).json({ error: "Este prospect não tem próxima ação pendente." });
  }
  let messageData = null;
  if (sentMessage) {
    const chatJid = String(sentMessage.chat_jid || "").trim();
    const content = typeof sentMessage.content === "string" ? sentMessage.content : "";
    const scriptId = sentMessage.script_id == null || sentMessage.script_id === "" ? null : validId(sentMessage.script_id);
    const scriptName = String(sentMessage.script_name || "").trim().slice(0, 160);
    if (!whatsappMessageId || !chatJid || !content || content.length > 4096) {
      return res.status(400).json({ error: "Não foi possível registrar a mensagem confirmada pelo WhatsApp." });
    }
    const confirmedMessage = db.prepare(`
      SELECT id, timestamp FROM whatsapp_messages
      WHERE id = ? AND chat_jid = ? AND from_me = 1 AND text = ?
    `).get(whatsappMessageId, chatJid, content);
    if (!confirmedMessage) return res.status(409).json({ error: "O WhatsApp ainda não confirmou essa mensagem. A ação continua pendente." });
    messageData = { chatJid, content, scriptId, scriptName, whatsappMessageId, messageSentAt: confirmedMessage.timestamp };
  }
  const complete = db.transaction(() => {
    const contactCompleted = Boolean(messageData || manualCompletion);
    const interactionDate = contactCompleted ? localDate() : prospect.next_action_date;
    const rule = db.prepare(`
      SELECT next_follow_up_days, next_action FROM acquisition_automation_rules WHERE stage_key = ? AND action = ?
    `).get(prospect.stage_key, prospect.next_action);
    const movesToContacted = Boolean(contactCompleted && prospect.stage_key === "new");
    const contactedStage = movesToContacted
      ? db.prepare("SELECT * FROM acquisition_stages WHERE stage_key = 'contacted'").get()
      : null;
    if (movesToContacted && !contactedStage) throw new Error("A etapa Contatado não está configurada.");
    const keepsFollowingUp = prospect.stage_key === "contacted" && prospect.next_action === "Follow-up";
    const nextAction = movesToContacted || keepsFollowingUp ? "Follow-up" : rule?.next_action || "";
    const nextActionDate = contactCompleted
      ? localDate(Math.max(0, Math.min(365, Number(rule?.next_follow_up_days ?? 1))))
      : followingDate(prospect.next_action_date);
    const result = messageData
      ? db.prepare(`
        INSERT INTO prospect_interactions (
          prospect_id, interaction_date, type, notes, script_id, script_name,
          message_content, whatsapp_message_id, whatsapp_chat_jid, message_sent_at
        ) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?)
      `).run(
        id,
        interactionDate,
        `WhatsApp enviado · ${prospect.next_action}`,
        `${prospect.next_action} concluído(a).`,
        messageData.scriptId,
        messageData.scriptName,
        messageData.content,
        messageData.whatsappMessageId,
        messageData.chatJid,
        messageData.messageSentAt,
      )
      : db.prepare(`
        INSERT INTO prospect_interactions (prospect_id, interaction_date, type, notes)
        VALUES (?, ?, ?, ?)
      `).run(
        id,
        interactionDate,
        manualCompletion ? `Concluído manualmente · ${prospect.next_action}` : "Ação concluída",
        manualCompletion ? `${prospect.next_action} concluído(a) fora do WhatsApp pela plataforma.` : `${prospect.next_action} concluído(a).`,
      );
    const assignments = [
      "next_action = CASE WHEN ? <> '' THEN ? ELSE next_action END",
      "next_action_date = ?",
      "next_action_start_time = ''",
      "next_action_end_time = ''",
      "last_contact_at = ?",
    ];
    const updateValues = [nextAction, nextAction, nextActionDate, interactionDate];
    if (movesToContacted) {
      assignments.push("stage_id = ?", "first_contact_at = COALESCE(first_contact_at, ?)");
      updateValues.push(contactedStage.id, interactionDate);
    }
    db.prepare(`UPDATE prospects SET ${assignments.join(", ")}, updated_at = CURRENT_TIMESTAMP WHERE id = ?`)
      .run(...updateValues, id);
    if (movesToContacted) stageTimestamp(id, contactedStage);
    return db.prepare("SELECT * FROM prospect_interactions WHERE id = ?").get(result.lastInsertRowid);
  });
  let interaction;
  try {
    interaction = complete();
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE" && whatsappMessageId) {
      interaction = db.prepare(`SELECT * FROM prospect_interactions
        WHERE prospect_id = ? AND whatsapp_message_id = ?`).get(id, whatsappMessageId);
      if (interaction) return res.json({ interaction, prospect: getProspect(id) });
    }
    throw error;
  }
  res.status(201).json({ interaction, prospect: getProspect(id) });
});

router.post("/:id/convert", (req, res) => {
  const id = validId(req.params.id);
  if (!id) return res.status(400).json({ error: "ID de prospect invÃ¡lido." });
  const convert = db.transaction(() => {
    const prospect = getProspect(id);
    if (!prospect) throw Object.assign(new Error("Prospect nÃ£o encontrado."), { status: 404 });
    if (prospect.converted_client_id) {
      return { prospect, client: db.prepare("SELECT * FROM clients WHERE id = ?").get(prospect.converted_client_id) };
    }

    const details = req.body.client || {};
    const name = String(details.name || prospect.company_name).trim();
    const origin = String(details.origin || "").trim();
    const accountId = String(details.account_id || "").trim() || null;
    const paymentMethod = String(details.payment_method || "auto");
    const monthlyFee = details.monthly_fee == null || details.monthly_fee === "" ? null : Number(details.monthly_fee);
    const firstPaymentDate = details.first_payment_date || null;
    const entryDate = details.entry_date || localDate();
    const exitDate = details.exit_date || null;
    const targetStageId = req.body.stage_id == null ? prospect.stage_id : validId(req.body.stage_id);
    const targetStage = targetStageId && db.prepare("SELECT * FROM acquisition_stages WHERE id = ?").get(targetStageId);

    if (!targetStage?.is_won) throw Object.assign(new Error("O prospect precisa estar na etapa Fechado para virar cliente."), { status: 400 });
    if (!name) throw Object.assign(new Error("O nome do cliente Ã© obrigatÃ³rio."), { status: 400 });
    if (!CLIENT_ORIGINS.has(origin)) throw Object.assign(new Error("Selecione uma origem vÃ¡lida para o cliente."), { status: 400 });
    if (!CLIENT_PAYMENT_METHODS.has(paymentMethod)) throw Object.assign(new Error("Selecione uma forma de pagamento vÃ¡lida."), { status: 400 });
    if ((monthlyFee !== null && (!Number.isFinite(monthlyFee) || monthlyFee < 0)) ||
      (firstPaymentDate && !validDate(firstPaymentDate)) || !validDate(entryDate) || (exitDate && !validDate(exitDate))) {
      throw Object.assign(new Error("Informe um valor de mensalidade e datas vÃ¡lidas."), { status: 400 });
    }

    const clientResult = db.prepare(`
      INSERT INTO clients (
        account_id, name, logo_url, currency, origin, active, payment_method,
        monthly_fee, billing_day, first_payment_date, entry_date, exit_date
      ) VALUES (?, ?, '', ?, ?, ?, ?, ?, ?, ?, ?, ?)
    `).run(
      accountId,
      name,
      String(details.currency || "BRL"),
      origin,
      details.active === false ? 0 : 1,
      paymentMethod,
      monthlyFee,
      firstPaymentDate ? Number(firstPaymentDate.slice(-2)) : null,
      firstPaymentDate,
      entryDate,
      exitDate
    );

    const changingStage = String(prospect.stage_id) !== String(targetStage.id);
    db.prepare(`
      UPDATE prospects SET converted_client_id = ?, stage_id = ?, next_action = '',
        next_action_date = '', updated_at = CURRENT_TIMESTAMP WHERE id = ?
    `).run(clientResult.lastInsertRowid, targetStage.id, id);
    if (changingStage) stageTimestamp(id, targetStage);

    return {
      prospect: getProspect(id),
      client: db.prepare("SELECT * FROM clients WHERE id = ?").get(clientResult.lastInsertRowid),
    };
  });

  try {
    res.status(200).json(convert());
  } catch (error) {
    const status = error.status || (error.code === "SQLITE_CONSTRAINT_UNIQUE" ? 409 : 500);
    const message = error.status ? error.message
      : error.code === "SQLITE_CONSTRAINT_UNIQUE" ? "Essa conta Meta jÃ¡ estÃ¡ vinculada a outro cliente."
        : "NÃ£o foi possÃ­vel converter o prospect.";
    res.status(status).json({ error: message });
  }
});
export default router;
