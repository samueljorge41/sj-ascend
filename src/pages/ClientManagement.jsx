import React, {
  useMemo,
  useState,
} from "react";

import { useSearchParams } from "react-router-dom";
import {
  Building2,
  CalendarDays,
  Check,
  ChevronLeft,
  ChevronRight,
  Clock3,
  FileText,
  GripVertical,
  Loader2,
  Pencil,
  Plus,
  Search,
  Sun,
  Sunrise,
  Trash2,
  X,
} from "lucide-react";

import { useAppData } from "@/components/AppDataProvider";
import { useToast } from "@/components/ui/use-toast";

const ORIGINS = [
  "Avaloon",
  "SJ Marketing",
];

const WEEK_DAYS = [
  "Seg",
  "Ter",
  "Qua",
  "Qui",
  "Sex",
  "Sáb",
  "Dom",
];

const DEMAND_TYPES = [
  {
    value: "optimization",
    label: "Otimização",
  },
  {
    value: "analysis",
    label: "Análise",
  },
  {
    value: "billing",
    label: "Envio de boleto",
  },
  {
    value: "balance_check",
    label: "Verificar saldo",
  },
  {
    value: "meeting",
    label: "Reunião",
  },
  {
    value: "creative",
    label: "Criativo",
  },
  {
    value: "report",
    label: "Relatório",
  },
  {
    value: "pending",
    label: "Pendência",
  },
  {
    value: "follow_up",
    label: "Follow-up",
  },
  {
    value: "other",
    label: "Outro",
  },
];

const DEMAND_STATUSES = [
  {
    value: "pending",
    label: "Pendente",
  },
  {
    value: "in_progress",
    label: "Em andamento",
  },
  {
    value: "completed",
    label: "Concluído",
  },
  {
    value: "not_done",
    label: "Não feito",
  },
];

const EMPTY_DEMAND_FORM = {
  title: "",
  type: "optimization",
  demand_date: "",
  observation: "",
  status: "pending",
};

function getOriginDotClass(origin) {
  if (origin === "Avaloon") {
    return "bg-orange-500";
  }

  if (origin === "SJ Marketing") {
    return "bg-blue-500";
  }

  return "bg-muted-foreground/40";
}

function getStatusDotClass(active) {
  return active
    ? "bg-emerald-500"
    : "bg-zinc-400 dark:bg-zinc-500";
}

function getDemandStatusClass(status) {
  if (status === "in_progress") {
    return "border-blue-500/30 bg-muted text-blue-700 dark:text-blue-400";
  }

  if (status === "completed") {
    return "border-emerald-500/30 bg-muted text-emerald-700 dark:text-emerald-400";
  }

  if (status === "not_done") {
    return "border-red-500/30 bg-muted text-red-700 dark:text-red-400";
  }

  return "border-border bg-muted text-muted-foreground";
}

function getDemandTypeLabel(type) {
  return (
    DEMAND_TYPES.find(
      (item) =>
        item.value === type
    )?.label || "Demanda"
  );
}

function getDemandStatusLabel(status) {
  return (
    DEMAND_STATUSES.find(
      (item) =>
        item.value === status
    )?.label || "Pendente"
  );
}

function capitalize(value) {
  if (!value) {
    return "";
  }

  return (
    value.charAt(0).toUpperCase() +
    value.slice(1)
  );
}

function parseDate(value) {
  if (!value) {
    return null;
  }

  const date = new Date(
    `${value}T12:00:00`
  );

  return Number.isNaN(
    date.getTime()
  )
    ? null
    : date;
}

