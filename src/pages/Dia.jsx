import React, { useState, useEffect } from "react";
import { 
  X, TrendingUp, MousePointerClick, Target, Activity, 
  Settings, BarChart, Receipt // Ícones novos para as ações
} from "lucide-react"; 

// Status focados no "dia a dia" do gestor
const STATUS = {
  green: { label: "Rodando normal", dot: "bg-emerald-500", text: "text-emerald-500" },
  red: { label: "Campanhas pausadas", dot: "bg-rose-500", text: "text-rose-500" },
  blue: { label: "Orçamento diário atingido", dot: "bg-blue-500", text: "text-blue-500" },
  block: { label: "Atenção: Saldo zerado", dot: "bg-amber-500", text: "text-amber-500" },
};

// Categorias de Ações
const ACTIONS = {
  otimizar: { label: "Otimizar / Subir", icon: Settings, color: "text-blue-500", border: "border-blue-500/20" },
  analisar: { label: "Analisar Resultado", icon: BarChart, color: "text-purple-500", border: "border-purple-500/20" },
  boleto: { label: "Enviar Boleto", icon: Receipt, color: "text-orange-500", border: "border-orange-500/20" },
};

// Dados de exemplo adicionando a tag de "action"
const MOCK_CLIENTS = [
  {
    account_id: "act_1001",
    name: "Clínica Odonto Sorriso",
    action: "otimizar", // Ação definida
    status: "green",
    leads: 14,
    cost_per_lead: 8.50,
    spend: 119.00,
    daily_budget: 150.00,
    balance: 450.00,
    currency: "BRL",
    logo_url: "",
    roas: "—", 
    ctr: "2.4%",
    cpc: 1.20,
    campaigns: [
      { name: "[Bofu] - Agendamento Implantes", status: "Ativa", spend: 80.00, leads: 10 },
      { name: "[Tofu] - Engajamento Dicas", status: "Ativa", spend: 39.00, leads: 4 }
    ]
  },
  {
    account_id: "act_1002",
    name: "Imobiliária Morar Bem",
    action: "boleto", // Ação definida
    status: "block",
    leads: 3,
    cost_per_lead: 45.00,
    spend: 135.00,
    daily_budget: 300.00,
    balance: 0.00,
    currency: "BRL",
    logo_url: "",
    roas: "—",
    ctr: "1.1%",
    cpc: 3.50,
    campaigns: [
      { name: "[Captação] - Lançamento Centro", status: "Pausada (Saldo)", spend: 135.00, leads: 3 }
    ]
  },
  {
    account_id: "act_1003",
    name: "E-commerce Moda FIT",
    action: "analisar", // Ação definida
    status: "blue",
    leads: 45,
    cost_per_lead: 12.30,
    spend: 553.50,
    daily_budget: 500.00,
    balance: 1250.00,
    currency: "BRL",
    logo_url: "",
    roas: "4.2x",
    ctr: "3.8%",
    cpc: 0.85,
    campaigns: [
      { name: "[Vendas] - Remarketing Carrinho", status: "Ativa", spend: 153.50, leads: 15 },
      { name: "[Vendas] - Coleção Inverno", status: "Limitada pelo Orçamento", spend: 400.00, leads: 30 }
    ]
  },
  {
    account_id: "act_1004",
    name: "Restaurante Sabor & Cia",
    action: "otimizar", // Ação definida
    status: "red",
    leads: 0,
    cost_per_lead: 0,
    spend: 0,
    daily_budget: 50.00,
    balance: 100.00,
    currency: "BRL",
    logo_url: "",
    roas: "—",
    ctr: "0.0%",
    cpc: 0,
    campaigns: [
      { name: "[Mensagens] - Delivery Final de Semana", status: "Pausada", spend: 0, leads: 0 }
    ]
  }
];

