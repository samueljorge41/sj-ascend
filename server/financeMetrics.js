export function isValidMonth(value) {
  return /^\d{4}-(0[1-9]|1[0-2])$/.test(String(value || ""));
}

export function shiftMonth(value, amount) {
  if (!isValidMonth(value)) return null;
  const [year, month] = value.split("-").map(Number);
  const date = new Date(Date.UTC(year, month - 1 + amount, 1));
  return date.toISOString().slice(0, 7);
}

export function monthBounds(value) {
  if (!isValidMonth(value)) return null;
  const [year, month] = value.split("-").map(Number);
  const end = new Date(Date.UTC(year, month, 0)).toISOString().slice(0, 10);
  return { start: `${value}-01`, end };
}

export function dueDateForMonth(referenceMonth, billingDay) {
  const bounds = monthBounds(referenceMonth);
  const day = Number(billingDay);
  if (!bounds || !Number.isInteger(day) || day < 1 || day > 31) return null;
  const dueDay = Math.min(day, Number(bounds.end.slice(-2)));
  return `${referenceMonth}-${String(dueDay).padStart(2, "0")}`;
}

export function isActiveOnDate(periods, date) {
  return periods.some((period) =>
    period.started_on <= date && (!period.ended_on || period.ended_on >= date)
  );
}

export function isActiveDuringMonth(periods, referenceMonth) {
  const bounds = monthBounds(referenceMonth);
  if (!bounds) return false;
  return periods.some((period) =>
    period.started_on <= bounds.end && (!period.ended_on || period.ended_on >= bounds.start)
  );
}

export function toCents(value) {
  const number = Number(value);
  return Number.isFinite(number) ? Math.round((number + Number.EPSILON) * 100) : NaN;
}

export function getReceivableStatus({ expectedAmount, receivedAmount, dueDate, today }) {
  const expectedCents = toCents(expectedAmount);
  const receivedCents = toCents(receivedAmount);
  const remainingCents = Math.max(0, expectedCents - receivedCents);
  if (remainingCents === 0) return { status: "received", remainingAmount: 0 };
  return {
    status: dueDate < today ? "overdue" : "pending",
    remainingAmount: remainingCents / 100,
  };
}
