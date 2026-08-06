/**
 * Tests moteur /knowledge (sans LLM).
 */
import assert from "assert";

import {
  clearKnowledgeCache,
  loadKnowledgeCatalog,
  selectKnowledgeForDocument,
} from "../src/services/knowledge";

async function main() {
  clearKnowledgeCache();
  const { manifest, documents } = await loadKnowledgeCatalog(true);
  assert.ok(manifest.domains.length >= 10);
  assert.ok(documents.some((d) => d.id === "general"));
  assert.ok(documents.some((d) => d.id === "assurance"));
  assert.ok(documents.some((d) => d.id === "bail"));

  const assurance = await selectKnowledgeForDocument({
    category: "assurance",
    categoryLabel: "Contrat d'assurance habitation",
    documentText:
      "Police d'assurance multirisque habitation. Franchise 250 €. Déclaration de sinistre sous 5 jours. Prime annuelle.",
  });

  assert.ok(
    !assurance.selectedIds.includes("general"),
    "general omis quand une fiche spécialisée matche",
  );
  assert.ok(
    assurance.selectedIds.includes("assurance") ||
      assurance.selectedIds.includes("mutuelle"),
    `attendu assurance, got ${assurance.selectedIds.join(",")}`,
  );
  assert.ok(assurance.promptBlock.includes("CONNAISSANCES_JURIDIQUES"));
  assert.ok(assurance.promptBlock.includes("Franchise") || assurance.promptBlock.includes("franchise") || assurance.promptBlock.length > 200);

  const bail = await selectKnowledgeForDocument({
    category: "bail",
    categoryLabel: "Bail d'habitation",
    documentText:
      "Bail meublé. Loyer mensuel. Dépôt de garantie. Congé avec préavis d'un mois. Charges locatives.",
  });
  assert.ok(bail.selectedIds.includes("bail"));

  console.log("OK test-knowledge", {
    assurance: assurance.selectedIds,
    bail: bail.selectedIds,
  });
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
