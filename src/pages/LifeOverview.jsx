import { useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import {
  ArrowUpRight, BriefcaseBusiness, CalendarDays, Check, CheckCircle2, LockKeyhole,
  CircleDollarSign, Clock3, Heart, ListTodo, LoaderCircle, Plus, Sparkles, Target, X,
} from "lucide-react";
import { useAppData } from "@/components/AppDataProvider";
import { completeProspectAction, getProspects } from "@/api/prospects";
import { getAgendaItems, getGoogleCalendarEvents, updateAgendaItem } from "@/api/agenda";

function localDateString(date = new Date()) {
  const year = date.getFullYear();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${year}-${month}-${day}`;
}

function localDateTimeMinute(date) {
  return `${localDateString(date)}T${String(date.getHours()).padStart(2, "0")}:${String(date.getMinutes()).padStart(2, "0")}`;
}

function formatDate(value) {
  if (!value) return "Sem data";
  const date = new Date(`${String(value).slice(0, 10)}T12:00:00`);
  return new Intl.DateTimeFormat("pt-BR", { day: "numeric", month: "short" }).format(date);
}

function formatLongDate(value) {
  return new Intl.DateTimeFormat("pt-BR", {
    weekday: "long", day: "numeric", month: "long",
  }).format(new Date(`${value}T12:00:00`));
}

const COMPLETABLE_ACTIONS = new Set(["Follow-up", "Confirmar reunião", "Follow-up da proposta"]);
const lifeAreas = [
  { title: "Saúde e bem-estar", icon: Heart },
  { title: "Família e relacionamentos", icon: Heart },
  { title: "Espiritualidade", icon: Sparkles },
  { title: "Carreira e negócio", icon: BriefcaseBusiness },
  { title: "Finanças", icon: CircleDollarSign },
  { title: "Desenvolvimento pessoal", icon: Target },
];

function Metric({ icon: Icon, label, value, hint }) {
  return (
    <div className="rounded-xl border bg-card p-4">
      <div className="flex items-center justify-between gap-3">
        <span className="text-sm text-muted-foreground">{label}</span>
        <Icon className="h-4 w-4 text-primary" />
      </div>
      <div className="mt-2 text-2xl font-semibold tracking-tight">{value}</div>
      <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
    </div>
  );
}

function WorkflowGate({ locked, message, children }) {
  return (
    <div className="relative">
      <div
        inert={locked}
        aria-disabled={locked}
        className={`transition-[filter,opacity] duration-300 ${locked ? "pointer-events-none select-none blur-[3px] opacity-55" : ""}`}
      >
        {children}
      </div>
      {locked && (
        <div className="absolute inset-0 z-10 flex items-center justify-center" role="img" aria-label={message} title={message}>
          <LockKeyhole aria-hidden="true" className="h-5 w-5 text-muted-foreground/70 drop-shadow-sm" />
        </div>
      )}
    </div>
  );
}

export default function LifeOverview() {
  const {
    clients, clientDemands, loading: appLoading, error: appError,
    addClientDemand, saveClientDemand,
  } = useAppData();
  const [prospects, setProspects] = useState([]);
  const [agendaItems, setAgendaItems] = useState([]);
  const [archivedSources, setArchivedSources] = useState(() => new Set());
  const [agendaLoading, setAgendaLoading] = useState(true);
  const [agendaError, setAgendaError] = useState("");
  const [prospectsLoading, setProspectsLoading] = useState(true);
  const [prospectsError, setProspectsError] = useState("");
  const [busyTaskId, setBusyTaskId] = useState("");
  const [clockNow, setClockNow] = useState(() => new Date());
  const [exitingTasks, setExitingTasks] = useState([]);
  const exitTimers = useRef(new Map());
  const [taskError, setTaskError] = useState("");
  const [quickAddOpen, setQuickAddOpen] = useState(false);
  const [quickAddSaving, setQuickAddSaving] = useState(false);
  const [quickAddError, setQuickAddError] = useState("");
  const [quickTask, setQuickTask] = useState({ clientId: "", title: "", date: localDateString() });
  const today = localDateString();
  const greeting = clockNow.getHours() < 12 ? "Bom dia" : clockNow.getHours() < 18 ? "Boa tarde" : "Boa noite";
  const clientList = Object.values(clients).sort((a, b) => String(a.name || "").localeCompare(String(b.name || ""), "pt-BR"));
  const activeClients = clientList.filter((client) => client.active).length;
  const clientNames = useMemo(() => Object.fromEntries(clientList.map((client) => [client.id, client.name || "Cliente"])), [clientList]);
  const activeClientIds = useMemo(() => new Set(clientList.filter((client) => Boolean(client.active)).map((client) => String(client.id))), [clientList]);

  useEffect(() => {
    let cancelled = false;
    Promise.allSettled([
      getAgendaItems({ from: today, until: today }),
      getGoogleCalendarEvents({ from: today, until: today }),
    ])
      .then(([agendaResult, calendarResult]) => {
        if (cancelled) return;
        if (agendaResult.status === "rejected") {
          setAgendaError(agendaResult.reason?.message || "Não foi possível carregar os compromissos.");
          return;
        }
        const archived = new Set((calendarResult.status === "fulfilled" ? calendarResult.value.linkedSources || [] : [])
          .filter((source) => source.archived)
          .map((source) => `${source.sourceType}:${source.sourceId}`));
        setArchivedSources(archived);
        setAgendaItems(agendaResult.value);
        if (calendarResult.status === "rejected") {
          setAgendaError(calendarResult.reason?.message || "Não foi possível verificar eventos removidos do Google Agenda.");
        }
      })
      .finally(() => { if (!cancelled) setAgendaLoading(false); });
    getProspects()
      .then((items) => { if (!cancelled) setProspects(items); })
      .catch((error) => { if (!cancelled) setProspectsError(error.message || "Não foi possível carregar as ações comerciais."); })
      .finally(() => { if (!cancelled) setProspectsLoading(false); });
    return () => { cancelled = true; };
  }, [today]);

  useEffect(() => () => {
    exitTimers.current.forEach((timer) => window.clearTimeout(timer));
    exitTimers.current.clear();
  }, []);

  useEffect(() => {
    const timer = window.setInterval(() => setClockNow(new Date()), 1000);
    return () => window.clearInterval(timer);
  }, []);

  const tasks = useMemo(() => {
    const clientTasks = clientDemands.filter((item) => activeClientIds.has(String(item.client_id)) && !archivedSources.has(`client_demand:${item.id}`)).map((item) => ({
      id: `demand-${item.id}`,
      sourceId: item.id,
      source: "client",
      itemType: "task",
      title: item.title,
      context: clientNames[item.client_id] || "Cliente",
      date: String(item.demand_date || "").slice(0, 10),
      time: item.time || "",
      status: item.status || "pending",
      kind: "Tarefa de cliente",
      to: "/gestao-clientes",
      completable: item.status !== "completed" && item.status !== "not_done",
    }));
    const salesActions = prospects
      .filter((item) => item.next_action_date && !item.is_won && !item.is_lost && !archivedSources.has(`prospect:${item.id}`))
      .map((item) => ({
        id: `prospect-${item.id}`,
        sourceId: item.id,
        source: "prospect",
        itemType: "task",
        title: item.next_action || "Acompanhar oportunidade",
        context: item.company_name,
        date: String(item.next_action_date).slice(0, 10),
        time: ["triage_scheduled", "proposal_scheduled"].includes(item.stage_key) && item.meeting_at
          ? String(item.meeting_at || "").slice(11, 16)
          : item.next_action_time || "",
        meetingAt: item.meeting_at || "",
        isScheduledAcquisitionEvent: (
          item.stage_key === "triage_scheduled" && item.next_action === "Realizar reunião"
        ) || (
          item.stage_key === "proposal_scheduled" && item.next_action === "Enviar proposta"
        ),
        status: "pending",
        kind: "Ação comercial",
        to: "/aquisicao",
        completable: COMPLETABLE_ACTIONS.has(item.next_action),
      }));
    const agendaEntries = agendaItems.filter((record) => !archivedSources.has(`agenda:${record.id}`)).map((record) => ({
      id: `agenda-${record.id}`, sourceId: record.id, source: "agenda",
      itemType: record.item_type, title: record.title,
      context: record.client_id ? clientNames[record.client_id] || "Cliente" : record.category || (record.area === "personal" ? "Pessoal" : "Profissional"),
      date: record.planned_date || record.due_date || "", time: record.start_time || "", status: record.status,
      kind: record.item_type === "appointment" ? "Compromisso" : "Tarefa da agenda", to: "/agenda",
      completable: record.item_type === "task" && !["completed", "not_done", "cancelled"].includes(record.status),
    }));
    return [...clientTasks, ...salesActions, ...agendaEntries].filter((item) => item.date).sort((a, b) => a.date.localeCompare(b.date) || String(a.time || "").localeCompare(String(b.time || "")) || a.title.localeCompare(b.title, "pt-BR"));
  }, [clientDemands, clientNames, activeClientIds, prospects, agendaItems, archivedSources]);

  const todayTasks = tasks.filter((task) => task.itemType === "task" && task.date === today);
  const completedToday = todayTasks.filter((task) => ["client", "agenda"].includes(task.source) && task.status === "completed").length;
  const openToday = tasks.filter((task) => task.itemType === "task" && task.date <= today && ["pending", "in_progress"].includes(task.status));
  const overdueCount = openToday.filter((task) => task.date < today).length;
  const nowTime = `${String(clockNow.getHours()).padStart(2, "0")}:${String(clockNow.getMinutes()).padStart(2, "0")}`;
  const timedCommitments = agendaItems.filter((item) => item.item_type === "appointment" && !archivedSources.has(`agenda:${item.id}`) && item.planned_date === today && item.status === "scheduled" && item.end_time > nowTime).sort((a, b) => a.start_time.localeCompare(b.start_time));
  const nextCommitment = timedCommitments[0] || null;
  const todayCommitments = tasks.filter((task) => task.itemType === "appointment" && task.date === today && task.status === "scheduled");
  const exitingIds = new Set(exitingTasks.map((task) => task.id));
  const agendaTasks = [
    ...tasks.filter((task) => !exitingIds.has(task.id)),
    ...exitingTasks,
  ];
  const dayAgenda = agendaTasks.filter((task) =>
    task.source !== "prospect" &&
    task.itemType === "task" &&
    task.date <= today &&
    ["pending", "in_progress"].includes(task.status)
  );
  const overdueTasks = dayAgenda.filter((task) => task.date < today);
  const dueTodayTasks = dayAgenda.filter((task) => task.date === today);
  const priorityTasks = agendaTasks.filter((task) =>
    task.source === "prospect" &&
    task.itemType === "task" &&
    task.date <= today &&
    ["pending", "in_progress"].includes(task.status)
  );
  const priorityOverdue = priorityTasks.filter((task) => task.date < today);
  const priorityToday = priorityTasks.filter((task) => task.date === today);
  const currentLocalMinute = localDateTimeMinute(clockNow);
  const blocksFlow = (task) => {
    if (!task.isScheduledAcquisitionEvent) return true;
    return /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/.test(task.meetingAt) && task.meetingAt <= currentLocalMinute;
  };
  const prioritiesPending = priorityTasks.some(blocksFlow);
  const overduePending = overdueTasks.length > 0;
  const overdueLocked = prioritiesPending;
  const todayLocked = prioritiesPending || overduePending;
  const overdueLockMessage = "Conclua todas as Prioridades do dia para liberar as tarefas atrasadas.";
  const todayLockMessage = prioritiesPending
    ? overdueLockMessage
    : "Conclua todas as tarefas atrasadas para liberar as tarefas e compromissos de hoje.";
  const agendaLoadingState = appLoading || agendaLoading;
  const tasksLoading = agendaLoadingState || prospectsLoading;
  const markTaskComplete = async (task) => {
    setBusyTaskId(task.id);
    setTaskError("");
    try {
      if (task.source === "agenda") {
        const saved = await updateAgendaItem(task.sourceId, { status: "completed" });
        setAgendaItems((current) => current.map((item) => item.id === saved.id ? saved : item));
      } else if (task.source === "client") {
        await saveClientDemand(task.sourceId, { status: "completed" });
      } else {
        const result = await completeProspectAction(task.sourceId);
        if (result.prospect) {
          setProspects((current) => current.map((prospect) => prospect.id === result.prospect.id ? result.prospect : prospect));
        }
      }
      setExitingTasks((current) => current.some((item) => item.id === task.id) ? current : [...current, task]);
      const previousTimer = exitTimers.current.get(task.id);
      if (previousTimer) window.clearTimeout(previousTimer);
      exitTimers.current.set(task.id, window.setTimeout(() => {
        setExitingTasks((current) => current.filter((item) => item.id !== task.id));
        exitTimers.current.delete(task.id);
      }, 320));
    } catch (error) {
      setTaskError(error.message || "Não foi possível atualizar esta tarefa.");
    } finally {
      setBusyTaskId("");
    }
  };

  const submitQuickTask = async (event) => {
    event.preventDefault();
    if (!quickTask.clientId || !quickTask.title.trim() || !quickTask.date) {
      setQuickAddError("Escolha um cliente, informe a tarefa e selecione uma data.");
      return;
    }
    setQuickAddSaving(true);
    setQuickAddError("");
    try {
      await addClientDemand({
        client_id: Number(quickTask.clientId),
        title: quickTask.title.trim(),
        type: "pending",
        demand_date: quickTask.date,
        observation: "",
        status: "pending",
      });
      setQuickAddOpen(false);
      setQuickTask({ clientId: "", title: "", date: today });
    } catch (error) {
      setQuickAddError(error.message || "Não foi possível criar a tarefa.");
    } finally {
      setQuickAddSaving(false);
    }
  };

  const statusLabel = (task) => {
    if (task.status === "scheduled") return "Agendado";
    if (task.status === "cancelled") return "Cancelado";
    if (task.status === "completed") return "Concluída";
    if (task.status === "in_progress") return "Em andamento";
    if (task.status === "not_done") return "Não feita";
    return task.date < today ? "Atrasada" : "Pendente";
  };

  const renderTask = (task, isExiting = false) => (
    <li key={task.id} className={`flex overflow-hidden items-center gap-3 transition-[max-height,opacity,transform,padding] duration-300 ease-out sm:px-5 ${isExiting ? "max-h-0 -translate-x-2 py-0 opacity-0" : "max-h-24 px-4 py-3 opacity-100"}`}>
      {task.completable ? (
        <button
          type="button"
          onClick={() => markTaskComplete(task)}
          disabled={busyTaskId === task.id}
          aria-label={`Concluir: ${task.title}`}
          title="Concluir tarefa"
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border text-muted-foreground transition-colors hover:border-emerald-600 hover:bg-emerald-600 hover:text-white disabled:opacity-50"
        >
          {busyTaskId === task.id ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}
        </button>
      ) : (
        <span className={`h-2.5 w-2.5 shrink-0 rounded-full ${task.status === "completed" ? "bg-emerald-500" : task.date < today ? "bg-amber-500" : "bg-primary"}`} />
      )}
      <div className="min-w-0 flex-1">
        <p className={`truncate text-sm font-medium ${task.status === "completed" ? "text-muted-foreground line-through" : ""}`}>{task.title}</p>
        <p className="mt-1 truncate text-xs text-muted-foreground">{task.context} · {task.kind}</p>
      </div>
      <span className={`hidden shrink-0 rounded-full px-2 py-1 text-[11px] sm:inline-flex ${task.date < today && task.status !== "completed" ? "bg-amber-500/10 text-amber-700 dark:text-amber-400" : "bg-muted text-muted-foreground"}`}>{statusLabel(task)}</span>
      <span className="shrink-0 text-right text-xs text-muted-foreground">{task.time && <span className="block font-medium text-foreground">{task.time}</span>}{task.date < today ? formatDate(task.date) : "Hoje"}</span>
      {!task.completable && ["prospect", "agenda"].includes(task.source) && <Link to={task.to} aria-label="Abrir ação comercial" className="shrink-0 text-muted-foreground hover:text-foreground"><ArrowUpRight className="h-4 w-4" /></Link>}
    </li>
  );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl space-y-7 px-4 py-7 sm:px-6 sm:py-8 lg:px-8">
        <header className="flex flex-col gap-5 border-b pb-6 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <h1 className="text-3xl font-bold tracking-tight sm:text-4xl">{greeting}{greeting === "Boa noite" ? ", Samuel Jorge" : ""}</h1>
            <p className="mt-2 text-sm capitalize text-muted-foreground">{formatLongDate(today)}</p>
          </div>
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => { setQuickTask({ clientId: clientList[0]?.id ? String(clientList[0].id) : "", title: "", date: today }); setQuickAddError(""); setQuickAddOpen(true); }} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="h-4 w-4" /> Adicionar tarefa</button>
            <Link to="/agenda" className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium hover:bg-muted"><CalendarDays className="h-4 w-4" /> Ver calendário geral</Link>
          </div>
        </header>

        <section aria-label="Resumo do dia" className="grid gap-3 sm:grid-cols-2 lg:grid-cols-5">
          <Metric icon={ListTodo} label="Tarefas de hoje" value={tasksLoading ? "—" : todayTasks.length} hint="Pessoais e profissionais" />
          <Metric icon={CheckCircle2} label="Concluídas hoje" value={tasksLoading ? "—" : completedToday} hint="Conclusões registradas" />
          <Metric icon={Clock3} label="Pendentes ou atrasadas" value={tasksLoading ? "—" : openToday.length} hint={tasksLoading ? "Carregando" : `${overdueCount} em atraso`} />
          <Metric icon={CalendarDays} label="Próximo compromisso" value={tasksLoading ? "—" : nextCommitment?.start_time || "—"} hint={nextCommitment?.title || (tasksLoading ? "Carregando" : "Nenhum compromisso previsto hoje")} />
          <Metric icon={Target} label="Hábitos de hoje" value="—" hint="Disponível quando o módulo for criado" />
        </section>

        {(appError || prospectsError || taskError) && <div role="alert" className="rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">{taskError || appError || prospectsError}</div>}

        <section className="grid gap-6 lg:grid-cols-[minmax(0,1.35fr)_minmax(280px,0.8fr)]">
          <div className="overflow-hidden rounded-xl border bg-card">
            <div className="flex items-start justify-between gap-4 border-b p-5">
              <div><h2 className="font-semibold">Agenda de hoje</h2></div>
              <CalendarDays className="mt-0.5 h-5 w-5 shrink-0 text-primary" />
            </div>
            {agendaLoadingState ? (
              <div className="flex items-center justify-center gap-2 p-12 text-sm text-muted-foreground"><LoaderCircle className="h-4 w-4 animate-spin" /> Carregando sua agenda...</div>
            ) : (
              <>
                {todayCommitments.length > 0 && <>
                  <div className="border-b bg-muted/20 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Compromissos com horário</div>
                  <WorkflowGate locked={todayLocked} message={todayLockMessage}><ul className="divide-y">{todayCommitments.map(renderTask)}</ul></WorkflowGate>
                </>}
                {overdueTasks.length > 0 && <>
                  <div className="bg-muted/20 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tarefas atrasadas · {overdueTasks.length}</div>
                  <WorkflowGate locked={overdueLocked} message={overdueLockMessage}>
                    <ul className="divide-y">{overdueTasks.slice(0, 8).map((task) => renderTask(task, exitingIds.has(task.id)))}</ul>
                    {overdueTasks.length > 8 && <div className="border-b px-5 py-3 text-sm text-muted-foreground">Mais {overdueTasks.length - 8} atrasadas. <Link className="font-medium text-primary hover:underline" to="/agenda">Abrir Agenda</Link></div>}
                  </WorkflowGate>
                </>}
                {dueTodayTasks.length > 0 && <>
                  <div className="bg-muted/20 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Tarefas de hoje · {dueTodayTasks.length}</div>
                  <WorkflowGate locked={todayLocked} message={todayLockMessage}>
                    <ul className="divide-y">{dueTodayTasks.slice(0, 8).map((task) => renderTask(task, exitingIds.has(task.id)))}</ul>
                    {dueTodayTasks.length > 8 && <div className="border-t px-5 py-3 text-sm text-muted-foreground">Mais {dueTodayTasks.length - 8} tarefas de hoje. <Link className="font-medium text-primary hover:underline" to="/agenda">Abrir Agenda</Link></div>}
                  </WorkflowGate>
                </>}
              </>
            )}
          </div>

          <div className="space-y-6">
            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="border-b p-5"><h2 className="font-semibold">Prioridades do dia</h2></div>
              {prospectsLoading ? <div className="p-6 text-sm text-muted-foreground">Carregando prioridades comerciais...</div> : priorityTasks.length ? <>
                <div className="bg-muted/20 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aquisição atrasada · {priorityOverdue.length}</div>
                {priorityOverdue.length ? <ul className="divide-y">{priorityOverdue.map((task) => renderTask(task, exitingIds.has(task.id)))}</ul> : <p className="border-b px-5 py-3 text-sm text-muted-foreground">Nenhuma ação comercial atrasada.</p>}
                <div className="bg-muted/20 px-5 py-2.5 text-xs font-semibold uppercase tracking-wide text-muted-foreground">Aquisição de hoje · {priorityToday.length}</div>
                {priorityToday.length ? <ul className="divide-y">{priorityToday.map((task) => renderTask(task, exitingIds.has(task.id)))}</ul> : <p className="px-5 py-3 text-sm text-muted-foreground">Nenhuma ação comercial prevista para hoje.</p>}
              </> : <div className="p-6 text-sm text-muted-foreground">Nenhuma ação comercial atrasada ou prevista para hoje.</div>}
            </div>

            <div className="overflow-hidden rounded-xl border bg-card">
              <div className="flex items-start justify-between border-b p-5"><div><h2 className="font-semibold">Metas em andamento</h2></div><Target className="h-5 w-5 text-muted-foreground" /></div>
              <div className="p-5 text-sm text-muted-foreground">As metas aparecerão aqui quando forem cadastradas na área correspondente.</div>
            </div>
          </div>
        </section>

        <section>
          <div className="mb-4 flex items-end justify-between gap-3"><div><h2 className="font-semibold">Áreas da vida</h2><p className="mt-1 text-sm text-muted-foreground">Um panorama pessoal e profissional, preparado para crescer com o sistema.</p></div><span className="rounded-full bg-muted px-2.5 py-1 text-xs text-muted-foreground">{activeClients} clientes ativos</span></div>
          <div className="grid gap-3 sm:grid-cols-2 xl:grid-cols-4">
            {lifeAreas.map(({ title, icon: Icon }) => (
              <div key={title} className="flex items-center gap-3 rounded-xl border bg-card p-4"><span className="rounded-lg bg-muted p-2.5 text-muted-foreground"><Icon className="h-4 w-4" /></span><span><span className="block text-sm font-medium">{title}</span><span className="mt-0.5 block text-xs text-muted-foreground">Resumo disponível nas próximas etapas</span></span></div>
            ))}
          </div>
        </section>
      </div>

      {quickAddOpen && (
        <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget && !quickAddSaving) setQuickAddOpen(false); }}>
          <section role="dialog" aria-modal="true" aria-labelledby="quick-task-title" className="w-full max-w-md rounded-xl border bg-background p-5 shadow-xl">
            <div className="flex items-start justify-between gap-4"><div><h2 id="quick-task-title" className="font-semibold">Adicionar tarefa de cliente</h2><p className="mt-1 text-sm text-muted-foreground">A tarefa ficará vinculada ao cliente e disponível na Gestão de Clientes.</p></div><button type="button" aria-label="Fechar" onClick={() => setQuickAddOpen(false)} disabled={quickAddSaving} className="rounded-md p-1 text-muted-foreground hover:bg-muted"><X className="h-4 w-4" /></button></div>
            <form onSubmit={submitQuickTask} className="mt-5 space-y-4">
              <label className="block space-y-1.5"><span className="text-sm font-medium">Cliente</span><select required value={quickTask.clientId} onChange={(event) => setQuickTask((current) => ({ ...current, clientId: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={quickAddSaving}><option value="">Selecione um cliente</option>{clientList.map((client) => <option key={client.id} value={client.id}>{client.name || client.account_id}</option>)}</select></label>
              <label className="block space-y-1.5"><span className="text-sm font-medium">Tarefa</span><input autoFocus required maxLength={180} value={quickTask.title} onChange={(event) => setQuickTask((current) => ({ ...current, title: event.target.value }))} placeholder="Ex.: Revisar campanha" className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={quickAddSaving} /></label>
              <label className="block space-y-1.5"><span className="text-sm font-medium">Data</span><input required type="date" value={quickTask.date} onChange={(event) => setQuickTask((current) => ({ ...current, date: event.target.value }))} className="h-10 w-full rounded-md border border-input bg-background px-3 text-sm" disabled={quickAddSaving} /></label>
              {quickAddError && <p role="alert" className="text-sm text-destructive">{quickAddError}</p>}
              {!clientList.length && <p className="text-sm text-muted-foreground">Cadastre um cliente para criar uma tarefa operacional.</p>}
              <div className="flex justify-end gap-2 border-t pt-4"><button type="button" onClick={() => setQuickAddOpen(false)} disabled={quickAddSaving} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Cancelar</button><button type="submit" disabled={quickAddSaving || !clientList.length} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{quickAddSaving ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Plus className="h-4 w-4" />} Criar tarefa</button></div>
            </form>
          </section>
        </div>
      )}
    </div>
  );
}
