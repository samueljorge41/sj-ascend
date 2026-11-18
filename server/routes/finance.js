import express from "express";
import db from "../database/db.js";
import {
  dueDateForMonth,
  getReceivableStatus,
  isActiveDuringMonth,
  isActiveOnDate,
  isValidMonth,
  monthBounds,
  shiftMonth,
  toCents,
} from "../financeMetrics.js";

const router = express.Router();
const CHART_MONTH_COUNT = 6;

function validDate(value) {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(String(value || ""))) return false;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value;
}

function getToday() {
  return db.prepare("SELECT date('now') AS date").get().date;
}

function getClientPeriods() {
  const periods = db.prepare(`
    SELECT client_id, started_on, ended_on
    FROM client_relationship_periods
    ORDER BY client_id, started_on, id
  `).all();
  const byClient = new Map();
  for (const period of periods) {
    const rows = byClient.get(Number(period.client_id)) || [];
    rows.push(period);
    byClient.set(Number(period.client_id), rows);
  }
  return byClient;
}

function generateReceivables(months, clients, periodsByClient) {
  const insert = db.prepare(`
    INSERT OR IGNORE INTO client_monthly_receivables (
      client_id, reference_month, expected_amount, due_date
    ) VALUES (?, ?, ?, ?)
  `);
  const refreshUnpaidDueDate = db.prepare(`
    UPDATE client_monthly_receivables
    SET due_date = ?, updated_at = CURRENT_TIMESTAMP
    WHERE client_id = ?
      AND reference_month = ?
      AND due_date <> ?
      AND NOT EXISTS (
        SELECT 1
        FROM client_receipts
        WHERE client_receipts.receivable_id = client_monthly_receivables.id
      )
  `);

  const create = db.transaction(() => {
    for (const month of months) {
      for (const client of clients) {
        const amountCents = toCents(client.monthly_fee);
        const paymentDay = client.first_payment_date
          ? Number(client.first_payment_date.slice(-2))
          : client.billing_day;
        const dueDate = dueDateForMonth(month, paymentDay);
        if (!Number.isFinite(amountCents) || amountCents <= 0 || !dueDate) continue;
        if (client.first_payment_date && dueDate < client.first_payment_date) continue;
        if (client.exit_date && dueDate > client.exit_date) continue;
        if (!isActiveOnDate(periodsByClient.get(Number(client.id)) || [], dueDate)) continue;
        insert.run(client.id, month, amountCents / 100, dueDate);
        if (client.first_payment_date) {
          refreshUnpaidDueDate.run(dueDate, client.id, month, dueDate);
        }
      }
    }
  });
  create();
}

function getReceiptInput(body, allowedFutureDate = null) {
  const amountValue = String(body.amount ?? "").trim();
  const amountCents = toCents(amountValue);
  const receivedOn = String(body.received_on || "").trim();
  if (!/^\d+(\.\d{1,2})?$/.test(amountValue) || !Number.isFinite(amountCents) || amountCents <= 0) {
    throw new Error("Informe um valor recebido maior que zero, com até duas casas decimais.");
  }
  if (!validDate(receivedOn)) throw new Error("Informe uma data de recebimento válida.");
  if (receivedOn > getToday() && receivedOn !== allowedFutureDate) {
    throw new Error("A data de recebimento não pode estar no futuro, exceto pelo vencimento da cobrança.");
  }
  return { amount: amountCents / 100, amountCents, receivedOn };
}

