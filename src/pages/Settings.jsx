import React, {
  useEffect,
  useMemo,
  useRef,
  useState,
} from "react";

import {
  createClient,
  updateClientById,
  uploadClientLogo,
} from "@/api/systemClient";

import { Switch } from "@/components/ui/switch";
import { useToast } from "@/components/ui/use-toast";
import { useAppData } from "@/components/AppDataProvider";
import { GROUPINGS } from "@/lib/leadsGrouping";

import {
  Building2,
  ChartNoAxesCombined,
  Loader2,
  Pencil,
  Plus,
  RefreshCw,
  Search,
  Settings2,
  Trash2,
  Users,
  X,
} from "lucide-react";

const ORIGINS = [
  "Avaloon",
  "SJ Marketing",
];

const EMPTY_FORM = {
  name: "",
  origin: "SJ Marketing",
  account_id: "",
  active: true,
  payment_method: "auto",
  monthly_fee: "",
  first_payment_date: "",
  entry_date: "",
  exit_date: "",
};

const PAYMENT_METHOD_LABELS = {
  auto: "Automática (Meta)",
  prepaid: "Saldo pré-pago",
  credit_card: "Cartão de crédito",
  other: "Outra forma de pagamento",
  unknown: "Não identificado",
};

function getTodayDate() {
  const today = new Date();
  const month = String(today.getMonth() + 1).padStart(2, "0");
  const day = String(today.getDate()).padStart(2, "0");
  return `${today.getFullYear()}-${month}-${day}`;
}

function formatMonthlyFee(value) {
  if (value === null || value === undefined || value === "") {
    return "";
  }

  return new Intl.NumberFormat("pt-BR", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  }).format(Number(value));
}

function parseMonthlyFee(value) {
  const normalized = String(value || "")
    .trim()
    .replace(/^R\$\s*/i, "")
    .replace(/\s/g, "");

  if (!normalized) {
    return null;
  }

  let decimalValue = normalized;
  if (normalized.includes(",")) {
    if (!/^\d{1,3}(?:\.\d{3})*(?:,\d{1,2})?$|^\d+(?:,\d{1,2})?$/.test(normalized)) {
      return undefined;
    }
    decimalValue = normalized.replace(/\./g, "").replace(",", ".");
  } else if (/^\d{1,3}(?:\.\d{3})+$/.test(normalized)) {
    decimalValue = normalized.replace(/\./g, "");
  } else if (!/^\d+(?:\.\d{1,2})?$/.test(normalized)) {
    return undefined;
  }

  const amount = Number(decimalValue);
  return Number.isFinite(amount) && amount >= 0
    ? Math.round(amount * 100) / 100
    : undefined;
}

function parseFirstPaymentDate(value) {
  if (!value) return null;
  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (!match) return undefined;
  const date = new Date(`${value}T00:00:00.000Z`);
  return !Number.isNaN(date.getTime()) && date.toISOString().slice(0, 10) === value
    ? value
    : undefined;
}

function formatDate(value) {
  if (!value) {
    return "Não definida";
  }

  const match = String(value).match(/^(\d{4})-(\d{2})-(\d{2})/);
  return match ? `${match[3]}/${match[2]}/${match[1]}` : "Não definida";
}

function getClientForm(client) {
  return {
    name: client.name || "",
    origin: client.origin || "",
    account_id: client.account_id || "",
    active: Boolean(client.active),
    payment_method: client.payment_method || "auto",
    monthly_fee: formatMonthlyFee(client.monthly_fee),
    first_payment_date: client.first_payment_date || "",
    entry_date: client.entry_date || client.created_at?.slice(0, 10) || "",
    exit_date: client.exit_date || "",
  };
}

function ReadOnlyField({ label, children }) {
  return (
    <div className="min-w-0 rounded-lg border bg-background px-3 py-2.5">
      <dt className="text-xs font-medium text-muted-foreground">{label}</dt>
      <dd className="mt-1 break-words text-sm font-medium">{children || "Não definido"}</dd>
    </div>
  );
}

