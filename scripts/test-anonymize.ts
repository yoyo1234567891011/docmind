import assert from "node:assert/strict";

import { anonymizeDocumentText } from "../src/services/corpus/anonymize";

function main() {
  const source = `
CONTRAT DE BAIL

Entre Jean Dupont, demeurant 12 rue des Lilas, 69003 Lyon,
email: jean.dupont@orange.fr, tél. 06 12 34 56 78,
IBAN FR76 3000 6000 0112 3456 7890 189, BIC BNPARFRPPXXX,
SIRET 552 100 554 00012,

et la SCI Les Lilas.

Article 1 — Objet
Le loyer mensuel est fixé à 850,00 € TTC, payable le 5 de chaque mois.
Date de prise d'effet : 01/09/2024.
Préavis de résiliation : 3 mois avant le 31/12/2025.

Article 2 — Dépôt de garantie
Un dépôt de 1 700 € est versé à la signature.
`.trim();

  const result = anonymizeDocumentText(source, {
    people: [{ from: "Jean Dupont", to: "Alice Martin" }],
    organizations: [{ from: "SCI Les Lilas", to: "SCI Exemple" }],
  });

  assert.ok(!result.text.includes("Jean Dupont"), "nom réel retiré");
  assert.ok(result.text.includes("Alice Martin"), "pseudonyme présent");
  assert.ok(!result.text.includes("jean.dupont@orange.fr"), "email retiré");
  assert.ok(result.text.includes("@exemple.fr"), "email fictif");
  assert.ok(!result.text.includes("06 12 34 56 78"), "téléphone retiré");
  assert.ok(result.text.includes("850,00 €"), "montant conservé");
  assert.ok(result.text.includes("1 700 €"), "dépôt conservé");
  assert.ok(result.text.includes("01/09/2024"), "date conservée");
  assert.ok(result.text.includes("31/12/2025"), "échéance conservée");
  assert.ok(result.text.includes("Article 1"), "clause conservée");
  assert.ok(result.text.includes("Article 2"), "clause 2 conservée");
  assert.ok(result.text.includes("SCI Exemple"), "org remplacée");
  assert.ok(!result.text.includes("SCI Les Lilas"), "org réelle retirée");
  assert.ok(result.text.includes("rue des Exemples"), "adresse anonymisée");
  assert.equal(result.stats.phones, 1, "un seul téléphone");
  assert.equal(result.stats.ibans, 1, "un IBAN anonymisé");

  // Mise en page (sauts de ligne) globalement préservée
  assert.equal(
    result.text.split("\n").length,
    source.split("\n").length,
    "nombre de lignes préservé",
  );

  console.log("OK test-anonymize", result.stats);
}

main();
