/**
 * Dedup findings + qualité courrier (fiscal / banque / MED).
 * npx tsx --tsconfig tsconfig.json scripts/test-dedupe-and-letter-quality.ts
 */
import assert from "node:assert/strict";
import { existsSync, readFileSync } from "node:fs";
import path from "node:path";

import { mergeWithLocalRiskFindings } from "../src/ai/post-processing/inject-local-risk-findings";
import {
  areFindingsNearDuplicates,
  dedupeLabeledAmounts,
  dedupeRiskFindings,
} from "../src/ai/post-processing/dedupe-findings";
import { finalizeAnalysisForProd } from "../src/ai/post-processing/prod-quality";
import { extractOrganizations } from "../src/services/extraction/people-orgs";
import {
  buildFallbackLetter,
  formatAttentionRecipient,
} from "../src/services/reply/fallback-letter";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type {
  DocumentAnalysis,
  DocumentClassification,
  RiskFinding,
} from "../src/types";

function finding(
  partial: Pick<RiskFinding, "criterion_id" | "description"> &
    Partial<RiskFinding>,
): RiskFinding {
  return {
    description: partial.description,
    why: partial.why ?? "Signal détecté dans le document.",
    implication: partial.implication ?? "À surveiller.",
    consequence: partial.consequence ?? "Risque de suite contentieuse.",
    mitigation: partial.mitigation ?? "Contester ou régulariser par écrit.",
    justification: partial.justification ?? partial.why ?? "Signal détecté.",
    impact: partial.impact ?? partial.implication ?? "À surveiller.",
    excerpt: partial.excerpt ?? "",
    confidence: partial.confidence ?? 0.9,
    severity: partial.severity ?? "eleve",
    criterion_id: partial.criterion_id,
    status: partial.status ?? "confirmed",
    ...partial,
  };
}

