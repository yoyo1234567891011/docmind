/**
 * Tests citations page / paragraphe / extrait.
 */
import assert from "assert";

import {
  buildDocumentLocusIndex,
  locateExcerptCitation,
} from "../src/ai/reasoning/citations";
import { verifyAnalysisDraft } from "../src/ai/reasoning/verify-analysis";

const PAGES = [
  `CONTRAT DE SERVICE

Entre Société Alpha SAS et Jean Dupont.`,
  `Le contrat est renouvelé par tacite reconduction pour un an,
sauf dénonciation trois mois avant le 31/12/2027.

Pénalité de 40 € en cas de retard.`,
];

function main() {
  const loci = buildDocumentLocusIndex(PAGES, PAGES.join("\n\n"));
  assert.ok(loci.length >= 3);

  const citation = locateExcerptCitation(
    "renouvelé par tacite reconduction pour un an",
    loci,
  );
  assert.ok(citation);
  assert.equal(citation!.page, 2);
  assert.ok(citation!.paragraph >= 1);
  assert.ok(citation!.excerpt.length >= 8);

  const missing = locateExcerptCitation(
    "cette phrase n'existe absolument pas dans le document xyz",
    loci,
  );
  assert.equal(missing, null);

  const verified = verifyAnalysisDraft(
    {
      document_type: "Contrat",
      title: "T",
      summary: "S",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: ["40 €"],
      deadlines: ["31/12/2027"],
      important_points: [],
      important_point_drafts: [
        {
          statement: "Reconduction tacite",
          excerpt: "renouvelé par tacite reconduction pour un an",
        },
        {
          statement: "Sans preuve",
          excerpt: "",
        },
      ],
      risks: ["Risque orphelin"],
      actions: ["Anticiper l'échéance : 31/12/2027"],
      risk_findings: [
        {
          description: "Renouvellement tacite",
          why: "Le contrat prévoit une reconduction automatique.",
          implication: "L'engagement se prolonge sans signature nouvelle.",
          consequence: "Le contrat continue si aucune dénonciation n'est faite.",
          mitigation: "Dénoncer par écrit trois mois avant l'échéance.",
          justification: "Le contrat prévoit une reconduction automatique.",
          impact: "L'engagement se prolonge sans signature nouvelle.",
          excerpt: "Le contrat est renouvelé par tacite reconduction pour un an",
          confidence: 0.9,
          severity: "eleve",
          criterion_id: "renouvellement_tacite",
          status: "ambiguous",
        },
        {
          description: "Invention",
          why: "Pourquoi inventé pour le test.",
          implication: "Implication inventée pour le test.",
          consequence: "Conséquence inventée pour le test.",
          mitigation: "Mitigation inventée pour le test.",
          justification: "Pourquoi inventé pour le test.",
          impact: "Implication inventée pour le test.",
          excerpt: "extrait fantôme inventé totalement",
          confidence: 0.95,
          severity: "eleve",
          criterion_id: "penalites",
          status: "ambiguous",
        },
      ],
    },
    PAGES.join("\n\n"),
    PAGES,
  );

  assert.equal(verified._verification.confirmed, 1);
  assert.ok(verified.risk_findings[0]?.citation?.page === 2);
  assert.equal(verified.important_point_findings.length, 1);
  assert.equal(verified._verification.important_points_dropped, 1);
  assert.deepEqual(verified.risks, ["Renouvellement tacite"]);

  console.log("OK test-citations");
}

main();
