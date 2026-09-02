/**
 * Tests agent courrier (suggestion + qualité + fallback, sans LLM).
 */
import assert from "assert";

import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import {
  collectAllowedLetterFacts,
  deriveFactsUsedInLetter,
  isLetterNoiseFact,
  sanitizeRecipient,
  validateLetterBody,
} from "../src/services/reply/letter-quality";
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
  // --- Relevé bancaire Banque Horizon (multi-frais) ---
  const bankText = [
    "BANQUE HORIZON",
    "Relevé de compte n° 123456789",
    "Période du 01/01/2026 au 31/01/2026",
    "Commission de tenue de compte : 2,71 €",
    "Frais de mouvement : 3,22 €",
    "Commission d'intervention : 12,00 €",
    "Agios de découvert : 26,23 €",
    "Taux d'intérêts débiteurs : 14,5 %",
    "Signaler tout changement d'adresse sous 30 jours.",
    "Traiter les réclamations sous 30 jours.",
  ].join("\n");

  const bankAnalysis = analysis({
    document_type: "Relevé bancaire",
    title: "Relevé de compte — période du 01/01/2026 au 31/01/2026",
    summary: "Relevé mensuel avec plusieurs frais bancaires.",
    organizations: ["Banque Horizon"],
    amounts: ["2,71 €", "3,22 €", "12,00 €", "26,23 €"],
    deadlines: [
      "Signaler tout changement d'adresse sous 30 jours",
      "Traiter les réclamations sous 30 jours",
    ],
    actions: ["Vérifier les frais bancaires"],
    risks: ["Frais de tenue de compte"],
  });

  const bankSuggestion = suggestLetterType(bankText, bankAnalysis, {
    category: "banque",
    label: "Banque",
    confidence: 0.95,
  });

  assert.notEqual(bankSuggestion.letterType, "resiliation");
  assert.equal(bankSuggestion.docFamily, "banque");

  const bankFacts = collectAllowedLetterFacts({
    documentText: bankText,
    analysis: bankAnalysis,
    letterType: "contestation",
    family: "banque",
  });
  const amountFacts = bankFacts.filter((f) => f.label.startsWith("Montant :"));
  assert.ok(amountFacts.length >= 2, "≥2 montants/frais dans les faits autorisés");
  assert.ok(
    !bankFacts.some((f) => /changement d'adresse/i.test(f.label)),
    "0 obligation client dans faits",
  );
  assert.ok(isLetterNoiseFact("Signaler tout changement d'adresse sous 30 jours"));

  const bankLetter = buildFallbackLetter(
    "contestation",
    bankAnalysis,
    { category: "banque", label: "Banque", confidence: 0.95 },
    bankSuggestion.reason,
    bankText,
  );

  assert.ok(!/r[ée]sili/i.test(bankLetter.subject));
  assert.ok(bankLetter.subject.length <= 80);
  assert.ok(validateLetterBody(bankLetter.body).valid, "corps complet");
  assert.ok(/Madame, Monsieur/.test(bankLetter.body));
  assert.ok(/salutations distinguées/i.test(bankLetter.body));
  assert.ok(!/\bJe\s*$/m.test(bankLetter.body.trim()), "pas tronqué en « Je »");
  assert.ok(
    (bankLetter.body.match(/\d+[,.]\d{2}\s*€/g) ?? []).length >= 2,
    "≥2 frais cités dans le corps",
  );
  assert.ok(
    !/Signaler tout changement/i.test(bankLetter.body),
    "pas d'obligation client dans le corps",
  );
  assert.ok(
    !(bankLetter.factsUsed ?? []).some((f) => /changement d'adresse/i.test(f)),
    "preuves sans obligation client",
  );
  assert.ok(
    !/71 rue de la République/i.test(bankLetter.body),
    "0 adresse inventée",
  );

  const inventedRecipient = sanitizeRecipient(
    "Banque Horizon\n71 rue de la République\n75001 Paris",
    ["Banque Horizon"],
    bankText,
    bankAnalysis.title,
  );
  assert.equal(inventedRecipient, "Banque Horizon", "adresse inventée supprimée");

  // --- Mise en demeure ---
  const recouvrement = suggestLetterType(
    "Mise en demeure de payer — montant impayé 450 €. Réponse attendue sous 15 jours.",
    analysis({
      title: "Mise en demeure",
      amounts: ["450 €"],
      deadlines: ["Réponse sous 15 jours"],
    }),
    {
      category: "courrier-administratif",
      label: "Courrier administratif",
      confidence: 0.9,
    },
  );
  assert.notEqual(recouvrement.letterType, "resiliation");

  const recouvrementLetter = buildFallbackLetter(
    recouvrement.letterType,
    analysis({
      title: "Mise en demeure",
      amounts: ["450 €"],
      organizations: ["Société Créance SA"],
      deadlines: ["Réponse sous 15 jours"],
    }),
    {
      category: "courrier-administratif",
      label: "Courrier administratif",
      confidence: 0.9,
    },
    recouvrement.reason,
    "Mise en demeure de payer 450 €",
  );
  assert.ok(validateLetterBody(recouvrementLetter.body).valid);

  // --- Facture abonnement ---
  const invoice = suggestLetterType(
    "Facture Orange Internet — forfait fibre 39,99 €/mois. Résilier avant le 01/05/2026.",
    analysis({
      title: "Facture Orange Internet",
      organizations: ["Orange"],
      amounts: ["39,99 €"],
      actions: ["Envoyer un courrier de résiliation"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
  );
  assert.equal(invoice.letterType, "resiliation");

  const invoiceLetter = buildFallbackLetter(
    "resiliation",
    analysis({
      title: "Facture Orange Internet",
      organizations: ["Orange"],
      amounts: ["39,99 €"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
    invoice.reason,
    "Contrat abonnement fibre Orange",
  );
  assert.ok(validateLetterBody(invoiceLetter.body).valid);

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

  const bailLetter = buildFallbackLetter(
    bail.letterType,
    analysis({
      title: "Bail location",
      organizations: ["Agence Immo Plus"],
      amounts: ["850 €"],
    }),
    { category: "bail", label: "Bail", confidence: 0.92 },
    bail.reason,
    "Bail location vide",
  );
  assert.ok(validateLetterBody(bailLetter.body).valid);

  // --- deriveFactsUsedInLetter ---
  const bodySample =
    "Madame, Monsieur,\n\nJe conteste les frais de 2,71 € et 12,00 €.\n\nSalutations distinguées.";
  const derived = deriveFactsUsedInLetter(bodySample, bankFacts);
  assert.ok(derived.length >= 1 && derived.length <= 8);

  const parsed = parseReadyReplyResponse(
    JSON.stringify({
      required: true,
      reason: "Contestation générée",
      subject: "Contestation facture",
      body: "Madame, Monsieur,\n\nJe conteste le montant de 120 € figurant sur ma facture. Je vous demande un réexamen sous trente jours.\n\nJe vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.\n\n[Votre nom]",
      letterType: "contestation",
      recipient: "EDF",
      factsUsed: ["Montant : 120 €"],
    }),
    "fallback",
  );
  assert.equal(parsed.letterType, "contestation");

  console.log("OK test-letter-agent", {
    bank: bankSuggestion.letterType,
    bankFeesInBody: (bankLetter.body.match(/\d+[,.]\d{2}\s*€/g) ?? []).length,
    bankFacts: bankLetter.factsUsed?.length,
    recouvrement: recouvrement.letterType,
    words: bankLetter.body.split(/\s+/).length,
  });
}

main();
