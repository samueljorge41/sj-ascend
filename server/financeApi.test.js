import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test, { after, before, beforeEach } from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sj-finance-"));
process.env.DATABASE_PATH = path.join(testRoot, "finance.sqlite");
process.env.UPLOADS_PATH = path.join(testRoot, "uploads");

const [{ default: db }, { default: express }, { default: financeRouter }, { default: clientsRouter }] = await Promise.all([
  import("./database/db.js"),
  import("express"),
  import("./routes/finance.js"),
  import("./routes/clients.js"),
]);

let server;
let baseUrl;
let today;
let month;

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/finance", financeRouter);
  app.use("/api/clients", clientsRouter);
  return new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
}

before(async () => {
  today = db.prepare("SELECT date('now') AS date").get().date;
  month = today.slice(0, 7);
  server = await startTestServer();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

beforeEach(() => {
  db.prepare("DELETE FROM clients").run();
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  const tempRootPath = path.resolve(os.tmpdir());
  const resolvedTestRoot = path.resolve(testRoot);
  if (resolvedTestRoot.startsWith(`${tempRootPath}${path.sep}`)) {
    fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
  }
});

function addClient({ name, monthlyFee = 120, billingDay = Number(today.slice(-2)), firstPaymentDate = null, active = 1 }) {
  const clientId = db.prepare(`
    INSERT INTO clients (account_id, name, origin, active, monthly_fee, billing_day, first_payment_date, entry_date)
    VALUES (?, ?, 'SJ Marketing', ?, ?, ?, ?, date(?, '-4 months'))
  `).run(`finance-${name}-${Math.random()}`, name, active, monthlyFee, billingDay, firstPaymentDate, today).lastInsertRowid;
  return clientId;
}

async function getFinance(referenceMonth = month) {
  const response = await fetch(`${baseUrl}/api/finance?month=${referenceMonth}`);
  const data = await response.json();
  assert.equal(response.status, 200, data.error);
  return data.finance;
}

async function sendReceipt(receivableId, amount, receivedOn = today) {
  return fetch(`${baseUrl}/api/finance/${receivableId}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount, received_on: receivedOn }),
  });
}

test("persists partial and complete receipts and edits an existing receipt in place", async () => {
  const clientId = addClient({ name: "Pagamento parcelado" });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-4 months'), 'tracked')
  `).run(clientId, today);

  const initial = await getFinance();
  const row = initial.clients.find((client) => client.client_id === clientId);
  assert.equal(initial.monthlyRevenue, 120);
  assert.equal(initial.activePayingClients, 1);
  assert.equal(initial.totalExpected, 120);
  assert.equal(row.remaining_amount, 120);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM client_monthly_receivables WHERE client_id = ? AND reference_month = ?").get(clientId, month).count, 1);
  await getFinance();
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM client_monthly_receivables WHERE client_id = ? AND reference_month = ?").get(clientId, month).count, 1);

  const partialResponse = await sendReceipt(row.receivable_id, 35.5);
  assert.equal(partialResponse.status, 201);
  const partial = await getFinance();
  const partialRow = partial.clients.find((client) => client.client_id === clientId);
  assert.equal(partial.totalReceived, 35.5);
  assert.equal(partialRow.status, "pending");
  assert.equal(partialRow.received_amount, 35.5);
  assert.equal(partialRow.remaining_amount, 84.5);

  const completionResponse = await sendReceipt(row.receivable_id, 84.5);
  assert.equal(completionResponse.status, 201);
  let completed = await getFinance();
  let completedRow = completed.clients.find((client) => client.client_id === clientId);
  assert.equal(completedRow.status, "received");
  assert.equal(completedRow.remaining_amount, 0);
  assert.equal(completed.totalReceived, 120);

  const overpayment = await sendReceipt(row.receivable_id, 0.01);
  assert.equal(overpayment.status, 400);
  const futureReceipt = await sendReceipt(row.receivable_id, 0.01, "2999-01-01");
  assert.equal(futureReceipt.status, 400);

  const firstReceiptId = completedRow.receipts[0].id;
  const editResponse = await fetch(`${baseUrl}/api/finance/receipts/${firstReceiptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 25, received_on: today }),
  });
  assert.equal(editResponse.status, 200);
  completed = await getFinance();
  completedRow = completed.clients.find((client) => client.client_id === clientId);
  assert.equal(completedRow.status, "pending");
  assert.equal(completedRow.remaining_amount, 10.5);
  assert.equal(completedRow.receipts.length, 2);

  const fixResponse = await fetch(`${baseUrl}/api/finance/receipts/${firstReceiptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 35.5, received_on: today }),
  });
  assert.equal(fixResponse.status, 200);
  completed = await getFinance();
  completedRow = completed.clients.find((client) => client.client_id === clientId);
  assert.equal(completedRow.status, "received");
  assert.equal(completedRow.receipts.length, 2);
});

