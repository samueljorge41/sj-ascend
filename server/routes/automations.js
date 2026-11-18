import express from "express";
import db from "../database/db.js";

const router = express.Router();

const ACTIONS = new Set([
  "Entrar em contato",
  "Follow-up",
  "Confirmar reunião",
  "Realizar reunião",
  "Enviar proposta",
  "Follow-up da proposta",
  "Aguardar retorno",
  "Outro",
]);

const CONTACT_ACTIONS = new Set([
  "Entrar em contato",
  "Follow-up",
  "Confirmar reunião",
  "Enviar proposta",
  "Follow-up da proposta",
]);

function getScript(id) {
  return db.prepare("SELECT * FROM acquisition_message_scripts WHERE id = ? AND is_archived = 0").get(id);
}

function serializeScript(script) {
  return script ? { ...script, is_default: Boolean(script.is_default) } : null;
}

function validateScript(body = {}) {
  const name = String(body.name || "").trim();
  const content = typeof body.body === "string" ? body.body.trim() : "";
  const stageKey = String(body.stage_key || "").trim();
  const action = String(body.action || "").trim();
  if (!name) return { error: "Informe um nome para o script." };
  if (!content) return { error: "Escreva o conteúdo do script." };
  if (content.length > 4096) return { error: "O script deve ter até 4.096 caracteres." };
  if (action && !ACTIONS.has(action)) return { error: "Ação comercial inválida." };
  if (stageKey && !db.prepare("SELECT 1 FROM acquisition_stages WHERE stage_key = ?").get(stageKey)) {
    return { error: "Etapa comercial inválida." };
  }
  return { name, body: content, stage_key: stageKey, action, is_default: Boolean(body.is_default) };
}

router.get("/scripts", (req, res) => {
  const scripts = db.prepare(`
    SELECT * FROM acquisition_message_scripts
    WHERE is_archived = 0
    ORDER BY stage_key, action, is_default DESC, name COLLATE NOCASE
  `).all().map(serializeScript);
  res.json({ scripts });
});

