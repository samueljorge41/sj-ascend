const API = "/api";

export async function getRelationshipReport() {
  const response = await fetch(`${API}/relationship-reports`);
  const data = await response.json();

  if (!response.ok) {
    throw new Error(data.error || "Não foi possível carregar o relatório.");
  }

  return data.report;
}
