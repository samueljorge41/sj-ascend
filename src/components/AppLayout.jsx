import React, { useState } from "react";
import { NavLink, Outlet } from "react-router-dom";
import {
  LayoutDashboard,
  Users,
  Settings as SettingsIcon,
  RefreshCw,
  PanelLeftClose,
  PanelLeftOpen,
  ClipboardList
} from "lucide-react";
import ThemeToggle from "@/components/leads/ThemeToggle";
import { useAppData } from "@/components/AppDataProvider";

const NAV = [
  {
    to: "/",
    label: "Dashboard",
    icon: LayoutDashboard,
    end: true,
  },
  {
    to: "/clientes",
    label: "Overview de Clientes",
    icon: Users,
    end: false,
  },
  {
    to: "/gestao-clientes",
    label: "Gestão de Clientes",
    icon: ClipboardList,
    end: false,
  },
  {
    to: "/configuracoes",
    label: "Configurações",
    icon: SettingsIcon,
    end: false,
  },
];


export default function AppLayout() {
  const { refresh, loading } = useAppData();
  const [collapsed, setCollapsed] = useState(false);
  return (
    <div className="flex min-h-screen bg-background">
      <aside className={`sticky top-0 hidden h-screen shrink-0 flex-col border-r bg-sidebar transition-[width] duration-200 md:flex ${collapsed ? "w-16" : "w-64"}`}>
        <div className="flex h-16 items-center gap-2 border-b px-4">
          <img src="https://media.base44.com/images/public/6a580f33bee4ac0fc04b53ce/9ce1f61f8_bc083c01-7881-472c-9ede-e8683a66e612.png" alt="SJ Ascend" className="h-8 w-8 shrink-0 rounded-md object-cover" />
          {!collapsed && <span className="text-[#0363cd] font-bold [font-family:'Albert_Sans',_sans-serif] text-xl">SJ Ascend</span>}
        </div>
        <nav className="flex-1 space-y-1 overflow-y-auto p-2">
          {NAV.map((item) =>
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            title={item.label}
            className={({ isActive }) =>
            `flex items-center gap-3 rounded-md px-3 py-2 text-sm font-medium ${
            isActive ?
            "bg-sidebar-accent text-sidebar-accent-foreground" :
            "text-sidebar-foreground/80 hover:bg-sidebar-accent/60"}`

            }>
            
              <item.icon className="h-5 w-5 shrink-0" />
              {!collapsed && item.label}
            </NavLink>
          )}
        </nav>
        <div className={`flex items-center gap-2 border-t p-2 ${collapsed ? "flex-col" : ""}`}>
          <button
            onClick={refresh}
            aria-label="Atualizar dados"
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent">
            
            <RefreshCw className={`h-5 w-5 ${loading ? "animate-spin" : ""}`} />
          </button>
          <ThemeToggle />
          <button
            onClick={() => setCollapsed((c) => !c)}
            aria-label={collapsed ? "Expandir menu" : "Recolher menu"}
            className="inline-flex h-10 w-10 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent">
            {collapsed ? <PanelLeftOpen className="h-5 w-5" /> : <PanelLeftClose className="h-5 w-5" />}
          </button>
        </div>
      </aside>

      <div className="flex min-w-0 flex-1 flex-col">
        <div className="flex items-center gap-2 overflow-x-auto border-b bg-sidebar px-4 py-2 md:hidden">
          {NAV.map((item) =>
          <NavLink
            key={item.to}
            to={item.to}
            end={item.end}
            className={({ isActive }) =>
            `flex items-center gap-2 rounded-md px-3 py-1.5 text-sm ${
            isActive ? "bg-sidebar-accent text-sidebar-accent-foreground" : "text-sidebar-foreground/80"}`

            }>
            
              <item.icon className="h-4 w-4" />
              {item.label}
            </NavLink>
          )}
          <button
            onClick={refresh}
            aria-label="Atualizar dados"
            className="ml-auto inline-flex h-9 w-9 items-center justify-center rounded-md border border-input bg-background text-foreground hover:bg-accent">
            
            <RefreshCw className={`h-4 w-4 ${loading ? "animate-spin" : ""}`} />
          </button>
          <ThemeToggle />
        </div>
        <main className="min-w-0 flex-1">
          <Outlet />
        </main>
      </div>
    </div>);

}