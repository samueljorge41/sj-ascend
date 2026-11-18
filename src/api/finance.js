const API = "/api/finance";

async function handleResponse(response) {
  const data = await response.json();
  if (!response.ok) throw new Error(data.error || "Não foi possível concluir a solicitação.");
  return data;
}

export async function getFinance(month) {
  const params = new URLSearchParams({ month });
  const data = await handleResponse(await fetch(`${API}?${params}`));
  return data.finance;
}

export async function createReceipt(receivableId, receipt) {
  const data = await handleResponse(await fetch(`${API}/${receivableId}/receipts`, {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(receipt),
  }));
  return data.receipt;
}

export async function updateReceipt(receiptId, receipt) {
  const data = await handleResponse(await fetch(`${API}/receipts/${receiptId}`, {
    method: "PATCH",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(receipt),
  }));
  return data.receipt;
}
