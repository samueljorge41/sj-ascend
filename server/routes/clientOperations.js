import express from "express";
import db from "../database/db.js";

const router = express.Router();

const ALLOWED_BALANCE_STATUSES = [
  "",
  "ok",
  "attention",
  "critical",
  "unknown",
];

function isValidClientId(value) {
  const clientId = Number(value);

  return (
    Number.isInteger(clientId) &&
    clientId > 0
  );
}

function normalizeOptionalDate(value) {
  if (
    value === null ||
    value === undefined ||
    value === ""
  ) {
    return null;
  }

  const normalizedValue =
    String(value).trim();

  const validFormat =
    /^\d{4}-\d{2}-\d{2}$/.test(
      normalizedValue
    );

  if (!validFormat) {
    throw new Error(
      "A data deve estar no formato YYYY-MM-DD."
    );
  }

  const parsedDate =
    new Date(
      `${normalizedValue}T12:00:00`
    );

  if (
    Number.isNaN(
      parsedDate.getTime()
    )
  ) {
    throw new Error(
      "Data inválida."
    );
  }

  return normalizedValue;
}

function getClient(clientId) {
  return db
    .prepare(`
      SELECT
        id,
        name
      FROM clients
      WHERE id = ?
    `)
    .get(clientId);
}

function getOperation(clientId) {
  return db
    .prepare(`
      SELECT
        id,
        client_id,
        last_optimization_date,
        next_optimization_date,
        billing_date,
        balance_status,
        balance_note,
        created_at,
        updated_at
      FROM client_operations
      WHERE client_id = ?
    `)
    .get(clientId);
}

function getEmptyOperation(clientId) {
  return {
    id: null,
    client_id: clientId,
    last_optimization_date: null,
    next_optimization_date: null,
    billing_date: null,
    balance_status: "",
    balance_note: "",
    created_at: null,
    updated_at: null,
  };
}

/*
 * Lista os dados operacionais de todos os clientes.
 */
router.get("/", (req, res) => {
  try {
    const operations = db
      .prepare(`
        SELECT
          clients.id AS client_id,
          client_operations.id,
          client_operations.last_optimization_date,
          client_operations.next_optimization_date,
          client_operations.billing_date,
          COALESCE(
            client_operations.balance_status,
            ''
          ) AS balance_status,
          COALESCE(
            client_operations.balance_note,
            ''
          ) AS balance_note,
          client_operations.created_at,
          client_operations.updated_at
        FROM clients

        LEFT JOIN client_operations
          ON client_operations.client_id =
             clients.id

        ORDER BY clients.name ASC
      `)
      .all()
      .map((operation) => ({
        ...operation,
        id:
          operation.id ||
          null,
      }));

    res.json({
      operations,
    });
  } catch (error) {
    console.error(
      "Erro ao listar dados operacionais:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível listar os dados operacionais.",
    });
  }
});

/*
 * Busca os dados operacionais de um cliente.
 */
router.get("/:clientId", (req, res) => {
  try {
    if (
      !isValidClientId(
        req.params.clientId
      )
    ) {
      return res.status(400).json({
        error:
          "ID do cliente inválido.",
      });
    }

    const clientId =
      Number(req.params.clientId);

    const client =
      getClient(clientId);

    if (!client) {
      return res.status(404).json({
        error:
          "Cliente não encontrado.",
      });
    }

    const operation =
      getOperation(clientId) ||
      getEmptyOperation(clientId);

    res.json({
      operation,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar dados operacionais:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível buscar os dados operacionais.",
    });
  }
});

/*
 * Cria ou atualiza os dados operacionais.
 */
router.put("/:clientId", (req, res) => {
  try {
    if (
      !isValidClientId(
        req.params.clientId
      )
    ) {
      return res.status(400).json({
        error:
          "ID do cliente inválido.",
      });
    }

    const clientId =
      Number(req.params.clientId);

    const client =
      getClient(clientId);

    if (!client) {
      return res.status(404).json({
        error:
          "Cliente não encontrado.",
      });
    }

    const existingOperation =
      getOperation(clientId);

    const lastOptimizationDate =
      req.body.last_optimization_date !==
      undefined
        ? normalizeOptionalDate(
            req.body
              .last_optimization_date
          )
        : existingOperation
            ?.last_optimization_date ||
          null;

    const nextOptimizationDate =
      req.body.next_optimization_date !==
      undefined
        ? normalizeOptionalDate(
            req.body
              .next_optimization_date
          )
        : existingOperation
            ?.next_optimization_date ||
          null;

    const billingDate =
      req.body.billing_date !==
      undefined
        ? normalizeOptionalDate(
            req.body.billing_date
          )
        : existingOperation
            ?.billing_date ||
          null;

    const balanceStatus =
      req.body.balance_status !==
      undefined
        ? String(
            req.body.balance_status ||
              ""
          ).trim()
        : existingOperation
            ?.balance_status ||
          "";

    const balanceNote =
      req.body.balance_note !==
      undefined
        ? String(
            req.body.balance_note ||
              ""
          ).trim()
        : existingOperation
            ?.balance_note ||
          "";

    if (
      !ALLOWED_BALANCE_STATUSES.includes(
        balanceStatus
      )
    ) {
      return res.status(400).json({
        error:
          "Situação do saldo inválida.",
      });
    }

    db.prepare(`
      INSERT INTO client_operations (
        client_id,
        last_optimization_date,
        next_optimization_date,
        billing_date,
        balance_status,
        balance_note
      )
      VALUES (
        ?,
        ?,
        ?,
        ?,
        ?,
        ?
      )

      ON CONFLICT(client_id)
      DO UPDATE SET
        last_optimization_date =
          excluded.last_optimization_date,

        next_optimization_date =
          excluded.next_optimization_date,

        billing_date =
          excluded.billing_date,

        balance_status =
          excluded.balance_status,

        balance_note =
          excluded.balance_note,

        updated_at =
          CURRENT_TIMESTAMP
    `).run(
      clientId,
      lastOptimizationDate,
      nextOptimizationDate,
      billingDate,
      balanceStatus,
      balanceNote
    );

    const savedOperation =
      getOperation(clientId);

    res.json({
      operation:
        savedOperation,
    });
  } catch (error) {
    if (
      error.message?.includes(
        "formato YYYY-MM-DD"
      ) ||
      error.message ===
        "Data inválida."
    ) {
      return res.status(400).json({
        error:
          error.message,
      });
    }

    console.error(
      "Erro ao salvar dados operacionais:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível salvar os dados operacionais.",
    });
  }
});

export default router;