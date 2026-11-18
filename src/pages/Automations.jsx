import { useCallback, useEffect, useMemo, useState } from "react";
import { AlertCircle, Check, Clock3, Copy, Loader2, MessageSquareText, Pencil, Plus, Save, Trash2, Workflow, Zap } from "lucide-react";
import { useToast } from "@/components/ui/use-toast";
import { deleteAutomationScript, getAutomationRules, getAutomationScripts, saveAutomationRule, saveAutomationScript } from "@/api/automations";
import { getProspectStages } from "@/api/prospects";

const ACTIONS = [
  "Entrar em contato",
  "Follow-up",
  "Confirmar reunião",
  "Realizar reunião",
  "Enviar proposta",
  "Follow-up da proposta",
  "Aguardar retorno",
  "Outro",
];

const VARIABLES = ["{nome}", "{empresa}", "{saudacao}", "{etapa}"];
const EMPTY_SCRIPT = { name: "", stage_key: "", action: "", body: "", is_default: false };
const inputClass = "h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring";
const textareaClass = "w-full rounded-md border border-input bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring";

function stageLabel(script, stages) {
  return script.stage_key ? stages.find((stage) => stage.stage_key === script.stage_key)?.name || script.stage_key : "Todas as etapas";
}

export default function Automations() {
  const { toast } = useToast();
  const [section, setSection] = useState("scripts");
  const [scripts, setScripts] = useState([]);
  const [rules, setRules] = useState([]);
  const [stages, setStages] = useState([]);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [scriptFormOpen, setScriptFormOpen] = useState(false);
  const [scriptDraft, setScriptDraft] = useState(EMPTY_SCRIPT);
  const [savingScript, setSavingScript] = useState(false);
  const [savingRule, setSavingRule] = useState("");

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const [nextScripts, nextRules, nextStages] = await Promise.all([
        getAutomationScripts(),
        getAutomationRules(),
        getProspectStages(),
      ]);
      setScripts(nextScripts);
      setRules(nextRules);
      setStages(nextStages);
    } catch (loadError) {
      setError(loadError.message || "Não foi possível carregar as automações.");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => { void load(); }, [load]);

  const orderedScripts = useMemo(() => [...scripts].sort((left, right) =>
    Number(right.is_default) - Number(left.is_default)
    || stageLabel(left, stages).localeCompare(stageLabel(right, stages), "pt-BR")
    || left.name.localeCompare(right.name, "pt-BR")), [scripts, stages]);

  const openNewScript = () => {
    setScriptDraft({ ...EMPTY_SCRIPT });
    setScriptFormOpen(true);
  };

  const openEditScript = (script) => {
    setScriptDraft({
      id: script.id,
      name: script.name,
      stage_key: script.stage_key || "",
      action: script.action || "",
      body: script.body,
      is_default: Boolean(script.is_default),
    });
    setScriptFormOpen(true);
  };

  const duplicateScript = (script) => {
    setScriptDraft({
      name: `${script.name} (cópia)`,
      stage_key: script.stage_key || "",
      action: script.action || "",
      body: script.body,
      is_default: false,
    });
    setScriptFormOpen(true);
  };

  const saveScript = async (event) => {
    event.preventDefault();
    setSavingScript(true);
    try {
      const saved = await saveAutomationScript(scriptDraft);
      setScripts((current) => {
        const next = current.filter((script) => script.id !== saved.id);
        return [...next.map((script) => script.stage_key === saved.stage_key && script.action === saved.action && saved.is_default
          ? { ...script, is_default: false }
          : script), saved];
      });
      setScriptFormOpen(false);
      toast({ title: scriptDraft.id ? "Script atualizado" : "Script criado" });
    } catch (saveError) {
      toast({ title: "Não foi possível salvar o script", description: saveError.message, variant: "destructive" });
    } finally {
      setSavingScript(false);
    }
  };

  const removeScript = async (script) => {
    if (!window.confirm(`Excluir o script “${script.name}”?`)) return;
    try {
      await deleteAutomationScript(script.id);
      setScripts((current) => current.filter((item) => item.id !== script.id));
      setRules((current) => current.map((rule) => rule.recommended_script_id === script.id
        ? { ...rule, recommended_script_id: null, recommended_script_name: null }
        : rule));
      toast({ title: "Script excluído" });
    } catch (removeError) {
      toast({ title: "Não foi possível excluir o script", description: removeError.message, variant: "destructive" });
    }
  };

  const updateRule = (key, patch) => {
    setRules((current) => current.map((rule) => `${rule.stage_key}:${rule.action}` === key ? { ...rule, ...patch } : rule));
  };

  const persistRule = async (rule) => {
    const key = `${rule.stage_key}:${rule.action}`;
    setSavingRule(key);
    try {
      const saved = await saveAutomationRule({
        stage_key: rule.stage_key,
        action: rule.action,
        open_message_modal: Boolean(rule.open_message_modal),
        recommended_script_id: rule.recommended_script_id || null,
        next_follow_up_days: Number(rule.next_follow_up_days),
        next_action: rule.next_action || "",
      });
      updateRule(key, { ...saved, stage_name: rule.stage_name, recommended_script_name: scripts.find((script) => script.id === saved.recommended_script_id)?.name || null });
      toast({ title: "Regra atualizada" });
    } catch (saveError) {
      toast({ title: "Não foi possível salvar a regra", description: saveError.message, variant: "destructive" });
    } finally {
      setSavingRule("");
    }
  };

  return (
    <main className="min-h-full bg-background p-4 sm:p-6 lg:p-8">
      <div className="mx-auto max-w-6xl space-y-6">
        <header className="flex flex-col gap-4 sm:flex-row sm:items-end sm:justify-between">
          <div>
            <p className="text-sm font-medium text-primary">Central de Comunicação</p>
            <h1 className="mt-1 text-2xl font-bold tracking-tight sm:text-3xl">Automações</h1>
            <p className="mt-1 max-w-2xl text-sm text-muted-foreground">Configure os scripts e o comportamento do envio de mensagens dentro do fluxo de Aquisição.</p>
          </div>
          {section === "scripts" && <button type="button" onClick={openNewScript} className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground hover:opacity-90"><Plus className="h-4 w-4" /> Novo script</button>}
        </header>

        <div className="flex flex-wrap gap-2 border-b pb-3">
          <button type="button" onClick={() => setSection("scripts")} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${section === "scripts" ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}><MessageSquareText className="h-4 w-4" /> Scripts de mensagens</button>
          <button type="button" onClick={() => setSection("rules")} className={`inline-flex h-9 items-center gap-2 rounded-md px-3 text-sm font-medium ${section === "rules" ? "bg-primary text-primary-foreground" : "border hover:bg-muted"}`}><Workflow className="h-4 w-4" /> Regras de automação</button>
        </div>

        {error && <div role="alert" className="flex items-center gap-2 rounded-lg border border-destructive/30 bg-destructive/5 p-3 text-sm text-destructive"><AlertCircle className="h-4 w-4 shrink-0" />{error}<button type="button" className="ml-auto underline" onClick={() => void load()}>Tentar novamente</button></div>}

        {loading ? <div className="flex min-h-48 items-center justify-center text-sm text-muted-foreground"><Loader2 className="mr-2 h-4 w-4 animate-spin" />Carregando configurações...</div> : section === "scripts" ? (
          <section className="space-y-3">
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-muted-foreground"><Zap className="mr-2 inline h-4 w-4 text-sky-600" />Os scripts são sugestões editáveis. Nenhuma mensagem é enviada sem sua revisão e confirmação na Aquisição.</div>
            {orderedScripts.length ? <div className="grid gap-3 md:grid-cols-2">
              {orderedScripts.map((script) => <article key={script.id} className="rounded-xl border bg-card p-4 shadow-sm">
                <div className="flex items-start justify-between gap-3">
                  <div className="min-w-0">
                    <div className="flex flex-wrap items-center gap-2"><h2 className="font-semibold">{script.name}</h2>{script.is_default && <span className="rounded-full bg-primary/10 px-2 py-0.5 text-[11px] font-medium text-primary">Padrão</span>}</div>
                    <p className="mt-1 text-xs text-muted-foreground">{stageLabel(script, stages)} · {script.action || "Todas as ações"}</p>
                  </div>
                  <div className="flex shrink-0 gap-1">
                    <button type="button" title="Editar" aria-label={`Editar ${script.name}`} onClick={() => openEditScript(script)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Pencil className="h-4 w-4" /></button>
                    <button type="button" title="Duplicar" aria-label={`Duplicar ${script.name}`} onClick={() => duplicateScript(script)} className="rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground"><Copy className="h-4 w-4" /></button>
                    <button type="button" title="Excluir" aria-label={`Excluir ${script.name}`} onClick={() => void removeScript(script)} className="rounded-md p-2 text-muted-foreground hover:bg-destructive/10 hover:text-destructive"><Trash2 className="h-4 w-4" /></button>
                  </div>
                </div>
                <p className="mt-3 line-clamp-4 whitespace-pre-wrap rounded-md bg-muted/50 p-3 text-sm text-muted-foreground">{script.body}</p>
              </article>)}
            </div> : <div className="rounded-xl border border-dashed p-10 text-center"><MessageSquareText className="mx-auto h-8 w-8 text-muted-foreground/50" /><h2 className="mt-3 font-medium">Nenhum script cadastrado</h2><p className="mt-1 text-sm text-muted-foreground">Crie um script para sugeri-lo ao concluir uma ação de contato.</p><button type="button" onClick={openNewScript} className="mt-4 h-9 rounded-md bg-primary px-3 text-sm font-medium text-primary-foreground">Criar script</button></div>}
          </section>
        ) : (
          <section className="space-y-4">
            <div className="rounded-lg border border-sky-500/20 bg-sky-500/5 p-3 text-sm text-muted-foreground"><Check className="mr-2 inline h-4 w-4 text-sky-600" />O modal apenas prepara a mensagem. Você revisa o contato e o texto, e confirma o envio manualmente.</div>
            <div className="space-y-3">
              {rules.map((rule) => {
                const key = `${rule.stage_key}:${rule.action}`;
                const options = scripts.filter((script) => (!script.action || script.action === rule.action) && (!script.stage_key || script.stage_key === rule.stage_key));
                return <article key={key} className="rounded-xl border bg-card p-4 shadow-sm">
                  <div className="flex flex-col gap-4 lg:flex-row lg:items-start lg:justify-between">
                    <div className="min-w-0 lg:w-56">
                      <p className="text-xs text-muted-foreground">{rule.stage_name}</p>
                      <h2 className="mt-1 font-semibold">{rule.action}</h2>
                    </div>
                    <div className="grid flex-1 gap-4 sm:grid-cols-2 lg:grid-cols-4">
                      <label className="flex items-center gap-3 text-sm">
                        <input type="checkbox" checked={rule.open_message_modal} onChange={(event) => updateRule(key, { open_message_modal: event.target.checked })} className="h-4 w-4 accent-primary" />
                        Abrir modal ao concluir
                      </label>
                      <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Script recomendado</span><select value={rule.recommended_script_id || ""} disabled={!rule.open_message_modal} onChange={(event) => updateRule(key, { recommended_script_id: event.target.value ? Number(event.target.value) : null })} className={inputClass}><option value="">Sem recomendação</option>{options.map((script) => <option key={script.id} value={script.id}>{script.name}</option>)}</select></label>
                      <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Próxima ação</span><select value={rule.next_action || ""} onChange={(event) => updateRule(key, { next_action: event.target.value })} className={inputClass}><option value="">Manter ação atual</option>{ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
                      <label className="block space-y-1.5"><span className="inline-flex items-center gap-1 text-xs font-medium text-muted-foreground"><Clock3 className="h-3.5 w-3.5" /> Próximo acompanhamento (dias)</span><input type="number" min="0" max="365" value={rule.next_follow_up_days} disabled={!rule.open_message_modal} onChange={(event) => updateRule(key, { next_follow_up_days: event.target.value })} className={inputClass} /></label>
                    </div>
                    <button type="button" disabled={savingRule === key} onClick={() => void persistRule(rule)} className="inline-flex h-10 items-center justify-center gap-2 rounded-md border px-3 text-sm font-medium hover:bg-muted disabled:opacity-50"><Save className="h-4 w-4" />{savingRule === key ? "Salvando..." : "Salvar regra"}</button>
                  </div>
                </article>;
              })}
            </div>
            <div className="rounded-lg border p-4 text-sm text-muted-foreground"><p className="font-medium text-foreground">Ações internas</p><p className="mt-1">“Realizar reunião” e “Aguardar retorno” não abrem o WhatsApp. A data do próximo acompanhamento só muda depois que uma ação de contato é concluída com envio confirmado.</p></div>
          </section>
        )}
      </div>

      {scriptFormOpen && <div className="fixed inset-0 z-[70] flex items-center justify-center bg-black/60 p-4" onMouseDown={() => !savingScript && setScriptFormOpen(false)}><form onSubmit={saveScript} onMouseDown={(event) => event.stopPropagation()} className="max-h-[92vh] w-full max-w-2xl space-y-4 overflow-y-auto rounded-xl border bg-card p-5 shadow-2xl">
        <div><h2 className="text-lg font-semibold">{scriptDraft.id ? "Editar script" : "Novo script"}</h2><p className="mt-1 text-sm text-muted-foreground">Use variáveis para adaptar a mensagem a cada prospect.</p></div>
        <div className="grid gap-4 sm:grid-cols-2">
          <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Nome</span><input required maxLength={120} autoFocus value={scriptDraft.name} onChange={(event) => setScriptDraft({ ...scriptDraft, name: event.target.value })} className={inputClass} /></label>
          <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Etapa</span><select value={scriptDraft.stage_key} onChange={(event) => setScriptDraft({ ...scriptDraft, stage_key: event.target.value })} className={inputClass}><option value="">Todas as etapas</option>{stages.map((stage) => <option key={stage.id} value={stage.stage_key}>{stage.name}</option>)}</select></label>
          <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Ação</span><select value={scriptDraft.action} onChange={(event) => setScriptDraft({ ...scriptDraft, action: event.target.value })} className={inputClass}><option value="">Todas as ações</option>{ACTIONS.map((action) => <option key={action} value={action}>{action}</option>)}</select></label>
          <label className="flex items-center gap-2 self-end pb-2 text-sm"><input type="checkbox" checked={scriptDraft.is_default} onChange={(event) => setScriptDraft({ ...scriptDraft, is_default: event.target.checked })} className="h-4 w-4 accent-primary" />Definir como padrão desta etapa e ação</label>
        </div>
        <label className="block space-y-1.5"><span className="text-xs font-medium text-muted-foreground">Mensagem</span><textarea required maxLength={4096} rows={7} value={scriptDraft.body} onChange={(event) => setScriptDraft({ ...scriptDraft, body: event.target.value })} placeholder="Ex.: {saudacao}, {nome}! Tudo bem?" className={textareaClass} /><span className="block text-right text-[11px] text-muted-foreground">{scriptDraft.body.length}/4096</span></label>
        <div className="flex flex-wrap gap-1.5">{VARIABLES.map((variable) => <button type="button" key={variable} onClick={() => setScriptDraft((current) => ({ ...current, body: `${current.body}${current.body ? " " : ""}${variable}` }))} className="rounded-full border px-2.5 py-1 text-xs text-muted-foreground hover:bg-muted">{variable}</button>)}</div>
        <div className="flex justify-end gap-2 border-t pt-4"><button type="button" disabled={savingScript} onClick={() => setScriptFormOpen(false)} className="h-10 rounded-md border px-4 text-sm hover:bg-muted">Cancelar</button><button disabled={savingScript} className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-60">{savingScript && <Loader2 className="h-4 w-4 animate-spin" />}{scriptDraft.id ? "Salvar alterações" : "Criar script"}</button></div>
      </form></div>}
    </main>
  );
}
