export const GROUPINGS = [
  { key: "daily", label: "Diário" },
  { key: "weekly", label: "Semanal" },
  { key: "monthly", label: "Mensal" },
  { key: "quarterly", label: "Trimestral" },
  { key: "semester", label: "Semestral" },
  { key: "yearly", label: "Anual" },
];

function pad(n) {
  return String(n).padStart(2, "0");
}

function isoWeek(dateStr) {
  const d = new Date(dateStr + "T00:00:00");
  const thu = new Date(d);
  thu.setDate(d.getDate() + (4 - (d.getDay() || 7)));
  const yearStart = new Date(thu.getFullYear(), 0, 1);
  const week = Math.ceil(((thu - yearStart) / 86400000 + 1) / 7);
  return { year: thu.getFullYear(), week };
}

export function groupSeries(daily, groupBy) {
  if (!daily) return [];
  if (groupBy === "daily") {
    return daily.map((d) => ({
      ...d,
      label: d.date.slice(8, 10) + "/" + d.date.slice(5, 7),
    }));
  }
  const groups = new Map();
  for (const d of daily) {
    let key, label;
    const y = d.date.slice(0, 4);
    const m = Number(d.date.slice(5, 7));
    if (groupBy === "weekly") {
      const { year, week } = isoWeek(d.date);
      key = `${year}-W${pad(week)}`;
      label = `Sem ${pad(week)}/${year}`;
    } else if (groupBy === "monthly") {
      key = `${y}-${pad(m)}`;
      label = `${pad(m)}/${y}`;
    } else if (groupBy === "quarterly") {
      const q = Math.ceil(m / 3);
      key = `${y}-T${q}`;
      label = `T${q} ${y}`;
    } else if (groupBy === "semester") {
      const s = m <= 6 ? 1 : 2;
      key = `${y}-S${s}`;
      label = `S${s} ${y}`;
    } else if (groupBy === "yearly") {
      key = y;
      label = y;
    } else {
      key = d.date;
      label = d.date;
    }
    if (!groups.has(key)) {
      groups.set(key, {
        key,
        date: d.date,
        label,
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversations: 0,
        leads: 0,
      });
    }
    const g = groups.get(key);
    g.spend += d.spend;
    g.impressions += d.impressions;
    g.clicks += d.clicks;
    g.conversations += d.conversations;
    g.leads += d.leads;
  }
  const arr = [...groups.values()].sort((a, b) => a.date.localeCompare(b.date));
  arr.forEach((g) => {
    g.cost_per_lead = g.leads > 0 ? g.spend / g.leads : 0;
  });
  return arr;
}