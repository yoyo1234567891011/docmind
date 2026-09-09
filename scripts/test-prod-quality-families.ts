/**
 * Qualité prod multi-familles — banque, fiscal, MED, bail.
 * npx tsx --tsconfig tsconfig.json scripts/test-prod-quality-families.ts
 */
import assert from "node:assert/strict";
import { readFileSync, existsSync } from "node:fs";
import path from "node:path";

import { classifyDocumentHeuristic } from "../src/ai/classification/heuristic";
import { mergeWithLocalRiskFindings } from "../src/ai/post-processing/inject-local-risk-findings";
import {
  assertProdQualityCleanPayload,
  finalizeAnalysisForProd,
  PROD_QUALITY_FORBIDDEN_PATTERNS,
} from "../src/ai/post-processing/prod-quality";
import { resolveWatchDocFamily } from "../src/ai/post-processing/watch-ranking";
import { extractOrganizations } from "../src/services/extraction/people-orgs";
import { areCategoriesRelationCompatible } from "../src/services/memory/candidate-selector";
import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

function baseAnalysis(
  partial: Partial<DocumentAnalysis> &
    Pick<DocumentAnalysis, "document_type" | "title">,
): DocumentAnalysis {
  return {
    summary: "",
    date: "",
    dates: [],
    people: [],
    organizations: [],
    amounts: [],
    deadlines: [
      "Signaler sans délai tout changement d'adresse",
      "| Échéance n°1 | 100 € |",
      "Échéance : date à laquelle une obligation de paiement devient exigible.",
      "Traiter les réclamations dans un délai raisonnable, sous 30 jours.",
      "Délai moyen de traitement courrier : 10 jours ouvrés",
      "Un accusé de réception est adressé sous 10 jours ouvrés lorsque la réglementation l'exige.",
    ],
    important_points: [],
    risks: [],
    actions: [
      "Anticiper l'échéance : Signaler sans délai tout changement d'adresse",
      "Traiter les réclamations dans un délai raisonnable",
      "Vérifier l'échéance: Délai impératif",
    ],
    risk_score: 40,
    risk_level: "modere",
    risk_explanation: "",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: false,
      score: 0,
      max_score: c.maxScore,
      reasons: [],
    })),
    risk_findings: [],
    ...partial,
  };
}

function assertNoForbidden(blob: string, label: string) {
  for (const pattern of PROD_QUALITY_FORBIDDEN_PATTERNS) {
    assert.ok(
      !pattern.test(blob),
      `${label} matched ${pattern}: ${blob.slice(0, 160)}`,
    );
  }
}

function payloadBlob(out: DocumentAnalysis): string {
  return [
    out.summary,
    ...out.deadlines,
    ...out.actions,
    ...out.important_points,
    ...out.risks,
    out.risk_explanation,
    ...out.risk_findings.map((f) => `${f.description} ${f.excerpt}`),
    ...out.risk_criteria.flatMap((c) => c.reasons ?? []),
  ].join("\n");
}

