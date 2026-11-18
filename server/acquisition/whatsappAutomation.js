import db from "../database/db.js";

const BRAZIL_TIME_ZONE = "America/Sao_Paulo";
const AUTOMATIC_REPLY_SOURCE_STAGES = new Set(["new", "contacted"]);

function localDate() {
  const parts = new Intl.DateTimeFormat("en-CA", {
    timeZone: BRAZIL_TIME_ZONE,
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).formatToParts(new Date()).reduce((result, part) => {
    result[part.type] = part.value;
    return result;
  }, {});
  return `${parts.year}-${parts.month}-${parts.day}`;
}

function resolveRelatedChatJids(jid) {
  const related = new Set([jid]);
  const pending = [jid];
  while (pending.length) {
    const current = pending.pop();
    const aliases = db.prepare(`
      SELECT alias_jid, canonical_jid FROM whatsapp_jid_aliases
      WHERE alias_jid = ? OR canonical_jid = ?
    `).all(current, current);
    for (const alias of aliases) {
      for (const relatedJid of [alias.alias_jid, alias.canonical_jid]) {
        if (related.has(relatedJid)) continue;
        related.add(relatedJid);
        pending.push(relatedJid);
      }
    }
  }
  return [...related];
}

function normalizedBrazilPhone(value) {
  let digits = String(value || "").replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (digits.startsWith("0") && digits.length >= 11 && digits.length <= 13) digits = digits.slice(1);
  if (digits.startsWith("55") && digits.length >= 12 && digits.length <= 13) digits = digits.slice(2);
  return digits;
}

function prospectIdForChat(chatJid, relatedJids) {
  const placeholders = relatedJids.map(() => "?").join(", ");
  const linkedProspects = db.prepare(`
    SELECT DISTINCT prospect_id FROM prospect_interactions
    WHERE whatsapp_chat_jid IN (${placeholders})
  `).all(...relatedJids).map((row) => Number(row.prospect_id));
  if (linkedProspects.length === 1) return linkedProspects[0];
  if (linkedProspects.length > 1) return null;

  const jid = relatedJids.find((value) => value.endsWith("@s.whatsapp.net")) || chatJid;
  if (!jid.endsWith("@s.whatsapp.net")) return null;
  const phone = normalizedBrazilPhone(jid.split("@")[0].split(":")[0]);
  if (!phone) return null;

  const prospects = db.prepare("SELECT id, phone, contact_phone FROM prospects").all();
  const matches = prospects.filter((prospect) => [prospect.phone, prospect.contact_phone]
    .some((value) => normalizedBrazilPhone(value) === phone));
  return matches.length === 1 ? Number(matches[0].id) : null;
}

export function advanceProspectAfterWhatsAppReply({ chatJid, messageId, text, timestamp }) {
  const jid = String(chatJid || "").trim();
  if (!jid || jid.endsWith("@g.us")) return null;

  const relatedJids = resolveRelatedChatJids(jid);
  const prospectId = prospectIdForChat(jid, relatedJids);
  if (!prospectId) return null;

  const advance = db.transaction(() => {
    const prospect = db.prepare(`
      SELECT p.id, p.stage_id, s.stage_key
      FROM prospects p JOIN acquisition_stages s ON s.id = p.stage_id
      WHERE p.id = ?
    `).get(prospectId);
    if (!prospect || !AUTOMATIC_REPLY_SOURCE_STAGES.has(prospect.stage_key)) return null;

    const respondedStage = db.prepare("SELECT * FROM acquisition_stages WHERE stage_key = 'responded'").get();
    if (!respondedStage) return null;

    const interactionDate = localDate();
    db.prepare(`
      UPDATE prospects SET
        stage_id = ?, next_action = 'Confirmar reunião', next_action_date = ?,
        first_contact_at = COALESCE(first_contact_at, ?), last_contact_at = ?,
        updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(respondedStage.id, interactionDate, interactionDate, interactionDate, prospectId);

    db.prepare(`
      INSERT INTO prospect_stage_history (prospect_id, stage_id, stage_key, stage_name, entered_at, meeting_at)
      VALUES (?, ?, ?, ?, CURRENT_TIMESTAMP, NULL)
    `).run(prospectId, respondedStage.id, respondedStage.stage_key, respondedStage.name);

    if (messageId) {
      db.prepare(`
        INSERT OR IGNORE INTO prospect_interactions (
          prospect_id, interaction_date, type, notes, message_content,
          whatsapp_message_id, whatsapp_chat_jid, message_sent_at
        ) VALUES (?, ?, 'WhatsApp recebido', 'Resposta recebida pelo WhatsApp.', ?, ?, ?, ?)
      `).run(
        prospectId,
        interactionDate,
        String(text || ""),
        String(messageId),
        jid,
        Number.isFinite(Number(timestamp)) ? Number(timestamp) : null,
      );
    }

    return {
      prospectId,
      stageId: respondedStage.id,
      stageKey: respondedStage.stage_key,
      stageName: respondedStage.name,
    };
  });

  return advance();
}