test("registers the monthly full amount on its due date and allows editing it later", async () => {
  const clientId = addClient({ name: "Registro pela data de vencimento", monthlyFee: 180, billingDay: 31 });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-4 months'), 'tracked')
  `).run(clientId, today);

  const finance = await getFinance(month);
  const row = finance.clients.find((client) => client.client_id === clientId);
  assert.equal(row.expected_amount, 180);

  const response = await sendReceipt(row.receivable_id, row.expected_amount, row.due_date);
  assert.equal(response.status, 201);
  const { receipt } = await response.json();
  assert.equal(receipt.amount, 180);
  assert.equal(receipt.received_on, row.due_date);

  const editResponse = await fetch(`${baseUrl}/api/finance/receipts/${receipt.id}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ amount: 180, received_on: today }),
  });
  assert.equal(editResponse.status, 200);
  const editedFinance = await getFinance(month);
  assert.equal(editedFinance.clients.find((client) => client.client_id === clientId).receipts[0].received_on, today);
});

test("starts recurring finance charges from the first payment date without changing relationship entry history", async () => {
  const previousMonth = db.prepare("SELECT strftime('%Y-%m', date(?, '-1 month')) AS month").get(today).month;
  const twoMonthsAgo = db.prepare("SELECT strftime('%Y-%m', date(?, '-2 months')) AS month").get(today).month;
  const firstPaymentDate = `${previousMonth}-07`;
  const clientId = addClient({ name: "Primeiro pagamento", monthlyFee: 140 });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-4 months'), 'tracked')
  `).run(clientId, today);
  await getFinance(month);

  const updateResponse = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ first_payment_date: firstPaymentDate }),
  });
  assert.equal(updateResponse.status, 200);
  assert.equal(db.prepare("SELECT first_payment_date, billing_day FROM clients WHERE id = ?").get(clientId).first_payment_date, firstPaymentDate);
  assert.equal(db.prepare("SELECT billing_day FROM clients WHERE id = ?").get(clientId).billing_day, 7);

  const beforeFirstPayment = await getFinance(twoMonthsAgo);
  assert.equal(beforeFirstPayment.clients.some((client) => client.client_id === clientId), false);
  assert.equal(beforeFirstPayment.totalExpected, 0);

  const firstPaymentMonth = await getFinance(previousMonth);
  const firstMonthRow = firstPaymentMonth.clients.find((client) => client.client_id === clientId);
  assert.equal(firstMonthRow.first_payment_date, firstPaymentDate);
  assert.equal(firstMonthRow.due_date, firstPaymentDate);
  assert.equal(firstMonthRow.expected_amount, 140);

  const recurringMonth = await getFinance(month);
  const recurringRow = recurringMonth.clients.find((client) => client.client_id === clientId);
  assert.equal(recurringRow.due_date, `${month}-07`);
  assert.equal(recurringRow.expected_amount, 140);
  assert.equal(
    db.prepare("SELECT started_on FROM client_relationship_periods WHERE client_id = ?").get(clientId).started_on,
    db.prepare("SELECT date(?, '-4 months') AS date").get(today).date
  );
});

test("marks overdue balances and respects deactivation and reactivation periods", async () => {
  const clientId = addClient({ name: "Ciclo de cliente", monthlyFee: 95, billingDay: 31 });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-4 months'), 'tracked')
  `).run(clientId, today);
  const previousMonth = db.prepare("SELECT strftime('%Y-%m', date(?, '-1 month')) AS month").get(today).month;
  const previousEnd = db.prepare("SELECT date(?, 'start of month', '-1 day') AS date").get(`${month}-01`).date;

  const previousFinance = await getFinance(previousMonth);
  const previousRow = previousFinance.clients.find((client) => client.client_id === clientId);
  assert.equal(previousRow.status, "overdue");
  assert.equal(previousFinance.totalOverdue, 95);
  const oldReceivableId = previousRow.receivable_id;
  const lateReceiptResponse = await sendReceipt(oldReceivableId, 25, today);
  assert.equal(lateReceiptResponse.status, 201);
  const lateMonth = await getFinance(previousMonth);
  assert.equal(lateMonth.clients.find((client) => client.client_id === clientId).remaining_amount, 70);

  const deactivateResponse = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: false, exit_date: previousEnd }),
  });
  assert.equal(deactivateResponse.status, 200);
  await getFinance(month);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM client_monthly_receivables WHERE client_id = ? AND reference_month = ?").get(clientId, month).count, 0);

  const reactivateResponse = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ active: true, entry_date: today }),
  });
  assert.equal(reactivateResponse.status, 200);
  const currentFinance = await getFinance(month);
  const currentRow = currentFinance.clients.find((client) => client.client_id === clientId);
  assert.equal(currentRow.status, "pending");
  assert.equal(currentRow.expected_amount, 95);
  assert.equal(currentFinance.totalReceived, 25);
  assert.equal(currentFinance.totalReceivedForReference, 0);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM client_monthly_receivables WHERE client_id = ? AND reference_month = ?").get(clientId, month).count, 1);
  assert.equal(db.prepare("SELECT COUNT(*) AS count FROM client_monthly_receivables WHERE id = ?").get(oldReceivableId).count, 1);
  const persistedHistory = await getFinance(previousMonth);
  assert.equal(persistedHistory.clients.find((client) => client.client_id === clientId).receivable_id, oldReceivableId);
});