export default function Settings() {
  const {
    accounts,
    clients,
    groupings,
    loading,
    updateClient,
    removeClient,
    updateGroupings,
    syncAccounts,
  } = useAppData();

  const { toast } = useToast();

  const [activeSection, setActiveSection] =
    useState("clients");

  const [syncing, setSyncing] =
    useState(false);

  const [modalOpen, setModalOpen] =
    useState(false);

  const [viewMode, setViewMode] =
    useState(false);

  const [saving, setSaving] =
    useState(false);

  const [deleting, setDeleting] =
    useState(false);

  const [
    editingClient,
    setEditingClient,
  ] = useState(null);

  const [
    deleteConfirmOpen,
    setDeleteConfirmOpen,
  ] = useState(false);

  const [form, setForm] =
    useState(EMPTY_FORM);

  const [logoFile, setLogoFile] =
    useState(null);

  const [logoPreview, setLogoPreview] =
    useState("");

  const logoInputRef = useRef(null);

  const [searchTerm, setSearchTerm] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("active");

  const [originFilter, setOriginFilter] =
    useState("SJ Marketing");

  useEffect(() => {
    return () => {
      if (
        logoPreview.startsWith(
          "blob:"
        )
      ) {
        URL.revokeObjectURL(
          logoPreview
        );
      }
    };
  }, [logoPreview]);

  const clientList = useMemo(() => {
    return Object.values(clients).sort(
      (a, b) =>
        String(a.name || "").localeCompare(
          String(b.name || ""),
          "pt-BR"
        )
    );
  }, [clients]);

  const filteredClients = useMemo(() => {
    const normalizedSearch =
      searchTerm
        .trim()
        .toLocaleLowerCase("pt-BR");

    return clientList.filter(
      (client) => {
        const matchesSearch =
          !normalizedSearch ||
          String(client.name || "")
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedSearch) ||
          String(client.account_id || "")
            .toLocaleLowerCase("pt-BR")
            .includes(normalizedSearch);

        const matchesStatus =
          statusFilter === "all" ||
          (statusFilter === "active" &&
            Boolean(client.active)) ||
          (statusFilter === "inactive" &&
            !Boolean(client.active));

        const matchesOrigin =
          originFilter === "all" ||
          client.origin === originFilter;

        return (
          matchesSearch &&
          matchesStatus &&
          matchesOrigin
        );
      }
    );
  }, [
    clientList,
    searchTerm,
    statusFilter,
    originFilter,
  ]);

  const activeClientsCount = useMemo(
    () =>
      clientList.filter(
        (client) =>
          Boolean(client.active)
      ).length,
    [clientList]
  );

  const inactiveClientsCount =
    clientList.length -
    activeClientsCount;

  const linkedAccountIds = useMemo(() => {
    return new Set(
      clientList
        .map(
          (client) =>
            client.account_id
        )
        .filter(Boolean)
    );
  }, [clientList]);

  const modalAccounts = useMemo(() => {
    return accounts.filter(
      (account) =>
        account.id ===
          editingClient?.account_id ||
        !linkedAccountIds.has(
          account.id
        )
    );
  }, [
    accounts,
    editingClient,
    linkedAccountIds,
  ]);

  const selectedAccount =
    accounts.find(
      (account) =>
        account.id ===
        form.account_id
    );

  const isEditing =
    Boolean(editingClient);

  const displayedLogo =
    logoPreview ||
    editingClient?.logo_url ||
    "";

  const logoInitial =
    String(
      form.name ||
        editingClient?.name ||
        "?"
    )
      .charAt(0)
      .toUpperCase();

  const hasActiveFilters =
    Boolean(searchTerm.trim()) ||
    statusFilter !== "active" ||
    originFilter !== "SJ Marketing";

  const resetFilters = () => {
    setSearchTerm("");
    setStatusFilter("active");
    setOriginFilter("SJ Marketing");
  };

  const resetModal = () => {
    setEditingClient(null);
    setViewMode(false);
    setForm(EMPTY_FORM);
    setLogoFile(null);
    setLogoPreview("");
    setDeleteConfirmOpen(false);
  };

  const openCreateModal = () => {
    resetModal();
    setForm({
      ...EMPTY_FORM,
      entry_date: getTodayDate(),
    });
    setModalOpen(true);
  };

  const openClientModal = (client) => {
    setEditingClient(client);
    setForm(getClientForm(client));
    setViewMode(true);
    setModalOpen(true);
  };

  const cancelEdit = () => {
    if (isEditing) {
      setForm(getClientForm(editingClient));
      setLogoFile(null);
      setLogoPreview("");
      setViewMode(true);
      return;
    }

    closeModal();
  };

  const closeModal = () => {
    if (
      saving ||
      deleting
    ) {
      return;
    }

    setModalOpen(false);
    resetModal();
  };

  const handleLogoChange =
    (event) => {
      const file =
        event.target.files?.[0];

      if (!file) {
        return;
      }

      const allowedTypes = [
        "image/png",
        "image/jpeg",
        "image/webp",
      ];

      if (
        !allowedTypes.includes(
          file.type
        )
      ) {
        event.target.value = "";

        toast({
          variant: "warning",
          title: "Formato inválido",
          description:
            "Envie uma imagem PNG, JPG, JPEG ou WebP.",
        });

        return;
      }

      if (
        file.size >
        2 * 1024 * 1024
      ) {
        event.target.value = "";

        toast({
          variant: "warning",
          title: "Imagem muito grande",
          description:
            "A imagem deve ter no máximo 2 MB.",
        });

        return;
      }

      setLogoFile(file);
      setLogoPreview(
        URL.createObjectURL(file)
      );
    };

  const validateForm = () => {
    if (!form.name.trim()) {
      toast({
        variant: "warning",
        title: "Nome obrigatório",
        description:
          "Informe o nome do cliente.",
      });

      return false;
    }

    if (!form.origin) {
      toast({
        variant: "warning",
        title: "Origem obrigatória",
        description:
          "Selecione Avaloon ou SJ Marketing.",
      });

      return false;
    }

    if (parseMonthlyFee(form.monthly_fee) === undefined) {
      toast({
        variant: "warning",
        title: "Mensalidade inválida",
        description: "Informe um valor em reais válido e não negativo.",
      });
      return false;
    }

    if (parseFirstPaymentDate(form.first_payment_date) === undefined) {
      toast({
        variant: "warning",
        title: "Data de pagamento inválida",
        description: "Informe uma data válida para o primeiro pagamento.",
      });
      return false;
    }

    return true;
  };

  const handleSaveClient =
    async (event) => {
      event.preventDefault();

      if (!validateForm()) {
        return;
      }

      setSaving(true);

      try {
        const payload = {
          name:
            form.name.trim(),

          origin:
            form.origin,

          account_id:
            form.account_id ||
            null,

          currency:
            selectedAccount
              ?.currency ||
            editingClient
              ?.currency ||
            "BRL",

          active:
            form.active,

          payment_method:
            form.payment_method,

          monthly_fee:
            parseMonthlyFee(form.monthly_fee),

          first_payment_date:
            parseFirstPaymentDate(form.first_payment_date),

          entry_date:
            form.entry_date || undefined,

          exit_date:
            form.exit_date || null,
        };

        let savedClient;

        if (isEditing) {
          savedClient =
            await updateClientById(
              editingClient.id,
              payload
            );
        } else {
          savedClient =
            await createClient({
              ...payload,
              logo_url: "",
            });
        }

        let logoError = null;

        try {
          if (logoFile) {
            savedClient =
              await uploadClientLogo(
                savedClient.id,
                logoFile
              );
          }
        } catch (error) {
          logoError = error;
        }

        updateClient(
          savedClient.account_id,
          savedClient
        );

        if (logoError) {
          toast({
            variant: "warning",
            title: isEditing
              ? "Cliente atualizado sem alterar a logo"
              : "Cliente criado sem a logo",
            description:
              logoError.message ||
              "Não foi possível salvar a logo.",
          });
        } else {
          toast({
            variant: "success",

            title: isEditing
              ? "Cliente atualizado"
              : "Cliente criado",

            description: isEditing
              ? `"${savedClient.name}" foi atualizado com sucesso.`
              : `"${savedClient.name}" foi cadastrado com sucesso.`,
          });
        }

        if (isEditing) {
          setEditingClient(savedClient);
          setForm(getClientForm(savedClient));
          setLogoFile(null);
          setLogoPreview("");
          setViewMode(true);
        } else {
          setModalOpen(false);
          resetModal();
        }
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível concluir",
          description:
            error.message ||
            "Ocorreu um erro ao salvar o cliente.",
        });
      } finally {
        setSaving(false);
      }
    };

  const handleDeleteClient =
    async () => {
      if (!editingClient) {
        return;
      }

      const deletedClientName =
        editingClient.name;

      setDeleting(true);

      try {
        await removeClient(
          editingClient.id
        );

        setDeleteConfirmOpen(false);
        setModalOpen(false);
        resetModal();

        toast({
          variant: "success",
          title:
            "Cliente excluído",
          description:
            `"${deletedClientName}" e seus dados relacionados foram removidos.`,
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível excluir",
          description:
            error.message ||
            "Ocorreu um erro ao excluir o cliente.",
        });
      } finally {
        setDeleting(false);
      }
    };

  const handleSyncAccounts =
    async () => {
      setSyncing(true);

      try {
        await syncAccounts();

        toast({
          variant: "success",
          title:
            "Contas sincronizadas",
          description:
            "As contas Meta foram atualizadas com sucesso.",
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível concluir",
          description:
            error.message ||
            "Ocorreu um erro ao sincronizar as contas.",
        });
      } finally {
        setSyncing(false);
      }
    };

  const toggleGrouping =
    async (key) => {
      try {
        if (
          groupings.includes(key)
        ) {
          if (
            groupings.length <= 1
          ) {
            toast({
              variant: "warning",
              title:
                "Agrupamento obrigatório",
              description:
                "Mantenha pelo menos um agrupamento ativo.",
            });

            return;
          }

          await updateGroupings(
            groupings.filter(
              (grouping) =>
                grouping !== key
            )
          );
        } else {
          await updateGroupings([
            ...groupings,
            key,
          ]);
        }

        toast({
          variant: "success",
          title:
            "Configuração atualizada",
          description:
            "Os agrupamentos disponíveis foram atualizados.",
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível salvar",
          description:
            error.message ||
            "Ocorreu um erro ao alterar os agrupamentos.",
        });
      }
    };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-6xl px-4 py-8 sm:px-6 lg:px-8">
        <div>
          <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
            Configurações
          </h1>

          <p className="mt-1 text-sm text-muted-foreground">
            Gerencie clientes, contas vinculadas e preferências do sistema.
          </p>
        </div>

        <div className="mt-8 grid gap-6 lg:grid-cols-[220px_minmax(0,1fr)]">
          {/* Submenu das configurações */}
          <aside className="h-fit rounded-xl border bg-card p-2 shadow-sm">
            <div className="px-3 pb-2 pt-2 text-xs font-semibold uppercase tracking-wide text-muted-foreground">
              Configurações
            </div>

            <nav className="space-y-1">
              <button
                type="button"
                onClick={() =>
                  setActiveSection(
                    "clients"
                  )
                }
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeSection ===
                  "clients"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <Users className="h-4 w-4" />

                <span className="flex-1">
                  Clientes
                </span>

                <span
                  className={`rounded-full px-2 py-0.5 text-[11px] ${
                    activeSection ===
                    "clients"
                      ? "bg-primary-foreground/15 text-primary-foreground"
                      : "bg-muted text-muted-foreground"
                  }`}
                >
                  {clientList.length}
                </span>
              </button>

              <button
                type="button"
                onClick={() =>
                  setActiveSection(
                    "groupings"
                  )
                }
                className={`flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm font-medium transition-colors ${
                  activeSection ===
                  "groupings"
                    ? "bg-primary text-primary-foreground"
                    : "text-muted-foreground hover:bg-muted hover:text-foreground"
                }`}
              >
                <ChartNoAxesCombined className="h-4 w-4" />

                <span>
                  Agrupamentos
                </span>
              </button>
            </nav>
          </aside>

          {/* Conteúdo da seção */}
          <main className="min-w-0">
            {loading ? (
              <div className="flex justify-center rounded-xl border bg-card py-24 shadow-sm">
                <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
              </div>
            ) : (
              <>
                {activeSection ===
                  "clients" && (
                  <section>
                    <div className="flex flex-col gap-4 sm:flex-row sm:items-start sm:justify-between">
                      <div>
                        <h2 className="text-xl font-semibold">
                          Clientes cadastrados
                        </h2>

                        <p className="mt-1 text-sm text-muted-foreground">
                          Cadastre clientes, defina a origem e vincule contas Meta.
                        </p>
                      </div>

                      <div className="flex flex-wrap gap-2">
                        <button
                          type="button"
                          onClick={
                            handleSyncAccounts
                          }
                          disabled={
                            syncing
                          }
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md border bg-background px-4 text-sm font-medium shadow-sm transition-colors hover:bg-muted disabled:pointer-events-none disabled:opacity-50"
                        >
                          {syncing ? (
                            <Loader2 className="h-4 w-4 animate-spin" />
                          ) : (
                            <RefreshCw className="h-4 w-4" />
                          )}

                          {syncing
                            ? "Sincronizando..."
                            : "Sincronizar contas"}
                        </button>

                        <button
                          type="button"
                          onClick={
                            openCreateModal
                          }
                          className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90"
                        >
                          <Plus className="h-4 w-4" />

                          Criar cliente
                        </button>
                      </div>
                    </div>

                    {/* Resumo */}
                    <div className="mt-6 grid gap-3 sm:grid-cols-3">
                      <div className="rounded-xl border bg-card p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Total
                        </div>

                        <div className="mt-1 text-2xl font-semibold">
                          {clientList.length}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-card p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Ativos
                        </div>

                        <div className="mt-1 text-2xl font-semibold text-emerald-600 dark:text-emerald-400">
                          {activeClientsCount}
                        </div>
                      </div>

                      <div className="rounded-xl border bg-card p-4 shadow-sm">
                        <div className="text-xs font-medium uppercase tracking-wide text-muted-foreground">
                          Inativos
                        </div>

                        <div className="mt-1 text-2xl font-semibold text-muted-foreground">
                          {inactiveClientsCount}
                        </div>
                      </div>
                    </div>

                    {/* Filtros */}
                    <div className="mt-5 rounded-xl border bg-card p-4 shadow-sm">
                      <div className="flex items-center gap-2">
                        <Settings2 className="h-4 w-4 text-muted-foreground" />

                        <h3 className="text-sm font-semibold">
                          Filtros
                        </h3>
                      </div>

                      <div className="mt-4 grid gap-3 md:grid-cols-[minmax(0,1fr)_180px_180px_auto]">
                        <div className="relative">
                          <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

                          <input
                            type="text"
                            value={
                              searchTerm
                            }
                            onChange={(
                              event
                            ) =>
                              setSearchTerm(
                                event
                                  .target
                                  .value
                              )
                            }
                            placeholder="Buscar cliente ou conta..."
                            className="h-10 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                          />
                        </div>

                        <select
                          value={
                            statusFilter
                          }
                          onChange={(
                            event
                          ) =>
                            setStatusFilter(
                              event
                                .target
                                .value
                            )
                          }
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="all">
                            Todos os status
                          </option>

                          <option value="active">
                            Ativos
                          </option>

                          <option value="inactive">
                            Inativos
                          </option>
                        </select>

                        <select
                          value={
                            originFilter
                          }
                          onChange={(
                            event
                          ) =>
                            setOriginFilter(
                              event
                                .target
                                .value
                            )
                          }
                          className="h-10 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                        >
                          <option value="all">
                            Todas as origens
                          </option>

                          {ORIGINS.map(
                            (origin) => (
                              <option
                                key={
                                  origin
                                }
                                value={
                                  origin
                                }
                              >
                                {origin}
                              </option>
                            )
                          )}
                        </select>

                        {hasActiveFilters && (
                          <button
                            type="button"
                            onClick={
                              resetFilters
                            }
                            className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
                          >
                            Limpar
                          </button>
                        )}
                      </div>

                      <p className="mt-3 text-xs text-muted-foreground">
                        Mostrando{" "}
                        {
                          filteredClients.length
                        }{" "}
                        de{" "}
                        {
                          clientList.length
                        }{" "}
                        clientes.
                      </p>
                    </div>

                    {/* Lista */}
                    {clientList.length ===
                    0 ? (
                      <div className="mt-5 rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
                        <div className="mx-auto flex h-12 w-12 items-center justify-center rounded-full bg-muted">
                          <Building2 className="h-5 w-5 text-muted-foreground" />
                        </div>

                        <h3 className="mt-4 font-semibold">
                          Nenhum cliente cadastrado
                        </h3>

                        <p className="mt-1 text-sm text-muted-foreground">
                          Crie o primeiro cliente. A conta Meta pode ser vinculada posteriormente.
                        </p>
                      </div>
                    ) : filteredClients.length ===
                      0 ? (
                      <div className="mt-5 rounded-xl border bg-card px-6 py-12 text-center shadow-sm">
                        <Search className="mx-auto h-6 w-6 text-muted-foreground" />

                        <h3 className="mt-4 font-semibold">
                          Nenhum cliente encontrado
                        </h3>

                        <p className="mt-1 text-sm text-muted-foreground">
                          Ajuste os filtros para visualizar outros clientes.
                        </p>

                        <button
                          type="button"
                          onClick={
                            resetFilters
                          }
                          className="mt-4 inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
                        >
                          Limpar filtros
                        </button>
                      </div>
                    ) : (
                      <div className="mt-5 grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
                        {filteredClients.map((client) => (
                          <button
                            key={client.id}
                            type="button"
                            onClick={() => openClientModal(client)}
                            aria-label={`Ver detalhes de ${client.name}`}
                            className="group flex min-h-[76px] w-full min-w-0 items-center gap-3 rounded-xl border bg-card p-3 text-left shadow-sm transition-colors hover:border-primary/40 hover:bg-muted/30 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2"
                          >
                            <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                              {client.logo_url ? (
                                <img
                                  src={client.logo_url}
                                  alt=""
                                  className="h-full w-full object-contain p-1"
                                />
                              ) : (
                                <span className="text-lg font-semibold text-muted-foreground">
                                  {String(client.name || "?").charAt(0).toUpperCase()}
                                </span>
                              )}
                            </div>
                            <span className="flex min-w-0 flex-1 items-center gap-2">
                              <span
                                aria-label={client.active ? "Ativo" : "Inativo"}
                                className={`h-2.5 w-2.5 shrink-0 rounded-full ${client.active ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-500"}`}
                              />
                              <span className="min-w-0 whitespace-normal break-words text-sm font-semibold text-foreground group-hover:text-primary">
                                {client.name}
                              </span>
                            </span>
                          </button>
                        ))}
                      </div>
                    )}
                  </section>
                )}

                {activeSection ===
                  "groupings" && (
                  <section>
                    <div>
                      <h2 className="text-xl font-semibold">
                        Agrupamentos disponíveis
                      </h2>

                      <p className="mt-1 text-sm text-muted-foreground">
                        Controle quais opções aparecem no seletor de agrupamento dos gráficos.
                      </p>
                    </div>

                    <div className="mt-6 overflow-hidden rounded-xl border bg-card shadow-sm">
                      <div className="divide-y">
                        {GROUPINGS.map(
                          (
                            grouping
                          ) => (
                            <div
                              key={
                                grouping.key
                              }
                              className="flex items-center justify-between gap-4 px-5 py-4"
                            >
                              <div>
                                <span className="font-medium">
                                  {
                                    grouping.label
                                  }
                                </span>

                                <p className="mt-0.5 text-xs text-muted-foreground">
                                  {groupings.includes(
                                    grouping.key
                                  )
                                    ? "Disponível nos gráficos."
                                    : "Oculto nos gráficos."}
                                </p>
                              </div>

                              <Switch
                                checked={groupings.includes(
                                  grouping.key
                                )}
                                onCheckedChange={() =>
                                  toggleGrouping(
                                    grouping.key
                                  )
                                }
                              />
                            </div>
                          )
                        )}
                      </div>
                    </div>
                  </section>
                )}
              </>
            )}
          </main>
        </div>
      </div>

      {/* Modal de visualização, criação e edição */}
      {modalOpen && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4"
          onMouseDown={
            closeModal
          }
        >
          <div
            role="dialog"
            aria-modal="true"
            aria-labelledby="client-modal-title"
            onMouseDown={(event) =>
              event.stopPropagation()
            }
            className="max-h-[90vh] w-full max-w-2xl overflow-hidden rounded-xl border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2
                id="client-modal-title"
                className="min-w-0 truncate text-xl font-semibold"
              >
                {viewMode
                  ? editingClient.name
                  : isEditing
                    ? "Editar cliente"
                    : "Criar cliente"}
              </h2>

              <div className="ml-3 flex shrink-0 items-center gap-1">
                {viewMode && isEditing && (
                  <button
                    type="button"
                    onClick={() => setViewMode(false)}
                    aria-label="Editar cliente"
                    title="Editar cliente"
                    className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
                  >
                    <Pencil className="h-4 w-4" />
                  </button>
                )}
                <button
                  type="button"
                  onClick={closeModal}
                  disabled={saving}
                  aria-label="Fechar"
                  className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                >
                  <X className="h-5 w-5" />
                </button>
              </div>
            </div>

            {viewMode && isEditing ? (
              <div className="max-h-[calc(90vh-73px)] space-y-5 overflow-y-auto px-6 py-5">
                <div className="flex items-center gap-4">
                  <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                    {editingClient.logo_url ? (
                      <img
                        src={editingClient.logo_url}
                        alt={`Logo de ${editingClient.name}`}
                        className="h-full w-full object-contain p-1"
                      />
                    ) : (
                      <span className="text-xl font-semibold text-muted-foreground">{logoInitial}</span>
                    )}
                  </div>
                  <div className="min-w-0">
                    <p className="truncate text-lg font-semibold">{editingClient.name}</p>
                    <span className="mt-1 inline-flex items-center gap-2 text-sm text-muted-foreground">
                      <span className={`h-2.5 w-2.5 rounded-full ${editingClient.active ? "bg-emerald-500" : "bg-zinc-400 dark:bg-zinc-500"}`} />
                      {editingClient.active ? "Ativo" : "Inativo"}
                    </span>
                  </div>
                </div>

                <dl className="grid gap-3 sm:grid-cols-2">
                  <ReadOnlyField label="Origem">{editingClient.origin || "Não definida"}</ReadOnlyField>
                  <ReadOnlyField label="Status">{editingClient.active ? "Ativo" : "Inativo"}</ReadOnlyField>
                  <div className="grid grid-cols-2 gap-3 sm:col-span-2">
                    <ReadOnlyField label="Valor da mensalidade">
                      {editingClient.monthly_fee == null ? "Não definido" : `R$ ${formatMonthlyFee(editingClient.monthly_fee)}`}
                    </ReadOnlyField>
                    <ReadOnlyField label="Data de pgmt.">
                      {formatDate(editingClient.first_payment_date)}
                    </ReadOnlyField>
                  </div>
                  <ReadOnlyField label="Data de entrada">{formatDate(editingClient.entry_date || editingClient.created_at)}</ReadOnlyField>
                  <ReadOnlyField label="Data de saída">{formatDate(editingClient.exit_date)}</ReadOnlyField>
                  <ReadOnlyField label="Conta Meta">
                    {editingClient.account_id
                      ? accounts.find((account) => account.id === editingClient.account_id)?.name || "Conta não encontrada"
                      : "Sem conta vinculada"}
                  </ReadOnlyField>
                  <ReadOnlyField label="Identificador da conta">
                    {editingClient.account_id || "Não vinculada"}
                  </ReadOnlyField>
                  <ReadOnlyField label="Moeda">{editingClient.currency || "BRL"}</ReadOnlyField>
                  <ReadOnlyField label="Forma de pagamento">
                    {PAYMENT_METHOD_LABELS[editingClient.payment_method || "auto"] || "Não identificada"}
                  </ReadOnlyField>
                  <ReadOnlyField label="Cadastro criado em">{formatDate(editingClient.created_at)}</ReadOnlyField>
                  <ReadOnlyField label="Conta sincronizada em">{formatDate(editingClient.last_synced_at)}</ReadOnlyField>
                  <ReadOnlyField label="Cadastro atualizado em">{formatDate(editingClient.updated_at)}</ReadOnlyField>
                </dl>
              </div>
            ) : (
            <form
              onSubmit={
                handleSaveClient
              }
            >
              <div className="space-y-3 px-6 py-4">
                <div className="flex items-center gap-3">
                  <div className="group relative h-16 w-16 shrink-0">
                    <div className="flex h-full w-full items-center justify-center overflow-hidden rounded-lg border bg-muted">
                      {displayedLogo ? (
                        <img src={displayedLogo} alt="" className="h-full w-full object-contain p-1" />
                      ) : (
                        <span className="text-xl font-semibold text-muted-foreground">{logoInitial}</span>
                      )}
                    </div>
                    <button
                      type="button"
                      onClick={() => logoInputRef.current?.click()}
                      disabled={saving}
                      aria-label="Editar logo"
                      className="absolute inset-0 flex items-center justify-center rounded-lg bg-black/45 text-white opacity-0 transition-opacity group-hover:opacity-100 group-focus-within:opacity-100 focus-visible:opacity-100 disabled:cursor-not-allowed"
                    >
                      <Pencil className="h-5 w-5" />
                    </button>
                    <input
                      ref={logoInputRef}
                      id="client-logo"
                      type="file"
                      accept="image/png,image/jpeg,image/webp"
                      disabled={saving}
                      onClick={(event) => {
                        event.currentTarget.value = "";
                      }}
                      onChange={handleLogoChange}
                      className="sr-only"
                    />
                  </div>

                  <div className="flex min-w-0 flex-1 items-center gap-3">
                    <input
                      id="client-name"
                      type="text"
                      value={form.name}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          name: event.target.value,
                        }))
                      }
                      placeholder="Nome do cliente"
                      autoFocus
                      disabled={saving}
                      aria-label="Nome do cliente"
                      className="h-10 min-w-0 flex-1 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <div className="flex shrink-0 items-center gap-2">
                      <span className="text-xs font-medium text-muted-foreground">
                        {form.active ? "Ativo" : "Inativo"}
                      </span>
                      <Switch
                        checked={form.active}
                        disabled={saving}
                        aria-label={form.active ? "Desativar cliente" : "Ativar cliente"}
                        onCheckedChange={(value) =>
                          setForm((current) => ({
                            ...current,
                            active: value,
                          }))
                        }
                      />
                    </div>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="meta-account"
                    className="text-sm font-medium"
                  >
                    Conta Meta
                  </label>

                  <select
                    id="meta-account"
                    value={
                      form.account_id
                    }
                    onChange={(event) =>
                      setForm(
                        (current) => ({
                          ...current,
                          account_id:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    disabled={saving}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    <option value="">
                      Sem conta vinculada
                    </option>

                    {modalAccounts.map(
                      (account) => (
                        <option
                          key={
                            account.id
                          }
                          value={
                            account.id
                          }
                        >
                          {account.name} —{" "}
                          {account.id}
                        </option>
                      )
                    )}
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-3">
                  <div>
                    <label
                      htmlFor="client-origin"
                      className="text-sm font-medium"
                    >
                      Origem
                    </label>

                    <select
                      id="client-origin"
                      value={form.origin}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          origin: event.target.value,
                        }))
                      }
                      disabled={saving}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    >
                      {!isEditing && (
                        <option value="" disabled>
                          Selecione a origem
                        </option>
                      )}
                      {ORIGINS.map((origin) => (
                        <option key={origin} value={origin}>
                          {origin}
                        </option>
                      ))}
                    </select>
                  </div>

                  <div>
                    <label
                      htmlFor="client-monthly-fee"
                      className="text-sm font-medium"
                    >
                      Valor da mensalidade (R$)
                    </label>
                    <input
                      id="client-monthly-fee"
                      type="text"
                      inputMode="decimal"
                      autoComplete="off"
                      value={form.monthly_fee}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          monthly_fee: event.target.value,
                        }))
                      }
                      onBlur={() => {
                        const amount = parseMonthlyFee(form.monthly_fee);
                        if (amount !== null && amount !== undefined) {
                          setForm((current) => ({
                            ...current,
                            monthly_fee: formatMonthlyFee(amount),
                          }));
                        }
                      }}
                      disabled={saving}
                      placeholder="0,00"
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>

                  <div>
                    <label
                      htmlFor="client-first-payment-date"
                      className="text-sm font-medium"
                    >
                      Data de pgmt.
                    </label>
                    <input
                      id="client-first-payment-date"
                      type="date"
                      value={form.first_payment_date}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          first_payment_date: event.target.value,
                        }))
                      }
                      disabled={saving}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                    <p className="mt-1 text-xs text-muted-foreground">
                      {editingClient?.billing_day && !editingClient?.first_payment_date
                        ? `Regra anterior: dia ${editingClient.billing_day}; ela segue ativa até definir o primeiro pagamento.`
                        : "Primeiro pagamento; as próximas cobranças seguem o mesmo dia mensal."}
                    </p>
                  </div>
                </div>

                <div>
                  <label
                    htmlFor="client-payment-method"
                    className="text-sm font-medium"
                  >
                    Forma de pagamento
                  </label>
                  <select
                    id="client-payment-method"
                    value={form.payment_method}
                    onChange={(event) =>
                      setForm((current) => ({
                        ...current,
                        payment_method: event.target.value,
                      }))
                    }
                    disabled={saving}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {Object.entries(PAYMENT_METHOD_LABELS).map(([value, label]) => (
                      <option key={value} value={value}>{label}</option>
                    ))}
                  </select>
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label
                      htmlFor="client-entry-date"
                      className="text-sm font-medium"
                    >
                      Data de entrada
                    </label>
                    <input
                      id="client-entry-date"
                      type="date"
                      value={form.entry_date}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          entry_date: event.target.value,
                        }))
                      }
                      disabled={saving}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                  <div>
                    <label
                      htmlFor="client-exit-date"
                      className="text-sm font-medium"
                    >
                      Data de saída
                    </label>
                    <input
                      id="client-exit-date"
                      type="date"
                      value={form.exit_date}
                      onChange={(event) =>
                        setForm((current) => ({
                          ...current,
                          exit_date: event.target.value,
                        }))
                      }
                      disabled={saving}
                      className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                    />
                  </div>
                </div>


              </div>

              <div
                className={`flex gap-3 border-t px-6 py-4 ${
                  isEditing
                    ? "justify-between"
                    : "justify-end"
                }`}
              >
                {isEditing && (
                  <button
                    type="button"
                    onClick={() =>
                      setDeleteConfirmOpen(
                        true
                      )
                    }
                    disabled={saving}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md border border-destructive/40 bg-background px-4 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    <Trash2 className="h-4 w-4" />

                    Excluir
                  </button>
                )}

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={cancelEdit}
                    disabled={saving}
                    className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={saving}
                    className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-50"
                  >
                    {saving && (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    )}

                    {saving
                      ? "Salvando..."
                      : isEditing
                        ? "Salvar alterações"
                        : "Criar cliente"}
                  </button>
                </div>
              </div>
            </form>
            )}
          </div>
        </div>
      )}

      {/* Confirmação visual da exclusão */}
      {deleteConfirmOpen &&
        editingClient && (
          <div
            className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
            onMouseDown={() => {
              if (!deleting) {
                setDeleteConfirmOpen(false);
              }
            }}
          >
            <div
              role="alertdialog"
              aria-modal="true"
              aria-labelledby="delete-client-title"
              onMouseDown={(
                event
              ) =>
                event.stopPropagation()
              }
              className="w-full max-w-md rounded-xl border bg-card shadow-2xl"
            >
              <div className="px-6 py-6">
                <div className="flex h-11 w-11 items-center justify-center rounded-full bg-destructive/10 text-destructive">
                  <Trash2 className="h-5 w-5" />
                </div>

                <h2
                  id="delete-client-title"
                  className="mt-4 text-lg font-semibold"
                >
                  Excluir cliente?
                </h2>

                <p className="mt-2 text-sm leading-relaxed text-muted-foreground">
                  Tem certeza de que deseja excluir{" "}
                  <strong className="text-foreground">
                    {
                      editingClient.name
                    }
                  </strong>
                                    ? As demandas, operações e informações de boleto desse cliente também serão removidas. A conta Meta continuará disponível para outro vínculo.

                </p>
              </div>

              <div className="flex justify-end gap-3 border-t px-6 py-4">
                <button
                  type="button"
                  disabled={deleting}
                  onClick={() =>
                    setDeleteConfirmOpen(
                      false
                    )
                  }
                  className="inline-flex h-10 items-center justify-center rounded-md border bg-background px-4 text-sm font-medium transition-colors hover:bg-muted"
                >
                  Cancelar
                </button>

                <button
                  type="button"
                  onClick={
                    handleDeleteClient
                  }
                  disabled={deleting}
                  className="inline-flex h-10 items-center justify-center gap-2 rounded-md bg-destructive px-4 text-sm font-medium text-destructive-foreground transition-opacity hover:opacity-90"
                >
                  {deleting ? (
                    <Loader2 className="h-4 w-4 animate-spin" />
                  ) : (
                    <Trash2 className="h-4 w-4" />
                  )}

                  {deleting
                    ? "Excluindo..."
                    : "Excluir cliente"}
                </button>
              </div>
            </div>
          </div>
        )}
    </div>
  );
}
