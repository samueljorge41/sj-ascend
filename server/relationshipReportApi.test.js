import assert from "node:assert/strict";
import fs from "node:fs";
import path from "node:path";
import os from "node:os";
import test, { after, before } from "node:test";

const testRoot = fs.mkdtempSync(path.join(os.tmpdir(), "sj-relationship-report-"));
process.env.DATABASE_PATH = path.join(testRoot, "report.sqlite");
process.env.UPLOADS_PATH = path.join(testRoot, "uploads");

const [{ default: db }, { default: express }, { default: clientsRouter }, { default: demandsRouter }, { default: reportRouter }] = await Promise.all([
  import("./database/db.js"),
  import("express"),
  import("./routes/clients.js"),
  import("./routes/clientDemands.js"),
  import("./routes/relationshipReports.js"),
]);

let server;
let baseUrl;
let today;

async function startTestServer() {
  const app = express();
  app.use(express.json());
  app.use("/api/clients", clientsRouter);
  app.use("/api/client-demands", demandsRouter);
  app.use("/api/relationship-reports", reportRouter);
  const listener = await new Promise((resolve) => {
    const listener = app.listen(0, "127.0.0.1", () => resolve(listener));
  });
  return listener;
}

before(async () => {
  today = db.prepare("SELECT date('now') AS date").get().date;
  server = await startTestServer();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
});

after(async () => {
  if (server) await new Promise((resolve) => server.close(resolve));
  db.close();
  const tempRoot = path.resolve(os.tmpdir());
  const resolvedTestRoot = path.resolve(testRoot);
  if (resolvedTestRoot.startsWith(`${tempRoot}${path.sep}`)) {
    fs.rmSync(resolvedTestRoot, { recursive: true, force: true });
  }
});

function addClient({ name, origin = "SJ Marketing", active = 1, entryDate = today, exitDate = null }) {
  return db.prepare(`
    INSERT INTO clients (account_id, name, origin, active, entry_date, exit_date)
    VALUES (?, ?, ?, ?, ?, ?)
  `).run(`test-${name}-${Math.random()}`, name, origin, active, entryDate, exitDate).lastInsertRowid;
}

test("report endpoint filters clients in SQL by SJ Marketing", async () => {
  const includedId = addClient({ name: "SJ incluído" });
  const excludedId = addClient({ name: "Outra origem", origin: "Avaloon" });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, ?, 'tracked'), (?, ?, 'tracked')
  `).run(includedId, today, excludedId, today);

  const response = await fetch(`${baseUrl}/api/relationship-reports`);
  assert.equal(response.status, 200);
  const { report } = await response.json();
  const ids = report.clients.map((client) => client.id);
  assert.ok(ids.includes(includedId));
  assert.ok(!ids.includes(excludedId));
});

test("status changes close and open distinct relationship periods", async () => {
  const previousStart = db.prepare("SELECT date('now', '-10 days') AS date").get().date;
  const clientId = addClient({ name: "Reativação de teste", active: 0, entryDate: previousStart, exitDate: previousStart });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, ended_on, source)
    VALUES (?, ?, ?, 'legacy')
  `).run(clientId, previousStart, previousStart);

  const reactivate = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Reativação de teste", active: true, entry_date: previousStart }),
  });
  assert.equal(reactivate.status, 200);
  const current = db.prepare(`
    SELECT started_on, ended_on FROM client_relationship_periods
    WHERE client_id = ? AND ended_on IS NULL
  `).get(clientId);
  assert.deepEqual(current, { started_on: today, ended_on: null });
  assert.equal(db.prepare("SELECT exit_date FROM clients WHERE id = ?").get(clientId).exit_date, null);

  const deactivate = await fetch(`${baseUrl}/api/clients/${clientId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ name: "Reativação de teste", active: false }),
  });
  assert.equal(deactivate.status, 200);
  const savedPeriods = db.prepare(`
    SELECT started_on, ended_on FROM client_relationship_periods
    WHERE client_id = ? ORDER BY id
  `).all(clientId);
  assert.equal(savedPeriods.length, 2);
  assert.equal(savedPeriods[1].started_on, today);
  assert.equal(savedPeriods[1].ended_on, today);

  const refreshed = await fetch(`${baseUrl}/api/relationship-reports`);
  const report = (await refreshed.json()).report;
  assert.equal(report.clients.find((client) => client.id === clientId).active, false);
});

test("completed demands use their demand date after a fresh report request", async () => {
  const clientId = addClient({ name: "Entrega de teste", entryDate: today });
  db.prepare(`
    INSERT INTO client_relationship_periods (client_id, started_on, source)
    VALUES (?, date(?, '-90 days'), 'tracked')
  `).run(clientId, today);
  const oldCompletedId = db.prepare(`
    INSERT INTO client_demands (client_id, title, type, demand_date, status)
    VALUES (?, 'Conclusão antiga', 'report', ?, 'completed')
  `).run(clientId, today).lastInsertRowid;

  const firstReportResponse = await fetch(`${baseUrl}/api/relationship-reports`);
  const firstReport = (await firstReportResponse.json()).report;
  const firstMetrics = firstReport.clients.find((client) => client.id === clientId).deliveries;
  assert.equal(firstMetrics.completedThisMonth, 1);
  assert.equal(firstMetrics.completedWithoutKnownDateCount, 0);

  const createResponse = await fetch(`${baseUrl}/api/client-demands`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({
      client_id: clientId,
      title: "Entrega concluída",
      type: "report",
      demand_date: today,
      status: "completed",
    }),
  });
  assert.equal(createResponse.status, 201);
  const { demand } = await createResponse.json();
  assert.equal(demand.demand_date, today);

  const historicalEdit = await fetch(`${baseUrl}/api/client-demands/${oldCompletedId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ title: "Conclusão antiga editada" }),
  });
  assert.equal(historicalEdit.status, 200);
  assert.equal((await historicalEdit.json()).demand.demand_date, today);

  await new Promise((resolve) => server.close(resolve));
  server = await startTestServer();
  baseUrl = `http://127.0.0.1:${server.address().port}`;
  const refreshedResponse = await fetch(`${baseUrl}/api/relationship-reports`);
  const refreshed = (await refreshedResponse.json()).report;
  const refreshedMetrics = refreshed.clients.find((client) => client.id === clientId).deliveries;
  assert.equal(refreshedMetrics.completedThisMonth, 2);
  assert.equal(refreshedMetrics.completedWithoutKnownDateCount, 0);
  assert.equal(refreshedMetrics.lastDeliveryDate, today);
});
