import React, { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { io } from "socket.io-client";
import {
  AlertCircle, ArrowRightLeft, Building2, CalendarClock, Check, ChevronDown, ChevronLeft, ChevronRight, Info, Pencil,
  CircleDollarSign, Clock3, Kanban, List, Loader2, MessageCircle, MessageSquare, Plus,
  Search, Send, Trash2, UserRound, Wifi, WifiOff, X,
} from "lucide-react";
import KpiCard from "@/components/leads/KpiCard";
import AcquisitionAnalytics from "@/components/acquisition/AcquisitionAnalytics";
import { acquisitionBusinessDate } from "@/lib/acquisitionDate";
import { useAppData } from "@/components/AppDataProvider";
import { useToast } from "@/components/ui/use-toast";
import { ToastAction } from "@/components/ui/toast";
import { Switch } from "@/components/ui/switch";
import { Dialog, DialogContent, DialogDescription, DialogFooter, DialogHeader, DialogTitle } from "@/components/ui/dialog";
import { getAutomationRules, getAutomationScripts } from "@/api/automations";
import { connectWhatsApp, getWhatsAppCredentials, getWhatsAppStatus, sendWhatsAppMessage } from "@/api/whatsapp";
import {
  addProspectInteraction, completeProspectAction, completeProspectActionManually, convertProspect, createProspect,
  createAcquisitionLead, createProspectSource, deleteProspect, getAcquisitionLeadList, getProspectHistory, getProspectInteractions,
  getProspectSources, getProspectStages, getProspects, updateProspect, updateProspectStageDate,
  updateAcquisitionLead,
} from "@/api/prospects";

const EMPTY_FORM = {
  company_name: "", segment: "", city: "", company_instagram: "", website: "", phone: "",
  contact_name: "", contact_role: "", contact_phone: "", contact_instagram: "", notes: "",
  stage_id: "", source: "", owner: "", potential_value: "", offer: "",
  last_contact_at: "", next_action: "Entrar em contato", next_action_date: "",
  loss_reason: "",
};
const ACTIONS = ["Entrar em contato", "Follow-up", "Confirmar reunião", "Realizar reunião", "Enviar proposta", "Follow-up da proposta", "Aguardar retorno", "Outro"];
const today = () => {
  const date = new Date();
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
};
const dateLabel = (value) => {
  const date = acquisitionBusinessDate(value);
  return date ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeZone: "UTC" }).format(new Date(`${date}T12:00:00Z`)) : "—";
};
const messageDateTime = (value) => value ? new Intl.DateTimeFormat("pt-BR", { dateStyle: "short", timeStyle: "short", timeZone: "America/Sao_Paulo" }).format(new Date(Number(value) * 1000)) : "";
const currency = (value) => value == null || value === "" ? "—" : new Intl.NumberFormat("pt-BR", { style: "currency", currency: "BRL", maximumFractionDigits: 0 }).format(Number(value) || 0);
const isOverdue = (prospect) => prospect.next_action_date && prospect.next_action_date < today() && !prospect.is_won && !prospect.is_lost;
const CONTACT_ACTIONS = new Set(["Entrar em contato", "Follow-up", "Confirmar reunião", "Enviar proposta", "Follow-up da proposta"]);
const canCompleteAction = (prospect) => CONTACT_ACTIONS.has(prospect.next_action);

const LEAD_FIELDS = [
  ["company_name", "Nome do negócio"], ["company_instagram", "Instagram"], ["phone", "Telefone"],
  ["contact_name", "Contato"], ["contact_phone", "Telefone do contato"], ["website", "Site"],
  ["segment", "Segmento"], ["city", "Cidade"], ["source", "Origem"], ["notes", "Observações"],
];
const EMPTY_LEAD = Object.fromEntries(LEAD_FIELDS.map(([key]) => [key, ""]));

function getExternalUrl(value) {
  const url = String(value || "").trim();
  if (!url) return "";
  const normalized = /^https?:\/\//i.test(url) ? url : `https://${url}`;
  try {
    const parsed = new URL(normalized);
    return ["http:", "https:"].includes(parsed.protocol) ? parsed.href : "";
  } catch {
    return "";
  }
}

function getDomainLabel(value) {
  const url = getExternalUrl(value);
  if (!url) return "";
  return new URL(url).hostname.replace(/^www\./i, "");
}

function getInstagramLink(value) {
  const raw = String(value || "").trim();
  if (!raw) return null;
  const url = getExternalUrl(raw.includes("instagram.com") ? raw : `instagram.com/${raw.replace(/^@/, "")}`);
  if (!url) return null;
  const username = new URL(url).pathname.split("/").filter(Boolean)[0];
  return username ? { username: `@${username}`, url: `https://www.instagram.com/${username}/` } : null;
}

function leadMapAddress(lead) {
  return lead.notes.match(/Endereço divulgado:\s*(.*?)(?:\. Google Maps:|$)/i)?.[1]?.trim() || "";
}

