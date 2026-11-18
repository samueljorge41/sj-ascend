import React, {
  useState,
  useEffect,
  useCallback,
} from "react";

import { useAppData } from "@/components/AppDataProvider";

import {
  DATE_RANGES,
  getDateRange,
  todayStr,
  daysAgoStr,
} from "@/lib/dateRanges";


function parseSqliteDate(value) {
  if (!value) {
    return null;
  }

  /*
   * CURRENT_TIMESTAMP do SQLite usa UTC.
   * Transformamos:
   *
   * 2026-07-18 21:30:00
   *
   * em:
   *
   * 2026-07-18T21:30:00Z
   */
  const normalized = String(value).includes("T")
    ? String(value)
    : `${String(value).replace(" ", "T")}Z`;

  const date = new Date(normalized);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date;
}

function formatUpdatedAt(value) {
  const date = parseSqliteDate(value);

  if (!date) {
    return "Ainda não atualizado";
  }

  return new Intl.DateTimeFormat("pt-BR", {
    dateStyle: "short",
    timeStyle: "short",
  }).format(date);
}

function normalizeAccountId(value) {
  return String(value || "").replace(
    /^act_/,
    ""
  );
}

const STATUS = {
  green: {
    label: "Campanhas ativas",
    dot: "bg-emerald-500",
  },
  red: {
    label: "Sem campanhas ativas",
    dot: "bg-rose-500",
  },
  blue: {
    label: "Campanhas concluídas",
    dot: "bg-blue-500",
  },
  block: {
    label: "Saldo zerado",
    dot: "bg-amber-500",
  },
};

const PAYMENT_METHOD_LABEL = {
  prepaid: "Saldo pré-pago",
  credit_card: "Cartão",
  other: "Outra forma de pagamento",
  unknown: "Não identificado",
};

function RefreshIcon({ spinning = false }) {
  return (
    <svg
      viewBox="0 0 24 24"
      fill="none"
      stroke="currentColor"
      strokeWidth="2"
      strokeLinecap="round"
      strokeLinejoin="round"
      className={`h-4 w-4 ${
        spinning ? "animate-spin" : ""
      }`}
      aria-hidden="true"
    >
      <path d="M20 11a8.1 8.1 0 0 0-15.5-2M4 4v5h5" />
      <path d="M4 13a8.1 8.1 0 0 0 15.5 2M20 20v-5h-5" />
    </svg>
  );
}