router.get("/", (req, res) => {
  try {
    const today = getToday();
    const currentMonth = today.slice(0, 7);
    const month = String(req.query.month || currentMonth);
    if (!isValidMonth(month) || month > currentMonth) {
      return res.status(400).json({ error: "Selecione um mês válido, até o mês atual." });
    }

    const chartMonths = Array.from({ length: CHART_MONTH_COUNT }, (_, index) =>
      shiftMonth(month, index - CHART_MONTH_COUNT + 1)
    );
    const clients = db.prepare(`
      SELECT id, name, logo_url, active, monthly_fee, billing_day, first_payment_date, exit_date
      FROM clients
      ORDER BY name COLLATE NOCASE, id
    `).all();
    const clientsById = new Map(clients.map((client) => [Number(client.id), client]));
    const periodsByClient = getClientPeriods();
    generateReceivables(chartMonths, clients, periodsByClient);

    const storedReceivables = db.prepare(`
      SELECT id, client_id, reference_month, expected_amount, due_date
      FROM client_monthly_receivables
      WHERE reference_month = ?
    `).all(month);
    const receivables = storedReceivables.filter((receivable) => {
      const client = clientsById.get(Number(receivable.client_id));
      return client &&
        isActiveOnDate(periodsByClient.get(Number(receivable.client_id)) || [], receivable.due_date) &&
        (!client.first_payment_date || receivable.due_date >= client.first_payment_date) &&
        (!client.exit_date || receivable.due_date <= client.exit_date);
    });
    const receivableByClient = new Map(receivables.map((item) => [Number(item.client_id), item]));
    const selectedReceivableIds = receivables.map((item) => item.id);
    const receiptsByReceivable = new Map();
    if (selectedReceivableIds.length) {
      const receipts = db.prepare(`
        SELECT receipts.id, receipts.receivable_id, receipts.amount, receipts.received_on
        FROM client_receipts AS receipts
        INNER JOIN client_monthly_receivables AS receivables
          ON receivables.id = receipts.receivable_id
        WHERE receivables.reference_month = ?
          AND receivables.id IN (${selectedReceivableIds.map(() => "?").join(", ")})
        ORDER BY receipts.received_on, receipts.id
      `).all(month, ...selectedReceivableIds);
      for (const receipt of receipts) {
        const rows = receiptsByReceivable.get(Number(receipt.receivable_id)) || [];
        rows.push(receipt);
        receiptsByReceivable.set(Number(receipt.receivable_id), rows);
      }
    }

    const rows = clients.flatMap((client) => {
      const clientId = Number(client.id);
      const clientPeriods = periodsByClient.get(clientId) || [];
      const receivable = receivableByClient.get(clientId);
      const amountCents = toCents(client.monthly_fee);
      const hasFee = Number.isFinite(amountCents) && amountCents > 0;
      const hasPaymentDate = client.first_payment_date
        ? validDate(client.first_payment_date)
        : Number.isInteger(Number(client.billing_day)) && Number(client.billing_day) >= 1 && Number(client.billing_day) <= 31;
      const monthActive = isActiveDuringMonth(clientPeriods, month) &&
        (!client.exit_date || client.exit_date >= monthBounds(month).start);
      if (!receivable && !(monthActive && (!hasFee || !hasPaymentDate))) return [];

      const receipts = receivable ? receiptsByReceivable.get(Number(receivable.id)) || [] : [];
      const receivedCents = receipts.reduce((sum, receipt) => sum + toCents(receipt.amount), 0);
      const receivedAmount = receivedCents / 100;
      const status = receivable
        ? getReceivableStatus({
            expectedAmount: receivable.expected_amount,
            receivedAmount,
            dueDate: receivable.due_date,
            today,
          })
        : null;

      return [{
        client_id: clientId,
        client_name: client.name || "Cliente sem nome",
        logo_url: client.logo_url || "",
        active: Boolean(client.active),
        receivable_id: receivable?.id || null,
        expected_amount: receivable?.expected_amount ?? null,
        monthly_fee: client.monthly_fee,
        billing_day: client.billing_day,
        first_payment_date: client.first_payment_date,
        due_date: receivable?.due_date || null,
        received_amount: receivedAmount,
        remaining_amount: status?.remainingAmount ?? null,
        status: status?.status || "missing_configuration",
        missing_monthly_fee: !hasFee,
        missing_payment_date: !hasPaymentDate,
        receipts,
      }];
    });

    const expectedCents = receivables.reduce((sum, row) => sum + toCents(row.expected_amount), 0);
    const receivedForReferenceCents = rows.reduce((sum, row) => sum + toCents(row.received_amount), 0);
    const outstandingCents = rows.reduce((sum, row) => sum + toCents(row.remaining_amount), 0);
    const overdueCents = rows
      .filter((row) => row.status === "overdue")
      .reduce((sum, row) => sum + toCents(row.remaining_amount), 0);
    const monthStart = monthBounds(month).start;
    const monthEnd = monthBounds(month).end;
    const receivedInCalendarMonthCents = toCents(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM client_receipts
      WHERE received_on >= ? AND received_on <= ?
    `).get(monthStart, monthEnd).total);

    const chartExpected = db.prepare(`
      SELECT reference_month AS month, COALESCE(SUM(expected_amount), 0) AS total
      FROM client_monthly_receivables AS receivables
      WHERE reference_month >= ? AND reference_month <= ?
        AND EXISTS (
          SELECT 1
          FROM client_relationship_periods AS periods
          WHERE periods.client_id = receivables.client_id
            AND periods.started_on <= receivables.due_date
            AND (periods.ended_on IS NULL OR periods.ended_on >= receivables.due_date)
        )
        AND EXISTS (
          SELECT 1
          FROM clients
          WHERE clients.id = receivables.client_id
            AND (clients.first_payment_date IS NULL OR receivables.due_date >= clients.first_payment_date)
        )
        AND EXISTS (
          SELECT 1
          FROM clients
          WHERE clients.id = receivables.client_id
            AND (clients.exit_date IS NULL OR clients.exit_date >= receivables.due_date)
        )
      GROUP BY reference_month
    `).all(chartMonths[0], month);
    const chartReceived = db.prepare(`
      SELECT substr(received_on, 1, 7) AS month, COALESCE(SUM(amount), 0) AS total
      FROM client_receipts
      WHERE received_on >= ? AND received_on <= ?
      GROUP BY substr(received_on, 1, 7)
    `).all(`${chartMonths[0]}-01`, monthEnd);
    const expectedByMonth = new Map(chartExpected.map((item) => [item.month, item.total]));
    const receivedByMonth = new Map(chartReceived.map((item) => [item.month, item.total]));
    const chart = chartMonths.map((chartMonth) => ({
      month: chartMonth,
      expected: expectedByMonth.get(chartMonth) || 0,
      received: receivedByMonth.get(chartMonth) || 0,
    }));

    const monthlyRevenueCents = clients
      .filter((client) => Boolean(client.active) && toCents(client.monthly_fee) > 0)
      .reduce((sum, client) => sum + toCents(client.monthly_fee), 0);
    const activePayingClients = clients.filter(
      (client) => Boolean(client.active) && toCents(client.monthly_fee) > 0
    ).length;

    res.json({
      finance: {
        asOf: today,
        month,
        monthlyRevenue: monthlyRevenueCents / 100,
        activePayingClients,
        totalExpected: expectedCents / 100,
        totalReceived: receivedInCalendarMonthCents / 100,
        totalReceivedForReference: receivedForReferenceCents / 100,
        totalOutstanding: outstandingCents / 100,
        totalOverdue: overdueCents / 100,
        statusTotals: {
          received: receivedForReferenceCents / 100,
          pending: Math.max(0, outstandingCents - overdueCents) / 100,
          overdue: overdueCents / 100,
        },
        clients: rows,
        chart,
      },
    });
  } catch (error) {
    console.error("Erro ao carregar dados financeiros:", error);
    res.status(500).json({ error: "Não foi possível carregar os dados financeiros." });
  }
});

router.post("/:receivableId/receipts", (req, res) => {
  try {
    const receivableId = Number(req.params.receivableId);
    const receivable = Number.isInteger(receivableId) && receivableId > 0
      ? db.prepare("SELECT id, expected_amount, due_date FROM client_monthly_receivables WHERE id = ?").get(receivableId)
      : null;
    if (!receivable) return res.status(404).json({ error: "Cobrança não encontrada." });

    const input = getReceiptInput(req.body || {}, receivable.due_date);
    const receivedCents = toCents(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM client_receipts
      WHERE receivable_id = ?
    `).get(receivableId).total);
    if (input.amountCents + receivedCents > toCents(receivable.expected_amount)) {
      return res.status(400).json({ error: "O valor excede o saldo restante desta cobrança." });
    }

    const result = db.prepare(`
      INSERT INTO client_receipts (receivable_id, amount, received_on)
      VALUES (?, ?, ?)
    `).run(receivableId, input.amount, input.receivedOn);
    const receipt = db.prepare("SELECT id, receivable_id, amount, received_on FROM client_receipts WHERE id = ?").get(result.lastInsertRowid);
    res.status(201).json({ receipt });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível registrar o recebimento." });
  }
});

