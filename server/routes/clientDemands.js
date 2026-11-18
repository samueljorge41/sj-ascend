import express from "express";
import db from "../database/db.js";

const router = express.Router();

const ALLOWED_TYPES = [
  "optimization",
  "analysis",
  "billing",
  "balance_check",
  "meeting",
  "creative",
  "report",
  "pending",
  "follow_up",
  "other",
];

const ALLOWED_STATUSES = [
  "pending",
  "in_progress",
  "completed",
  "not_done",
];

function parsePositiveInteger(value) {
  const parsedValue = Number(value);

  if (
    !Number.isInteger(parsedValue) ||
    parsedValue <= 0
  ) {
    return null;
  }

  return parsedValue;
}

function normalizeRequiredText(
  value,
  fieldName
) {
  const normalizedValue =
    String(value || "").trim();

  if (!normalizedValue) {
    throw new Error(
      `${fieldName} é obrigatório.`
    );
  }

  return normalizedValue;
}

function normalizeOptionalText(value) {
  return String(
    value || ""
  ).trim();
}

function normalizeDate(value) {
  const normalizedValue =
    String(value || "").trim();

  if (
    !/^\d{4}-\d{2}-\d{2}$/.test(
      normalizedValue
    )
  ) {
    throw new Error(
      "A data deve estar no formato YYYY-MM-DD."
    );
  }

  const parsedDate = new Date(
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

function normalizeOptionalTime(value, label) {
  const normalizedValue = String(value || "").trim();
  if (!normalizedValue) return null;
  if (!/^([01]\d|2[0-3]):[0-5]\d$/.test(normalizedValue)) {
    throw new Error(`${label} deve estar no formato HH:MM.`);
  }
  return normalizedValue;
}

function validateTimeRange(startTime, endTime) {
  if ((startTime && !endTime) || (!startTime && endTime)) {
    throw new Error("Informe os horários de início e término.");
  }
  if (startTime && endTime <= startTime) {
    throw new Error("O término deve ser depois do início.");
  }
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

function getDemand(demandId) {
  return db
    .prepare(`
      SELECT
        id,
        client_id,
        title,
        type,
        demand_date,
        start_time,
        end_time,
        observation,
        status,
        created_at,
        updated_at
      FROM client_demands
      WHERE id = ?
    `)
    .get(demandId);
}

/*
 * Recalcula a última otimização do cliente.
 *
 * Considera apenas demandas:
 * tipo = optimization
 * status = completed
 *
 * Usa a maior data concluída.
 */
function recalculateLastOptimization(
  clientId
) {
  const latestOptimization = db
    .prepare(`
      SELECT
        demand_date
      FROM client_demands
      WHERE
        client_id = ?
        AND type = 'optimization'
        AND status = 'completed'
      ORDER BY
        demand_date DESC,
        id DESC
      LIMIT 1
    `)
    .get(clientId);

  db.prepare(`
    INSERT INTO client_operations (
      client_id,
      last_optimization_date
    )
    VALUES (?, ?)

    ON CONFLICT(client_id)
    DO UPDATE SET
      last_optimization_date =
        excluded.last_optimization_date,
      updated_at =
        CURRENT_TIMESTAMP
  `).run(
    clientId,
    latestOptimization
      ?.demand_date ||
      null
  );
}

function isValidationError(error) {
  return (
    error.message?.includes(
      "obrigatório"
    ) ||
    error.message?.includes(
      "formato YYYY-MM-DD"
    ) ||
    error.message?.includes(
      "formato HH:MM"
    ) ||
    error.message ===
      "Data inválida." ||
    error.message ===
      "Informe os horários de início e término." ||
    error.message ===
      "O término deve ser depois do início."
  );
}

/*
 * Lista demandas.
 *
 * Exemplos:
 * /api/client-demands
 * /api/client-demands?client_id=1
 * /api/client-demands?client_id=1&from=2026-08-01&until=2026-08-31
 */
router.get("/", (req, res) => {
  try {
    const clientId =
      req.query.client_id !==
      undefined
        ? parsePositiveInteger(
            req.query.client_id
          )
        : null;

    if (
      req.query.client_id !==
        undefined &&
      !clientId
    ) {
      return res.status(400).json({
        error:
          "ID do cliente inválido.",
      });
    }

    const fromDate =
      req.query.from
        ? normalizeDate(
            req.query.from
          )
        : null;

    const untilDate =
      req.query.until
        ? normalizeDate(
            req.query.until
          )
        : null;

    const conditions = [];
    const parameters = [];

    if (clientId) {
      conditions.push(
        "client_id = ?"
      );

      parameters.push(
        clientId
      );
    }

    if (fromDate) {
      conditions.push(
        "demand_date >= ?"
      );

      parameters.push(
        fromDate
      );
    }

    if (untilDate) {
      conditions.push(
        "demand_date <= ?"
      );

      parameters.push(
        untilDate
      );
    }

    const whereClause =
      conditions.length > 0
        ? `WHERE ${conditions.join(
            " AND "
          )}`
        : "";

    const demands = db
      .prepare(`
        SELECT
          id,
          client_id,
          title,
          type,
          demand_date,
          start_time,
          end_time,
          observation,
          status,
          created_at,
          updated_at
        FROM client_demands
        ${whereClause}
        ORDER BY
          demand_date ASC,
          id ASC
      `)
      .all(...parameters);

    res.json({
      demands,
    });
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({
        error: error.message,
      });
    }

    console.error(
      "Erro ao listar demandas:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível listar as demandas.",
    });
  }
});

/*
 * Busca uma demanda específica.
 */
router.get("/:id", (req, res) => {
  try {
    const demandId =
      parsePositiveInteger(
        req.params.id
      );

    if (!demandId) {
      return res.status(400).json({
        error:
          "ID da demanda inválido.",
      });
    }

    const demand =
      getDemand(demandId);

    if (!demand) {
      return res.status(404).json({
        error:
          "Demanda não encontrada.",
      });
    }

    res.json({
      demand,
    });
  } catch (error) {
    console.error(
      "Erro ao buscar demanda:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível buscar a demanda.",
    });
  }
});

