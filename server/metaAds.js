import express from "express";
import db from "./database/db.js";

const router = express.Router();

function normalizeAccountId(accountId) {
  return String(accountId || "").replace(/^act_/, "");
}

function metaAccountPath(accountId) {
  return `act_${normalizeAccountId(accountId)}`;
}

function getOverviewCache(accountId, since, until) {
  return db
    .prepare(`
      SELECT
        account_id,
        name,
        currency,
        spend,
        conversations,
        leads,
        cost_per_lead,
        balance,
        balance_known,
        is_prepay_account,
        status,
        updated_at
      FROM overview_cache
      WHERE
        account_id = ?
        AND since = ?
        AND until = ?
    `)
    .get(
      String(accountId),
      String(since),
      String(until)
    );
}

function saveOverviewCache(
  accountId,
  since,
  until,
  clientData
) {
  db.prepare(`
    INSERT INTO overview_cache (
      account_id,
      since,
      until,
      name,
      currency,
      spend,
      conversations,
      leads,
      cost_per_lead,
      balance,
      balance_known,
      is_prepay_account,
      status,
      updated_at
    )
    VALUES (
      ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?,
      CURRENT_TIMESTAMP
    )

    ON CONFLICT(account_id, since, until)
    DO UPDATE SET
      name = excluded.name,
      currency = excluded.currency,
      spend = excluded.spend,
      conversations = excluded.conversations,
      leads = excluded.leads,
      cost_per_lead = excluded.cost_per_lead,
      balance = excluded.balance,
      balance_known = excluded.balance_known,
      is_prepay_account = excluded.is_prepay_account,
      status = excluded.status,
      updated_at = CURRENT_TIMESTAMP
  `).run(
    String(accountId),
    String(since),
    String(until),
    String(clientData.name || ""),
    String(clientData.currency || "BRL"),
    Number(clientData.spend) || 0,
    Number(clientData.conversations) || 0,
    Number(clientData.leads) || 0,
    Number(clientData.cost_per_lead) || 0,
    Number(clientData.balance) || 0,
    clientData.balance_known ? 1 : 0,
    clientData.is_prepay_account ? 1 : 0,
    String(clientData.status || "red")
  );

  return getOverviewCache(
    accountId,
    since,
    until
  );
}

function formatCachedOverviewClient(cacheRecord) {
  return {
    account_id: cacheRecord.account_id,
    name: cacheRecord.name,
    currency: cacheRecord.currency,
    spend: Number(cacheRecord.spend) || 0,
    conversations:
      Number(cacheRecord.conversations) || 0,
    leads: Number(cacheRecord.leads) || 0,
    cost_per_lead:
      Number(cacheRecord.cost_per_lead) || 0,
    balance: Number(cacheRecord.balance) || 0,
    balance_known:
      cacheRecord.balance_known !== 0,
    is_prepay_account:
      cacheRecord.is_prepay_account === 1,
    status: cacheRecord.status || "red",
    updated_at: cacheRecord.updated_at,
    from_cache: true,
  };
}

const PAYMENT_METHODS = new Set([
  "auto",
  "prepaid",
  "credit_card",
  "other",
  "unknown",
]);

function getPaymentMethodSetting(accountId) {
  const normalizedId = normalizeAccountId(accountId);
  const registeredClient = db
    .prepare(`
      SELECT payment_method
      FROM clients
      WHERE REPLACE(account_id, 'act_', '') = ?
      LIMIT 1
    `)
    .get(normalizedId);

  const setting = registeredClient?.payment_method;

  return PAYMENT_METHODS.has(setting)
    ? setting
    : "auto";
}

function applyPaymentMethod(client, setting) {
  const paymentMethod =
    setting === "auto"
      ? client.is_prepay_account
        ? "prepaid"
        : "unknown"
      : setting;

  const hasActiveCampaigns =
    client.status === "green" ||
    client.status === "block";

  let status = client.status;

  if (hasActiveCampaigns) {
    status =
      paymentMethod === "prepaid" &&
      client.balance_known &&
      Number(client.balance) <= 0
        ? "block"
        : "green";
  }

  return {
    ...client,
    payment_method: paymentMethod,
    payment_method_setting: setting,
    status,
  };
}

