import Database from "better-sqlite3";
import fs from "fs";
import path from "path";
import { databasePath } from "../config/paths.js";

const databaseDirectory = path.dirname(databasePath);

fs.mkdirSync(databaseDirectory, {
  recursive: true,
});

const db = new Database(databasePath);

db.pragma("journal_mode = WAL");
db.pragma("foreign_keys = ON");

db.exec(`
  CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    logo_url TEXT NOT NULL DEFAULT '',
    active INTEGER NOT NULL DEFAULT 0,
    payment_method TEXT NOT NULL DEFAULT 'auto',
    monthly_fee REAL,
    billing_day INTEGER,
    first_payment_date TEXT,
    entry_date TEXT,
    exit_date TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

    CREATE TABLE IF NOT EXISTS meta_accounts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    account_id TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'BRL',
    last_synced_at TEXT,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS settings (
      id INTEGER PRIMARY KEY CHECK (id = 1),
      groupings TEXT NOT NULL DEFAULT '["daily","weekly","monthly","quarterly","semester","yearly"]',
      created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
      updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
    );

  CREATE TABLE IF NOT EXISTS client_relationship_periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    started_on TEXT NOT NULL,
    ended_on TEXT,
    source TEXT NOT NULL DEFAULT 'tracked' CHECK (source IN ('tracked', 'legacy')),
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    CHECK (date(started_on) IS NOT NULL),
    CHECK (ended_on IS NULL OR date(ended_on) >= date(started_on))
  );

  CREATE INDEX IF NOT EXISTS idx_client_relationship_periods_client
    ON client_relationship_periods(client_id, started_on);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_client_relationship_periods_open
    ON client_relationship_periods(client_id)
    WHERE ended_on IS NULL;

  CREATE TABLE IF NOT EXISTS client_monthly_receivables (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_id INTEGER NOT NULL,
    reference_month TEXT NOT NULL,
    expected_amount REAL NOT NULL CHECK (expected_amount > 0),
    due_date TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE CASCADE,
    UNIQUE (client_id, reference_month),
    CHECK (date(due_date) IS NOT NULL),
    CHECK (date(reference_month || '-01') IS NOT NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_client_monthly_receivables_month
    ON client_monthly_receivables(reference_month, client_id);

  CREATE TABLE IF NOT EXISTS client_receipts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    receivable_id INTEGER NOT NULL,
    amount REAL NOT NULL CHECK (amount > 0),
    received_on TEXT NOT NULL,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (receivable_id) REFERENCES client_monthly_receivables(id) ON DELETE CASCADE,
    CHECK (date(received_on) IS NOT NULL)
  );

  CREATE INDEX IF NOT EXISTS idx_client_receipts_receivable
    ON client_receipts(receivable_id, received_on);

  CREATE INDEX IF NOT EXISTS idx_client_receipts_received_on
    ON client_receipts(received_on);

    CREATE TABLE IF NOT EXISTS client_operations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    client_id INTEGER NOT NULL UNIQUE,

    last_optimization_date TEXT,
    next_optimization_date TEXT,
    billing_date TEXT,

    balance_status TEXT NOT NULL DEFAULT '',
    balance_note TEXT NOT NULL DEFAULT '',

    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (client_id)
      REFERENCES clients(id)
      ON DELETE CASCADE
  );

  CREATE TABLE IF NOT EXISTS client_demands (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    client_id INTEGER NOT NULL,

    title TEXT NOT NULL,
    type TEXT NOT NULL,
    demand_date TEXT NOT NULL,

    observation TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    FOREIGN KEY (client_id)
      REFERENCES clients(id)
      ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_client_demands_client
  ON client_demands(client_id);

  CREATE INDEX IF NOT EXISTS idx_client_demands_date
  ON client_demands(demand_date);

  CREATE INDEX IF NOT EXISTS idx_client_demands_status
  ON client_demands(status);

  CREATE TABLE IF NOT EXISTS agenda_items (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    item_type TEXT NOT NULL CHECK (item_type IN ('appointment', 'task')),
    title TEXT NOT NULL,
    description TEXT NOT NULL DEFAULT '',
    area TEXT NOT NULL CHECK (area IN ('personal', 'professional')),
    category TEXT NOT NULL DEFAULT '',
    planned_date TEXT,
    due_date TEXT,
    start_time TEXT,
    end_time TEXT,
    priority TEXT NOT NULL DEFAULT 'normal' CHECK (priority IN ('low', 'normal', 'high')),
    status TEXT NOT NULL DEFAULT 'pending' CHECK (status IN ('pending', 'in_progress', 'completed', 'not_done', 'scheduled', 'cancelled')),
    observations TEXT NOT NULL DEFAULT '',
    client_id INTEGER,
    recurrence_rule TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_agenda_items_planned_date
  ON agenda_items(planned_date);

  CREATE INDEX IF NOT EXISTS idx_agenda_items_due_date
  ON agenda_items(due_date);

  CREATE INDEX IF NOT EXISTS idx_agenda_items_client
  ON agenda_items(client_id);

  CREATE TABLE IF NOT EXISTS google_calendar_tokens (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    token_iv TEXT NOT NULL,
    token_auth_tag TEXT NOT NULL,
    token_ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS google_calendar_watch_channels (
    channel_id TEXT PRIMARY KEY,
    resource_id TEXT,
    token_hash TEXT NOT NULL,
    expires_at INTEGER NOT NULL
  );

  CREATE TABLE IF NOT EXISTS google_calendar_event_links (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    source_type TEXT NOT NULL,
    source_id INTEGER NOT NULL,
    google_event_id TEXT NOT NULL UNIQUE,
    last_synced_json TEXT NOT NULL DEFAULT '{}',
    archived_at TEXT,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    UNIQUE(source_type, source_id)
  );

  CREATE TABLE IF NOT EXISTS google_calendar_hidden_events (
    google_event_id TEXT PRIMARY KEY,
    hidden_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS agenda_event_color_overrides (
    source_type TEXT NOT NULL,
    source_id TEXT NOT NULL,
    color_id TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (source_type, source_id)
  );

  CREATE TABLE IF NOT EXISTS google_calendar_sync_state (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    sync_token TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS google_calendar_oauth_states (
    state_hash TEXT PRIMARY KEY,
    expires_at INTEGER NOT NULL
  );

  INSERT OR IGNORE INTO settings (
    id,
    groupings
  ) VALUES (
    1,
    '["daily","weekly","monthly","quarterly","semester","yearly"]'
  );

  CREATE TABLE IF NOT EXISTS overview_cache (
    id INTEGER PRIMARY KEY AUTOINCREMENT,

    account_id TEXT NOT NULL,
    since TEXT NOT NULL,
    until TEXT NOT NULL,

    name TEXT NOT NULL DEFAULT '',
    currency TEXT NOT NULL DEFAULT 'BRL',

    spend REAL NOT NULL DEFAULT 0,
    conversations REAL NOT NULL DEFAULT 0,
    leads REAL NOT NULL DEFAULT 0,
    cost_per_lead REAL NOT NULL DEFAULT 0,
    balance REAL NOT NULL DEFAULT 0,
    balance_known INTEGER NOT NULL DEFAULT 1,
    is_prepay_account INTEGER NOT NULL DEFAULT 0,

    status TEXT NOT NULL DEFAULT 'red',

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(account_id, since, until)
  );

  CREATE INDEX IF NOT EXISTS idx_overview_cache_period
  ON overview_cache(since, until);

  CREATE INDEX IF NOT EXISTS idx_overview_cache_account
  ON overview_cache(account_id);

  CREATE TABLE IF NOT EXISTS acquisition_stages (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    stage_key TEXT NOT NULL UNIQUE,
    name TEXT NOT NULL,
    position INTEGER NOT NULL DEFAULT 0,
    is_won INTEGER NOT NULL DEFAULT 0,
    is_lost INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS prospects (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL,
    segment TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    company_instagram TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_role TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    contact_instagram TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    loss_reason TEXT NOT NULL DEFAULT '',
    stage_id INTEGER NOT NULL,
    source TEXT NOT NULL DEFAULT '',
    owner TEXT NOT NULL DEFAULT '',
    potential_value REAL,
    offer TEXT NOT NULL DEFAULT '',
    first_contact_at TEXT,
    last_contact_at TEXT,
    next_action TEXT NOT NULL DEFAULT '',
    next_action_date TEXT,
    converted_client_id INTEGER UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (stage_id) REFERENCES acquisition_stages(id),
    FOREIGN KEY (converted_client_id) REFERENCES clients(id) ON DELETE SET NULL
  );

  CREATE INDEX IF NOT EXISTS idx_prospects_stage ON prospects(stage_id);
  CREATE INDEX IF NOT EXISTS idx_prospects_next_action ON prospects(next_action_date);

  CREATE TABLE IF NOT EXISTS acquisition_lead_list (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    company_name TEXT NOT NULL DEFAULT '',
    company_instagram TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    contact_name TEXT NOT NULL DEFAULT '',
    contact_phone TEXT NOT NULL DEFAULT '',
    website TEXT NOT NULL DEFAULT '',
    segment TEXT NOT NULL DEFAULT '',
    city TEXT NOT NULL DEFAULT '',
    source TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'pending' CHECK(status IN ('pending','approved','rejected')),
    prospect_id INTEGER UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE SET NULL
  );
  CREATE INDEX IF NOT EXISTS idx_acquisition_lead_list_status ON acquisition_lead_list(status, updated_at DESC);

  CREATE TABLE IF NOT EXISTS prospect_interactions (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL,
    interaction_date TEXT NOT NULL,
    type TEXT NOT NULL DEFAULT 'Contato',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    script_id INTEGER,
    script_name TEXT NOT NULL DEFAULT '',
    message_content TEXT NOT NULL DEFAULT '',
    whatsapp_message_id TEXT,
    whatsapp_chat_jid TEXT NOT NULL DEFAULT '',
    message_sent_at INTEGER,
    FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_prospect_interactions_prospect
  ON prospect_interactions(prospect_id, interaction_date DESC);

  CREATE TABLE IF NOT EXISTS prospect_stage_history (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    prospect_id INTEGER NOT NULL,
    stage_id INTEGER NOT NULL,
    stage_key TEXT NOT NULL,
    stage_name TEXT NOT NULL,
    entered_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    meeting_at TEXT,
    is_estimated INTEGER NOT NULL DEFAULT 0,
    FOREIGN KEY (prospect_id) REFERENCES prospects(id) ON DELETE CASCADE,
    FOREIGN KEY (stage_id) REFERENCES acquisition_stages(id)
  );

  CREATE INDEX IF NOT EXISTS idx_prospect_stage_history_prospect
  ON prospect_stage_history(prospect_id, entered_at DESC, id DESC);

  CREATE TABLE IF NOT EXISTS acquisition_sources (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL COLLATE NOCASE UNIQUE,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS acquisition_message_scripts (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL,
    stage_key TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL DEFAULT '',
    body TEXT NOT NULL,
    is_default INTEGER NOT NULL DEFAULT 0,
    system_key TEXT UNIQUE,
    is_archived INTEGER NOT NULL DEFAULT 0,
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_acquisition_scripts_stage_action
    ON acquisition_message_scripts(stage_key, action, is_archived);

  CREATE UNIQUE INDEX IF NOT EXISTS idx_acquisition_scripts_default
    ON acquisition_message_scripts(stage_key, action)
    WHERE is_default = 1 AND is_archived = 0;

  CREATE TABLE IF NOT EXISTS acquisition_automation_rules (
    stage_key TEXT NOT NULL DEFAULT '',
    action TEXT NOT NULL,
    open_message_modal INTEGER NOT NULL DEFAULT 0,
    recommended_script_id INTEGER,
    next_follow_up_days INTEGER NOT NULL DEFAULT 1,
    next_action TEXT NOT NULL DEFAULT '',
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (stage_key, action),
    FOREIGN KEY (recommended_script_id) REFERENCES acquisition_message_scripts(id) ON DELETE SET NULL
  );

  CREATE TABLE IF NOT EXISTS whatsapp_send_requests (
    request_id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    text TEXT NOT NULL,
    status TEXT NOT NULL DEFAULT 'pending',
    message_id TEXT,
    error TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS whatsapp_auth (
    id INTEGER PRIMARY KEY CHECK (id = 1),
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS whatsapp_signal_keys (
    key_type TEXT NOT NULL,
    key_id TEXT NOT NULL,
    iv TEXT NOT NULL,
    auth_tag TEXT NOT NULL,
    ciphertext TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
    PRIMARY KEY (key_type, key_id)
  );

  CREATE TABLE IF NOT EXISTS whatsapp_chats (
    jid TEXT PRIMARY KEY,
    name TEXT NOT NULL DEFAULT '',
    avatar_url TEXT NOT NULL DEFAULT '',
    avatar_checked_at TEXT,
    last_message TEXT NOT NULL DEFAULT '',
    last_message_at INTEGER,
    unread_count INTEGER NOT NULL DEFAULT 0,
    is_group INTEGER NOT NULL DEFAULT 0,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE TABLE IF NOT EXISTS whatsapp_jid_aliases (
    alias_jid TEXT PRIMARY KEY,
    canonical_jid TEXT NOT NULL,
    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP
  );

  CREATE INDEX IF NOT EXISTS idx_whatsapp_jid_aliases_canonical
    ON whatsapp_jid_aliases(canonical_jid);

  CREATE TABLE IF NOT EXISTS whatsapp_messages (
    id TEXT PRIMARY KEY,
    chat_jid TEXT NOT NULL,
    from_me INTEGER NOT NULL DEFAULT 0,
    text TEXT NOT NULL DEFAULT '',
    message_type TEXT NOT NULL DEFAULT 'conversation',
    timestamp INTEGER NOT NULL,
    status INTEGER NOT NULL DEFAULT 1,
    participant TEXT NOT NULL DEFAULT '',
    FOREIGN KEY (chat_jid) REFERENCES whatsapp_chats(jid) ON DELETE CASCADE
  );

  CREATE INDEX IF NOT EXISTS idx_whatsapp_messages_chat_time
    ON whatsapp_messages(chat_jid, timestamp DESC);

  CREATE INDEX IF NOT EXISTS idx_whatsapp_chats_last_message
    ON whatsapp_chats(last_message_at DESC);
`);

