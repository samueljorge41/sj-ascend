import { useEffect, useMemo, useState } from "react";
import {
  AlertCircle, ArrowLeft, Building2, CalendarClock, Check, Clock3,
  MessageSquare, Send, TrendingDown, UserRound, Users,
} from "lucide-react";
import {
  Bar, CartesianGrid, ComposedChart, Line, LineChart, ResponsiveContainer,
  Tooltip, XAxis, YAxis,
} from "recharts";
import KpiCard from "@/components/leads/KpiCard";
import { getProspectAnalytics } from "@/api/prospects";
import { getAcquisitionFunnelCounts } from "@/lib/acquisitionAnalytics";
import { acquisitionBusinessDate } from "@/lib/acquisitionDate";

const DAY_MS = 24 * 60 * 60 * 1000;
const PERIODS = [
  ["today", "Hoje"], ["last_7_days", "Últimos 7 dias"], ["last_30_days", "Últimos 30 dias"], ["last_90_days", "Últimos 90 dias"],
  ["this_month", "Este mês"], ["previous_month", "Mês anterior"], ["last_3_months", "Últimos 3 meses"],
  ["last_6_months", "Últimos 6 meses"], ["this_year", "Este ano"], ["custom", "Personalizado"],
];
const METRICS = [
  { key: "new_stage", label: "Entrada na etapa Novo", color: "hsl(var(--chart-2))", source: "new" },
  { key: "contacts", label: "Contatos realizados", color: "hsl(var(--chart-2))", source: "interactions" },
  { key: "responded", label: "Respostas", color: "hsl(var(--chart-3))", source: "responded" },
  { key: "triage", label: "Triagens agendadas", color: "hsl(var(--chart-4))", source: "triage_scheduled" },
  { key: "proposal_meetings", label: "Propostas agendadas", color: "hsl(var(--chart-5))", source: "proposal_scheduled" },
  { key: "proposals", label: "Propostas apresentadas/enviadas", color: "hsl(var(--chart-1))", source: "proposal_sent" },
  { key: "negotiations", label: "Negociações", color: "hsl(var(--chart-2))", source: "negotiation" },
  { key: "closed", label: "Fechamentos", color: "hsl(var(--chart-3))", source: "closed" },
  { key: "lost", label: "Perdas", color: "hsl(var(--chart-4))", source: "lost" },
];
const FUNNEL_RATE_BASE = {
  contacted: "newStage",
  responded: "contacted",
  triage: "responded",
  proposalScheduled: "triage",
  proposals: "newStage",
  negotiations: "newStage",
  closed: "newStage",
};

const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const toDate = (value) => new Date(`${String(value).slice(0, 10)}T00:00:00Z`);
const dateString = (date) => date.toISOString().slice(0, 10);
const todayString = () => dateString(new Date(`${new Intl.DateTimeFormat("en-CA", { timeZone: "America/Sao_Paulo" }).format(new Date())}T00:00:00Z`));
const shiftDate = (value, amount) => dateString(new Date(toDate(value).getTime() + amount * DAY_MS));
const inRange = (value, range) => {
  const date = acquisitionBusinessDate(value);
  return Boolean(date && date >= range.start && date <= range.end);
};
const dateLabel = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(toDate(value)) : "—";
const percent = (value, total) => total ? `${Math.round((value / total) * 100)}%` : "Sem dados suficientes";
const daysBetween = (from, to) => (toDate(to).getTime() - toDate(from).getTime()) / DAY_MS;

function getRange(period, customStart, customEnd) {
  const today = todayString();
  const current = toDate(today);
  const firstOfMonth = dateString(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 1)));
  const previousMonthEnd = dateString(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth(), 0)));
  const previousMonthStart = dateString(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 1, 1)));
  const starts = {
    today,
    last_7_days: shiftDate(today, -6),
    last_30_days: shiftDate(today, -29),
    last_90_days: shiftDate(today, -89),
    this_month: firstOfMonth,
    previous_month: previousMonthStart,
    last_3_months: dateString(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 2, 1))),
    last_6_months: dateString(new Date(Date.UTC(current.getUTCFullYear(), current.getUTCMonth() - 5, 1))),
    this_year: `${current.getUTCFullYear()}-01-01`,
    custom: customStart || shiftDate(today, -29),
  };
  const end = period === "previous_month" ? previousMonthEnd : period === "custom" ? (customEnd || today) : today;
  const start = starts[period] || starts.last_30_days;
  return { start: start <= end ? start : end, end };
}

