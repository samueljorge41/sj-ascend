import { useCallback, useEffect, useRef, useState } from "react";
import { GripVertical, Plus, Trash2 } from "lucide-react";
import { Sheet, SheetContent, SheetDescription, SheetHeader, SheetTitle } from "@/components/ui/sheet";
import { getAgendaPlanningDraft, saveAgendaPlanningDraft } from "@/api/agenda";

const LEGACY_STORAGE_KEY = "sj-ascend:agenda-planning-draft";
export const AGENDA_DRAFT_DRAG_TYPE = "application/x-sj-ascend-planning-item";

function createId() {
  return `${Date.now()}-${Math.random().toString(36).slice(2, 9)}`;
}

function readLegacyItems() {
  try {
    const raw = window.localStorage.getItem(LEGACY_STORAGE_KEY);
    if (!raw) return { items: [], error: "" };
    const parsed = JSON.parse(raw);
    if (!Array.isArray(parsed)) throw new Error("O conteúdo salvo não está no formato esperado.");
    return {
      items: parsed.filter((item) => item && typeof item.id === "string" && typeof item.text === "string"),
      error: "",
    };
  } catch (error) {
    console.error("Não foi possível migrar o rascunho antigo da Agenda:", error);
    return { items: [], error: "Não foi possível ler o rascunho antigo do navegador." };
  }
}

export function readAgendaDraftDrag(dataTransfer) {
  try {
    const raw = dataTransfer.getData(AGENDA_DRAFT_DRAG_TYPE);
    if (!raw) return null;
    const item = JSON.parse(raw);
    return typeof item.id === "string" && typeof item.text === "string" && item.text.trim()
      ? { id: item.id, text: item.text.trim() }
      : null;
  } catch {
    return null;
  }
}

