import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { addDays, addMonths, addWeeks, eachDayOfInterval, endOfMonth, endOfWeek, format, isSameMonth, isToday, startOfMonth, startOfWeek } from "date-fns";
import { ptBR } from "date-fns/locale";
import { CalendarDays, Check, ChevronDown, ChevronLeft, ChevronRight, ChevronUp, Circle, CircleDot, ExternalLink, Eye, EyeOff, Filter, Layers, List, LoaderCircle, Pencil, Plus, Trash2, Video, X } from "lucide-react";
import { io } from "socket.io-client";
import { useAppData } from "@/components/AppDataProvider";
import { useToast } from "@/components/ui/use-toast";
import { Calendar } from "@/components/ui/calendar";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { Popover, PopoverContent, PopoverTrigger } from "@/components/ui/popover";
import { ToastAction } from "@/components/ui/toast";
import AgendaPlanningList, { AGENDA_DRAFT_DRAG_TYPE, readAgendaDraftDrag } from "@/components/AgendaPlanningList";
import { completeProspectAction, getProspects, updateProspect } from "@/api/prospects";
import { connectGoogleCalendar, createAgendaItem, deleteAgendaItem, deleteGoogleCalendarEvent, getAgendaItemColors, getAgendaItems, getGoogleCalendarConnection, getGoogleCalendarEvents, getSubidoProCalendarEvents, renewGoogleCalendarWatch, updateAgendaItem, updateAgendaItemColor, updateGoogleCalendarEvent } from "@/api/agenda";
import { getWhatsAppCredentials } from "@/api/whatsapp";

const DAYS = ["Seg", "Ter", "Qua", "Qui", "Sex", "Sáb", "Dom"];
const STATUSES = { pending: "Pendente", in_progress: "Em andamento", completed: "Concluída", not_done: "Não feita", scheduled: "Agendado", cancelled: "Cancelado" };
const DEMAND_TYPES = { optimization: "Otimização", analysis: "Análise", billing: "Boleto", balance_check: "Verificar saldo", meeting: "Reunião", creative: "Criativo", report: "Relatório", pending: "Pendência", follow_up: "Follow-up", other: "Demanda" };
const COMPLETABLE = new Set(["Follow-up", "Confirmar reunião", "Follow-up da proposta"]);
const TONE = { personal: "border-l-violet-500 bg-violet-500/5", professional: "border-l-blue-500 bg-blue-500/5", business: "border-l-sky-600 bg-sky-500/5", acquisition: "border-l-amber-500 bg-amber-500/5", google_calendar: "border-l-emerald-600 bg-emerald-500/5" };
const HOUR_HEIGHT = 36;
const HOURS = Array.from({ length: 24 }, (_, index) => index);
const EVENT_COLORS = {
  personal: "border-violet-300 bg-violet-100 text-violet-950 dark:border-violet-700 dark:bg-violet-950 dark:text-violet-100",
  professional: "border-blue-300 bg-blue-100 text-blue-950 dark:border-blue-700 dark:bg-blue-950 dark:text-blue-100",
  business: "border-sky-300 bg-sky-100 text-sky-950 dark:border-sky-700 dark:bg-sky-950 dark:text-sky-100",
  acquisition: "border-amber-300 bg-amber-100 text-amber-950 dark:border-amber-700 dark:bg-amber-950 dark:text-amber-100",
  google_calendar: "border-emerald-300 bg-emerald-100 text-emerald-950 dark:border-emerald-700 dark:bg-emerald-950 dark:text-emerald-100",
};
const GOOGLE_COLOR_SWATCHES = [
  { id: "1", color: "#a4bdfc" }, { id: "2", color: "#7ae7bf" },
  { id: "3", color: "#dbadff" }, { id: "4", color: "#ff887c" },
  { id: "5", color: "#fbd75b" }, { id: "6", color: "#ffb878" },
  { id: "7", color: "#46d6db" }, { id: "8", color: "#929292" },
  { id: "9", color: "#5484ed" }, { id: "10", color: "#51b749" },
  { id: "11", color: "#dc2127" },
];
const CALENDAR_ITEM_DRAG_TYPE = "application/x-sj-ascend-calendar-item";
const AGENDA_CACHE_KEY = "sj-ascend:agenda-week-cache";
const AGENDA_CACHE_TTL = 5 * 60 * 1000;
const EMPTY = { item_type: "appointment", title: "", description: "", area: "personal", category: "", planned_date: "", due_date: "", start_time: "", end_time: "", priority: "normal", status: "scheduled", observations: "", client_id: "" };