export default function ClientsOverview() {
  const {
    clients,
    loading: loadingClients,
    getCachedOverview,
    fetchOverview,
  } = useAppData();

  const [range, setRange] =
    useState("last_30_days");

  const [customSince, setCustomSince] =
    useState(daysAgoStr(29));

  const [customUntil, setCustomUntil] =
    useState(todayStr());

  const [debSince, setDebSince] =
    useState(customSince);

  const [debUntil, setDebUntil] =
    useState(customUntil);

  const [list, setList] =
    useState([]);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const [
    refreshingAll,
    setRefreshingAll,
  ] = useState(false);

  const [
    refreshingClients,
    setRefreshingClients,
  ] = useState({});

  useEffect(() => {
    const timeout = setTimeout(() => {
      setDebSince(customSince);
      setDebUntil(customUntil);
    }, 600);

    return () => clearTimeout(timeout);
  }, [customSince, customUntil]);

  const getSelectedPeriod =
    useCallback(() => {
      if (range === "custom") {
        return {
          since: debSince,
          until: debUntil,
        };
      }

      return getDateRange(range);
    }, [
      range,
      debSince,
      debUntil,
    ]);

  const getActiveData =
    useCallback(() => {
      const activeRecords =
        Object.values(clients).filter(
          (client) =>
            client.active === true &&
            Boolean(
              String(
                client.account_id ||
                  ""
              ).trim()
            )
        );

      const accountIds =
        activeRecords.map(
          (client) =>
            client.account_id
        );

      return {
        activeRecords,
        accountIds,
      };
    }, [clients]);

  const addLogos = useCallback(
    (overviewClients, activeRecords) => {
      const clientsByAccount =
        new Map(
          activeRecords.map((client) => [
            normalizeAccountId(
              client.account_id
            ),
            client,
          ])
        );

      return (overviewClients || []).map(
        (client) => {
          const registeredClient =
            clientsByAccount.get(
              normalizeAccountId(
                client.account_id
              )
            );

          return {
            ...client,
            name:
              registeredClient?.name ||
              client.name ||
              client.account_id,
            logo_url:
              registeredClient?.logo_url || "",
          };
        }
      );
    },
    []
  );

  useEffect(() => {
    if (loadingClients) {
      return;
    }

    let cancelled = false;

    async function loadOverview() {
      setLoading(true);
      setError("");

      try {
        const {
          accountIds,
          activeRecords,
        } = getActiveData();

        if (accountIds.length === 0) {
          if (!cancelled) {
            setList([]);
          }

          return;
        }

        const {
          since,
          until,
        } = getSelectedPeriod();

        if (!since || !until) {
          return;
        }

        const memoryCache =
          getCachedOverview(
            accountIds,
            since,
            until
          );

        if (memoryCache) {
          if (!cancelled) {
            setList(
              addLogos(
                memoryCache.clients,
                activeRecords
              )
            );
          }

          return;
        }

        const response =
          await fetchOverview(
            accountIds,
            since,
            until
          );

        if (!cancelled) {
          setList(
            addLogos(
              response.clients,
              activeRecords
            )
          );
        }
      } catch (error) {
        if (!cancelled) {
          setError(
            error.message ||
              "Erro ao carregar overview"
          );
        }
      } finally {
        if (!cancelled) {
          setLoading(false);
        }
      }
    }

    loadOverview();

    return () => {
      cancelled = true;
    };
  }, [
    loadingClients,
    getActiveData,
    getSelectedPeriod,
    getCachedOverview,
    fetchOverview,
    addLogos,
  ]);

  const handleRefreshAll =
    useCallback(async () => {
      if (refreshingAll) {
        return;
      }

      setRefreshingAll(true);
      setError("");

      try {
        const {
          accountIds,
          activeRecords,
        } = getActiveData();

        if (accountIds.length === 0) {
          setList([]);
          return;
        }

        const {
          since,
          until,
        } = getSelectedPeriod();

        if (!since || !until) {
          return;
        }

        const response =
          await fetchOverview(
            accountIds,
            since,
            until,
            true
          );

        setList(
          addLogos(
            response.clients,
            activeRecords
          )
        );
      } catch (error) {
        setError(
          error.message ||
            "Não foi possível atualizar todos os clientes."
        );
      } finally {
        setRefreshingAll(false);
      }
    }, [
      refreshingAll,
      getActiveData,
      getSelectedPeriod,
      fetchOverview,
      addLogos,
    ]);

  const handleRefreshClient =
    useCallback(
      async (accountId) => {
        if (
          refreshingClients[accountId]
        ) {
          return;
        }

        setRefreshingClients(
          (current) => ({
            ...current,
            [accountId]: true,
          })
        );

        setError("");

        try {
          const {
            activeRecords,
          } = getActiveData();

          const {
            since,
            until,
          } = getSelectedPeriod();

          if (!since || !until) {
            return;
          }

          const response =
            await fetchOverview(
              [accountId],
              since,
              until,
              true
            );

          const updatedClient =
            response.clients?.[0];

          if (!updatedClient) {
            throw new Error(
              "A Meta não retornou dados para este cliente."
            );
          }

          const clientWithLogo =
            addLogos(
              [updatedClient],
              activeRecords
            )[0];

          setList((currentList) =>
            currentList.map((client) =>
              client.account_id ===
              accountId
                ? clientWithLogo
                : client
            )
          );
        } catch (error) {
          setError(
            error.message ||
              "Não foi possível atualizar este cliente."
          );
        } finally {
          setRefreshingClients(
            (current) => ({
              ...current,
              [accountId]: false,
            })
          );
        }
      },
      [
        refreshingClients,
        getActiveData,
        getSelectedPeriod,
        fetchOverview,
        addLogos,
      ]
    );

  const generalUpdatedAt =
    list.reduce(
      (latest, client) => {
        const currentDate =
          parseSqliteDate(
            client.updated_at
          );

        if (!currentDate) {
          return latest;
        }

        if (
          !latest ||
          currentDate > latest
        ) {
          return currentDate;
        }

        return latest;
      },
      null
    );

  const fmtCurrency = (
    value,
    currency
  ) =>
    new Intl.NumberFormat("pt-BR", {
      style: "currency",
      currency:
        currency || "BRL",
      maximumFractionDigits: 2,
    }).format(value || 0);

  const fmtNumber = (value) =>
    new Intl.NumberFormat(
      "pt-BR"
    ).format(
      Math.round(value || 0)
    );

  const hasActiveLinkedClients =
    Object.values(clients).some(
      (client) =>
        client.active === true &&
        Boolean(
          String(
            client.account_id ||
              ""
          ).trim()
        )
    );

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-8 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 md:flex-row md:items-end md:justify-between">
          <div>
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Overview de Clientes
            </h1>

            <p className="mt-1 text-sm text-muted-foreground">
              Visão geral dos clientes ativos no período selecionado.
            </p>

            {!loading &&
              generalUpdatedAt && (
                <p className="mt-2 text-xs text-muted-foreground">
                  Última atualização geral:{" "}
                  {new Intl.DateTimeFormat(
                    "pt-BR",
                    {
                      dateStyle:
                        "short",
                      timeStyle:
                        "short",
                    }
                  ).format(
                    generalUpdatedAt
                  )}
                </p>
              )}
          </div>

          <div className="flex flex-wrap items-center gap-3">
            <select
              value={range}
              onChange={(event) =>
                setRange(event.target.value)
              }
              disabled={refreshingAll}
              className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
            >
              {DATE_RANGES.map(
                (rangeOption) => (
                  <option
                    key={rangeOption.value}
                    value={rangeOption.value}
                  >
                    {rangeOption.label}
                  </option>
                )
              )}
            </select>
            

            {range === "custom" && (
              <div className="flex items-center gap-2">
                <input
                  type="date"
                  value={customSince}
                  max={customUntil}
                  onChange={(event) =>
                    setCustomSince(
                      event.target.value
                    )
                  }
                  disabled={
                    refreshingAll
                  }
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />

                <span className="text-sm text-muted-foreground">
                  até
                </span>

                <input
                  type="date"
                  value={customUntil}
                  min={customSince}
                  max={todayStr()}
                  onChange={(event) =>
                    setCustomUntil(
                      event.target.value
                    )
                  }
                  disabled={
                    refreshingAll
                  }
                  className="h-10 rounded-md border border-input bg-background px-3 text-sm focus:outline-none focus:ring-2 focus:ring-ring disabled:cursor-not-allowed disabled:opacity-60"
                />
              </div>
            )}

            <button
              type="button"
              onClick={
                handleRefreshAll
              }
              disabled={
                refreshingAll ||
                loading ||
                !hasActiveLinkedClients
              }
              className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground transition-opacity hover:opacity-90 disabled:cursor-not-allowed disabled:opacity-60"
            >
              <RefreshIcon
                spinning={
                  refreshingAll
                }
              />

              {refreshingAll
                ? "Atualizando..."
                : "Atualizar todos"}
            </button>
          </div>
        </div>

        {error && (
          <div className="mt-6 rounded-lg border border-destructive/30 bg-destructive/5 px-4 py-3 text-sm text-destructive">
            {error}
          </div>
        )}

        {(loading ||
          loadingClients) && (
          <div className="mt-8 flex items-center justify-center py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          </div>
        )}

        {!loading &&
          !loadingClients &&
          !error &&
          list.length === 0 && (
            <div className="mt-10 rounded-xl border bg-card p-10 text-center text-muted-foreground">
              {hasActiveLinkedClients
                ? "Nenhum resultado foi retornado para os clientes ativos com conta Meta vinculada."
                : "Nenhum cliente ativo com conta Meta vinculada."}
            </div>
          )}

        {!loading &&
          !loadingClients &&
          list.length > 0 && (
            <div className="mt-8 grid grid-cols-1 gap-4 sm:grid-cols-2 lg:grid-cols-3">
              {list.map((client) => {
                const isRefreshing =
                  Boolean(
                    refreshingClients[
                      client
                        .account_id
                    ]
                  );

                return (
                  <div
                    key={
                      client.account_id
                    }
                    className="relative rounded-xl border bg-card p-5 shadow-sm"
                  >
                    <button
                      type="button"
                      onClick={() =>
                        handleRefreshClient(
                          client.account_id
                        )
                      }
                      disabled={
                        isRefreshing ||
                        refreshingAll
                      }
                      title="Atualizar este cliente"
                      aria-label={`Atualizar ${
                        client.name ||
                        client.account_id
                      }`}
                      className="absolute right-4 top-4 inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-50"
                    >
                      <RefreshIcon
                        spinning={
                          isRefreshing
                        }
                      />
                    </button>

                    <div className="flex items-center gap-3 pr-10">
                      <div className="h-12 w-12 shrink-0 overflow-hidden rounded-lg border bg-muted">
                        {client.logo_url ? (
                          <img
                            src={
                              client.logo_url
                            }
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <div className="flex h-full w-full items-center justify-center text-lg font-semibold text-muted-foreground">
                            {(
                              client.name ||
                              "?"
                            ).charAt(0)}
                          </div>
                        )}
                      </div>

                      <div className="min-w-0">
                        <div className="truncate font-semibold">
                          {client.name ||
                            client.account_id}
                        </div>

                        <div className="flex items-center gap-1.5 text-xs text-muted-foreground">
                          <span
                            className={`h-2 w-2 rounded-full ${
                              STATUS[
                                client
                                  .status
                              ]?.dot ||
                              "bg-muted"
                            }`}
                          />

                          {STATUS[
                            client.status
                          ]?.label ||
                            "—"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-4 grid grid-cols-2 gap-3 text-sm">
                      <div>
                        <div className="text-xs text-muted-foreground">
                          Resultados
                          (leads)
                        </div>

                        <div className="text-lg font-semibold">
                          {fmtNumber(
                            client.leads
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground">
                          Custo por
                          resultado
                        </div>

                        <div className="text-lg font-semibold">
                          {client.cost_per_lead >
                          0
                            ? fmtCurrency(
                                client.cost_per_lead,
                                client.currency
                              )
                            : "—"}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground">
                          Investimento
                        </div>

                        <div className="text-lg font-semibold">
                          {fmtCurrency(
                            client.spend,
                            client.currency
                          )}
                        </div>
                      </div>

                      <div>
                        <div className="text-xs text-muted-foreground">
                          {client.payment_method ===
                          "prepaid"
                            ? "Saldo da conta"
                            : "Forma de pagamento"}
                        </div>

                        <div className="text-lg font-semibold">
                          {client.payment_method ===
                          "prepaid"
                            ? client.balance_known
                              ? fmtCurrency(
                                  client.balance,
                                  client.currency
                                )
                              : "Indisponível"
                            : PAYMENT_METHOD_LABEL[
                                client.payment_method
                              ] ||
                              "Não identificado"}
                        </div>
                      </div>
                    </div>

                    <div className="mt-5 border-t pt-3 text-[11px] text-muted-foreground">
                      Última atualização:{" "}
                      {formatUpdatedAt(
                        client.updated_at
                      )}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
      </div>
    </div>
  );
}
