import express from "express";
import db from "../database/db.js";
import { buildRelationshipReport } from "../relationshipReportMetrics.js";

const router = express.Router();
const REPORT_ORIGIN = "SJ Marketing";

router.get("/", (req, res) => {
  try {
    const clients = db.prepare(`
      SELECT
        id,
        name,
        logo_url,
        origin,
        active,
        entry_date,
        exit_date
      FROM clients
      WHERE origin = ?
      ORDER BY name COLLATE NOCASE ASC, id ASC
    `).all(REPORT_ORIGIN);

    const clientIds = clients.map((client) => client.id);
    const periods = clientIds.length
      ? db.prepare(`
          SELECT
            periods.client_id,
            periods.started_on,
            periods.ended_on,
            periods.source
          FROM client_relationship_periods AS periods
          INNER JOIN clients
            ON clients.id = periods.client_id
          WHERE clients.origin = ?
          ORDER BY periods.client_id, periods.started_on, periods.id
        `).all(REPORT_ORIGIN)
      : [];
    const demands = clientIds.length
      ? db.prepare(`
          SELECT
            demands.id,
            demands.client_id,
            demands.status,
            demands.demand_date,
            demands.created_at,
            date(demands.demand_date) AS completed_on
          FROM client_demands AS demands
          INNER JOIN clients
            ON clients.id = demands.client_id
          WHERE clients.origin = ?
        `).all(REPORT_ORIGIN)
      : [];
    const today = db.prepare("SELECT date('now') AS date").get().date;
    const report = buildRelationshipReport({
      clients,
      periods,
      demands,
      today,
    });

    report.clients = report.clients.map((client) => ({
      ...client,
      logo_url: client.logo_url?.startsWith("/uploads/")
        ? `${req.protocol}://${req.get("host")}${client.logo_url}`
        : client.logo_url,
    }));

    res.json({ report });
  } catch (error) {
    console.error("Erro ao gerar relatório de relacionamento:", error);
    res.status(500).json({
      error: "Não foi possível gerar o relatório de relacionamento.",
    });
  }
});

export default router;