/*
 * Cria uma demanda.
 */
router.post("/", (req, res) => {
  try {
    const clientId =
      parsePositiveInteger(
        req.body.client_id
      );

    if (!clientId) {
      return res.status(400).json({
        error:
          "ID do cliente inválido.",
      });
    }

    const client =
      getClient(clientId);

    if (!client) {
      return res.status(404).json({
        error:
          "Cliente não encontrado.",
      });
    }

    const title =
      normalizeRequiredText(
        req.body.title,
        "O título"
      );

    const type =
      normalizeRequiredText(
        req.body.type,
        "O tipo"
      );

    const demandDate =
      normalizeDate(
        req.body.demand_date
      );

    const observation =
      normalizeOptionalText(
        req.body.observation
      );
    const startTime = normalizeOptionalTime(req.body.start_time, "O início");
    const endTime = normalizeOptionalTime(req.body.end_time, "O término");
    validateTimeRange(startTime, endTime);

    const status =
      req.body.status
        ? String(
            req.body.status
          ).trim()
        : "pending";

    if (
      !ALLOWED_TYPES.includes(
        type
      )
    ) {
      return res.status(400).json({
        error:
          "Tipo de demanda inválido.",
      });
    }

    if (
      !ALLOWED_STATUSES.includes(
        status
      )
    ) {
      return res.status(400).json({
        error:
          "Status da demanda inválido.",
      });
    }

    const result = db
      .prepare(`
        INSERT INTO client_demands (
          client_id,
          title,
          type,
          demand_date,
          start_time,
          end_time,
          observation,
          status
        )
        VALUES (?, ?, ?, ?, ?, ?, ?, ?)
      `)
      .run(
        clientId,
        title,
        type,
        demandDate,
        startTime,
        endTime,
        observation,
        status
      );

    const demand =
      getDemand(
        result.lastInsertRowid
      );

    if (
      type === "optimization"
    ) {
      recalculateLastOptimization(
        clientId
      );
    }

    res.status(201).json({
      demand,
    });
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({
        error: error.message,
      });
    }

    console.error(
      "Erro ao criar demanda:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível criar a demanda.",
    });
  }
});