export default function Dia() {
  const [list, setList] = useState([]);
  const [loading, setLoading] = useState(true);
  const [selectedClient, setSelectedClient] = useState(null);
  
  // Estado da data - Puxa a data atual no formato YYYY-MM-DD
  const [selectedDate, setSelectedDate] = useState(new Date().toISOString().slice(0, 10));

  // Toda vez que a data mudar, simula o recarregamento dos dados
  useEffect(() => {
    setLoading(true);
    const timer = setTimeout(() => {
      // Aqui, futuramente, você passará selectedDate para a sua API
      // Ex: api.get(`/clientes/dia?date=${selectedDate}`)
      
      // Para simular que a data mudou, vamos apenas embaralhar ou carregar o mock
      setList(MOCK_CLIENTS);
      setLoading(false);
    }, 800);

    return () => clearTimeout(timer);
  }, [selectedDate]);

  const fmtCurrency = (v, cur) =>
    new Intl.NumberFormat("pt-BR", { style: "currency", currency: cur || "BRL", maximumFractionDigits: 2 }).format(v || 0);
  const fmtNumber = (v) => new Intl.NumberFormat("pt-BR").format(Math.round(v || 0));

  const handleOutsideClick = (e) => {
    if (e.target.id === "modal-overlay") setSelectedClient(null);
  };

  return (
    <div className="min-h-screen bg-background relative pb-20">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        
        {/* CABEÇALHO COM SELETOR DE DATA */}
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between border-b pb-6">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">Atenção Necessária</h1>
            <p className="mt-1 text-sm text-muted-foreground capitalize">
              Organize os clientes e ações que exigem a sua atenção.
            </p>
          </div>
          <div className="flex items-center gap-3">
             <label className="text-sm font-medium text-muted-foreground">Data:</label>
             <input
               type="date"
               value={selectedDate}
               onChange={(e) => setSelectedDate(e.target.value)}
               className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-primary transition-colors cursor-pointer"
             />
          </div>
        </div>

        {/* LOADING */}
        {loading && (
          <div className="mt-8 flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          </div>
        )}

        {/* LISTAGEM DE CLIENTES AGRUPADOS POR AÇÃO */}
        {!loading && (
          <div className="mt-8 space-y-12">
            {Object.entries(ACTIONS).map(([actionKey, actionData]) => {
              
              // Filtra os clientes que pertencem a essa ação específica
              const clientsForThisAction = list.filter(c => c.action === actionKey);

              return (
                <div key={actionKey} className="animate-in fade-in duration-500">
                  {/* Título da Seção da Ação */}
                  <div className="flex items-center gap-2 mb-4 border-b pb-2">
                    <actionData.icon className={`h-5 w-5 ${actionData.color}`} />
                    <h2 className="text-xl font-semibold">{actionData.label}</h2>
                    <span className="bg-muted px-2.5 py-0.5 rounded-full text-xs font-medium text-muted-foreground ml-2">
                      {clientsForThisAction.length}
                    </span>
                  </div>

                  {/* Estado vazio para a ação */}
                  {clientsForThisAction.length === 0 ? (
                    <div className="rounded-lg border border-dashed p-8 text-center text-sm text-muted-foreground bg-muted/20">
                      Nenhum cliente para {actionData.label.toLowerCase()} nesta data.
                    </div>
                  ) : (
                    
                    /* Grid de Cards */
                    <div className="grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
                      {clientsForThisAction.map((c) => (
                        <div 
                          key={c.account_id} 
                          onClick={() => setSelectedClient(c)}
                          className={`group cursor-pointer rounded-xl border bg-card p-5 shadow-sm transition-all hover:shadow-md hover:border-primary/50 ${c.status === 'block' ? 'border-amber-500/50' : ''}`}
                        >
                          <div className="flex items-center gap-3">
                            <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-muted group-hover:opacity-80 transition-opacity">
                              {c.logo_url ? (
                                <img src={c.logo_url} alt="" className="h-full w-full object-cover" />
                              ) : (
                                <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground uppercase">
                                  {(c.name || "?").charAt(0)}
                                </div>
                              )}
                            </div>
                            <div className="min-w-0">
                              <div className="truncate font-semibold text-base group-hover:text-primary transition-colors">{c.name || c.account_id}</div>
                              <div className="flex items-center gap-1.5 text-xs text-muted-foreground mt-0.5">
                                <span className={`h-2 w-2 rounded-full ${STATUS[c.status]?.dot || "bg-muted"}`} />
                                <span className={c.status === 'block' ? 'text-amber-600 font-medium' : ''}>
                                  {STATUS[c.status]?.label || "—"}
                                </span>
                              </div>
                            </div>
                          </div>
                          
                          <div className="mt-5 grid grid-cols-2 gap-y-4 gap-x-3 text-sm border-t pt-4">
                            <div>
                              <div className="text-xs text-muted-foreground">Leads hoje</div>
                              <div className="text-lg font-semibold text-primary">{fmtNumber(c.leads)}</div>
                            </div>
                            <div>
                              <div className="text-xs text-muted-foreground">CPA Atual</div>
                              <div className="text-lg font-semibold">
                                {c.cost_per_lead > 0 ? fmtCurrency(c.cost_per_lead, c.currency) : "—"}
                              </div>
                            </div>
                            
                            <div className="col-span-2 mt-1">
                              <div className="flex justify-between text-xs mb-1.5">
                                <span className="text-muted-foreground">Gasto Hoje: <strong className="text-foreground">{fmtCurrency(c.spend, c.currency)}</strong></span>
                                <span className="text-muted-foreground">Orçamento: {fmtCurrency(c.daily_budget, c.currency)}</span>
                              </div>
                              <div className="h-2 w-full bg-muted rounded-full overflow-hidden">
                                <div 
                                  className={`h-full rounded-full ${c.spend >= c.daily_budget ? 'bg-blue-500' : 'bg-emerald-500'}`} 
                                  style={{ width: `${Math.min((c.spend / c.daily_budget) * 100, 100)}%` }}
                                ></div>
                              </div>
                            </div>
                          </div>
                        </div>
                      ))}
                    </div>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </div>

      {/* MODAL DE DETALHES (Permanece Igual) */}
      {selectedClient && (
        <div 
          id="modal-overlay"
          onClick={handleOutsideClick}
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/60 p-4 backdrop-blur-sm animate-in fade-in duration-200"
        >
          <div className="relative w-full max-w-2xl max-h-[90vh] overflow-y-auto rounded-xl border bg-background p-6 shadow-2xl animate-in zoom-in-95 duration-200">
            <button 
              onClick={() => setSelectedClient(null)}
              className="absolute right-4 top-4 rounded-md p-2 text-muted-foreground hover:bg-muted hover:text-foreground transition-colors"
            >
              <X className="h-5 w-5" />
            </button>

            <div className="flex items-center gap-4 border-b pb-6 mb-6">
              <div className="flex h-16 w-16 items-center justify-center rounded-xl border bg-muted text-2xl font-bold uppercase text-muted-foreground">
                {selectedClient.name.charAt(0)}
              </div>
              <div>
                <h2 className="text-xl font-bold">{selectedClient.name}</h2>
                <div className="mt-1 flex items-center gap-2 text-sm font-medium">
                  <span className={`h-2.5 w-2.5 rounded-full ${STATUS[selectedClient.status]?.dot}`} />
                  <span className={STATUS[selectedClient.status]?.text}>{STATUS[selectedClient.status]?.label}</span>
                </div>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Desempenho Hoje</h3>
            <div className="grid grid-cols-2 gap-4 sm:grid-cols-4 mb-8">
              <div className="rounded-lg border bg-card p-3">
                <Target className="h-5 w-5 text-primary mb-2 opacity-70" />
                <div className="text-xs text-muted-foreground">Leads</div>
                <div className="text-lg font-bold">{selectedClient.leads}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <Activity className="h-5 w-5 text-primary mb-2 opacity-70" />
                <div className="text-xs text-muted-foreground">ROAS</div>
                <div className="text-lg font-bold">{selectedClient.roas}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <MousePointerClick className="h-5 w-5 text-primary mb-2 opacity-70" />
                <div className="text-xs text-muted-foreground">CTR Geral</div>
                <div className="text-lg font-bold">{selectedClient.ctr}</div>
              </div>
              <div className="rounded-lg border bg-card p-3">
                <TrendingUp className="h-5 w-5 text-primary mb-2 opacity-70" />
                <div className="text-xs text-muted-foreground">CPC Médio</div>
                <div className="text-lg font-bold">{fmtCurrency(selectedClient.cpc, selectedClient.currency)}</div>
              </div>
            </div>

            <h3 className="text-sm font-semibold text-muted-foreground uppercase tracking-wider mb-3">Campanhas Principais</h3>
            <div className="rounded-lg border overflow-hidden">
              <table className="w-full text-sm text-left">
                <thead className="bg-muted/50 text-muted-foreground">
                  <tr>
                    <th className="px-4 py-3 font-medium">Nome da Campanha</th>
                    <th className="px-4 py-3 font-medium">Status</th>
                    <th className="px-4 py-3 font-medium text-right">Gasto Hoje</th>
                    <th className="px-4 py-3 font-medium text-right">Leads</th>
                  </tr>
                </thead>
                <tbody className="divide-y">
                  {selectedClient.campaigns.map((camp, idx) => (
                    <tr key={idx} className="hover:bg-muted/30 transition-colors">
                      <td className="px-4 py-3 font-medium">{camp.name}</td>
                      <td className="px-4 py-3 text-muted-foreground">{camp.status}</td>
                      <td className="px-4 py-3 text-right">{fmtCurrency(camp.spend, selectedClient.currency)}</td>
                      <td className="px-4 py-3 text-right font-medium">{camp.leads}</td>
                    </tr>
                  ))}
                  {selectedClient.campaigns.length === 0 && (
                    <tr>
                      <td colSpan="4" className="px-4 py-8 text-center text-muted-foreground">
                        Nenhuma campanha rodando hoje.
                      </td>
                    </tr>
                  )}
                </tbody>
              </table>
            </div>

            <div className="mt-8 flex justify-end">
              <button 
                onClick={() => setSelectedClient(null)}
                className="rounded-md bg-primary px-4 py-2 text-sm font-medium text-primary-foreground hover:bg-primary/90 transition-colors"
              >
                Fechar Detalhes
              </button>
            </div>
          </div>
        </div>
      )}
    </div>
  );
}