async function fetchOverviewAccount(
  token,
  apiBase,
  metaAccount
) {
  const accountUrl =
    `${apiBase}/${metaAccount}?fields=`;
  const headers = {
    Authorization: `Bearer ${token}`,
  };

  const response = await fetch(
    `${accountUrl}spend_cap,amount_spent,currency,name,is_prepay_account`,
    { headers }
  );
  const account = await response.json();

  if (
    response.ok &&
    !account.error
  ) {
    return account;
  }

  const errorMessage = String(
    account.error?.message || ""
  );

  if (
    account.error?.code !== 100 ||
    !errorMessage.toLowerCase().includes(
      "is_prepay_account"
    )
  ) {
    throw new Error(
      errorMessage ||
        "NÃ£o foi possÃ­vel buscar os dados da conta."
    );
  }

  const fallbackResponse = await fetch(
    `${accountUrl}spend_cap,amount_spent,currency,name`,
    { headers }
  );
  const fallbackAccount =
    await fallbackResponse.json();

  if (
    !fallbackResponse.ok ||
    fallbackAccount.error
  ) {
    throw new Error(
      fallbackAccount.error?.message ||
        "NÃ£o foi possÃ­vel buscar os dados da conta."
    );
  }

  return fallbackAccount;
}

const CONVERSATION_STARTED_TYPES = [
  "onsite_conversion.messaging_conversation_started_7d",
];

const LEAD_TYPES = [
  "onsite_conversion.lead_grouped",
  "offsite_conversion.lead",
  "offsite_conversion.lead_complete",
  "leadgen",
];

function sumActions(actions, types) {
  if (!Array.isArray(actions)) return 0;

  let total = 0;

  for (const a of actions) {
    if (types.includes(a.action_type)) {
      total += Number(a.value) || 0;
    }
  }

  return total;
}

router.get("/accounts", async (req, res) => {

    try {

        const token = process.env.META_ACCESS_TOKEN;

        const response = await fetch(
            "https://graph.facebook.com/v25.0/me/adaccounts?fields=account_id,name,currency",
            {
                headers: {
                    Authorization: `Bearer ${token}`
                }
            }
        );

        const data = await response.json();

        if (data.error) {

            return res.status(400).json(data);

        }

        res.json(data);

    } catch (err) {

        res.status(500).json({
            error: err.message
        });

    }

});

async function fetchAll(accessToken, url) {
  let all = [];
  let next = url;
  let guard = 0;

  while (next && guard < 12) {
    guard++;

    const response = await fetch(next, {
      headers: {
        Authorization: `Bearer ${accessToken}`,
      },
    });

    const data = await response.json();

    if (data.error) {
      throw new Error(data.error.message);
    }

    all.push(...(data.data || []));

    next = data.paging?.next || null;
  }

  return all;
}

