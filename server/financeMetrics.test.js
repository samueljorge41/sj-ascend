import test from "node:test";
import assert from "node:assert/strict";
import {
  dueDateForMonth,
  getReceivableStatus,
  isActiveDuringMonth,
  isActiveOnDate,
  isValidMonth,
  monthBounds,
  shiftMonth,
  toCents,
} from "./financeMetrics.js";

test("validates and shifts reference months across year boundaries", () => {
  assert.equal(isValidMonth("2026-01"), true);
  assert.equal(isValidMonth("2026-13"), false);
  assert.equal(shiftMonth("2026-01", -1), "2025-12");
  assert.deepEqual(monthBounds("2024-02"), { start: "2024-02-01", end: "2024-02-29" });
});

test("clamps billing days to the last day of a short month", () => {
  assert.equal(dueDateForMonth("2026-02", 31), "2026-02-28");
  assert.equal(dueDateForMonth("2024-02", 31), "2024-02-29");
  assert.equal(dueDateForMonth("2026-02", 0), null);
});

test("checks relationship periods for deactivation and reactivation windows", () => {
  const periods = [
    { started_on: "2025-01-01", ended_on: "2025-03-31" },
    { started_on: "2025-06-15", ended_on: null },
  ];
  assert.equal(isActiveOnDate(periods, "2025-03-31"), true);
  assert.equal(isActiveOnDate(periods, "2025-04-01"), false);
  assert.equal(isActiveOnDate(periods, "2025-06-15"), true);
  assert.equal(isActiveDuringMonth(periods, "2025-05"), false);
  assert.equal(isActiveDuringMonth(periods, "2025-06"), true);
});

test("calculates partial, paid, and overdue balances in cents", () => {
  assert.equal(toCents(19.995), 2000);
  assert.deepEqual(getReceivableStatus({ expectedAmount: 100, receivedAmount: 35.5, dueDate: "2026-05-10", today: "2026-05-10" }), {
    status: "pending",
    remainingAmount: 64.5,
  });
  assert.deepEqual(getReceivableStatus({ expectedAmount: 100, receivedAmount: 100, dueDate: "2026-05-01", today: "2026-05-20" }), {
    status: "received",
    remainingAmount: 0,
  });
  assert.deepEqual(getReceivableStatus({ expectedAmount: 100, receivedAmount: 20, dueDate: "2026-05-01", today: "2026-05-20" }), {
    status: "overdue",
    remainingAmount: 80,
  });
});
