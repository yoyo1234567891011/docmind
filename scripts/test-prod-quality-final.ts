/**
 * Passe finale qualité — assert patterns interdits sur JSON final.
 * npx tsx --tsconfig tsconfig.json scripts/test-prod-quality-final.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import {
  assertProdQualityCleanPayload,
  finalizeAnalysisForProd,
  PROD_QUALITY_FORBIDDEN_PATTERNS,
  resolveDisplaySummary,
} from "../src/ai/post-processing/prod-quality";
import { mergeWithLocalRiskFindings } from "../src/ai/post-processing/inject-local-risk-findings";
import { normalizeBankFeeLine } from "../src/services/reply/letter-quality";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

const banqueClass: DocumentClassification = {
  category: "banque",
  label: "Banque",
  confidence: 0.95,
};

function noisyBanque(): DocumentAnalysis {
  return {
    document_type: "Relevé bancaire",
    title: "Relevé Horizon",
    summary: "Montants repérés : solde 2 148,47 € et salaire +2 086 €.",
    date: "04/05/2026",
    dates: ["04/05/2026"],
    people: ["Lucas Roux"],
    organizations: ["Banque Horizon"],
    amounts: [
      "2 148,47 € — Solde arrêté",
      "+2 086 € — Salaire",
      "10,23 € — Frais de tenue de compte",
      "1,63 € — Commission de mouvement",
    ],
    deadlines: [
      "Régularisation du solde avant le 17/06/2026",
      "Signaler sans délai tout changement d'adresse",
      "Traiter les réclamations dans un délai raisonnable, en principe sous 30 jours.",
      "| 04/02/2026 | Échéance n°1 | 569,53 € |",
      "Échéance : date à laquelle une obligation de paiement devient exigible.",
    ],
    important_points: [
      "Solde arrêté à 2 148,47 €",
      "Commission de mouvement 1,63 €",
      "Signal détecté score 7/10",
    ],
    risks: [
      "Frais cachés : commission de mouvement de 1,63 €",
      "Signal détecté sur le critère Délais",
    ],
    actions: [
      "Anticiper l'échéance : Signaler sans délai tout changement d'adresse",
      "Vérifier les frais de tenue de compte facturés (10,23 €)",
    ],
    risk_score: 66,
    risk_level: "eleve",
    risk_explanation:
      'Preuve : "Échéance : date à laquelle une obligation de paiement devient exigible."',
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: ["frais_caches", "delais", "resiliation"].includes(c.id),
      score:
        c.id === "frais_caches" ? 7 : c.id === "delais" ? 5 : c.id === "resiliation" ? 6 : 0,
      max_score: c.maxScore,
      reasons:
        c.id === "frais_caches"
          ? ["Commission de mouvement de 1,63 €"]
          : c.id === "delais"
            ? ["Traiter les réclamations dans un délai raisonnable, sous 30 jours."]
            : c.id === "resiliation"
              ? ["Échéance : date à laquelle une obligation de paiement devient exigible."]
              : [],
    })),
    risk_findings: [
      {
        description: "Commission de mouvement 1,63 €",
        why: "Commission hors forfait.",
        implication: "Coût récurrent.",
        consequence: "Budget.",
        mitigation: "Comparer.",
        excerpt: "commission de mouvement de 1,63 €",
        confidence: 0.9,
        severity: "modere",
        criterion_id: "frais_caches",
        status: "confirmed",
      },
      {
        description: "Signal détecté score 8/10",
        why: "Boilerplate.",
        implication: "x",
        consequence: "y",
        mitigation: "z",
        excerpt: "Signaler sans délai tout changement d'adresse",
        confidence: 0.5,
        severity: "faible",
        criterion_id: "delais",
        status: "confirmed",
      },
    ],
  };
}

function assertNoForbidden(blob: string, label: string) {
  for (const pattern of PROD_QUALITY_FORBIDDEN_PATTERNS) {
    assert.ok(!pattern.test(blob), `${label} matched ${pattern}: ${blob.slice(0, 160)}`);
  }
  assert.ok(!/changement d['']adresse/i.test(blob), label);
  assert.ok(!/Échéance n[°o]/i.test(blob), label);
  assert.ok(!/Traiter les réclamations/i.test(blob), label);
  assert.ok(!/\|\s*.+\s*\|/m.test(blob), label);
}

function main() {
  const finalized = finalizeAnalysisForProd(noisyBanque(), banqueClass);
  const summary = resolveDisplaySummary(finalized, banqueClass);

  assertProdQualityCleanPayload({
    summary,
    deadlines: finalized.deadlines,
    actions: finalized.actions,
    riskCriteriaReasons: finalized.risk_criteria.flatMap((c) => c.reasons ?? []),
    findings: finalized.risk_findings.flatMap((f) => [
      f.description,
      f.excerpt ?? "",
      f.why ?? "",
    ]),
    importantPoints: finalized.important_points,
    risks: finalized.risks,
    riskExplanation: finalized.risk_explanation,
  });

  const blob = [
    summary,
    ...finalized.deadlines,
    ...finalized.actions,
    ...finalized.important_points,
    ...finalized.risks,
    finalized.risk_explanation,
    ...finalized.risk_findings.map((f) => `${f.description} ${f.excerpt}`),
    ...finalized.risk_criteria.flatMap((c) => c.reasons ?? []),
  ].join("\n");
  assertNoForbidden(blob, "finalized banque");

  assert.ok(/tenue|commission|1,63|10,23/i.test(summary), summary);
  assert.ok(!/2\s*148|salaire/i.test(summary), summary);
  assert.ok(
    finalized.important_points.every((p) => !/solde arrêt|signal détecté/i.test(p)),
    finalized.important_points.join(" | "),
  );
  assert.ok(
    finalized.important_points.length >= 1 && finalized.important_points.length <= 6,
  );
  assert.equal(
    finalized.risk_criteria.find((c) => c.id === "resiliation")?.score ?? 0,
    0,
  );
  assert.equal(
    finalized.risk_criteria.find((c) => c.id === "delais")?.score ?? 0,
    0,
  );
  assert.ok(
    !finalized.risk_findings.some((f) => /signal détecté|changement d/i.test(f.description)),
  );
  console.log("OK A–G banque finalize");

  // Inject local sur fixture texte
  const fixture = path.join(
    process.cwd(),
    "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
  );
  if (existsSync(fixture)) {
    const text = readFileSync(fixture, "utf8");
    const merged = mergeWithLocalRiskFindings([], text, {
      category: "banque",
      documentType: "Relevé bancaire",
    });
    const after = finalizeAnalysisForProd(
      { ...noisyBanque(), risk_findings: merged },
      banqueClass,
    );
    const injectBlob = after.risk_findings
      .map((f) => `${f.description} ${f.excerpt}`)
      .join("\n");
    assertNoForbidden(injectBlob, "inject+finalize");
    console.log("OK inject banque sans bruit");
  }

  // Courrier
  assert.equal(normalizeBankFeeLine("16 €"), null);
  assert.equal(normalizeBankFeeLine("16 € : 16 €"), null);
  const fee = normalizeBankFeeLine("Commission de mouvement de 2,55 €");
  assert.ok(fee && /commission de mouvement\s*:\s*2,55\s*€/i.test(fee), fee);
  assert.ok(fee && !/\bde\s*:/i.test(fee), fee);
  console.log("OK H letter normalizeBankFeeLine");

  // Bail / med smoke finalize (pas de crash + pas de patterns)
  for (const [label, category, file] of [
    [
      "bail",
      "bail",
      "test-documents/baux-de-location/04-bail-location-bordeaux-bail-561304.md",
    ],
    [
      "med",
      "courrier-administratif",
      "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
    ],
  ] as const) {
    const p = path.join(process.cwd(), file);
    if (!existsSync(p)) continue;
    const text = readFileSync(p, "utf8");
    const findings = mergeWithLocalRiskFindings([], text, {
      category,
      documentType: label,
    });
    const out = finalizeAnalysisForProd(
      {
        document_type: label,
        title: label,
        summary: "Analyse en cours.",
        date: "",
        dates: [],
        people: [],
        organizations: [],
        amounts: [],
        deadlines: [
          "Signaler sans délai tout changement d'adresse",
          "| Échéance n°1 | 100 € |",
        ],
        important_points: [],
        risks: [],
        actions: ["Traiter les réclamations dans un délai raisonnable"],
        risk_score: 10,
        risk_level: "faible",
        risk_explanation: "",
        risk_criteria: [],
        risk_findings: findings,
      },
      { category, label, confidence: 0.8 },
    );
    assertNoForbidden(
      [...out.deadlines, ...out.actions, ...out.risk_findings.map((f) => f.excerpt ?? "")].join(
        "\n",
      ),
      label,
    );
    console.log(`OK ${label} finalize sans strings interdites`);
  }

  console.log("\nALL prod-quality-final tests passed.");
}

main();
