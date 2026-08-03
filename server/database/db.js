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

    status TEXT NOT NULL DEFAULT 'red',

    updated_at TEXT NOT NULL DEFAULT CURRENT_TIMESTAMP,

    UNIQUE(account_id, since, until)
  );

  CREATE INDEX IF NOT EXISTS idx_overview_cache_period
  ON overview_cache(since, until);

  CREATE INDEX IF NOT EXISTS idx_overview_cache_account
  ON overview_cache(account_id);
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

export default db;