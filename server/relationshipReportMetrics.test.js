import test from "node:test";
import assert from "node:assert/strict";
import { buildRelationshipReport } from "./relationshipReportMetrics.js";

const clients = [
  { id: 1, name: "Cliente ativo", origin: "SJ Marketing", active: 1 },
  { id: 2, name: "Cliente reativado", origin: "SJ Marketing", active: 0 },
  { id: 3, name: "Outro cliente", origin: "Avaloon", active: 1 },
];

const periods = [
  { client_id: 1, started_on: "2026-01-01", ended_on: null, source: "tracked" },
  { client_id: 2, started_on: "2025-01-01", ended_on: "2025-01-31", source: "tracked" },
  { client_id: 2, started_on: "2025-03-01", ended_on: "2025-04-01", source: "tracked" },
  { client_id: 3, started_on: "2020-01-01", ended_on: null, source: "tracked" },
];

const demands = [
  { id: 1, client_id: 1, status: "completed", demand_date: "2026-01-10" },
  { id: 2, client_id: 1, status: "completed", demand_date: "2026-01-20" },
  { id: 3, client_id: 1, status: "completed", demand_date: "2026-03-20" },
  { id: 4, client_id: 1, status: "completed", demand_date: "2026-03-30" },
  { id: 8, client_id: 1, status: "completed", demand_date: "not-a-date" },
  { id: 5, client_id: 1, status: "pending" },
  { id: 6, client_id: 1, status: "in_progress" },
  { id: 7, client_id: 3, status: "completed", demand_date: "2026-03-25" },
];

function createReport(overrides = {}) {
  return buildRelationshipReport({
    clients,
    periods,
    demands,
    today: "2026-03-31",
    ...overrides,
  });
}

test("applies the SJ Marketing scope and calculates relationship averages", () => {
  const report = createReport();

  assert.deepEqual(report.clients.map((client) => client.id), [1, 2]);
  assert.equal(report.summary.general.validPeriodCount, 3);
  assert.equal(report.summary.general.averageDays, 50);
  assert.equal(report.summary.active.averageDays, 89);
  assert.equal(report.summary.inactive.averageDays, 61);
});

test("sums known reactivation periods and sorts the chart by duration", () => {
  const report = createReport();

  assert.equal(report.clients[1].periodCount, 2);
  assert.equal(report.clients[1].accumulatedDurationDays, 61);
  assert.deepEqual(report.chart.map((item) => item.id), [1, 2]);
  assert.equal(report.chart[0].active, true);
  assert.equal(report.chart[1].active, false);
  assert.equal(report.chart[1].durationDays, 61);
  assert.deepEqual(report.chart[1].periods.map((period) => period.durationDays), [30, 31]);
});

test("shows active reactivated clients with accumulated duration split into periods", () => {
  const report = createReport({
    clients: [{ id: 8, name: "Reativado ativo", origin: "SJ Marketing", active: 1 }],
    periods: [
      { client_id: 8, started_on: "2025-01-01", ended_on: "2025-01-31", source: "tracked" },
      { client_id: 8, started_on: "2025-03-01", ended_on: null, source: "tracked" },
    ],
    demands: [],
    today: "2025-03-31",
  });

  assert.equal(report.clients[0].currentDurationDays, 30);
  assert.equal(report.clients[0].accumulatedDurationDays, 60);
  assert.equal(report.chart[0].durationDays, 60);
  assert.deepEqual(report.chart[0].periods.map((period) => period.durationDays), [30, 30]);
});

test("uses the demand date for completed deliveries and counts pending demand", () => {
  const report = createReport();
  const deliveries = report.clients[0].deliveries;

  assert.equal(deliveries.completedThisMonth, 2);
  assert.equal(deliveries.completedLast30Days, 2);
  assert.equal(deliveries.completedWithKnownDate, 4);
  assert.equal(deliveries.completedWithoutKnownDateCount, 1);
  assert.equal(deliveries.lastDeliveryDate, "2026-03-30");
  assert.equal(deliveries.pendingCount, 2);
});

test("averages intervals between consecutive valid completion dates", () => {
  const deliveries = createReport().clients[0].deliveries;
  assert.equal(deliveries.averageDaysBetweenCompletions, 26.333333333333332);
});

test("limits monthly delivery rate to active months with reliable tracking", () => {
  const deliveries = createReport().clients[0].deliveries;
  assert.equal(deliveries.coveredActiveMonths, 3);
  assert.equal(deliveries.coverageFrom, "2026-01-10");
  assert.equal(deliveries.coverageTo, "2026-03-31");
  assert.equal(deliveries.averageCompletedPerMonth, 4 / 3);
});

test("returns insufficient delivery interval data with fewer than two completions", () => {
  const report = createReport({
    demands: [{ id: 1, client_id: 1, status: "completed", demand_date: "2026-03-20" }],
  });

  assert.equal(report.clients[0].deliveries.averageDaysBetweenCompletions, null);
});

test("keeps clients without valid relationship history and reports excluded samples", () => {
  const report = createReport({
    clients: [{ id: 9, name: "Sem histórico", origin: "SJ Marketing", active: 1 }],
    periods: [],
    demands: [{ id: 1, client_id: 9, status: "pending" }],
  });

  assert.equal(report.clients.length, 1);
  assert.equal(report.clients[0].missingRelationshipHistory, true);
  assert.equal(report.clients[0].deliveries.pendingCount, 1);
  assert.equal(report.summary.active.averageDays, null);
  assert.equal(report.summary.active.excludedClientCount, 1);
  assert.deepEqual(report.chart, []);
});

test("does not assign completed demands without a valid demand date", () => {
  const report = createReport({
    demands: [{ id: 1, client_id: 1, status: "completed", demand_date: null }],
  });

  assert.equal(report.clients[0].deliveries.completedWithKnownDate, 0);
  assert.equal(report.clients[0].deliveries.completedWithoutKnownDateCount, 1);
  assert.equal(report.clients[0].deliveries.averageCompletedPerMonth, null);
});

test("a subsequent persisted completion is reflected on the next report calculation", () => {
  const initialDemands = [];
  const subsequentDemands = [
    { id: 1, client_id: 1, status: "completed", demand_date: "2026-03-30" },
  ];
  const make = (currentDemands) => createReport({ demands: currentDemands });

  assert.equal(make(initialDemands).clients[0].deliveries.completedThisMonth, 0);
  assert.equal(make(subsequentDemands).clients[0].deliveries.completedThisMonth, 1);
});