router.post("/scripts", (req, res) => {
  const script = validateScript(req.body);
  if (script.error) return res.status(400).json({ error: script.error });

  try {
    const save = db.transaction(() => {
      if (script.is_default) {
        db.prepare(`UPDATE acquisition_message_scripts SET is_default = 0
          WHERE stage_key = ? AND action = ? AND is_archived = 0`).run(script.stage_key, script.action);
      }
      const result = db.prepare(`
        INSERT INTO acquisition_message_scripts (name, stage_key, action, body, is_default)
        VALUES (@name, @stage_key, @action, @body, @is_default)
      `).run({ ...script, is_default: script.is_default ? 1 : 0 });
      return db.prepare("SELECT * FROM acquisition_message_scripts WHERE id = ?").get(result.lastInsertRowid);
    });
    return res.status(201).json({ script: serializeScript(save()) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Já existe um script padrão para essa combinação de etapa e ação." });
    throw error;
  }
});

router.patch("/scripts/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "ID de script inválido." });
  if (!getScript(id)) return res.status(404).json({ error: "Script não encontrado." });
  const script = validateScript(req.body);
  if (script.error) return res.status(400).json({ error: script.error });

  try {
    const save = db.transaction(() => {
      if (script.is_default) {
        db.prepare(`UPDATE acquisition_message_scripts SET is_default = 0
          WHERE stage_key = ? AND action = ? AND id <> ? AND is_archived = 0`).run(script.stage_key, script.action, id);
      }
      db.prepare(`
        UPDATE acquisition_message_scripts SET name = @name, stage_key = @stage_key, action = @action,
          body = @body, is_default = @is_default, updated_at = CURRENT_TIMESTAMP
        WHERE id = @id
      `).run({ ...script, is_default: script.is_default ? 1 : 0, id });
      return db.prepare("SELECT * FROM acquisition_message_scripts WHERE id = ?").get(id);
    });
    return res.json({ script: serializeScript(save()) });
  } catch (error) {
    if (error.code === "SQLITE_CONSTRAINT_UNIQUE") return res.status(409).json({ error: "Já existe um script padrão para essa combinação de etapa e ação." });
    throw error;
  }
});

router.delete("/scripts/:id", (req, res) => {
  const id = Number(req.params.id);
  if (!Number.isInteger(id) || id < 1) return res.status(400).json({ error: "ID de script inválido." });
  const script = getScript(id);
  if (!script) return res.status(404).json({ error: "Script não encontrado." });
  const remove = db.transaction(() => {
    db.prepare("UPDATE acquisition_automation_rules SET recommended_script_id = NULL WHERE recommended_script_id = ?").run(id);
    if (script.system_key) {
      db.prepare(`UPDATE acquisition_message_scripts SET is_archived = 1, is_default = 0,
        updated_at = CURRENT_TIMESTAMP WHERE id = ?`).run(id);
    } else {
      db.prepare("DELETE FROM acquisition_message_scripts WHERE id = ?").run(id);
    }
  });
  remove();
  res.json({ ok: true });
});

router.get("/rules", (req, res) => {
  const rules = db.prepare(`
    SELECT r.stage_key, COALESCE(s.name, 'Todas as etapas') AS stage_name, r.action,
      r.open_message_modal, r.recommended_script_id, r.next_follow_up_days, r.next_action,
      script.name AS recommended_script_name
    FROM acquisition_automation_rules r
    LEFT JOIN acquisition_stages s ON s.stage_key = r.stage_key
    LEFT JOIN acquisition_message_scripts script
      ON script.id = r.recommended_script_id AND script.is_archived = 0
    ORDER BY COALESCE(s.position, 999), r.action
  `).all().map((rule) => ({ ...rule, open_message_modal: Boolean(rule.open_message_modal) }));
  res.json({ rules });
});

router.patch("/rules", (req, res) => {
  const stageKey = String(req.body?.stage_key || "").trim();
  const action = String(req.body?.action || "").trim();
  const nextAction = String(req.body?.next_action || "").trim();
  const openModal = req.body?.open_message_modal === true;
  const days = Number(req.body?.next_follow_up_days);
  const scriptId = req.body?.recommended_script_id == null || req.body.recommended_script_id === ""
    ? null
    : Number(req.body.recommended_script_id);
  if (!ACTIONS.has(action)) return res.status(400).json({ error: "Ação comercial inválida." });
  if (stageKey && !db.prepare("SELECT 1 FROM acquisition_stages WHERE stage_key = ?").get(stageKey)) {
    return res.status(400).json({ error: "Etapa comercial inválida." });
  }
  if (openModal && !CONTACT_ACTIONS.has(action)) {
    return res.status(400).json({ error: "Essa ação é uma tarefa interna e não abre o envio de mensagem." });
  }
  if (nextAction && !ACTIONS.has(nextAction)) return res.status(400).json({ error: "Próxima ação inválida." });
  if (!Number.isInteger(days) || days < 0 || days > 365) return res.status(400).json({ error: "O prazo do próximo acompanhamento deve ficar entre 0 e 365 dias." });
  if (scriptId != null) {
    if (!Number.isInteger(scriptId) || scriptId < 1) return res.status(400).json({ error: "Script recomendado inválido." });
    const script = getScript(scriptId);
    if (!script || (script.action && script.action !== action) || (script.stage_key && script.stage_key !== stageKey)) {
      return res.status(400).json({ error: "O script recomendado não corresponde à etapa e à ação." });
    }
  }
  const result = db.prepare(`
    UPDATE acquisition_automation_rules
    SET open_message_modal = ?, recommended_script_id = ?, next_follow_up_days = ?, next_action = ?, updated_at = CURRENT_TIMESTAMP
    WHERE stage_key = ? AND action = ?
  `).run(openModal ? 1 : 0, scriptId, days, nextAction, stageKey, action);
  if (!result.changes) return res.status(404).json({ error: "Regra de automação não encontrada." });
  const rule = db.prepare(`
    SELECT stage_key, action, open_message_modal, recommended_script_id, next_follow_up_days, next_action
    FROM acquisition_automation_rules WHERE stage_key = ? AND action = ?
  `).get(stageKey, action);
  return res.json({ rule: { ...rule, open_message_modal: Boolean(rule.open_message_modal) } });
});

router.use((error, req, res, next) => {
  console.error("Erro nas automações de aquisição:", error.message);
  res.status(500).json({ error: "Não foi possível concluir a operação de automações." });
});

export default router;