function toDateString(date) {
  const year =
    date.getFullYear();

  const month =
    String(
      date.getMonth() + 1
    ).padStart(2, "0");

  const day =
    String(
      date.getDate()
    ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

function getDefaultBillingDate() {
  const today = new Date();

  return toDateString(
    new Date(
      today.getFullYear(),
      today.getMonth() + 1,
      1
    )
  );
}

function formatShortDate(value) {
  const date = parseDate(value);

  if (!date) {
    return "";
  }

  return new Intl.DateTimeFormat(
    "pt-BR",
    {
      day: "2-digit",
      month: "2-digit",
    }
  ).format(date);
}

function getDayDifference(value) {
  const date = parseDate(value);

  if (!date) {
    return null;
  }

  const today = new Date();

  today.setHours(
    0,
    0,
    0,
    0
  );

  date.setHours(
    0,
    0,
    0,
    0
  );

  return Math.round(
    (
      date.getTime() -
      today.getTime()
    ) /
      86400000
  );
}

function formatLastOptimization(
  value
) {
  const difference =
    getDayDifference(value);

  if (difference === null) {
    return "Não informada";
  }

  if (difference === 0) {
    return "Hoje";
  }

  if (difference === -1) {
    return "Ontem";
  }

  if (difference < -1) {
    return `Há ${Math.abs(
      difference
    )} dias - ${formatShortDate(
      value
    )}`;
  }

  return formatShortDate(value);
}

function getStartOfWeek(date) {
  const result =
    new Date(date);

  const weekDay =
    result.getDay();

  const adjustment =
    weekDay === 0
      ? -6
      : 1 - weekDay;

  result.setDate(
    result.getDate() +
      adjustment
  );

  result.setHours(
    0,
    0,
    0,
    0
  );

  return result;
}

function isSameWeek(
  firstDate,
  secondDate
) {
  return (
    getStartOfWeek(
      firstDate
    ).getTime() ===
    getStartOfWeek(
      secondDate
    ).getTime()
  );
}

function formatNextDemandDate(
  value
) {
  const date = parseDate(value);

  if (!date) {
    return "Sem demanda";
  }

  const difference =
    getDayDifference(value);

  if (difference === 0) {
    return "Hoje";
  }

  if (difference === 1) {
    return "Amanhã";
  }

  if (difference < 0) {
    const elapsed =
      Math.abs(difference);

    return elapsed === 1
      ? "Atrasada - ontem"
      : `Atrasada - há ${elapsed} dias`;
  }

  if (
    difference > 1 &&
    isSameWeek(
      date,
      new Date()
    )
  ) {
    const weekDay =
      capitalize(
        new Intl.DateTimeFormat(
          "pt-BR",
          {
            weekday: "long",
          }
        ).format(date)
      );

    return `Em ${difference} dias - ${weekDay}`;
  }

  return `Em ${difference} dias - ${formatShortDate(
    value
  )}`;
}

function getMonthLabel(date) {
  return capitalize(
    new Intl.DateTimeFormat(
      "pt-BR",
      {
        month: "long",
        year: "numeric",
      }
    ).format(date)
  );
}

function getCalendarDays(
  referenceDate
) {
  const year =
    referenceDate.getFullYear();

  const month =
    referenceDate.getMonth();

  const firstDay =
    new Date(
      year,
      month,
      1
    );

  const lastDay =
    new Date(
      year,
      month + 1,
      0
    );

  const previousMonthLastDay =
    new Date(
      year,
      month,
      0
    ).getDate();

  const leadingDays =
    (firstDay.getDay() + 6) % 7;

  const cells = [];

  for (
    let index =
      leadingDays - 1;
    index >= 0;
    index -= 1
  ) {
    cells.push({
      key:
        `previous-${index}`,

      day:
        previousMonthLastDay -
        index,

      currentMonth: false,

      date: new Date(
        year,
        month - 1,
        previousMonthLastDay -
          index
      ),
    });
  }

  for (
    let day = 1;
    day <= lastDay.getDate();
    day += 1
  ) {
    cells.push({
      key:
        `current-${day}`,

      day,
      currentMonth: true,

      date: new Date(
        year,
        month,
        day
      ),
    });
  }

  let nextMonthDay = 1;

  while (
    cells.length % 7 !== 0 ||
    cells.length < 42
  ) {
    cells.push({
      key:
        `next-${nextMonthDay}`,

      day: nextMonthDay,
      currentMonth: false,

      date: new Date(
        year,
        month + 1,
        nextMonthDay
      ),
    });

    nextMonthDay += 1;
  }

  return cells;
}

function isSameDay(
  firstDate,
  secondDate
) {
  return (
    firstDate.getFullYear() ===
      secondDate.getFullYear() &&
    firstDate.getMonth() ===
      secondDate.getMonth() &&
    firstDate.getDate() ===
      secondDate.getDate()
  );
}

function CompactInfo({
  icon: Icon,
  label,
  value,
  action,
  actionLabel,
}) {
  return (
    <div className="flex min-w-0 items-center gap-3 rounded-lg border bg-card px-3 py-2.5">
      <Icon className="h-4 w-4 shrink-0 text-muted-foreground" />

      <div className="min-w-0 flex-1">
        <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
          {label}
        </div>

        <div className="mt-0.5 truncate text-sm font-semibold">
          {value}
        </div>
      </div>

      {action && (
        <button
          type="button"
          onClick={action}
          aria-label={actionLabel}
          title={actionLabel}
          className="inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
        >
          <CalendarDays className="h-4 w-4" />
        </button>
      )}
    </div>
  );
}

export default function ClientManagement() {
  const [searchParams] = useSearchParams();
  const {
    clients,
    clientOperations,
    clientDemands,
    loading,
    addClientDemand,
    saveClientDemand,
    removeClientDemand,
  } = useAppData();

  const { toast } = useToast();

  const [
    selectedClient,
    setSelectedClient,
  ] = useState(null);

  const [
    demandModalOpen,
    setDemandModalOpen,
  ] = useState(false);

  const [
    editingDemand,
    setEditingDemand,
  ] = useState(null);

  const [
    demandForm,
    setDemandForm,
  ] = useState(
    EMPTY_DEMAND_FORM
  );

  const [
    savingDemand,
    setSavingDemand,
  ] = useState(false);

  const [
    deleteConfirmOpen,
    setDeleteConfirmOpen,
  ] = useState(false);

  const [
    draggedDemandId,
    setDraggedDemandId,
  ] = useState(null);

  const [
    movingDemand,
    setMovingDemand,
  ] = useState(false);

  const [
    billingEditorOpen,
    setBillingEditorOpen,
  ] = useState(false);
  const [
    billingDate,
    setBillingDate,
  ] = useState(
    getDefaultBillingDate()
  );

  const [
    savingBilling,
    setSavingBilling,
  ] = useState(false);


  const [
    searchTerm,
    setSearchTerm,
  ] = useState("");

  const [
    originFilter,
    setOriginFilter,
  ] = useState("all");

  const [
    statusFilter,
    setStatusFilter,
  ] = useState("active");

  const [
    quickView,
    setQuickView,
  ] = useState(searchParams.get("view") === "calendar" ? "calendar" : "all");

  const [
    calendarDate,
    setCalendarDate,
  ] = useState(
    new Date(
      new Date().getFullYear(),
      new Date().getMonth(),
      1
    )
  );

  const clientList =
    useMemo(() => {
      return Object.values(
        clients
      ).sort(
        (
          firstClient,
          secondClient
        ) =>
          String(
            firstClient.name ||
              ""
          ).localeCompare(
            String(
              secondClient.name ||
                ""
            ),
            "pt-BR"
          )
      );
    }, [clients]);

  const demandsByClient =
    useMemo(() => {
      const result = {};

      clientDemands.forEach(
        (demand) => {
          if (
            !result[
              demand.client_id
            ]
          ) {
            result[
              demand.client_id
            ] = [];
          }

          result[
            demand.client_id
          ].push(demand);
        }
      );

      return result;
    }, [clientDemands]);

  const todayString =
    toDateString(new Date());

  const tomorrowDate =
    new Date();

  tomorrowDate.setDate(
    tomorrowDate.getDate() + 1
  );

  const tomorrowString =
    toDateString(tomorrowDate);

  const clientsById =
    useMemo(() => {
      const result = {};

      clientList.forEach(
        (client) => {
          result[client.id] =
            client;
        }
      );

      return result;
    }, [clientList]);

  const filteredClients =
    useMemo(() => {
      const normalizedSearch =
        searchTerm
          .trim()
          .toLocaleLowerCase(
            "pt-BR"
          );

      return clientList.filter(
        (client) => {
          const matchesSearch =
            !normalizedSearch ||
            String(
              client.name || ""
            )
              .toLocaleLowerCase(
                "pt-BR"
              )
              .includes(
                normalizedSearch
              );

          const matchesOrigin =
            originFilter ===
              "all" ||
            client.origin ===
              originFilter;

          const matchesStatus =
            statusFilter ===
              "all" ||
            (statusFilter ===
              "active" &&
              Boolean(
                client.active
              )) ||
            (statusFilter ===
              "inactive" &&
              !Boolean(
                client.active
              ));

          const quickDate =
            quickView === "today"
              ? todayString
              : quickView ===
                  "tomorrow"
                ? tomorrowString
                : null;

          const matchesQuickView =
            !quickDate ||
            (
              demandsByClient[
                client.id
              ] || []
            ).some(
              (demand) =>
                demand.demand_date ===
                quickDate
            );

          return (
            matchesSearch &&
            matchesOrigin &&
            matchesStatus &&
            matchesQuickView
          );
        }
      );
    }, [
      clientList,
      demandsByClient,
      searchTerm,
      originFilter,
      statusFilter,
      quickView,
      todayString,
      tomorrowString,
    ]);

  const selectedClientIndex =
    selectedClient
      ? filteredClients.findIndex(
          (client) =>
            client.id ===
            selectedClient.id
        )
      : -1;

  const previousVisibleClient =
    selectedClientIndex > 0
      ? filteredClients[
          selectedClientIndex - 1
        ]
      : null;

  const nextVisibleClient =
    selectedClientIndex >= 0 &&
    selectedClientIndex <
      filteredClients.length - 1
      ? filteredClients[
          selectedClientIndex + 1
        ]
      : null;

  const selectedDemands =
    selectedClient
      ? demandsByClient[
          selectedClient.id
        ] || []
      : [];

  const selectedOperation =
    selectedClient
      ? clientOperations[
          selectedClient.id
        ]
      : null;


  const nextDemand =
    useMemo(() => {
      if (!selectedClient) {
        return null;
      }

      return (
        selectedDemands
          .filter(
            (demand) =>
              demand.status !==
                "completed" &&
              demand.status !==
                "not_done"
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
          )[0] || null
      );
    }, [
      selectedClient,
      selectedDemands,
    ]);

  const nextBillingDemand =
    useMemo(() => {
      return (
        selectedDemands
          .filter(
            (demand) =>
              demand.type ===
                "billing" &&
              demand.status !==
                "completed" &&
              demand.status !==
                "not_done"
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
              )
          )[0] || null
      );
    }, [selectedDemands]);
  const billingDisplay =
    nextBillingDemand
      ? formatNextDemandDate(
          nextBillingDemand
            .demand_date
        )
      : "Não configurado";


  const calendarDays =
    useMemo(
      () =>
        getCalendarDays(
          calendarDate
        ),
      [calendarDate]
    );

  const selectedDemandsByDate =
    useMemo(() => {
      const result = {};

      selectedDemands.forEach(
        (demand) => {
          if (
            !result[
              demand.demand_date
            ]
          ) {
            result[
              demand.demand_date
            ] = [];
          }

          result[
            demand.demand_date
          ].push(demand);
        }
      );

      return result;
    }, [selectedDemands]);

  const allDemandsByDate =
    useMemo(() => {
      const result = {};

      clientDemands.forEach(
        (demand) => {
          if (
            !result[
              demand.demand_date
            ]
          ) {
            result[
              demand.demand_date
            ] = [];
          }

          result[
            demand.demand_date
          ].push(demand);
        }
      );

      Object.values(
        result
      ).forEach((demands) => {
        demands.sort(
          (
            firstDemand,
            secondDemand
          ) =>
            firstDemand.client_id -
              secondDemand.client_id ||
            firstDemand.id -
              secondDemand.id
        );
      });

      return result;
    }, [clientDemands]);

  const activeClients =
    clientList.filter(
      (client) =>
        Boolean(client.active)
    ).length;

  const demandsToday =
    clientDemands.filter(
      (demand) =>
        demand.demand_date ===
          todayString &&
        demand.status !==
          "completed" &&
        demand.status !==
          "not_done"
    ).length;

  const hasFilters =
    Boolean(
      searchTerm.trim()
    ) ||
    originFilter !== "all" ||
    statusFilter !==
      "active" ||
    quickView !== "all";

  const resetFilters = () => {
    setSearchTerm("");
    setOriginFilter("all");
    setStatusFilter("active");
    setQuickView("all");
  };

  const toggleQuickView = (
    view
  ) => {
    setQuickView(
      (currentView) =>
        currentView === view
          ? "all"
          : view
    );
  };

  const openClient = (
    client
  ) => {
    setSelectedClient(client);

    const today =
      new Date();

    setCalendarDate(
      new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      )
    );
  };

  const navigateToClient =
    (client) => {
      if (
        !client ||
        savingDemand ||
        movingDemand ||
        savingBilling
      ) {
        return;
      }

      setBillingEditorOpen(false);

      setBillingDate(
        getDefaultBillingDate()
      );

      setSelectedClient(client);
    };

  const openGlobalDemand =
    (demand) => {
      const client =
        clientsById[
          demand.client_id
        ];

      if (!client) {
        return;
      }

      setSelectedClient(client);

      setEditingDemand(demand);

      setDemandForm({
        title:
          demand.title || "",

        type:
          demand.type ||
          "other",

        demand_date:
          demand.demand_date ||
          "",

        observation:
          demand.observation ||
          "",

        status:
          demand.status ||
          "pending",
      });
      setDeleteConfirmOpen(false);
      setDemandModalOpen(true);
    };

  const closeClient = () => {
    if (
      savingDemand ||
      movingDemand ||
      savingBilling
    ) {
      return;
    }

    setBillingEditorOpen(false);

    setBillingDate(
      getDefaultBillingDate()
    );

    setSelectedClient(null);
  };

  const openCreateDemand = (
    date
  ) => {
    setEditingDemand(null);

    setDemandForm({
      ...EMPTY_DEMAND_FORM,
      demand_date:
        toDateString(date),
    });

    setDeleteConfirmOpen(false);
    setDemandModalOpen(true);
  };

  const openEditDemand = (
    demand
  ) => {
    setEditingDemand(demand);

    setDemandForm({
      title:
        demand.title || "",

      type:
        demand.type ||
        "other",

      demand_date:
        demand.demand_date ||
        "",

      observation:
        demand.observation ||
        "",

      status:
        demand.status ||
        "pending",
    });

    setDeleteConfirmOpen(false);
    setDemandModalOpen(true);
  };

  const closeDemandModal = () => {
    if (savingDemand) {
      return;
    }

    setDemandModalOpen(false);
    setEditingDemand(null);
    setDemandForm(
      EMPTY_DEMAND_FORM
    );
    setDeleteConfirmOpen(false);
  };

  const handleSaveDemand =
    async (event) => {
      event.preventDefault();

      if (
        !selectedClient
      ) {
        return;
      }

      if (
        !demandForm.title.trim()
      ) {
        toast({
          variant: "warning",
          title:
            "Título obrigatório",
          description:
            "Informe o título da demanda.",
        });

        return;
      }

      if (
        !demandForm.demand_date
      ) {
        toast({
          variant: "warning",
          title:
            "Data obrigatória",
          description:
            "Informe a data da demanda.",
        });

        return;
      }

      setSavingDemand(true);

      try {
        if (editingDemand) {
          await saveClientDemand(
            editingDemand.id,
            {
              title:
                demandForm.title.trim(),

              type:
                demandForm.type,

              demand_date:
                demandForm.demand_date,

              observation:
                demandForm.observation.trim(),

              status:
                demandForm.status,
            }
          );

          toast({
            variant: "success",
            title:
              "Demanda atualizada",
            description:
              "As alterações foram salvas.",
          });
        } else {
          await addClientDemand({
            client_id:
              selectedClient.id,

            title:
              demandForm.title.trim(),

            type:
              demandForm.type,

            demand_date:
              demandForm.demand_date,

            observation:
              demandForm.observation.trim(),

            status:
              demandForm.status,
          });

          toast({
            variant: "success",
            title:
              "Demanda criada",
            description:
              "A demanda foi adicionada ao calendário.",
          });
        }

        closeDemandModal();
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível salvar",
          description:
            error.message ||
            "Ocorreu um erro ao salvar a demanda.",
        });
      } finally {
        setSavingDemand(false);
      }
    };

  const handleStatusChange =
    async (
      demand,
      nextStatus
    ) => {
      try {
        await saveClientDemand(
          demand.id,
          {
            status:
              nextStatus,
          }
        );

        toast({
          variant: "success",
          title:
            "Status atualizado",
          description:
            `"${demand.title}" foi atualizado.`,
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível atualizar",
          description:
            error.message ||
            "Ocorreu um erro ao alterar o status.",
        });
      }
    };

  const handleDeleteDemand =
    async () => {
      if (!editingDemand) {
        return;
      }

      setSavingDemand(true);

      try {
        await removeClientDemand(
          editingDemand.id
        );

        toast({
          variant: "success",
          title:
            "Demanda excluída",
          description:
            `"${editingDemand.title}" foi removida.`,
        });

        setDeleteConfirmOpen(false);
        setDemandModalOpen(false);
        setEditingDemand(null);
        setDemandForm(
          EMPTY_DEMAND_FORM
        );
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível excluir",
          description:
            error.message ||
            "Ocorreu um erro ao excluir a demanda.",
        });
      } finally {
        setSavingDemand(false);
      }
    };

  const handleDropDemand =
    async (date) => {
      if (
        !draggedDemandId
      ) {
        return;
      }

      const demand =
        clientDemands.find(
          (item) =>
            item.id ===
            draggedDemandId
        );

      setDraggedDemandId(null);

      if (!demand) {
        return;
      }

      const nextDate =
        toDateString(date);

      if (
        demand.demand_date ===
        nextDate
      ) {
        return;
      }

      setMovingDemand(true);

      try {
        await saveClientDemand(
          demand.id,
          {
            demand_date:
              nextDate,
          }
        );

        toast({
          variant: "success",
          title:
            "Demanda movida",
          description:
            `"${demand.title}" foi reagendada.`,
        });
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível mover",
          description:
            error.message ||
            "Ocorreu um erro ao reagendar a demanda.",
        });
      } finally {
        setMovingDemand(false);
      }
    };
  const toggleBillingEditor = () => {
    if (savingBilling) {
      return;
    }

    if (!billingEditorOpen) {
      setBillingDate(
        getDefaultBillingDate()
      );

      setBillingEditorOpen(true);
      return;
    }

    setBillingEditorOpen(false);
  };

  const cancelBillingEditor = () => {
    if (savingBilling) {
      return;
    }

    setBillingEditorOpen(false);

    setBillingDate(
      getDefaultBillingDate()
    );
  };

  const handleConfigureBilling =
    async () => {
      if (!selectedClient) {
        return;
      }

      if (!billingDate) {
        toast({
          variant: "warning",
          title: "Informe a data",
          description:
            "Selecione a data de envio do boleto.",
        });

        return;
      }

      setSavingBilling(true);

      try {
        await addClientDemand({
          client_id:
            selectedClient.id,

          title:
            "Envio de boleto",

          type:
            "billing",

          demand_date:
            billingDate,

          observation: "",

          status:
            "pending",
        });

        toast({
          variant: "success",
          title:
            "Boleto adicionado",
          description:
            "O envio de boleto foi adicionado ao calendário.",
        });

        setBillingEditorOpen(false);
        setBillingDate(
          getDefaultBillingDate()
        );
      } catch (error) {
        toast({
          variant: "destructive",
          title:
            "Não foi possível adicionar",
          description:
            error.message ||
            "Ocorreu um erro ao criar a demanda de boleto.",
        });
      } finally {
        setSavingBilling(false);
      }
    };

  const changeMonth = (
    amount
  ) => {
    setCalendarDate(
      (currentDate) =>
        new Date(
          currentDate.getFullYear(),
          currentDate.getMonth() +
            amount,
          1
        )
    );
  };

  const returnToToday = () => {
    const today =
      new Date();

    setCalendarDate(
      new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      )
    );
  };

  return (
    <div className="min-h-screen bg-background">
      <div className="mx-auto max-w-7xl px-4 py-6 sm:px-6 lg:px-8">
        <div className="flex flex-col gap-4 xl:flex-row xl:items-center xl:justify-between">
          <div className="flex items-center gap-5">
            <h1 className="text-2xl font-bold tracking-tight md:text-3xl">
              Gestão de Clientes
            </h1>

            <div className="hidden items-center gap-4 border-l pl-5 text-sm md:flex">
              <div>
                <span className="font-semibold">
                  {activeClients}
                </span>

                <span className="ml-1 text-muted-foreground">
                  clientes ativos
                </span>
              </div>

              <div>
                <span className="font-semibold">
                  {demandsToday}
                </span>

                <span className="ml-1 text-muted-foreground">
                  demandas hoje
                </span>
              </div>
            </div>
          </div>

          <div className="flex flex-wrap items-center gap-2">
            <div className="relative min-w-[210px] flex-1 xl:w-64 xl:flex-none">
              <Search className="pointer-events-none absolute left-3 top-1/2 h-4 w-4 -translate-y-1/2 text-muted-foreground" />

              <input
                type="text"
                value={searchTerm}
                onChange={(event) =>
                  setSearchTerm(
                    event.target.value
                  )
                }
                placeholder="Buscar cliente..."
                className="h-9 w-full rounded-md border border-input bg-background pl-9 pr-3 text-sm outline-none focus:ring-2 focus:ring-ring"
              />
            </div>

            <select
              value={originFilter}
              onChange={(event) =>
                setOriginFilter(
                  event.target.value
                )
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="all">
                Todas as origens
              </option>

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

            <select
              value={statusFilter}
              onChange={(event) =>
                setStatusFilter(
                  event.target.value
                )
              }
              className="h-9 rounded-md border border-input bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
            >
              <option value="active">
                Ativos
              </option>

              <option value="inactive">
                Inativos
              </option>

              <option value="all">
                Todos
              </option>
            </select>

            {hasFilters && (
              <button
                type="button"
                onClick={resetFilters}
                className="inline-flex h-9 items-center justify-center rounded-md border bg-background px-3 text-sm font-medium hover:bg-muted"
              >
                Limpar
              </button>
            )}
          </div>
        </div>

        <div className="mt-4 flex items-center gap-1.5 rounded-lg border bg-card p-1.5 shadow-sm">
          <button
            type="button"
            onClick={() =>
              toggleQuickView(
                "today"
              )
            }
            aria-label="Meu dia"
            title="Meu dia"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              quickView === "today"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Sun className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() =>
              toggleQuickView(
                "tomorrow"
              )
            }
            aria-label="Amanhã"
            title="Amanhã"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              quickView === "tomorrow"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <Sunrise className="h-4 w-4" />
          </button>

          <button
            type="button"
            onClick={() => {
              toggleQuickView(
                "calendar"
              );

              returnToToday();
            }}
            aria-label="Calendário geral"
            title="Calendário geral"
            className={`inline-flex h-9 w-9 items-center justify-center rounded-md transition-colors ${
              quickView === "calendar"
                ? "bg-primary text-primary-foreground"
                : "text-muted-foreground hover:bg-muted hover:text-foreground"
            }`}
          >
            <CalendarDays className="h-4 w-4" />
          </button>
        </div>

        {loading ? (
          <div className="mt-6 flex justify-center rounded-xl border bg-card py-20">
            <div className="h-8 w-8 animate-spin rounded-full border-4 border-muted border-t-primary" />
          </div>
        ) : quickView ===
          "calendar" ? (
          <section className="mt-6 overflow-hidden rounded-xl border bg-card shadow-sm">
            <div className="flex items-center justify-between border-b px-4 py-3">
              <div>
                <h2 className="text-sm font-semibold">
                  Calendário geral
                </h2>

                <p className="mt-0.5 text-xs text-muted-foreground">
                  Todas as demandas de todos os clientes.
                </p>
              </div>

              <div className="flex gap-1.5">
                <button
                  type="button"
                  onClick={returnToToday}
                  className="h-8 rounded-md border px-2.5 text-xs hover:bg-muted"
                >
                  Hoje
                </button>

                <button
                  type="button"
                  onClick={() =>
                    changeMonth(-1)
                  }
                  aria-label="Mês anterior"
                  title="Mês anterior"
                  className="h-8 w-8 rounded-md border hover:bg-muted"
                >
                  <ChevronLeft className="mx-auto h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    changeMonth(1)
                  }
                  aria-label="Próximo mês"
                  title="Próximo mês"
                  className="h-8 w-8 rounded-md border hover:bg-muted"
                >
                  <ChevronRight className="mx-auto h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="border-b px-4 py-2 text-sm font-semibold">
              {getMonthLabel(
                calendarDate
              )}
            </div>

            <div className="grid grid-cols-7 border-b bg-muted/30">
              {WEEK_DAYS.map(
                (weekDay) => (
                  <div
                    key={weekDay}
                    className="py-1.5 text-center text-[10px] font-medium uppercase text-muted-foreground"
                  >
                    {weekDay}
                  </div>
                )
              )}
            </div>

            <div className="grid grid-cols-7">
              {calendarDays.map(
                (calendarDay) => {
                  const dateString =
                    toDateString(
                      calendarDay.date
                    );

                  const dayDemands =
                    allDemandsByDate[
                      dateString
                    ] || [];

                  const today =
                    isSameDay(
                      calendarDay.date,
                      new Date()
                    );

                  return (
                    <div
                      key={
                        calendarDay.key
                      }
                      className={`min-h-[135px] border-b border-r p-1.5 ${
                        calendarDay.currentMonth
                          ? "bg-card"
                          : "bg-muted/40 dark:bg-muted/35"
                      }`}
                    >
                      <div className="flex items-center justify-between">
                        <span
                          className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[11px] ${
                            today
                              ? "bg-primary text-primary-foreground"
                              : calendarDay.currentMonth
                                ? ""
                                : "text-muted-foreground/50"
                          }`}
                        >
                          {
                            calendarDay.day
                          }
                        </span>

                        {dayDemands.length >
                          0 && (
                          <span className="text-[9px] text-muted-foreground">
                            {
                              dayDemands.length
                            }
                          </span>
                        )}
                      </div>

                      <div className="mt-1.5 space-y-1">
                        {dayDemands.map(
                          (demand) => {
                            const demandClient =
                              clientsById[
                                demand.client_id
                              ];

                            return (
                              <button
                                key={
                                  demand.id
                                }
                                type="button"
                                onClick={() =>
                                  openGlobalDemand(
                                    demand
                                  )
                                }
                                className={`w-full rounded-md border p-1.5 text-left shadow-sm transition-opacity hover:opacity-80 ${
                                  calendarDay.currentMonth
                                    ? "opacity-100"
                                    : "opacity-45 hover:opacity-80"
                                } ${getDemandStatusClass(
                                  demand.status
                                )}`}
                              >
                                <div className="truncate text-[9px] font-medium opacity-75">
                                  {demandClient
                                    ?.name ||
                                    "Cliente"}
                                </div>

                                <div className="line-clamp-2 text-[10px] font-semibold">
                                  {
                                    demand.title
                                  }
                                </div>
                              </button>
                            );
                          }
                        )}
                      </div>
                    </div>
                  );
                }
              )}
            </div>
          </section>
        ) : filteredClients.length ===
          0 ? (
          <div className="mt-6 rounded-xl border bg-card px-6 py-14 text-center">
            <Building2 className="mx-auto h-6 w-6 text-muted-foreground" />

            <h2 className="mt-3 font-semibold">
              Nenhum cliente encontrado
            </h2>
          </div>
        ) : (
          <div className="mt-6 grid gap-4 sm:grid-cols-2 xl:grid-cols-3">
            {filteredClients.map(
              (client) => {
                const demands =
                  demandsByClient[
                    client.id
                  ] || [];

                const next =
                  demands
                    .filter(
                      (demand) =>
                        demand.status !==
                          "completed" &&
                        demand.status !==
                          "not_done"
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
                    )[0];

                const logoInitial =
                  String(
                    client.name ||
                      "?"
                  )
                    .charAt(0)
                    .toUpperCase();

                return (
                  <button
                    key={client.id}
                    type="button"
                    onClick={() =>
                      openClient(
                        client
                      )
                    }
                    className="group rounded-xl border bg-card p-4 text-left shadow-sm transition-all hover:-translate-y-0.5 hover:border-primary/30 hover:shadow-md"
                  >
                    <div className="flex items-start gap-4">
                      <div className="flex h-16 w-16 shrink-0 items-center justify-center overflow-hidden rounded-xl border bg-muted">
                        {client.logo_url ? (
                          <img
                            src={
                              client.logo_url
                            }
                            alt=""
                            className="h-full w-full object-cover"
                          />
                        ) : (
                          <span className="text-xl font-semibold text-muted-foreground">
                            {
                              logoInitial
                            }
                          </span>
                        )}
                      </div>

                      <div className="min-w-0 flex-1">
                        <div className="flex items-center gap-2">
                          <span
                            title={
                              client.origin ||
                              "Sem origem"
                            }
                            aria-label={
                              client.origin ||
                              "Sem origem"
                            }
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${getOriginDotClass(
                              client.origin
                            )}`}
                          />

                          <span
                            title={
                              client.active
                                ? "Ativo"
                                : "Inativo"
                            }
                            aria-label={
                              client.active
                                ? "Ativo"
                                : "Inativo"
                            }
                            className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotClass(
                              client.active
                            )}`}
                          />

                          <h2 className="truncate font-semibold">
                            {client.name}
                          </h2>

                          <ChevronRight className="ml-auto h-4 w-4 shrink-0 text-muted-foreground transition-transform group-hover:translate-x-1" />
                        </div>

                        <div className="mt-4 border-t pt-3">
                          <div className="text-[10px] uppercase tracking-wide text-muted-foreground">
                            {next
                              ? `Próxima demanda: ${getDemandTypeLabel(
                                  next.type
                                )}`
                              : "Próxima demanda"}
                          </div>

                          <div className="mt-0.5 text-xs font-medium">
                            {next
                              ? formatNextDemandDate(
                                  next.demand_date
                                )
                              : "——"}
                          </div>
                        </div>
                      </div>
                    </div>
                  </button>
                );
              }
            )}
          </div>
        )}
      </div>

      {selectedClient && (
        <div
          className="fixed inset-0 z-50 flex items-center justify-center bg-black/55 p-2 sm:p-4"
          onMouseDown={closeClient}
        >
          <div
            onMouseDown={(event) =>
              event.stopPropagation()
            }
            className="flex max-h-[96vh] w-full max-w-6xl flex-col overflow-hidden rounded-xl border bg-background shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-5 py-3">
              <div className="flex min-w-0 items-center gap-3">
                <div className="flex h-11 w-11 shrink-0 items-center justify-center overflow-hidden rounded-lg border bg-muted">
                  {selectedClient.logo_url ? (
                    <img
                      src={
                        selectedClient.logo_url
                      }
                      alt=""
                      className="h-full w-full object-cover"
                    />
                  ) : (
                    <span className="text-base font-semibold text-muted-foreground">
                      {String(
                        selectedClient.name ||
                          "?"
                      )
                        .charAt(0)
                        .toUpperCase()}
                    </span>
                  )}
                </div>

                <div className="flex min-w-0 items-center gap-2">
                  <span
                    title={
                      selectedClient.origin ||
                      "Sem origem"
                    }
                    aria-label={
                      selectedClient.origin ||
                      "Sem origem"
                    }
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${getOriginDotClass(
                      selectedClient.origin
                    )}`}
                  />

                  <span
                    title={
                      selectedClient.active
                        ? "Ativo"
                        : "Inativo"
                    }
                    aria-label={
                      selectedClient.active
                        ? "Ativo"
                        : "Inativo"
                    }
                    className={`h-2.5 w-2.5 shrink-0 rounded-full ${getStatusDotClass(
                      selectedClient.active
                    )}`}
                  />

                  <h2 className="truncate text-lg font-semibold">
                    {selectedClient.name}
                  </h2>
                </div>
              </div>

              <div className="flex shrink-0 items-center gap-1">
                <button
                  type="button"
                  onClick={() =>
                    navigateToClient(
                      previousVisibleClient
                    )
                  }
                  disabled={
                    !previousVisibleClient ||
                    savingDemand ||
                    movingDemand ||
                    savingBilling
                  }
                  aria-label="Cliente anterior"
                  title={
                    previousVisibleClient
                      ? `Cliente anterior: ${previousVisibleClient.name}`
                      : "Não há cliente anterior"
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronLeft className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={() =>
                    navigateToClient(
                      nextVisibleClient
                    )
                  }
                  disabled={
                    !nextVisibleClient ||
                    savingDemand ||
                    movingDemand ||
                    savingBilling
                  }
                  aria-label="Próximo cliente"
                  title={
                    nextVisibleClient
                      ? `Próximo cliente: ${nextVisibleClient.name}`
                      : "Não há próximo cliente"
                  }
                  className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:cursor-not-allowed disabled:opacity-30"
                >
                  <ChevronRight className="h-4 w-4" />
                </button>

                <button
                  type="button"
                  onClick={closeClient}
                  aria-label="Fechar"
                  title="Fechar"
                  className="ml-1 inline-flex h-8 w-8 items-center justify-center rounded-md text-muted-foreground transition-colors hover:bg-muted hover:text-foreground"
                >
                  <X className="h-4 w-4" />
                </button>
              </div>
            </div>

            <div className="overflow-y-auto px-4 py-4 sm:px-5">
              <div className="grid gap-2 sm:grid-cols-3">
                <CompactInfo
                  icon={Clock3}
                  label="Última otimização"
                  value={formatLastOptimization(
                    selectedOperation
                      ?.last_optimization_date
                  )}
                />

                <CompactInfo
                  icon={CalendarDays}
                  label={
                    nextDemand
                      ? `Próxima demanda: ${getDemandTypeLabel(
                          nextDemand.type
                        )}`
                      : "Próxima demanda"
                  }
                  value={
                    nextDemand
                      ? formatNextDemandDate(
                          nextDemand.demand_date
                        )
                      : "Sem demanda"
                  }
                />

                <div className="relative flex min-w-0 items-center gap-2 rounded-lg border bg-card px-3 py-2.5">
                  <FileText className="h-4 w-4 shrink-0 text-muted-foreground" />

                  <div className="min-w-0 flex-1">
                    <div className="truncate text-[10px] font-medium uppercase tracking-wide text-muted-foreground">
                      Envio de boleto
                    </div>

                    <div className="mt-0.5 flex min-w-0 items-center gap-2">
                      {billingEditorOpen ? (
                        <input
                          type="date"
                          value={billingDate}
                          onChange={(event) =>
                            setBillingDate(
                              event.target.value
                            )
                          }
                          disabled={savingBilling}
                          className="h-7 min-w-0 flex-1 rounded-md border bg-background px-2 text-xs outline-none focus:ring-2 focus:ring-ring disabled:opacity-50"
                        />
                      ) : (
                        <div className="truncate text-sm font-semibold">
                          {billingDisplay}
                        </div>
                      )}
                    </div>
                  </div>

                  <div className="flex shrink-0 items-center gap-1">
                  {billingEditorOpen && (
                    <button
                      type="button"
                      onClick={
                        cancelBillingEditor
                      }
                      disabled={savingBilling}
                      aria-label="Cancelar configuração do boleto"
                      title="Cancelar"
                      className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-destructive disabled:opacity-50"
                    >
                      <X className="h-4 w-4" />
                    </button>
                  )}

                  <button
                    type="button"
                    onClick={
                      billingEditorOpen
                        ? handleConfigureBilling
                        : toggleBillingEditor
                    }
                    disabled={savingBilling}
                    aria-label={
                      billingEditorOpen
                        ? "Confirmar data de boleto"
                        : "Configurar data de boleto"
                    }
                    title={
                      billingEditorOpen
                        ? "Confirmar data"
                        : "Configurar data"
                    }
                    className="inline-flex h-8 w-8 items-center justify-center rounded-md border bg-background text-muted-foreground transition-colors hover:bg-muted hover:text-foreground disabled:opacity-50"
                  >
                    {savingBilling ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : billingEditorOpen ? (
                      <Check className="h-4 w-4 text-emerald-600 dark:text-emerald-400" />
                    ) : (
                      <CalendarDays className="h-4 w-4" />
                    )}
                  </button>
                </div>
                </div>
              </div>

              <section className="mt-4 overflow-hidden rounded-xl border bg-card">
                <div className="flex items-center justify-between border-b px-4 py-2.5">
                  <h3 className="text-sm font-semibold">
                    {getMonthLabel(
                      calendarDate
                    )}
                  </h3>

                  <div className="flex gap-1.5">
                    <button
                      type="button"
                      onClick={returnToToday}
                      className="h-8 rounded-md border px-2.5 text-xs hover:bg-muted"
                    >
                      Hoje
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        changeMonth(-1)
                      }
                      className="h-8 w-8 rounded-md border hover:bg-muted"
                    >
                      <ChevronLeft className="mx-auto h-4 w-4" />
                    </button>

                    <button
                      type="button"
                      onClick={() =>
                        changeMonth(1)
                      }
                      className="h-8 w-8 rounded-md border hover:bg-muted"
                    >
                      <ChevronRight className="mx-auto h-4 w-4" />
                    </button>
                  </div>
                </div>

                <div className="grid grid-cols-7 border-b bg-muted/30">
                  {WEEK_DAYS.map(
                    (weekDay) => (
                      <div
                        key={weekDay}
                        className="py-1.5 text-center text-[10px] font-medium uppercase text-muted-foreground"
                      >
                        {weekDay}
                      </div>
                    )
                  )}
                </div>

                <div className="grid grid-cols-7">
                  {calendarDays.map(
                    (calendarDay) => {
                      const dateString =
                        toDateString(
                          calendarDay.date
                        );

                      const dayDemands =
                        selectedDemandsByDate[
                          dateString
                        ] || [];

                      const today =
                        isSameDay(
                          calendarDay.date,
                          new Date()
                        );

                      return (
                        <div
                          key={
                            calendarDay.key
                          }
                          onDragOver={(event) =>
                            event.preventDefault()
                          }
                          onDrop={() =>
                            handleDropDemand(
                              calendarDay.date
                            )
                          }
                          className={`group min-h-[115px] border-b border-r p-1.5 transition-colors ${
                            calendarDay.currentMonth
                              ? "bg-card"
                              : "bg-muted/40 dark:bg-muted/35"
                          }`}
                        >
                          <div className="flex items-center justify-between">
                            <span
                              className={`inline-flex h-6 min-w-6 items-center justify-center rounded-full text-[11px] ${
                                today
                                  ? "bg-primary text-primary-foreground"
                                  : calendarDay.currentMonth
                                    ? ""
                                    : "text-muted-foreground/50"
                              }`}
                            >
                              {
                                calendarDay.day
                              }
                            </span>

                            <button
                              type="button"
                              onClick={() =>
                                openCreateDemand(
                                  calendarDay.date
                                )
                              }
                              className="inline-flex h-6 w-6 items-center justify-center rounded-md border opacity-0 hover:bg-primary hover:text-primary-foreground group-hover:opacity-100"
                            >
                              <Plus className="h-3.5 w-3.5" />
                            </button>
                          </div>

                          <div className="mt-1.5 space-y-1">
                            {dayDemands.map(
                              (demand) => (
                                <div
                                  key={
                                    demand.id
                                  }
                                  draggable
                                  onDragStart={() =>
                                    setDraggedDemandId(
                                      demand.id
                                    )
                                  }
                                  onDragEnd={() =>
                                    setDraggedDemandId(
                                      null
                                    )
                                  }
                                  className={`rounded-md border bg-background p-1.5 shadow-sm transition-opacity ${
                                    calendarDay.currentMonth
                                      ? "opacity-100"
                                      : "opacity-40 hover:opacity-80"
                                  }`}
                                >
                                  <button
                                    type="button"
                                    onClick={() =>
                                      openEditDemand(
                                        demand
                                      )
                                    }
                                    className="flex w-full items-start gap-1 text-left"
                                  >
                                    <GripVertical className="mt-0.5 h-3 w-3 shrink-0 text-muted-foreground" />

                                    <span className="line-clamp-2 text-[10px] font-medium">
                                      {
                                        demand.title
                                      }
                                    </span>
                                  </button>

                                  <select
                                    value={
                                      demand.status
                                    }
                                    onClick={(event) =>
                                      event.stopPropagation()
                                    }
                                    onChange={(event) =>
                                      handleStatusChange(
                                        demand,
                                        event.target.value
                                      )
                                    }
                                    className={`mt-1 h-5 w-full rounded border px-1 text-[9px] font-medium outline-none ${getDemandStatusClass(
                                      demand.status
                                    )}`}
                                  >
                                    {DEMAND_STATUSES.map(
                                      (status) => (
                                        <option
                                          key={
                                            status.value
                                          }
                                          value={
                                            status.value
                                          }
                                        >
                                          {
                                            status.label
                                          }
                                        </option>
                                      )
                                    )}
                                  </select>
                                </div>
                              )
                            )}
                          </div>
                        </div>
                      );
                    }
                  )}
                </div>
              </section>
            </div>
          </div>
        </div>
      )}

      {demandModalOpen && (
        <div
          className="fixed inset-0 z-[60] flex items-center justify-center bg-black/60 p-4"
          onMouseDown={
            closeDemandModal
          }
        >
          <div
            onMouseDown={(event) =>
              event.stopPropagation()
            }
            className="w-full max-w-lg rounded-xl border bg-card shadow-2xl"
          >
            <div className="flex items-center justify-between border-b px-6 py-4">
              <h2 className="text-lg font-semibold">
                {editingDemand
                  ? "Editar demanda"
                  : "Criar demanda"}
              </h2>

              <button
                type="button"
                onClick={
                  closeDemandModal
                }
                className="h-8 w-8 rounded-md hover:bg-muted"
              >
                <X className="mx-auto h-4 w-4" />
              </button>
            </div>

            <form
              onSubmit={
                handleSaveDemand
              }
            >
              <div className="space-y-4 px-6 py-5">
                <div>
                  <label className="text-sm font-medium">
                    Título
                  </label>

                  <input
                    value={
                      demandForm.title
                    }
                    onChange={(event) =>
                      setDemandForm(
                        (current) => ({
                          ...current,
                          title:
                            event.target.value,
                        })
                      )
                    }
                    autoFocus
                    className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                <div className="grid gap-4 sm:grid-cols-2">
                  <div>
                    <label className="text-sm font-medium">
                      Tipo
                    </label>

                    <select
                      value={
                        demandForm.type
                      }
                      onChange={(event) =>
                        setDemandForm(
                          (current) => ({
                            ...current,
                            type:
                              event.target.value,
                          })
                        )
                      }
                      className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      {DEMAND_TYPES.map(
                        (type) => (
                          <option
                            key={
                              type.value
                            }
                            value={
                              type.value
                            }
                          >
                            {type.label}
                          </option>
                        )
                      )}
                    </select>
                  </div>

                  <div>
                    <label className="text-sm font-medium">
                      Data
                    </label>

                    <input
                      type="date"
                      value={
                        demandForm.demand_date
                      }
                      onChange={(event) =>
                        setDemandForm(
                          (current) => ({
                            ...current,
                            demand_date:
                              event.target.value,
                          })
                        )
                      }
                      className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    />
                  </div>
                </div>

                {editingDemand && (
                  <div>
                    <label className="text-sm font-medium">
                      Status
                    </label>

                    <select
                      value={
                        demandForm.status
                      }
                      onChange={(event) =>
                        setDemandForm(
                          (current) => ({
                            ...current,
                            status:
                              event.target.value,
                          })
                        )
                      }
                      className="mt-2 h-10 w-full rounded-md border bg-background px-3 text-sm"
                    >
                      {DEMAND_STATUSES.map(
                        (status) => (
                          <option
                            key={
                              status.value
                            }
                            value={
                              status.value
                            }
                          >
                            {
                              status.label
                            }
                          </option>
                        )
                      )}
                    </select>
                  </div>
                )}

                <div>
                  <label className="text-sm font-medium">
                    Observação
                  </label>

                  <textarea
                    rows={4}
                    value={
                      demandForm.observation
                    }
                    onChange={(event) =>
                      setDemandForm(
                        (current) => ({
                          ...current,
                          observation:
                            event.target.value,
                        })
                      )
                    }
                    className="mt-2 w-full resize-none rounded-md border bg-background px-3 py-2 text-sm outline-none focus:ring-2 focus:ring-ring"
                  />
                </div>

                {deleteConfirmOpen && (
                  <div className="rounded-lg border border-destructive/30 bg-destructive/5 p-4">
                    <p className="text-sm">
                      Deseja realmente excluir esta demanda?
                    </p>

                    <div className="mt-3 flex gap-2">
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteConfirmOpen(
                            false
                          )
                        }
                        className="h-8 rounded-md border px-3 text-xs"
                      >
                        Cancelar
                      </button>

                      <button
                        type="button"
                        onClick={
                          handleDeleteDemand
                        }
                        className="h-8 rounded-md bg-destructive px-3 text-xs font-medium text-destructive-foreground"
                      >
                        Confirmar exclusão
                      </button>
                    </div>
                  </div>
                )}
              </div>

              <div className="flex justify-between border-t px-6 py-4">
                <div>
                  {editingDemand &&
                    !deleteConfirmOpen && (
                      <button
                        type="button"
                        onClick={() =>
                          setDeleteConfirmOpen(
                            true
                          )
                        }
                        className="inline-flex h-10 items-center gap-2 rounded-md border border-destructive/40 px-4 text-sm text-destructive hover:bg-destructive/10"
                      >
                        <Trash2 className="h-4 w-4" />

                        Excluir
                      </button>
                    )}
                </div>

                <div className="flex gap-3">
                  <button
                    type="button"
                    onClick={
                      closeDemandModal
                    }
                    className="h-10 rounded-md border px-4 text-sm hover:bg-muted"
                  >
                    Cancelar
                  </button>

                  <button
                    type="submit"
                    disabled={
                      savingDemand
                    }
                    className="inline-flex h-10 items-center gap-2 rounded-md bg-primary px-4 text-sm font-medium text-primary-foreground disabled:opacity-50"
                  >
                    {savingDemand ? (
                      <Loader2 className="h-4 w-4 animate-spin" />
                    ) : editingDemand ? (
                      <Pencil className="h-4 w-4" />
                    ) : (
                      <Plus className="h-4 w-4" />
                    )}

                    {editingDemand
                      ? "Salvar alterações"
                      : "Criar demanda"}
                  </button>
                </div>
              </div>
            </form>
          </div>
        </div>
      )}
    </div>
  );
}