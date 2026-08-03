import express from "express";
import db from "../database/db.js";

const router = express.Router();

const ALLOWED_GROUPINGS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semester",
  "yearly",
];

const DEFAULT_GROUPINGS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semester",
  "yearly",
];

function parseGroupings(value) {
  if (!value) {
    return DEFAULT_GROUPINGS;
  }

  try {
    const parsed = JSON.parse(value);

    if (!Array.isArray(parsed)) {
      return DEFAULT_GROUPINGS;
    }

    const validGroupings = parsed.filter(
      (grouping) =>
        ALLOWED_GROUPINGS.includes(grouping)
    );

    return validGroupings.length > 0
      ? validGroupings
      : DEFAULT_GROUPINGS;
  } catch {
    /*
     * Compatibilidade caso algum valor antigo
     * tenha sido salvo separado por vírgulas.
     */
    const validGroupings = String(value)
      .split(",")
      .map((item) => item.trim())
      .filter((grouping) =>
        ALLOWED_GROUPINGS.includes(grouping)
      );

    return validGroupings.length > 0
      ? validGroupings
      : DEFAULT_GROUPINGS;
  }
}

router.get("/", (req, res) => {
  try {
    const settings = db
      .prepare(`
        SELECT
          id,
          groupings,
          created_at,
          updated_at
        FROM settings
        WHERE id = 1
      `)
      .get();

    if (!settings) {
      db.prepare(`
        INSERT INTO settings (
          id,
          groupings,
          created_at,
          updated_at
        )
        VALUES (
          1,
          ?,
          CURRENT_TIMESTAMP,
          CURRENT_TIMESTAMP
        )
      `).run(
        JSON.stringify(DEFAULT_GROUPINGS)
      );

      return res.json({
        settings: {
          id: 1,
          groupings: DEFAULT_GROUPINGS,
          updated_at: null,
        },
      });
    }

    res.json({
      settings: {
        ...settings,
        groupings: parseGroupings(
          settings.groupings
        ),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao carregar configurações:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível carregar as configurações.",
    });
  }
});

router.patch("/", (req, res) => {
  try {
    const { groupings } = req.body;

    if (!Array.isArray(groupings)) {
      return res.status(400).json({
        error:
          "groupings deve ser uma lista.",
      });
    }

    const validGroupings = groupings.filter(
      (grouping) =>
        ALLOWED_GROUPINGS.includes(grouping)
    );

    if (validGroupings.length === 0) {
      return res.status(400).json({
        error:
          "Ao menos um agrupamento deve permanecer ativo.",
      });
    }

    /*
     * Remove duplicações mantendo a ordem.
     */
    const uniqueGroupings = [
      ...new Set(validGroupings),
    ];

    db.prepare(`
      INSERT INTO settings (
        id,
        groupings,
        created_at,
        updated_at
      )
      VALUES (
        1,
        ?,
        CURRENT_TIMESTAMP,
        CURRENT_TIMESTAMP
      )

      ON CONFLICT(id)
      DO UPDATE SET
        groupings = excluded.groupings,
        updated_at = CURRENT_TIMESTAMP
    `).run(
      JSON.stringify(uniqueGroupings)
    );

    const savedSettings = db
      .prepare(`
        SELECT
          id,
          groupings,
          created_at,
          updated_at
        FROM settings
        WHERE id = 1
      `)
      .get();

    res.json({
      settings: {
        ...savedSettings,
        groupings: parseGroupings(
          savedSettings.groupings
        ),
      },
    });
  } catch (error) {
    console.error(
      "Erro ao salvar configurações:",
      error
    );

    res.status(500).json({
      error:
        "Não foi possível salvar as configurações.",
    });
  }
});

export default router;