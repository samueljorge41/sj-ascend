import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar,
  BarChart,
  CartesianGrid,
  ResponsiveContainer,
  Tooltip,
  XAxis,
  YAxis,
} from "recharts";
import { AlertTriangle, Clock3, RefreshCw, Users } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { getRelationshipReport } from "@/api/relationshipReports";

function formatDuration(value) {
  if (value === null || value === undefined || !Number.isFinite(Number(value))) {
    return "Dados insuficientes";
  }

  let days = Math.max(0, Math.round(Number(value)));
  if (days === 0) return "0 dias";
  const years = Math.floor(days / 365);
  days %= 365;
  const months = Math.floor(days / 30);
  const remainingDays = days % 30;
  const parts = [];

  if (years) parts.push(`${years} ${years === 1 ? "ano" : "anos"}`);
  if (months) parts.push(`${months} ${months === 1 ? "mês" : "meses"}`);
  if (remainingDays || parts.length === 0) {
    parts.push(`${remainingDays} ${remainingDays === 1 ? "dia" : "dias"}`);
  }

  return parts.join(" e ");
}

function formatDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}/.test(value)) return "Não disponível";
  const [year, month, day] = value.slice(0, 10).split("-");
  return `${day}/${month}/${year}`;
}

function formatAverage(value, suffix = " dias") {
  if (value === null || value === undefined) return "Dados insuficientes";
  return `${new Intl.NumberFormat("pt-BR", { maximumFractionDigits: 1 }).format(value)}${suffix}`;
}

function SummaryCard({ title, averageDays, count, countLabel, excludedCount, icon: Icon }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardDescription>{title}</CardDescription>
          <CardTitle className="text-2xl">{formatDuration(averageDays)}</CardTitle>
        </div>
        <Icon className="h-5 w-5 text-muted-foreground" aria-hidden="true" />
      </CardHeader>
      <CardContent className="text-xs text-muted-foreground">
        {count} {countLabel}
        {excludedCount > 0 && <p className="mt-1">{excludedCount} sem datas confiáveis, excluídos.</p>}
      </CardContent>
    </Card>
  );
}

function RelationshipBarShape({ x, y, width, height, payload }) {
  const periods = payload.periods || [];
  const totalDays = periods.reduce((sum, period) => sum + period.durationDays, 0);
  if (!periods.length || totalDays <= 0) return null;

  const gap = periods.length > 1 ? Math.min(6, width / (periods.length * 2)) : 0;
  const relationshipWidth = width - gap * (periods.length - 1);
  let left = x;

  return (
    <g>
      {periods.map((period, index) => {
        const segmentWidth = relationshipWidth * period.durationDays / totalDays;
        const segment = (
          <rect
            key={`${payload.id}-${index}`}
            x={left}
            y={y}
            width={segmentWidth}
            height={height}
            rx={Math.min(4, height / 2)}
            fill={payload.active ? "#16a34a" : "#a1a1aa"}
          />
        );
        left += segmentWidth + (index < periods.length - 1 ? gap : 0);
        return segment;
      })}
    </g>
  );
}

function Metric({ label, value, detail }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background px-3 py-2.5">
      <p className="text-xs text-muted-foreground">{label}</p>
      <p className="mt-1 break-words text-base font-semibold">{value}</p>
      {detail && <p className="mt-1 break-words text-xs text-muted-foreground">{detail}</p>}
    </div>
  );
}