function dateParts(dateValue, grouping) {
  const date = toDate(acquisitionBusinessDate(dateValue));
  if (grouping === "week") {
    const mondayOffset = (date.getUTCDay() + 6) % 7;
    const monday = new Date(date.getTime() - mondayOffset * DAY_MS);
    return { key: dateString(monday), label: new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" }).format(monday) };
  }
  if (grouping === "month") {
    return { key: `${date.getUTCFullYear()}-${String(date.getUTCMonth() + 1).padStart(2, "0")}`, label: new Intl.DateTimeFormat("pt-BR", { month: "short", year: "2-digit", timeZone: "UTC" }).format(date) };
  }
  if (grouping === "year") return { key: String(date.getUTCFullYear()), label: String(date.getUTCFullYear()) };
  return { key: dateString(date), label: new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short", timeZone: "UTC" }).format(date) };
}

function getMetricEvents(metric, data, range) {
  const source = METRICS.find((item) => item.key === metric)?.source;
  if (source === "interactions") return data.interactions.filter((item) => inRange(item.interaction_date, range)).map((item) => ({ date: item.interaction_date }));
  return data.stage_events.filter((item) => item.stage_key === source && !item.is_estimated && inRange(item.entered_at, range)).map((item) => ({ date: item.entered_at }));
}

function buildTrendData(metrics, data, range, grouping) {
  const buckets = new Map();
  let cursor = toDate(range.start);
  const end = toDate(range.end);
  while (cursor <= end) {
    const parts = dateParts(dateString(cursor), grouping);
    if (!buckets.has(parts.key)) buckets.set(parts.key, { key: parts.key, label: parts.label, [metrics[0]]: 0, ...(metrics[1] ? { [metrics[1]]: 0 } : {}) });
    cursor = new Date(cursor.getTime() + DAY_MS);
  }
  for (const metric of metrics) {
    for (const event of getMetricEvents(metric, data, range)) {
      const parts = dateParts(event.date, grouping);
      const bucket = buckets.get(parts.key);
      if (bucket) bucket[metric] += 1;
    }
  }
  return [...buckets.values()];
}

function averageDays(data, fromStage, toStage, range) {
  const values = [];
  for (const prospect of data.prospects) {
    const events = data.stage_events
      .filter((event) => event.prospect_id === prospect.id && !event.is_estimated)
      .sort((a, b) => new Date(a.entered_at).getTime() - new Date(b.entered_at).getTime() || a.id - b.id);
    const from = events.find((event) => event.stage_key === fromStage);
    const fromTime = from ? new Date(from.entered_at).getTime() : null;
    const to = fromTime == null ? null : events.find((event) => event.stage_key === toStage && new Date(event.entered_at).getTime() >= fromTime);
    if (from && to && inRange(to.entered_at, range)) {
      const days = daysBetween(from.entered_at, to.entered_at);
      if (days >= 0) values.push(days);
    }
  }
  return values.length ? values.reduce((sum, value) => sum + value, 0) / values.length : null;
}

function MetricCard({ label, value, icon, accentClass }) {
  return <KpiCard label={label} value={value} icon={icon} accentClass={accentClass} />;
}

export default function AcquisitionAnalytics({ onBack }) {
  const [data, setData] = useState({ prospects: [], stage_events: [], interactions: [] });
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [period, setPeriod] = useState("last_30_days");
  const [customStart, setCustomStart] = useState(shiftDate(todayString(), -29));
  const [customEnd, setCustomEnd] = useState(todayString());
  const [trendPeriod, setTrendPeriod] = useState("last_30_days");
  const [trendStart, setTrendStart] = useState(shiftDate(todayString(), -29));
  const [trendEnd, setTrendEnd] = useState(todayString());
  const [grouping, setGrouping] = useState("day");
  const [metrics, setMetrics] = useState(["new_stage"]);

  useEffect(() => {
    let cancelled = false;
    getProspectAnalytics().then((result) => { if (!cancelled) setData(result); })
      .catch((loadError) => { if (!cancelled) setError(loadError.message || "Não foi possível carregar as análises."); })
      .finally(() => { if (!cancelled) setLoading(false); });
    return () => { cancelled = true; };
  }, []);

  const range = useMemo(() => getRange(period, customStart, customEnd), [period, customStart, customEnd]);
  const trendRange = useMemo(() => getRange(trendPeriod, trendStart, trendEnd), [trendPeriod, trendStart, trendEnd]);
  const cohort = useMemo(() => data.prospects.filter((item) => inRange(item.created_at, range)), [data.prospects, range]);

  const periodCounts = useMemo(() => {
    return getAcquisitionFunnelCounts(data.stage_events, range);
  }, [data.stage_events, range]);

  const currentCounts = useMemo(() => {
    const count = (predicate) => data.prospects.filter(predicate).length;
    const contactedStages = new Set(["contacted", "responded", "triage_scheduled", "proposal_scheduled", "proposal_sent", "negotiation"]);
    const meetingStages = new Set(["triage_scheduled", "proposal_scheduled"]);
    const respondedIds = new Set(data.stage_events
      .filter((event) => event.stage_key === "responded" && !event.is_estimated)
      .map((event) => event.prospect_id));
    data.prospects.forEach((prospect) => {
      if (["responded", "triage_scheduled", "proposal_scheduled", "proposal_sent", "negotiation"].includes(prospect.stage_key)) {
        respondedIds.add(prospect.id);
      }
    });
    return {
      total: data.prospects.length,
      newStage: count((prospect) => prospect.stage_key === "new"),
      contacted: count((prospect) => contactedStages.has(prospect.stage_key)),
      responded: respondedIds.size,
      meetings: count((prospect) => meetingStages.has(prospect.stage_key)),
      proposals: count((prospect) => prospect.stage_key === "proposal_sent"),
      negotiations: count((prospect) => prospect.stage_key === "negotiation"),
      closed: count((prospect) => Boolean(prospect.is_won)),
      lost: count((prospect) => Boolean(prospect.is_lost)),
    };
  }, [data.prospects, data.stage_events]);

  const stageSets = useMemo(() => {
    const result = new Map();
    for (const event of data.stage_events) {
      if (event.is_estimated) continue;
      if (!result.has(event.prospect_id)) result.set(event.prospect_id, new Set());
      result.get(event.prospect_id).add(event.stage_key);
    }
    return result;
  }, [data.stage_events]);

  const originRows = useMemo(() => {
    const grouped = new Map();
    const activeIds = new Set(cohort.map((prospect) => prospect.id));
    data.stage_events.forEach((event) => {
      if (!event.is_estimated && inRange(event.entered_at, range)) activeIds.add(event.prospect_id);
    });
    for (const prospect of data.prospects.filter((item) => activeIds.has(item.id))) {
      const key = prospect.source?.trim() || "Sem origem";
      if (!grouped.has(key)) grouped.set(key, { source: key, prospects: 0, responses: 0, meetings: 0, proposals: 0, closed: 0 });
      const row = grouped.get(key);
      row.prospects += 1;
      const stagesForProspect = stageSets.get(prospect.id) || new Set();
      if (stagesForProspect.has("responded")) row.responses += 1;
      if (stagesForProspect.has("triage_scheduled") || stagesForProspect.has("proposal_scheduled")) row.meetings += 1;
      if (stagesForProspect.has("proposal_sent")) row.proposals += 1;
      if (stagesForProspect.has("closed")) row.closed += 1;
    }
    return [...grouped.values()].sort((a, b) => b.closed - a.closed || b.proposals - a.proposals || b.prospects - a.prospects);
  }, [cohort, data.prospects, data.stage_events, range, stageSets]);

  const losses = useMemo(() => {
    const lostIds = new Set(data.stage_events.filter((event) => event.stage_key === "lost" && !event.is_estimated && inRange(event.entered_at, range)).map((event) => event.prospect_id));
    return data.prospects.filter((prospect) => lostIds.has(prospect.id)).sort((a, b) => b.created_at.localeCompare(a.created_at));
  }, [data.prospects, data.stage_events, range]);

  const averageRows = useMemo(() => [
    ["Novo -> Contatado", "new", "contacted"],
    ["Contatado -> Respondeu", "contacted", "responded"],
    ["Respondeu -> Triagem", "responded", "triage_scheduled"],
    ["Triagem -> Proposta", "triage_scheduled", "proposal_sent"],
    ["Proposta -> Negociacao", "proposal_sent", "negotiation"],
    ["Negociacao -> Fechado", "negotiation", "closed"],
  ].map(([label, from, to]) => ({ label, days: averageDays(data, from, to, range) })), [data, range]);

  const trendData = useMemo(() => buildTrendData(metrics, data, trendRange, grouping), [metrics, data, trendRange, grouping]);
  const funnel = [
    ["Novos", periodCounts.newStage], ["Contatados", periodCounts.contacted], ["Respostas", periodCounts.responded],
    ["Triagem agendada", periodCounts.triage], ["Proposta agendada", periodCounts.proposalScheduled],
    ["Proposta enviada", periodCounts.proposals], ["Negociação", periodCounts.negotiations], ["Fechados", periodCounts.closed],
  ];
  const trendMetric = (key) => METRICS.find((item) => item.key === key);
  const changeMetric = (index, value) => setMetrics((current) => {
    if (value === "none") return index === 0 && current[1] ? [current[1]] : current.slice(0, 1);
    if (index === 0) return current[1] && current[1] !== value ? [value, current[1]] : [value];
    return current[0] && current[0] !== value ? [current[0], value] : [value];
  });

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-3 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-medium text-primary">Comercial · Aquisição</p><h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Análises</h1><p className="mt-1 text-sm text-muted-foreground">Eventos do funil registrados no período selecionado.</p></div>
          <button onClick={onBack} className="inline-flex h-10 items-center justify-center gap-2 self-start rounded-md border px-4 text-sm hover:bg-muted"><ArrowLeft className="h-4 w-4" /> Voltar ao pipeline</button>
        </header>

        <section className="grid gap-3 rounded-xl border bg-card p-4 shadow-sm sm:grid-cols-[minmax(190px,240px)_1fr_1fr] sm:items-end">
          <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Período das análises</span><select value={period} onChange={(event) => setPeriod(event.target.value)} className={inputClass}>{PERIODS.filter(([key]) => ["today", "last_7_days", "last_30_days", "last_90_days", "this_month", "previous_month", "last_3_months", "last_6_months", "this_year", "custom"].includes(key)).map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
          {period === "custom" && <><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">De</span><input type="date" value={customStart} max={customEnd} onChange={(event) => setCustomStart(event.target.value)} className={inputClass} /></label><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Até</span><input type="date" value={customEnd} min={customStart} onChange={(event) => setCustomEnd(event.target.value)} className={inputClass} /></label></>}
          <p className="text-xs text-muted-foreground sm:col-span-full">Período: {dateLabel(range.start)} a {dateLabel(range.end)}. Os cartões mostram o estado atual; funil e taxas acompanham os prospects que entraram em Novo no período, e a evolução mostra os eventos por data.</p>
        </section>

        {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}</div>}
        {loading ? <div className="flex h-48 items-center justify-center text-sm text-muted-foreground">Carregando análises...</div> : <>
          <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
            <MetricCard label="Total de prospects" value={currentCounts.total} icon={Building2} accentClass="text-blue-600" />
            <MetricCard label="Novos" value={currentCounts.newStage} icon={Users} accentClass="text-slate-600" />
            <MetricCard label="Contatados" value={currentCounts.contacted} icon={UserRound} accentClass="text-indigo-600" />
            <MetricCard label="Respostas" value={currentCounts.responded} icon={MessageSquare} accentClass="text-sky-600" />
            <MetricCard label="Reuniões" value={currentCounts.meetings} icon={CalendarClock} accentClass="text-violet-600" />
            <MetricCard label="Propostas" value={currentCounts.proposals} icon={Send} accentClass="text-cyan-600" />
            <MetricCard label="Negociações" value={currentCounts.negotiations} icon={Clock3} accentClass="text-amber-600" />
            <MetricCard label="Fechados" value={currentCounts.closed} icon={Check} accentClass="text-emerald-600" />
            <MetricCard label="Perdidos" value={currentCounts.lost} icon={TrendingDown} accentClass="text-rose-600" />
          </section>

          <section className="grid grid-cols-2 gap-3 sm:grid-cols-3 xl:grid-cols-6">
            {[["Taxa de resposta", periodCounts.responded, periodCounts.contacted], ["Taxa de triagem", periodCounts.triage, periodCounts.responded], ["Taxa de proposta agendada", periodCounts.proposalScheduled, periodCounts.triage], ["Taxa de envio da proposta", periodCounts.proposals, periodCounts.proposalScheduled], ["Taxa de negociacao", periodCounts.negotiations, periodCounts.proposals], ["Taxa de fechamento", periodCounts.closed, periodCounts.negotiations]].map(([label, value, total]) => <div key={label} className="rounded-xl border bg-card p-4 shadow-sm"><p className="text-xs font-medium text-muted-foreground">{label}</p><p className="mt-2 text-xl font-bold">{percent(value, total)}</p><p className="mt-1 text-xs text-muted-foreground">{total ? `${value} de ${total}` : "Sem dados suficientes"}</p></div>)}
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4"><h2 className="text-base font-semibold">Funil de conversão</h2><p className="mt-1 text-xs text-muted-foreground">Etapas alcançadas pelos prospects que entraram em Novo no período selecionado.</p></div>
            <div className="space-y-3">{funnel.map(([label, value, key]) => { const max = Math.max(1, ...funnel.map((item) => item[1])); const baseKey = FUNNEL_RATE_BASE[key]; const conversion = baseKey ? percent(value, periodCounts[baseKey]) : ""; return <div key={label} className="grid grid-cols-[110px_1fr_auto] items-center gap-3 text-sm sm:grid-cols-[150px_1fr_auto_auto]"><span className="text-muted-foreground">{label}</span><div className="h-3 overflow-hidden rounded-full bg-muted"><div className="h-full rounded-full bg-primary transition-all" style={{ width: `${Math.max(value ? 3 : 0, (value / max) * 100)}%` }} /></div><span className="min-w-7 text-right font-semibold">{value}</span><span className="hidden min-w-28 text-right text-xs text-muted-foreground sm:block">{conversion}</span></div>; })}</div>
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4"><h2 className="text-base font-semibold">Tempo médio entre etapas</h2><p className="mt-1 text-xs text-muted-foreground">Calculado quando há datas reais para as duas etapas.</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">{averageRows.map((item) => <div key={item.label} className="rounded-lg bg-muted/40 p-3"><p className="text-xs text-muted-foreground">{item.label}</p><p className="mt-1 text-base font-semibold">{item.days == null ? <span className="text-sm font-normal text-muted-foreground">Sem dados suficientes</span> : `${item.days.toFixed(1).replace(".", ",")} dias`}</p></div>)}</div>
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4"><h2 className="text-base font-semibold">Resultados por origem</h2><p className="mt-1 text-xs text-muted-foreground">Prospects criados ou com etapa real nesta janela; os resultados consideram as etapas reais já alcançadas.</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[720px] text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr>{["Origem", "Prospects", "Respostas", "Reuniões", "Propostas", "Fechamentos", "Taxa de fechamento"].map((label) => <th key={label} className="px-3 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y">{originRows.map((row) => <tr key={row.source}><td className="px-3 py-3 font-medium">{row.source}</td><td className="px-3 py-3">{row.prospects}</td><td className="px-3 py-3">{row.responses}</td><td className="px-3 py-3">{row.meetings}</td><td className="px-3 py-3">{row.proposals}</td><td className="px-3 py-3">{row.closed}</td><td className="px-3 py-3">{percent(row.closed, row.prospects)}</td></tr>)}{!originRows.length && <tr><td colSpan={7} className="px-3 py-8 text-center text-sm text-muted-foreground">Sem prospects criados neste período.</td></tr>}</tbody></table></div>
          </section>

          <section className="rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div className="mb-4"><h2 className="text-base font-semibold">Perdidos</h2><p className="mt-1 text-xs text-muted-foreground">Motivos registrados para prospects marcados como perdidos no período.</p></div>
            <div className="overflow-x-auto"><table className="w-full min-w-[460px] text-left text-sm"><thead className="border-b text-xs text-muted-foreground"><tr><th className="px-3 py-3 font-medium">Empresa</th><th className="px-3 py-3 font-medium">Origem</th><th className="px-3 py-3 font-medium">Motivo da perda</th></tr></thead><tbody className="divide-y">{losses.map((item) => <tr key={item.id}><td className="px-3 py-3 font-medium">{item.company_name}</td><td className="px-3 py-3 text-muted-foreground">{item.source || "Sem origem"}</td><td className="px-3 py-3 text-muted-foreground">{item.loss_reason || "Não informado"}</td></tr>)}{!losses.length && <tr><td colSpan={3} className="px-3 py-8 text-center text-sm text-muted-foreground">Nenhum prospect perdido neste período.</td></tr>}</tbody></table></div>
          </section>

          <section className="space-y-4 rounded-xl border bg-card p-4 shadow-sm sm:p-5">
            <div><h2 className="text-base font-semibold">Evolução da prospecção</h2><p className="mt-1 text-xs text-muted-foreground">Compare uma ou duas métricas por período. Barras mostram a primeira; a linha mostra a segunda.</p></div>
            <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Período</span><select value={trendPeriod} onChange={(event) => setTrendPeriod(event.target.value)} className={inputClass}>{PERIODS.map(([key, label]) => <option key={key} value={key}>{label}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Agrupamento</span><select value={grouping} onChange={(event) => setGrouping(event.target.value)} className={inputClass}><option value="day">Dia</option><option value="week">Semana</option><option value="month">Mês</option><option value="year">Ano</option></select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Métrica 1</span><select value={metrics[0] || "new_stage"} onChange={(event) => changeMetric(0, event.target.value)} className={inputClass}>{METRICS.map((metric) => <option key={metric.key} value={metric.key} disabled={metrics[1] === metric.key}>{metric.label}</option>)}</select></label>
              <label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Métrica 2</span><select value={metrics[1] || "none"} onChange={(event) => changeMetric(1, event.target.value)} className={inputClass}><option value="none">Nenhuma</option>{METRICS.map((metric) => <option key={metric.key} value={metric.key} disabled={metrics[0] === metric.key}>{metric.label}</option>)}</select></label>
              {trendPeriod === "custom" && <div className="grid grid-cols-2 gap-2 lg:col-span-2"><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">De</span><input type="date" value={trendStart} max={trendEnd} onChange={(event) => setTrendStart(event.target.value)} className={inputClass} /></label><label className="space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Até</span><input type="date" value={trendEnd} min={trendStart} onChange={(event) => setTrendEnd(event.target.value)} className={inputClass} /></label></div>}
            </div>
            <div className="flex flex-wrap gap-4 text-xs">{metrics.map((key, index) => { const metric = trendMetric(key); return metric && <span key={key} className="inline-flex items-center gap-2 text-muted-foreground"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: metric.color }} />{index === 0 ? "Barras" : "Linha"}: {metric.label}</span>; })}</div>
            <div className="h-[280px] w-full">
              <ResponsiveContainer width="100%" height="100%">
                {metrics.length === 1 ? <LineChart data={trendData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Line type="monotone" dataKey={metrics[0]} name={trendMetric(metrics[0])?.label} stroke={trendMetric(metrics[0])?.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} /></LineChart>
                  : <ComposedChart data={trendData} margin={{ top: 8, right: 12, left: -20, bottom: 0 }}><CartesianGrid strokeDasharray="3 3" vertical={false} /><XAxis dataKey="label" tickLine={false} axisLine={false} minTickGap={24} /><YAxis allowDecimals={false} tickLine={false} axisLine={false} /><Tooltip /><Bar dataKey={metrics[0]} name={trendMetric(metrics[0])?.label} fill={trendMetric(metrics[0])?.color} radius={[3, 3, 0, 0]} maxBarSize={28} /><Line type="monotone" dataKey={metrics[1]} name={trendMetric(metrics[1])?.label} stroke={trendMetric(metrics[1])?.color} strokeWidth={2.5} dot={false} activeDot={{ r: 4 }} /></ComposedChart>}
              </ResponsiveContainer>
            </div>
          </section>
        </>}
      </div>
    </div>
  );
}