function baseAnalysis(
  partial: Partial<DocumentAnalysis> &
    Pick<DocumentAnalysis, "document_type" | "title">,
): DocumentAnalysis {
  return {
    summary: "",
    date: "18/08/2026",
    dates: [],
    people: [],
    organizations: [],
    amounts: [],
    deadlines: [],
    important_points: [],
    risks: [],
    actions: [],
    risk_score: 50,
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

function loadFixture(rel: string): string {
  const p = path.join(process.cwd(), rel);
  assert.ok(existsSync(p), `missing ${rel}`);
  return readFileSync(p, "utf8");
}

function testUnitDedupeSanctions() {
  const a = finding({
    criterion_id: "sanctions",
    description: "Recouvrement forcé / poursuites possibles",
    excerpt:
      "À défaut, des poursuites pourront être engagées. procédure de recouvrement forcé.",
  });
  const b = finding({
    criterion_id: "sanctions",
    description: "Menace de poursuites ou recouvrement forcé",
    excerpt:
      "À défaut, des poursuites pourront être engagées. procédure de recouvrement forcé.",
  });

  assert.equal(
    areFindingsNearDuplicates(a, b),
    true,
    "sanctions synonymes doivent être near-dup",
  );

  const out = dedupeRiskFindings([a, b]);
  assert.equal(out.length, 1, `attendu 1 sanctions, got ${out.length}`);
  assert.match(
    out[0]!.description,
    /recouvrement\s+forc[ée]/i,
    `garder le titre le plus précis, got: ${out[0]!.description}`,
  );
  assert.ok(
    !/^menace\s+de\b/i.test(out[0]!.description),
    "ne pas garder « Menace de… »",
  );

  const amounts = dedupeLabeledAmounts([
    "Majoration pour retard : 19 %",
    "Majoration : 19 %",
    "Majoration pour retard : 19 %",
    "Principal dû : 1 073 €",
  ]);
  assert.equal(
    amounts.filter((x) => /19\s*%/.test(x)).length,
    1,
    `majoration ×N: ${amounts.join(" | ")}`,
  );
  assert.ok(amounts.some((x) => /1\s*073/.test(x)));

  console.log("OK unit dedupe sanctions + amounts");
}

function testFiscalPipelineAndLetter() {
  const text = loadFixture(
    "test-documents/impots/01-avis-fiscal-imp-946966.md",
  );
  const orgs = extractOrganizations(text);
  const findings = mergeWithLocalRiskFindings([], text, {
    category: "impots",
    documentType: "Avis fiscal",
  });

  // Injecte volontairement le clone « Menace… » s'il n'est pas déjà là.
  const withClone = [
    ...findings,
    finding({
      criterion_id: "sanctions",
      description: "Menace de poursuites ou recouvrement forcé",
      excerpt:
        "engagement d'une procédure de recouvrement forcé. poursuites pourront être engagées.",
    }),
    finding({
      criterion_id: "sanctions",
      description: "Recouvrement forcé / poursuites possibles",
      excerpt:
        "engagement d'une procédure de recouvrement forcé. poursuites pourront être engagées.",
    }),
  ];

  const classification: DocumentClassification = {
    category: "impots",
    label: "Avis fiscal",
    confidence: 0.95,
  };

  const out = finalizeAnalysisForProd(
    baseAnalysis({
      document_type: "Avis fiscal",
      title: "Avis fiscal",
      organizations: orgs,
      amounts: [
        "Principal dû : 1 073 €",
        "Majoration pour retard : 12 %",
        "Majoration : 12 %",
        "Majoration pour retard : 12 %",
        "Total à régler : 1 205 €",
        "Frais de relance : 13 €",
      ],
      risk_findings: withClone,
    }),
    classification,
  );

  const sanctions = out.risk_findings.filter(
    (f) => f.criterion_id === "sanctions",
  );
  assert.equal(
    sanctions.length,
    1,
    `fiscal: attendu 1 point sanctions, got ${sanctions.length}: ${sanctions
      .map((f) => f.description)
      .join(" | ")}`,
  );
  assert.match(
    sanctions[0]!.description,
    /^Recouvrement\s+forc[ée]/i,
    `fiscal sanctions title: ${sanctions[0]!.description}`,
  );

  const majorationHits = out.amounts.filter((a) => /12\s*%|majoration/i.test(a));
  assert.ok(
    majorationHits.length <= 2,
    `fiscal majoration dupliquée: ${out.amounts.join(" · ")}`,
  );

  const letter = buildFallbackLetter(
    "contestation",
    out,
    classification,
    "test fiscal",
    text,
  );

  assert.match(letter.subject, /contestation/i);
  assert.match(letter.body, /Direction|Finances\s+publiques|DGFiP/i);
  assert.ok(
    /À l'attention de la\s/i.test(letter.body),
    `article manquant: ${letter.body.slice(0, 200)}`,
  );
  assert.ok(!/\[Destinataire\]/i.test(letter.body));
  assert.ok(!/v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:/i.test(letter.body));
  assert.ok(
    /1\s*073|principal/i.test(letter.body),
    "letter sans principal",
  );
  assert.ok(
    /majoration|12\s*%/i.test(letter.body),
    "letter sans majoration",
  );
  assert.ok(
    /relance|13\s*€/i.test(letter.body),
    "letter sans frais de relance",
  );
  assert.ok(
    letter.recipient && !/\[/.test(letter.recipient),
    `recipient placeholder: ${letter.recipient}`,
  );
  assert.equal(letter.letterType, "contestation");

  console.log("OK fiscal pipeline + letter");
  console.log(
    `  sanctions: ${sanctions[0]?.description ?? "(aucun — ok si inject local seul)"}`,
  );
  console.log(`  subject: ${letter.subject}`);
}

function testBanqueLetter() {
  const text = loadFixture(
    "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
  );
  const orgs = extractOrganizations(text);
  const findings = mergeWithLocalRiskFindings([], text, {
    category: "banque",
    documentType: "Relevé bancaire",
  });
  const classification: DocumentClassification = {
    category: "banque",
    label: "Relevé bancaire",
    confidence: 0.9,
  };
  const out = finalizeAnalysisForProd(
    baseAnalysis({
      document_type: "Relevé bancaire",
      title: "Relevé bancaire",
      organizations: orgs,
      date: "31/07/2026",
      amounts: findings
        .map((f) => f.description)
        .filter((d) => /\d/.test(d))
        .slice(0, 8),
      risk_findings: findings,
    }),
    classification,
  );

  const letter = buildFallbackLetter(
    "contestation",
    out,
    classification,
    "test banque",
    text,
  );

  assert.match(letter.subject, /contestation.*frais|frais bancaires/i);
  assert.match(letter.body, /horizon|banque/i);
  assert.ok(!/\[Destinataire\]/i.test(letter.body));
  assert.ok(
    /commission|tenue|frais|rejet|int[ée]r[êe]t/i.test(letter.body),
    `banque letter sans frais réels: ${letter.body.slice(0, 400)}`,
  );
  assert.ok(!/^\d+\s*€\s*:\s*\d+/m.test(letter.body));

  console.log("OK banque letter");
  console.log(`  subject: ${letter.subject}`);
}

function testMedLetter() {
  const text = loadFixture(
    "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
  );
  const orgs = extractOrganizations(text);
  const findings = mergeWithLocalRiskFindings([], text, {
    category: "courrier-administratif",
    documentType: "Mise en demeure",
  });
  const classification: DocumentClassification = {
    category: "courrier-administratif",
    label: "Mise en demeure",
    confidence: 0.9,
  };
  const out = finalizeAnalysisForProd(
    baseAnalysis({
      document_type: "Mise en demeure",
      title: "Mise en demeure",
      organizations: orgs,
      amounts: findings
        .map((f) => f.description)
        .filter((d) => /\d/.test(d))
        .slice(0, 8),
      risk_findings: findings,
    }),
    classification,
  );

  const letter = buildFallbackLetter(
    "contestation",
    out,
    classification,
    "test med",
    text,
  );

  assert.match(letter.subject, /contestation|cr[ée]ance/i);
  assert.ok(
    /mise en demeure|recouvrement|cr[ée]ance/i.test(letter.body),
    "MED letter hors sujet",
  );
  assert.ok(
    /total|principal|frais|p[ée]nalit|€/i.test(letter.body),
    `MED letter sans montants: ${letter.body.slice(0, 400)}`,
  );
  assert.ok(!/\[Destinataire\]/i.test(letter.body));
  assert.ok(
    /trente jours|jours|échéance/i.test(letter.body),
    "MED letter sans délai de réponse",
  );

  console.log("OK med letter");
  console.log(`  subject: ${letter.subject}`);
}

function testAttentionGrammar() {
  assert.match(
    formatAttentionRecipient("Direction générale des Finances publiques"),
    /À l'attention de la Direction/i,
  );
  assert.match(
    formatAttentionRecipient("Banque Horizon"),
    /À l'attention de la Banque Horizon/i,
  );
  console.log("OK attention grammar");
}

function main() {
  testUnitDedupeSanctions();
  testAttentionGrammar();
  testFiscalPipelineAndLetter();
  testBanqueLetter();
  testMedLetter();
  console.log("\nALL dedupe + letter-quality tests passed.");
}

main();