function ClientReportCard({ client }) {
  const delivery = client.deliveries;
  const coverage = delivery.coverageFrom && delivery.coverageTo
    ? `${formatDate(delivery.coverageFrom)} – ${formatDate(delivery.coverageTo)} (${delivery.coveredActiveMonths} ${delivery.coveredActiveMonths === 1 ? "mês" : "meses"})`
    : "Sem período ativo acompanhado";

  return (
    <Card className="overflow-hidden">
      <CardHeader className="flex-row items-center gap-3 space-y-0 border-b p-4">
        <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
          {client.logo_url
            ? <img src={client.logo_url} alt={`Logo de ${client.name}`} className="h-full w-full object-contain p-1" />
            : <span className="text-lg font-semibold text-muted-foreground">{client.name.charAt(0).toUpperCase()}</span>}
        </div>
        <div className="min-w-0 flex-1">
          <CardTitle className="break-words text-base">{client.name}</CardTitle>
          <CardDescription className="mt-1 flex items-center gap-2">
            <span className={`h-2 w-2 rounded-full ${client.active ? "bg-emerald-500" : "bg-zinc-400"}`} />
            {client.active ? "Ativo" : "Inativo"}
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent className="space-y-4 p-4">
        <section aria-label="Relacionamento" className="space-y-2">
          <h3 className="text-sm font-semibold">Relacionamento</h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-4">
            {client.active && (
              <Metric label="Relacionamento atual" value={formatDuration(client.currentDurationDays)} />
            )}
            <Metric label="Tempo acumulado" value={formatDuration(client.accumulatedDurationDays)} />
            <Metric label="Primeira entrada registrada" value={formatDate(client.firstEntryDate)} />
            <Metric label="Períodos conhecidos" value={client.periodCount} />
          </div>
          {client.hasLegacyHistory && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              Período consolidado antes do histórico de ativações; reativações antigas podem não estar registradas.
            </p>
          )}
          {client.missingRelationshipHistory && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Sem datas confiáveis para calcular o relacionamento.</p>
          )}
          {client.missingCurrentPeriod && !client.missingRelationshipHistory && (
            <p className="text-xs text-amber-700 dark:text-amber-400">Sem início confiável para o período ativo atual.</p>
          )}
        </section>

        <section aria-label="Entregas e demandas" className="space-y-2">
          <h3 className="text-sm font-semibold">Entregas</h3>
          <div className="grid gap-2 sm:grid-cols-2 xl:grid-cols-3">
            <Metric label="Concluídas no mês atual" value={delivery.completedThisMonth} />
            <Metric label="Concluídas nos últimos 30 dias" value={delivery.completedLast30Days} />
            <Metric label="Média entre conclusões" value={formatAverage(delivery.averageDaysBetweenCompletions)} />
            <Metric label="Média concluída por mês" value={formatAverage(delivery.averageCompletedPerMonth, " demandas/mês")} detail={`Intervalo: ${coverage}`} />
            <Metric label="Última entrega" value={formatDate(delivery.lastDeliveryDate)} />
            <Metric label="Demandas pendentes" value={delivery.pendingCount} />
          </div>
          {delivery.completedWithoutKnownDateCount > 0 && (
            <p className="text-xs text-amber-700 dark:text-amber-400">
              {delivery.completedWithoutKnownDateCount} concluídas sem data real; não entram nos cálculos de entrega.
            </p>
          )}
        </section>
      </CardContent>
    </Card>
  );
}

