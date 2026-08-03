const API = "/meta";

export async function getAccounts() {
  const res = await fetch(`${API}/accounts`);
  return res.json();
}

export async function getStatuses(account_ids) {
  const res = await fetch(`${API}/statuses`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({ account_ids }),
  });

  return res.json();
}

export async function getInsights(account_id, since, until) {
  const res = await fetch(`${API}/insights`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
    },
    body: JSON.stringify({
      account_id,
      since,
      until,
    }),
  });

  return res.json();
}

export async function getOverview(
  accountIds,
  since,
  until,
  forceRefresh = false
) {
  const response = await fetch(
    `${API}/overview`,
    {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
      },
      body: JSON.stringify({
        account_ids: accountIds,
        since,
        until,
        force_refresh: forceRefresh,
      }),
    }
  );

  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Não foi possível carregar o overview."
    );
  }

  return data;
}