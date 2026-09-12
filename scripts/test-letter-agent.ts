/**
 * Tests agent courrier (suggestion + qualité + fallback, sans LLM).
 */
import assert from "assert";
import fs from "fs";
import path from "path";

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
import {
  extractOrganizations,
  extractPeople,
} from "../src/services/extraction/people-orgs";
import { suggestLetterType } from "../src/services/reply/suggest-type";
import { parseReadyReplyResponse } from "../src/ai/validation/reply";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type {
  DocumentAnalysis,
  DocumentClassification,
  LetterType,
} from "../src/types";

function normalizePerson(value: string): string {
  return value
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

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

  // --- Destinataire universel : org/émetteur, jamais persons[0] ---
  const recipientCases: Array<{
    name: string;
    file: string;
    orgOk: RegExp;
    letterType: LetterType;
    category: DocumentClassification["category"];
    label: string;
  }> = [
    {
      name: "free",
      file: "test-documents/factures-free/01-facture-free-fre-174846.md",
      orgOk: /free|service\s+(?:clients|facturation)/i,
      letterType: "contestation",
      category: "facture",
      label: "Facture",
    },
    {
      name: "mutuelle",
      file: "test-documents/mutuelles/01-contrat-mutuelle-sante-mut-437004.md",
      orgOk: /mutuelle\s+sant[eé]\s+[ée]quilibre/i,
      letterType: "autre",
      category: "assurance",
      label: "Mutuelle",
    },
    {
      name: "releve",
      file: "test-documents/banques/03-releve-bancaire-banque-horizon-bqe-463739.md",
      orgOk: /horizon|banque/i,
      letterType: "contestation",
      category: "banque",
      label: "Banque",
    },
    {
      name: "pret",
      file: "test-documents/contrats-de-pret/01-offre-de-pret-personnel-prt-637352.md",
      orgOk: /cr[ée]dit|serein/i,
      letterType: "autre",
      category: "contrat",
      label: "Offre de prêt",
    },
    {
      name: "caf",
      file: "test-documents/caf/01-notification-caf-caf-500877.md",
      orgOk: /caisse|allocations|caf/i,
      letterType: "reponse_administrative",
      category: "courrier-administratif",
      label: "Notification CAF",
    },
    {
      name: "med",
      file: "test-documents/relances-de-paiement/01-mise-en-demeure-de-paiement-rel-681955.md",
      orgOk: /recouvrement|service/i,
      letterType: "contestation",
      category: "courrier-administratif",
      label: "Mise en demeure",
    },
  ];

  for (const c of recipientCases) {
    const text = fs.readFileSync(path.join(process.cwd(), c.file), "utf8");
    const orgs = extractOrganizations(text);
    const people = extractPeople(text);
    assert.ok(
      people.length > 0,
      `${c.name}: persons[0] attendu pour le test`,
    );
    const person0 = people[0]!;

    const letter = buildFallbackLetter(
      c.letterType,
      analysis({
        title: text.split(/\r?\n/).find((l) => l.trim().startsWith("#")) ?? c.name,
        organizations: orgs,
        people,
      }),
      { category: c.category, label: c.label, confidence: 0.9 },
      `Test destinataire ${c.name}`,
      text,
    );
    assert.ok(
      c.orgOk.test(letter.recipient),
      `${c.name} recipient org: ${letter.recipient}`,
    );
    assert.ok(
      normalizePerson(letter.recipient) !== normalizePerson(person0) &&
        !normalizePerson(letter.recipient).includes(normalizePerson(person0)),
      `${c.name} recipient = persons[0] (${person0}): ${letter.recipient}`,
    );

    // Org absente dans l'analyse → marque / titre / en-tête
    const letterNoOrgs = buildFallbackLetter(
      c.letterType,
      analysis({
        title: text.split(/\r?\n/).find((l) => l.trim().startsWith("#")) ?? c.name,
        organizations: [],
        people,
      }),
      { category: c.category, label: c.label, confidence: 0.9 },
      `Test destinataire sans org ${c.name}`,
      text,
    );
    assert.ok(
      c.orgOk.test(letterNoOrgs.recipient),
      `${c.name} fallback titre/marque: ${letterNoOrgs.recipient}`,
    );
    assert.ok(
      normalizePerson(letterNoOrgs.recipient) !== normalizePerson(person0),
      `${c.name} fallback persons[0]: ${letterNoOrgs.recipient}`,
    );

    const sanitized = sanitizeRecipient(
      person0,
      [],
      text,
      c.label,
      people,
    );
    assert.ok(
      c.orgOk.test(sanitized) &&
        normalizePerson(sanitized) !== normalizePerson(person0),
      `${c.name} sanitize persons[0] → org: ${sanitized}`,
    );

    if (c.name === "mutuelle") {
      assert.ok(
        orgs.some((o) => /mutuelle\s+sant[eé]\s+[ée]quilibre/i.test(o)),
        `mutuelle org complète: ${orgs.join(" | ")}`,
      );
      assert.ok(
        !orgs.some((o) => /^mutuelle\s+sant$/i.test(o.trim())),
        `mutuelle org tronquée: ${orgs.join(" | ")}`,
      );
    }
    if (c.name === "free") {
      assert.match(letter.recipient, /service\s+clients\s*[—–-]\s*free/i);
    }
  }

  // MED composite « personne - org » ne doit pas fuiter
  const medLeak = sanitizeRecipient(
    "Chloé Garcia - Service recouvrement",
    [],
    "Mise en demeure — Service recouvrement. Total réclamé : 451 €.",
    "Mise en demeure",
    [],
  );
  assert.ok(
    /recouvrement/i.test(medLeak) && !/chlo[eé]/i.test(medLeak),
    `MED composite leak: ${medLeak}`,
  );

  // Free : destinataire ≠ abonné + objet avec réf FRE-
  const freeCase = recipientCases.find((c) => c.name === "free")!;
  const freeText2 = fs.readFileSync(
    path.join(process.cwd(), freeCase.file),
    "utf8",
  );
  const freeLetterRef = buildFallbackLetter(
    "contestation",
    analysis({
      title: "Facture Free",
      organizations: extractOrganizations(freeText2),
      people: extractPeople(freeText2),
      amounts: ["Abonnement : 72,62 €", "Total TTC : 88,80 €"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
    "Contestation",
    freeText2,
  );
  assert.ok(
    /FRE-?\d+/i.test(freeLetterRef.subject) || /free/i.test(freeLetterRef.recipient),
    `Free ref/destinataire: ${freeLetterRef.subject} / ${freeLetterRef.recipient}`,
  );

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
