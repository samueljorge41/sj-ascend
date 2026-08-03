const API = "/api";

async function handleResponse(response) {
  const data = await response.json();

  if (!response.ok) {
    throw new Error(
      data.error ||
        "Erro na requisição."
    );
  }

  return data;
}

export async function getClients() {
  const response = await fetch(
    `${API}/clients`
  );

  const data =
    await handleResponse(
      response
    );

  return data.clients || [];
}

export async function getMetaAccounts() {
  const response = await fetch(
    `${API}/clients/meta-accounts`
  );

  const data =
    await handleResponse(
      response
    );

  return data.accounts || [];
}

export async function createClient(
  client
) {
  const response = await fetch(
    `${API}/clients`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(
        client
      ),
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.client;
}

export async function updateClientById(
  id,
  patch
) {
  const response = await fetch(
    `${API}/clients/${id}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(
        patch
      ),
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.client;
}

export async function uploadClientLogo(
  id,
  file
) {
  const formData =
    new FormData();

  formData.append(
    "logo",
    file
  );

  const response = await fetch(
    `${API}/clients/${id}/logo`,
    {
      method: "POST",
      body: formData,
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.client;
}

export async function removeClientLogo(
  id
) {
  const response = await fetch(
    `${API}/clients/${id}/logo`,
    {
      method: "DELETE",
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.client;
}

export async function deleteClientById(
  id
) {
  const response = await fetch(
    `${API}/clients/${id}`,
    {
      method: "DELETE",
    }
  );

  return handleResponse(
    response
  );
}


export async function getClientOperations() {
  const response = await fetch(
    `${API}/client-operations`
  );

  const data =
    await handleResponse(
      response
    );

  return data.operations || [];
}

export async function getClientOperation(
  clientId
) {
  const response = await fetch(
    `${API}/client-operations/${clientId}`
  );

  const data =
    await handleResponse(
      response
    );

  return data.operation;
}

export async function updateClientOperation(
  clientId,
  patch
) {
  const response = await fetch(
    `${API}/client-operations/${clientId}`,
    {
      method: "PUT",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(
        patch
      ),
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.operation;
}

export async function getClientDemands(
  filters = {}
) {
  const searchParams =
    new URLSearchParams();

  if (filters.client_id) {
    searchParams.set(
      "client_id",
      String(filters.client_id)
    );
  }

  if (filters.from) {
    searchParams.set(
      "from",
      filters.from
    );
  }

  if (filters.until) {
    searchParams.set(
      "until",
      filters.until
    );
  }

  const query =
    searchParams.toString();

  const response = await fetch(
    `${API}/client-demands${
      query
        ? `?${query}`
        : ""
    }`
  );

  const data =
    await handleResponse(
      response
    );

  return data.demands || [];
}

export async function getClientDemand(
  demandId
) {
  const response = await fetch(
    `${API}/client-demands/${demandId}`
  );

  const data =
    await handleResponse(
      response
    );

  return data.demand;
}

export async function createClientDemand(
  demand
) {
  const response = await fetch(
    `${API}/client-demands`,
    {
      method: "POST",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(
        demand
      ),
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.demand;
}

export async function updateClientDemand(
  demandId,
  patch
) {
  const response = await fetch(
    `${API}/client-demands/${demandId}`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(
        patch
      ),
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.demand;
}

export async function deleteClientDemand(
  demandId
) {
  const response = await fetch(
    `${API}/client-demands/${demandId}`,
    {
      method: "DELETE",
    }
  );

  return handleResponse(
    response
  );
}

export async function syncClients() {
  const response = await fetch(
    `${API}/clients/sync`,
    {
      method: "POST",
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data;
}

export async function getSettings() {
  const response = await fetch(
    `${API}/settings`
  );

  const data =
    await handleResponse(
      response
    );

  return data.settings;
}

export async function updateSettings(
  patch
) {
  const response = await fetch(
    `${API}/settings`,
    {
      method: "PATCH",
      headers: {
        "Content-Type":
          "application/json",
      },
      body: JSON.stringify(
        patch
      ),
    }
  );

  const data =
    await handleResponse(
      response
    );

  return data.settings;
}