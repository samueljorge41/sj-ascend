import React, { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard, CalendarDays, Target, Repeat2, Heart,
  Users, Settings as SettingsIcon, RefreshCw, PanelLeftClose, PanelLeftOpen,
  ClipboardList, UserRoundPlus, CircleDollarSign, ChartNoAxesCombined, MessageCircle, Zap,
} from "lucide-react";
import ThemeToggle from "@/components/leads/ThemeToggle";
import { useAppData } from "@/components/AppDataProvider";

const NAV_GROUPS = [
  {
    label: "DIA A DIA",
    items: [
      { to: "/", label: "Visão Geral", icon: LayoutDashboard, end: true },
      { to: "/agenda", label: "Agenda", icon: CalendarDays },
      { label: "Metas e Projetos", icon: Target, planned: true },
      { label: "Hábitos e Rotinas", icon: Repeat2, planned: true },
      { label: "Áreas da Vida", icon: Heart, planned: true },
    ],
  },
  {
    label: "Negócio",
    items: [
      { to: "/aquisicao", label: "Aquisição", icon: UserRoundPlus, colorClass: "text-emerald-600 dark:text-emerald-400" },
      { to: "/clientes", label: "Overview dos Clientes", icon: Users },
      { to: "/negocio/dashboard", label: "Dashboard de Clientes", icon: LayoutDashboard },
      { to: "/gestao-clientes", label: "Gestão de Clientes", icon: ClipboardList },
      { to: "/relatorios-relacionamento", label: "Relacionamento", icon: ChartNoAxesCombined },
      { to: "/financas", label: "Finanças", icon: CircleDollarSign },
    ],
  },
  {
    label: "Central de Comunicação",
    items: [
      { to: "/whatsapp", label: "WhatsApp", icon: MessageCircle, colorClass: "text-emerald-700 dark:text-emerald-400" },
      { to: "/automacoes", label: "Automações", icon: Zap },
    ],
  },
];

const SETTINGS_ITEM = { to: "/configuracoes", label: "Configurações", icon: SettingsIcon };
const BRAND_LOGOS = {
  complete: "/assets/brand/logo-completa.png",
  symbol: "/assets/brand/logo-simbolo.png",
};

function NavigationItem({ item, collapsed = false, mobile = false }) {
  const Icon = item.icon;
  const itemColor = item.colorClass;
  const className = ({ isActive }) =>
    `flex items-center gap-3 rounded-md ${mobile ? "px-3 py-1.5" : "px-3 py-2"} text-sm font-medium ${
      isActive
        ? `bg-sidebar-accent ${itemColor || "text-sidebar-accent-foreground"}`
        : `${itemColor || "text-sidebar-foreground/80"} hover:bg-sidebar-accent/60`
    }`;
  if (item.planned) {
    return (
      <span aria-disabled="true" title={`${item.label} — planejado para uma próxima etapa`} className={`flex cursor-not-allowed items-center gap-3 rounded-md ${mobile ? "px-3 py-1.5" : "px-3 py-2"} text-sm font-medium text-sidebar-foreground/45`}>
        <Icon className={`${mobile ? "h-4 w-4" : "h-5 w-5"} shrink-0`} />
        {!collapsed && <>{item.label}<span className="ml-auto text-[10px] uppercase tracking-wide">Em breve</span></>}
      </span>
    );
  }
  return (
    <NavLink to={item.to} end={item.end} title={item.label} className={className}>
      <Icon className={`${mobile ? "h-4 w-4" : "h-5 w-5"} shrink-0`} />
      {!collapsed && item.label}
    </NavLink>
  );
}

export default function AppLayout() {
  const { refresh, loading } = useAppData();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex h-16 items-center justify-center border-b px-2">
          <img
            src={collapsed ? BRAND_LOGOS.symbol : BRAND_LOGOS.complete}
            alt="SJ Mídias"
            className={collapsed ? "h-10 w-10 shrink-0 object-contain" : "h-12 w-full max-w-[230px] object-contain"}
          />
        </div>
        <nav aria-label="Navegação principal" className="flex-1 space-y-4 overflow-y-auto p-2">
          {NAV_GROUPS.map((group, index) => (
            <section key={group.label} className={index > 0 ? "border-t border-border/60 pt-2" : ""}>
              {!collapsed && <h2 className="px-3 pb-1 pt-2 text-[10px] font-semibold uppercase tracking-wider text-muted-foreground">{group.label}</h2>}
              <div className="space-y-1">
                {group.items.map((item) => <NavigationItem key={item.to || item.label} item={item} collapsed={collapsed} />)}
              </div>
            </section>
          ))}
        </nav>
        <div className="border-t p-2">
          <NavigationItem item={SETTINGS_ITEM} collapsed={collapsed} />
          <div className={`mt-2 flex items-center gap-2 border-t pt-2 ${collapsed ? "flex-col" : ""}`}>
            <button onClick={refresh} aria-label="Atualizar dados" className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent">
              <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
            </button>
            <ThemeToggle />
            <button onClick={() => setCollapsed((current) => !current)} aria-label={collapsed ? "Expandir menu" : "Recolher menu"} className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent">
              {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
            </button>
          </div>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <nav aria-label="Navegação móvel" className="flex items-center gap-1 overflow-x-auto border-b bg-sidebar px-3 py-2 md:hidden">
          {[...NAV_GROUPS.flatMap((group) => group.items).filter((item) => !item.section), SETTINGS_ITEM].map((item) => <NavigationItem key={item.to || item.label} item={item} mobile />)}
          <button onClick={refresh} aria-label="Atualizar dados" className="ml-auto inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent">
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <ThemeToggle />
        </nav>
        <main className="min-w-0 flex-1"><Outlet /></main>
      </div>
    </div>
  );
}
