import React, { useState, useEffect, useMemo } from "react";
import KpiCard from "@/components/leads/KpiCard";
import AccountSelect from "@/components/leads/AccountSelect";
import { useAppData } from "@/components/AppDataProvider";
import { GROUPINGS, groupSeries } from "@/lib/leadsGrouping";

import {
  DATE_RANGES,
  getDateRange,
  todayStr,
  daysAgoStr,
} from "@/lib/dateRanges";

import {
  MessageSquare,
  DollarSign,
  TrendingDown,
  MousePointerClick,
  Eye,
  Percent,
} from "lucide-react";

import {
  ComposedChart,
  Area,
  Bar,
  Line,
  XAxis,
  YAxis,
  CartesianGrid,
  Tooltip,
  ResponsiveContainer,
} from "recharts";

export default function LeadsDashboard() {
  const { accounts, clients, statuses, groupings, loading: loadingAccounts, getCachedInsights, fetchInsights } = useAppData();
  const activeAccounts = accounts.filter((a) => clients[a.id]?.active);
  const [accountId, setAccountId] = useState("");
  const [accountCurrency, setAccountCurrency] = useState("BRL");
  const [range, setRange] =  useState("last_30_days");
  const [customSince, setCustomSince] = useState(daysAgoStr(29));
  const [customUntil, setCustomUntil] = useState(todayStr());
  const [debSince, setDebSince] = useState(daysAgoStr(29));
  const [debUntil, setDebUntil] = useState(todayStr());
  const [groupBy, setGroupBy] = useState("daily");
  const [data, setData] = useState(null);
  const [loadingInsights, setLoadingInsights] = useState(false);
  const [error, setError] = useState("");

  useEffect(() => {
    if (!accountId) {
      const first = accounts.find((a) => clients[a.id]?.active);
      if (first) {
        setAccountId(first.id);
        setAccountCurrency(first.currency || "BRL");
      }
    }
  }, [accountId, accounts, clients]);

  useEffect(() => {
    const t = setTimeout(() => {
      setDebSince(customSince);
      setDebUntil(customUntil);
    }, 600);
    return () => clearTimeout(t);
  }, [customSince, customUntil]);

  useEffect(() => {
    if (groupings.length > 0 && !groupings.includes(groupBy)) {
      setGroupBy(groupings.includes("daily") ? "daily" : groupings[0]);
    }
  }, [groupings, groupBy]);

  useEffect(() => {
    if (!accountId) return;
    let since, until;
    if (range === "custom") {
      if (!debSince || !debUntil) return;
      since = debSince;
      until = debUntil;
    } else {
      const selectedRange =
        getDateRange(range);

      since = selectedRange.since;
      until = selectedRange.until;
    }
    (async () => {
      const cached = getCachedInsights(accountId, since, until);
      if (cached) {
        setData(cached);
        return;
      }
      setLoadingInsights(true);
      setError("");
      setData(null);
      try {
        const d = await fetchInsights(accountId, since, until);
        setData(d);
      } catch (e) {
        setError(e.response?.data?.error || e.message || "Erro ao carregar insights");
      } finally {
        setLoadingInsights(false);
      }
    })();
  }, [accountId, range, debSince, debUntil, getCachedInsights, fetchInsights]);

  const fmtCurrency = useMemo(
    () => (v) =>
      new Intl.NumberFormat("pt-BR", {
        style: "currency",
        currency: accountCurrency,
        maximumFractionDigits: 2,
      }).format(v || 0),
    [accountCurrency]
  );
  const fmtNumber = (v) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));
  const fmtPct = (v) => new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 2 }).format(v || 0) + "%";

  const totals = data?.totals;
  const groupedDaily = useMemo(() => groupSeries(data?.daily, groupBy), [data, groupBy]);
  const availableGroupings = GROUPINGS.filter((g) => groupings.includes(g.key));

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        {/* Header */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Dashboard</h1>
          </div>
          <div className="flex flex-wrap gap-3">
            <AccountSelect
              accounts={activeAccounts}
              value={accountId}
              loading={loadingAccounts}
              statuses={statuses}
              onChange={(acc) => {
                setAccountId(acc.id);
                setAccountCurrency(acc.currency || "BRL");
              }}
            />
            <select
              value={range}
              onChange={(event) =>
                setRange(event.target.value)
              }
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {DATE_RANGES.map((r) => (
                <option key={r.value} value={r.value}>
                  {r.label}
                </option>
              ))}
            </select>
            {range === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customSince}
                  max={customUntil}
                  onChange={(e) => setCustomSince(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
                <span className="text-sm text-muted-foreground">até</span>
                <input
                  type="date"
                  value={customUntil}
                  min={customSince}
                  max={todayStr()}
                  onChange={(e) => setCustomUntil(e.target.value)}
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
                />
              </div>
            )}
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {/* KPIs */}
        {loadingInsights && !totals && (
          <div className="mt-8 flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          </div>
        )}

        {totals && (
          <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
            <KpiCard label="Investimento total" value={fmtCurrency(totals.spend)} sub={`${fmtNumber(totals.impressions)} impressões`} icon={DollarSign} accentClass="text-emerald-600" />
            <KpiCard label="Conversas iniciadas" value={fmtNumber(totals.conversations)} sub={`${fmtNumber(totals.leads)} leads totais`} icon={MessageSquare} accentClass="text-blue-600" />
            <KpiCard label="Custo por lead" value={fmtCurrency(totals.cost_per_lead)} sub="Investimento ÷ leads" icon={TrendingDown} accentClass="text-amber-600" />
            <KpiCard label="Cliques" value={fmtNumber(totals.clicks)} sub={`CTR ${fmtPct(totals.ctr)}`} icon={MousePointerClick} accentClass="text-purple-600" />
            <KpiCard label="Impressões" value={fmtNumber(totals.impressions)} sub={`CPM ${fmtCurrency(totals.cpm)}`} icon={Eye} accentClass="text-slate-600" />
            <KpiCard label="Taxa de cliques (CTR)" value={fmtPct(totals.ctr)} sub="Cliques ÷ impressões" icon={Percent} accentClass="text-rose-600" />
          </div>
        )}

        {/* Grouping selector */}
        {data && (
          <div className="mt-8 flex items-center gap-3">
            <span className="text-sm font-medium text-muted-foreground">Agrupar por:</span>
            <select
              value={groupBy}
              onChange={(e) => setGroupBy(e.target.value)}
              className="h-9 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring"
            >
              {availableGroupings.map((g) => (
                <option key={g.key} value={g.key}>
                  {g.label}
                </option>
              ))}
            </select>
          </div>
        )}

        {/* Chart */}
        {data && (
          <div className="mt-4 rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Investimento x Leads</h2>
            <p className="text-sm text-muted-foreground">Investimento (área) e conversas iniciadas (barras)</p>
            <div className="mt-4 h-80 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={groupedDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" fontSize={12} stroke="hsl(var(--muted-foreground))" />
                  <YAxis yAxisId="left" fontSize={12} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => fmtCurrency(v).replace(/\s/g, "")} width={70} />
                  <YAxis yAxisId="right" orientation="right" fontSize={12} stroke="hsl(var(--muted-foreground))" width={30} />
                  <Tooltip
                    formatter={(value, name) => (name === "Investimento" ? fmtCurrency(value) : fmtNumber(value))}
                    labelFormatter={(l) => l}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Area yAxisId="left" type="monotone" dataKey="spend" name="Investimento" stroke="#10b981" fill="#10b98133" strokeWidth={2} />
                  <Bar yAxisId="right" dataKey="conversations" name="Conversas iniciadas" fill="#3b82f6" radius={[3, 3, 0, 0]} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Cost per lead chart */}
        {data && (
          <div className="mt-6 rounded-xl border bg-card p-5 shadow-sm">
            <h2 className="text-lg font-semibold">Custo por lead ao longo do tempo</h2>
            <div className="mt-4 h-64 w-full">
              <ResponsiveContainer width="100%" height="100%">
                <ComposedChart data={groupedDaily} margin={{ top: 10, right: 10, left: 0, bottom: 0 }}>
                  <CartesianGrid strokeDasharray="3 3" stroke="hsl(var(--border))" />
                  <XAxis dataKey="label" fontSize={12} stroke="hsl(var(--muted-foreground))" />
                  <YAxis fontSize={12} stroke="hsl(var(--muted-foreground))" tickFormatter={(v) => fmtCurrency(v).replace(/\s/g, "")} width={70} />
                  <Tooltip
                    formatter={(value) => fmtCurrency(value)}
                    labelFormatter={(l) => l}
                    contentStyle={{ backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, fontSize: 12 }}
                  />
                  <Line type="monotone" dataKey="cost_per_lead" name="Custo por lead" stroke="#f59e0b" strokeWidth={2} dot={false} />
                </ComposedChart>
              </ResponsiveContainer>
            </div>
          </div>
        )}

        {/* Campaign table */}
        {data && data.campaigns.length > 0 && (
          <div className="mt-6 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="border-b px-5 py-4">
              <h2 className="text-lg font-semibold">Desempenho por campanha</h2>
            </div>
            <div className="overflow-x-auto">
              <table className="w-full text-sm">
                <thead className="bg-muted/50 text-left text-xs uppercase text-muted-foreground">
                  <tr>
                    <th className="px-5 py-3 font-medium">Campanha</th>
                    <th className="px-5 py-3 text-right font-medium">Investimento</th>
                    <th className="px-5 py-3 text-right font-medium">Conversas</th>
                    <th className="px-5 py-3 text-right font-medium">Leads</th>
                    <th className="px-5 py-3 text-right font-medium">Custo/lead</th>
                    <th className="px-5 py-3 text-right font-medium">Cliques</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {data.campaigns.map((c, i) => (
                    <tr key={i} className="hover:bg-muted/30">
                      <td className="max-w-xs truncate px-5 py-3 font-medium">{c.name}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtCurrency(c.spend)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtNumber(c.conversations)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtNumber(c.leads)}</td>
                      <td className="px-5 py-3 text-right tabular-nums">
                        {c.cost_per_lead > 0 ? fmtCurrency(c.cost_per_lead) : "—"}
                      </td>
                      <td className="px-5 py-3 text-right tabular-nums">{fmtNumber(c.clicks)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        )}

        {!loadingAccounts && activeAccounts.length === 0 && !error && (
          <div className="mt-10 rounded-xl border bg-card p-10 text-center text-muted-foreground">
            Nenhum cliente ativo. Acesse Configurações para ativar clientes.
          </div>
        )}
      </div>
    </div>
  );
}