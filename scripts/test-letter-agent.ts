/**
 * Tests agent courrier (suggestion + fallback, sans LLM).
 */
import assert from "assert";

import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import { suggestLetterType } from "../src/services/reply/suggest-type";
import { parseReadyReplyResponse } from "../src/ai/validation/reply";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type { DocumentAnalysis, DocumentClassification } from "../src/types";

function analysis(overrides: Partial<DocumentAnalysis> = {}): DocumentAnalysis {
  return {
    document_type: "Document",
    title: "Doc test",
    summary: "Résumé",
    date: "01/03/2026",
    dates: ["01/03/2026"],
    people: ["Jean Dupont"],
    organizations: ["EDF"],
    amounts: ["120 €"],
    deadlines: ["15/04/2026"],
    important_points: ["Point important"],
    risks: [],
    actions: [],
    risk_score: 20,
    risk_level: "faible",
    risk_explanation: "test",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: false,
      score: 0,
      max_score: c.maxScore,
      reasons: [],
    })),
    risk_findings: [],
    ...overrides,
  };
}

const classification: DocumentClassification = {
  category: "contrat",
  label: "Contrat",
  confidence: 0.9,
};

function main() {
  const resiliation = suggestLetterType(
    "Je souhaite résilier mon abonnement.",
    analysis({
      actions: ["Envoyer un courrier de résiliation"],
      risks: ["Préavis de résiliation court"],
    }),
    classification,
  );
  assert.equal(resiliation.letterType, "resiliation");

  const refund = suggestLetterType(
    "Demande de remboursement du trop-perçu.",
    analysis({ amounts: ["85 €"], title: "Avoir client" }),
    { category: "facture", label: "Facture", confidence: 0.9 },
  );
  assert.equal(refund.letterType, "remboursement");

  const contest = suggestLetterType(
    "Je conteste le montant de cette facture.",
    analysis({
      risks: ["Erreur de facturation"],
      actions: ["Contester le prélèvement"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
  );
  assert.equal(contest.letterType, "contestation");

  const admin = suggestLetterType(
    "Mise en demeure — réponse attendue sous 15 jours.",
    analysis({ title: "Mise en demeure", deadlines: ["20/04/2026"] }),
    {
      category: "courrier-administratif",
      label: "Courrier administratif",
      confidence: 0.85,
    },
  );
  assert.equal(admin.letterType, "reponse_administrative");

  const letter = buildFallbackLetter(
    "resiliation",
    analysis({
      title: "Contrat fibre Orange",
      organizations: ["Orange"],
      deadlines: ["Résilier avant le 01/05/2026"],
    }),
    classification,
    "Test résiliation",
  );
  assert.equal(letter.required, true);
  assert.equal(letter.letterType, "resiliation");
  assert.ok(letter.subject.length > 0);
  assert.ok(/Orange/i.test(letter.body));
  assert.ok(/Contrat fibre Orange/i.test(letter.body));
  assert.ok((letter.factsUsed ?? []).length > 0);
  assert.equal(letter.recipient, "Orange");

  const refundLetter = buildFallbackLetter(
    "remboursement",
    analysis({
      title: "Facture EDF",
      organizations: ["EDF"],
      amounts: ["240 €"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
    "Test remboursement",
  );
  assert.ok(/240/i.test(refundLetter.body));
  assert.ok(/remboursement/i.test(refundLetter.subject + refundLetter.body));

  const parsed = parseReadyReplyResponse(
    JSON.stringify({
      required: true,
      reason: "Contestation générée",
      subject: "Contestation facture",
      body: "Madame, Monsieur,\n\nJe conteste…",
      letterType: "contestation",
      recipient: "EDF",
      factsUsed: ["Montant : 120 €", "Date : 01/03/2026"],
    }),
    "fallback",
  );
  assert.equal(parsed.letterType, "contestation");
  assert.equal(parsed.recipient, "EDF");
  assert.deepEqual(parsed.factsUsed, [
    "Montant : 120 €",
    "Date : 01/03/2026",
  ]);

  console.log("OK test-letter-agent", {
    types: [
      resiliation.letterType,
      refund.letterType,
      contest.letterType,
      admin.letterType,
    ],
    recipient: letter.recipient,
  });
}

main();