export default function AgendaPlanningList({
  open,
  onOpenChange,
  scheduledDraftId,
  busyDraftId,
  onScheduled,
  onDraftDragStart,
  onDraftDragEnd,
}) {
  const [items, setItems] = useState([]);
  const [storageError, setStorageError] = useState("");
  const [saveState, setSaveState] = useState("saved");
  const [loaded, setLoaded] = useState(false);
  const [dropTarget, setDropTarget] = useState(null);
  const inputRefs = useRef(new Map());
  const itemsRef = useRef([]);
  const dirtyVersionRef = useRef(0);
  const saveQueueRef = useRef(Promise.resolve());

  useEffect(() => {
    let cancelled = false;
    getAgendaPlanningDraft()
      .then(async (savedItems) => {
        let nextItems = savedItems;
        if (savedItems.length === 0) {
          const legacy = readLegacyItems();
          if (legacy.error) setStorageError(legacy.error);
          if (legacy.items.length) {
            await saveAgendaPlanningDraft(legacy.items);
            nextItems = legacy.items;
            window.localStorage.removeItem(LEGACY_STORAGE_KEY);
          }
        }
        if (cancelled) return;
        itemsRef.current = nextItems;
        setItems(nextItems);
      })
      .catch((error) => {
        if (cancelled) return;
        console.error("Não foi possível carregar o rascunho salvo no arquivo local:", error);
        const legacy = readLegacyItems();
        itemsRef.current = legacy.items;
        setItems(legacy.items);
        setStorageError("Não foi possível carregar o arquivo local do rascunho. As anotações antigas deste navegador foram preservadas.");
      })
      .finally(() => {
        if (!cancelled) setLoaded(true);
      });
    return () => { cancelled = true; };
  }, []);

  const updateItems = useCallback((nextItems) => {
    itemsRef.current = nextItems;
    setItems(nextItems);
    dirtyVersionRef.current += 1;
    setSaveState("saving");
  }, []);

  useEffect(() => {
    if (!loaded || saveState !== "saving") return undefined;
    const version = dirtyVersionRef.current;
    const itemsToSave = items;
    const timer = window.setTimeout(() => {
      saveQueueRef.current = saveQueueRef.current
      .then(() => saveAgendaPlanningDraft(itemsToSave))
        .then(() => {
          if (dirtyVersionRef.current !== version) return;
          setStorageError("");
          setSaveState("saved");
        })
        .catch((error) => {
          console.error("Não foi possível salvar o rascunho no arquivo local:", error);
          if (dirtyVersionRef.current !== version) return;
          setStorageError("Não foi possível salvar no arquivo local. Suas alterações continuam abertas; tente editar novamente.");
          setSaveState("error");
        });
    }, 350);
    return () => window.clearTimeout(timer);
  }, [items, loaded, saveState]);

  const addItem = useCallback((focus = false) => {
    const item = { id: createId(), text: "" };
    updateItems([...itemsRef.current, item]);
    if (focus) requestAnimationFrame(() => inputRefs.current.get(item.id)?.focus());
  }, [updateItems]);

  const updateItemText = useCallback((id, text) => {
    updateItems(itemsRef.current.map((item) => item.id === id ? { ...item, text } : item));
  }, [updateItems]);

  const removeItem = useCallback((id) => {
    if (!itemsRef.current.some((item) => item.id === id)) return;
    inputRefs.current.delete(id);
    updateItems(itemsRef.current.filter((item) => item.id !== id));
  }, [updateItems]);

  const handleKeyDown = useCallback((event, item) => {
    if (event.key === "Enter") {
      event.preventDefault();
      addItem(true);
    } else if (event.key === "Backspace" && !item.text) {
      event.preventDefault();
      removeItem(item.id);
    }
  }, [addItem, removeItem]);

  const handleDragStart = useCallback((event, item) => {
    const text = item.text.trim();
    if (!text) {
      event.preventDefault();
      return;
    }
    event.dataTransfer.effectAllowed = "move";
    event.dataTransfer.setData(AGENDA_DRAFT_DRAG_TYPE, JSON.stringify({ id: item.id, text }));
    event.dataTransfer.setData("text/plain", text);
    onDraftDragStart?.({ id: item.id, text });
  }, [onDraftDragStart]);

  const handleDragOverItem = useCallback((event, id) => {
    if (!Array.from(event.dataTransfer.types).includes(AGENDA_DRAFT_DRAG_TYPE)) return;
    event.preventDefault();
    event.dataTransfer.dropEffect = "move";
    const bounds = event.currentTarget.getBoundingClientRect();
    setDropTarget({
      id,
      position: event.clientY < bounds.top + bounds.height / 2 ? "before" : "after",
    });
  }, []);

  const handleDropOnItem = useCallback((event, targetId) => {
    if (!Array.from(event.dataTransfer.types).includes(AGENDA_DRAFT_DRAG_TYPE)) return;
    event.preventDefault();
    event.stopPropagation();
    setDropTarget(null);
    const dragged = readAgendaDraftDrag(event.dataTransfer);
    if (!dragged || dragged.id === targetId) return;
    const currentItems = itemsRef.current;
    const sourceIndex = currentItems.findIndex((item) => item.id === dragged.id);
    const targetIndex = currentItems.findIndex((item) => item.id === targetId);
    if (sourceIndex < 0 || targetIndex < 0) return;
    const insertAfter = event.clientY >= event.currentTarget.getBoundingClientRect().top
      + event.currentTarget.getBoundingClientRect().height / 2;
    const reordered = [...currentItems];
    const [movedItem] = reordered.splice(sourceIndex, 1);
    const remainingTargetIndex = reordered.findIndex((item) => item.id === targetId);
    reordered.splice(remainingTargetIndex + (insertAfter ? 1 : 0), 0, movedItem);
    updateItems(reordered);
  }, [updateItems]);

  const handleDragEnd = useCallback(() => {
    setDropTarget(null);
    onDraftDragEnd?.();
  }, [onDraftDragEnd]);

  const handleScheduled = useCallback((id) => {
    if (!itemsRef.current.some((item) => item.id === id)) return;
    removeItem(id);
    onScheduled?.();
  }, [onScheduled, removeItem]);

  useEffect(() => {
    if (scheduledDraftId) handleScheduled(scheduledDraftId);
  }, [scheduledDraftId, handleScheduled]);

  return <Sheet modal={false} open={open} onOpenChange={onOpenChange}>
    <SheetContent side="right" showOverlay={false} onInteractOutside={(event) => event.preventDefault()} onEscapeKeyDown={(event) => event.preventDefault()} className="flex w-[min(400px,42vw)] max-w-none flex-col gap-0 p-0 shadow-2xl">
      <SheetHeader className="border-b px-5 py-5 pr-14">
        <SheetTitle>Lista</SheetTitle>
        <SheetDescription>Rascunhe primeiro. Arraste uma linha para um horário para agendá-la.</SheetDescription>
      </SheetHeader>
      <div className="flex min-h-0 flex-1 flex-col overflow-y-auto px-4 py-4">
        {storageError && <p role="alert" className="mb-3 rounded-md border border-destructive/30 bg-destructive/5 px-3 py-2 text-xs text-destructive">{storageError}</p>}
        {items.length === 0
          ? <button type="button" onClick={() => addItem(true)} className="flex min-h-28 items-center justify-center rounded-lg border border-dashed px-4 text-sm text-muted-foreground transition hover:border-primary/40 hover:bg-muted/30 hover:text-foreground">
            Comece anotando uma ideia ou pendência
          </button>
          : <ul className="space-y-1">
            {items.map((item, index) => <li key={item.id} onDragOver={(event) => handleDragOverItem(event, item.id)} onDragLeave={(event) => {
              if (!event.currentTarget.contains(event.relatedTarget)) setDropTarget(null);
            }} onDrop={(event) => handleDropOnItem(event, item.id)} className="group relative flex items-center gap-1 rounded-md border border-transparent pr-1 hover:border-border hover:bg-muted/30">
              {dropTarget?.id === item.id && <span aria-hidden="true" className={`pointer-events-none absolute inset-x-1 z-10 h-0.5 rounded-full bg-primary shadow-[0_0_4px_hsl(var(--primary)/0.6)] ${dropTarget.position === "before" ? "top-0" : "bottom-0"}`} />}
              <button
                type="button"
                draggable={Boolean(item.text.trim()) && item.id !== busyDraftId}
                onDragStart={(event) => handleDragStart(event, item)}
                onDragEnd={handleDragEnd}
                aria-label={`Arrastar linha ${index + 1} para a agenda`}
                title="Arraste para um horário da agenda"
                className="cursor-grab touch-none rounded p-1.5 text-muted-foreground/60 hover:text-foreground active:cursor-grabbing"
              ><GripVertical className="h-4 w-4" /></button>
              <input
                ref={(element) => {
                  if (element) inputRefs.current.set(item.id, element);
                  else inputRefs.current.delete(item.id);
                }}
                value={item.text}
                onChange={(event) => updateItemText(item.id, event.target.value)}
                onKeyDown={(event) => handleKeyDown(event, item)}
                placeholder="Escreva uma ideia ou pendência"
                maxLength={200}
                aria-label={`Linha de planejamento ${index + 1}`}
                className="h-10 min-w-0 flex-1 bg-transparent text-sm outline-none placeholder:text-muted-foreground/60"
              />
              <button type="button" onClick={() => removeItem(item.id)} aria-label="Remover linha" className="rounded p-1.5 text-muted-foreground opacity-0 transition hover:bg-destructive/10 hover:text-destructive focus:opacity-100 group-hover:opacity-100">
                <Trash2 className="h-3.5 w-3.5" />
              </button>
            </li>)}
          </ul>}
        {items.length > 0 && <button type="button" onClick={() => addItem(true)} className="mt-2 inline-flex h-9 items-center gap-2 self-start rounded-md px-2 text-xs text-muted-foreground hover:bg-muted hover:text-foreground">
          <Plus className="h-3.5 w-3.5" /> Adicionar linha
        </button>}
        <p className={`mt-auto pt-6 text-center text-[11px] ${storageError ? "text-destructive" : "text-muted-foreground"}`}>
          {!loaded ? "Carregando rascunho local…" : saveState === "saving" ? "Salvando no arquivo local…" : saveState === "saved" && !storageError ? "Salvo automaticamente no arquivo local" : ""}
        </p>
      </div>
      <div className="border-t px-4 py-3 text-center text-[11px] text-muted-foreground">Rascunhar · Organizar · Priorizar · Agendar</div>
    </SheetContent>
  </Sheet>;
}