function cleanLeadNotes(notes) {
  return String(notes || "")
    .replace(/\s*Google Maps:\s*https?:\/\/\S+/gi, "")
    .replace(/\s*https?:\/\/(?:www\.)?(?:maps\.)?google\.[^\s/]+\/maps\/\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}

function prospectMapsUrl(prospect) {
  const address = leadMapAddress(prospect);
  const query = [prospect.company_name, address, prospect.city].filter(Boolean).join(", ");
  return `https://www.google.com/maps/search/?api=1&query=${encodeURIComponent(query)}`;
}

function AcquisitionLeadList({ onBack, onApproved }) {
  const { toast } = useToast();
  const [leads, setLeads] = useState([]);
  const [statusFilter, setStatusFilter] = useState("pending");
  const [query, setQuery] = useState("");
  const [draft, setDraft] = useState(null);
  const [selectedLeadId, setSelectedLeadId] = useState(null);
  const [busy, setBusy] = useState(false);
  const reload = useCallback(async () => setLeads(await getAcquisitionLeadList()), []);
  useEffect(() => { reload().catch((error) => toast({ title: "Erro ao carregar a lista", description: error.message, variant: "destructive" })); }, [reload, toast]);
  const visible = leads.filter((lead) => (statusFilter === "all" || lead.status === statusFilter)
    && LEAD_FIELDS.some(([key]) => String(lead[key] || "").toLocaleLowerCase("pt-BR").includes(query.trim().toLocaleLowerCase("pt-BR"))));
  const save = async (event) => {
    event.preventDefault();
    setBusy(true);
    try {
      if (draft.id) await updateAcquisitionLead(draft.id, draft);
      else await createAcquisitionLead(draft);
      await reload(); setDraft(null);
      toast({ title: draft.id ? "Registro atualizado" : "Negócio adicionado à lista" });
    } catch (error) { toast({ title: "Não foi possível salvar", description: error.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const decide = async (lead, status) => {
    const isReviewing = selectedLeadId === lead.id;
    const currentIndex = visible.findIndex((item) => item.id === lead.id);
    const nextLead = isReviewing
      ? visible[currentIndex + 1] || visible[currentIndex - 1] || null
      : null;
    setBusy(true);
    try {
      await updateAcquisitionLead(lead.id, { status });
      await reload();
      if (isReviewing) setSelectedLeadId(nextLead?.id ?? null);
      if (status === "approved") onApproved();
      toast({ title: status === "approved" ? "Prospect enviado para o funil" : status === "rejected" ? "Registro recusado" : "Registro voltou para pendentes" });
    } catch (error) { toast({ title: "Não foi possível atualizar", description: error.message, variant: "destructive" }); }
    finally { setBusy(false); }
  };
  const statusLabel = { pending: "Pendente", approved: "Aprovado", rejected: "Recusado" };
  const selectedLead = visible.find((lead) => lead.id === selectedLeadId) || null;
  const selectedIndex = visible.findIndex((lead) => lead.id === selectedLeadId);
  const moveSelection = (offset) => {
    const nextLead = visible[selectedIndex + offset];
    if (nextLead) setSelectedLeadId(nextLead.id);
  };
  const openLeadDetails = (lead) => setSelectedLeadId(lead.id);
  const handleLeadRowKeyDown = (event, lead) => {
    if (event.target !== event.currentTarget || (event.key !== "Enter" && event.key !== " ")) return;
    event.preventDefault();
    openLeadDetails(lead);
  };
  return <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8"><div className="mx-auto max-w-[1600px] space-y-6">
    <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between"><div><button onClick={onBack} className="mb-2 text-sm text-muted-foreground hover:text-foreground">← Aquisição</button><p className="text-sm font-medium text-primary">Comercial</p><h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Lista de possíveis clientes</h1><p className="mt-1 text-sm text-muted-foreground">Revise os negócios antes de entrarem no funil.</p></div><button onClick={() => setDraft({ ...EMPTY_LEAD })} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground"><Plus className="h-4 w-4"/>Adicionar negócio</button></header>
    <section className="overflow-hidden rounded-xl border bg-card shadow-sm"><div className="flex flex-col gap-3 border-b p-4 sm:flex-row"><input className={`${inputClass} flex-1`} placeholder="Buscar na lista" value={query} onChange={(event) => setQuery(event.target.value)}/><select className={`${inputClass} sm:w-48`} value={statusFilter} onChange={(event) => setStatusFilter(event.target.value)}><option value="pending">Pendentes</option><option value="approved">Aprovados</option><option value="rejected">Recusados</option><option value="all">Todos</option></select><span className="self-center text-sm text-muted-foreground">{visible.length} registros</span></div>
      <div className="overflow-x-auto"><table className="w-full min-w-[1000px] text-left text-sm"><thead className="bg-muted/50 text-xs text-muted-foreground"><tr>{["Negócio", "Instagram", "Telefone", "Contato", "Segmento", "Cidade", "Observações", "Status", "Ações"].map((heading) => <th key={heading} className="px-4 py-3 font-medium">{heading}</th>)}</tr></thead><tbody className="divide-y">{visible.map((lead) => <tr key={lead.id} tabIndex={0} aria-label={`Ver detalhes de ${lead.company_name}`} onClick={() => openLeadDetails(lead)} onKeyDown={(event) => handleLeadRowKeyDown(event, lead)} className="cursor-pointer hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-ring"><td className="px-4 py-3 font-medium">{lead.company_name}</td><td className="px-4 py-3">{lead.company_instagram || "—"}</td><td className="px-4 py-3">{lead.phone || lead.contact_phone || "—"}</td><td className="px-4 py-3">{lead.contact_name || "—"}</td><td className="px-4 py-3">{lead.segment || "—"}</td><td className="px-4 py-3">{lead.city || "—"}</td><td className="max-w-56 truncate px-4 py-3" title={cleanLeadNotes(lead.notes)}>{cleanLeadNotes(lead.notes) || "—"}</td><td className="px-4 py-3"><span className={`rounded-full px-2.5 py-1 text-xs ${lead.status === "approved" ? "bg-emerald-500/10 text-emerald-700" : lead.status === "rejected" ? "bg-rose-500/10 text-rose-700" : "bg-amber-500/10 text-amber-700"}`}>{statusLabel[lead.status]}</span></td><td className="px-4 py-3"><div className="flex items-center gap-2"><button disabled={busy} onClick={(event) => { event.stopPropagation(); setDraft({ ...lead }); }} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">Editar</button>{lead.status !== "approved" ? <button disabled={busy} onClick={(event) => { event.stopPropagation(); void decide(lead, "approved"); }} className="rounded-md bg-emerald-600 px-2.5 py-1.5 text-xs text-white">Aprovar</button> : <button disabled={busy} onClick={(event) => { event.stopPropagation(); void decide(lead, "pending"); }} className="rounded-md border px-2.5 py-1.5 text-xs hover:bg-muted">Pendente</button>}{lead.status !== "rejected" && <button disabled={busy} onClick={(event) => { event.stopPropagation(); void decide(lead, "rejected"); }} className="rounded-md border border-rose-300 px-2.5 py-1.5 text-xs text-rose-700">Recusar</button>}</div></td></tr>)}{!visible.length && <tr><td colSpan={9} className="px-4 py-14 text-center text-muted-foreground">Nenhum negócio encontrado.</td></tr>}</tbody></table></div>
    </section>
    <Dialog open={Boolean(selectedLead)} onOpenChange={(open) => !open && setSelectedLeadId(null)}><DialogContent className="flex h-[88vh] max-h-[88vh] flex-col gap-0 overflow-hidden p-0 sm:max-w-2xl">
      <div className="flex shrink-0 items-start justify-between gap-4 border-b px-6 py-5 pr-16"><DialogHeader><DialogTitle>{selectedLead?.company_name}</DialogTitle><DialogDescription>{selectedLead ? `${selectedLead.segment || "Segmento não informado"} · ${selectedLead.city || "Cidade não informada"} · ${statusLabel[selectedLead.status]}` : ""}</DialogDescription></DialogHeader><div className="flex shrink-0 items-center gap-1"><button type="button" disabled={selectedIndex <= 0} onClick={() => moveSelection(-1)} aria-label="Prospect anterior" className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ChevronLeft className="h-4 w-4"/></button><span className="min-w-14 text-center text-xs text-muted-foreground">{selectedIndex + 1} / {visible.length}</span><button type="button" disabled={selectedIndex < 0 || selectedIndex >= visible.length - 1} onClick={() => moveSelection(1)} aria-label="Próximo prospect" className="inline-flex h-9 w-9 items-center justify-center rounded-md border hover:bg-muted disabled:opacity-40"><ChevronRight className="h-4 w-4"/></button></div></div>
      {selectedLead && <div className="min-h-0 flex-1 overflow-y-auto px-6 py-5"><div className="grid gap-4 sm:grid-cols-2">{LEAD_FIELDS.filter(([key]) => key !== "company_name" && key !== "segment").map(([key, label]) => {
        const value = selectedLead[key];
        const instagram = key === "company_instagram" ? getInstagramLink(value) : null;
        const website = key === "website" ? getExternalUrl(value) : "";
        const source = key === "source" ? getExternalUrl(value) : "";
        const notes = key === "notes" ? cleanLeadNotes(value) : "";
        return <div key={key} className={`min-w-0 space-y-1 ${key === "notes" ? "sm:col-span-2" : ""}`}><p className="text-xs font-medium text-muted-foreground">{label}</p>
          {instagram ? <a href={instagram.url} target="_blank" rel="noreferrer" className={`text-sm ${leadLinkClass}`}>{instagram.username}</a>
            : website ? <a href={website} target="_blank" rel="noreferrer" className={`break-all text-sm ${leadLinkClass}`}>{getDomainLabel(value)}</a>
              : source ? <a href={source} target="_blank" rel="noreferrer" className={`break-all text-sm ${leadLinkClass}`}>{getDomainLabel(value)}</a>
                : <p className={`break-words text-sm ${key === "notes" ? "whitespace-pre-wrap" : ""}`}>{key === "notes" ? notes || "—" : value || "—"}</p>}
        </div>;
      })}</div>
        <div className="mt-5 space-y-1"><p className="text-xs font-medium text-muted-foreground">Links</p><div className="flex flex-wrap gap-x-4 gap-y-2 text-sm">{(() => {
          const address = leadMapAddress(selectedLead);
          const mapQuery = [selectedLead.company_name, address, selectedLead.city].filter(Boolean).join(", ");
          const encoded = encodeURIComponent(mapQuery);
          const mapsUrl = `https://www.google.com/maps/search/?api=1&query=${encoded}`;
          const businessUrl = `https://www.google.com/search?q=${encoded}`;
          return <><a href={mapsUrl} target="_blank" rel="noreferrer" className={leadLinkClass}>Mapa</a><a href={businessUrl} target="_blank" rel="noreferrer" className={leadLinkClass}>Google Meu Negócio</a></>;
        })()}</div></div>
      </div>}
      <DialogFooter className="shrink-0 flex-row flex-wrap gap-2 border-t bg-background px-6 py-4">{selectedLead && (selectedLead.status !== "approved" ? <button type="button" disabled={busy} onClick={() => decide(selectedLead, "approved")} className="inline-flex h-9 items-center justify-center rounded-md bg-emerald-600 px-4 text-sm font-medium text-white disabled:opacity-50">Aprovar</button> : <button type="button" disabled={busy} onClick={() => decide(selectedLead, "pending")} className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm disabled:opacity-50">Voltar para pendentes</button>)}{selectedLead?.status !== "rejected" && selectedLead && <button type="button" disabled={busy} onClick={() => decide(selectedLead, "rejected")} className="inline-flex h-9 items-center justify-center rounded-md border border-rose-300 px-4 text-sm text-rose-700 disabled:opacity-50">Recusar</button>}<button type="button" disabled={busy} onClick={() => { setSelectedLeadId(null); setDraft({ ...selectedLead }); }} className="inline-flex h-9 items-center justify-center rounded-md border px-4 text-sm disabled:opacity-50">Editar</button></DialogFooter>
    </DialogContent></Dialog>
    {draft && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/40 p-4" onMouseDown={(event) => { if (event.target === event.currentTarget) setDraft(null); }}><form onSubmit={save} className="max-h-[90vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border bg-card p-5 shadow-xl"><div><h2 className="text-lg font-semibold">{draft.id ? "Editar negócio" : "Adicionar à lista"}</h2><p className="text-sm text-muted-foreground">Informações para avaliar antes da prospecção.</p></div><div className="grid gap-3 sm:grid-cols-2">{LEAD_FIELDS.map(([key, label]) => <label key={key} className={`space-y-1.5 ${key === "notes" ? "sm:col-span-2" : ""}`}><span className="text-xs font-medium text-muted-foreground">{label}{key === "company_name" ? " *" : ""}</span>{key === "notes" ? <textarea required={false} rows={3} className={textareaClass} value={draft[key] || ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}/> : <input required={key === "company_name"} className={inputClass} value={draft[key] || ""} onChange={(event) => setDraft({ ...draft, [key]: event.target.value })}/>}</label>)}</div><div className="flex justify-end gap-2"><button type="button" onClick={() => setDraft(null)} className="h-10 rounded-md border px-4 text-sm">Cancelar</button><button disabled={busy} className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">{busy ? "Salvando..." : "Salvar"}</button></div></form></div>}
  </div></div>;
}

function prospectVariables(prospect) {
  const hour = Number(new Intl.DateTimeFormat("en-US", { timeZone: "America/Sao_Paulo", hour: "2-digit", hourCycle: "h23" }).format(new Date()));
  return {
    nome: String(prospect.contact_name || prospect.company_name || "").trim(),
    empresa: String(prospect.company_name || "").trim(),
    saudacao: hour < 12 ? "Bom dia" : hour < 18 ? "Boa tarde" : "Boa noite",
    etapa: String(prospect.stage_name || "").trim(),
  };
}

function renderMessageTemplate(template, prospect) {
  const variables = prospectVariables(prospect);
  return String(template || "").replace(/\{([a-z_]+)\}/gi, (token, key) => variables[key.toLowerCase()] || token);
}

function phoneToWhatsAppJid(phone) {
  const raw = String(phone || "").trim();
  const explicitInternational = raw.startsWith("+") || raw.startsWith("00");
  let digits = raw.replace(/\D/g, "");
  if (digits.startsWith("00")) digits = digits.slice(2);
  if (!explicitInternational && digits.startsWith("0") && (digits.length === 11 || digits.length === 12)) digits = `55${digits.slice(1)}`;
  else if (!explicitInternational && (digits.length === 10 || digits.length === 11)) digits = `55${digits}`;
  if (digits.length < 12 || digits.length > 15) return "";
  return `${digits}@s.whatsapp.net`;
}

function SectionTitle({ children }) {
  return <h3 className="mb-3 text-sm font-semibold text-foreground">{children}</h3>;
}

function Field({ label, children, className = "" }) {
  return <label className={`block space-y-1.5 ${className}`}><span className="text-xs font-medium text-muted-foreground">{label}</span>{children}</label>;
}

const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const textareaClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";
const leadLinkClass = "text-blue-600 hover:text-blue-700 hover:underline dark:text-blue-400 dark:hover:text-blue-300";

export default function Acquisition() {
  const { accounts, clients, refresh: refreshAppData } = useAppData();
  const { toast } = useToast();
  const [stages, setStages] = useState([]);
  const [sources, setSources] = useState([]);
  const [prospects, setProspects] = useState([]);
  const [loading, setLoading] = useState(true);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [view, setView] = useState("kanban");
  const [kanbanScrollbar, setKanbanScrollbar] = useState(null);
  const kanbanScrollRef = useRef(null);
  const kanbanContentRef = useRef(null);
  const floatingKanbanScrollRef = useRef(null);
  const [search, setSearch] = useState("");
  const [stageFilter, setStageFilter] = useState("all");
  const [ownerFilter, setOwnerFilter] = useState("all");
  const [overdueOnly, setOverdueOnly] = useState(false);
  const [selected, setSelected] = useState(null);
  const selectedRef = useRef(selected);
  const [formOpen, setFormOpen] = useState(false);
  const [form, setForm] = useState(EMPTY_FORM);
  const [interactions, setInteractions] = useState([]);
  const [stageHistory, setStageHistory] = useState([]);
  const [editingHistoryId, setEditingHistoryId] = useState(null);
  const [historyDateDraft, setHistoryDateDraft] = useState("");
  const [savingHistoryId, setSavingHistoryId] = useState(null);
  const [interactionForm, setInteractionForm] = useState({ interaction_date: today(), type: "Contato", notes: "" });
  const [draggingId, setDraggingId] = useState(null);
  const [meetingPrompt, setMeetingPrompt] = useState(null);
  const [meetingAt, setMeetingAt] = useState("");
  const [followUpPrompt, setFollowUpPrompt] = useState(null);
  const [followUpDate, setFollowUpDate] = useState("");
  const [lossReason, setLossReason] = useState("");
  const [sourcePrompt, setSourcePrompt] = useState(false);
  const [sourceName, setSourceName] = useState("");
  const [screen, setScreen] = useState("pipeline");
  const [clientConversion, setClientConversion] = useState(null);
  const [clientForm, setClientForm] = useState(null);
  const [automationScripts, setAutomationScripts] = useState([]);
  const [automationRules, setAutomationRules] = useState([]);
  const [automationReady, setAutomationReady] = useState(false);
  const [automationError, setAutomationError] = useState("");
  const [actionPrompt, setActionPrompt] = useState(null);
  const [messageScriptId, setMessageScriptId] = useState("");
  const [messageTemplate, setMessageTemplate] = useState("");
  const [messageDraft, setMessageDraft] = useState("");
  const [messageEdited, setMessageEdited] = useState(false);
  const [messagePhone, setMessagePhone] = useState("");
  const [whatsAppStatus, setWhatsAppStatus] = useState(null);
  const [whatsAppStatusError, setWhatsAppStatusError] = useState("");
  const [messageError, setMessageError] = useState("");
  const [messageSending, setMessageSending] = useState(false);
  const [confirmedMessage, setConfirmedMessage] = useState(null);
  const [sendRequestId, setSendRequestId] = useState("");
  const [completingActionId, setCompletingActionId] = useState(null);

  const saveStageDate = async (item, nextDate) => {
    setEditingHistoryId(null);
    if (!nextDate) return;
    const previousDate = acquisitionBusinessDate(item.entered_at);
    if (nextDate === previousDate && !item.is_estimated) return;
    setSavingHistoryId(item.id);
    try {
      const updated = await updateProspectStageDate(selected.id, item.id, nextDate);
      setStageHistory((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...updated } : entry).sort((a, b) => String(b.entered_at).localeCompare(String(a.entered_at)) || b.id - a.id));
      const undo = async () => {
        try {
          const restored = await updateProspectStageDate(selected.id, item.id, previousDate, Boolean(item.is_estimated));
          setStageHistory((current) => current.map((entry) => entry.id === item.id ? { ...entry, ...restored } : entry).sort((a, b) => String(b.entered_at).localeCompare(String(a.entered_at)) || b.id - a.id));
          await refreshAppData();
          toast({ title: "Alteração desfeita" });
        } catch (undoError) {
          toast({ title: "Não foi possível desfazer", description: undoError.message, variant: "destructive" });
        }
      };
      await refreshAppData();
      toast({ title: "Data atualizada.", duration: 6000, action: <ToastAction altText="Desfazer alteração" onClick={undo}>Desfazer</ToastAction> });
    } catch (saveError) {
      toast({ title: "Não foi possível atualizar a data", description: saveError.message, variant: "destructive" });
    } finally {
      setSavingHistoryId(null);
    }
  };

  const load = useCallback(async () => {
    setError("");
    try {
      const [nextStages, nextProspects, nextSources] = await Promise.all([getProspectStages(), getProspects(), getProspectSources()]);
      setStages(nextStages);
      setProspects(nextProspects);
      setSources(nextSources);
      return nextProspects;
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar a área de Aquisição.");
      return null;
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { load(); }, [load]);

  useEffect(() => { selectedRef.current = selected; }, [selected]);

  useEffect(() => {
    let alive = true;
    const socket = io({ auth: getWhatsAppCredentials(), transports: ["websocket"] });
    socket.on("whatsapp:prospect-updated", ({ prospectId } = {}) => {
      const id = Number(prospectId);
      if (!Number.isInteger(id) || id <= 0) return;
      void load().then(async (nextProspects) => {
        if (!alive || !nextProspects) return;
        const updated = nextProspects.find((item) => item.id === id);
        if (!updated || selectedRef.current?.id !== id) return;
        setSelected(updated);
        try {
          const [nextInteractions, nextHistory] = await Promise.all([
            getProspectInteractions(id),
            getProspectHistory(id),
          ]);
          if (alive && selectedRef.current?.id === id) {
            setInteractions(nextInteractions);
            setStageHistory(nextHistory);
          }
        } catch {
          // Keep the board update even if the selected prospect history is unavailable.
        }
      });
    });
    return () => {
      alive = false;
      socket.disconnect();
    };
  }, [load]);

  useEffect(() => {
    let alive = true;
    Promise.all([getAutomationScripts(), getAutomationRules()])
      .then(([nextScripts, nextRules]) => {
        if (!alive) return;
        setAutomationScripts(nextScripts);
        setAutomationRules(nextRules);
        setAutomationError("");
      })
      .catch((loadError) => {
        if (alive) {
          setAutomationError(loadError.message);
          toast({ title: "Automações indisponíveis", description: loadError.message, variant: "destructive" });
        }
      })
      .finally(() => { if (alive) setAutomationReady(true); });
    return () => { alive = false; };
  }, [toast]);

  useEffect(() => {
    if (!selected?.id) { setInteractions([]); return; }
    let cancelled = false;
    Promise.all([getProspectInteractions(selected.id), getProspectHistory(selected.id)]).then(([items, history]) => {
      if (!cancelled) { setInteractions(items); setStageHistory(history); }
    })
      .catch((loadError) => toast({ title: "Erro ao carregar histórico", description: loadError.message, variant: "destructive" }));
    return () => { cancelled = true; };
  }, [selected?.id, toast]);

  useEffect(() => {
    if (!actionPrompt || messageEdited || confirmedMessage) return;
    setMessageDraft(renderMessageTemplate(messageTemplate, actionPrompt.prospect));
  }, [actionPrompt, messageTemplate, messageEdited, confirmedMessage]);

  useEffect(() => {
    if (!actionPrompt || whatsAppStatus?.state === "connected") return undefined;
    let alive = true;
    const timer = window.setInterval(() => {
      getWhatsAppStatus().then((status) => { if (alive) setWhatsAppStatus(status); }).catch(() => {});
    }, 2_000);
    return () => { alive = false; window.clearInterval(timer); };
  }, [actionPrompt, whatsAppStatus?.state]);

  const owners = useMemo(() => [...new Set(prospects.map((item) => item.owner).filter(Boolean))].sort((a, b) => a.localeCompare(b, "pt-BR")), [prospects]);
  const filtered = useMemo(() => {
    const query = search.trim().toLocaleLowerCase("pt-BR");
    return prospects.filter((prospect) => {
      const matchesSearch = !query || [prospect.company_name, prospect.contact_name, prospect.segment, prospect.city, prospect.phone]
        .some((value) => String(value || "").toLocaleLowerCase("pt-BR").includes(query));
      return matchesSearch && (stageFilter === "all" || String(prospect.stage_id) === stageFilter) &&
        (ownerFilter === "all" || prospect.owner === ownerFilter) && (!overdueOnly || isOverdue(prospect));
    });
  }, [prospects, search, stageFilter, ownerFilter, overdueOnly]);
  useEffect(() => {
    const scrollElement = kanbanScrollRef.current;
    const contentElement = kanbanContentRef.current;
    const floatingElement = floatingKanbanScrollRef.current;
    if (!scrollElement || !contentElement || !floatingElement || view !== "kanban" || screen !== "pipeline" || loading) {
      setKanbanScrollbar(null);
      return undefined;
    }

    let syncFrame = 0;
    let expectedBoardScrollLeft = null;
    let expectedFloatingScrollLeft = null;
    const updateScrollbar = () => {
      const bounds = scrollElement.getBoundingClientRect();
      const hasHorizontalOverflow = scrollElement.scrollWidth > scrollElement.clientWidth + 1;
      const next = {
        left: bounds.left,
        width: bounds.width,
        scrollRange: scrollElement.scrollWidth - scrollElement.clientWidth,
        visible: hasHorizontalOverflow && bounds.bottom > 0 && bounds.top < window.innerHeight,
      };
      setKanbanScrollbar((current) => current
        && current.left === next.left
        && current.width === next.width
        && current.scrollRange === next.scrollRange
        && current.visible === next.visible ? current : next);
    };
    const syncScroll = (source, target, sourceIsBoard) => {
      const expectedSourceScrollLeft = sourceIsBoard
        ? expectedBoardScrollLeft
        : expectedFloatingScrollLeft;
      if (expectedSourceScrollLeft !== null) {
        if (sourceIsBoard) expectedBoardScrollLeft = null;
        else expectedFloatingScrollLeft = null;
        if (Math.abs(source.scrollLeft - expectedSourceScrollLeft) <= 1) return;
      }
      if (syncFrame) window.cancelAnimationFrame(syncFrame);
      syncFrame = window.requestAnimationFrame(() => {
        syncFrame = 0;
        if (Math.abs(target.scrollLeft - source.scrollLeft) > 1) {
          target.scrollLeft = source.scrollLeft;
          if (target === scrollElement) expectedBoardScrollLeft = target.scrollLeft;
          else expectedFloatingScrollLeft = target.scrollLeft;
        }
      });
    };
    const syncFromBoard = () => syncScroll(scrollElement, floatingElement, true);
    const syncFromFloatingBar = () => syncScroll(floatingElement, scrollElement, false);
    const resizeObserver = new ResizeObserver(updateScrollbar);
    resizeObserver.observe(scrollElement);
    resizeObserver.observe(contentElement);
    scrollElement.addEventListener("scroll", syncFromBoard, { passive: true });
    floatingElement.addEventListener("scroll", syncFromFloatingBar, { passive: true });
    window.addEventListener("scroll", updateScrollbar, { passive: true });
    window.addEventListener("resize", updateScrollbar);
    updateScrollbar();

    return () => {
      resizeObserver.disconnect();
      if (syncFrame) window.cancelAnimationFrame(syncFrame);
      scrollElement.removeEventListener("scroll", syncFromBoard);
      floatingElement.removeEventListener("scroll", syncFromFloatingBar);
      window.removeEventListener("scroll", updateScrollbar);
      window.removeEventListener("resize", updateScrollbar);
    };
  }, [filtered.length, loading, screen, stages.length, view]);
  const stats = useMemo(() => {
    const count = (predicate) => prospects.filter(predicate).length;
    const stageIs = (key) => (item) => item.stage_key === key;
    const activeValue = prospects.filter((item) => !item.is_won && !item.is_lost)
      .reduce((sum, item) => sum + (Number(item.potential_value) || 0), 0);
    return {
      total: prospects.length,
      contacted: count((item) => ["contacted", "responded", "triage_scheduled", "proposal_scheduled", "proposal_sent", "negotiation"].includes(item.stage_key)),
      meetings: count((item) => ["triage_scheduled", "proposal_scheduled"].includes(item.stage_key)),
      proposals: count(stageIs("proposal_sent")),
      negotiation: count(stageIs("negotiation")),
      won: count((item) => Boolean(item.is_won)),
      lost: count((item) => Boolean(item.is_lost)),
      due: count((item) => item.next_action_date === today() && !item.is_won && !item.is_lost),
      overdue: count(isOverdue),
      activeValue,
      closedValue: prospects.filter((item) => item.is_won).reduce((sum, item) => sum + (Number(item.potential_value) || 0), 0),
    };
  }, [prospects]);

  const changeStage = async (prospect, stageId, scheduledMeeting = "", reason, nextFollowUpDate = "") => {
    if (String(prospect.stage_id) === String(stageId)) return false;
    const target = stages.find((item) => String(item.id) === String(stageId));
    if (target?.is_won && !prospect.converted_client_id) {
      openClientConversion(prospect, Number(stageId));
      return false;
    }
    if (target?.stage_key === "future_interest" && !nextFollowUpDate) {
      setFollowUpPrompt({ prospect, stageId: Number(stageId) });
      setFollowUpDate("");
      return false;
    }
    if (!scheduledMeeting && ["triage_scheduled", "proposal_scheduled"].includes(target?.stage_key)) {
      setMeetingPrompt({ prospect, stageId: Number(stageId), mode: "meeting" });
      setMeetingAt("");
      return false;
    }
    if (target?.stage_key === "lost" && reason === undefined) {
      setMeetingPrompt({ prospect, stageId: Number(stageId), mode: "loss" });
      setLossReason(prospect.loss_reason || "");
      return false;
    }
    try {
      const updated = await updateProspect(prospect.id, {
        stage_id: Number(stageId),
        ...(scheduledMeeting ? { meeting_at: scheduledMeeting } : {}),
        ...(reason !== undefined ? { loss_reason: reason } : {}),
        ...(target?.stage_key === "future_interest" ? { next_action_date: nextFollowUpDate } : {}),
      });
      const nextProspects = await load();
      setSelected((current) => current?.id === prospect.id ? (nextProspects?.find((item) => item.id === prospect.id) || updated) : current);
      return true;
    } catch (saveError) {
      toast({ title: "Não foi possível mover o prospect", description: saveError.message, variant: "destructive" });
      return false;
    }
  };

  const openCreate = () => { setForm({ ...EMPTY_FORM, stage_id: stages.find((item) => item.stage_key === "new")?.id || stages[0]?.id || "" }); setFormOpen(true); };
  const openEdit = (prospect) => {
    setForm({ ...Object.fromEntries(Object.keys(EMPTY_FORM).map((key) => [key, prospect[key] ?? ""])), id: prospect.id });
    setFormOpen(true);
  };

  const saveProspect = async (event) => {
    event.preventDefault();
    if (!form.company_name.trim()) return;
    setSaving(true);
    try {
      const payload = { ...form, stage_id: Number(form.stage_id), potential_value: form.potential_value === "" ? null : Number(form.potential_value) };
      if (form.id) delete payload.stage_id;
      const saved = form.id ? await updateProspect(form.id, payload) : await createProspect(payload);
      await load();
      setFormOpen(false);
      setSelected(saved);
      toast({ title: form.id ? "Prospect atualizado" : "Prospect criado" });
    } catch (saveError) {
      toast({ title: "Não foi possível salvar", description: saveError.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const completeActionWithoutMessage = async (prospect) => {
    setCompletingActionId(prospect.id);
    try {
      const result = await completeProspectAction(prospect.id);
      const [nextProspects, nextInteractions, nextHistory] = await Promise.all([
        load(), getProspectInteractions(prospect.id), getProspectHistory(prospect.id),
      ]);
      setInteractions(nextInteractions);
      setStageHistory(nextHistory);
      const updated = nextProspects?.find((item) => item.id === prospect.id) || result.prospect;
      setSelected((current) => current?.id === prospect.id ? updated : current);
      toast({ title: "Ação concluída", description: "O próximo acompanhamento foi atualizado." });
    } catch (actionError) {
      toast({ title: "Não foi possível concluir a ação", description: actionError.message, variant: "destructive" });
    } finally {
      setCompletingActionId(null);
    }
  };

  const completeActionManually = async () => {
    if (!actionPrompt || messageSending || confirmedMessage || sendRequestId) return;
    const prospect = actionPrompt.prospect;
    setMessageSending(true);
    setMessageError("");
    try {
      const result = await completeProspectActionManually(prospect.id);
      const [nextProspects, nextInteractions, nextHistory] = await Promise.all([
        load(), getProspectInteractions(prospect.id), getProspectHistory(prospect.id),
      ]);
      setInteractions(nextInteractions);
      setStageHistory(nextHistory);
      const updated = nextProspects?.find((item) => item.id === prospect.id) || result.prospect;
      setSelected((current) => current?.id === prospect.id ? updated : current);
      setActionPrompt(null);
      setConfirmedMessage(null);
      setSendRequestId("");
      toast({
        title: prospect.stage_key === "new" ? "Prospect avançou para Contatado" : "Ação concluída",
        description: "A conclusão foi registrada sem envio pelo WhatsApp da plataforma.",
      });
    } catch (actionError) {
      setMessageError(actionError.message || "Não foi possível concluir a ação sem envio pelo WhatsApp.");
    } finally {
      setMessageSending(false);
    }
  };

  const completeAction = async (prospect, event) => {
    event?.stopPropagation();
    if (!automationReady) return;
    if (automationError) {
      toast({ title: "Ação mantida pendente", description: "Não foi possível carregar a regra de envio. Tente novamente antes de concluir.", variant: "destructive" });
      return;
    }
    const rule = automationRules.find((item) => item.stage_key === prospect.stage_key && item.action === prospect.next_action);
    if (!rule?.open_message_modal) {
      await completeActionWithoutMessage(prospect);
      return;
    }

    const matchingScripts = automationScripts.filter((script) =>
      (!script.stage_key || script.stage_key === prospect.stage_key)
      && (!script.action || script.action === prospect.next_action));
    const suggested = matchingScripts.find((script) => script.id === rule.recommended_script_id)
      || matchingScripts.find((script) => script.is_default)
      || matchingScripts[0]
      || null;
    setActionPrompt({ prospect, rule });
    setMessagePhone(prospect.contact_phone || prospect.phone || "");
    setMessageScriptId(suggested?.id ? String(suggested.id) : "");
    setMessageTemplate(suggested?.body || "");
    setMessageDraft(suggested ? renderMessageTemplate(suggested.body, prospect) : "");
    setMessageEdited(false);
    setWhatsAppStatus(null);
    setWhatsAppStatusError("");
    setMessageError("");
    setConfirmedMessage(null);
    setSendRequestId("");
    getWhatsAppStatus()
      .then((status) => setWhatsAppStatus(status))
      .catch((statusError) => {
        setWhatsAppStatus({ state: "error" });
        setWhatsAppStatusError(statusError.message);
      });
  };

  const startWhatsAppForAction = async () => {
    setWhatsAppStatusError("");
    try {
      setWhatsAppStatus(await connectWhatsApp());
    } catch (connectionError) {
      setWhatsAppStatusError(connectionError.message);
    }
  };

  const sendActionMessage = async () => {
    if (!actionPrompt || messageSending) return;
    const prospect = actionPrompt.prospect;
    const recipientJid = phoneToWhatsAppJid(messagePhone);
    const content = messageDraft.trim();
    if (!recipientJid) {
      setMessageError("Informe um número válido com código do país ou DDD para enviar pelo WhatsApp.");
      return;
    }
    if (!content) {
      setMessageError("Escreva a mensagem antes de enviar.");
      return;
    }
    if (content.length > 4096) {
      setMessageError("A mensagem deve ter até 4.096 caracteres.");
      return;
    }
    const unresolved = content.match(/\{[^{}]+\}/g) || [];
    if (unresolved.length) {
      setMessageError(`Revise as variáveis não preenchidas: ${[...new Set(unresolved)].join(", ")}.`);
      return;
    }
    if (!confirmedMessage && whatsAppStatus?.state !== "connected") {
      setMessageError("O WhatsApp não está conectado. Conecte a sessão antes de enviar.");
      return;
    }

    setMessageSending(true);
    setMessageError("");
    let sent = confirmedMessage;
    try {
      if (!sent) {
        const requestId = sendRequestId || window.crypto.randomUUID();
        setSendRequestId(requestId);
        sent = await sendWhatsAppMessage(recipientJid, content, requestId);
        setConfirmedMessage(sent);
      }
      const script = automationScripts.find((item) => String(item.id) === String(messageScriptId));
      const result = await completeProspectAction(prospect.id, {
        message_id: sent.id,
        chat_jid: sent.chatJid || recipientJid,
        content,
        script_id: script?.id || null,
        script_name: script?.name || "Mensagem personalizada",
      });
      const [nextProspects, nextInteractions, nextHistory] = await Promise.all([
        load(), getProspectInteractions(prospect.id), getProspectHistory(prospect.id),
      ]);
      setInteractions(nextInteractions);
      setStageHistory(nextHistory);
      const updated = nextProspects?.find((item) => item.id === prospect.id) || result.prospect;
      setSelected((current) => current?.id === prospect.id ? updated : current);
      setActionPrompt(null);
      setConfirmedMessage(null);
      toast({ title: "Mensagem enviada e ação concluída", description: "O envio foi salvo no histórico do prospect." });
    } catch (sendError) {
      setMessageError(sent
        ? `A mensagem já foi enviada. Não a reenvie; tente salvar a conclusão novamente. ${sendError.message}`
        : sendError.message);
    } finally {
      setMessageSending(false);
    }
  };

  const saveNewSource = async (event) => {
    event.preventDefault();
    if (!sourceName.trim()) return;
    try {
      const source = await createProspectSource(sourceName.trim());
      setSources((current) => [...current, source].sort((a, b) => a.name.localeCompare(b.name, "pt-BR")));
      setForm((current) => ({ ...current, source: source.name }));
      setSourcePrompt(false);
      setSourceName("");
      toast({ title: "Origem criada" });
    } catch (sourceError) {
      toast({ title: "Não foi possível criar a origem", description: sourceError.message, variant: "destructive" });
    }
  };

  const addInteraction = async (event) => {
    event.preventDefault();
    if (!selected || !interactionForm.notes.trim()) return;
    setSaving(true);
    try {
      await addProspectInteraction(selected.id, interactionForm);
      const [nextInteractions, nextProspects] = await Promise.all([getProspectInteractions(selected.id), load()]);
      setInteractions(nextInteractions);
      const updated = nextProspects?.find((item) => item.id === selected.id);
      if (updated) setSelected(updated);
      setInteractionForm({ interaction_date: today(), type: "Contato", notes: "" });
      toast({ title: "Interação registrada" });
    } catch (saveError) {
      toast({ title: "Não foi possível registrar", description: saveError.message, variant: "destructive" });
    } finally { setSaving(false); }
  };

  const remove = async () => {
    if (!selected || !window.confirm(`Excluir o prospect ${selected.company_name}?`)) return;
    try {
      await deleteProspect(selected.id);
      setSelected(null);
      await load();
      toast({ title: "Prospect excluído" });
    } catch (removeError) { toast({ title: "Não foi possível excluir", description: removeError.message, variant: "destructive" }); }
  };

  const openClientConversion = (prospect, stageId) => {
    setClientConversion({ prospect, stageId });
    setClientForm({
      name: prospect.company_name || "",
      origin: "SJ Marketing",
      account_id: "",
      active: true,
      payment_method: "auto",
      monthly_fee: prospect.potential_value == null ? "" : String(prospect.potential_value),
      first_payment_date: "",
      entry_date: today(),
      exit_date: "",
    });
  };

  const convert = () => {
    if (selected) openClientConversion(selected, selected.stage_id);
  };

  const saveConvertedClient = async (event) => {
    event.preventDefault();
    if (!clientConversion || !clientForm) return;
    setSaving(true);
    try {
      const selectedAccount = accounts.find((account) => String(account.id) === String(clientForm.account_id));
      const payload = {
        ...clientForm,
        monthly_fee: clientForm.monthly_fee === "" ? null : Number(clientForm.monthly_fee),
        account_id: clientForm.account_id || null,
        currency: selectedAccount?.currency || "BRL",
      };
      const result = await convertProspect(clientConversion.prospect.id, payload, clientConversion.stageId);
      await Promise.all([load(), refreshAppData()]);
      setSelected(result.prospect);
      setClientConversion(null);
      setClientForm(null);
      toast({ title: "Cliente cadastrado", description: `${result.client.name} agora estÃ¡ disponÃ­vel nas ConfiguraÃ§Ãµes e nas Ã¡reas de clientes.` });
    } catch (convertError) {
      toast({ title: "NÃ£o foi possÃ­vel cadastrar o cliente", description: convertError.message, variant: "destructive" });
    } finally { setSaving(false); }
  };
  const stageProspects = (stage) => filtered.filter((item) => item.stage_id === stage.id);
  const actionMessageScripts = actionPrompt ? automationScripts.filter((script) =>
    (!script.stage_key || script.stage_key === actionPrompt.prospect.stage_key)
    && (!script.action || script.action === actionPrompt.prospect.next_action)) : [];
  const unresolvedMessageVariables = [...new Set(messageDraft.match(/\{[^{}]+\}/g) || [])];
  const actionRecipientJid = phoneToWhatsAppJid(messagePhone);

  if (screen === "reports") return <AcquisitionAnalytics onBack={() => setScreen("pipeline")} />;
  if (screen === "lead-list") return <AcquisitionLeadList onBack={() => setScreen("pipeline")} onApproved={() => { void load(); }} />;

  return (
    <div className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-[1600px] space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-center sm:justify-between">
          <div><p className="text-sm font-medium text-primary">Comercial</p><h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Aquisição</h1><p className="mt-1 text-sm text-muted-foreground">Acompanhe a prospecção, os próximos contatos e as oportunidades.</p></div>
          <div className="flex gap-2"><button onClick={() => setScreen("reports")} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Análises</button><button onClick={() => setScreen("lead-list")} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Lista</button><button onClick={openCreate} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="h-4 w-4" /> Novo prospect</button></div>
        </header>

        {error && <div className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4" />{error}<button className="ml-auto underline" onClick={load}>Tentar novamente</button></div>}

        <section className="grid grid-cols-2 gap-3 md:grid-cols-3 xl:grid-cols-5">
          <KpiCard label="Prospects" value={stats.total} icon={Building2} accentClass="text-blue-600" />
          <KpiCard label="Em contato" value={stats.contacted} icon={UserRound} accentClass="text-indigo-600" />
          <KpiCard label="Reuniões agendadas" value={stats.meetings} icon={CalendarClock} accentClass="text-violet-600" />
          <KpiCard label="Propostas enviadas" value={stats.proposals} icon={MessageSquare} accentClass="text-sky-600" />
          <KpiCard label="Em negociação" value={stats.negotiation} icon={ArrowRightLeft} accentClass="text-violet-600" />
          <KpiCard label="Fechados" value={stats.won} icon={Check} accentClass="text-emerald-600" />
          <KpiCard label="Perdidos" value={stats.lost} icon={X} accentClass="text-rose-600" />
          <KpiCard label="Follow-ups hoje" value={stats.due} icon={Clock3} accentClass="text-amber-600" />
          <KpiCard label="Ações atrasadas" value={stats.overdue} icon={AlertCircle} accentClass="text-rose-600" />
          <KpiCard label="Potencial em aberto" value={currency(stats.activeValue)} icon={CircleDollarSign} accentClass="text-emerald-600" sub={`Fechado: ${currency(stats.closedValue)}`} />
        </section>

        <section className="rounded-xl border bg-card shadow-sm">
          <div className="flex flex-col gap-3 border-b p-4 lg:flex-row lg:items-center">
            <div className="relative min-w-0 flex-1"><Search className="absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" /><input className={`${inputClass} pl-9`} placeholder="Buscar empresa, contato, segmento ou cidade" value={search} onChange={(event) => setSearch(event.target.value)} /></div>
            <div className="grid grid-cols-2 gap-2 sm:flex">
              <select className={`${inputClass} min-w-36`} value={stageFilter} onChange={(event) => setStageFilter(event.target.value)}><option value="all">Todas as etapas</option>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select>
              <select className={`${inputClass} min-w-36`} value={ownerFilter} onChange={(event) => setOwnerFilter(event.target.value)}><option value="all">Todos responsáveis</option>{owners.map((owner) => <option key={owner} value={owner}>{owner}</option>)}</select>
              <button type="button" onClick={() => setOverdueOnly((value) => !value)} className={`h-10 rounded-md border px-3 text-sm ${overdueOnly ? "border-destructive bg-destructive/10 text-destructive" : "hover:bg-muted"}`}>Atrasados</button>
              <div className="inline-flex h-10 items-center rounded-md border p-1">
                <button aria-label="Visualização Kanban" title="Kanban" onClick={() => setView("kanban")} className={`inline-flex h-8 w-9 items-center justify-center rounded ${view === "kanban" ? "bg-muted" : "text-muted-foreground"}`}><Kanban className="h-4 w-4" /></button>
                <button aria-label="Visualização em lista" title="Lista" onClick={() => setView("list")} className={`inline-flex h-8 w-9 items-center justify-center rounded ${view === "list" ? "bg-muted" : "text-muted-foreground"}`}><List className="h-4 w-4" /></button>
              </div>
            </div>
          </div>

          {loading ? <div className="flex h-56 items-center justify-center text-muted-foreground"><Loader2 className="mr-2 h-5 w-5 animate-spin" />Carregando prospects...</div> : view === "kanban" ? (
            <div ref={kanbanScrollRef} className="kanban-board-scroll overflow-x-auto">
              <div ref={kanbanContentRef} className="flex gap-3 p-4 pb-8">
              {stages.map((stage) => <section key={stage.id} onDragOver={(event) => event.preventDefault()} onDrop={() => {
                const prospect = prospects.find((item) => item.id === draggingId);
                if (prospect) changeStage(prospect, stage.id);
                setDraggingId(null);
              }} className="w-[280px] shrink-0 rounded-lg bg-muted/50 p-2.5 sm:w-[300px]">
                <div className="mb-2 flex items-center justify-between px-1"><h2 className="text-sm font-semibold">{stage.name}</h2><span className="rounded-full bg-background px-2 py-0.5 text-xs text-muted-foreground">{stageProspects(stage).length}</span></div>
                <div className="min-h-36 space-y-2">
                  {stageProspects(stage).map((prospect) => <article key={prospect.id} draggable onDragStart={() => setDraggingId(prospect.id)} onDragEnd={() => setDraggingId(null)} onClick={() => setSelected(prospect)} className={`cursor-pointer rounded-lg border bg-card p-3 shadow-sm transition hover:border-primary/50 hover:shadow ${draggingId === prospect.id ? "opacity-50" : ""}`}>
                    <div className="flex items-start justify-between gap-2"><div className="min-w-0"><h3 className="truncate text-sm font-semibold">{prospect.company_name}</h3><p className="mt-0.5 truncate text-xs text-muted-foreground">{prospect.contact_name || "Sem contato"}{prospect.segment ? ` · ${prospect.segment}` : ""}</p></div>{isOverdue(prospect) && <span title="Follow-up atrasado" className="mt-1 h-2.5 w-2.5 shrink-0 rounded-full bg-destructive" />}</div>
                    {(prospect.city || prospect.owner) && <p className="mt-2 truncate text-xs text-muted-foreground">{[prospect.city, prospect.owner].filter(Boolean).join(" · ")}</p>}
                    <p className="mt-2 text-[11px] text-muted-foreground">Último contato: {dateLabel(prospect.latest_interaction || prospect.last_contact_at)}</p>
                    {!prospect.is_won && !prospect.is_lost && <div className="mt-3 rounded-md bg-muted/60 px-2.5 py-2"><div className="flex items-center justify-between gap-2"><p className="text-xs font-medium">{prospect.next_action || "Próxima ação não definida"}</p>{canCompleteAction(prospect) && <button type="button" disabled={!automationReady || completingActionId === prospect.id} title="Marcar como concluído" aria-label={`Concluir ${prospect.next_action}`} onClick={(event) => completeAction(prospect, event)} className="inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md border bg-background text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"><Check className="h-4 w-4" /></button>}</div>{prospect.next_action_date && <p className={`mt-1 text-[11px] ${isOverdue(prospect) ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{isOverdue(prospect) ? "Atrasado · " : ""}{dateLabel(prospect.next_action_date)}</p>}</div>}
                    <div className="mt-2 flex items-center justify-between"><span className="text-xs font-medium text-muted-foreground">{currency(prospect.potential_value)}</span><ChevronDown className="h-4 w-4 -rotate-90 text-muted-foreground" /></div>
                  </article>)}
                  {!stageProspects(stage).length && <div className="flex min-h-24 items-center justify-center rounded-md border border-dashed text-xs text-muted-foreground">Solte prospects nesta etapa</div>}
                </div>
              </section>)}
              </div>
            </div>
          ) : (
            <div className="overflow-x-auto"><table className="w-full min-w-[1150px] text-left text-sm"><thead className="bg-muted/40 text-xs text-muted-foreground"><tr>{["Empresa / contato", "Segmento", "Cidade", "Telefone", "Etapa", "Último contato", "Próxima ação", "Responsável", "Valor"].map((label) => <th key={label} className="px-4 py-3 font-medium">{label}</th>)}</tr></thead><tbody className="divide-y">
              {filtered.map((prospect) => <tr key={prospect.id} onClick={() => setSelected(prospect)} className="cursor-pointer hover:bg-muted/30"><td className="px-4 py-3"><div className="font-medium">{prospect.company_name}</div><div className="mt-0.5 text-xs text-muted-foreground">{prospect.contact_name || "Sem contato"}</div></td><td className="px-4 py-3 text-muted-foreground">{prospect.segment || "—"}</td><td className="px-4 py-3 text-muted-foreground">{prospect.city || "—"}</td><td className="px-4 py-3 text-muted-foreground">{prospect.phone || prospect.contact_phone || "—"}</td><td className="px-4 py-3"><select aria-label={`Etapa de ${prospect.company_name}`} onClick={(event) => event.stopPropagation()} onChange={(event) => changeStage(prospect, event.target.value)} value={prospect.stage_id} className="max-w-48 rounded-md border bg-background px-2 py-1.5 text-xs">{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></td><td className="px-4 py-3 text-muted-foreground">{dateLabel(prospect.latest_interaction || prospect.last_contact_at)}</td><td className={`px-4 py-3 ${isOverdue(prospect) ? "font-medium text-destructive" : "text-muted-foreground"}`}>{prospect.is_won || prospect.is_lost ? "—" : (prospect.next_action || "—")}{!prospect.is_won && !prospect.is_lost && prospect.next_action_date && <div className="mt-0.5 text-xs">{dateLabel(prospect.next_action_date)}</div>}</td><td className="px-4 py-3 text-muted-foreground">{prospect.owner || "—"}</td><td className="px-4 py-3 font-medium">{currency(prospect.potential_value)}</td></tr>)}
              {!filtered.length && <tr><td colSpan={9} className="px-4 py-12 text-center text-sm text-muted-foreground">{prospects.length ? "Nenhum prospect corresponde aos filtros." : "Ainda não há prospects. Cadastre o primeiro para começar."}</td></tr>}
            </tbody></table></div>
          )}
        </section>
        {view === "kanban" && !loading && <div
          ref={floatingKanbanScrollRef}
          aria-label="Rolagem horizontal do Kanban"
          role="region"
          aria-hidden={!kanbanScrollbar?.visible}
          tabIndex={kanbanScrollbar?.visible ? 0 : -1}
          className="fixed bottom-1 z-50 h-4 overflow-x-auto overflow-y-hidden rounded border bg-card shadow-lg"
          style={{
            left: `${kanbanScrollbar?.left || 0}px`,
            width: `${kanbanScrollbar?.width || 0}px`,
            visibility: kanbanScrollbar?.visible ? "visible" : "hidden",
            pointerEvents: kanbanScrollbar?.visible ? "auto" : "none",
          }}
        ><div aria-hidden="true" style={{ width: `calc(100% + ${kanbanScrollbar?.scrollRange || 0}px)`, height: "1px" }} /></div>}
      </div>

      {meetingPrompt && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setMeetingPrompt(null)}><form onSubmit={(event) => { event.preventDefault(); changeStage(meetingPrompt.prospect, meetingPrompt.stageId, meetingPrompt.mode === "meeting" ? meetingAt : "", meetingPrompt.mode === "loss" ? lossReason : undefined); setMeetingPrompt(null); }} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-2xl"><div><h2 className="text-lg font-semibold">{stages.find((item) => item.id === meetingPrompt.stageId)?.name}</h2><p className="mt-1 text-sm text-muted-foreground">{meetingPrompt.mode === "loss" ? "Informe o motivo da perda (opcional)." : "Informe a data e o horário da reunião."}</p></div>{meetingPrompt.mode === "loss" ? <Field label="Motivo da perda"><textarea rows={3} value={lossReason} onChange={(event) => setLossReason(event.target.value)} className={textareaClass} /></Field> : <Field label="Data e horário"><input type="datetime-local" required value={meetingAt} onChange={(event) => setMeetingAt(event.target.value)} className={inputClass} /></Field>}<div className="flex justify-end gap-2"><button type="button" onClick={() => setMeetingPrompt(null)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Cancelar</button><button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">{meetingPrompt.mode === "loss" ? "Registrar perda" : "Agendar"}</button></div></form></div>}
      {followUpPrompt && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setFollowUpPrompt(null)}><form onSubmit={async (event) => {
        event.preventDefault();
        const saved = await changeStage(followUpPrompt.prospect, followUpPrompt.stageId, "", undefined, followUpDate);
        if (saved) setFollowUpPrompt(null);
      }} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-2xl">
        <div><h2 className="text-lg font-semibold">Adiado / Futuro interesse</h2><p className="mt-1 text-sm text-muted-foreground">Defina quando fazer o próximo follow-up com {followUpPrompt.prospect.company_name}.</p></div>
        <Field label="Data do follow-up"><input autoFocus type="date" required value={followUpDate} onChange={(event) => setFollowUpDate(event.target.value)} className={inputClass} /></Field>
        <div className="flex justify-end gap-2"><button type="button" onClick={() => setFollowUpPrompt(null)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Cancelar</button><button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Salvar etapa</button></div>
      </form></div>}
      {sourcePrompt && <div className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => setSourcePrompt(false)}><form onSubmit={saveNewSource} onMouseDown={(event) => event.stopPropagation()} className="w-full max-w-md space-y-4 rounded-xl border bg-card p-5 shadow-2xl"><div><h2 className="text-lg font-semibold">Nova origem</h2><p className="mt-1 text-sm text-muted-foreground">Adicione uma opção para os próximos prospects.</p></div><Field label="Nome da origem"><input autoFocus required value={sourceName} onChange={(event) => setSourceName(event.target.value)} className={inputClass} /></Field><div className="flex justify-end gap-2"><button type="button" onClick={() => setSourcePrompt(false)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Cancelar</button><button className="h-10 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground">Criar origem</button></div></form></div>}      {clientConversion && clientForm && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-3 sm:p-5" onMouseDown={() => { if (!saving) { setClientConversion(null); setClientForm(null); } }}><form onSubmit={saveConvertedClient} onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[94vh] w-full max-w-2xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-lg font-semibold">Cadastrar cliente</h2><p className="mt-0.5 text-xs text-muted-foreground">Preencha os dados do cliente para concluir o fechamento de {clientConversion.prospect.company_name}.</p></div><button type="button" disabled={saving} onClick={() => { setClientConversion(null); setClientForm(null); }} aria-label="Fechar" className="rounded-md p-2 hover:bg-muted disabled:opacity-50"><X className="h-4 w-4" /></button></div>
        <div className="flex-1 space-y-4 overflow-y-auto p-5">
          <Field label="Nome do cliente *"><input autoFocus required value={clientForm.name} onChange={(event) => setClientForm({ ...clientForm, name: event.target.value })} className={inputClass} /></Field>
          <div className="flex items-center justify-between rounded-lg border px-3 py-2"><span className="text-sm font-medium">{clientForm.active ? "Ativo" : "Inativo"}</span><Switch checked={clientForm.active} disabled={saving} aria-label={clientForm.active ? "Desativar cliente" : "Ativar cliente"} onCheckedChange={(active) => setClientForm({ ...clientForm, active })} /></div>
          <Field label="Conta Meta"><select value={clientForm.account_id} onChange={(event) => setClientForm({ ...clientForm, account_id: event.target.value })} className={inputClass}><option value="">Sem conta vinculada</option>{accounts.filter((account) => !Object.values(clients).some((client) => String(client.account_id) === String(account.id))).map((account) => <option key={account.id} value={account.id}>{account.name} — {account.id}</option>)}</select></Field>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Origem *"><select required value={clientForm.origin} onChange={(event) => setClientForm({ ...clientForm, origin: event.target.value })} className={inputClass}><option value="SJ Marketing">SJ Marketing</option><option value="Avaloon">Avaloon</option></select></Field><Field label="Valor da mensalidade (R$)"><input type="number" min="0" step="0.01" value={clientForm.monthly_fee} onChange={(event) => setClientForm({ ...clientForm, monthly_fee: event.target.value })} className={inputClass} /></Field></div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Data de pgmt."><input type="date" value={clientForm.first_payment_date} onChange={(event) => setClientForm({ ...clientForm, first_payment_date: event.target.value })} className={inputClass} /></Field><Field label="Forma de pagamento"><select value={clientForm.payment_method} onChange={(event) => setClientForm({ ...clientForm, payment_method: event.target.value })} className={inputClass}><option value="auto">Automática (Meta)</option><option value="prepaid">Saldo pré-pago</option><option value="credit_card">Cartão de crédito</option><option value="other">Outra forma de pagamento</option><option value="unknown">Não identificado</option></select></Field></div>
          <div className="grid gap-3 sm:grid-cols-2"><Field label="Data de entrada *"><input required type="date" value={clientForm.entry_date} onChange={(event) => setClientForm({ ...clientForm, entry_date: event.target.value })} className={inputClass} /></Field><Field label="Data de saída"><input type="date" value={clientForm.exit_date} onChange={(event) => setClientForm({ ...clientForm, exit_date: event.target.value })} className={inputClass} /></Field></div>
        </div><div className="flex justify-end gap-2 border-t p-4"><button type="button" disabled={saving} onClick={() => { setClientConversion(null); setClientForm(null); }} className="h-10 rounded-md border px-4 text-sm hover:bg-muted disabled:opacity-50">Cancelar</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}Cadastrar e fechar</button></div>
      </form></div>}      {formOpen && <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-3 sm:p-5" onMouseDown={() => setFormOpen(false)}><form onSubmit={saveProspect} onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[94vh] w-full max-w-3xl flex-col rounded-xl border bg-card shadow-2xl">
        <div className="flex items-center justify-between border-b px-5 py-4"><div><h2 className="text-lg font-semibold">{form.id ? "Editar prospect" : "Novo prospect"}</h2><p className="mt-0.5 text-xs text-muted-foreground">Cadastre os dados essenciais e defina a próxima ação.</p></div><button type="button" onClick={() => setFormOpen(false)} aria-label="Fechar" className="rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button></div>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <section><SectionTitle>Empresa</SectionTitle><div className="grid gap-3 sm:grid-cols-2"><Field label="Nome da empresa *"><input autoFocus required value={form.company_name} onChange={(event) => setForm({ ...form, company_name: event.target.value })} className={inputClass} /></Field><Field label="Segmento / nicho"><input value={form.segment} onChange={(event) => setForm({ ...form, segment: event.target.value })} className={inputClass} /></Field><Field label="Cidade"><input value={form.city} onChange={(event) => setForm({ ...form, city: event.target.value })} className={inputClass} /></Field><Field label="Telefone / WhatsApp"><input value={form.phone} onChange={(event) => setForm({ ...form, phone: event.target.value })} className={inputClass} /></Field><Field label="Instagram da empresa"><input value={form.company_instagram} onChange={(event) => setForm({ ...form, company_instagram: event.target.value })} className={inputClass} /></Field><Field label="Site"><input value={form.website} onChange={(event) => setForm({ ...form, website: event.target.value })} className={inputClass} /></Field></div></section>
          <section><SectionTitle>Contato</SectionTitle><div className="grid gap-3 sm:grid-cols-2"><Field label="Nome do contato"><input value={form.contact_name} onChange={(event) => setForm({ ...form, contact_name: event.target.value })} className={inputClass} /></Field><Field label="Cargo / função"><input value={form.contact_role} onChange={(event) => setForm({ ...form, contact_role: event.target.value })} className={inputClass} /></Field><Field label="Telefone do contato"><input value={form.contact_phone} onChange={(event) => setForm({ ...form, contact_phone: event.target.value })} className={inputClass} /></Field><Field label="Instagram do contato"><input value={form.contact_instagram} onChange={(event) => setForm({ ...form, contact_instagram: event.target.value })} className={inputClass} /></Field></div></section>
          <section><SectionTitle>Comercial e acompanhamento</SectionTitle><div className="grid gap-3 sm:grid-cols-2"><Field label="Etapa"><select disabled value={form.stage_id} className={inputClass}>{stages.map((stage) => <option key={stage.id} value={stage.id}>{stage.name}</option>)}</select></Field><Field label="Responsável"><input value={form.owner} onChange={(event) => setForm({ ...form, owner: event.target.value })} placeholder="Nome do responsável" className={inputClass} /></Field><Field label="Origem"><select value={form.source} onChange={(event) => { if (event.target.value === "__new") { setSourcePrompt(true); return; } setForm({ ...form, source: event.target.value }); }} className={inputClass}><option value="">Selecione uma origem</option>{sources.map((source) => <option key={source.id} value={source.name}>{source.name}</option>)}<option value="__new">+ Criar nova origem</option></select></Field><Field label="Oferta / serviço de interesse"><input value={form.offer} onChange={(event) => setForm({ ...form, offer: event.target.value })} className={inputClass} /></Field><Field label="Motivo da perda (opcional)"><input value={form.loss_reason} onChange={(event) => setForm({ ...form, loss_reason: event.target.value })} className={inputClass} /></Field><Field label="Valor potencial (R$)"><input type="number" min="0" step="0.01" value={form.potential_value} onChange={(event) => setForm({ ...form, potential_value: event.target.value })} className={inputClass} /></Field><Field label="Próxima ação"><select value={form.next_action} onChange={(event) => setForm({ ...form, next_action: event.target.value })} className={inputClass}><option value="">Selecione</option>{ACTIONS.map((action) => <option key={action}>{action}</option>)}</select></Field><Field label="Data do próximo contato"><input type="date" required={!form.id} value={form.next_action_date} onChange={(event) => setForm({ ...form, next_action_date: event.target.value })} className={inputClass} /></Field><Field label="Observações" className="sm:col-span-2"><textarea rows={3} value={form.notes} onChange={(event) => setForm({ ...form, notes: event.target.value })} className={textareaClass} /></Field></div></section>
        </div><div className="flex justify-end gap-2 border-t p-4"><button type="button" onClick={() => setFormOpen(false)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Cancelar</button><button disabled={saving} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">{saving && <Loader2 className="h-4 w-4 animate-spin" />}{form.id ? "Salvar alterações" : "Criar prospect"}</button></div>
      </form></div>}

      {selected && <div className="fixed inset-0 z-40 flex justify-end bg-black/50" onMouseDown={() => setSelected(null)}><aside onMouseDown={(event) => event.stopPropagation()} className="flex h-full w-full max-w-2xl flex-col border-l bg-card shadow-2xl">
        <div className="flex items-start justify-between border-b p-5"><div className="min-w-0"><p className="text-xs font-medium uppercase tracking-wide text-primary">{selected.stage_name}</p><h2 className="mt-1 truncate text-xl font-bold">{selected.company_name}</h2><p className="mt-1 text-sm text-muted-foreground">{[selected.contact_name, selected.segment, selected.city].filter(Boolean).join(" · ") || "Sem dados de contato"}</p></div><button onClick={() => setSelected(null)} aria-label="Fechar" className="rounded-md p-2 hover:bg-muted"><X className="h-4 w-4" /></button></div>
        <div className="flex-1 space-y-6 overflow-y-auto p-5">
          <div className="grid grid-cols-2 gap-3">{!selected.is_won && !selected.is_lost && <div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Próxima ação</p><p className="mt-1 text-sm font-medium">{selected.next_action || "Não definida"}</p><p className={`mt-1 text-xs ${isOverdue(selected) ? "font-semibold text-destructive" : "text-muted-foreground"}`}>{selected.next_action_date ? `${isOverdue(selected) ? "Atrasada · " : ""}${dateLabel(selected.next_action_date)}` : "Sem data"}</p></div>}<div className="rounded-lg border p-3"><p className="text-xs text-muted-foreground">Valor potencial</p><p className="mt-1 text-sm font-semibold">{currency(selected.potential_value)}</p><p className="mt-1 truncate text-xs text-muted-foreground">{selected.owner || "Sem responsável"}</p></div></div>
          <div className="flex flex-wrap gap-2">{canCompleteAction(selected) && !selected.is_won && !selected.is_lost && <button disabled={!automationReady || completingActionId === selected.id} onClick={(event) => completeAction(selected, event)} className="inline-flex h-9 items-center gap-2 rounded-md border px-3 text-sm text-emerald-600 hover:bg-emerald-500/10 disabled:opacity-50"><Check className="h-4 w-4" /> Concluir ação</button>}<button onClick={() => openEdit(selected)} className="h-9 rounded-md border px-3 text-sm hover:bg-muted">Editar dados</button>{selected.is_won && !selected.converted_client_id && <button disabled={saving} onClick={convert} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"><ArrowRightLeft className="h-4 w-4" /> Completar cadastro do cliente</button>}{selected.converted_client_id && <span className="inline-flex h-9 items-center gap-2 rounded-md bg-emerald-500/10 px-3 text-sm text-emerald-700 dark:text-emerald-400"><Check className="h-4 w-4" /> Cliente: {selected.converted_client_name}</span>}<button onClick={remove} className="ml-auto inline-flex h-9 items-center gap-2 rounded-md border border-destructive/40 px-3 text-sm text-destructive hover:bg-destructive/5"><Trash2 className="h-4 w-4" /> Excluir</button></div>
          <section><SectionTitle>Informações</SectionTitle><div className="grid grid-cols-2 gap-x-4 gap-y-3 text-sm"><div><p className="text-xs text-muted-foreground">Telefone</p><p className="mt-0.5">{selected.phone || selected.contact_phone || "—"}</p></div><div><p className="text-xs text-muted-foreground">Cargo</p><p className="mt-0.5">{selected.contact_role || "—"}</p></div><div><p className="text-xs text-muted-foreground">Oferta</p><p className="mt-0.5">{selected.offer || "—"}</p></div><div><p className="text-xs text-muted-foreground">Origem</p><p className="mt-0.5">{selected.source || "—"}</p></div><div><p className="text-xs text-muted-foreground">Instagram</p><p className="mt-0.5 break-all">{selected.company_instagram || "—"}</p></div><div><p className="text-xs text-muted-foreground">Site</p><p className="mt-0.5 break-all">{selected.website || "—"}</p></div></div>{(selected.notes || selected.source?.toLowerCase().startsWith("prospecção ativa")) && <div className="mt-4 rounded-md bg-muted/50 p-3 text-sm"><p className="mb-1 text-xs text-muted-foreground">Observações</p><p className="whitespace-pre-wrap">{cleanLeadNotes(selected.notes) || "—"}</p><a href={prospectMapsUrl(selected)} target="_blank" rel="noreferrer" className={`mt-2 inline-flex ${leadLinkClass}`}>Google Maps</a></div>}</section>
          <details className="rounded-lg border p-3"><summary className="flex cursor-pointer list-none items-center gap-2 text-sm font-medium"><Info className="h-4 w-4 text-primary" />Histórico do funil</summary><div className="mt-4 space-y-3">{stageHistory.map((item) => <div key={item.id} className="relative border-l-2 border-primary/20 pb-1 pl-4"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" /><p className="text-sm font-medium">{item.stage_name}</p><div className="mt-0.5 flex min-h-6 flex-wrap items-center gap-1 text-xs text-muted-foreground">{editingHistoryId === item.id ? <input autoFocus aria-label={`Data da etapa ${item.stage_name}`} type="date" value={historyDateDraft} disabled={savingHistoryId === item.id} onChange={(event) => setHistoryDateDraft(event.target.value)} onBlur={() => saveStageDate(item, historyDateDraft)} onKeyDown={(event) => { if (event.key === "Enter") { event.preventDefault(); event.currentTarget.blur(); } if (event.key === "Escape") setEditingHistoryId(null); }} className="h-7 rounded border border-input bg-background px-2 text-xs text-foreground outline-none focus:ring-2 focus:ring-ring" /> : <button type="button" disabled={savingHistoryId === item.id} onClick={() => { setEditingHistoryId(item.id); setHistoryDateDraft(acquisitionBusinessDate(item.entered_at)); }} className="group inline-flex min-h-7 items-center gap-1 rounded px-1 text-left hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring" aria-label={`Editar data da etapa ${item.stage_name}`}><span>{item.is_estimated ? "Data aproximada · " : ""}{dateLabel(item.entered_at)}</span><Pencil className="h-3 w-3 opacity-0 transition-opacity group-hover:opacity-100 group-focus-visible:opacity-100" /></button>}{item.meeting_at ? <span>· Reunião: {item.meeting_at.replace("T", " ")}</span> : null}</div></div>)}{!stageHistory.length && <p className="text-sm text-muted-foreground">Nenhuma etapa registrada.</p>}</div></details><section><SectionTitle>Histórico de interações</SectionTitle><form onSubmit={addInteraction} className="space-y-2 rounded-lg border p-3"><div className="grid grid-cols-[1fr_1fr] gap-2"><Field label="Data"><input type="date" required value={interactionForm.interaction_date} onChange={(event) => setInteractionForm({ ...interactionForm, interaction_date: event.target.value })} className={inputClass} /></Field><Field label="Tipo"><input value={interactionForm.type} onChange={(event) => setInteractionForm({ ...interactionForm, type: event.target.value })} className={inputClass} /></Field></div><Field label="O que aconteceu"><textarea required rows={2} value={interactionForm.notes} onChange={(event) => setInteractionForm({ ...interactionForm, notes: event.target.value })} placeholder="Ex.: Apresentei a proposta e combinei retorno na sexta." className={textareaClass} /></Field><button disabled={saving} className="inline-flex h-9 items-center gap-2 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground disabled:opacity-60"><Plus className="h-4 w-4" /> Registrar interação</button></form>
            <div className="mt-4 space-y-3">{interactions.map((item) => <div key={item.id} className="relative border-l-2 border-primary/20 pb-1 pl-4"><span className="absolute -left-[5px] top-1 h-2 w-2 rounded-full bg-primary" /><div className="flex flex-wrap items-center gap-2"><span className="text-sm font-medium">{item.type}</span><span className="text-xs text-muted-foreground">{dateLabel(item.interaction_date)}</span>{item.message_sent_at && <span className="text-xs text-muted-foreground">Enviado às {messageDateTime(item.message_sent_at)}</span>}</div><p className="mt-1 whitespace-pre-wrap text-sm text-muted-foreground">{item.notes}</p>{item.script_name && <p className="mt-1 text-xs text-muted-foreground">Script: {item.script_name}</p>}{item.message_content && <p className="mt-1 whitespace-pre-wrap rounded-md bg-muted/50 p-2 text-sm">{item.message_content}</p>}</div>)}{!interactions.length && <p className="py-3 text-center text-sm text-muted-foreground">Nenhuma interação registrada.</p>}</div>
          </section>
        </div>
      </aside></div>}

      {actionPrompt && <div className="fixed inset-0 z-[80] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => { if (!confirmedMessage && !sendRequestId && !messageSending) setActionPrompt(null); }}>
        <form onSubmit={(event) => { event.preventDefault(); void sendActionMessage(); }} onMouseDown={(event) => event.stopPropagation()} className="flex max-h-[94vh] w-full max-w-2xl flex-col overflow-hidden rounded-xl border bg-card shadow-2xl">
          <div className="flex items-start justify-between border-b p-5"><div><div className="flex items-center gap-2"><MessageCircle className="h-5 w-5 text-emerald-600" /><h2 className="text-lg font-semibold">Enviar pelo WhatsApp</h2></div><p className="mt-1 text-sm text-muted-foreground">Concluir “{actionPrompt.prospect.next_action}” para {actionPrompt.prospect.company_name}.</p></div><button type="button" disabled={Boolean(confirmedMessage || sendRequestId) || messageSending} onClick={() => setActionPrompt(null)} aria-label="Fechar" className="rounded-md p-2 text-muted-foreground hover:bg-muted disabled:opacity-40"><X className="h-4 w-4" /></button></div>

          <div className="flex-1 space-y-4 overflow-y-auto p-5">
            <div className="grid gap-3 sm:grid-cols-2">
              <div className="rounded-lg border bg-muted/30 p-3"><p className="text-xs text-muted-foreground">Prospect / contato</p><p className="mt-1 font-medium">{actionPrompt.prospect.contact_name || actionPrompt.prospect.company_name}</p><p className="text-xs text-muted-foreground">{actionPrompt.prospect.company_name}{actionPrompt.prospect.stage_name ? ` · ${actionPrompt.prospect.stage_name}` : ""}</p></div>
              <Field label="Número do WhatsApp *"><input autoFocus={!messagePhone} inputMode="tel" value={messagePhone} disabled={Boolean(confirmedMessage || sendRequestId)} onChange={(event) => { setMessagePhone(event.target.value); setSendRequestId(""); }} placeholder="+55 11 99999-9999" className={`${inputClass} ${!actionRecipientJid ? "border-destructive focus:ring-destructive" : ""}`} aria-invalid={!actionRecipientJid} /></Field>
            </div>

            <div className="rounded-lg border p-3">
              {whatsAppStatus?.state === "connected" ? <div className="flex items-center gap-2 text-sm font-medium text-emerald-700 dark:text-emerald-300"><Wifi className="h-4 w-4" /> WhatsApp conectado{whatsAppStatus.phone ? ` · ${whatsAppStatus.phone}` : ""}</div> : whatsAppStatus?.state === "qr" && whatsAppStatus.qr ? <div className="flex flex-col items-center gap-2 text-center sm:flex-row sm:text-left"><img src={whatsAppStatus.qr} alt="QR Code para conectar ao WhatsApp" className="h-36 w-36 rounded-md bg-white p-1" /><div><p className="text-sm font-medium">Leia o QR Code com o WhatsApp</p><p className="mt-1 text-xs text-muted-foreground">O envio ficará disponível assim que a conexão for confirmada.</p></div></div> : whatsAppStatus?.state === "connecting" ? <div className="flex items-center gap-2 text-sm text-muted-foreground"><Loader2 className="h-4 w-4 animate-spin" /> Conectando ao WhatsApp…</div> : <div className="flex flex-col gap-2 sm:flex-row sm:items-center sm:justify-between"><div className="flex items-center gap-2 text-sm text-muted-foreground"><WifiOff className="h-4 w-4" /> WhatsApp desconectado</div><button type="button" onClick={() => void startWhatsAppForAction()} className="h-9 rounded-md border px-3 text-sm font-medium hover:bg-muted">Conectar WhatsApp</button></div>}
              {whatsAppStatusError && <p role="alert" className="mt-2 text-xs text-destructive">{whatsAppStatusError}</p>}
            </div>

            <Field label="Script recomendado para esta ação"><select value={messageScriptId} disabled={Boolean(confirmedMessage || sendRequestId)} onChange={(event) => {
              const id = event.target.value;
              const script = actionMessageScripts.find((item) => String(item.id) === id);
              setMessageScriptId(id);
              setMessageTemplate(script?.body || "");
              setMessageEdited(false);
              setSendRequestId("");
            }} className={inputClass}><option value="">Mensagem personalizada</option>{actionMessageScripts.map((script) => <option key={script.id} value={script.id}>{script.name}{script.is_default ? " · Padrão" : ""}</option>)}</select></Field>

            <Field label="Mensagem — revise antes de enviar"><textarea rows={6} maxLength={4096} value={messageDraft} disabled={Boolean(confirmedMessage || sendRequestId)} onChange={(event) => { setMessageEdited(true); setMessageDraft(event.target.value); setSendRequestId(""); }} placeholder="Escreva a mensagem para o prospect" className={`${textareaClass} ${unresolvedMessageVariables.length ? "border-destructive focus:ring-destructive" : ""}`} aria-invalid={unresolvedMessageVariables.length > 0} /><span className={`block text-right text-[11px] ${messageDraft.length > 4096 ? "text-destructive" : "text-muted-foreground"}`}>{messageDraft.length}/4096</span></Field>
            <div className="flex flex-wrap items-center gap-1.5 text-xs text-muted-foreground"><span className="mr-1">Variáveis:</span>{["{nome}", "{empresa}", "{saudacao}", "{etapa}"].map((variable) => <span key={variable} className="rounded-full border px-2 py-0.5">{variable}</span>)}</div>
            {unresolvedMessageVariables.length > 0 && <p className="text-xs text-destructive">Preencha ou remova as variáveis destacadas: {unresolvedMessageVariables.join(", ")}.</p>}
            {confirmedMessage && <p className="rounded-md border border-amber-500/30 bg-amber-500/10 p-3 text-sm text-amber-800 dark:text-amber-200">O WhatsApp confirmou o envio. Estamos tentando salvar a ação no histórico; uma nova tentativa não reenviará a mensagem.</p>}
            {messageError && <p role="alert" className="rounded-md border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive">{messageError}</p>}
          </div>

          <div className="flex flex-col-reverse gap-2 border-t p-4 sm:flex-row sm:justify-end">
            <button type="button" disabled={Boolean(confirmedMessage || sendRequestId) || messageSending} onClick={() => setActionPrompt(null)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted disabled:opacity-50">Cancelar</button>
            <button type="button" disabled={Boolean(confirmedMessage || sendRequestId) || messageSending} onClick={() => void completeActionManually()} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-emerald-600/30 px-4 text-sm font-medium text-emerald-700 hover:bg-emerald-500/10 disabled:cursor-not-allowed disabled:opacity-50"><Check className="h-4 w-4" />{actionPrompt.prospect.stage_key === "new" ? "Avançar para Contatado" : "Concluir sem WhatsApp"}</button>
            <button type="submit" disabled={messageSending || (!confirmedMessage && (whatsAppStatus?.state !== "connected" || !actionRecipientJid || !messageDraft.trim() || unresolvedMessageVariables.length > 0))} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:cursor-not-allowed disabled:opacity-50">
              {messageSending ? <Loader2 className="h-4 w-4 animate-spin" /> : <Send className="h-4 w-4" />}
              {confirmedMessage ? "Tentar salvar conclusão" : sendRequestId ? "Tentar envio novamente" : "Enviar mensagem e concluir ação"}
            </button>
          </div>
        </form>
      </div>}
    </div>
  );
}