const acquisitionStages = [
  ["new", "Novo", 0, 0, 0],
  ["contacted", "Contatado", 1, 0, 0],
  ["responded", "Respondeu", 2, 0, 0],
  ["triage_scheduled", "Triagem agendada", 3, 0, 0],
  ["proposal_scheduled", "Proposta agendada", 4, 0, 0],
  ["proposal_sent", "Proposta apresentada/enviada", 5, 0, 0],
  ["negotiation", "Negociação", 6, 0, 0],
  ["future_interest", "Adiado / Futuro interesse", 7, 0, 0],
  ["closed", "Fechado", 8, 1, 0],
  ["lost", "Perdido", 9, 0, 1],
];

const insertAcquisitionStage = db.prepare(`
  INSERT OR IGNORE INTO acquisition_stages (stage_key, name, position, is_won, is_lost)
  VALUES (?, ?, ?, ?, ?)
`);
acquisitionStages.forEach((stage) => insertAcquisitionStage.run(...stage));
db.prepare("UPDATE acquisition_stages SET position = 8 WHERE stage_key = 'closed'").run();
db.prepare("UPDATE acquisition_stages SET position = 9 WHERE stage_key = 'lost'").run();

db.exec(`
  INSERT INTO prospect_stage_history (prospect_id, stage_id, stage_key, stage_name, entered_at)
  SELECT p.id, s.id, s.stage_key, s.name, p.created_at
  FROM prospects p
  JOIN acquisition_stages s ON s.id = p.stage_id
  WHERE NOT EXISTS (
    SELECT 1 FROM prospect_stage_history h WHERE h.prospect_id = p.id
  );

  INSERT OR IGNORE INTO acquisition_sources (name)
  SELECT DISTINCT TRIM(source) FROM prospects
  WHERE TRIM(source) <> ''
    AND lower(TRIM(source)) NOT LIKE 'http://%'
    AND lower(TRIM(source)) NOT LIKE 'https://%'
    AND lower(TRIM(source)) NOT LIKE 'www.%';

  DELETE FROM acquisition_sources
  WHERE lower(name) = lower('https://engenharmoclimatizacao.com/empresa/');

  INSERT OR IGNORE INTO acquisition_sources (name)
  VALUES ('Prospecção Ativa');
`);


