import { useCallback, useEffect, useMemo, useState } from "react";
import {
  Bar, BarChart, CartesianGrid, Cell, Line, LineChart, Pie, PieChart,
  ResponsiveContainer, Tooltip, XAxis, YAxis,
} from "recharts";
import { AlertCircle, CheckCircle2, CircleDollarSign, Pencil, RefreshCw, Search, Users, Wallet } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { createReceipt, getFinance, updateReceipt } from "@/api/finance";

const STATUS_LABELS = {
  received: "Recebido",
  pending: "Pendente",
  overdue: "Atrasado",
  missing_configuration: "Configuração incompleta",
};
const STATUS_STYLES = {
  received: "border-emerald-500/30 bg-emerald-500/10 text-emerald-700 dark:text-emerald-400",
  pending: "border-amber-500/30 bg-amber-500/10 text-amber-700 dark:text-amber-400",
  overdue: "border-destructive/30 bg-destructive/10 text-destructive",
  missing_configuration: "border-border bg-muted text-muted-foreground",
};
const CHART_COLORS = { received: "#16a34a", pending: "#d4a017", overdue: "#dc2626" };
const CLIENT_CHART_COLORS = ["#2563eb", "#8b5cf6", "#0ea5e9", "#f59e0b", "#10b981", "#ef4444", "#d946ef", "#14b8a6", "#f97316", "#6366f1"];
const CHART_TOOLTIP_STYLE = {
  contentStyle: { backgroundColor: "hsl(var(--card))", border: "1px solid hsl(var(--border))", borderRadius: 8, color: "hsl(var(--card-foreground))" },
  itemStyle: { color: "hsl(var(--card-foreground))" },
  labelStyle: { color: "hsl(var(--card-foreground))" },
};

function formatCurrency(value) {
  return new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL" }).format(Number(value) || 0);
}

function formatCompactCurrency(value) {
  return new Intl.NumberFormat("pt-BR", {
    style: "currency",
    currency: "BRL",
    notation: "compact",
    maximumFractionDigits: 1,
  }).format(Number(value) || 0);
}

function formatDate(value) {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return "—";
  const [year, month, day] = value.split("-");
  return `${day}/${month}/${year}`;
}

function formatMonth(value) {
  const [year, month] = value.split("-").map(Number);
  return new Intl.DateTimeFormat("pt-BR", { month: "short", year: "numeric", timeZone: "UTC" })
    .format(new Date(Date.UTC(year, month - 1, 1)));
}

function SummaryCard({ title, value, description, icon: Icon, tone = "" }) {
  return (
    <Card>
      <CardHeader className="flex-row items-start justify-between space-y-0 pb-2">
        <div className="space-y-1">
          <CardDescription>{title}</CardDescription>
          <CardTitle className={`text-xl sm:text-2xl ${tone}`}>{value}</CardTitle>
        </div>
        <Icon aria-hidden="true" className="h-5 w-5 text-muted-foreground" />
      </CardHeader>
      {description && <CardContent className="pt-0 text-xs text-muted-foreground">{description}</CardContent>}
    </Card>
  );
}

function StatusBadge({ status }) {
  return <span className={`inline-flex rounded-full border px-2 py-1 text-xs font-medium ${STATUS_STYLES[status] || STATUS_STYLES.pending}`}>{STATUS_LABELS[status] || status}</span>;
}

