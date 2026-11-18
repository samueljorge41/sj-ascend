import test from "node:test";
import assert from "node:assert/strict";
import { removeGoogleMapsLinks } from "./acquisitionNotes.js";

test("removes a labeled Google Maps URL while preserving prospect notes", () => {
  const notes = "Avaliar campanhas locais. Endereço divulgado: Rua Central, 10. Google Maps: https://www.google.com/maps/search/?api=1&query=empresa";
  assert.equal(removeGoogleMapsLinks(notes), "Avaliar campanhas locais. Endereço divulgado: Rua Central, 10.");
});

test("removes an unlabeled Google Maps URL", () => {
  assert.equal(removeGoogleMapsLinks("Contato confirmado https://maps.google.com/maps/place/empresa"), "Contato confirmado");
});

test("leaves unrelated notes unchanged", () => {
  assert.equal(removeGoogleMapsLinks("Avaliar campanhas locais. Endereço divulgado: Rua Central, 10."), "Avaliar campanhas locais. Endereço divulgado: Rua Central, 10.");
});
