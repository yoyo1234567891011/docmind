/**
 * Tests agent courrier (suggestion par famille + fallback, sans LLM).
 */
import assert from "assert";

import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import {
  filterDeadlinesForLetter,
  isRecipientObligation,
  shortenLetterSubject,
} from "../src/services/reply/letter-intents";
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
  // --- Relevé bancaire Banque Horizon (cas réel) ---
  const bankText = [
    "BANQUE HORIZON",
    "Relevé de compte n° 123456789",
    "Période du 01/01/2026 au 31/01/2026",
    "Commission de tenue de compte : 2,50 €",
    "Signaler tout changement d'adresse sous 30 jours.",
  ].join("\n");

  const bankAnalysis = analysis({
    document_type: "Relevé bancaire",
    title: "Relevé de compte — période du 01/01/2026 au 31/01/2026",
    summary: "Relevé mensuel avec frais de tenue de compte.",
    organizations: ["Banque Horizon"],
    amounts: ["2,50 €"],
    deadlines: ["Signaler tout changement d'adresse sous 30 jours"],
    actions: ["Vérifier les frais bancaires"],
    risks: ["Frais de tenue de compte"],
  });

  const bankSuggestion = suggestLetterType(bankText, bankAnalysis, {
    category: "banque",
    label: "Banque",
    confidence: 0.95,
  });

  assert.notEqual(
    bankSuggestion.letterType,
    "resiliation",
    "relevé bancaire : pas de résiliation",
  );
  assert.equal(bankSuggestion.docFamily, "banque");
  assert.ok(
    ["contestation", "autre", "remboursement"].includes(
      bankSuggestion.letterType,
    ),
  );
  assert.ok(
    (bankSuggestion.alternatives ?? []).every((a) => a.letterType !== "resiliation"),
    "alternatives sans résiliation",
  );

  const bankLetter = buildFallbackLetter(
    bankSuggestion.letterType,
    bankAnalysis,
    { category: "banque", label: "Banque", confidence: 0.95 },
    bankSuggestion.reason,
    bankText,
  );
  assert.ok(!/r[ée]sili/i.test(bankLetter.subject), "objet sans résiliation");
  assert.ok(bankLetter.subject.length <= 80, "objet court");
  assert.ok(
    !/Signaler tout changement/i.test(bankLetter.body),
    "pas d’obligation client comme échéance",
  );
  assert.ok(
    !/période du 01\/01\/2026/i.test(bankLetter.subject),
    "pas de titre technique en objet",
  );

  // --- Mise en demeure ---
  const recouvrement = suggestLetterType(
    "Mise en demeure de payer — montant impayé 450 €. Réponse attendue sous 15 jours.",
    analysis({
      title: "Mise en demeure",
      amounts: ["450 €"],
      deadlines: ["Réponse sous 15 jours"],
      actions: ["Régler la créance ou contester"],
    }),
    {
      category: "courrier-administratif",
      label: "Courrier administratif",
      confidence: 0.9,
    },
  );
  assert.notEqual(recouvrement.letterType, "resiliation");
  assert.ok(
    ["contestation", "reponse_administrative", "remboursement"].includes(
      recouvrement.letterType,
    ),
  );

  // --- Facture abonnement ---
  const invoice = suggestLetterType(
    "Facture Orange Internet — forfait fibre 39,99 €/mois. Résilier avant le 01/05/2026.",
    analysis({
      title: "Facture Orange Internet",
      organizations: ["Orange"],
      amounts: ["39,99 €"],
      actions: ["Envoyer un courrier de résiliation"],
      risks: ["Préavis de résiliation"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
  );
  assert.equal(invoice.letterType, "resiliation");

  // --- Bail ---
  const bail = suggestLetterType(
    "Bail location vide — loyer 850 €. Congé du bail avec préavis de 3 mois.",
    analysis({
      title: "Bail location",
      amounts: ["850 €"],
      actions: ["Donner congé du logement"],
    }),
    { category: "bail", label: "Bail", confidence: 0.92 },
  );
  assert.ok(["resiliation", "autre", "contestation"].includes(bail.letterType));

  // --- Utilitaires ---
  assert.ok(
    isRecipientObligation("Signaler tout changement d'adresse sous 30 jours"),
  );
  assert.equal(
    filterDeadlinesForLetter([
      "15/04/2026",
      "Signaler tout changement d'adresse",
    ]).length,
    1,
  );
  assert.equal(
    shortenLetterSubject(
      "Relevé de compte — période du 01/01/2026 au 31/01/2026",
      "autre",
      "banque",
    ),
    "Demande d’information bancaire",
  );

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

  const letter = buildFallbackLetter(
    "resiliation",
    analysis({
      title: "Contrat fibre Orange",
      organizations: ["Orange"],
      deadlines: ["Résilier avant le 01/05/2026"],
    }),
    classification,
    "Test résiliation",
    "Contrat abonnement fibre",
  );
  assert.equal(letter.required, true);
  assert.equal(letter.letterType, "resiliation");
  assert.ok(letter.subject.length > 0);
  assert.ok(/Orange/i.test(letter.body));

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

  console.log("OK test-letter-agent", {
    bank: bankSuggestion.letterType,
    recouvrement: recouvrement.letterType,
    invoice: invoice.letterType,
    bail: bail.letterType,
    bankSubject: bankLetter.subject,
  });
}

main();