function addColumnIfMissing(
  tableName,
  columnName,
  definition
) {
  const columns = db
    .prepare(`PRAGMA table_info(${tableName})`)
    .all();

  const exists = columns.some(
    (column) => column.name === columnName
  );

  if (!exists) {
    db.exec(`
      ALTER TABLE ${tableName}
      ADD COLUMN ${columnName} ${definition}
    `);
  }
}

addColumnIfMissing(
  "clients",
  "currency",
  "TEXT NOT NULL DEFAULT 'BRL'"
);

addColumnIfMissing(
  "clients",
  "last_synced_at",
  "TEXT"
);

addColumnIfMissing(
  "clients",
  "origin",
  "TEXT NOT NULL DEFAULT ''"
);

addColumnIfMissing(
  "clients",
  "payment_method",
  "TEXT NOT NULL DEFAULT 'auto'"
);

addColumnIfMissing("clients", "monthly_fee", "REAL");
addColumnIfMissing("clients", "billing_day", "INTEGER");
addColumnIfMissing("clients", "first_payment_date", "TEXT");
addColumnIfMissing("clients", "entry_date", "TEXT");
addColumnIfMissing("clients", "exit_date", "TEXT");
db.exec(`
  CREATE INDEX IF NOT EXISTS idx_clients_origin_name
  ON clients(origin, name);
`);

