/**
 * Tests agent courrier (suggestion + qualité + fallback, sans LLM).
 */
import assert from "assert";

import { buildFallbackLetter } from "../src/services/reply/fallback-letter";
import {
  collectAllowedLetterFacts,
  deriveFactsUsedInLetter,
  extractBankFeeLines,
  isBankNonFeeLine,
  isLetterNoiseFact,
  normalizeBankFeeLine,
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
  // --- Relevé bancaire Banque Horizon (fixture sale multi-frais) ---
  const bankText = [
    "BANQUE HORIZON",
    "Relevé de compte n° 123456789",
    "Période du 01/01/2026 au 31/01/2026",
    "Découvert autorisé : 538 €",
    "Solde arrêté au 31/01/2026",
    "Commission de tenue de compte : 2,71 €",
    "Commission de tenue de compte : 2,71 €",
    "Frais de mouvement : 3,22 €",
    "Commission d'intervention : 12,00 €",
    "Frais de découvert | -26,23 €",
    "Agios de découvert : 26,23 €",
    "Taux d'intérêts débiteurs : 14,5 %",
    "u 08/10/2026 Situation • Solde arrêté créditeur",
    "Signaler sans délai tout changement d'adresse.",
    "Traiter les réclamations sous 30 jours.",
  ].join("\n");

  const bankAnalysis = analysis({
    document_type: "Relevé bancaire",
    title: "Relevé de compte — période du 01/01/2026 au 31/01/2026",
    summary: "Relevé mensuel avec plusieurs frais bancaires.",
    organizations: ["Banque Horizon"],
    amounts: [
      "2,71 €",
      "2,71 €",
      "3,22 €",
      "12,00 €",
      "26,23 €",
      "Découvert autorisé : 538 €",
      "Frais de découvert | -26,23 €",
    ],
    deadlines: [
      "Signaler sans délai tout changement d'adresse",
      "Traiter les réclamations sous 30 jours",
    ],
    important_points: [
      "u 08/10/2026 Situation • Solde arrêté",
      "Commission de tenue de compte : 2,71 €",
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
  const amountFacts = bankFacts.filter((f) => f.label.startsWith("Frais :"));
  assert.ok(amountFacts.length >= 2, "≥2 frais propres dans les faits autorisés");
  assert.ok(
    !bankFacts.some((f) => /d[ée]couvert\s+autoris/i.test(f.label)),
    "pas de découvert autorisé",
  );
  assert.ok(
    !bankFacts.some((f) => /changement d'adresse/i.test(f.label)),
    "0 obligation client dans faits",
  );
  assert.ok(
    !bankFacts.some((f) => /situation\s*•/i.test(f.label)),
    "pas de fragment Situation",
  );
  assert.ok(isLetterNoiseFact("Signaler sans délai tout changement d'adresse"));
  assert.ok(isBankNonFeeLine("Découvert autorisé : 538 €"));

  const feeLines = extractBankFeeLines(bankText, bankAnalysis);
  const count271 = feeLines.filter((l) => /2[,.]71/.test(l)).length;
  assert.equal(count271, 1, "pas de doublon 2,71 €");
  assert.ok(!feeLines.some((l) => l.includes("|")), "pas de pipe dans libellés");
  assert.ok(
    normalizeBankFeeLine("Frais de découvert | -26,23 €")?.includes("26,23 €"),
    "normalise frais découvert",
  );

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
    (bankLetter.body.match(/2[,.]71\s*€/g) ?? []).length <= 1,
    "pas de doublon 2,71 dans le corps",
  );
  assert.ok(
    !/d[ée]couvert\s+autoris/i.test(bankLetter.body),
    "pas de découvert autorisé dans le corps",
  );
  assert.ok(
    !/changement d'adresse/i.test(bankLetter.body),
    "pas d'obligation client dans le corps",
  );
  assert.ok(
    !/je prends note de l['']?échéance/i.test(bankLetter.body),
    "pas de phrase échéance obligation client",
  );
  assert.ok(!/\|/.test(bankLetter.body), "pas de pipe dans le corps");
  assert.ok(
    !/situation\s*•/i.test(bankLetter.body),
    "pas de fragment Situation dans le corps",
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
  const bodySample = `Madame, Monsieur,\n\nJe conteste les frais suivants : ${feeLines.slice(0, 2).join(", ")}.\n\nSalutations distinguées.`;
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
    feeLines: feeLines.length,
    bankFacts: bankLetter.factsUsed?.length,
    recouvrement: recouvrement.letterType,
    words: bankLetter.body.split(/\s+/).length,
  });
}

main();