function runFamily(opts: {
  name: string;
  file: string;
  category: DocumentClassification["category"];
  label: string;
  expectedOrg?: RegExp;
  expectFinding: RegExp;
  forbidFeeLabel?: RegExp;
  family: ReturnType<typeof resolveWatchDocFamily>;
}) {
  const p = path.join(process.cwd(), opts.file);
  assert.ok(existsSync(p), `missing fixture ${opts.file}`);
  const text = readFileSync(p, "utf8");
  const orgs = extractOrganizations(text);
  if (opts.expectedOrg) {
    assert.ok(
      orgs.some((o) => opts.expectedOrg!.test(o)),
      `${opts.name} org attendue, got: ${orgs.join(" | ") || "(vide)"}`,
    );
  }

  const heuristic = classifyDocumentHeuristic(text);
  // Pas de régression croisée dure : le type attendu doit gagner ou rester proche.
  if (opts.category === "impots" || opts.category === "banque" || opts.category === "bail") {
    assert.equal(
      heuristic.category,
      opts.category,
      `${opts.name} heuristic=${heuristic.category}`,
    );
  }

  const family = resolveWatchDocFamily({
    category: opts.category,
    documentType: opts.label,
    title: opts.label,
    textHint: text.slice(0, 1500),
  });
  assert.equal(family, opts.family, `${opts.name} family=${family}`);

  const findings = mergeWithLocalRiskFindings([], text, {
    category: opts.category,
    documentType: opts.label,
  });

  // Principal / loyer ne doivent pas être injectés en frais_caches.
  for (const f of findings) {
    if (f.criterion_id === "frais_caches") {
      assert.ok(
        !/principal\s+d[ûu]|loyer\s*:|d[ée]p[ôo]t\s+de\s+garantie\s*:|total\s+r[ée]clam[ée]\s*:|montant\s+[àa]\s+pr[ée]lever/i.test(
          f.description,
        ),
        `${opts.name} frais_caches indésirable: ${f.description}`,
      );
    }
  }

  const classification: DocumentClassification = {
    category: opts.category,
    label: opts.label,
    confidence: 0.9,
  };

  const out = finalizeAnalysisForProd(
    baseAnalysis({
      document_type: opts.label,
      title: opts.label,
      organizations: orgs,
      amounts: findings
        .map((f) => f.description)
        .filter((d) => /\d/.test(d))
        .slice(0, 6),
      risk_findings: findings,
      // Faux frais cachés LLM (doit être remappé)
      risk_criteria: RISK_CRITERIA.map((c) => ({
        id: c.id,
        label: c.label,
        detected: c.id === "frais_caches",
        score: c.id === "frais_caches" ? 6 : 0,
        max_score: c.maxScore,
        reasons:
          c.id === "frais_caches" && opts.forbidFeeLabel
            ? ["Principal dû : 1 073 €"]
            : [],
      })),
    }),
    classification,
    text,
  );

  assert.ok(out.summary.trim().length >= 24, `${opts.name} résumé vide`);
  assert.ok(
    /[.!?…]/.test(out.summary),
    `${opts.name} résumé sans ponctuation: ${out.summary}`,
  );
  assert.ok(
    out.summary.length >= 40 && out.summary.length <= 420,
    `${opts.name} résumé longueur: ${out.summary.length}`,
  );
  assert.ok(
    !out.deadlines.some((d) =>
      /d[ée]lai\s+moyen\s+de\s+traitement|traitement\s+(?:du\s+)?courrier/i.test(
        d,
      ),
    ),
    `${opts.name} délai moyen encore présent`,
  );
  assert.ok(
    !out.actions.some((a) => /changement\s+d['']adresse/i.test(a)),
    `${opts.name} changement d'adresse dans actions`,
  );
  assert.ok(
    !out.actions.some((a) => /v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:/i.test(a)),
    `${opts.name} Vérifier l'échéance: dans actions`,
  );
  assertNoForbidden(payloadBlob(out), opts.name);
  assertProdQualityCleanPayload({
    summary: out.summary,
    deadlines: out.deadlines,
    actions: out.actions,
    findings: out.risk_findings.map((f) => f.description),
    importantPoints: out.important_points,
    risks: out.risks,
    riskExplanation: out.risk_explanation,
  });

  const findingBlob = out.risk_findings
    .map((f) => `${f.criterion_id}:${f.description}`)
    .join("\n");
  assert.ok(
    opts.expectFinding.test(findingBlob),
    `${opts.name} finding manquant: ${findingBlob.slice(0, 300)}`,
  );

  if (opts.name === "fiscal") {
    assert.ok(
      /principal\s+d[ûu].*1\s*073/i.test(findingBlob),
      `fiscal sans principal: ${findingBlob}`,
    );
    assert.ok(
      /total|majoration|1\s*205|relance/i.test(
        `${out.summary}\n${findingBlob}\n${out.amounts.join("\n")}`,
      ),
      `fiscal sans total/majoration visible: ${out.summary}`,
    );
    assert.ok(
      !out.risk_findings.some(
        (f) =>
          f.criterion_id === "frais_caches" && /principal/i.test(f.description),
      ),
      "fiscal principal sous frais_caches",
    );
    // Score : délais / sanctions non nuls si présents dans le texte
    const delais = out.risk_criteria.find((c) => c.id === "delais");
    const sanctions = out.risk_criteria.find((c) => c.id === "sanctions");
    assert.ok(
      (delais?.score ?? 0) > 0 ||
        out.risk_findings.some((f) => f.criterion_id === "delais"),
      "fiscal délais sous-scoré",
    );
    assert.ok(
      (sanctions?.score ?? 0) > 0 ||
        out.risk_findings.some((f) => f.criterion_id === "sanctions") ||
        /recouvrement/i.test(findingBlob),
      "fiscal sanctions sous-scoré",
    );
    assert.ok(
      !/mat[ée]riel/i.test(
        out.risk_findings.map((f) => f.implication).join(" "),
      ),
      "fiscal implication hors contexte (matériel)",
    );
    const sanctionsFindings = out.risk_findings.filter(
      (f) => f.criterion_id === "sanctions",
    );
    assert.equal(
      sanctionsFindings.length,
      1,
      `fiscal doublons/absence sanctions (${sanctionsFindings.length}): ${sanctionsFindings
        .map((f) => f.description)
        .join(" | ")}`,
    );
    assert.match(
      sanctionsFindings[0]!.description,
      /^Recouvrement\s+forc[ée]/i,
    );
  }

  if (opts.name === "banque") {
    assert.ok(
      /frais|commission|tenue|rejet|int[ée]r[êe]t|ficp/i.test(out.summary),
      `banque résumé non orienté frais: ${out.summary}`,
    );
    assert.ok(
      !/changement\s+d['']adresse/i.test(out.actions.join("\n")),
      "banque actions changement adresse",
    );
  }

  if (opts.forbidFeeLabel) {
    const feeFindings = out.risk_findings.filter(
      (f) => f.criterion_id === "frais_caches",
    );
    for (const f of feeFindings) {
      assert.ok(
        !opts.forbidFeeLabel.test(f.description),
        `${opts.name} libellé indésirable sous frais_caches: ${f.description}`,
      );
    }
  }

  const letter = buildFallbackLetter(
    "contestation",
    out,
    classification,
    "test",
    text,
  );
  assert.ok(
    !/\[Destinataire\]/i.test(letter.body),
    `${opts.name} letter [Destinataire]`,
  );
  assert.ok(
    !/v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:/i.test(letter.body),
    `${opts.name} letter Vérifier l'échéance:`,
  );
  if (opts.expectedOrg) {
    assert.ok(
      opts.expectedOrg.test(letter.body) || orgs.length === 0,
      `${opts.name} letter sans org`,
    );
  }

  if (opts.name === "fiscal") {
    assert.match(letter.subject, /contestation/i);
    assert.ok(/À l'attention de la\s/i.test(letter.body), "fiscal article");
    assert.ok(
      /principal|1\s*073/i.test(letter.body) &&
        /majoration|12\s*%/i.test(letter.body),
      `fiscal letter montants: ${letter.body.slice(0, 500)}`,
    );
  }
  if (opts.name === "banque") {
    assert.match(letter.subject, /frais bancaires|contestation/i);
    assert.ok(
      /commission|tenue|frais|rejet|int[ée]r[êe]t/i.test(letter.body),
      `banque letter frais: ${letter.body.slice(0, 400)}`,
    );
  }
  if (opts.name === "med") {
    assert.ok(
      /cr[ée]ance|mise en demeure|recouvrement/i.test(
        `${letter.subject}\n${letter.body}`,
      ),
      "med letter hors sujet",
    );
  }

  console.log(`OK ${opts.name}`);
  console.log(`  résumé: « ${out.summary.slice(0, 160)} »`);
  console.log(
    `  findings: ${out.risk_findings
      .slice(0, 3)
      .map((f) => f.description)
      .join(" | ")}`,
  );
  console.log(`  amounts hero: ${out.amounts.slice(0, 3).join(" · ") || "(vide)"}`);
  console.log(`  letter: ${letter.subject}`);
}

function main() {
  runFamily({
    name: "banque",
    file: "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
    category: "banque",
    label: "Relevé bancaire",
    expectedOrg: /horizon|banque/i,
    expectFinding: /commission|tenue|frais|rejet|int[ée]r[êe]t/i,
    family: "banque",
  });

  runFamily({
    name: "fiscal",
    file: "test-documents/impots/01-avis-fiscal-imp-946966.md",
    category: "impots",
    label: "Avis fiscal",
    expectedOrg: /finances\s+publiques|dgfip/i,
    expectFinding: /principal|total\s+[àa]\s+r[ée]gler|montant/i,
    forbidFeeLabel: /principal\s+d[ûu]/i,
    family: "administratif",
  });

  runFamily({
    name: "med",
    file: "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
    category: "courrier-administratif",
    label: "Mise en demeure",
    expectedOrg: /recouvrement/i,
    expectFinding: /total\s+r[ée]clam|principal|frais\s+de\s+recouvrement|p[ée]nalit/i,
    forbidFeeLabel: /principal\s*\/|total\s+r[ée]clam[ée]\s*:/i,
    family: "recouvrement",
  });

  runFamily({
    name: "bail",
    file: "test-documents/baux-de-location/04-bail-location-bordeaux-bail-561304.md",
    category: "bail",
    label: "Bail de location",
    expectFinding: /loyer|charges|d[ée]p[ôo]t/i,
    forbidFeeLabel: /loyer\s*:|d[ée]p[ôo]t\s+de\s+garantie\s*:/i,
    family: "bail",
  });

  // Relations : pas de compatibilité duplicate cross-types fiscaux / banque / MED
  assert.equal(areCategoriesRelationCompatible("impots", "banque"), false);
  assert.equal(
    areCategoriesRelationCompatible("banque", "courrier-administratif"),
    false,
  );
  assert.equal(areCategoriesRelationCompatible("impots", "bail"), false);
  assert.equal(areCategoriesRelationCompatible("bail", "bail"), true);

  console.log("\nALL prod-quality-families tests passed.");
}

main();