test("removes stale forecast after the client exit date is corrected to an earlier month", async () => {
  const clientId = addClient({ name: "Saída corrigida", monthlyFee: 120 });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-4 months'), 'tracked')
  `).run(clientId, today);

  const previousMonthEnd = db.prepare("SELECT date(?, 'start of month', '-1 day') AS date").get(`${month}-01`).date;
  const beforeCorrection = await getFinance(month);
  assert.ok(beforeCorrection.clients.some((client) => client.client_id === clientId));
  assert.equal(
    db.prepare("SELECT COUNT(*) AS count FROM client_monthly_receivables WHERE client_id = ? AND reference_month = ?").get(clientId, month).count,
    1
  );

  const updateResponse = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ exit_date: previousMonthEnd }),
  });
  assert.equal(updateResponse.status, 200);

  const afterCorrection = await getFinance(month);
  assert.equal(afterCorrection.clients.some((client) => client.client_id === clientId), false);
  assert.equal(afterCorrection.totalExpected, 0);
  assert.equal(afterCorrection.chart.at(-1).expected, 0);
  assert.equal(afterCorrection.chart.at(-2).expected, 120);
});

test("signals missing billing settings and rejects invalid months and future receipts", async () => {
  const clientId = addClient({ name: "Sem vencimento", monthlyFee: null, billingDay: null });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-1 month'), 'tracked')
  `).run(clientId, today);
  const finance = await getFinance();
  const row = finance.clients.find((client) => client.client_id === clientId);
  assert.equal(row.status, "missing_configuration");
  assert.equal(row.missing_monthly_fee, true);
  assert.equal(row.missing_payment_date, true);
  assert.equal(row.receivable_id, null);

  const invalidMonth = await fetch(`${baseUrl}/api/finance?month=2026-13`);
  assert.equal(invalidMonth.status, 400);
});
