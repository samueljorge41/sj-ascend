const REPORT_ORIGIN = "SJ Marketing";
const ACTIVE_DEMAND_STATUSES = new Set(["pending", "in_progress", "not_done"]);

export function parseReportDate(value) {
  if (!value) return null;
  const date = String(value).slice(0, 10);
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T00:00:00.000Z`);
  return !Number.isNaN(parsed.getTime()) && parsed.toISOString().slice(0, 10) === date
    ? date
    : null;
}

function dayNumber(value) {
  const date = parseReportDate(value);
  return date ? Date.parse(`${date}T00:00:00.000Z`) / 86_400_000 : null;
}

function daysBetween(start, end) {
  const startDay = dayNumber(start);
  const endDay = dayNumber(end);
  return startDay === null || endDay === null || endDay < startDay
    ? null
    : endDay - startDay;
}

function average(values) {
  return values.length
    ? values.reduce((sum, value) => sum + value, 0) / values.length
    : null;
}

function monthKey(value) {
  return value.slice(0, 7);
}

function nextMonth(value) {
  const [year, month] = value.split("-").map(Number);
  const next = new Date(Date.UTC(year, month, 1));
  return next.toISOString().slice(0, 7);
}

function trackedActiveCoverage(periods, trackingStart, today) {
  const months = new Set();
  const intervals = [];
  if (!trackingStart) return { months, from: null, to: null };

  for (const period of periods) {
    const periodEnd = period.endedOn || today;
    const start = period.startedOn > trackingStart ? period.startedOn : trackingStart;
    const end = periodEnd < today ? periodEnd : today;
    if (start > end) continue;
    intervals.push({ start, end });

    let month = monthKey(start);
    const lastMonth = monthKey(end);
    while (month <= lastMonth) {
      months.add(month);
      month = nextMonth(`${month}-01`);
    }
  }

  return {
    months,
    from: intervals.length ? intervals.map((interval) => interval.start).sort()[0] : null,
    to: intervals.length ? intervals.map((interval) => interval.end).sort().at(-1) : null,
  };
}

function isWithinPeriods(date, periods) {
  return periods.some((period) =>
    date >= period.startedOn && date <= (period.endedOn || date)
  );
}

export function buildRelationshipReport({
  clients = [],
  periods = [],
  demands = [],
  today: requestedToday,
}) {
  const today = parseReportDate(requestedToday) || new Date().toISOString().slice(0, 10);
  const eligibleClients = clients
    .filter((client) => client.origin === REPORT_ORIGIN)
    .map((client) => ({ ...client, active: Boolean(client.active) }));
  const eligibleIds = new Set(eligibleClients.map((client) => Number(client.id)));
  const periodsByClient = new Map();
  const demandsByClient = new Map();

  for (const period of periods) {
    const clientId = Number(period.client_id);
    if (!eligibleIds.has(clientId)) continue;

    const startedOn = parseReportDate(period.started_on);
    const endedOn = parseReportDate(period.ended_on);
    if (!startedOn || startedOn > today || (period.ended_on && (!endedOn || endedOn < startedOn || endedOn > today))) {
      continue;
    }

    const clientPeriods = periodsByClient.get(clientId) || [];
    clientPeriods.push({
      startedOn,
      endedOn,
      source: period.source || "legacy",
      durationDays: daysBetween(startedOn, endedOn || today),
    });
    periodsByClient.set(clientId, clientPeriods);
  }

  for (const demand of demands) {
    const clientId = Number(demand.client_id);
    if (!eligibleIds.has(clientId)) continue;
    const clientDemands = demandsByClient.get(clientId) || [];
    clientDemands.push(demand);
    demandsByClient.set(clientId, clientDemands);
  }

  const relationship = eligibleClients.map((client) => {
    const clientDemands = demandsByClient.get(Number(client.id)) || [];
    const clientPeriods = (periodsByClient.get(Number(client.id)) || [])
      .filter((period) => period.endedOn || client.active)
      .sort((a, b) => a.startedOn.localeCompare(b.startedOn));
    const currentPeriod = client.active
      ? [...clientPeriods].reverse().find((period) => !period.endedOn) || null
      : null;
    const closedPeriods = clientPeriods.filter((period) => period.endedOn);
    const accumulatedDays = clientPeriods.reduce((sum, period) => sum + period.durationDays, 0);
    const displayDays = clientPeriods.length ? accumulatedDays : null;
    const demandCoverageStart = clientDemands
      .filter((demand) => demand.status === "completed")
      .map((demand) => parseReportDate(demand.completed_on || demand.demand_date))
      .filter(Boolean)
      .sort()[0] || null;
    const monthlyCoverage = trackedActiveCoverage(clientPeriods, demandCoverageStart, today);
    const completionDatesMissing = [];
    const validCompletions = [];
    let pendingCount = 0;

    for (const demand of clientDemands) {
      if (ACTIVE_DEMAND_STATUSES.has(demand.status)) {
        pendingCount += 1;
      }

      if (demand.status !== "completed") continue;
      const completedOn = parseReportDate(demand.completed_on || demand.demand_date);
      if (!completedOn || (demandCoverageStart && completedOn < demandCoverageStart)) {
        completionDatesMissing.push(demand.id);
        continue;
      }
      if (completedOn > today || !isWithinPeriods(completedOn, clientPeriods)) continue;
      validCompletions.push({ id: demand.id, date: completedOn });
    }

    validCompletions.sort((a, b) => a.date.localeCompare(b.date) || Number(a.id) - Number(b.id));
    const intervals = validCompletions.slice(1).map((completion, index) =>
      daysBetween(validCompletions[index].date, completion.date)
    ).filter((days) => days !== null);
    const currentMonth = today.slice(0, 7);
    const last30Start = new Date(dayNumber(today) * 86_400_000 - 29 * 86_400_000)
      .toISOString().slice(0, 10);
    const completedThisMonth = validCompletions.filter(({ date }) => date.startsWith(currentMonth)).length;
    const completedLast30Days = validCompletions.filter(({ date }) => date >= last30Start).length;
    const coverageMonths = [...monthlyCoverage.months].sort();

    return {
      id: client.id,
      name: client.name || "Cliente sem nome",
      logo_url: client.logo_url || "",
      active: client.active,
      firstEntryDate: clientPeriods[0]?.startedOn || null,
      currentDurationDays: currentPeriod?.durationDays ?? null,
      accumulatedDurationDays: clientPeriods.length ? accumulatedDays : null,
      displayDurationDays: displayDays,
      periodCount: clientPeriods.length,
      hasLegacyHistory: clientPeriods.some((period) => period.source === "legacy"),
      missingRelationshipHistory: clientPeriods.length === 0,
      missingCurrentPeriod: client.active && !currentPeriod,
      activeWithOldExitDate: client.active && Boolean(client.exit_date),
      deliveries: {
        completedThisMonth,
        completedLast30Days,
        averageDaysBetweenCompletions: intervals.length ? average(intervals) : null,
        lastDeliveryDate: validCompletions.at(-1)?.date || null,
        pendingCount,
        completedWithKnownDate: validCompletions.length,
        completedWithoutKnownDateCount: completionDatesMissing.length,
        averageCompletedPerMonth: coverageMonths.length
          ? validCompletions.length / coverageMonths.length
          : null,
        coverageFrom: monthlyCoverage.from,
        coverageTo: monthlyCoverage.to,
        coveredActiveMonths: coverageMonths.length,
      },
    };
  });

  const generalPeriods = relationship.flatMap((client) => {
    const clientPeriods = periodsByClient.get(Number(client.id)) || [];
    return clientPeriods.filter((period) => period.endedOn || client.active)
      .map((period) => period.durationDays);
  });
  const activeDurations = relationship
    .filter((client) => client.active && client.currentDurationDays !== null)
    .map((client) => client.currentDurationDays);
  const inactiveAccumulated = relationship
    .filter((client) => !client.active && client.accumulatedDurationDays !== null)
    .map((client) => client.accumulatedDurationDays);
  const chart = relationship
    .filter((client) => client.displayDurationDays !== null)
    .map((client) => ({
      id: client.id,
      name: client.name,
      active: client.active,
      durationDays: client.displayDurationDays,
      periodCount: client.periodCount,
      periods: (periodsByClient.get(Number(client.id)) || [])
        .filter((period) => period.endedOn || client.active)
        .sort((a, b) => a.startedOn.localeCompare(b.startedOn))
        .map((period) => ({ durationDays: period.durationDays })),
    }))
    .sort((a, b) => b.durationDays - a.durationDays || a.name.localeCompare(b.name, "pt-BR"));

  return {
    asOf: today,
    origin: REPORT_ORIGIN,
    summary: {
      general: {
        averageDays: average(generalPeriods),
        validPeriodCount: generalPeriods.length,
        excludedClientCount: relationship.filter((client) =>
          client.missingRelationshipHistory ||
          (client.active && client.currentDurationDays === null) ||
          (!client.active && client.accumulatedDurationDays === null)
        ).length,
      },
      active: {
        averageDays: average(activeDurations),
        validClientCount: activeDurations.length,
        excludedClientCount: relationship.filter((client) => client.active && client.currentDurationDays === null).length,
      },
      inactive: {
        averageDays: average(inactiveAccumulated),
        validClientCount: inactiveAccumulated.length,
        excludedClientCount: relationship.filter((client) => !client.active && client.accumulatedDurationDays === null).length,
      },
      clientsWithLegacyHistory: relationship.filter((client) => client.hasLegacyHistory).length,
      clientsWithAmbiguousActiveDate: relationship.filter((client) => client.activeWithOldExitDate).length,
      completedWithoutKnownDateCount: relationship.reduce(
        (sum, client) => sum + client.deliveries.completedWithoutKnownDateCount,
        0
      ),
    },
    chart,
    clients: relationship,
  };
}