export default function Finance() {
  const [month, setMonth] = useState(() => new Date().toISOString().slice(0, 7));
  const [finance, setFinance] = useState(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [search, setSearch] = useState("");
  const [statusFilter, setStatusFilter] = useState("all");
  const [modal, setModal] = useState(null);
  const [saving, setSaving] = useState(false);

  const loadFinance = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      setFinance(await getFinance(month));
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar os dados financeiros.");
    } finally {
      setLoading(false);
    }
  }, [month]);

  useEffect(() => { loadFinance(); }, [loadFinance]);

  const visibleRows = useMemo(() => (finance?.clients || []).filter((row) => {
    const matchesName = row.client_name.toLocaleLowerCase("pt-BR").includes(search.trim().toLocaleLowerCase("pt-BR"));
    return row.status !== "missing_configuration" && matchesName && (statusFilter === "all" || row.status === statusFilter);
  }), [finance?.clients, search, statusFilter]);

  const pieData = useMemo(() => [
    { key: "received", name: "Recebido", value: finance?.statusTotals.received || 0 },
    { key: "pending", name: "Pendente", value: finance?.statusTotals.pending || 0 },
    { key: "overdue", name: "Atrasado", value: finance?.statusTotals.overdue || 0 },
  ].filter((item) => item.value > 0), [finance?.statusTotals]);

  const clientRevenueData = useMemo(() => {
    const clients = (finance?.clients || [])
      .filter((client) => Number(client.expected_amount) > 0)
      .map((client) => ({
        key: client.client_id,
        name: client.client_name,
        value: Number(client.expected_amount),
      }))
      .sort((a, b) => b.value - a.value);
    const total = clients.reduce((sum, client) => sum + client.value, 0);
    return clients.map((client) => ({ ...client, percent: total ? (client.value / total) * 100 : 0 }));
  }, [finance?.clients]);

  function openEdit(row, receipt) {
    setModal({ row, receipt, amount: String(receipt.amount), received_on: receipt.received_on });
  }

  async function registerReceipt(row) {
    if (saving || !row.receivable_id || row.remaining_amount <= 0) return;
    setSaving(true);
    setError("");
    try {
      await createReceipt(row.receivable_id, {
        amount: row.remaining_amount.toFixed(2),
        received_on: row.due_date || finance?.asOf,
      });
      setFinance(await getFinance(month));
    } catch (saveError) {
      setError(saveError.message || "Não foi possível registrar o recebimento.");
    } finally {
      setSaving(false);
    }
  }

  async function saveReceipt(event) {
    event.preventDefault();
    if (!modal) return;
    setSaving(true);
    setError("");
    try {
      const values = { amount: modal.amount, received_on: modal.received_on };
      await updateReceipt(modal.receipt.id, values);
      setModal(null);
      await loadFinance();
    } catch (saveError) {
      setError(saveError.message || "Não foi possível salvar o recebimento.");
    } finally {
      setSaving(false);
    }
  }

  return (
    <div className="mx-auto w-full max-w-7xl space-y-6 p-4 sm:p-6 lg:p-8">
      <header className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <p className="text-sm text-muted-foreground">Negócio</p>
          <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Finanças</h1>
          <p className="mt-1 text-sm text-muted-foreground">Receita contratada e recebimentos confirmados dos clientes.</p>
        </div>
        <div className="flex items-center gap-2">
          <label htmlFor="finance-month" className="text-sm text-muted-foreground">Mês de referência</label>
          <input id="finance-month" type="month" max={finance?.asOf.slice(0, 7) || month} value={month} onChange={(event) => event.target.value && setMonth(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm" />
          <button type="button" onClick={loadFinance} disabled={loading} aria-label="Atualizar dados financeiros" className="inline-flex h-10 w-10 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-60">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
        </div>
      </header>

      {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}</div>}

      {loading ? (
        <div className="rounded-xl border p-10 text-center text-sm text-muted-foreground">Carregando informações financeiras…</div>
      ) : finance && (
        <>
          <section aria-label="Indicadores financeiros" className="grid gap-3 sm:grid-cols-2 xl:grid-cols-5">
            <SummaryCard title="Receita mensal contratada" value={formatCurrency(finance.monthlyRevenue)} description="Mensalidades dos clientes ativos." icon={CircleDollarSign} />
            <SummaryCard title="Total recebido no mês" value={formatCurrency(finance.totalReceived)} description={`Pela data efetiva · competência: ${formatCurrency(finance.totalReceivedForReference)}.`} icon={CheckCircle2} tone="text-emerald-700 dark:text-emerald-400" />
            <SummaryCard title="Total a receber" value={formatCurrency(finance.totalOutstanding)} description={`De ${formatCurrency(finance.totalExpected)} previstos para ${formatMonth(month)}.`} icon={Wallet} />
            <SummaryCard title="Recebimentos em atraso" value={formatCurrency(finance.totalOverdue)} description="Saldo pendente após o vencimento." icon={AlertCircle} tone="text-destructive" />
            <SummaryCard title="Clientes ativos pagantes" value={finance.activePayingClients} description="Clientes ativos com mensalidade maior que zero." icon={Users} />
          </section>
          <p className="-mt-3 text-xs text-muted-foreground">Previsto é cobrança; recebido representa valores confirmados.</p>

          <section aria-label="Acompanhamento por período" className="grid gap-4 xl:grid-cols-2">
            <Card>
              <CardHeader><CardTitle className="text-base">Recebido x previsto</CardTitle><CardDescription>Previsto por competência e recebido pela data efetiva do pagamento.</CardDescription></CardHeader>
              <CardContent>
                <div className="h-64 w-full [--finance-chart-cursor:0_0%_94%] [--finance-chart-expected:0_0%_82%] dark:[--finance-chart-cursor:0_0%_12%] dark:[--finance-chart-expected:0_0%_16%]">
                  <ResponsiveContainer width="100%" height="100%">
                    <BarChart data={finance.chart} barSize={60} barGap={-60} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickFormatter={formatMonth} tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} fontSize={11} />
                      <Tooltip
                        {...CHART_TOOLTIP_STYLE}
                        cursor={{ fill: "hsl(var(--finance-chart-cursor))" }}
                        labelFormatter={formatMonth}
                        formatter={(value, name) => [formatCurrency(value), name === "expected" ? "Previsto" : "Recebido"]}
                      />
                      <Bar dataKey="expected" name="Previsto" fill="hsl(var(--finance-chart-expected))" radius={[4, 4, 0, 0]} />
                      <Bar dataKey="received" name="Recebido" fill="#16a34a" radius={[4, 4, 0, 0]} />
                    </BarChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Evolução dos recebimentos</CardTitle><CardDescription>Valores confirmados agrupados pela data em que foram recebidos.</CardDescription></CardHeader>
              <CardContent>
                <div className="h-64 w-full">
                  <ResponsiveContainer width="100%" height="100%">
                    <LineChart data={finance.chart} margin={{ top: 8, right: 8, left: 8, bottom: 4 }}>
                      <CartesianGrid vertical={false} strokeDasharray="3 3" />
                      <XAxis dataKey="month" tickFormatter={formatMonth} tickLine={false} axisLine={false} fontSize={11} />
                      <YAxis tickFormatter={formatCompactCurrency} tickLine={false} axisLine={false} fontSize={11} />
                      <Tooltip {...CHART_TOOLTIP_STYLE} labelFormatter={formatMonth} formatter={(value) => [formatCurrency(value), "Recebido"]} />
                      <Line dataKey="received" name="Recebido" type="monotone" stroke="#16a34a" strokeWidth={2.5} dot={{ r: 3 }} />
                    </LineChart>
                  </ResponsiveContainer>
                </div>
              </CardContent>
            </Card>

            <Card>
              <CardHeader><CardTitle className="text-base">Situação dos recebimentos · {formatMonth(month)}</CardTitle><CardDescription>Valores aplicados às cobranças da competência selecionada.</CardDescription></CardHeader>
              <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <div className="h-52 w-full max-w-[260px]">
                  {pieData.length ? <ResponsiveContainer width="100%" height="100%"><PieChart><Pie data={pieData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={3}>{pieData.map((entry) => <Cell key={entry.key} fill={CHART_COLORS[entry.key]} />)}</Pie><Tooltip {...CHART_TOOLTIP_STYLE} formatter={(value) => formatCurrency(value)} /></PieChart></ResponsiveContainer> : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem cobranças nesta competência.</div>}
                </div>
                <div className="grid w-full max-w-sm gap-2">
                  {pieData.map((entry) => <div key={entry.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm"><span className="inline-flex items-center gap-2"><span className="h-2.5 w-2.5 rounded-full" style={{ backgroundColor: CHART_COLORS[entry.key] }} />{entry.name}</span><strong>{formatCurrency(entry.value)}</strong></div>)}
                </div>
              </CardContent>
            </Card>
            <Card>
              <CardHeader>
                <CardTitle className="text-base">Participação no faturamento · {formatMonth(month)}</CardTitle>
                <CardDescription>Percentual do faturamento previsto representado por cliente.</CardDescription>
              </CardHeader>
              <CardContent className="flex flex-col items-center gap-4 sm:flex-row sm:justify-center">
                <div className="h-52 w-full max-w-[260px]">
                  {clientRevenueData.length ? (
                    <ResponsiveContainer width="100%" height="100%">
                      <PieChart>
                        <Pie data={clientRevenueData} dataKey="value" nameKey="name" innerRadius={52} outerRadius={82} paddingAngle={2}>
                          {clientRevenueData.map((entry, index) => <Cell key={entry.key} fill={CLIENT_CHART_COLORS[index % CLIENT_CHART_COLORS.length]} />)}
                        </Pie>
                        <Tooltip
                          {...CHART_TOOLTIP_STYLE}
                          formatter={(value, _name, item) => [`${formatCurrency(value)} (${item.payload.percent.toFixed(1)}%)`, item.payload.name]}
                        />
                      </PieChart>
                    </ResponsiveContainer>
                  ) : <div className="flex h-full items-center justify-center text-sm text-muted-foreground">Sem faturamento previsto nesta competência.</div>}
                </div>
                <div className="finance-client-scrollbar max-h-52 w-full max-w-sm space-y-2 overflow-y-auto pr-1">
                  {clientRevenueData.map((entry, index) => (
                    <div key={entry.key} className="flex items-center justify-between gap-3 rounded-md border px-3 py-2 text-sm">
                      <span className="flex min-w-0 items-center gap-2">
                        <span className="h-2.5 w-2.5 shrink-0 rounded-full" style={{ backgroundColor: CLIENT_CHART_COLORS[index % CLIENT_CHART_COLORS.length] }} />
                        <span className="truncate" title={entry.name}>{entry.name}</span>
                      </span>
                      <span className="shrink-0 text-right"><strong>{entry.percent.toFixed(1)}%</strong><span className="ml-2 text-muted-foreground">{formatCurrency(entry.value)}</span></span>
                    </div>
                  ))}
                </div>
              </CardContent>
            </Card>
          </section>

          <section aria-label="Recebimentos" className="space-y-3">
            <div className="flex flex-wrap items-end justify-between gap-3">
              <div><h2 className="text-xl font-semibold">Recebimentos</h2><p className="text-sm text-muted-foreground">Competência {formatMonth(month)} · valores recebidos podem incluir parcelas.</p></div>
              <div className="flex flex-wrap gap-2">
                <label className="relative"><span className="sr-only">Buscar cliente</span><Search className="absolute left-2.5 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input value={search} onChange={(event) => setSearch(event.target.value)} placeholder="Buscar cliente" className="h-10 w-52 rounded-md border bg-background pl-8 pr-3 text-sm" /></label>
                <label><span className="sr-only">Filtrar por status</span><select value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)} className="h-10 rounded-md border bg-background px-3 text-sm"><option value="all">Todos os status</option><option value="received">Recebido</option><option value="pending">Pendente</option><option value="overdue">Atrasado</option></select></label>
              </div>
            </div>

            <Card className="overflow-hidden">
              <div className="overflow-x-auto">
                <table className="w-full min-w-[1050px] text-left text-sm">
                  <thead className="border-b bg-muted/40 text-xs text-muted-foreground"><tr><th className="px-4 py-3 font-medium">Cliente</th><th className="px-4 py-3 font-medium">Mensalidade contratada</th><th className="px-4 py-3 font-medium">Data de pgmt.</th><th className="px-4 py-3 font-medium">Previsto no mês</th><th className="px-4 py-3 font-medium">Status e saldo</th><th className="px-4 py-3 font-medium">Data do recebimento</th><th className="px-4 py-3 font-medium">Ação</th></tr></thead>
                  <tbody className="divide-y">
                    {visibleRows.map((row) => (
                      <tr key={row.client_id} className="align-top">
                        <td className="px-4 py-3"><div className="flex items-center gap-2.5"><div className="flex h-8 w-8 shrink-0 items-center justify-center overflow-hidden rounded-md border bg-muted">{row.logo_url ? <img src={row.logo_url} alt="" className="h-full w-full object-contain p-0.5" /> : row.client_name.charAt(0).toUpperCase()}</div><div><span className="font-medium">{row.client_name}</span><span className="mt-0.5 block text-xs text-muted-foreground">{row.active ? "Ativo" : "Inativo"}</span></div></div></td>
                        <td className="px-4 py-3">{row.monthly_fee == null ? "—" : formatCurrency(row.monthly_fee)}</td>
                        <td className="px-4 py-3">{row.first_payment_date ? formatDate(row.first_payment_date) : row.billing_day ? `Dia ${row.billing_day}` : "—"}{row.due_date && <span className="mt-0.5 block text-xs text-muted-foreground">Vence em {formatDate(row.due_date)}</span>}</td>
                        <td className="px-4 py-3">{row.expected_amount == null ? "—" : formatCurrency(row.expected_amount)}</td>
                        <td className="px-4 py-3"><StatusBadge status={row.status} />{row.status === "missing_configuration" ? <span className="mt-1 block max-w-48 text-xs text-muted-foreground">{[row.missing_monthly_fee && "valor mensal", row.missing_payment_date && "data de pagamento"].filter(Boolean).join(" e ")} não configurado.</span> : <span className="mt-1 block text-xs text-muted-foreground">Recebido: {formatCurrency(row.received_amount)}<br />Saldo: {formatCurrency(row.remaining_amount)}</span>}</td>
                        <td className="px-4 py-3">{row.receipts.length ? <div className="space-y-1">{row.receipts.map((receipt) => <div key={receipt.id} className="whitespace-nowrap">{formatDate(receipt.received_on)} · {formatCurrency(receipt.amount)}</div>)}</div> : <span className="text-muted-foreground">—</span>}</td>
                        <td className="px-4 py-3"><div className="flex flex-col items-start gap-1.5">{row.receivable_id && row.remaining_amount > 0 && <button type="button" onClick={() => registerReceipt(row)} disabled={saving} aria-busy={saving} className="whitespace-nowrap rounded-md bg-primary px-3 py-2 text-xs font-medium text-primary-foreground hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60">Registrar recebimento</button>}{row.receipts.map((receipt) => <button key={receipt.id} type="button" onClick={() => openEdit(row, receipt)} className="inline-flex items-center gap-1 rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted"><Pencil className="h-3 w-3" />Editar {formatCurrency(receipt.amount)}</button>)}</div></td>
                      </tr>
                    ))}
                    {!visibleRows.length && <tr><td colSpan={7} className="px-4 py-10 text-center text-sm text-muted-foreground">Nenhum recebimento encontrado para os filtros selecionados.</td></tr>}
                  </tbody>
                </table>
              </div>
            </Card>
          </section>
        </>
      )}

      {modal && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4" onMouseDown={() => !saving && setModal(null)}>
          <form role="dialog" aria-modal="true" aria-labelledby="receipt-modal-title" onSubmit={saveReceipt} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-2xl">
            <div><h2 id="receipt-modal-title" className="text-lg font-semibold">Editar recebimento</h2><p className="mt-1 text-sm text-muted-foreground">{modal.row.client_name} · competência {formatMonth(month)}</p></div>
            <label className="block space-y-1.5 text-sm font-medium">Valor recebido<input autoFocus required type="number" min="0.01" step="0.01" value={modal.amount} onChange={(event) => setModal({ ...modal, amount: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>
            <label className="block space-y-1.5 text-sm font-medium">Data efetiva do recebimento<input required type="date" value={modal.received_on} onChange={(event) => setModal({ ...modal, received_on: event.target.value })} className="h-10 w-full rounded-md border bg-background px-3 font-normal" /></label>
            <div className="flex justify-end gap-2"><button type="button" disabled={saving} onClick={() => setModal(null)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Cancelar</button><button disabled={saving} className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">{saving ? "Salvando…" : "Salvar recebimento"}</button></div>
          </form>
        </div>
      )}
    </div>
  );
}
