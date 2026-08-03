import { createClientFromRequest } from 'npm:@base44/sdk@0.8.38';

// Métricas de "conversa iniciada" (Messenger, WhatsApp, Instagram DM)
const CONVERSATION_STARTED_TYPES = [
  'onsite_conversion.messaging_conversation_started_7d',
];

// Métricas de lead (formulário, conversão offsite, etc.)
const LEAD_TYPES = [
  'onsite_conversion.lead_grouped',
  'offsite_conversion.lead',
  'offsite_conversion.lead_complete',
  'leadgen',
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

async function fetchAll(accessToken, url) {
  let all = [];
  let next = url;
  let guard = 0;
  while (next && guard < 12) {
    guard++;
    const res = await fetch(next, { headers: { Authorization: `Bearer ${accessToken}` } });
    const data = await res.json();
    if (data.error) throw new Error(data.error.message);
    all = all.concat(data.data || []);
    next = (data.paging && data.paging.next) || null;
  }
  return all;
}

Deno.serve(async (req) => {
  try {
    const base44 = createClientFromRequest(req);
    const user = await base44.auth.me();
    if (!user) return Response.json({ error: 'Unauthorized' }, { status: 401 });

    const body = await req.json().catch(() => ({}));
    const action = body.action || 'accounts';

import { getMetaToken } from "../api/metaClient";
const accessToken = getMetaToken();    const apiBase = 'https://graph.facebook.com/v25.0';

    if (action === 'accounts') {
      const url = `${apiBase}/me/adaccounts?fields=account_id,name,currency,amount_spent&limit=100`;
      const data = await fetchAll(accessToken, url);
      return Response.json({
        accounts: data.map((a) => ({
          id: a.account_id,
          name: a.name,
          currency: a.currency || 'BRL',
        })),
      });
    }

    if (action === 'insights') {
      const accountId = body.account_id;
      const since = body.since;
      const until = body.until;
      if (!accountId) return Response.json({ error: 'account_id obrigatório' }, { status: 400 });
      if (!since || !until) return Response.json({ error: 'since e until obrigatórios' }, { status: 400 });

      const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
      const fields = 'spend,impressions,clicks,actions';

      // Série diária
      const dailyUrl = `${apiBase}/act_${accountId}/insights?fields=${fields}&time_increment=1&time_range=${timeRange}&limit=100`;
      const dailyRaw = await fetchAll(accessToken, dailyUrl);

      const daily = dailyRaw
        .map((d) => {
          const spend = Number(d.spend) || 0;
          const conv = sumActions(d.actions, CONVERSATION_STARTED_TYPES);
          const leads = conv + sumActions(d.actions, LEAD_TYPES);
          return {
            date: d.date_start,
            spend,
            impressions: Number(d.impressions) || 0,
            clicks: Number(d.clicks) || 0,
            conversations: conv,
            leads,
            cost_per_lead: leads > 0 ? spend / leads : 0,
          };
        })
        .sort((a, b) => a.date.localeCompare(b.date));

      // Breakdown por campanha
      const campUrl = `${apiBase}/act_${accountId}/insights?fields=${fields},campaign_name&level=campaign&time_range=${timeRange}&limit=200`;
      const campRaw = await fetchAll(accessToken, campUrl);

      const campaigns = campRaw
        .map((c) => {
          const spend = Number(c.spend) || 0;
          const conv = sumActions(c.actions, CONVERSATION_STARTED_TYPES);
          const leads = conv + sumActions(c.actions, LEAD_TYPES);
          return {
            name: c.campaign_name || 'Sem nome',
            spend,
            impressions: Number(c.impressions) || 0,
            clicks: Number(c.clicks) || 0,
            conversations: conv,
            leads,
            cost_per_lead: leads > 0 ? spend / leads : 0,
          };
        })
        .sort((a, b) => b.spend - a.spend);

      const totals = daily.reduce(
        (acc, d) => {
          acc.spend += d.spend;
          acc.impressions += d.impressions;
          acc.clicks += d.clicks;
          acc.conversations += d.conversations;
          acc.leads += d.leads;
          return acc;
        },
        { spend: 0, impressions: 0, clicks: 0, conversations: 0, leads: 0 }
      );
      totals.cost_per_lead = totals.leads > 0 ? totals.spend / totals.leads : 0;
      totals.ctr = totals.impressions > 0 ? (totals.clicks / totals.impressions) * 100 : 0;
      totals.cpm = totals.impressions > 0 ? (totals.spend / totals.impressions) * 1000 : 0;

      return Response.json({ daily, campaigns, totals });
    }

    if (action === 'statuses') {
      const accountIds = body.account_ids || [];
      const out = {};
      for (const id of accountIds) {
        try {
          const campUrl = `${apiBase}/act_${id}/campaigns?fields=effective_status&limit=200`;
          const camps = await fetchAll(accessToken, campUrl);
          const stList = camps.map((c) => c.effective_status);
          const hasActive = stList.includes('ACTIVE');
          const allCompleted = stList.length > 0 && stList.every((s) => s === 'COMPLETED');
          const accRes = await fetch(
            `${apiBase}/act_${id}?fields=spend_cap,amount_spent,currency,name`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const accData = await accRes.json();
          if (accData.error) throw new Error(accData.error.message);
          const balance = (Number(accData.spend_cap) - Number(accData.amount_spent)) / 100;
          let status = 'red';
          if (hasActive && balance <= 0) status = 'block';
          else if (hasActive) status = 'green';
          else if (allCompleted) status = 'blue';
          out[id] = { status, balance, has_active: hasActive, all_completed: allCompleted, currency: accData.currency || 'BRL' };
        } catch (e) {
          out[id] = { status: 'red', balance: 0, error: e.message };
        }
      }
      return Response.json({ statuses: out });
    }

    if (action === 'overview') {
      const accountIds = body.account_ids || [];
      const since = body.since;
      const until = body.until;
      if (!since || !until) return Response.json({ error: 'since e until obrigatórios' }, { status: 400 });
      const timeRange = encodeURIComponent(JSON.stringify({ since, until }));
      const fields = 'spend,impressions,clicks,actions';
      const out = [];
      for (const id of accountIds) {
        try {
          const insUrl = `${apiBase}/act_${id}/insights?fields=${fields}&time_range=${timeRange}&limit=1`;
          const insRaw = await fetchAll(accessToken, insUrl);
          const d = insRaw[0] || {};
          const spend = Number(d.spend) || 0;
          const conv = sumActions(d.actions, CONVERSATION_STARTED_TYPES);
          const leads = conv + sumActions(d.actions, LEAD_TYPES);
          const cost_per_lead = leads > 0 ? spend / leads : 0;
          const campUrl = `${apiBase}/act_${id}/campaigns?fields=effective_status&limit=200`;
          const camps = await fetchAll(accessToken, campUrl);
          const stList = camps.map((c) => c.effective_status);
          const hasActive = stList.includes('ACTIVE');
          const allCompleted = stList.length > 0 && stList.every((s) => s === 'COMPLETED');
          const accRes = await fetch(
            `${apiBase}/act_${id}?fields=spend_cap,amount_spent,currency,name`,
            { headers: { Authorization: `Bearer ${accessToken}` } }
          );
          const accData = await accRes.json();
          if (accData.error) throw new Error(accData.error.message);
          const balance = (Number(accData.spend_cap) - Number(accData.amount_spent)) / 100;
          let status = 'red';
          if (hasActive && balance <= 0) status = 'block';
          else if (hasActive) status = 'green';
          else if (allCompleted) status = 'blue';
          out.push({
            account_id: id,
            name: accData.name || '',
            currency: accData.currency || 'BRL',
            spend,
            conversations: conv,
            leads,
            cost_per_lead,
            balance,
            status,
          });
        } catch (e) {
          out.push({ account_id: id, name: '', spend: 0, conversations: 0, leads: 0, cost_per_lead: 0, balance: 0, status: 'red', error: e.message });
        }
      }
      return Response.json({ clients: out });
    }

    return Response.json({ error: 'ação inválida' }, { status: 400 });
  } catch (error) {
    return Response.json({ error: error.message }, { status: 500 });
  }
});