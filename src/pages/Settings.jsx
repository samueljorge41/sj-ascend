import React, {
  useEffect,
  useMemo,
  useState,
} from "react";

import {
  createClient,
  removeClientLogo,
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
  ImagePlus,
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
  origin: "",
  account_id: "",
  active: true,
};

function getOriginBadgeClass(origin) {
  if (origin === "Avaloon") {
    return [
      "border-orange-200",
      "bg-orange-50",
      "text-orange-700",
      "dark:border-orange-900/60",
      "dark:bg-orange-950/40",
      "dark:text-orange-300",
    ].join(" ");
  }

  if (origin === "SJ Marketing") {
    return [
      "border-blue-200",
      "bg-blue-50",
      "text-blue-700",
      "dark:border-blue-900/60",
      "dark:bg-blue-950/40",
      "dark:text-blue-300",
    ].join(" ");
  }

  return [
    "border-border",
    "bg-muted",
    "text-muted-foreground",
  ].join(" ");
}

function getActiveBadgeClass(active) {
  if (active) {
    return [
      "border-emerald-500/30",
      "bg-emerald-500/10",
      "text-emerald-700",
      "dark:text-emerald-400",
    ].join(" ");
  }

  return [
    "border-border",
    "bg-muted",
    "text-muted-foreground",
  ].join(" ");
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

  const [removeLogoRequested, setRemoveLogoRequested] =
    useState(false);

  const [searchTerm, setSearchTerm] =
    useState("");

  const [statusFilter, setStatusFilter] =
    useState("all");

  const [originFilter, setOriginFilter] =
    useState("all");

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
    (!removeLogoRequested
      ? editingClient?.logo_url ||
        ""
      : "");

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
    statusFilter !== "all" ||
    originFilter !== "all";

  const resetFilters = () => {
    setSearchTerm("");
    setStatusFilter("all");
    setOriginFilter("all");
  };

  const resetModal = () => {
    setEditingClient(null);
    setForm(EMPTY_FORM);
    setLogoFile(null);
    setLogoPreview("");
    setRemoveLogoRequested(false);
    setDeleteConfirmOpen(false);
  };

  const openCreateModal = () => {
    resetModal();
    setModalOpen(true);
  };

  const openEditModal = (client) => {
    setEditingClient(client);

    setForm({
      name:
        client.name || "",
      origin:
        client.origin || "",
      account_id:
        client.account_id || "",
      active:
        Boolean(client.active),
    });

    setModalOpen(true);
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
      setRemoveLogoRequested(false);
    };

  const handleRemoveLogo = () => {
    setLogoFile(null);
    setLogoPreview("");
    setRemoveLogoRequested(
      Boolean(
        editingClient?.logo_url
      )
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
          } else if (
            isEditing &&
            removeLogoRequested
          ) {
            savedClient =
              await removeClientLogo(
                savedClient.id
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

        setModalOpen(false);
        resetModal();
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
                      <div className="mt-5 overflow-hidden rounded-xl border bg-card shadow-sm">
                        <div className="divide-y">
                          {filteredClients.map(
                            (
                              client
                            ) => {
                              const account =
                                accounts.find(
                                  (
                                    item
                                  ) =>
                                    item.id ===
                                    client.account_id
                                );

                              return (
                                <div
                                  key={
                                    client.id
                                  }
                                  className="flex flex-col gap-4 px-5 py-5 transition-colors hover:bg-muted/30 sm:flex-row sm:items-center"
                                >
                                  <div className="flex min-w-0 flex-1 items-center gap-3">
                                    <div className="flex h-12 w-12 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                                      {client.logo_url ? (
                                        <img
                                          src={
                                            client.logo_url
                                          }
                                          alt=""
                                          className="h-full w-full object-cover"
                                        />
                                      ) : (
                                        <span className="text-lg font-semibold text-muted-foreground">
                                          {String(
                                            client.name ||
                                              "?"
                                          )
                                            .charAt(
                                              0
                                            )
                                            .toUpperCase()}
                                        </span>
                                      )}
                                    </div>

                                    <div className="min-w-0">
                                      <div className="flex flex-wrap items-center gap-2">
                                        <div className="truncate font-semibold">
                                          {
                                            client.name
                                          }
                                        </div>

                                        <span
                                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getOriginBadgeClass(
                                            client.origin
                                          )}`}
                                        >
                                          {client.origin ||
                                            "Sem origem"}
                                        </span>

                                        <span
                                          className={`inline-flex rounded-full border px-2 py-0.5 text-[11px] font-medium ${getActiveBadgeClass(
                                            client.active
                                          )}`}
                                        >
                                          {client.active
                                            ? "Ativo"
                                            : "Inativo"}
                                        </span>
                                      </div>

                                      <div className="mt-1 truncate text-xs text-muted-foreground">
                                        {client.account_id
                                          ? account?.name ||
                                            "Conta Meta não encontrada"
                                          : "Sem conta Meta vinculada"}
                                      </div>

                                      <div className="mt-0.5 text-[11px] text-muted-foreground">
                                        {client.account_id
                                          ? `${client.account_id} · ${
                                              client.currency ||
                                              "BRL"
                                            }`
                                          : "Vinculação pendente"}
                                      </div>
                                    </div>
                                  </div>

                                  <button
                                    type="button"
                                    onClick={() =>
                                      openEditModal(
                                        client
                                      )
                                    }
                                    className="inline-flex h-9 items-center justify-center gap-2 self-start rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted sm:self-auto"
                                  >
                                    <Pencil className="h-4 w-4" />

                                    Editar
                                  </button>
                                </div>
                              );
                            }
                          )}
                        </div>
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

      {/* Modal de criação e edição */}
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
            className="w-full max-w-md rounded-xl border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2
                id="client-modal-title"
                className="text-xl font-semibold"
              >
                {isEditing
                  ? "Editar cliente"
                  : "Criar cliente"}
              </h2>

              <button
                type="button"
                onClick={
                  closeModal
                }
                disabled={saving}
                aria-label="Fechar"
                className="inline-flex h-9 w-9 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
              >
                <X className="h-5 w-5" />
              </button>
            </div>

            <form
              onSubmit={
                handleSaveClient
              }
            >
              <div className="space-y-4 px-6 py-5">
                <div>
                  <label
                    htmlFor="client-name"
                    className="text-sm font-medium"
                  >
                    Nome do cliente
                  </label>

                  <input
                    id="client-name"
                    type="text"
                    value={form.name}
                    onChange={(event) =>
                      setForm(
                        (current) => ({
                          ...current,
                          name:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    placeholder="Ex.: Agência do Óleo"
                    autoFocus
                    disabled={saving}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  />
                </div>

                <div>
                  <label
                    htmlFor="client-logo"
                    className="text-sm font-medium"
                  >
                    Logo
                  </label>

                  <div className="mt-2 flex items-center gap-3">
                    <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                      {displayedLogo ? (
                        <img
                          src={
                            displayedLogo
                          }
                          alt=""
                          className="h-full w-full object-cover"
                        />
                      ) : (
                        <span className="text-xl font-semibold text-muted-foreground">
                          {logoInitial}
                        </span>
                      )}
                    </div>

                    <div className="flex flex-wrap gap-2">
                      <label
                        htmlFor="client-logo"
                        className="inline-flex h-9 cursor-pointer items-center justify-center gap-2 rounded-md border bg-background px-3 text-sm font-medium transition-colors hover:bg-muted"
                      >
                        <ImagePlus className="h-4 w-4" />

                        {displayedLogo
                          ? "Trocar logo"
                          : "Escolher logo"}
                      </label>

                      <input
                        id="client-logo"
                        type="file"
                        accept="image/png,image/jpeg,image/webp"
                        disabled={saving}
                        onClick={(event) => {
                          event.currentTarget.value =
                            "";
                        }}
                        onChange={
                          handleLogoChange
                        }
                        className="sr-only"
                      />

                      {displayedLogo && (
                        <button
                          type="button"
                          onClick={
                            handleRemoveLogo
                          }
                          disabled={saving}
                          className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium text-destructive transition-colors hover:bg-destructive/10 disabled:cursor-not-allowed disabled:opacity-50"
                        >
                          Remover
                        </button>
                      )}
                    </div>
                  </div>
                </div>

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
                      setForm(
                        (current) => ({
                          ...current,
                          origin:
                            event
                              .target
                              .value,
                        })
                      )
                    }
                    disabled={saving}
                    className="mt-2 h-10 w-full rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                  >
                    {!isEditing && (
                      <option
                        value=""
                        disabled
                      >
                        Selecione a origem
                      </option>
                    )}

                    {ORIGINS.map(
                      (origin) => (
                        <option
                          key={origin}
                          value={origin}
                        >
                          {origin}
                        </option>
                      )
                    )}
                  </select>
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


                <div className="flex items-center justify-between rounded-lg border px-4 py-3">
                  <div className="text-sm font-medium">
                    Cliente ativo
                  </div>

                  <Switch
                    checked={form.active}
                    disabled={saving}
                    onCheckedChange={(
                      value
                    ) =>
                      setForm(
                        (current) => ({
                          ...current,
                          active:
                            value,
                        })
                      )
                    }
                  />
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
                    onClick={
                      closeModal
                    }
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