function key(date) { return `${date.getFullYear()}-${String(date.getMonth() + 1).padStart(2, "0")}-${String(date.getDate()).padStart(2, "0")}`; }
function readAgendaWeekCache(from, until) {
  try {
    const raw = window.sessionStorage.getItem(AGENDA_CACHE_KEY);
    if (!raw) return null;
    const cached = JSON.parse(raw);
    if (cached.from !== from || cached.until !== until || cached.expiresAt <= Date.now()) {
      window.sessionStorage.removeItem(AGENDA_CACHE_KEY);
      return null;
    }
    return cached.data;
  } catch (error) {
    console.warn("Não foi possível ler o cache local da Agenda:", error);
    return null;
  }
}
function writeAgendaWeekCache(from, until, data) {
  try {
    window.sessionStorage.setItem(AGENDA_CACHE_KEY, JSON.stringify({
      from,
      until,
      expiresAt: Date.now() + AGENDA_CACHE_TTL,
      data,
    }));
  } catch (error) {
    console.warn("Não foi possível guardar o cache local da Agenda:", error);
  }
}
function clearAgendaWeekCache() {
  try {
    window.sessionStorage.removeItem(AGENDA_CACHE_KEY);
  } catch (error) {
    console.warn("Não foi possível limpar o cache local da Agenda:", error);
  }
}
function dateFrom(value) { return value ? new Date(`${String(value).slice(0, 10)}T12:00:00`) : null; }
function dateLabel(value, pattern = "d MMM") { const date = dateFrom(value); return date ? format(date, pattern, { locale: ptBR }) : "—"; }
function safeMeetLink(value) {
  try {
    const url = new URL(String(value || ""));
    return ["https:", "http:"].includes(url.protocol) ? url.href : null;
  } catch {
    return null;
  }
}
function calendarColorStyle(item) {
  const selectedColor = GOOGLE_COLOR_SWATCHES.find((option) => option.id === item.colorId)?.color;
  const background = item.googleColor || selectedColor;
  if (!background) return undefined;
  return {
    backgroundColor: background,
    borderColor: background,
    color: item.googleTextColor || (["9", "11"].includes(item.colorId) ? "#ffffff" : "#202124"),
  };
}
function TaskStatusIcon({ status }) {
  if (status === "completed") return <Check className="h-3 w-3 text-emerald-600" aria-label="Concluída" />;
  if (status === "in_progress") return <CircleDot className="h-3 w-3 text-blue-600" aria-label="Em andamento" />;
  if (status === "not_done") return <X className="h-3 w-3 text-destructive" aria-label="Não feita" />;
  return <Circle className="h-3 w-3 opacity-60" aria-label="Pendente" />;
}
function DatePickerButton({ date, label, onSelect }) {
  return <Popover>
    <PopoverTrigger asChild>
      <button type="button" className="inline-flex min-w-0 items-center gap-1 truncate rounded px-1.5 py-1 text-left text-sm font-medium hover:bg-muted sm:text-base">
        <span className="truncate">{label}</span><ChevronDown className="h-4 w-4 shrink-0 text-muted-foreground" />
      </button>
    </PopoverTrigger>
    <PopoverContent className="w-auto p-0" align="start">
      <Calendar mode="single" selected={date} onSelect={(nextDate) => nextDate && onSelect(nextDate)} initialFocus locale={ptBR} />
    </PopoverContent>
  </Popover>;
}
function QuickCreatePopover({ draft, saving, onSave, onMoreOptions, onClose }) {
  const [title, setTitle] = useState("");
  const popoverRef = useRef(null);
  useEffect(() => setTitle(""), [draft.date, draft.startTime, draft.endTime]);
  useEffect(() => {
    const closeOnOutsidePointer = (event) => {
      if (!popoverRef.current?.contains(event.target)) onClose();
    };
    document.addEventListener("pointerdown", closeOnOutsidePointer);
    return () => document.removeEventListener("pointerdown", closeOnOutsidePointer);
  }, [onClose]);
  return <form ref={popoverRef} onSubmit={(event) => { event.preventDefault(); onSave(title.trim()); }} className="absolute z-40 w-[min(280px,calc(100%-12px))] rounded-lg border bg-popover p-3 text-popover-foreground shadow-xl" style={{
    top: `${draft.top}px`,
    left: `${draft.left}px`,
    transform: draft.alignRight ? "translateX(-100%)" : undefined,
  }}>
    <div className="mb-2 flex items-start justify-between gap-2">
      <div className="min-w-0">
        <p className="text-xs font-semibold">Novo compromisso</p>
        <p className="truncate text-[10px] text-muted-foreground">{dateLabel(draft.date, "EEE, d 'de' MMMM")} · {draft.startTime}–{draft.endTime}</p>
      </div>
      <button type="button" aria-label="Fechar" onClick={onClose} className="rounded p-0.5 text-muted-foreground hover:bg-muted"><X className="h-3.5 w-3.5" /></button>
    </div>
    <input autoFocus value={title} onChange={(event) => setTitle(event.target.value)} placeholder="Adicionar título" maxLength={200} className="h-8 w-full rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-primary" />
    <div className="mt-2 flex justify-end gap-2">
      <button type="button" onClick={onMoreOptions} className="h-7 rounded-md px-2 text-[10px] text-muted-foreground hover:bg-muted">Mais opções</button>
      <button type="submit" disabled={!title.trim() || saving} className="h-7 rounded-md bg-primary px-3 text-[10px] font-medium text-primary-foreground disabled:opacity-50">{saving ? "Salvando…" : "Salvar"}</button>
    </div>
  </form>;
}
function CalendarItemActions({ children, item, mode, open, onOpenChange, onEdit, onDelete, onColorChange, canDelete, canSetColor, canEdit, busy }) {
  return <Popover open={open} onOpenChange={onOpenChange}>
    <PopoverTrigger asChild>{children}</PopoverTrigger>
    <PopoverContent side="right" align="start" className={`z-[70] ${mode === "actions" ? "w-60 space-y-3 p-3" : "w-72 p-4 shadow-lg"}`} onPointerDown={(event) => event.stopPropagation()}>
      {mode === "details" ? <>
        <div className="space-y-2">
          <div className="flex items-start gap-2">
            <span className="mt-0.5 h-3 w-3 shrink-0 rounded-sm" style={{ backgroundColor: item.googleColor || GOOGLE_COLOR_SWATCHES.find((option) => option.id === item.colorId)?.color || "#4285f4" }} />
            <div className="min-w-0">
              <p className="truncate text-sm font-semibold">{item.title}</p>
              <p className="text-[11px] text-muted-foreground">{item.sourceLabel}{item.category ? ` · ${item.category}` : ""}</p>
            </div>
          </div>
          <p className="text-xs text-muted-foreground">
            {item.allDay ? "Dia inteiro" : item.startTime ? `${item.startTime}–${item.endTime}` : "Sem horário"}
            {itemDate(item) ? ` · ${dateLabel(itemDate(item), "d 'de' MMMM yyyy")}` : ""}
          </p>
          {item.description && <p className="line-clamp-3 whitespace-pre-wrap text-xs">{item.description}</p>}
          {safeMeetLink(item.meetLink) && <a href={safeMeetLink(item.meetLink)} target="_blank" rel="noopener noreferrer" className="inline-flex items-center gap-1.5 text-xs font-medium text-primary hover:underline">
            <Video className="h-3.5 w-3.5" /> Entrar na reunião
          </a>}
        </div>
        <div className="mt-3 flex gap-2">
          {canEdit && <button type="button" disabled={busy} onClick={onEdit} className="inline-flex h-8 flex-1 items-center justify-center gap-2 rounded-md border text-xs font-medium hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50">
            <Pencil className="h-3.5 w-3.5" /> Editar
          </button>}
          {canDelete && <button type="button" disabled={busy} onClick={onDelete} className="inline-flex h-8 items-center justify-center gap-2 rounded-md border border-destructive/40 px-2 text-xs font-medium text-destructive hover:bg-destructive/5 disabled:opacity-50">
            <Trash2 className="h-3.5 w-3.5" /> Excluir
          </button>}
        </div>
      </> : <>
        {canDelete && <button type="button" disabled={busy} onClick={onDelete} className="flex h-8 w-full items-center gap-2 rounded px-2 text-left text-xs text-destructive hover:bg-destructive/5 disabled:opacity-50">
          <Trash2 className="h-3.5 w-3.5" /> Excluir
        </button>}
        <div className="border-t pt-2">
          <p className="mb-2 px-1 text-[11px] font-medium text-muted-foreground">Cor do evento</p>
          <div className="mb-2 flex">
            <button type="button" disabled={!canSetColor || busy} onClick={() => onColorChange(null)} aria-label="Cor padrão" title="Padrão" className={`h-7 rounded-md border px-2 text-[10px] text-muted-foreground disabled:cursor-not-allowed disabled:opacity-40 ${!item.colorId ? "ring-2 ring-primary ring-offset-2" : ""}`}>
              Padrão
            </button>
          </div>
          <div className="grid grid-cols-6 gap-2">
            {GOOGLE_COLOR_SWATCHES.map(({ id, color }) => <button key={id} type="button" disabled={!canSetColor || busy} onClick={() => onColorChange(id)} aria-label={`Cor ${id}`} title={id === "8" ? "Grafite" : `Cor ${id}`} className={`h-7 w-7 rounded-full border border-black/10 transition hover:scale-110 disabled:cursor-not-allowed disabled:opacity-40 ${item.colorId === id ? "ring-2 ring-primary ring-offset-2" : ""}`} style={{ backgroundColor: color }} />)}
          </div>
          {!canSetColor && <p className="mt-2 text-[10px] text-muted-foreground">Autorize a escrita no Google para alterar a cor sincronizada.</p>}
        </div>
      </>}
    </PopoverContent>
  </Popover>;
}
function itemDate(item) { return item.plannedDate || item.dueDate || ""; }
function canDeleteCalendarItem(item, writeAccess) {
  if (item.source === "agenda" && !item.googleEventId) return true;
  return writeAccess && (item.source === "google_calendar" || Boolean(item.googleEventId));
}
function occursOnDate(item, date) {
  if (item.source === "google_calendar" || item.source === "subido_pro") return item.plannedDate <= date && date < item.endDateExclusive;
  return itemDate(item) === date;
}
function timeInMinutes(value, fallback = 0) {
  if (!value) return fallback;
  const [hours, minutes] = value.split(":").map(Number);
  return hours * 60 + minutes;
}
function timedEventHeight(duration) {
  return Math.max(15, duration) / 60 * HOUR_HEIGHT - 1;
}
function eventsOnDate(items, date) {
  return items.filter((item) => occursOnDate(item, date)).map((item) => {
    if (item.source !== "google_calendar" || item.allDay) return item;
    const startsOnDate = item.plannedDate === date;
    const endsOnDate = item.endDateExclusive === addDays(dateFrom(date), 1).toISOString().slice(0, 10);
    return {
      ...item,
      startTime: startsOnDate ? item.startTime : "00:00",
      endTime: endsOnDate && item.endTime !== "00:00" ? item.endTime : "24:00",
    };
  });
}
function compactAcquisitionTasks(items, date) {
  const acquisitionTasks = items.filter((item) => item.itemType === "task" && item.domain === "acquisition");
  if (acquisitionTasks.length <= 3) return items.map((item) => ({ kind: "item", key: item.key, item }));
  return [
    { kind: "acquisition", key: `acquisition-${date}`, items: acquisitionTasks },
    ...items
      .filter((item) => !(item.itemType === "task" && item.domain === "acquisition"))
      .map((item) => ({ kind: "item", key: item.key, item })),
  ];
}
function layoutTimedEvents(items) {
  const events = items.map((item) => ({
    item,
    start: timeInMinutes(item.startTime),
    end: Math.max(timeInMinutes(item.endTime, 60), timeInMinutes(item.startTime) + 15),
  })).sort((a, b) => a.start - b.start || b.end - a.end);
  const groups = [];
  let group = [];
  let groupEnd = -1;
  for (const event of events) {
    if (group.length && event.start >= groupEnd) {
      groups.push(group);
      group = [];
      groupEnd = -1;
    }
    group.push(event);
    groupEnd = Math.max(groupEnd, event.end);
  }
  if (group.length) groups.push(group);

  return groups.flatMap((overlapping) => {
    const laneEnds = [];
    const placed = overlapping.map((event) => {
      let lane = laneEnds.findIndex((end) => end <= event.start);
      if (lane < 0) lane = laneEnds.length;
      laneEnds[lane] = event.end;
      return { ...event, lane };
    });
    return placed.map((event) => ({ ...event, laneCount: laneEnds.length }));
  });
}
function openTask(item) { return item.itemType === "task" && !["completed", "not_done", "cancelled"].includes(item.status); }
function periodFor(date, view) {
  if (view === "day") return { from: date, to: date };
  if (view === "week") return { from: startOfWeek(date, { weekStartsOn: 1 }), to: endOfWeek(date, { weekStartsOn: 1 }) };
  return { from: startOfWeek(startOfMonth(date), { weekStartsOn: 1 }), to: endOfWeek(endOfMonth(date), { weekStartsOn: 1 }) };
}
function ItemForm({ open, onOpenChange, initial, selectedDate, clients, saving, error, onSave }) {
  const [form, setForm] = useState(EMPTY); const [validation, setValidation] = useState("");
  const editing = initial?.source === "agenda";
  useEffect(() => {
    if (!open) return;
    if (editing) {
      const item = initial.record;
      setForm({ ...EMPTY, ...item, client_id: item.client_id ? String(item.client_id) : "", planned_date: item.planned_date || "", due_date: item.due_date || "", start_time: item.start_time || "", end_time: item.end_time || "" });
    } else {
      const type = initial?.item_type || "appointment";
      setForm({ ...EMPTY, item_type: type, status: type === "appointment" ? "scheduled" : "pending", planned_date: initial?.planned_date || selectedDate, start_time: initial?.start_time || "", end_time: initial?.end_time || "" });
    }
    setValidation("");
  }, [open, initial, editing, selectedDate]);
  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = async (event) => {
    event.preventDefault(); setValidation("");
    if (!form.title.trim()) return setValidation("Informe um título.");
    if (form.item_type === "appointment") {
      if (!form.planned_date || !form.start_time || !form.end_time) return setValidation("Informe data e horários de início e término.");
      if (form.end_time <= form.start_time) return setValidation("O término precisa ser depois do início.");
    } else {
      if (!form.planned_date && !form.due_date) return setValidation("Informe a data agendada, o prazo final ou ambos.");
      if ((form.start_time || form.end_time) && (!form.planned_date || !form.start_time || !form.end_time)) return setValidation("Para reservar horário, informe data, início e término.");
      if (form.start_time && form.end_time <= form.start_time) return setValidation("O término precisa ser depois do início.");
      if (form.planned_date && form.due_date && form.due_date < form.planned_date) return setValidation("O prazo final não pode anteceder a data agendada.");
    }
    await onSave({ ...form, title: form.title.trim(), description: form.description.trim(), category: form.category.trim(), observations: form.observations.trim(), client_id: form.item_type === "appointment" ? form.client_id || null : null, planned_date: form.planned_date || null, due_date: form.item_type === "task" ? form.due_date || null : null, start_time: form.start_time || null, end_time: form.end_time || null, status: form.item_type === "appointment" && !editing ? "scheduled" : form.status });
  };
  return <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}><DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-xl"><DialogHeader><DialogTitle>{editing ? "Editar item da agenda" : form.item_type === "appointment" ? "Novo compromisso" : "Nova tarefa"}</DialogTitle><DialogDescription>{form.item_type === "task" ? "A data agendada e o prazo final são diferentes; informe um ou ambos." : "Compromisso pessoal ou profissional, com vínculo opcional a cliente."}</DialogDescription></DialogHeader>
    <form onSubmit={submit} className="space-y-4">
      {!editing && <fieldset><legend className="mb-2 text-sm font-medium">Adicionar</legend><div className="flex gap-2"><button type="button" onClick={() => setForm((f) => ({ ...f, item_type: "appointment", status: "scheduled", due_date: "" }))} className={`h-9 rounded-md border px-3 text-sm ${form.item_type === "appointment" ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted"}`}>Compromisso</button><button type="button" onClick={() => setForm((f) => ({ ...f, item_type: "task", status: "pending" }))} className={`h-9 rounded-md border px-3 text-sm ${form.item_type === "task" ? "border-primary bg-primary/5 text-primary" : "hover:bg-muted"}`}>Tarefa</button></div></fieldset>}
      <label className="block space-y-1.5"><span className="text-sm font-medium">Título *</span><input autoFocus required maxLength={200} value={form.title} onChange={(e) => set("title", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
      <label className="block space-y-1.5"><span className="text-sm font-medium">Descrição</span><textarea rows={2} maxLength={4000} value={form.description} onChange={(e) => set("description", e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
      <div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5"><span className="text-sm font-medium">Área</span><select value={form.area} onChange={(e) => set("area", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="personal">Pessoal</option><option value="professional">Profissional</option></select></label><label className="block space-y-1.5"><span className="text-sm font-medium">Categoria</span><input maxLength={80} value={form.category} onChange={(e) => set("category", e.target.value)} placeholder="Ex.: Família, saúde, reunião" className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label></div>
      {form.item_type === "appointment" ? <><label className="block space-y-1.5"><span className="text-sm font-medium">Data *</span><input required type="date" value={form.planned_date} onChange={(e) => set("planned_date", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label><div className="grid grid-cols-2 gap-3"><label className="block space-y-1.5"><span className="text-sm font-medium">Início *</span><input required type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label><label className="block space-y-1.5"><span className="text-sm font-medium">Término *</span><input required type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label></div><label className="block space-y-1.5"><span className="text-sm font-medium">Cliente relacionado · opcional</span><select value={form.client_id} onChange={(e) => set("client_id", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="">Sem cliente</option>{clients.map((client) => <option key={client.id} value={client.id}>{client.name || client.account_id}</option>)}</select></label></> : <><div className="grid gap-3 sm:grid-cols-2"><label className="block space-y-1.5"><span className="text-sm font-medium">Data agendada</span><input type="date" value={form.planned_date} onChange={(e) => set("planned_date", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label><label className="block space-y-1.5"><span className="text-sm font-medium">Prazo final</span><input type="date" value={form.due_date} onChange={(e) => set("due_date", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label></div><div className="grid grid-cols-2 gap-3"><label className="block space-y-1.5"><span className="text-sm font-medium">Início · opcional</span><input type="time" value={form.start_time} onChange={(e) => set("start_time", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label><label className="block space-y-1.5"><span className="text-sm font-medium">Término · opcional</span><input type="time" value={form.end_time} onChange={(e) => set("end_time", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label></div><label className="block space-y-1.5"><span className="text-sm font-medium">Prioridade</span><select value={form.priority} onChange={(e) => set("priority", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="low">Baixa</option><option value="normal">Normal</option><option value="high">Alta</option></select></label>{editing && <label className="block space-y-1.5"><span className="text-sm font-medium">Status</span><select value={form.status} onChange={(e) => set("status", e.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm"><option value="pending">Pendente</option><option value="in_progress">Em andamento</option><option value="completed">Concluída</option><option value="not_done">Não feita</option></select></label>}<p className="rounded-md bg-muted/50 p-3 text-xs text-muted-foreground">Tarefas vinculadas a clientes continuam na Gestão de Clientes para preservar seus vínculos e regras.</p></>}
      <label className="block space-y-1.5"><span className="text-sm font-medium">Observações</span><textarea rows={2} maxLength={4000} value={form.observations} onChange={(e) => set("observations", e.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
      {(validation || error) && <p role="alert" className="text-sm text-destructive">{validation || error}</p>}<DialogFooter><button type="button" disabled={saving} onClick={() => onOpenChange(false)} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Cancelar</button><button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}Salvar</button></DialogFooter>
    </form></DialogContent></Dialog>;
}

function GoogleEventForm({ open, onOpenChange, initial, saving, error, onSave }) {
  const [validation, setValidation] = useState("");
  const [form, setForm] = useState({
    title: "",
    description: "",
    location: "",
    start_date: "",
    end_date: "",
    start_time: "",
    end_time: "",
    all_day: false,
  });

  useEffect(() => {
    if (!open || !initial) return;
    const event = initial.record;
    setForm({
      title: event.title || "",
      description: event.description || "",
      location: event.location || "",
      start_date: event.start_date || "",
      end_date: event.end_date || key(addDays(dateFrom(event.end_date_exclusive), -1)),
      start_time: event.start_time || "09:00",
      end_time: event.end_time && event.end_time !== "00:00" ? event.end_time : "10:00",
      all_day: Boolean(event.all_day),
    });
    setValidation("");
  }, [open, initial]);

  const set = (field, value) => setForm((current) => ({ ...current, [field]: value }));
  const submit = (event) => {
    event.preventDefault();
    const start = dateFrom(form.start_date);
    const end = dateFrom(form.end_date);
    if (!form.title.trim()) return setValidation("Informe o nome do evento.");
    if (!form.start_date || (form.all_day && (!form.end_date || end < start))) {
      return setValidation("Informe uma data final válida.");
    }
    if (!form.all_day && (!form.start_time || !form.end_time
      || (form.end_date === form.start_date && form.end_time <= form.start_time))) {
      return setValidation("Informe horários válidos e um término depois do início.");
    }
    setValidation("");
    onSave({
      title: form.title.trim(),
      description: form.description.trim(),
      location: form.location.trim(),
      all_day: form.all_day,
      start_date: form.start_date,
      end_date_exclusive: key(addDays(end, 1)),
      end_date: key(end),
      start_time: form.all_day ? null : form.start_time,
      end_time: form.all_day ? null : form.end_time,
    });
  };

  return <Dialog open={open} onOpenChange={(next) => !saving && onOpenChange(next)}>
    <DialogContent className="max-h-[90vh] overflow-y-auto sm:max-w-lg">
      <DialogHeader><DialogTitle>Editar evento do Google</DialogTitle><DialogDescription>As alterações serão enviadas ao Google Agenda.</DialogDescription></DialogHeader>
      <form onSubmit={submit} className="space-y-3">
        <label className="block space-y-1"><span className="text-sm font-medium">Nome</span><input required maxLength={200} value={form.title} onChange={(event) => set("title", event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
        <label className="block space-y-1"><span className="text-sm font-medium">Descrição</span><textarea rows={3} maxLength={4000} value={form.description} onChange={(event) => set("description", event.target.value)} className="w-full rounded-md border bg-background px-3 py-2 text-sm" /></label>
        <label className="block space-y-1"><span className="text-sm font-medium">Local</span><input maxLength={500} value={form.location} onChange={(event) => set("location", event.target.value)} className="h-10 w-full rounded-md border bg-background px-3 text-sm" /></label>
        <label className="flex items-center gap-2 text-sm"><input type="checkbox" checked={form.all_day} onChange={(event) => set("all_day", event.target.checked)} />Dia inteiro</label>
        <div className={`grid gap-3 ${form.all_day ? "sm:grid-cols-2" : "sm:grid-cols-3"}`}>
          <label className="block space-y-1"><span className="text-sm font-medium">Data</span><input required type="date" value={form.start_date} onChange={(event) => set("start_date", event.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm" /></label>
          <label className="block space-y-1"><span className="text-sm font-medium">{form.all_day ? "Último dia" : "Data de término"}</span><input required type="date" min={form.start_date} value={form.end_date} onChange={(event) => set("end_date", event.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm" /></label>
          {!form.all_day && <><label className="block space-y-1"><span className="text-sm font-medium">Início</span><input required type="time" value={form.start_time} onChange={(event) => set("start_time", event.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm" /></label><label className="block space-y-1"><span className="text-sm font-medium">Término</span><input required type="time" value={form.end_time} onChange={(event) => set("end_time", event.target.value)} className="h-10 w-full rounded-md border bg-background px-2 text-sm" /></label></>}
        </div>
        {(validation || error) && <p role="alert" className="text-sm text-destructive">{validation || error}</p>}
        <DialogFooter><button type="button" disabled={saving} onClick={() => onOpenChange(false)} className="h-9 rounded-md border px-3 text-sm">Cancelar</button><button type="submit" disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-50">{saving && <LoaderCircle className="h-4 w-4 animate-spin" />}Salvar</button></DialogFooter>
      </form>
    </DialogContent>
  </Dialog>;
}

export default function Agenda() {
  const { clients, clientDemands, loading: clientLoading, error: clientError, saveClientDemand, refreshClientDemands } = useAppData();
  const { toast } = useToast();
  const [selectedDate, setSelectedDate] = useState(() => new Date());
  const [view, setView] = useState("week");
  const [initialCache] = useState(() => {
    const initialPeriod = periodFor(new Date(), "week");
    return readAgendaWeekCache(key(initialPeriod.from), key(initialPeriod.to));
  });
  const [agendaRows, setAgendaRows] = useState(() => initialCache?.agendaRows || []);
  const [agendaDemands, setAgendaDemands] = useState(() => initialCache?.clientDemands || clientDemands);
  const [googleCalendarEvents, setGoogleCalendarEvents] = useState(() => initialCache?.googleCalendarEvents || []);
  const [subidoProEvents, setSubidoProEvents] = useState(() => initialCache?.subidoProEvents || []);
  const [showSubidoPro, setShowSubidoPro] = useState(true);
  const [subidoProError, setSubidoProError] = useState("");
  const [googleCalendarLinks, setGoogleCalendarLinks] = useState(() => initialCache?.googleCalendarLinks || []);
  const [eventColorOverrides, setEventColorOverrides] = useState(() => initialCache?.eventColorOverrides || {});
  const [optimisticItemUpdates, setOptimisticItemUpdates] = useState({});
  const [pendingDeletionKeys, setPendingDeletionKeys] = useState(() => new Set());
  const [googleCalendarConfigured, setGoogleCalendarConfigured] = useState(() => Boolean(initialCache?.googleCalendarConfigured));
  const [googleConnection, setGoogleConnection] = useState(() => initialCache?.googleConnection || { configured: false, connected: false, writeAccess: false, colorReadAccess: false, watchActive: false, missingConfiguration: [] });
  const [googleColorWarning, setGoogleColorWarning] = useState("");
  const [prospects, setProspects] = useState(() => initialCache?.prospects || []);
  const [planningListOpen, setPlanningListOpen] = useState(false);
  const [scheduledDraftId, setScheduledDraftId] = useState("");
  const [schedulingDraftId, setSchedulingDraftId] = useState("");
  const [loading, setLoading] = useState(() => !initialCache);
  const [errors, setErrors] = useState([]);
  const [filters, setFilters] = useState({ area: "all", origin: "all", client: "all", status: "all", type: "all" });
  const [filtersExpanded, setFiltersExpanded] = useState(false);
  const [allDayExpanded, setAllDayExpanded] = useState(false);
  const [dragPreview, setDragPreview] = useState(null);
  const [draftDragPreview, setDraftDragPreview] = useState(null);
  const [activeDraftDrag, setActiveDraftDrag] = useState(null);
  const [createPreview, setCreatePreview] = useState(null);
  const [quickCreateDraft, setQuickCreateDraft] = useState(null);
  const [formOpen, setFormOpen] = useState(false);
  const [formInitial, setFormInitial] = useState(null);
  const [saving, setSaving] = useState(false);
  const [formError, setFormError] = useState("");
  const [googleFormOpen, setGoogleFormOpen] = useState(false);
  const [googleFormInitial, setGoogleFormInitial] = useState(null);
  const [googleFormError, setGoogleFormError] = useState("");
  const [detail, setDetail] = useState(null);
  const [acquisitionGroup, setAcquisitionGroup] = useState(null);
  const [quickActionsItem, setQuickActionsItem] = useState(null);
  const [quickActionsMode, setQuickActionsMode] = useState("details");
  const [busyId, setBusyId] = useState("");
  const [actionError, setActionError] = useState("");
  const [scheduleForm, setScheduleForm] = useState({ date: "", startTime: "", endTime: "" });
  const [authorizationNotice, setAuthorizationNotice] = useState("");
  const timelineRef = useRef(null);
  const calendarGestureRef = useRef(null);
  const dragEdgePageTimerRef = useRef(null);
  const dragEdgePageDirectionRef = useRef(0);
  const createGestureRef = useRef(null);
  const suppressCalendarClickRef = useRef(false);
  const loadedRangeRef = useRef(initialCache ? { from: key(periodFor(new Date(), "week").from), until: key(periodFor(new Date(), "week").to) } : null);
  const loadRequestRef = useRef(0);
  const deletionTimersRef = useRef(new Map());
  const todayKey = key(new Date());
  const period = useMemo(() => periodFor(selectedDate, view), [selectedDate, view]);
  const from = key(period.from); const until = key(period.to); const selectedKey = key(selectedDate);
  const clientList = useMemo(() => Object.values(clients), [clients]);
  const activeClients = useMemo(() => clientList.filter((client) => Boolean(client.active)), [clientList]);
  const activeIds = useMemo(() => new Set(activeClients.map((client) => String(client.id))), [activeClients]);
  const clientsById = useMemo(() => Object.fromEntries(clientList.map((client) => [String(client.id), client])), [clientList]);

  const load = useCallback(async () => {
    const requestId = ++loadRequestRef.current;
    const cached = readAgendaWeekCache(from, until);
    if (cached) {
      setAgendaRows(cached.agendaRows || []);
      setAgendaDemands(cached.clientDemands || []);
      setProspects(cached.prospects || []);
      setGoogleCalendarEvents(cached.googleCalendarEvents || []);
      setSubidoProEvents(cached.subidoProEvents || []);
      setGoogleCalendarLinks(cached.googleCalendarLinks || []);
      setGoogleCalendarConfigured(Boolean(cached.googleCalendarConfigured));
      setGoogleConnection(cached.googleConnection || { configured: false, connected: false, writeAccess: false, colorReadAccess: false, watchActive: false, missingConfiguration: [] });
      setEventColorOverrides(cached.eventColorOverrides || {});
      loadedRangeRef.current = { from, until };
      setLoading(false);
    } else {
      clearAgendaWeekCache();
      setLoading(true);
    }
    setErrors([]);
    const results = await Promise.allSettled([
      getGoogleCalendarEvents({ from, until }),
      getSubidoProCalendarEvents({ from, until }),
      getAgendaItems({ from, until }),
      getProspects(),
      getGoogleCalendarConnection(),
      refreshClientDemands(),
      getAgendaItemColors(),
    ]);
    if (requestId !== loadRequestRef.current) return false;
    const nextErrors = [];
    const [googleResult, subidoProResult, agendaResult, prospectsResult, connectionResult, demandsResult, colorsResult] = results;
    const sourceResults = [googleResult, subidoProResult, agendaResult, prospectsResult, demandsResult];
    if (sourceResults.every((result) => result.status === "fulfilled")) {
      setGoogleCalendarEvents(googleResult.value.events || []);
      setSubidoProEvents(subidoProResult.value.events || []);
      setAgendaRows(agendaResult.value);
      setProspects(prospectsResult.value);
      setAgendaDemands(demandsResult.value);
      setGoogleCalendarLinks(googleResult.value.linkedSources || []);
      setGoogleCalendarConfigured(Boolean(googleResult.value.configured));
      setGoogleColorWarning((googleResult.value.events || []).find((event) => event.color_warning)?.color_warning || "");
      setSubidoProError("");
      setOptimisticItemUpdates({});
    } else {
      if (googleResult.status === "rejected") nextErrors.push(`Google Agenda: ${googleResult.reason?.message || "falha ao carregar."}`);
      if (subidoProResult.status === "rejected") {
        const message = subidoProResult.reason?.message || "falha ao carregar.";
        setSubidoProError(message);
        nextErrors.push(`Subido PRO: ${message}`);
      }
      if (agendaResult.status === "rejected") nextErrors.push(`Agenda: ${agendaResult.reason?.message || "falha ao carregar."}`);
      if (prospectsResult.status === "rejected") nextErrors.push(`Aquisição: ${prospectsResult.reason?.message || "falha ao carregar."}`);
      if (demandsResult.status === "rejected") nextErrors.push(`Demandas: ${demandsResult.reason?.message || "falha ao atualizar."}`);
    }
    if (connectionResult.status === "fulfilled") setGoogleConnection(connectionResult.value);
    else nextErrors.push(`Conexão Google: ${connectionResult.reason?.message || "falha ao verificar."}`);
    let nextColorOverrides;
    if (colorsResult.status === "fulfilled") {
      nextColorOverrides = Object.fromEntries(colorsResult.value.map(({ sourceType, sourceId, colorId }) => [`${sourceType}:${sourceId}`, colorId]));
      setEventColorOverrides(nextColorOverrides);
    } else nextErrors.push(`Cores da Agenda: ${colorsResult.reason?.message || "falha ao carregar."}`);
    const refreshedSuccessfully = results.every((result) => result.status === "fulfilled");
    if (refreshedSuccessfully) {
      writeAgendaWeekCache(from, until, {
        agendaRows: agendaResult.value,
        clientDemands: demandsResult.value,
        prospects: prospectsResult.value,
        googleCalendarEvents: googleResult.value.events || [],
        subidoProEvents: subidoProResult.value.events || [],
        googleCalendarLinks: googleResult.value.linkedSources || [],
        googleCalendarConfigured: Boolean(googleResult.value.configured),
        googleConnection: connectionResult.value,
        eventColorOverrides: nextColorOverrides,
      });
    }
    setErrors(nextErrors);
    loadedRangeRef.current = { from, until };
    setLoading(false);
    return refreshedSuccessfully;
  }, [from, until, refreshClientDemands]);
  useEffect(() => { load(); }, [load]);
  useEffect(() => {
    const url = new URL(window.location.href);
    const authorizationResult = url.searchParams.get("google_calendar");
    if (!authorizationResult) return;
    if (authorizationResult === "connected") {
      setAuthorizationNotice("Conta Google autorizada. A sincronização de eventos será iniciada.");
    } else {
      setActionError(url.searchParams.get("google_calendar_message") || "Não foi possível concluir a autorização do Google.");
    }
    url.searchParams.delete("google_calendar");
    url.searchParams.delete("google_calendar_message");
    window.history.replaceState({}, "", `${url.pathname}${url.search}${url.hash}`);
  }, []);
  const refreshGoogleCalendar = useCallback(async () => {
    const results = await Promise.allSettled([
      getGoogleCalendarEvents({ from, until }),
      getSubidoProCalendarEvents({ from, until }),
      getAgendaItems({ from, until }),
      getProspects(),
      getGoogleCalendarConnection(),
      refreshClientDemands(),
      getAgendaItemColors(),
    ]);
    const [googleResult, subidoProResult, agendaResult, prospectsResult, connectionResult, demandsResult, colorsResult] = results;
    const sourceResults = [googleResult, subidoProResult, agendaResult, prospectsResult, demandsResult];
    if (sourceResults.every((result) => result.status === "fulfilled")) {
      setGoogleCalendarEvents(googleResult.value.events || []);
      setSubidoProEvents(subidoProResult.value.events || []);
      setAgendaRows(agendaResult.value);
      setProspects(prospectsResult.value);
      setAgendaDemands(demandsResult.value);
      setGoogleCalendarLinks(googleResult.value.linkedSources || []);
      setGoogleCalendarConfigured(Boolean(googleResult.value.configured));
      setGoogleColorWarning((googleResult.value.events || []).find((event) => event.color_warning)?.color_warning || "");
      setSubidoProError("");
      setOptimisticItemUpdates({});
    }

    const nextErrors = [];
    if (googleResult.status === "rejected") nextErrors.push(`Google Agenda: ${googleResult.reason?.message || "falha ao atualizar."}`);
    if (subidoProResult.status === "rejected") {
      const message = subidoProResult.reason?.message || "falha ao atualizar.";
      setSubidoProError(message);
      nextErrors.push(`Subido PRO: ${message}`);
    }
    if (agendaResult.status === "rejected") nextErrors.push(`Agenda: ${agendaResult.reason?.message || "falha ao atualizar."}`);
    if (prospectsResult.status === "rejected") nextErrors.push(`Aquisição: ${prospectsResult.reason?.message || "falha ao atualizar."}`);
    if (connectionResult.status === "fulfilled") setGoogleConnection(connectionResult.value);
    else nextErrors.push(`Conexão Google: ${connectionResult.reason?.message || "falha ao verificar."}`);
    if (demandsResult.status === "rejected") nextErrors.push(`Demandas: ${demandsResult.reason?.message || "falha ao atualizar."}`);
    let nextColorOverrides;
    if (colorsResult.status === "fulfilled") {
      nextColorOverrides = Object.fromEntries(colorsResult.value.map(({ sourceType, sourceId, colorId }) => [`${sourceType}:${sourceId}`, colorId]));
      setEventColorOverrides(nextColorOverrides);
    } else nextErrors.push(`Cores da Agenda: ${colorsResult.reason?.message || "falha ao atualizar."}`);

    if (results.every((result) => result.status === "fulfilled")) {
      writeAgendaWeekCache(from, until, {
        agendaRows: agendaResult.value,
        clientDemands: demandsResult.value,
        prospects: prospectsResult.value,
        googleCalendarEvents: googleResult.value.events || [],
        subidoProEvents: subidoProResult.value.events || [],
        googleCalendarLinks: googleResult.value.linkedSources || [],
        googleCalendarConfigured: Boolean(googleResult.value.configured),
        googleConnection: connectionResult.value,
        eventColorOverrides: nextColorOverrides,
      });
    }
    setErrors(nextErrors);
  }, [from, until, refreshClientDemands]);
  useEffect(() => {
    if (!detail || !["client_demand", "prospect"].includes(detail.source)) return;
    setScheduleForm({
      date: itemDate(detail) || "",
      startTime: detail.startTime || "",
      endTime: detail.endTime || "",
    });
  }, [detail]);
  useEffect(() => {
    if (!googleConnection.connected) return undefined;
    const socket = io({ auth: getWhatsAppCredentials() });
    const refreshIfVisible = () => {
      if (!document.hidden) refreshGoogleCalendar();
    };
    socket.on("google-calendar:changed", refreshIfVisible);
    document.addEventListener("visibilitychange", refreshIfVisible);
    const fallback = window.setInterval(refreshIfVisible, 30_000);
    return () => {
      document.removeEventListener("visibilitychange", refreshIfVisible);
      window.clearInterval(fallback);
      socket.disconnect();
    };
  }, [googleConnection.connected, refreshGoogleCalendar]);
  const startGoogleConnection = async () => {
    try {
      const { authorizationUrl } = await connectGoogleCalendar();
      window.location.assign(authorizationUrl);
    } catch (error) {
      setActionError(error.message || "Não foi possível iniciar a conexão com o Google.");
    }
  };
  const renewGoogleNotifications = async () => {
    try {
      await renewGoogleCalendarWatch();
      await refreshGoogleCalendar();
      toast({ title: "Notificações do Google Agenda ativadas." });
    } catch (error) {
      setActionError(error.message || "Não foi possível ativar as notificações do Google.");
    }
  };

  const items = useMemo(() => {
    const linkedEvents = new Map(googleCalendarEvents
      .filter((event) => event.source_type && event.source_id != null)
      .map((event) => [`${event.source_type}:${event.source_id}`, event]));
    const archivedSources = new Set(googleCalendarLinks
      .filter((source) => source.archived)
      .map((source) => `${source.sourceType}:${source.sourceId}`));
    const local = agendaRows.filter((record) => !archivedSources.has(`agenda:${record.id}`)).map((record) => {
      const synced = linkedEvents.get(`agenda:${record.id}`);
      return ({
      key: `agenda-${record.id}`, id: record.id, source: "agenda", record,
      googleEventId: synced?.id || null,
      meetLink: synced?.meet_link || null,
      colorId: synced ? synced.color_id : eventColorOverrides[`agenda:${record.id}`] || null,
      googleColor: synced?.color_hex || null, googleTextColor: synced?.color_foreground || null,
      itemType: record.item_type, title: synced?.title || record.title, description: synced?.description ?? record.description ?? "", observations: record.observations || "",
      area: record.area, domain: record.area, category: record.category || "", plannedDate: synced?.start_date || record.planned_date, dueDate: record.planned_date ? record.due_date : synced?.start_date || record.due_date,
      startTime: synced?.start_time ?? record.start_time, endTime: synced?.end_time ?? record.end_time, allDay: synced?.all_day ?? (!record.start_time && !record.end_time), priority: record.priority, status: record.status,
      clientId: record.client_id, clientName: record.client_id ? clientsById[String(record.client_id)]?.name || "Cliente" : "",
      sourceLabel: record.area === "personal" ? "Pessoal" : "Profissional", link: null,
      canComplete: record.item_type === "task" && openTask({ itemType: "task", status: record.status }),
      canMove: true,
    });});
    const business = agendaDemands.filter((demand) => activeIds.has(String(demand.client_id)) && !archivedSources.has(`client_demand:${demand.id}`)).map((record) => {
      const synced = linkedEvents.get(`client_demand:${record.id}`);
      return ({
      key: `demand-${record.id}`, id: record.id, source: "client_demand", record, itemType: "task",
      googleEventId: synced?.id || null,
      meetLink: synced?.meet_link || null,
      colorId: synced ? synced.color_id : eventColorOverrides[`client_demand:${record.id}`] || null,
      googleColor: synced?.color_hex || null, googleTextColor: synced?.color_foreground || null,
      title: synced?.title || record.title, description: synced?.description ?? record.observation ?? "", observations: synced?.description ?? record.observation ?? "", area: "professional", domain: "business",
      category: DEMAND_TYPES[record.type] || "Demanda", plannedDate: null, dueDate: synced?.start_date || String(record.demand_date || "").slice(0, 10),
      startTime: synced?.start_time ?? record.start_time ?? null, endTime: synced?.end_time ?? record.end_time ?? null, allDay: synced?.all_day ?? (!record.start_time && !record.end_time), priority: null, status: record.status || "pending", clientId: record.client_id,
      clientName: clientsById[String(record.client_id)]?.name || "Cliente", sourceLabel: "Negócio", link: "/gestao-clientes?view=calendar",
      canComplete: !["completed", "not_done"].includes(record.status),
      canMove: true,
    });});
    const sales = prospects.filter((p) => p.next_action_date && !p.is_won && !p.is_lost && !archivedSources.has(`prospect:${p.id}`)).map((record) => {
      const synced = linkedEvents.get(`prospect:${record.id}`);
      return ({
      key: `prospect-${record.id}`, id: record.id, source: "prospect", record, itemType: "task",
      googleEventId: synced?.id || null,
      meetLink: synced?.meet_link || null,
      colorId: synced ? synced.color_id : eventColorOverrides[`prospect:${record.id}`] || null,
      googleColor: synced?.color_hex || null, googleTextColor: synced?.color_foreground || null,
      title: synced?.title || record.next_action || "Ação comercial", description: synced?.description ?? record.notes ?? "", observations: "", area: "professional", domain: "acquisition",
      category: "Follow-up comercial", plannedDate: null, dueDate: synced?.start_date || String(record.next_action_date).slice(0, 10),
      startTime: synced?.start_time ?? record.next_action_start_time ?? null, endTime: synced?.end_time ?? record.next_action_end_time ?? null, allDay: synced?.all_day ?? (!record.next_action_start_time && !record.next_action_end_time), priority: null, status: "pending", clientId: null, clientName: record.company_name,
      sourceLabel: "Aquisição", link: "/aquisicao", canComplete: COMPLETABLE.has(record.next_action),
      canMove: !["triage_scheduled", "proposal_scheduled"].includes(record.stage_key),
    });});
    const google = googleCalendarEvents.filter((record) => !record.source_type).map((record) => ({
      key: `google-${record.id}`, id: record.id, source: "google_calendar", record, itemType: "appointment",
      meetLink: record.meet_link || null,
      colorId: record.color_id || null,
      googleColor: record.color_hex || null, googleTextColor: record.color_foreground || null,
      title: record.title, description: record.description || "", observations: record.location || "",
      area: "personal", domain: "google_calendar", category: record.location || "Google Agenda",
      plannedDate: record.start_date, endDateExclusive: record.end_date_exclusive,
      dueDate: null, startTime: record.start_time, endTime: record.end_time, allDay: record.all_day,
      priority: null, status: "scheduled", clientId: null, clientName: "",
      sourceLabel: "Google Agenda", link: null, canComplete: false, canMove: false,
    }));
    const subidoPro = showSubidoPro ? subidoProEvents.map((record) => ({
      key: `subido-pro-${record.id}`, id: record.id, source: "subido_pro", record, itemType: "appointment",
      title: record.title, description: record.description || "", observations: record.location || "",
      area: "personal", domain: "google_calendar", category: "Subido PRO",
      plannedDate: record.start_date, endDateExclusive: record.end_date_exclusive,
      dueDate: null, startTime: record.start_time, endTime: record.end_time, allDay: record.all_day,
      priority: null, status: "scheduled", clientId: null, clientName: "",
      googleColor: "#352ef2", googleTextColor: "#ffffff",
      sourceLabel: "Subido PRO", link: null, canComplete: false, canMove: false,
    })) : [];
    return [...local, ...business, ...sales, ...google, ...subidoPro]
      .map((item) => ({ ...item, ...optimisticItemUpdates[item.key] }))
      .filter((item) => !pendingDeletionKeys.has(item.key));
  }, [agendaRows, agendaDemands, prospects, googleCalendarEvents, subidoProEvents, showSubidoPro, googleCalendarLinks, clientsById, activeIds, eventColorOverrides, optimisticItemUpdates, pendingDeletionKeys]);

  const areas = [...new Set(items.map((item) => item.area))];
  const origins = [...new Set(items.map((item) => item.domain))];
  const statuses = [...new Set(items.map((item) => item.status))];
  const clientOptions = useMemo(() => {
    const ids = [...new Set(items.map((item) => item.clientId).filter(Boolean).map(String))];
    return ids.map((id) => ({ id, name: clientsById[id]?.name || items.find((item) => String(item.clientId) === id)?.clientName || "Cliente" })).sort((a, b) => a.name.localeCompare(b.name, "pt-BR"));
  }, [items, clientsById]);
  const filtered = useMemo(() => items.filter((item) => {
    const date = itemDate(item);
    const overdueStandalone = openTask(item) && itemDate(item) && itemDate(item) < from && itemDate(item) <= until;
    const overlapsPeriod = item.source === "google_calendar" || item.source === "subido_pro"
      ? item.plannedDate <= until && item.endDateExclusive > from
      : date >= from && date <= until;
    return date && (overlapsPeriod || overdueStandalone) && (filters.area === "all" || item.area === filters.area) &&
      (filters.origin === "all" || item.domain === filters.origin) && (filters.client === "all" || String(item.clientId || "") === filters.client) &&
      (filters.status === "all" || item.status === filters.status) && (filters.type === "all" || item.itemType === filters.type);
  }), [items, from, until, filters]);
  const getDayItems = useCallback((day) => filtered.filter((item) => occursOnDate(item, day)).sort((a, b) => String(a.startTime || "99:99").localeCompare(String(b.startTime || "99:99")) || a.title.localeCompare(b.title, "pt-BR")), [filtered]);
  const visibleDays = useMemo(() => eachDayOfInterval({ start: period.from, end: period.to }), [period]);
  const timelineDays = view === "day" ? [selectedDate] : visibleDays;
  const selectedItems = getDayItems(selectedKey);
  const overdue = filtered.filter((item) => openTask(item) && itemDate(item) && itemDate(item) < todayKey).sort((a, b) => itemDate(a).localeCompare(itemDate(b)));
  const title = view === "day"
    ? format(selectedDate, "EEEE, d 'de' MMMM yyyy", { locale: ptBR })
    : view === "week"
      ? `Mês de ${format(selectedDate, "MMMM yyyy", { locale: ptBR })}`
      : format(selectedDate, "MMMM yyyy", { locale: ptBR });

  const move = (direction) => setSelectedDate((date) => view === "day" ? addDays(date, direction) : view === "week" ? addWeeks(date, direction) : addMonths(date, direction));
  useEffect(() => {
    if (!loading && (view === "day" || view === "week")) timelineRef.current?.scrollTo({ top: 7 * HOUR_HEIGHT });
  }, [view, loading]);
  const newItem = (type) => { setFormInitial({ item_type: type }); setFormError(""); setFormOpen(true); };
  const editItem = (item) => { setFormInitial(item); setDetail(null); setFormError(""); setFormOpen(true); };
  const saveItem = async (payload) => {
    setSaving(true); setFormError("");
    try {
      if (formInitial?.source === "agenda") await updateAgendaItem(formInitial.id, payload);
      else {
        await createAgendaItem(payload);
        const newDate = payload.planned_date || payload.due_date;
        if (newDate) setSelectedDate(dateFrom(newDate));
      }
      setFormOpen(false); toast({ title: formInitial?.source === "agenda" ? "Item atualizado." : "Item adicionado à agenda." });
      await load();
    } catch (error) { setFormError(error.message || "Não foi possível salvar o item."); }
    finally { setSaving(false); }
  };
  const saveQuickAppointment = async (title) => {
    if (!quickCreateDraft || !title) return;
    setSaving(true);
    try {
      await createAgendaItem({
        item_type: "appointment",
        title,
        description: "",
        area: "personal",
        category: "",
        planned_date: quickCreateDraft.date,
        due_date: null,
        start_time: quickCreateDraft.startTime,
        end_time: quickCreateDraft.endTime,
        priority: "normal",
        status: "scheduled",
        observations: "",
        client_id: null,
      });
      setQuickCreateDraft(null);
      toast({ title: "Compromisso adicionado à agenda." });
      await load();
    } catch (error) {
      setActionError(error.message || "Não foi possível criar o compromisso.");
    } finally {
      setSaving(false);
    }
  };
  const scheduleDraftItem = async (draft, date, startMinute) => {
    if (schedulingDraftId) return;
    const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    const endMinute = startMinute + 60;
    setSchedulingDraftId(draft.id);
    setActionError("");
    try {
      await createAgendaItem({
        item_type: "appointment",
        title: draft.text,
        description: "",
        area: "personal",
        category: "",
        planned_date: date,
        due_date: null,
        start_time: toTime(startMinute),
        end_time: toTime(endMinute),
        priority: "normal",
        status: "scheduled",
        observations: "",
        client_id: null,
      });
      setScheduledDraftId(draft.id);
      await load();
      toast({ title: "Compromisso agendado.", description: draft.text });
    } catch (error) {
      setActionError(error.message || "Não foi possível agendar esta linha.");
    } finally {
      setSchedulingDraftId("");
    }
  };
  const timeRangeAtDrop = (event, cell) => {
    const bounds = cell.getBoundingClientRect();
    const minute = Math.floor((((event.clientY - bounds.top) / HOUR_HEIGHT) * 60) / 15) * 15;
    const start = Math.max(0, Math.min(22 * 60 + 45, minute));
    const end = Math.min(start + 60, 23 * 60 + 59);
    const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { start, end, startTime: toTime(start), endTime: toTime(end) };
  };
  const clearDragEdgePage = () => {
    if (dragEdgePageTimerRef.current !== null) {
      window.clearTimeout(dragEdgePageTimerRef.current);
      dragEdgePageTimerRef.current = null;
    }
    dragEdgePageDirectionRef.current = 0;
  };
  const pageCalendarAtPosition = (clientX, activeDrag) => {
    if (!activeDrag) {
      clearDragEdgePage();
      return;
    }
    const bounds = timelineRef.current?.getBoundingClientRect();
    if (!bounds?.width) {
      clearDragEdgePage();
      return;
    }
    const edgeWidth = Math.min(64, bounds.width / 5);
    const direction = clientX <= bounds.left + edgeWidth
      ? -1
      : clientX >= bounds.right - edgeWidth ? 1 : 0;
    if (!direction) {
      clearDragEdgePage();
      return;
    }
    if (dragEdgePageDirectionRef.current === direction && dragEdgePageTimerRef.current !== null) return;
    clearDragEdgePage();
    dragEdgePageDirectionRef.current = direction;
    dragEdgePageTimerRef.current = window.setTimeout(() => {
      dragEdgePageTimerRef.current = null;
      dragEdgePageDirectionRef.current = 0;
      const gesture = calendarGestureRef.current;
      const active = gesture?.allDayItem?.itemType === "task"
        || (gesture?.item?.itemType === "task" && gesture.mode === "move" && gesture.moved);
      if (!active) return;
      setSelectedDate((date) => view === "day"
        ? addDays(date, direction)
        : addWeeks(date, direction));
    }, 650);
  };
  const pageCalendarAtDragEdge = (event) => {
    const item = calendarGestureRef.current?.allDayItem;
    const active = item?.itemType === "task"
      && Array.from(event.dataTransfer.types).includes(CALENDAR_ITEM_DRAG_TYPE);
    pageCalendarAtPosition(event.clientX, active);
  };
  const planningDragOver = (event) => {
    const types = Array.from(event.dataTransfer.types);
    const date = event.currentTarget.getAttribute("data-calendar-date");
    if (types.includes(CALENDAR_ITEM_DRAG_TYPE)) {
      const item = calendarGestureRef.current?.allDayItem;
      if (!item || item.itemType !== "task" || !date) return;
      event.preventDefault();
      event.dataTransfer.dropEffect = "move";
      const { start, end, startTime, endTime } = timeRangeAtDrop(event, event.currentTarget);
      setDragPreview({
        itemKey: item.key,
        originDate: itemDate(item),
        date,
        start,
        end,
        startTime,
        endTime,
        title: item.title,
        fromAllDay: true,
      });
      return;
    }
    if (!types.includes(AGENDA_DRAFT_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const cell = event.currentTarget;
    if (!activeDraftDrag || !date) return;
    const { start, end, startTime, endTime } = timeRangeAtDrop(event, cell);
    setDraftDragPreview({
      date,
      title: activeDraftDrag.text,
      start,
      end,
      startTime,
      endTime,
    });
  };
  const planningDrop = async (event) => {
    clearDragEdgePage();
    const types = Array.from(event.dataTransfer.types);
    if (types.includes(CALENDAR_ITEM_DRAG_TYPE)) {
      event.preventDefault();
      const item = calendarGestureRef.current?.allDayItem;
      const dragKey = event.dataTransfer.getData(CALENDAR_ITEM_DRAG_TYPE);
      const cell = event.currentTarget;
      const date = cell.getAttribute("data-calendar-date");
      calendarGestureRef.current = null;
      setDragPreview(null);
      if (!item || item.itemType !== "task" || item.key !== dragKey || !date) return;
      const { startTime, endTime } = timeRangeAtDrop(event, cell);
      setQuickActionsItem(null);
      setActionError("");
      setBusyId(item.key);
      optimisticallyMoveItem(item, date, startTime, endTime);
      try {
        await moveCalendarItem(item, date, startTime, endTime);
        await load();
        toast({ title: "Tarefa agendada com horário." });
      } catch (error) {
        discardOptimisticItemUpdate(item.key);
        setActionError(error.message || "Não foi possível agendar a tarefa.");
      } finally {
        setBusyId("");
      }
      return;
    }
    if (!types.includes(AGENDA_DRAFT_DRAG_TYPE)) return;
    event.preventDefault();
    setDraftDragPreview(null);
    setActiveDraftDrag(null);
    const draft = readAgendaDraftDrag(event.dataTransfer);
    const cell = event.currentTarget;
    const date = cell.getAttribute("data-calendar-date");
    if (!draft || !date) {
      setActionError("Não foi possível ler a linha arrastada. Tente novamente.");
      return;
    }
    const { start } = timeRangeAtDrop(event, cell);
    void scheduleDraftItem(draft, date, start);
  };
  const clearDraftDragPreview = () => {
    setActiveDraftDrag(null);
    setDraftDragPreview(null);
  };
  const openQuickCreateOptions = () => {
    if (!quickCreateDraft) return;
    setFormInitial({
      item_type: "appointment",
      planned_date: quickCreateDraft.date,
      start_time: quickCreateDraft.startTime,
      end_time: quickCreateDraft.endTime,
    });
    setFormError("");
    setQuickCreateDraft(null);
    setFormOpen(true);
  };
  const saveGoogleEvent = async (payload) => {
    if (!googleFormInitial) return;
    setSaving(true);
    setGoogleFormError("");
    try {
      await updateGoogleCalendarEvent(googleFormInitial.id, payload);
      setGoogleFormOpen(false);
      setGoogleFormInitial(null);
      await load();
      toast({ title: "Evento do Google atualizado." });
    } catch (error) {
      setGoogleFormError(error.message || "Não foi possível atualizar o evento do Google.");
    } finally {
      setSaving(false);
    }
  };
  const editGoogleEvent = (item) => {
    setDetail(null);
    setGoogleFormInitial(item);
    setGoogleFormError("");
    setGoogleFormOpen(true);
  };
  const showCalendarItemPopup = (item, mode) => {
    setQuickActionsItem(item);
    setQuickActionsMode(mode);
  };
  const openAcquisitionTask = (item) => {
    setAcquisitionGroup(null);
    setActionError("");
    setDetail(item);
  };
  const toggleCalendarItemPopup = (item, mode) => {
    if (quickActionsItem?.key === item.key && quickActionsMode === mode) {
      setQuickActionsItem(null);
      return;
    }
    showCalendarItemPopup(item, mode);
  };
  const editCalendarItem = (item) => {
    setQuickActionsItem(null);
    if (item.source === "agenda") {
      editItem(item);
    } else if (item.source === "google_calendar") {
      editGoogleEvent(item);
    } else {
      setActionError("");
      setDetail(item);
    }
  };
  const optimisticallyMoveItem = (item, date, startTime, endTime, allDay = false) => {
    const updates = {
      plannedDate: date,
      dueDate: item.source === "agenda" ? item.dueDate : date,
      startTime: allDay ? null : startTime,
      endTime: allDay ? null : endTime,
      allDay,
    };
    if (item.source === "google_calendar") {
      const durationDays = Math.max(1,
        Math.round((dateFrom(item.endDateExclusive) - dateFrom(item.plannedDate)) / 86_400_000));
      updates.endDateExclusive = key(addDays(dateFrom(date), durationDays));
    }
    setOptimisticItemUpdates((current) => ({ ...current, [item.key]: updates }));
  };
  const discardOptimisticItemUpdate = (itemKey) => {
    setOptimisticItemUpdates((current) => {
      const next = { ...current };
      delete next[itemKey];
      return next;
    });
  };
  const moveCalendarItem = async (item, date, startTime, endTime) => {
    if (item.source === "google_calendar") {
      const durationDays = Math.max(1,
        Math.round((dateFrom(item.endDateExclusive) - dateFrom(item.plannedDate)) / 86_400_000));
      await updateGoogleCalendarEvent(item.id, {
        title: item.title,
        description: item.description,
        location: item.record.location || "",
        all_day: false,
        start_date: date,
        end_date_exclusive: key(addDays(dateFrom(date), durationDays)),
        end_date: key(addDays(dateFrom(date), Math.max(0,
          Math.round((dateFrom(item.record.end_date || item.plannedDate) - dateFrom(item.plannedDate)) / 86_400_000)))),
        start_time: startTime,
        end_time: endTime,
      });
    } else if (item.source === "agenda") {
      await updateAgendaItem(item.id, { planned_date: date, start_time: startTime, end_time: endTime });
    } else if (item.source === "client_demand") {
      await saveClientDemand(item.id, { demand_date: date, start_time: startTime, end_time: endTime });
    } else if (item.source === "prospect") {
      const prospect = await updateProspect(item.id, {
        next_action_date: date,
        next_action_start_time: startTime,
        next_action_end_time: endTime,
      });
      setProspects((current) => current.map((record) => record.id === prospect.id ? prospect : record));
    }
  };
  const moveAllDayItem = async (item, date) => {
    if (item.source === "google_calendar") {
      const durationDays = Math.max(1,
        Math.round((dateFrom(item.endDateExclusive) - dateFrom(item.plannedDate)) / 86_400_000));
      await updateGoogleCalendarEvent(item.id, {
        title: item.title,
        description: item.description,
        location: item.record.location || "",
        all_day: true,
        start_date: date,
        end_date_exclusive: key(addDays(dateFrom(date), durationDays)),
      });
    } else if (item.source === "agenda") {
      await updateAgendaItem(item.id, { planned_date: date });
    } else if (item.source === "client_demand") {
      await saveClientDemand(item.id, { demand_date: date });
    } else if (item.source === "prospect") {
      const prospect = await updateProspect(item.id, { next_action_date: date });
      setProspects((current) => current.map((record) => record.id === prospect.id ? prospect : record));
    }
    await load();
    toast({ title: "Evento movido para outra data." });
  };
  const startAllDayItemDrag = (event, item) => {
    calendarGestureRef.current = { allDayItem: item };
    suppressCalendarClickRef.current = true;
    event.dataTransfer.effectAllowed = "move";
    if (item.itemType === "task") event.dataTransfer.setData(CALENDAR_ITEM_DRAG_TYPE, item.key);
    event.dataTransfer.setData("text/plain", item.key);
  };
  const endAllDayItemDrag = () => {
    clearDragEdgePage();
    window.setTimeout(() => { suppressCalendarClickRef.current = false; }, 500);
    window.setTimeout(() => {
      if (calendarGestureRef.current?.allDayItem) calendarGestureRef.current = null;
      setDragPreview(null);
    }, 0);
  };
  const dropAllDayItem = async (event, date) => {
    clearDragEdgePage();
    event.preventDefault();
    const item = calendarGestureRef.current?.allDayItem;
    calendarGestureRef.current = null;
    if (!item || itemDate(item) === date) return;
    setBusyId(item.key);
    setActionError("");
    setQuickActionsItem(null);
    optimisticallyMoveItem(item, date, null, null, true);
    try {
      await moveAllDayItem(item, date);
    } catch (error) {
      discardOptimisticItemUpdate(item.key);
      setActionError(error.message || "Não foi possível mover o evento.");
    } finally {
      setBusyId("");
    }
  };
  const calendarPointerDown = (event, item) => {
    if (event.button !== 0 || !item.startTime || !item.endTime) return;
    const target = event.target instanceof Element ? event.target : null;
    const resizing = Boolean(target?.closest("[data-calendar-resize-handle]"));
    const cell = target?.closest("[data-calendar-date]");
    if (!cell) return;
    const bounds = cell.getBoundingClientRect();
    const pointerMinutes = ((event.clientY - bounds.top) / HOUR_HEIGHT) * 60;
    calendarGestureRef.current = {
      item,
      pointerId: event.pointerId,
      originDate: cell.getAttribute("data-calendar-date"),
      originStart: timeInMinutes(item.startTime),
      duration: Math.max(15, timeInMinutes(item.endTime) - timeInMinutes(item.startTime)),
      pointerOffset: pointerMinutes - timeInMinutes(item.startTime),
      startX: event.clientX,
      startY: event.clientY,
      mode: resizing ? "resize" : "move",
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const pointerPreview = (gesture, x, y) => {
    let targetCell = null;
    for (const element of document.elementsFromPoint(x, y)) {
      targetCell = element.closest?.("[data-calendar-date]") || null;
      if (targetCell) break;
    }
    if (!targetCell) return null;
    const destinationCell = gesture.mode === "resize"
      ? document.querySelector(`[data-calendar-date="${gesture.originDate}"]`)
      : targetCell;
    if (!destinationCell) return null;
    const bounds = destinationCell.getBoundingClientRect();
    const snappedMinutes = Math.max(0, Math.min(23 * 60 + 45,
      Math.round((((y - bounds.top) / HOUR_HEIGHT) * 60) / 15) * 15));
    let nextStart = gesture.originStart;
    let nextEnd = gesture.originStart + gesture.duration;
    let nextDate = gesture.originDate;
    if (gesture.mode === "resize") {
      nextEnd = Math.max(gesture.originStart + 15, Math.min(23 * 60 + 45, snappedMinutes));
    } else {
      nextDate = destinationCell.getAttribute("data-calendar-date");
      nextStart = Math.max(0, Math.min(23 * 60 + 45, snappedMinutes - gesture.pointerOffset));
      nextStart = Math.round(nextStart / 15) * 15;
      nextEnd = nextStart + gesture.duration;
      if (nextEnd > 23 * 60 + 45) {
        nextEnd = 23 * 60 + 45;
        nextStart = nextEnd - gesture.duration;
      }
    }
    const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { itemKey: gesture.item.key, originDate: gesture.originDate, date: nextDate, start: nextStart, end: nextEnd, startTime: toTime(nextStart), endTime: toTime(nextEnd) };
  };
  const calendarPointerMove = (event) => {
    const gesture = calendarGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5) {
      gesture.moved = true;
      if (gesture.mode === "move" && timelineRef.current
        && !timelineRef.current.hasPointerCapture(event.pointerId)) {
        timelineRef.current.setPointerCapture(event.pointerId);
      }
      setDragPreview(pointerPreview(gesture, event.clientX, event.clientY));
    }
    pageCalendarAtPosition(event.clientX, gesture.moved && gesture.mode === "move" && gesture.item.itemType === "task");
  };
  const calendarPointerUp = async (event) => {
    const gesture = calendarGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    clearDragEdgePage();
    calendarGestureRef.current = null;
    setDragPreview(null);
    if (!gesture.moved) return;
    event.preventDefault();
    suppressCalendarClickRef.current = true;
    window.setTimeout(() => { suppressCalendarClickRef.current = false; }, 500);

    const preview = pointerPreview(gesture, event.clientX, event.clientY);
    if (!preview) return;
    const { date: nextDate, startTime, endTime } = preview;
    if (nextDate === itemDate(gesture.item) && startTime === gesture.item.startTime && endTime === gesture.item.endTime) return;
    setQuickActionsItem(null);
    optimisticallyMoveItem(gesture.item, nextDate, startTime, endTime);
    setBusyId(gesture.item.key);
    setActionError("");
    try {
      await moveCalendarItem(gesture.item, nextDate, startTime, endTime);
      await load();
      toast({ title: gesture.mode === "resize" ? "Duração do evento alterada." : "Evento movido na Agenda." });
    } catch (error) {
      discardOptimisticItemUpdate(gesture.item.key);
      setActionError(error.message || "Não foi possível alterar o evento.");
    } finally {
      setBusyId("");
    }
  };
  const createPreviewAt = (gesture, clientY) => {
    const snapped = Math.max(0, Math.min(23 * 60 + 45,
      Math.floor((((clientY - gesture.boundsTop) / HOUR_HEIGHT) * 60) / 15) * 15));
    const start = Math.min(gesture.anchorMinute, snapped);
    const end = Math.min(23 * 60 + 59, Math.max(gesture.anchorMinute + 15, snapped));
    const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
    return { date: gesture.date, start, end, startTime: toTime(start), endTime: toTime(end) };
  };
  const createPointerDown = (event, date) => {
    if (event.button !== 0) return;
    const bounds = event.currentTarget.getBoundingClientRect();
    const anchorMinute = Math.max(0, Math.min(23 * 60 + 45,
      Math.floor((((event.clientY - bounds.top) / HOUR_HEIGHT) * 60) / 15) * 15));
    createGestureRef.current = {
      pointerId: event.pointerId,
      date,
      boundsTop: bounds.top,
      boundsLeft: bounds.left,
      boundsWidth: bounds.width,
      anchorMinute,
      anchorX: event.clientX - bounds.left,
      startX: event.clientX,
      startY: event.clientY,
      moved: false,
    };
    event.currentTarget.setPointerCapture(event.pointerId);
  };
  const createPointerMove = (event) => {
    const gesture = createGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    if (Math.hypot(event.clientX - gesture.startX, event.clientY - gesture.startY) > 5) {
      gesture.moved = true;
      setCreatePreview(createPreviewAt(gesture, event.clientY));
    }
  };
  const createPointerUp = (event) => {
    const gesture = createGestureRef.current;
    if (!gesture || gesture.pointerId !== event.pointerId) return;
    createGestureRef.current = null;
    setCreatePreview(null);
    const preview = gesture.moved
      ? createPreviewAt(gesture, event.clientY)
      : (() => {
        const end = Math.min(23 * 60 + 59, gesture.anchorMinute + 60);
        const toTime = (minutes) => `${String(Math.floor(minutes / 60)).padStart(2, "0")}:${String(minutes % 60).padStart(2, "0")}`;
        return {
          date: gesture.date,
          start: gesture.anchorMinute,
          end,
          startTime: toTime(gesture.anchorMinute),
          endTime: toTime(end),
        };
      })();
    setSelectedDate(dateFrom(gesture.date));
    setQuickCreateDraft({
      date: gesture.date,
      startTime: preview.startTime,
      endTime: preview.endTime,
      top: Math.min(HOURS.length * HOUR_HEIGHT - 84, preview.start / 60 * HOUR_HEIGHT + 8),
      left: Math.max(8, Math.min(gesture.boundsWidth - 8, gesture.anchorX)),
      alignRight: gesture.anchorX > gesture.boundsWidth / 2,
    });
  };
  const createPointerCancel = (event) => {
    if (createGestureRef.current?.pointerId !== event.pointerId) return;
    createGestureRef.current = null;
    setCreatePreview(null);
  };
  const complete = async (item) => {
    if (!item.canComplete) return;
    setBusyId(item.key);
    try {
      if (item.source === "agenda") { await updateAgendaItem(item.id, { status: "completed" }); await load(); }
      else if (item.source === "client_demand") await saveClientDemand(item.id, { status: "completed" });
      else { const result = await completeProspectAction(item.id); if (result.prospect) setProspects((current) => current.map((p) => p.id === result.prospect.id ? result.prospect : p)); }
      setDetail(null); toast({ title: "Tarefa atualizada na área de origem." });
    } catch (error) { setActionError(error.message || "Não foi possível concluir a tarefa."); }
    finally { setBusyId(""); }
  };
  const saveSchedule = async () => {
    if (!detail || !["client_demand", "prospect"].includes(detail.source)) return;
    if (!scheduleForm.date) return setActionError("Informe a data do compromisso.");
    if ((scheduleForm.startTime && !scheduleForm.endTime) || (!scheduleForm.startTime && scheduleForm.endTime)) {
      return setActionError("Informe os horários de início e término.");
    }
    if (scheduleForm.startTime && scheduleForm.endTime <= scheduleForm.startTime) {
      return setActionError("O término precisa ser depois do início.");
    }
    setBusyId(detail.key);
    setActionError("");
    try {
      if (detail.source === "client_demand") {
        await saveClientDemand(detail.id, {
          demand_date: scheduleForm.date,
          start_time: scheduleForm.startTime || null,
          end_time: scheduleForm.endTime || null,
        });
      } else {
        const prospect = await updateProspect(detail.id, {
          next_action_date: scheduleForm.date,
          next_action_start_time: scheduleForm.startTime,
          next_action_end_time: scheduleForm.endTime,
        });
        setProspects((current) => current.map((item) => item.id === prospect.id ? prospect : item));
      }
      setDetail((current) => current ? {
        ...current,
        plannedDate: null,
        dueDate: scheduleForm.date,
        startTime: scheduleForm.startTime || null,
        endTime: scheduleForm.endTime || null,
        allDay: !scheduleForm.startTime,
      } : current);
      await refreshGoogleCalendar();
      toast({ title: "Horário salvo no sistema." });
    } catch (error) {
      setActionError(error.message || "Não foi possível salvar o horário.");
    } finally {
      setBusyId("");
    }
  };
  const setLocalStatus = async (item, status, message) => {
    setBusyId(item.key); setActionError("");
    try {
      await updateAgendaItem(item.id, { status });
      setDetail(null); await load(); toast({ title: message });
    } catch (error) { setActionError(error.message || "Não foi possível atualizar o item."); }
    finally { setBusyId(""); }
  };
  const remove = (item) => {
    const googleEventId = item.source === "google_calendar" ? item.id : item.googleEventId;
    const canRemove = canDeleteCalendarItem(item, googleConnection.writeAccess);
    if (!canRemove) return;
    setQuickActionsItem(null);
    if (detail?.key === item.key) setDetail(null);
    setPendingDeletionKeys((current) => new Set(current).add(item.key));
    const timer = window.setTimeout(async () => {
      deletionTimersRef.current.delete(item.key);
      try {
        if (googleEventId) await deleteGoogleCalendarEvent(googleEventId);
        else await deleteAgendaItem(item.id);
        clearAgendaWeekCache();
        setDetail(null);
        const refreshed = await load();
        if (refreshed) {
          setPendingDeletionKeys((current) => {
            const next = new Set(current);
            next.delete(item.key);
            return next;
          });
        }
        toast({ title: "Evento excluído da Agenda." });
      } catch (error) {
        setPendingDeletionKeys((current) => {
          const next = new Set(current);
          next.delete(item.key);
          return next;
        });
        toast({ title: "Não foi possível excluir o evento", description: error.message, variant: "destructive" });
      }
    }, 6000);
    deletionTimersRef.current.set(item.key, timer);

    const undo = () => {
      const pendingTimer = deletionTimersRef.current.get(item.key);
      if (pendingTimer) window.clearTimeout(pendingTimer);
      deletionTimersRef.current.delete(item.key);
      setPendingDeletionKeys((current) => {
        const next = new Set(current);
        next.delete(item.key);
        return next;
      });
      toast({ title: "Exclusão desfeita." });
    };
    toast({
      title: "Evento removido da visualização.",
      description: "A exclusão será confirmada em alguns segundos.",
      duration: 6000,
      action: <ToastAction altText="Desfazer exclusão" onClick={undo}>Desfazer</ToastAction>,
    });
  };
  const changeEventColor = async (item, colorId) => {
    const canSetColor = (item.source !== "google_calendar" && !item.googleEventId)
      || googleConnection.writeAccess;
    if (!canSetColor) return;
    setQuickActionsItem(null);
    setBusyId(item.key);
    setActionError("");
    const overrideKey = `${item.source}:${item.id}`;
    if (item.source !== "google_calendar") {
      setEventColorOverrides((current) => {
        const next = { ...current };
        if (colorId == null) delete next[overrideKey];
        else next[overrideKey] = String(colorId);
        return next;
      });
    }
    try {
      await updateAgendaItemColor({
        sourceType: item.source,
        sourceId: item.id,
        googleEventId: item.source === "google_calendar" ? item.id : item.googleEventId,
        colorId,
      });
      await refreshGoogleCalendar();
      toast({ title: colorId ? "Cor do evento atualizada." : "Cor padrão restaurada." });
    } catch (error) {
      setActionError(error.message || "Não foi possível atualizar a cor do evento.");
      toast({ title: "Não foi possível atualizar a cor", description: error.message, variant: "destructive" });
      try {
        const colors = await getAgendaItemColors();
        setEventColorOverrides(Object.fromEntries(colors.map(({ sourceType, sourceId, colorId: nextColor }) => [`${sourceType}:${sourceId}`, nextColor])));
      } catch (refreshError) {
        console.error("Não foi possível recarregar as cores da Agenda:", refreshError);
      }
    } finally {
      setBusyId("");
    }
  };
  const row = (item) => <li key={item.key} className="flex items-center gap-3 border-b last:border-0">{item.canComplete ? <button type="button" disabled={busyId === item.key} onClick={() => complete(item)} aria-label={`Concluir ${item.title}`} title="Concluir" className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-full border hover:border-emerald-600 hover:bg-emerald-600 hover:text-white disabled:opacity-50">{busyId === item.key ? <LoaderCircle className="h-4 w-4 animate-spin" /> : <Check className="h-4 w-4" />}</button> : <span className="h-2.5 w-2.5 shrink-0 rounded-full bg-primary" />}<button type="button" onClick={() => { setActionError(""); setDetail(item); }} className="min-w-0 flex-1 py-3 text-left"><span className="block truncate text-sm font-medium">{item.title}</span><span className="mt-1 block truncate text-xs text-muted-foreground">{item.sourceLabel} · {item.category || (item.itemType === "appointment" ? "Compromisso" : "Tarefa")}{item.clientName ? ` · ${item.clientName}` : ""}</span></button><span className="shrink-0 text-right text-xs text-muted-foreground">{item.allDay ? "Dia inteiro" : item.startTime ? `${item.startTime}–${item.endTime}` : item.dueDate ? `Prazo ${dateLabel(item.dueDate)}` : "Sem horário"}{item.dueDate && item.plannedDate && item.dueDate !== item.plannedDate && <span className="block">Prazo {dateLabel(item.dueDate)}</span>}</span><span className="hidden shrink-0 rounded-full bg-muted px-2 py-1 text-[10px] text-muted-foreground sm:inline-flex">{STATUSES[item.status] || item.status}</span></li>;
  const setFilter = (field, value) => setFilters((current) => ({ ...current, [field]: value }));
  const renderTimeGrid = () => {
    const columns = `56px repeat(${timelineDays.length}, minmax(0, 1fr))`;
    const weekMinWidth = view === "week" ? "min-w-[700px] lg:min-w-0" : "";
    const dayData = timelineDays.map((day) => {
      const date = key(day);
      const dayItems = eventsOnDate(filtered, date);
      const allDayItems = dayItems.filter((item) => !item.startTime || !item.endTime);
      return {
        day,
        date,
        allDayItems: compactAcquisitionTasks(allDayItems, date),
        timedEvents: layoutTimedEvents(dayItems.filter((item) => item.startTime && item.endTime)),
      };
    });
    const now = new Date();
    const nowMinutes = now.getHours() * 60 + now.getMinutes();

    return <section onDragOver={pageCalendarAtDragEdge} onDragLeave={(event) => {
      if (!event.currentTarget.contains(event.relatedTarget)) clearDragEdgePage();
    }} className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
      <div className="min-h-0 flex-1 overflow-auto" ref={timelineRef} onPointerMove={calendarPointerMove} onPointerUp={calendarPointerUp} onPointerCancel={calendarPointerUp}>
        <div className={`sticky top-0 z-30 grid border-b bg-background ${weekMinWidth}`} style={{ gridTemplateColumns: columns }}>
          <div className="flex flex-col items-center justify-center gap-2 border-r text-[10px] font-medium text-muted-foreground">
            <span>GMT−3</span>
            <button type="button" onClick={() => setAllDayExpanded((expanded) => !expanded)} aria-label={allDayExpanded ? "Recolher tarefas de dia inteiro" : "Expandir tarefas de dia inteiro"} title={allDayExpanded ? "Recolher" : "Expandir"} className="inline-flex h-6 w-6 items-center justify-center rounded hover:bg-muted">
              {allDayExpanded ? <ChevronUp className="h-3.5 w-3.5" /> : <ChevronDown className="h-3.5 w-3.5" />}
            </button>
          </div>
          {dayData.map(({ day, date, allDayItems }) => <div key={date} onDragOver={(event) => {
            if (!Array.from(event.dataTransfer.types).includes(AGENDA_DRAFT_DRAG_TYPE)) event.preventDefault();
          }} onDrop={(event) => dropAllDayItem(event, date)} className={`min-w-0 border-r ${isToday(day) ? "bg-primary/[0.035]" : ""}`}>
            <button type="button" onClick={() => { setSelectedDate(day); if (view === "week") setView("day"); }} className="flex h-[60px] w-full flex-col items-center justify-center gap-0.5 hover:bg-muted/50">
              <span className="text-[10px] font-semibold uppercase tracking-wide text-muted-foreground">{format(day, "EEE", { locale: ptBR })}</span>
              <span className={`flex h-8 w-8 items-center justify-center rounded-full text-base ${isToday(day) ? "bg-primary text-primary-foreground" : "font-medium"}`}>{format(day, "d")}</span>
            </button>
            <div className="space-y-0.5 border-t px-1.5 py-1">
              {(allDayExpanded ? allDayItems : allDayItems.slice(0, 2)).map((entry) => {
                if (entry.kind === "acquisition") return <Popover key={entry.key} open={acquisitionGroup?.key === entry.key} onOpenChange={(open) => setAcquisitionGroup(open ? { key: entry.key, date, items: entry.items } : null)}>
                  <PopoverTrigger asChild>
                    <button type="button" aria-label={`Abrir ${entry.items.length} tarefas de Aquisição`} title={`${entry.items.length} tarefas de Aquisição`} className={`flex w-full items-center gap-1.5 truncate rounded border px-1.5 py-0.5 text-left text-[10px] font-medium hover:brightness-95 ${EVENT_COLORS.acquisition}`}>
                      <Layers className="h-3 w-3 shrink-0" />
                      <span className="truncate">Aquisição</span>
                      <span className="ml-auto shrink-0">{entry.items.length}</span>
                    </button>
                  </PopoverTrigger>
                  <PopoverContent side="right" align="start" className="z-[70] max-h-[80vh] w-72 space-y-3 overflow-hidden p-4 shadow-lg" onPointerDown={(event) => event.stopPropagation()}>
                    <div className="flex items-start gap-2">
                      <Layers className="mt-0.5 h-4 w-4 shrink-0 text-amber-600 dark:text-amber-400" />
                      <div className="min-w-0">
                        <p className="text-sm font-semibold">Aquisição</p>
                        <p className="text-[11px] text-muted-foreground">{entry.items.length} tarefas · {dateLabel(date, "d 'de' MMMM yyyy")}</p>
                      </div>
                    </div>
                    <ul className="max-h-[calc(80vh-6rem)] divide-y overflow-y-auto rounded-md border">
                      {entry.items.map((item) => <li key={item.key}>
                        <button type="button" draggable={item.itemType === "task"} onDragStart={(event) => startAllDayItemDrag(event, item)} onDragEnd={endAllDayItemDrag} onClick={(event) => {
                          if (suppressCalendarClickRef.current) {
                            suppressCalendarClickRef.current = false;
                            event.preventDefault();
                            event.stopPropagation();
                            return;
                          }
                          openAcquisitionTask(item);
                        }} className="flex w-full items-center gap-2 px-2.5 py-2 text-left hover:bg-muted/50">
                          <TaskStatusIcon status={item.status} />
                          <span className="min-w-0 flex-1">
                            <span className="block truncate text-xs font-medium">{item.title}</span>
                            <span className="block truncate text-[10px] text-muted-foreground">{item.clientName || item.category || item.sourceLabel}</span>
                          </span>
                          <ChevronRight className="h-3.5 w-3.5 shrink-0 text-muted-foreground" />
                        </button>
                      </li>)}
                    </ul>
                  </PopoverContent>
                </Popover>;
                const { item } = entry;
                return <CalendarItemActions key={item.key} item={item} mode={quickActionsMode} open={quickActionsItem?.key === item.key} onOpenChange={(open) => setQuickActionsItem(open ? item : null)} onEdit={() => editCalendarItem(item)} onDelete={() => remove(item)} onColorChange={(colorId) => changeEventColor(item, colorId)} canEdit={item.source === "agenda" || item.source === "client_demand" || item.source === "prospect" || (item.source === "google_calendar" && googleConnection.writeAccess)} canDelete={canDeleteCalendarItem(item, googleConnection.writeAccess)} canSetColor={(item.source !== "google_calendar" && !item.googleEventId) || googleConnection.writeAccess} busy={busyId === item.key}>
                  <button type="button" draggable onContextMenu={(event) => { event.preventDefault(); showCalendarItemPopup(item, "actions"); }} onClick={(event) => {
                    if (suppressCalendarClickRef.current) {
                      suppressCalendarClickRef.current = false;
                      event.preventDefault();
                      event.stopPropagation();
                      return;
                    }
                    toggleCalendarItemPopup(item, "details");
                  }} onDragStart={(event) => startAllDayItemDrag(event, item)} onDragEnd={endAllDayItemDrag} className={`flex w-full cursor-grab items-center gap-1 truncate rounded px-1.5 py-0.5 text-left text-[10px] font-medium ${EVENT_COLORS[item.domain] || EVENT_COLORS.professional}`} style={calendarColorStyle(item)} title={`${item.title}${item.clientName ? ` | ${item.clientName}` : ""} · ${item.sourceLabel}`}>
                    <span className="shrink-0">{item.itemType === "task" ? <TaskStatusIcon status={item.status} /> : <span className="opacity-70">●</span>}</span><span className="truncate">{item.title}{item.clientName ? ` | ${item.clientName}` : ""}</span>
                  </button>
                </CalendarItemActions>;
              })}
              {allDayItems.length > (allDayExpanded ? 0 : 2) && !allDayExpanded && <button type="button" onClick={() => setAllDayExpanded(true)} className="px-1 text-[10px] text-muted-foreground hover:text-foreground">Mais {allDayItems.length - 2}</button>}
            </div>
          </div>)}
        </div>
        <div className={`relative grid ${weekMinWidth}`} style={{ gridTemplateColumns: columns, height: `${HOURS.length * HOUR_HEIGHT}px` }}>
          <div className="select-none bg-card">
            {HOURS.map((hour) => <div key={hour} className="relative border-r" style={{ height: HOUR_HEIGHT }}>
              <span className="absolute -top-2 right-2 bg-card px-1 text-[10px] tabular-nums text-muted-foreground">{String(hour).padStart(2, "0")}:00</span>
            </div>)}
          </div>
          {dayData.map(({ day, date, timedEvents }) => <div key={date} data-calendar-date={date} onDragOver={planningDragOver} onDragLeave={(event) => {
            if (!event.currentTarget.contains(event.relatedTarget)) {
              setDraftDragPreview(null);
              if (calendarGestureRef.current?.allDayItem) setDragPreview(null);
            }
          }} onDrop={planningDrop} className={`relative border-r ${isToday(day) ? "bg-primary/[0.02]" : ""}`} style={{ backgroundImage: "linear-gradient(to bottom, hsl(var(--border)) 1px, transparent 1px)", backgroundSize: `100% ${HOUR_HEIGHT}px` }}>
            {timedEvents.map(({ item, start, end, lane, laneCount }) => {
              const isPreviewedHere = dragPreview?.itemKey === item.key && dragPreview.date === date;
              const startMinutes = Math.max(0, Math.min(24 * 60, isPreviewedHere ? dragPreview.start : start));
              const endMinutes = Math.max(startMinutes + 15, Math.min(24 * 60, isPreviewedHere ? dragPreview.end : end));
              const duration = endMinutes - startMinutes;
              const height = timedEventHeight(duration);
              const width = 100 / laneCount;
              const displayStartTime = isPreviewedHere ? dragPreview.startTime : item.startTime;
              const displayEndTime = isPreviewedHere ? dragPreview.endTime : item.endTime;
              return <CalendarItemActions key={item.key} item={item} mode={quickActionsMode} open={quickActionsItem?.key === item.key} onOpenChange={(open) => setQuickActionsItem(open ? item : null)} onEdit={() => editCalendarItem(item)} onDelete={() => remove(item)} onColorChange={(colorId) => changeEventColor(item, colorId)} canEdit={item.source === "agenda" || item.source === "client_demand" || item.source === "prospect" || (item.source === "google_calendar" && googleConnection.writeAccess)} canDelete={canDeleteCalendarItem(item, googleConnection.writeAccess)} canSetColor={(item.source !== "google_calendar" && !item.googleEventId) || googleConnection.writeAccess} busy={busyId === item.key}>
                <button type="button" onContextMenu={(event) => { event.preventDefault(); showCalendarItemPopup(item, "actions"); }} onPointerDown={(event) => calendarPointerDown(event, item)} onPointerMove={calendarPointerMove} onPointerUp={calendarPointerUp} onPointerCancel={calendarPointerUp} onClick={(event) => {
                if (suppressCalendarClickRef.current) {
                  suppressCalendarClickRef.current = false;
                  event.preventDefault();
                  event.stopPropagation();
                  return;
                }
                toggleCalendarItemPopup(item, "details");
              }} title={`${item.title} · ${displayStartTime}–${displayEndTime}${item.clientName ? ` | ${item.clientName}` : ""} · ${item.sourceLabel}`} className={`absolute flex flex-col items-start ${duration === 30 ? "justify-center" : "justify-start"} touch-none overflow-hidden rounded-md border-l-[3px] px-1.5 ${duration <= 30 ? "py-0" : "py-0.5"} text-left shadow-sm transition hover:brightness-[0.98] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-primary ${EVENT_COLORS[item.domain] || EVENT_COLORS.professional}`} style={{
                top: `${startMinutes / 60 * HOUR_HEIGHT + 1}px`,
                height: `${height}px`,
                left: `calc(${lane * width}% + 2px)`,
                width: laneCount > 1 && lane === 0 ? "calc(96% - 4px)" : `calc(${width}% - 4px)`,
                zIndex: 10 + lane,
                opacity: dragPreview?.itemKey === item.key ? (isPreviewedHere ? 0.55 : 0.25) : undefined,
                ...calendarColorStyle(item),
              }}>
                {duration <= 15
                  ? <span className="flex min-w-0 items-center gap-1 whitespace-nowrap text-[9px] leading-[8px]"><span className="min-w-0 truncate font-semibold">{item.title}</span><span className="shrink-0 opacity-80">, {displayStartTime}{item.clientName ? ` | ${item.clientName}` : ""}</span></span>
                  : duration <= 45
                    ? <span className={`flex min-w-0 items-center gap-1 whitespace-nowrap ${duration <= 30 ? "text-[10px] leading-3" : "text-[9px] leading-4"}`}><span className="min-w-0 truncate font-semibold">{item.title}</span><span className="shrink-0 opacity-80">, {displayStartTime} - {displayEndTime}{item.clientName ? ` | ${item.clientName}` : ""}</span></span>
                  : <><span className="block truncate text-[10px] font-semibold leading-3">{item.title}</span><span className="block truncate text-[9px] leading-3 opacity-80">{displayStartTime} - {displayEndTime}{item.clientName ? ` | ${item.clientName}` : ""}</span></>}
                <span data-calendar-resize-handle className={`absolute inset-x-0 bottom-0 z-10 ${duration <= 15 ? "h-1" : "h-2"} cursor-ns-resize touch-none`} aria-label="Arraste para alterar a duração" />
                </button>
              </CalendarItemActions>;
            })}
            {dragPreview?.date === date && (dragPreview.originDate !== date || dragPreview.fromAllDay) && (() => {
              const previewItem = items.find((item) => item.key === dragPreview.itemKey);
              const previewDuration = dragPreview.end - dragPreview.start;
              const previewHeight = timedEventHeight(previewDuration);
              return <div aria-hidden="true" className={`pointer-events-none absolute z-30 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left text-[10px] font-semibold opacity-55 ${EVENT_COLORS[previewItem?.domain] || EVENT_COLORS.professional}`} style={{
                top: `${dragPreview.start / 60 * HOUR_HEIGHT + 1}px`,
                height: `${previewHeight}px`,
                left: "4px",
                width: "calc(100% - 8px)",
                ...calendarColorStyle(previewItem || {}),
              }}>
                <span className="block truncate">{previewItem?.title || dragPreview.title}</span>
                <span className="block truncate text-[9px] font-normal">{dragPreview.startTime} - {dragPreview.endTime}</span>
              </div>;
            })()}
            {createPreview?.date === date && (() => {
              const height = timedEventHeight(createPreview.end - createPreview.start);
              return <div aria-hidden="true" className={`pointer-events-none absolute z-[5] overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left opacity-60 shadow-sm ${EVENT_COLORS.personal}`} style={{
                top: `${createPreview.start / 60 * HOUR_HEIGHT + 1}px`,
                height: `${height}px`,
                left: "4px",
                width: "calc(100% - 8px)",
              }}>
                <span className="block truncate text-[10px] font-semibold">Novo compromisso</span>
                <span className="block truncate text-[9px]">{createPreview.startTime} - {createPreview.endTime}</span>
              </div>;
            })()}
            {draftDragPreview?.date === date && <div aria-hidden="true" className={`pointer-events-none absolute z-30 overflow-hidden rounded-md border-l-[3px] px-1.5 py-0.5 text-left opacity-75 shadow-md ${EVENT_COLORS.personal}`} style={{
              top: `${draftDragPreview.start / 60 * HOUR_HEIGHT + 1}px`,
              height: `${timedEventHeight(draftDragPreview.end - draftDragPreview.start)}px`,
              left: "4px",
              width: "calc(100% - 8px)",
            }}>
              <span className="block truncate text-[10px] font-semibold">{draftDragPreview.title}</span>
              <span className="block truncate text-[9px]">{draftDragPreview.startTime} - {draftDragPreview.endTime}</span>
            </div>}
            {date === todayKey && nowMinutes < HOURS.length * 60 && <div className="pointer-events-none absolute left-0 right-0 z-20 border-t-2 border-rose-500" style={{ top: `${nowMinutes / 60 * HOUR_HEIGHT}px` }}>
              <span className="absolute -left-1 -top-[5px] h-2 w-2 rounded-full bg-rose-500" />
            </div>}
            <button type="button" aria-label={`Criar compromisso em ${date}`} onPointerDown={(event) => createPointerDown(event, date)} onPointerMove={createPointerMove} onPointerUp={createPointerUp} onPointerCancel={createPointerCancel} className="absolute inset-0 z-0 w-full cursor-default touch-none" tabIndex={-1} />
            {quickCreateDraft?.date === date && <QuickCreatePopover draft={quickCreateDraft} saving={saving} onSave={saveQuickAppointment} onMoreOptions={openQuickCreateOptions} onClose={() => setQuickCreateDraft(null)} />}
          </div>)}
        </div>
      </div>
    </section>;
  };

  return <div style={planningListOpen ? { width: "calc(100% - min(400px, 42vw))" } : undefined} className="flex h-[calc(100dvh-53px)] min-h-[400px] min-w-0 flex-col overflow-hidden bg-background transition-[width] duration-200 md:h-dvh">
    <header className="flex shrink-0 flex-wrap items-center justify-between gap-2 border-b px-2 py-2 sm:px-3">
      <div className="flex min-w-0 items-center gap-2">
        <CalendarDays className="h-5 w-5 shrink-0 text-primary" />
        <h1 className="hidden text-base font-semibold sm:block">Agenda</h1>
        <div className="flex items-center gap-1">
          <button type="button" aria-label="Período anterior" onClick={() => move(-1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><ChevronLeft className="h-4 w-4" /></button>
          <button type="button" onClick={() => setSelectedDate(new Date())} className="h-8 rounded-md border px-2.5 text-xs font-medium hover:bg-muted">Hoje</button>
          <button type="button" aria-label="Próximo período" onClick={() => move(1)} className="inline-flex h-8 w-8 items-center justify-center rounded-md hover:bg-muted"><ChevronRight className="h-4 w-4" /></button>
        </div>
        <DatePickerButton date={selectedDate} label={title} onSelect={setSelectedDate} />
      </div>
      <div className="flex shrink-0 items-center gap-1.5">
        <button type="button" onClick={() => setShowSubidoPro((visible) => !visible)} aria-pressed={showSubidoPro} aria-label={`${showSubidoPro ? "Ocultar" : "Mostrar"} agenda Subido PRO`} title={`${showSubidoPro ? "Ocultar" : "Mostrar"} agenda Subido PRO`} className={`inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted ${showSubidoPro ? "border-[#352ef2]/40 text-[#352ef2]" : "text-muted-foreground"}`}>
          {showSubidoPro ? <Eye className="h-4 w-4" /> : <EyeOff className="h-4 w-4" />}<span>Subido PRO</span>
        </button>
        <button type="button" onClick={() => setFiltersExpanded((expanded) => !expanded)} aria-label={filtersExpanded ? "Recolher filtros" : "Expandir filtros"} aria-expanded={filtersExpanded} title={filtersExpanded ? "Recolher filtros" : "Expandir filtros"} className={`inline-flex h-8 w-8 items-center justify-center rounded-md border hover:bg-muted ${filtersExpanded ? "bg-muted" : ""}`}>
          <Filter className="h-4 w-4" />
        </button>
        <div className="flex rounded-md border p-0.5">{[["day", "Dia"], ["week", "Semana"], ["month", "Mês"]].map(([value, label]) => <button key={value} type="button" onClick={() => setView(value)} className={`h-7 rounded px-2 text-xs ${view === value ? "bg-primary text-primary-foreground" : "text-muted-foreground hover:text-foreground"}`}>{label}</button>)}</div>
        {googleConnection.connected && !googleConnection.writeAccess
          ? <button type="button" onClick={startGoogleConnection} className="h-8 rounded-md border border-amber-600/30 px-2 text-[10px] font-medium text-amber-700 hover:bg-amber-600/10 dark:text-amber-300">Autorizar escrita</button>
          : googleConnection.connected && !googleConnection.colorReadAccess
            ? <button type="button" onClick={startGoogleConnection} title="Autorize a leitura das cores da agenda Google" className="h-8 rounded-md border border-amber-600/30 px-2 text-[10px] font-medium text-amber-700 hover:bg-amber-600/10 dark:text-amber-300">Atualizar cores Google</button>
          : googleConnection.connected
            ? googleConnection.watchActive
            ? <span title="Notificações do Google ativas; atualização automática também habilitada" className="rounded-md border border-emerald-600/30 bg-emerald-600/10 px-2 py-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Google ao vivo</span>
            : googleConnection.webhookConfigured
              ? <button type="button" onClick={renewGoogleNotifications} className="h-8 rounded-md border border-amber-600/30 px-2 text-[10px] font-medium text-amber-700 hover:bg-amber-600/10 dark:text-amber-300">Ativar notificações</button>
              : <span title="Eventos atualizados automaticamente a cada 30 segundos" className="rounded-md border border-emerald-600/30 bg-emerald-600/10 px-2 py-1.5 text-[10px] font-medium text-emerald-700 dark:text-emerald-300">Google · 30 s</span>
            : googleConnection.configured
              ? <button type="button" onClick={startGoogleConnection} className="h-8 rounded-md border px-2 text-[10px] font-medium hover:bg-muted">Conectar Google</button>
              : <button type="button" disabled title={`Configure no servidor: ${googleConnection.missingConfiguration.join(", ")}`} className="h-8 cursor-not-allowed rounded-md border px-2 text-[10px] text-muted-foreground opacity-70">Google · iCal</button>}
        {googleConnection.connected && googleConnection.writeAccess && googleConnection.colorReadAccess && <button type="button" onClick={startGoogleConnection} title="Renovar a autorização da conta Google" className="h-8 rounded-md border px-2 text-[10px] font-medium hover:bg-muted">Reconectar Google</button>}
        <button type="button" onClick={() => setPlanningListOpen(true)} aria-label="Abrir lista de planejamento" className="inline-flex h-8 items-center gap-1 rounded-md border px-2 text-xs font-medium hover:bg-muted"><List className="h-3.5 w-3.5" /><span>Lista</span></button>
      </div>
    </header>
    {filtersExpanded && <div className="flex shrink-0 items-center gap-1.5 overflow-x-auto border-b px-2 py-1.5 sm:px-3">
      <select aria-label="Filtrar área" value={filters.area} onChange={(e) => setFilter("area", e.target.value)} className="h-7 w-[116px] shrink-0 rounded-md border bg-background px-1.5 text-xs"><option value="all">Todas as áreas</option>{areas.map((v) => <option key={v} value={v}>{v === "personal" ? "Pessoal" : "Profissional"}</option>)}</select>
      <select aria-label="Filtrar origem" value={filters.origin} onChange={(e) => setFilter("origin", e.target.value)} className="h-7 w-[126px] shrink-0 rounded-md border bg-background px-1.5 text-xs"><option value="all">Todas as origens</option>{origins.map((v) => <option key={v} value={v}>{v === "business" ? "Negócio" : v === "acquisition" ? "Aquisição" : v === "personal" ? "Pessoal" : v === "google_calendar" ? "Google Agenda" : "Profissional"}</option>)}</select>
      <select aria-label="Filtrar cliente" value={filters.client} onChange={(e) => setFilter("client", e.target.value)} className="h-7 w-[148px] shrink-0 rounded-md border bg-background px-1.5 text-xs"><option value="all">Todos os clientes</option>{clientOptions.map((c) => <option key={c.id} value={c.id}>{c.name}</option>)}</select>
      <select aria-label="Filtrar status" value={filters.status} onChange={(e) => setFilter("status", e.target.value)} className="h-7 w-[112px] shrink-0 rounded-md border bg-background px-1.5 text-xs"><option value="all">Todos os status</option>{statuses.map((v) => <option key={v} value={v}>{STATUSES[v] || v}</option>)}</select>
      <select aria-label="Filtrar tipo" value={filters.type} onChange={(e) => setFilter("type", e.target.value)} className="h-7 w-[120px] shrink-0 rounded-md border bg-background px-1.5 text-xs"><option value="all">Todos os tipos</option>{[...new Set(items.map((i) => i.itemType))].map((v) => <option key={v} value={v}>{v === "appointment" ? "Compromissos" : "Tarefas"}</option>)}</select>
      <div className="ml-auto flex shrink-0 items-center gap-3 pl-2 text-[10px] text-muted-foreground">
        <span>Negócio {filtered.filter((i) => i.source === "client_demand").length}</span><span>Aquisição {filtered.filter((i) => i.source === "prospect").length}</span>
        <span>Agenda {filtered.filter((i) => i.source === "agenda").length}</span><span>Google {filtered.filter((i) => i.source === "google_calendar").length}</span>
      </div>
    </div>}
    {!loading && googleCalendarConfigured && !googleConnection.connected && <p className="shrink-0 border-b bg-muted/30 px-3 py-1 text-[10px] text-muted-foreground">O Google Agenda está conectado pelo feed iCal. Conecte sua conta Google para atualizar os eventos automaticamente a cada 30 segundos.</p>}
    {(errors.length > 0 || (!googleCalendarConfigured && !loading) || actionError || authorizationNotice || googleColorWarning || clientError || clientLoading || (showSubidoPro && subidoProError)) && <div role={errors.length || actionError || clientError || subidoProError ? "alert" : undefined} className={`mx-2 mt-1 shrink-0 rounded-md border px-2 py-1 text-xs sm:mx-3 ${errors.length || actionError || clientError || subidoProError ? "border-destructive/30 bg-destructive/5 text-destructive" : "text-muted-foreground"}`}>{clientLoading ? "Carregando tarefas de clientes…" : actionError || clientError || errors.join(" ") || (showSubidoPro && subidoProError) || googleColorWarning || authorizationNotice || (!googleCalendarConfigured ? "Google Agenda não configurada neste servidor." : "")}</div>}
    <>
      {(view === "day" || view === "week") && <div className="flex min-h-0 flex-1 flex-col gap-1.5 p-2 sm:p-3">{renderTimeGrid()}{overdue.length > 0 && <details className="max-h-32 shrink-0 overflow-auto rounded-md border bg-card px-3 py-1.5 text-xs"><summary className="cursor-pointer font-medium">Tarefas vencidas ({overdue.length})</summary><ul className="divide-y">{overdue.map(row)}</ul></details>}</div>}
      {view === "month" && <div className="flex min-h-0 flex-1 flex-col gap-2 p-2 sm:p-3">
        <div className="flex min-h-0 flex-1 flex-col overflow-hidden rounded-lg border bg-card">
          <div className="grid shrink-0 grid-cols-7 border-b bg-muted/30">{DAYS.map((d) => <div key={d} className="py-1 text-center text-[10px] font-medium text-muted-foreground">{d}</div>)}</div>
          <div className="grid min-h-0 flex-1 grid-cols-7" style={{ gridTemplateRows: `repeat(${visibleDays.length / 7}, minmax(0, 1fr))` }}>
            {visibleDays.map((day) => {
              const d = key(day);
              const dayItems = getDayItems(d);
              return <div key={d} className={`min-h-0 overflow-hidden border-b border-r p-1 ${!isSameMonth(day, selectedDate) ? "bg-muted/20 text-muted-foreground/60" : ""} ${d === selectedKey ? "ring-2 ring-inset ring-primary" : ""}`}>
                <button type="button" onClick={() => setSelectedDate(day)} className="block">
                  <span className={`inline-flex h-5 min-w-5 items-center justify-center rounded-full px-1 text-[11px] ${isToday(day) ? "bg-primary text-primary-foreground" : ""}`}>{format(day, "d")}</span>
                </button>
                <span className="mt-0.5 block space-y-0.5">
                  {dayItems.slice(0, 2).map((item) => <CalendarItemActions key={item.key} item={item} mode={quickActionsMode} open={quickActionsItem?.key === item.key} onOpenChange={(open) => setQuickActionsItem(open ? item : null)} onEdit={() => editCalendarItem(item)} onDelete={() => remove(item)} onColorChange={(colorId) => changeEventColor(item, colorId)} canEdit={item.source === "agenda" || item.source === "client_demand" || item.source === "prospect" || (item.source === "google_calendar" && googleConnection.writeAccess)} canDelete={canDeleteCalendarItem(item, googleConnection.writeAccess)} canSetColor={(item.source !== "google_calendar" && !item.googleEventId) || googleConnection.writeAccess} busy={busyId === item.key}>
                    <button type="button" onContextMenu={(event) => { event.preventDefault(); showCalendarItemPopup(item, "actions"); }} onClick={() => toggleCalendarItemPopup(item, "details")} className={`block w-full truncate rounded border-l-2 px-1 py-0.5 text-left text-[9px] ${TONE[item.domain] || TONE.professional}`} style={calendarColorStyle(item)} title={`${item.title}${item.clientName ? ` | ${item.clientName}` : ""} · ${item.sourceLabel}`}>{item.startTime ? `${item.startTime} ` : ""}{item.title}{item.clientName ? ` | ${item.clientName}` : ""}</button>
                  </CalendarItemActions>)}
                  {dayItems.length > 2 && <button type="button" onClick={() => setSelectedDate(day)} className="block px-1 text-[9px] text-muted-foreground">+{dayItems.length - 2}</button>}
                </span>
              </div>;
            })}
          </div>
        </div>
        <details className="max-h-32 shrink-0 overflow-auto rounded-md border bg-card px-3 py-1.5 text-xs"><summary className="cursor-pointer font-medium">{format(selectedDate, "EEEE, d 'de' MMMM", { locale: ptBR })} · Itens da data ({selectedItems.length})</summary><div className="flex justify-end py-1"><button type="button" onClick={() => newItem("appointment")} className="inline-flex h-7 items-center gap-1 rounded-md border px-2 text-xs hover:bg-muted"><Plus className="h-3 w-3" /> Adicionar</button></div>{selectedItems.length ? <ul className="divide-y px-1">{selectedItems.map(row)}</ul> : <p className="py-2 text-muted-foreground">Nenhum item nesta data.</p>}</details>
      </div>}
    </>
  <ItemForm open={formOpen} onOpenChange={setFormOpen} initial={formInitial} selectedDate={selectedKey} clients={activeClients} saving={saving} error={formError} onSave={saveItem} />
  <GoogleEventForm open={googleFormOpen} onOpenChange={setGoogleFormOpen} initial={googleFormInitial} saving={saving} error={googleFormError} onSave={saveGoogleEvent} />
  <AgendaPlanningList
    open={planningListOpen}
    onOpenChange={setPlanningListOpen}
    scheduledDraftId={scheduledDraftId}
    busyDraftId={schedulingDraftId}
    onScheduled={() => setScheduledDraftId("")}
    onDraftDragStart={setActiveDraftDrag}
    onDraftDragEnd={clearDraftDragPreview}
  />
  <Dialog open={Boolean(detail)} onOpenChange={(open) => !open && setDetail(null)}><DialogContent className="sm:max-w-lg"><DialogHeader><DialogTitle>{detail?.title || "Detalhes"}</DialogTitle><DialogDescription>{detail ? `${detail.itemType === "appointment" ? "Compromisso" : "Tarefa"} · ${detail.sourceLabel}${detail.clientName ? ` · ${detail.clientName}` : ""}` : ""}</DialogDescription></DialogHeader>
    {detail && <div className="space-y-3 text-sm"><p className="rounded-md bg-muted/50 p-3">{detail.description || "Sem descrição."}</p><div className="grid grid-cols-2 gap-3"><div><span className="text-xs text-muted-foreground">Data agendada</span><p>{dateLabel(detail.plannedDate || detail.dueDate, "d MMM yyyy")}</p></div>{detail.source === "google_calendar" ? <div><span className="text-xs text-muted-foreground">Até</span><p>{dateLabel(key(addDays(dateFrom(detail.endDateExclusive), -1)), "d MMM yyyy")}</p></div> : <div><span className="text-xs text-muted-foreground">Prazo final</span><p>{dateLabel(detail.dueDate, "d MMM yyyy")}</p></div>}<div><span className="text-xs text-muted-foreground">Horário</span><p>{detail.allDay ? "Dia inteiro" : detail.startTime ? `${detail.startTime}–${detail.endTime}` : "Sem horário"}</p></div><div><span className="text-xs text-muted-foreground">Status</span><p>{STATUSES[detail.status] || detail.status}</p></div><div><span className="text-xs text-muted-foreground">Área / categoria</span><p>{detail.sourceLabel}{detail.category ? ` · ${detail.category}` : ""}</p></div>{detail.priority && <div><span className="text-xs text-muted-foreground">Prioridade</span><p>{detail.priority === "high" ? "Alta" : detail.priority === "low" ? "Baixa" : "Normal"}</p></div>}</div>{detail.observations && <p className="border-t pt-3 text-muted-foreground">{detail.observations}</p>}</div>}
    {detail && ["client_demand", "prospect"].includes(detail.source) && <div className="grid grid-cols-1 gap-2 rounded-md border p-3 sm:grid-cols-3">
      <label className="text-xs text-muted-foreground">Data<input type="date" value={scheduleForm.date} onChange={(event) => setScheduleForm((current) => ({ ...current, date: event.target.value }))} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" /></label>
      <label className="text-xs text-muted-foreground">Início<input type="time" value={scheduleForm.startTime} onChange={(event) => setScheduleForm((current) => ({ ...current, startTime: event.target.value }))} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" /></label>
      <label className="text-xs text-muted-foreground">Término<input type="time" value={scheduleForm.endTime} onChange={(event) => setScheduleForm((current) => ({ ...current, endTime: event.target.value }))} className="mt-1 h-9 w-full rounded-md border bg-background px-2 text-sm text-foreground" /></label>
      <button type="button" disabled={busyId === detail.key} onClick={saveSchedule} className="h-8 rounded-md border px-3 text-xs font-medium hover:bg-muted disabled:opacity-50 sm:col-span-3">Salvar data e horário</button>
    </div>}
    {actionError && <p role="alert" className="text-sm text-destructive">{actionError}</p>}
    <DialogFooter className="flex-wrap gap-2">{detail?.canComplete && <button type="button" disabled={busyId === detail.key} onClick={() => complete(detail)} className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-600 px-3 text-sm font-medium text-white disabled:opacity-50"><Check className="h-4 w-4" /> Concluir tarefa</button>}
      {detail?.source === "agenda" && detail.status !== "cancelled" && <button type="button" disabled={busyId === detail.key} onClick={() => setLocalStatus(detail, detail.itemType === "appointment" ? "cancelled" : "not_done", detail.itemType === "appointment" ? "Compromisso cancelado." : "Tarefa marcada como não feita.")} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">{detail.itemType === "appointment" ? "Cancelar compromisso" : "Marcar não feita"}</button>}
      {detail?.source === "agenda" && detail.status === "cancelled" && <button type="button" onClick={() => setLocalStatus(detail, "scheduled", "Compromisso reativado.")} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Reativar</button>}
      {detail?.source === "agenda" && <button type="button" onClick={() => editItem(detail)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><Pencil className="h-4 w-4" /> Editar</button>}
      {detail?.source === "google_calendar" && googleConnection.writeAccess && <button type="button" onClick={() => editGoogleEvent(detail)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><Pencil className="h-4 w-4" /> Editar evento Google</button>}
      {detail?.source === "google_calendar" && !googleConnection.writeAccess && <span className="text-xs text-muted-foreground">Autorize a edição para alterar este evento no Google.</span>}
      {(detail?.source === "agenda" && !detail.googleEventId
        || googleConnection.writeAccess && (detail?.source === "agenda" || detail?.googleEventId || detail?.source === "google_calendar"))
        && <button type="button" disabled={busyId === detail.key} onClick={() => remove(detail)} className="inline-flex h-9 items-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/5 disabled:opacity-50"><Trash2 className="h-4 w-4" /> {detail.googleEventId || detail.source === "google_calendar" ? "Remover da Agenda" : "Excluir"}</button>}
      {detail?.link && <Link to={detail.link} onClick={() => setDetail(null)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm hover:bg-muted"><ExternalLink className="h-4 w-4" /> Abrir origem</Link>}
    </DialogFooter>
  </DialogContent></Dialog>
</div>;
}
