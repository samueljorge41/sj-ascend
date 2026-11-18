import React, {
  createContext,
  useContext,
  useState,
  useEffect,
  useCallback,
  useRef,
} from "react";

import {
  getClients,
  getMetaAccounts,
  getSettings,
  getClientOperations,
  getClientDemands,
  createClientDemand,
  updateClientDemand,
  deleteClientDemand,
  deleteClientById,
  updateClientOperation,
  updateSettings,
  syncClients as syncClientsApi,
} from "@/api/systemClient";

import {
  getStatuses,
  getInsights,
  getOverview,
} from "@/api/metaClient";

const AppDataContext =
  createContext(null);

export function useAppData() {
  return useContext(
    AppDataContext
  );
}

const DEFAULT_GROUPINGS = [
  "daily",
  "weekly",
  "monthly",
  "quarterly",
  "semester",
  "yearly",
];

function mapOperations(
  operations = []
) {
  const operationsMap = {};

  operations.forEach(
    (operation) => {
      operationsMap[
        operation.client_id
      ] = operation;
    }
  );

  return operationsMap;
}

export default function AppDataProvider({
  children,
}) {
  const [accounts, setAccounts] =
    useState([]);

  const [clients, setClients] =
    useState({});

  const [
    clientOperations,
    setClientOperations,
  ] = useState({});

  const [
    clientDemands,
    setClientDemands,
  ] = useState([]);


  const [statuses, setStatuses] =
    useState({});

  const [groupings, setGroupings] =
    useState(DEFAULT_GROUPINGS);

  const [loading, setLoading] =
    useState(true);

  const [error, setError] =
    useState("");

  const insightsCache =
    useRef(new Map());

  const overviewCache =
    useRef(new Map());

  const reloadOperations =
    useCallback(async () => {
      const operations =
        await getClientOperations();

      const operationsMap =
        mapOperations(operations);

      setClientOperations(
        operationsMap
      );

      return operationsMap;
    }, []);

  const refreshClientDemands = useCallback(async () => {
    const demands = await getClientDemands();
    setClientDemands(demands || []);
    return demands || [];
  }, []);

  const load = useCallback(
    async () => {
      setLoading(true);
      setError("");

      insightsCache.current.clear();
      overviewCache.current.clear();

      try {
        const [
          recs,
          metaAccounts,
          localSettings,
          operations,
          demands,
        ] = await Promise.all([
          getClients(),
          getMetaAccounts(),
          getSettings(),
          getClientOperations(),
          getClientDemands(),
        ]);

        const localAccounts = (
          metaAccounts || []
        ).map((account) => ({
          id:
            account.account_id,

          account_id: String(
            account.account_id
          ).replace(/^act_/, ""),

          name:
            account.name,

          currency:
            account.currency ||
            "BRL",

          last_synced_at:
            account.last_synced_at,
        }));

        const clientsMap = {};

        (recs || []).forEach(
          (client) => {
            const clientKey =
              client.account_id ||
              `client_${client.id}`;

            clientsMap[clientKey] =
              client;
          }
        );

        setAccounts(
          localAccounts
        );

        setClients(
          clientsMap
        );

        setClientOperations(
          mapOperations(
            operations
          )
        );

        setClientDemands(
          demands || []
        );

        setGroupings(
          Array.isArray(
            localSettings?.groupings
          ) &&
            localSettings.groupings
              .length > 0
            ? localSettings.groupings
            : DEFAULT_GROUPINGS
        );
      } catch (error) {
        console.error(
          "Erro ao carregar dados locais:",
          error
        );

        setError(
          error.message ||
            "Não foi possível carregar os dados."
        );
      } finally {
        setLoading(false);
      }
    },
    []
  );

  const syncAccounts =
    useCallback(async () => {
      await syncClientsApi();
      await load();
    }, [load]);

  useEffect(() => {
    load();
  }, [load]);

  useEffect(() => {
    const activeIds =
      Object.values(clients)
        .filter(
          (client) =>
            client.active &&
            client.account_id
        )
        .map(
          (client) =>
            client.account_id
        );

    if (
      activeIds.length === 0
    ) {
      setStatuses({});
      return;
    }

    let cancelled = false;

    async function loadStatusesInBackground() {
      try {
        const response =
          await getStatuses(
            activeIds
          );

        if (!cancelled) {
          setStatuses(
            response.statuses ||
              {}
          );
        }
      } catch (error) {
        console.error(
          "Erro ao carregar status das contas:",
          error
        );

        if (!cancelled) {
          setStatuses({});
        }
      }
    }

    loadStatusesInBackground();

    return () => {
      cancelled = true;
    };
  }, [clients]);

  const getCachedInsights =
    useCallback(
      (
        accountId,
        since,
        until
      ) => {
        const key =
          `${accountId}|${since}|${until}`;

        return insightsCache.current.get(
          key
        );
      },
      []
    );

  const fetchInsights =
    useCallback(
      async (
        accountId,
        since,
        until
      ) => {
        const key =
          `${accountId}|${since}|${until}`;

        if (
          insightsCache.current.has(
            key
          )
        ) {
          return insightsCache.current.get(
            key
          );
        }

        const response =
          await getInsights(
            accountId,
            since,
            until
          );

        insightsCache.current.set(
          key,
          response
        );

        return response;
      },
      []
    );

  const getCachedOverview =
    useCallback(
      (
        accountIds,
        since,
        until
      ) => {
        const key =
          `${accountIds.join(
            ","
          )}|${since}|${until}`;

        return overviewCache.current.get(
          key
        );
      },
      []
    );

  const fetchOverview =
    useCallback(
      async (
        accountIds,
        since,
        until,
        forceRefresh = false
      ) => {
        const key =
          `${accountIds.join(
            ","
          )}|${since}|${until}`;

        if (
          !forceRefresh &&
          overviewCache.current.has(
            key
          )
        ) {
          return overviewCache.current.get(
            key
          );
        }

        const response =
          await getOverview(
            accountIds,
            since,
            until,
            forceRefresh
          );

        if (forceRefresh) {
          overviewCache.current.clear();
        }

        overviewCache.current.set(
          key,
          response
        );

        return response;
      },
      []
    );

  const updateClient =
    useCallback(
      (accountId, rec) => {
        setClients(
          (currentClients) => {
            const nextClients =
              {};

            Object.entries(
              currentClients
            ).forEach(
              ([key, client]) => {
                if (
                  client.id !==
                  rec.id
                ) {
                  nextClients[key] =
                    client;
                }
              }
            );

            const nextKey =
              rec.account_id ||
              `client_${rec.id}`;

            nextClients[nextKey] =
              rec;

            return nextClients;
          }
        );
      },
      []
    );

  const removeClient =
    useCallback(async (clientId) => {
      setError("");

      try {
        const result =
          await deleteClientById(
            clientId
          );

        /*
        * Remove o cliente do estado local.
        */
        setClients(
          (currentClients) => {
            const nextClients = {};

            Object.entries(
              currentClients
            ).forEach(
              ([key, client]) => {
                if (
                  client.id !==
                  clientId
                ) {
                  nextClients[key] =
                    client;
                }
              }
            );

            return nextClients;
          }
        );

        /*
        * Limpa os dados operacionais
        * relacionados ao cliente.
        */
        setClientOperations(
          (currentOperations) => {
            const nextOperations = {
              ...currentOperations,
            };

            delete nextOperations[
              clientId
            ];

            return nextOperations;
          }
        );

        setClientDemands(
          (currentDemands) =>
            currentDemands.filter(
              (demand) =>
                demand.client_id !==
                clientId
            )
        );

        /*
        * Limpa o status visual da conta
        * excluída, quando houver vínculo Meta.
        */
        if (
          result.deleted_account_id
        ) {
          const cleanAccountId =
            String(
              result.deleted_account_id
            ).replace(/^act_/, "");

          setStatuses(
            (currentStatuses) => {
              const nextStatuses = {
                ...currentStatuses,
              };

              delete nextStatuses[
                cleanAccountId
              ];

              delete nextStatuses[
                `act_${cleanAccountId}`
              ];

              return nextStatuses;
            }
          );
        }

        insightsCache.current.clear();
        overviewCache.current.clear();

        return result;
      } catch (error) {
        setError(
          error.message ||
            "Não foi possível excluir o cliente."
        );

        throw error;
      }
    }, []);

  const saveClientOperation =
    useCallback(
      async (
        clientId,
        patch
      ) => {
        setError("");

        try {
          const savedOperation =
            await updateClientOperation(
              clientId,
              patch
            );

          setClientOperations(
            (currentOperations) => ({
              ...currentOperations,
              [clientId]:
                savedOperation,
            })
          );

          return savedOperation;
        } catch (error) {
          setError(
            error.message ||
              "Não foi possível salvar os dados operacionais."
          );

          throw error;
        }
      },
      []
    );

  const addClientDemand =
    useCallback(
      async (demand) => {
        setError("");

        try {
          const savedDemand =
            await createClientDemand(
              demand
            );

          setClientDemands(
            (currentDemands) =>
              [
                ...currentDemands,
                savedDemand,
              ].sort(
                (
                  firstDemand,
                  secondDemand
                ) =>
                  String(
                    firstDemand.demand_date
                  ).localeCompare(
                    String(
                      secondDemand.demand_date
                    )
                  ) ||
                  firstDemand.id -
                    secondDemand.id
              )
          );

          if (
            savedDemand.type ===
            "optimization"
          ) {
            await reloadOperations();
          }

          return savedDemand;
        } catch (error) {
          setError(
            error.message ||
              "Não foi possível criar a demanda."
          );

          throw error;
        }
      },
      [reloadOperations]
    );

  const saveClientDemand =
    useCallback(
      async (
        demandId,
        patch
      ) => {
        setError("");

        try {
          const previousDemand =
            clientDemands.find(
              (demand) =>
                demand.id ===
                demandId
            );

          const savedDemand =
            await updateClientDemand(
              demandId,
              patch
            );

          setClientDemands(
            (currentDemands) =>
              currentDemands
                .map((demand) =>
                  demand.id ===
                  demandId
                    ? savedDemand
                    : demand
                )
                .sort(
                  (
                    firstDemand,
                    secondDemand
                  ) =>
                    String(
                      firstDemand.demand_date
                    ).localeCompare(
                      String(
                        secondDemand.demand_date
                      )
                    ) ||
                    firstDemand.id -
                      secondDemand.id
                )
          );

          if (
            previousDemand?.type ===
              "optimization" ||
            savedDemand.type ===
              "optimization"
          ) {
            try {
              await reloadOperations();
            } catch (refreshError) {
              // The demand update has already persisted. Keep its success
              // separate from a failed refresh of the derived operations view.
              setError(
                `A demanda foi salva, mas não foi possível atualizar o resumo operacional: ${refreshError.message || "falha ao carregar."}`
              );
            }
          }

          return savedDemand;
        } catch (error) {
          setError(
            error.message ||
              "Não foi possível atualizar a demanda."
          );

          throw error;
        }
      },
      [
        clientDemands,
        reloadOperations,
      ]
    );

  const removeClientDemand =
    useCallback(
      async (demandId) => {
        setError("");

        try {
          const previousDemand =
            clientDemands.find(
              (demand) =>
                demand.id ===
                demandId
            );

          const result =
            await deleteClientDemand(
              demandId
            );

          setClientDemands(
            (currentDemands) =>
              currentDemands.filter(
                (demand) =>
                  demand.id !==
                  demandId
              )
          );

          if (
            previousDemand?.type ===
            "optimization"
          ) {
            await reloadOperations();
          }

          return result;
        } catch (error) {
          setError(
            error.message ||
              "Não foi possível excluir a demanda."
          );

          throw error;
        }
      },
      [
        clientDemands,
        reloadOperations,
      ]
    );

  const updateGroupings =
    useCallback(
      async (arr) => {
        const previousGroupings =
          groupings;

        setGroupings(arr);
        setError("");

        try {
          const savedSettings =
            await updateSettings({
              groupings: arr,
            });

          setGroupings(
            savedSettings.groupings
          );

          return savedSettings.groupings;
        } catch (error) {
          setGroupings(
            previousGroupings
          );

          setError(
            error.message ||
              "Não foi possível salvar os agrupamentos."
          );

          throw error;
        }
      },
      [groupings]
    );

  return (
    <AppDataContext.Provider
      value={{
        accounts,
        clients,
        clientOperations,
        clientDemands,
        statuses,
        groupings,
        loading,
        error,

        refresh: load,
        refreshClientDemands,
        syncAccounts,
        updateClient,
        removeClient,
        saveClientOperation,
        addClientDemand,
        saveClientDemand,
        removeClientDemand,
        updateGroupings,

        getCachedInsights,
        fetchInsights,
        getCachedOverview,
        fetchOverview,
      }}
    >
      {children}
    </AppDataContext.Provider>
  );
}
