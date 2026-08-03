export const DATE_RANGES = [
  {
    value: "today",
    label: "Hoje",
  },
  {
    value: "yesterday",
    label: "Ontem",
  },
  {
    value: "this_month",
    label: "Este mês",
  },
  {
    value: "last_month",
    label: "Mês passado",
  },
  {
    value: "last_7_days",
    label: "Últimos 7 dias",
  },
  {
    value: "last_14_days",
    label: "Últimos 14 dias",
  },
  {
    value: "last_30_days",
    label: "Últimos 30 dias",
  },
  {
    value: "last_90_days",
    label: "Últimos 90 dias",
  },
  {
    value: "custom",
    label: "Período personalizado",
  },
];

export function formatLocalDate(date) {
  const year = date.getFullYear();

  const month = String(
    date.getMonth() + 1
  ).padStart(2, "0");

  const day = String(
    date.getDate()
  ).padStart(2, "0");

  return `${year}-${month}-${day}`;
}

export function todayStr() {
  return formatLocalDate(new Date());
}

export function daysAgoStr(numberOfDays) {
  const date = new Date();

  date.setDate(
    date.getDate() - numberOfDays
  );

  return formatLocalDate(date);
}

export function getDateRange(range) {
  const today = new Date();

  switch (range) {
    case "today": {
      const date = formatLocalDate(today);

      return {
        since: date,
        until: date,
      };
    }

    case "yesterday": {
      const yesterday = new Date(today);

      yesterday.setDate(
        yesterday.getDate() - 1
      );

      const date =
        formatLocalDate(yesterday);

      return {
        since: date,
        until: date,
      };
    }

    case "this_month": {
      const firstDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        1
      );

      return {
        since:
          formatLocalDate(firstDay),
        until:
          formatLocalDate(today),
      };
    }

    case "last_month": {
      const firstDay = new Date(
        today.getFullYear(),
        today.getMonth() - 1,
        1
      );

      const lastDay = new Date(
        today.getFullYear(),
        today.getMonth(),
        0
      );

      return {
        since:
          formatLocalDate(firstDay),
        until:
          formatLocalDate(lastDay),
      };
    }

    case "last_7_days":
      return rangeForDays(7);

    case "last_14_days":
      return rangeForDays(14);

    case "last_30_days":
      return rangeForDays(30);

    case "last_90_days":
      return rangeForDays(90);

    default:
      return rangeForDays(30);
  }
}

function rangeForDays(numberOfDays) {
  const until = new Date();
  const since = new Date();

  since.setDate(
    until.getDate() -
      (numberOfDays - 1)
  );

  return {
    since: formatLocalDate(since),
    until: formatLocalDate(until),
  };
}