router.patch("/receipts/:receiptId", (req, res) => {
  try {
    const receiptId = Number(req.params.receiptId);
    const existing = Number.isInteger(receiptId) && receiptId > 0
      ? db.prepare(`
          SELECT receipts.id, receipts.receivable_id, receivables.expected_amount, receivables.due_date
          FROM client_receipts AS receipts
          INNER JOIN client_monthly_receivables AS receivables
            ON receivables.id = receipts.receivable_id
          WHERE receipts.id = ?
        `).get(receiptId)
      : null;
    if (!existing) return res.status(404).json({ error: "Recebimento não encontrado." });

    const input = getReceiptInput(req.body || {}, existing.due_date);
    const otherReceivedCents = toCents(db.prepare(`
      SELECT COALESCE(SUM(amount), 0) AS total
      FROM client_receipts
      WHERE receivable_id = ? AND id <> ?
    `).get(existing.receivable_id, receiptId).total);
    if (input.amountCents + otherReceivedCents > toCents(existing.expected_amount)) {
      return res.status(400).json({ error: "O valor excede o saldo restante desta cobrança." });
    }

    db.prepare(`
      UPDATE client_receipts
      SET amount = ?, received_on = ?, updated_at = CURRENT_TIMESTAMP
      WHERE id = ?
    `).run(input.amount, input.receivedOn, receiptId);
    const receipt = db.prepare("SELECT id, receivable_id, amount, received_on FROM client_receipts WHERE id = ?").get(receiptId);
    res.json({ receipt });
  } catch (error) {
    res.status(400).json({ error: error.message || "Não foi possível editar o recebimento." });
  }
});

export default router;