/*
 * Atualiza demanda.
 *
 * Esta rota será usada para:
 * edição pelo modal;
 * alteração de status;
 * drag and drop;
 * alteração de data.
 */
router.patch("/:id", (req, res) => {
  try {
    const demandId =
      parsePositiveInteger(
        req.params.id
      );

    if (!demandId) {
      return res.status(400).json({
        error:
          "ID da demanda inválido.",
      });
    }

    const existingDemand =
      getDemand(demandId);

    if (!existingDemand) {
      return res.status(404).json({
        error:
          "Demanda não encontrada.",
      });
    }

    const title =
      req.body.title !==
      undefined
        ? normalizeRequiredText(
            req.body.title,
            "O título"
          )
        : existingDemand.title;

    const type =
      req.body.type !==
      undefined
        ? normalizeRequiredText(
            req.body.type,
            "O tipo"
          )
        : existingDemand.type;

    const demandDate =
      req.body.demand_date !==
      undefined
        ? normalizeDate(
            req.body.demand_date
          )
        : existingDemand
            .demand_date;

    const observation =
      req.body.observation !==
      undefined
        ? normalizeOptionalText(
            req.body.observation
          )
        : existingDemand
            .observation;

    const startTime = req.body.start_time !== undefined
      ? normalizeOptionalTime(req.body.start_time, "O início")
      : existingDemand.start_time;
    const endTime = req.body.end_time !== undefined
      ? normalizeOptionalTime(req.body.end_time, "O término")
      : existingDemand.end_time;
    validateTimeRange(startTime, endTime);

    const status =
      req.body.status !==
      undefined
        ? String(
            req.body.status
          ).trim()
        : existingDemand.status;

    if (
      !ALLOWED_TYPES.includes(
        type
      )
    ) {
      return res.status(400).json({
        error:
          "Tipo de demanda inválido.",
      });
    }

    if (
      !ALLOWED_STATUSES.includes(
        status
      )
    ) {
      return res.status(400).json({
        error:
          "Status da demanda inválido.",
      });
    }

    db.prepare(`
      UPDATE client_demands
      SET
        title = ?,
        type = ?,
        demand_date = ?,
        start_time = ?,
        end_time = ?,
        observation = ?,
        status = ?,
        updated_at =
          CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(
      title,
      type,
      demandDate,
      startTime,
      endTime,
      observation,
      status,
      demandId
    );

    const demand =
      getDemand(demandId);

    /*
     * Recalcula quando:
     * antes era otimização;
     * agora é otimização.
     *
     * Isso cobre conclusão, reabertura,
     * alteração de tipo e drag and drop.
     */
    if (
      existingDemand.type ===
        "optimization" ||
      type === "optimization"
    ) {
      recalculateLastOptimization(
        existingDemand.client_id
      );
    }

    res.json({
      demand,
    });
  } catch (error) {
    if (isValidationError(error)) {
      return res.status(400).json({
        error: error.message,
      });
    }

    console.error(
      "Erro ao atualizar demanda:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível atualizar a demanda.",
    });
  }
});

/*
 * Exclui demanda.
 */
router.delete("/:id", (req, res) => {
  try {
    const demandId =
      parsePositiveInteger(
        req.params.id
      );

    if (!demandId) {
      return res.status(400).json({
        error:
          "ID da demanda inválido.",
      });
    }

    const demand =
      getDemand(demandId);

    if (!demand) {
      return res.status(404).json({
        error:
          "Demanda não encontrada.",
      });
    }

    db.prepare(`
      DELETE FROM client_demands
      WHERE id = ?
    `).run(demandId);

    if (
      demand.type ===
      "optimization"
    ) {
      recalculateLastOptimization(
        demand.client_id
      );
    }

    res.json({
      message:
        "Demanda excluída com sucesso.",
      deleted_id:
        demandId,
    });
  } catch (error) {
    console.error(
      "Erro ao excluir demanda:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível excluir a demanda.",
    });
  }
});

export default router;
