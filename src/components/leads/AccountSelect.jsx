import React, { useState, useRef, useEffect } from "react";
import { ChevronDown, Search, Check } from "lucide-react";

const STATUS_DOT = {
  green: "bg-emerald-500",
  red: "bg-rose-500",
  blue: "bg-blue-500",
  block: "bg-amber-500"
};

function StatusDot({ status }) {
  if (!status || !STATUS_DOT[status]) return null;
  return <span className={`inline-block h-2.5 w-2.5 shrink-0 rounded-full ${STATUS_DOT[status]}`} />;
}

export default function AccountSelect({ accounts, value, loading, onChange, statuses }) {
  const [open, setOpen] = useState(false);
  const [search, setSearch] = useState("");
  const ref = useRef(null);

  useEffect(() => {
    const handler = (e) => {
      if (ref.current && !ref.current.contains(e.target)) setOpen(false);
    };
    document.addEventListener("mousedown", handler);
    return () => document.removeEventListener("mousedown", handler);
  }, []);

  const selected = accounts.find((a) => a.id === value);
  const filtered = accounts.filter(
    (a) => a.name.toLowerCase().includes(search.toLowerCase()) || a.id.includes(search)
  );

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        onClick={() => setOpen((o) => !o)}
        disabled={loading}
        className="flex h-10 w-64 items-center justify-between gap-2 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:opacity-60">
        
        <span className="flex min-w-0 items-center gap-2">
          {selected && <StatusDot status={statuses?.[selected.id]?.status} />}
          <span className="truncate text-left">
            {loading ? "Carregando contas..." : selected ? selected.name : "Selecione uma conta"}
          </span>
        </span>
        <ChevronDown className="h-4 w-4 shrink-0 opacity-60 hidden" />
      </button>

      {open &&
      <div className="absolute z-20 mt-1 w-72 rounded-md border bg-popover shadow-lg">
          <div className="flex items-center gap-2 border-b px-3 py-2">
            <Search className="h-4 w-4 shrink-0 opacity-60" />
            <input
            autoFocus
            value={search}
            onChange={(e) => setSearch(e.target.value)}
            placeholder="Buscar conta..."
            className="h-8 w-full bg-transparent text-sm outline-none placeholder:text-muted-foreground" />
          
          </div>
          <div className="max-h-64 overflow-y-auto py-1">
            {filtered.length === 0 &&
          <div className="px-3 py-2 text-sm text-muted-foreground">Nenhuma conta encontrada</div>
          }
            {filtered.map((a) =>
          <button
            key={a.id}
            type="button"
            onClick={() => {
              onChange(a);
              setOpen(false);
              setSearch("");
            }}
            className="flex w-full items-center justify-between gap-2 px-3 py-2 text-left text-sm hover:bg-accent">
            
                <span className="flex min-w-0 items-center gap-2">
                  <StatusDot status={statuses?.[a.id]?.status} />
                  <span className="truncate">
                    {a.name} <span className="text-xs text-muted-foreground">({a.id})</span>
                  </span>
                </span>
                {a.id === value && <Check className="h-4 w-4 shrink-0 text-primary" />}
              </button>
          )}
          </div>
        </div>
      }
    </div>);

}