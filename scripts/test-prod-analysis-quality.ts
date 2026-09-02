/**
 * Qualité prod — résumé, watch, actions, échéances, preuves score, courrier banque.
 * npx tsx --tsconfig tsconfig.json scripts/test-prod-analysis-quality.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import { cleanActionsForDisplay } from "../src/ai/post-processing/display-cleanup";
import {
  buildDeterministicDisplaySummary,
  finalizeAnalysisForProd,
  isAnalysisActionNoise,
  isDictionaryDefinitionSnippet,
  isFakeScheduleDeadline,
  resolveDisplaySummary,
  shouldShowWatchEmptyState,
} from "../src/ai/post-processing/prod-quality";
import { buildWatchPointsFromCriteria } from "../src/ai/post-processing/prod-quality";
import { detectRiskCriterion } from "../src/services/risk/detect";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import { sanitizeDeadlines } from "../src/services/extraction/deadlines";
import {
  collectAllowedLetterFacts,
  extractBankFeeLines,
} from "../src/services/reply/letter-quality";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const horizonPath = path.join(
  process.cwd(),
  "test-documents/banques/01-releve-bancaire-banque-horizon-bqe-322695.md",
);
const bailPath = path.join(
  process.cwd(),
  "test-documents/baux-de-location/01-bail-location-rennes-bail-740347.md",
);
const relancePath = path.join(
  process.cwd(),
  "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
);

const horizonText = readFileSync(horizonPath, "utf8");
const bailText = readFileSync(bailPath, "utf8");

function baseAnalysis(
  overrides: Partial<DocumentAnalysis> = {},
): DocumentAnalysis {
  return {
    document_type: "Relevé bancaire",
    title: "Relevé Banque Horizon",
    summary: "Aucun résumé disponible. Relancer si besoin.",
    date: "02/03/2026",
    dates: ["02/03/2026"],
    people: ["Lucas Vincent"],
    organizations: ["Banque Horizon"],
    amounts: [
      "Commission d'intervention : 15,96 €",
      "Frais de tenue de compte : 8,25 €",
      "rejet de prélèvement facturé 16 €",
    ],
    deadlines: [
      "régularisation du solde avant le 25/11/2026",
      "| 24/01/2026 | Échéance n°1 | 569,53 € |",
      "Signaler sans délai tout changement d'adresse",
      "Échéance : date à laquelle une obligation de paiement devient exigible",
    ],
    important_points: ["Frais cachés : commission de mouvement de 2,55 €"],
    risks: ["Intérêts débiteurs au taux de 17,7 %", "Inscription FICP possible"],
    actions: [
      "Signaler changement d'adresse",
      "| 24/01/2026 | Échéance n°1 | 569,53 € |",
      "Vérifier les frais de tenue de compte facturés",
    ],
    risk_score: 58,
    risk_level: "eleve",
    risk_explanation: "Frais et pénalités détectés",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: c.id === "frais_caches" || c.id === "penalites",
      score: c.id === "frais_caches" ? 7 : c.id === "penalites" ? 6 : 0,
      max_score: c.maxScore,
      reasons:
        c.id === "frais_caches"
          ? ["Commission d'intervention : 15,96 €"]
          : c.id === "penalites"
            ? [
                "Échéance : date à laquelle une obligation de paiement devient exigible",
              ]
            : [],
    })),
    risk_findings: [],
    ...overrides,
  };
}

const banqueClass: DocumentClassification = {
  category: "banque",
  label: "Banque",
  confidence: 0.95,
};

async function main() {
  // --- Résumé ---
  const summary = resolveDisplaySummary(baseAnalysis(), banqueClass);
  assert.ok(summary.length >= 40, "résumé non vide");
  assert.ok(!/aucun résumé|relancer si besoin/i.test(summary), summary);
  assert.ok(/banque horizon|15,96|frais|commission/i.test(summary), summary);
  console.log("OK résumé Horizon déterministe");

  // --- Watch empty state ---
  assert.equal(shouldShowWatchEmptyState(baseAnalysis()), false);
  const watchFromCriteria = buildWatchPointsFromCriteria(
    baseAnalysis(),
    banqueClass,
  );
  assert.ok(watchFromCriteria.length >= 1, "watch criteria fallback");
  console.log("OK watch aligné score");

  // --- Actions ---
  const actions = cleanActionsForDisplay(baseAnalysis().actions);
  assert.ok(actions.length >= 1, "au moins une action utile");
  assert.ok(
    !actions.some((a) => /changement d'adresse/i.test(a)),
    actions.join(" | "),
  );
  assert.ok(!actions.some((a) => /\|/.test(a)), actions.join(" | "));
  assert.ok(isAnalysisActionNoise("Signaler changement d'adresse"));
  console.log("OK actions sans bruit");

  // --- Échéances ---
  const deadlines = sanitizeDeadlines(baseAnalysis().deadlines);
  assert.ok(
    deadlines.some((d) => /régularisation|25\/11\/2026/i.test(d)),
    deadlines.join(" | "),
  );
  assert.ok(
    !deadlines.some((d) => /changement d'adresse|échéance n°1/i.test(d)),
    deadlines.join(" | "),
  );
  assert.ok(isFakeScheduleDeadline("| 24/01/2026 | Échéance n°1 |"));
  assert.ok(
    isDictionaryDefinitionSnippet(
      "Échéance : date à laquelle une obligation de paiement devient exigible",
    ),
  );
  console.log("OK échéances filtrées");

  // --- Preuves score ---
  const finalized = finalizeAnalysisForProd(baseAnalysis(), banqueClass);
  const penalites = finalized.risk_criteria.find((c) => c.id === "penalites");
  assert.ok(
    !penalites?.reasons?.some((r) => isDictionaryDefinitionSnippet(r)),
    penalites?.reasons?.join(" | "),
  );
  const fraisCriterion = RISK_CRITERIA.find((c) => c.id === "frais_caches")!;
  const defLine =
    "- **Échéance** : date à laquelle une obligation de paiement devient exigible.";
  const detected = detectRiskCriterion(fraisCriterion, defLine);
  assert.equal(detected.reasons.length, 0, "définition dictionnaire exclue");
  console.log("OK preuves score sans définition");

  // --- Courrier banque ---
  const feeLines = extractBankFeeLines(horizonText, baseAnalysis());
  const feeBlob = feeLines.join(" ").toLowerCase();
  assert.ok(/tenue|commission|intervention|2,55|16/.test(feeBlob), feeBlob);
  assert.ok(!/fictif|dossier\s+35/i.test(feeBlob), feeBlob);
  const facts = collectAllowedLetterFacts({
    documentText: horizonText,
    analysis: baseAnalysis(),
    letterType: "contestation",
    family: "banque",
  });
  const factsBlob = facts.map((f) => f.label).join(" ");
  assert.ok(/commission|tenue|rejet|mouvement/i.test(factsBlob), factsBlob);
  assert.ok(!/changement d'adresse/i.test(factsBlob), factsBlob);
  assert.ok(!/fictif/i.test(factsBlob), factsBlob);
  console.log("OK courrier contestation frais réels");

  // --- Non-régression bail ---
  const bailSummary = buildDeterministicDisplaySummary(
    baseAnalysis({
      document_type: "Bail de location",
      title: "Bail Rennes",
      summary: "",
      organizations: ["Propriétaire SCI"],
      amounts: ["Loyer : 850 €"],
      risks: ["Dépôt de garantie : 1 700 €"],
      risk_score: 35,
      risk_level: "modere",
      risk_criteria: [],
      actions: ["Vérifier le montant du dépôt de garantie"],
      deadlines: ["Préavis de 3 mois avant départ"],
    }),
    { category: "bail", label: "Bail", confidence: 0.9 },
  );
  assert.ok(/bail|loyer|850/i.test(bailSummary), bailSummary);
  console.log("OK non-régression bail");

  // --- Non-régression mise en demeure ---
  const relanceDeadlines = sanitizeDeadlines([
    "Paiement sous 8 jours à compter de la réception",
    "Signaler sans délai tout changement d'adresse",
  ]);
  assert.ok(relanceDeadlines.some((d) => /8 jours/i.test(d)));
  assert.ok(!relanceDeadlines.some((d) => /changement/i.test(d)));
  console.log("OK non-régression mise en demeure");

  void bailText;
  void relancePath;
  console.log("\nALL prod analysis quality tests passed.");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