router.post("/statuses", async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;

    const { account_ids } = req.body;

    const apiBase = "https://graph.facebook.com/v25.0";

    const statuses = {};

    for (const id of account_ids) {
      try {
        const campaigns = await fetchAll(
          token,
          `${apiBase}/${metaAccountPath(id)}/campaigns?fields=effective_status&limit=200`
        );

        const stList = campaigns.map((c) => c.effective_status);

        const hasActive = stList.includes("ACTIVE");

        const allCompleted =
          stList.length > 0 &&
          stList.every((s) => s === "COMPLETED");

        const accRes = await fetch(
          `${apiBase}/${metaAccountPath(id)}?fields=spend_cap,amount_spent,currency,name`,
          {
            headers: {
              Authorization: `Bearer ${token}`,
            },
          }
        );

        const acc = await accRes.json();

        const balance =
          (Number(acc.spend_cap) - Number(acc.amount_spent)) / 100;

        let status = "red";

        if (hasActive && balance <= 0)
          status = "block";
        else if (hasActive)
          status = "green";
        else if (allCompleted)
          status = "blue";

        statuses[id] = {
          status,
          balance,
          currency: acc.currency,
        };
      } catch (e) {
        statuses[id] = {
          status: "red",
          balance: 0,
        };
      }
    }

    res.json({
      statuses,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

router.post("/insights", async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const apiBase = "https://graph.facebook.com/v25.0";

    const { account_id, since, until } = req.body;
    const metaAccount = metaAccountPath(account_id);

    if (!account_id) {
      return res.status(400).json({
        error: "account_id obrigatório",
      });
    }

    if (!since || !until) {
      return res.status(400).json({
        error: "since e until obrigatórios",
      });
    }

    const timeRange = encodeURIComponent(
      JSON.stringify({
        since,
        until,
      })
    );

    const fields = "spend,impressions,clicks,actions";

    // Diário

    const dailyRaw = await fetchAll(
      token,
     `${apiBase}/${metaAccount}/insights?fields=${fields}&time_increment=1&time_range=${timeRange}&limit=100`
    );

    const daily = dailyRaw
      .map((d) => {
        const spend = Number(d.spend) || 0;

        const conversations = sumActions(
          d.actions,
          CONVERSATION_STARTED_TYPES
        );

        const leads =
          conversations +
          sumActions(d.actions, LEAD_TYPES);

        return {
          date: d.date_start,
          spend,
          impressions: Number(d.impressions) || 0,
          clicks: Number(d.clicks) || 0,
          conversations,
          leads,
          cost_per_lead:
            leads > 0 ? spend / leads : 0,
        };
      })
      .sort((a, b) => a.date.localeCompare(b.date));

    // Campanhas

    const campaignRaw = await fetchAll(
      token,
      `${apiBase}/${metaAccount}/insights?fields=${fields},campaign_name&level=campaign&time_range=${timeRange}&limit=200`
    );

    const campaigns = campaignRaw
      .map((c) => {
        const spend = Number(c.spend) || 0;

        const conversations = sumActions(
          c.actions,
          CONVERSATION_STARTED_TYPES
        );

        const leads =
          conversations +
          sumActions(c.actions, LEAD_TYPES);

        return {
          name: c.campaign_name || "Sem nome",
          spend,
          impressions: Number(c.impressions) || 0,
          clicks: Number(c.clicks) || 0,
          conversations,
          leads,
          cost_per_lead:
            leads > 0 ? spend / leads : 0,
        };
      })
      .sort((a, b) => b.spend - a.spend);

    const totals = daily.reduce(
      (acc, item) => {
        acc.spend += item.spend;
        acc.impressions += item.impressions;
        acc.clicks += item.clicks;
        acc.conversations += item.conversations;
        acc.leads += item.leads;

        return acc;
      },
      {
        spend: 0,
        impressions: 0,
        clicks: 0,
        conversations: 0,
        leads: 0,
      }
    );

    totals.cost_per_lead =
      totals.leads > 0
        ? totals.spend / totals.leads
        : 0;

    totals.ctr =
      totals.impressions > 0
        ? (totals.clicks / totals.impressions) * 100
        : 0;

    totals.cpm =
      totals.impressions > 0
        ? (totals.spend / totals.impressions) * 1000
        : 0;

    res.json({
      daily,
      campaigns,
      totals,
    });
  } catch (err) {
    res.status(500).json({
      error: err.message,
    });
  }
});

router.post("/overview", async (req, res) => {
  try {
    const token = process.env.META_ACCESS_TOKEN;
    const apiBase =
      "https://graph.facebook.com/v25.0";

    const {
      account_ids,
      since,
      until,
      force_refresh = false,
    } = req.body;

    if (!Array.isArray(account_ids)) {
      return res.status(400).json({
        error: "account_ids deve ser uma lista.",
      });
    }

    if (!since || !until) {
      return res.status(400).json({
        error: "since e until obrigatórios",
      });
    }

    const timeRange = encodeURIComponent(
      JSON.stringify({
        since,
        until,
      })
    );

    const fields =
      "spend,impressions,clicks,actions";

    const clients = [];

    for (const id of account_ids) {
      try {
        const paymentMethodSetting =
          getPaymentMethodSetting(id);

        /*
         * Primeiro procura no SQLite.
         *
         * Quando force_refresh for false e existir cache,
         * nenhuma chamada à Meta será feita para essa conta.
         */
        if (!force_refresh) {
          const cached = getOverviewCache(
            id,
            since,
            until
          );

          if (cached) {
            clients.push(
              applyPaymentMethod(
                formatCachedOverviewClient(cached),
                paymentMethodSetting
              )
            );

            continue;
          }
        }

        /*
         * Não existe cache ou foi solicitada
         * uma atualização forçada.
         */
        const metaAccount = metaAccountPath(id);

        const insights = await fetchAll(
          token,
          `${apiBase}/${metaAccount}/insights?fields=${fields}&time_range=${timeRange}&limit=1`
        );

        const insight = insights[0] || {};

        const spend =
          Number(insight.spend) || 0;

        const conversations = sumActions(
          insight.actions,
          CONVERSATION_STARTED_TYPES
        );

        const leads =
          conversations +
          sumActions(
            insight.actions,
            LEAD_TYPES
          );

        const costPerLead =
          leads > 0
            ? spend / leads
            : 0;

        const campaigns = await fetchAll(
          token,
          `${apiBase}/${metaAccount}/campaigns?fields=effective_status&limit=200`
        );

        const campaignStatuses = campaigns.map(
          (campaign) =>
            campaign.effective_status
        );

        const hasActive =
          campaignStatuses.includes("ACTIVE");

        const allCompleted =
          campaignStatuses.length > 0 &&
          campaignStatuses.every(
            (status) =>
              status === "COMPLETED"
          );

        const account =
          await fetchOverviewAccount(
            token,
            apiBase,
            metaAccount
          );

        /*
         * Algumas contas podem não possuir spend_cap.
         * Nesses casos, usamos zero para evitar NaN.
         */
        const spendCap =
          Number(account.spend_cap) || 0;

        const amountSpent =
          Number(account.amount_spent) || 0;

        const balance =
          spendCap > 0
            ? (spendCap - amountSpent) / 100
            : 0;

        let status = "red";

        if (hasActive && balance <= 0) {
          status = "block";
        } else if (hasActive) {
          status = "green";
        } else if (allCompleted) {
          status = "blue";
        }

        const freshClient = {
          account_id: id,
          name: account.name || "",
          currency:
            account.currency || "BRL",
          spend,
          conversations,
          leads,
          cost_per_lead: costPerLead,
          balance,
          balance_known: spendCap > 0,
          is_prepay_account:
            account.is_prepay_account === true ||
            account.is_prepay_account === 1 ||
            account.is_prepay_account === "1",
          status,
        };

        /*
         * Salva ou substitui o cache deste:
         * cliente + período.
         */
        const savedCache =
          saveOverviewCache(
            id,
            since,
            until,
            freshClient
          );

        clients.push(
          applyPaymentMethod(
            {
              ...formatCachedOverviewClient(
                savedCache
              ),
              from_cache: false,
            },
            paymentMethodSetting
          )
        );
      } catch (error) {
        console.error(
          `Erro no overview da conta ${id}:`,
          error
        );

        /*
         * Se a atualização da Meta falhar, tentamos
         * usar um cache já existente como fallback.
         */
        const fallbackCache =
          getOverviewCache(
            id,
            since,
            until
          );

        if (fallbackCache) {
          clients.push(
            applyPaymentMethod(
              {
                ...formatCachedOverviewClient(
                  fallbackCache
                ),
                stale: true,
                error: error.message,
              },
              paymentMethodSetting
            )
          );

          continue;
        }

        clients.push(
          applyPaymentMethod(
            {
              account_id: id,
              name: "",
              currency: "BRL",
              spend: 0,
              conversations: 0,
              leads: 0,
              cost_per_lead: 0,
              balance: 0,
              balance_known: false,
              is_prepay_account: false,
              status: "red",
              updated_at: null,
              from_cache: false,
              error: error.message,
            },
            paymentMethodSetting
          )
        );
      }
    }

    res.json({
      clients,
      period: {
        since,
        until,
      },
    });
  } catch (error) {
    console.error(
      "Erro geral no overview:",
      error
    );

    res.status(500).json({
      error:
        error.message ||
        "Não foi possível carregar o overview.",
    });
  }
});


export default router;
