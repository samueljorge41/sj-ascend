export function removeGoogleMapsLinks(notes) {
  return String(notes || "")
    .replace(/\s*Google Maps:\s*https?:\/\/\S+/gi, "")
    .replace(/\s*https?:\/\/(?:www\.)?(?:maps\.)?google\.[^\s/]+\/maps\/\S*/gi, "")
    .replace(/[ \t]{2,}/g, " ")
    .replace(/\s+\./g, ".")
    .trim();
}