export default function RelationshipReports() {
  const [report, setReport] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");

  const loadReport = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setReport(await getRelationshipReport());
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar o relatório.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    loadReport();
  }, [loadReport]);

  const chartHeight = useMemo(
    () => Math.max(280, (report?.chart.length || 0) * 38),
    [report?.chart.length]
  );

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-2xl font-bold tracking-tight sm:text-3xl">Relatórios de Relacionamento</h1>
          <p className="mt-1 text-sm text-muted-foreground">
            Clientes SJ Marketing · atualizado em {formatDate(report?.asOf)}
          </p>
        </div>
        <button
          type="button"
          onClick={loadReport}
          disabled={loading}
          className="inline-flex h-10 items-center gap-2 rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted disabled:opacity-60"
        >
          <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          Atualizar
        </button>
      </header>

      {error && (
        <div role="alert" className="flex flex-wrap items-center justify-between gap-3 rounded-lg border border-destructive/30 bg-destructive/5 p-4 text-sm">
          <span>{error}</span>
          <button type="button" onClick={loadReport} className="font-medium underline">Tentar novamente</button>
        </div>
      )}

      {loading && !report ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">Carregando relatório…</div>
      ) : report && (
        <>
          <section aria-label="Indicadores gerais" className="grid gap-3 md:grid-cols-3">
            <SummaryCard title="Tempo médio geral" averageDays={report.summary.general.averageDays} count={report.summary.general.validPeriodCount} countLabel="períodos válidos" excludedCount={report.summary.general.excludedClientCount} icon={Clock3} />
            <SummaryCard title="Tempo médio dos ativos" averageDays={report.summary.active.averageDays} count={report.summary.active.validClientCount} countLabel="clientes ativos considerados" excludedCount={report.summary.active.excludedClientCount} icon={Users} />
            <SummaryCard title="Tempo acumulado dos inativos" averageDays={report.summary.inactive.averageDays} count={report.summary.inactive.validClientCount} countLabel="clientes inativos considerados" excludedCount={report.summary.inactive.excludedClientCount} icon={Clock3} />
          </section>

          {(report.summary.clientsWithLegacyHistory > 0 || report.summary.clientsWithAmbiguousActiveDate > 0 || report.summary.completedWithoutKnownDateCount > 0) && (
            <div className="flex gap-3 rounded-lg border border-amber-500/30 bg-amber-500/5 p-4 text-sm">
              <AlertTriangle className="mt-0.5 h-5 w-5 shrink-0 text-amber-600" />
              <div className="space-y-1 text-muted-foreground">
                {report.summary.clientsWithLegacyHistory > 0 && (
                  <p>{report.summary.clientsWithLegacyHistory} clientes têm datas consolidadas anteriores ao registro de períodos; reativações passadas não podem ser reconstituídas.</p>
                )}
                {report.summary.clientsWithAmbiguousActiveDate > 0 && (
                  <p>{report.summary.clientsWithAmbiguousActiveDate} clientes ativos têm uma data de saída anterior sem período atual confiável; foram excluídos da média de ativos.</p>
                )}
              </div>
            </div>
          )}

          <Card>
            <CardHeader>
              <CardTitle>Tempo de relacionamento por cliente</CardTitle>
              <CardDescription>O comprimento soma os períodos conhecidos; os espaços entre os trechos indicam pausas. Ordenado do maior para o menor.</CardDescription>
            </CardHeader>
            <CardContent>
              {report.chart.length ? (
                <div className="max-h-[560px] overflow-y-auto overflow-x-hidden">
                  <div style={{ height: chartHeight, minWidth: 0 }}>
                    <ResponsiveContainer width="100%" height="100%">
                      <BarChart data={report.chart} layout="vertical" margin={{ top: 4, right: 20, left: 8, bottom: 4 }}>
                        <CartesianGrid horizontal={false} strokeDasharray="3 3" />
                        <XAxis type="number" hide />
                        <YAxis dataKey="name" type="category" width={145} tickLine={false} axisLine={false} tick={{ fontSize: 12 }} interval={0} />
                        <Tooltip
                          formatter={(value) => [formatDuration(value), "Tempo acumulado"]}
                          labelFormatter={(name, payload) => {
                            const client = payload?.[0]?.payload;
                            const periodLabel = client?.periodCount === 1 ? "período" : "períodos";
                            return `${name} · ${client?.active ? "Ativo" : "Inativo"} · ${client?.periodCount} ${periodLabel}`;
                          }}
                        />
                        <Bar dataKey="durationDays" shape={RelationshipBarShape} maxBarSize={22} />
                      </BarChart>
                    </ResponsiveContainer>
                  </div>
                </div>
              ) : (
                <p className="py-8 text-center text-sm text-muted-foreground">Sem períodos com datas confiáveis para exibir.</p>
              )}
              <div className="mt-3 flex flex-wrap gap-4 text-xs text-muted-foreground">
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-emerald-600" />Ativos</span>
                <span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full bg-zinc-400" />Inativos</span>
              </div>
            </CardContent>
          </Card>

          <section aria-label="Relatório individual dos clientes" className="space-y-3">
            <div>
              <h2 className="text-xl font-semibold">Detalhamento por cliente</h2>
              <p className="text-sm text-muted-foreground">{report.clients.length} clientes SJ Marketing</p>
            </div>
            {report.clients.length ? (
              <div className="grid gap-4 xl:grid-cols-2">
                {report.clients.map((client) => <ClientReportCard key={client.id} client={client} />)}
              </div>
            ) : (
              <Card><CardContent className="py-10 text-center text-sm text-muted-foreground">Nenhum cliente SJ Marketing cadastrado.</CardContent></Card>
            )}
          </section>
        </>
      )}
    </div>
  );
}
