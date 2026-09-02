/**
 * Intégration prod-quality — JSON final relevé bancaire sans bruit boilerplate.
 * npx tsx --tsconfig tsconfig.json scripts/test-prod-quality-integration.ts
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import path from "node:path";

import {
  assertProdQualityCleanPayload,
  finalizeAnalysisForProd,
  PROD_QUALITY_FORBIDDEN_PATTERNS,
  resolveDisplaySummary,
} from "../src/ai/post-processing/prod-quality";
import { buildWatchPointsFromCriteria } from "../src/ai/post-processing/prod-quality";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const fixturePath = path.join(
  process.cwd(),
  "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
);

const banqueClass: DocumentClassification = {
  category: "banque",
  label: "Banque",
  confidence: 0.95,
};

function noisyHorizonAnalysis(): DocumentAnalysis {
  return {
    document_type: "Relevé bancaire",
    title: "Relevé 03-…-463739",
    summary: "Montants repérés : 2 148,47 €, +2 086 €.",
    date: "04/05/2026",
    dates: ["04/05/2026"],
    people: ["Lucas Roux"],
    organizations: ["Banque Horizon"],
    amounts: [
      "2 148,47 €",
      "+2 086 €",
      "10,23 € — Frais de tenue de compte",
      "1,63 € — Commission de mouvement",
      "20 € — Rejet de prélèvement",
      "21,10 € — Commission d'intervention",
    ],
    deadlines: [
      "Régularisation du solde avant le 17/06/2026",
      "Signaler sans délai tout changement d'adresse, d'état civil, de RIB ou de situation.",
      "Traiter les réclamations dans un délai raisonnable, en principe sous 30 jours.",
      "| 04/02/2026 | Échéance n°1 | 569,53 € | Prélèvement |",
      "Échéance : date à laquelle une obligation de paiement devient exigible.",
    ],
    important_points: ["Solde arrêté à 2 148,47 €"],
    risks: ["Frais cachés : commission de mouvement de 1,63 €"],
    actions: [
      "Anticiper l'échéance : Signaler sans délai tout changement d'adresse",
      "Anticiper l'échéance : Traiter les réclamations sous 30 jours",
      "Anticiper l'échéance : | 04/02/2026 | Échéance n°1 | 569,53 € |",
      "Vérifier les frais de tenue de compte facturés (10,23 €)",
    ],
    risk_score: 66,
    risk_level: "eleve",
    risk_explanation: "Frais et incidents",
    risk_criteria: RISK_CRITERIA.map((criterion) => ({
      id: criterion.id,
      label: criterion.label,
      detected:
        criterion.id === "frais_caches" ||
        criterion.id === "obligations_importantes" ||
        criterion.id === "resiliation",
      score:
        criterion.id === "frais_caches"
          ? 7
          : criterion.id === "obligations_importantes"
            ? 7
            : criterion.id === "resiliation"
              ? 6
              : 0,
      max_score: criterion.maxScore,
      reasons:
        criterion.id === "frais_caches"
          ? ["Commission de mouvement de 1,63 €"]
          : criterion.id === "obligations_importantes"
            ? [
                "Échéance : date à laquelle une obligation de paiement devient exigible.",
              ]
            : criterion.id === "resiliation"
              ? ["Résiliation tacite du contrat à l'échéance"]
              : [],
    })),
    risk_findings: [
      {
        description: "Commission de mouvement 1,63 €",
        why: "Commission hors forfait sur le relevé.",
        implication: "Coût récurrent à surveiller.",
        consequence: "Budget impacté.",
        mitigation: "Comparer les offres bancaires.",
        excerpt: "commission de mouvement de 1,63 €",
        confidence: 0.9,
        severity: "modere",
        criterion_id: "frais_caches",
        status: "confirmed",
      },
    ],
  };
}

function main() {
  void readFileSync(fixturePath, "utf8");

  const finalized = finalizeAnalysisForProd(noisyHorizonAnalysis(), banqueClass);
  const summary = resolveDisplaySummary(finalized, banqueClass);
  const watch = buildWatchPointsFromCriteria(finalized, banqueClass);

  assertProdQualityCleanPayload({
    summary,
    deadlines: finalized.deadlines,
    actions: finalized.actions,
    riskCriteriaReasons: finalized.risk_criteria.flatMap(
      (criterion) => criterion.reasons ?? [],
    ),
  });

  for (const pattern of PROD_QUALITY_FORBIDDEN_PATTERNS) {
    const blob = [
      summary,
      ...finalized.deadlines,
      ...finalized.actions,
      ...finalized.risk_criteria.flatMap((c) => c.reasons ?? []),
      ...watch.map((point) => `${point.title} ${point.explanation}`),
    ].join("\n");
    assert.ok(!pattern.test(blob), `forbidden ${pattern} in:\n${blob}`);
  }

  assert.ok(/tenue|commission|1,63|10,23|rejet/i.test(summary), summary);
  assert.ok(!/2\s*148|2\s*086|salaire/i.test(summary), summary);
  assert.ok(
    finalized.deadlines.some((deadline) => /17\/06\/2026/i.test(deadline)),
    finalized.deadlines.join(" | "),
  );
  assert.ok(finalized.actions.length >= 1, "actions utiles");
  assert.ok(
    !finalized.actions.some((action) => /anticiper l'échéance/i.test(action)),
    finalized.actions.join(" | "),
  );

  const obligations = finalized.risk_criteria.find(
    (criterion) => criterion.id === "obligations_importantes",
  );
  const resiliation = finalized.risk_criteria.find(
    (criterion) => criterion.id === "resiliation",
  );
  assert.equal(obligations?.score ?? 0, 0, obligations?.reasons?.join(" | "));
  assert.equal(resiliation?.score ?? 0, 0, resiliation?.reasons?.join(" | "));

  assert.ok(
    watch.some((point) => /commission|mouvement|1,63/i.test(point.title)),
    watch.map((point) => point.title).join(" | "),
  );
  assert.ok(
    !watch.some((point) => /signal détecté/i.test(point.explanation)),
    watch.map((point) => point.explanation).join(" | "),
  );

  console.log("OK prod-quality integration — relevé 463739");
  console.log(
    JSON.stringify(
      {
        summary,
        deadlines: finalized.deadlines,
        actions: finalized.actions,
        watch: watch.map((point) => ({
          title: point.title,
          explanation: point.explanation,
        })),
        risk_score: finalized.risk_score,
      },
      null,
      2,
    ),
  );
  console.log("\nALL prod-quality integration tests passed.");
}

main();