db.exec(`
  UPDATE clients
  SET entry_date = date(created_at)
  WHERE entry_date IS NULL
    AND created_at IS NOT NULL;
`);

addColumnIfMissing(
  "overview_cache",
  "balance_known",
  "INTEGER NOT NULL DEFAULT 1"
);

addColumnIfMissing(
  "overview_cache",
  "is_prepay_account",
  "INTEGER NOT NULL DEFAULT 0"
);

addColumnIfMissing("prospects", "loss_reason", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("prospects", "next_action_start_time", "TEXT");
addColumnIfMissing("prospects", "next_action_end_time", "TEXT");
addColumnIfMissing("client_demands", "start_time", "TEXT");
addColumnIfMissing("client_demands", "end_time", "TEXT");
addColumnIfMissing("prospect_stage_history", "is_estimated", "INTEGER NOT NULL DEFAULT 0");
addColumnIfMissing("prospect_interactions", "script_id", "INTEGER");
addColumnIfMissing("prospect_interactions", "script_name", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("prospect_interactions", "message_content", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("prospect_interactions", "whatsapp_message_id", "TEXT");
addColumnIfMissing("prospect_interactions", "whatsapp_chat_jid", "TEXT NOT NULL DEFAULT ''");
addColumnIfMissing("prospect_interactions", "message_sent_at", "INTEGER");
addColumnIfMissing("acquisition_automation_rules", "next_action", "TEXT NOT NULL DEFAULT ''");
db.exec(`
  CREATE UNIQUE INDEX IF NOT EXISTS idx_prospect_interaction_whatsapp_message
  ON prospect_interactions(whatsapp_message_id)
  WHERE whatsapp_message_id IS NOT NULL;
`);

const starterScripts = [
  {
    key: "first-contact",
    name: "Primeiro contato",
    stage: "new",
    action: "Entrar em contato",
    body: "{saudacao}, {nome}! Tudo bem? Vi o trabalho da {empresa} e queria entender se faz sentido conversarmos sobre como posso ajudar vocês.",
  },
  {
    key: "follow-up",
    name: "Follow-up",
    stage: "contacted",
    action: "Follow-up",
    body: "Oi, {nome}! Passando para retomar nossa conversa. Você conseguiu avaliar minha mensagem? Se preferir, podemos combinar um horário rápido.",
  },
  {
    key: "meeting-confirmation",
    name: "Confirmar reunião",
    stage: "responded",
    action: "Confirmar reunião",
    body: "Oi, {nome}! Tudo certo para nossa conversa? Se precisar ajustar o horário, é só me avisar.",
  },
  {
    key: "proposal-send",
    name: "Enviar proposta",
    stage: "proposal_scheduled",
    action: "Enviar proposta",
    body: "Oi, {nome}! Conforme conversamos, estou enviando a proposta para a {empresa}. Se tiver qualquer dúvida, estou à disposição.",
  },
  {
    key: "proposal-follow-up",
    name: "Acompanhar proposta",
    stage: "proposal_sent",
    action: "Follow-up da proposta",
    body: "Oi, {nome}! Conseguiu olhar a proposta que enviei para a {empresa}? Posso esclarecer algum ponto ou ajustar algo para vocês.",
  },
  {
    key: "negotiation-follow-up",
    name: "Acompanhamento da negociação",
    stage: "negotiation",
    action: "Follow-up da proposta",
    body: "Oi, {nome}! Como está a avaliação da proposta para a {empresa}? Se houver algum ponto para alinharmos, posso ajudar.",
  },
  {
    key: "conversation-resumption",
    name: "Retomar conversa",
    stage: "",
    action: "",
    body: "Oi, {nome}! Faz um tempo que não conversamos e gostaria de saber se ainda faz sentido retomarmos o assunto. Como estão as prioridades da {empresa}?",
  },
  {
    key: "prospect-reactivation",
    name: "Reativação de prospect",
    stage: "",
    action: "",
    body: "Oi, {nome}! Estou retomando nosso contato para saber se este é um bom momento para conversarmos sobre a {empresa}. Se preferir, posso falar com você em outra ocasião.",
  },
];
const insertStarterScript = db.prepare(`
  INSERT OR IGNORE INTO acquisition_message_scripts
    (name, stage_key, action, body, is_default, system_key)
  VALUES (?, ?, ?, ?, 1, ?)
`);
for (const script of starterScripts) {
  insertStarterScript.run(script.name, script.stage, script.action, script.body, script.key);
}

const insertAutomationRule = db.prepare(`
  INSERT OR IGNORE INTO acquisition_automation_rules
    (stage_key, action, open_message_modal, recommended_script_id, next_follow_up_days, next_action)
  VALUES (?, ?, 1, ?, 1, ?)
`);
const ruleDefaults = [
  ["new", "Entrar em contato", "first-contact", "Follow-up"],
  ["contacted", "Follow-up", "follow-up", "Follow-up"],
  ["responded", "Confirmar reunião", "meeting-confirmation", "Realizar reunião"],
  ["proposal_scheduled", "Enviar proposta", "proposal-send", "Follow-up da proposta"],
  ["proposal_sent", "Follow-up da proposta", "proposal-follow-up", "Aguardar retorno"],
  ["negotiation", "Follow-up da proposta", "negotiation-follow-up", "Aguardar retorno"],
];
for (const [stageKey, action, scriptKey, nextAction] of ruleDefaults) {
  const script = db.prepare("SELECT id FROM acquisition_message_scripts WHERE system_key = ?").get(scriptKey);
  insertAutomationRule.run(stageKey, action, script?.id || null, nextAction);
}
db.prepare(`
  UPDATE acquisition_automation_rules
  SET next_action = 'Follow-up', updated_at = CURRENT_TIMESTAMP
  WHERE stage_key = 'contacted' AND action = 'Follow-up'
`).run();

db.exec(`
  UPDATE prospect_stage_history
  SET is_estimated = 1
  WHERE stage_key <> 'new'
    AND EXISTS (
      SELECT 1 FROM prospects p
      WHERE p.id = prospect_stage_history.prospect_id
        AND p.created_at = prospect_stage_history.entered_at
    );
`);

function allowClientWithoutMetaAccount() {
  const columns = db
    .prepare(`
      PRAGMA table_info(clients)
    `)
    .all();

  const accountIdColumn =
    columns.find(
      (column) =>
        column.name === "account_id"
    );

  /*
   * Se account_id ainda estiver como
   * NOT NULL, reconstruímos a tabela.
   */
  if (
    !accountIdColumn ||
    accountIdColumn.notnull === 0
  ) {
    return;
  }

  const migrateClients =
    db.transaction(() => {
      db.exec(`
        CREATE TABLE clients_new (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          account_id TEXT UNIQUE,
          name TEXT NOT NULL DEFAULT '',
          logo_url TEXT NOT NULL DEFAULT '',
          active INTEGER NOT NULL DEFAULT 0,
          payment_method TEXT NOT NULL DEFAULT 'auto',
          monthly_fee REAL,
          billing_day INTEGER,
          first_payment_date TEXT,
          entry_date TEXT,
          exit_date TEXT,
          created_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,
          currency TEXT NOT NULL DEFAULT 'BRL',
          last_synced_at TEXT,
          origin TEXT NOT NULL DEFAULT ''
        );

        INSERT INTO clients_new (
          id,
          account_id,
          name,
          logo_url,
          active,
          payment_method,
          monthly_fee,
          billing_day,
          first_payment_date,
          entry_date,
          exit_date,
          created_at,
          updated_at,
          currency,
          last_synced_at,
          origin
        )
        SELECT
          id,
          account_id,
          name,
          logo_url,
          active,
          payment_method,
          monthly_fee,
          billing_day,
          first_payment_date,
          entry_date,
          exit_date,
          created_at,
          updated_at,
          currency,
          last_synced_at,
          origin
        FROM clients;

        DROP TABLE clients;

        ALTER TABLE clients_new
        RENAME TO clients;
      `);
    });

  migrateClients();
}

allowClientWithoutMetaAccount();

db.prepare(`
  INSERT INTO client_relationship_periods (
    client_id,
    started_on,
    ended_on,
    source
  )
  SELECT
    clients.id,
    date(COALESCE(NULLIF(trim(clients.entry_date), ''), clients.created_at)),
    CASE WHEN clients.active = 1 THEN NULL ELSE date(clients.exit_date) END,
    'legacy'
  FROM clients
  WHERE date(COALESCE(NULLIF(trim(clients.entry_date), ''), clients.created_at)) IS NOT NULL
    AND (
      (clients.active = 1 AND clients.exit_date IS NULL)
      OR date(clients.exit_date) >=
        date(COALESCE(NULLIF(trim(clients.entry_date), ''), clients.created_at))
    )
    AND NOT EXISTS (
      SELECT 1
      FROM client_relationship_periods
      WHERE client_relationship_periods.client_id = clients.id
    )
`).run();

export default db;
