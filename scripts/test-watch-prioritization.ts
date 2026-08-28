import assert from "node:assert/strict";
import { mergeWithLocalRiskFindings } from "../src/ai/post-processing/inject-local-risk-findings";
import {
  filterGenericImportantPoints,
  isVacuousGenericWatchTitle,
  rankFindingsForWatch,
  resolveWatchDocFamily,
} from "../src/ai/post-processing/watch-ranking";
import { verifyAnalysisDraft } from "../src/ai/reasoning/verify-analysis";
import type { RiskFinding } from "../src/types";

const CONTRAT = `
CONTRAT ABONNEMENT FIBRE
Engagement de 24 mois à compter de la date d'activation.
En cas de résiliation anticipée, des frais de 149 € seront dus.
Le présent contrat est reconduit par tacite reconduction.
Frais de service mensuels : 3,99 € / mois hors forfait.
Pénalité de non-retour du matériel (box) : 120 €.
Préavis de résiliation : 30 jours avant l'échéance.
À défaut de paiement, poursuites possibles.
`;

const ASSURANCE = `
CONTRAT MUTUELLE SANTÉ
Renouvellement par tacite reconduction chaque année.
Franchise de 50 € par sinistre.
Frais de gestion de dossier : 12 €.
Pénalité de résiliation anticipée : 80 €.
Délai de carence de 3 mois pour les soins dentaires.
Date limite de modification : 2 mois avant l'échéance.
`;

const MED = `
MISE EN DEMEURE
Nous vous mettons en demeure de payer la somme totale de 274 € sous 8 jours.
Pénalité de retard de 40 € et frais de recouvrement de 23 €.
À défaut, huissier de justice.
Délai de 10 jours pour contester.
`;

const BAIL = `
BAIL D'HABITATION
Entre le bailleur et le locataire.
Durée du bail : 3 ans à compter de la prise d'effet.
Loyer mensuel hors charges : 1 050 €.
Provisions pour charges : 80 € par mois.
Dépôt de garantie : 2 100 €.
Le présent bail est reconduit par tacite reconduction.
Préavis du locataire : 3 mois.
Clause résolutoire en cas de défaut de paiement du loyer.
Honoraires de mise en location : 450 €.
Révision du loyer selon l'IRL.
Capital social de l'agence : 50 000 €.
Garantie financière d'agence : 120 000 €.
Délai de 10 jours pour restitution des clés après état des lieux.
`;

function titles(findings: RiskFinding[]): string[] {
  return findings.map((f) => f.description);
}

function finding(
  description: string,
  criterion_id: RiskFinding["criterion_id"] = "delais",
): RiskFinding {
  return {
    description,
    severity: "modere",
    status: "confirmed",
    confidence: 0.8,
    criterion_id,
    excerpt: description,
    why: "test",
    implication: "test",
    consequence: "test",
    mitigation: "test",
    justification: "test",
    impact: "test",
  };
}

// Familles
assert.equal(
  resolveWatchDocFamily({ category: "contrat", textHint: CONTRAT }),
  "abonnement",
);
assert.equal(
  resolveWatchDocFamily({ category: "assurance", textHint: ASSURANCE }),
  "assurance",
);
assert.equal(
  resolveWatchDocFamily({ textHint: MED }),
  "recouvrement",
);
assert.equal(
  resolveWatchDocFamily({ category: "bail", textHint: BAIL }),
  "bail",
);

const TAXE = `
DIRECTION GÉNÉRALE DES FINANCES PUBLIQUES
Avis de prélèvement — Taxe foncière 2024

Montant à prélever : 1 178,00 €
Date de prélèvement : 27/10/2025
Opposition possible avant le 01/10/2025.
Majoration de 10 % en cas de retard.

Information : suite à la suppression de la taxe d'habitation,
le produit national de la taxe s'élève à 234 079 050 €
pour l'ensemble des foyers et des collectivités.
`;

assert.equal(
  resolveWatchDocFamily({ category: "impots", textHint: TAXE }),
  "administratif",
);

// Correctif #3 : taxe foncière / avis de prélèvement
{
  const merged = mergeWithLocalRiskFindings([], TAXE, {
    category: "impots",
    documentType: "Avis de prélèvement",
    title: "Taxe foncière",
  });
  const verified = verifyAnalysisDraft(
    {
      document_type: "Avis de prélèvement — Taxe foncière",
      title: "Taxe foncière",
      summary: "Avis",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [
        "Date limite pour résilier / modifier",
        "Produit national 234 079 050 €",
      ],
      risks: [],
      actions: [],
      risk_findings: [
        ...merged,
        {
          description: "Produit national de la taxe : 234 079 050 €",
          why: "noise",
          implication: "noise",
          consequence: "noise",
          mitigation: "noise",
          justification: "noise",
          impact: "noise",
          excerpt: "produit national de la taxe s'élève à 234 079 050 €",
          confidence: 0.5,
          severity: "faible",
          criterion_id: "frais_caches",
          status: "confirmed",
        },
      ],
    },
    TAXE,
  );
  const ranked = rankFindingsForWatch(
    (verified.risk_findings ?? []).filter((f) => f.status === "confirmed"),
    {
      category: "impots",
      documentType: "Avis de prélèvement",
      title: "Taxe foncière",
      textHint: TAXE,
    },
  );
  const top = titles(ranked);
  console.log("TAXE_TOP", top);
  assert.ok(
    top.some((t) => /Taxe foncière\s*:\s*1\s*178/i.test(t)),
    "taxe foncière due en tête",
  );
  assert.ok(
    top.some((t) => /Pr[ée]l[eè]vement\s+le\s+27\/10\/2025/i.test(t)),
    "date de prélèvement",
  );
  assert.ok(
    top.some((t) => /Opposition possible avant le\s+01\/10\/2025/i.test(t)),
    "opposition",
  );
  assert.ok(
    !top.some((t) => /234\s*079\s*050|produit\s+national/i.test(t)),
    "pas de total national",
  );
  assert.ok(/^Taxe foncière/i.test(top[0] ?? ""), "montant dû en premier");
}

// Correctif #2 : titres génériques vides
assert.equal(
  isVacuousGenericWatchTitle("Date limite pour résilier / modifier"),
  true,
);
assert.equal(isVacuousGenericWatchTitle("Obligation de payer"), true);
assert.equal(isVacuousGenericWatchTitle("Obligation de régulariser"), true);
assert.equal(isVacuousGenericWatchTitle("Délai 30 jours"), true);
assert.equal(isVacuousGenericWatchTitle("Délai : 10 jours"), true);
assert.equal(
  isVacuousGenericWatchTitle("Frais de tenue de compte : 15 €"),
  false,
);
assert.equal(
  isVacuousGenericWatchTitle("Dépôt de garantie : 2 100 €"),
  false,
);
assert.equal(isVacuousGenericWatchTitle("Préavis 1 mois"), false);
assert.equal(
  isVacuousGenericWatchTitle("Pénalité remboursement anticipé 3 %"),
  false,
);

{
  const filtered = filterGenericImportantPoints([
    "Date limite pour résilier / modifier",
    "Obligation de payer",
    "Délai 30 jours",
    "Frais de dossier : 15 €",
    "Préavis de résiliation : 1 mois",
  ]);
  assert.deepEqual(filtered, [
    "Frais de dossier : 15 €",
    "Préavis de résiliation : 1 mois",
  ]);
}

// Hors recouvrement : génériques masqués s’il existe des points concrets
{
  const ranked = rankFindingsForWatch(
    [
      finding("Date limite pour résilier / modifier", "resiliation"),
      finding("Obligation de payer", "obligations_importantes"),
      finding("Délai 30 jours", "delais"),
      finding("Frais de service : 15 €", "frais_caches"),
      finding("Dépôt de garantie : 2 100 €", "frais_caches"),
      finding("Préavis 1 mois", "resiliation"),
    ],
    { category: "bail", documentType: "Bail" },
  );
  const top = titles(ranked);
  console.log("GENERIC_FILTER_TOP", top);
  assert.ok(top.every((t) => !isVacuousGenericWatchTitle(t)));
  assert.ok(top.some((t) => /15\s*€|2\s*100|pr[ée]avis/i.test(t)));
  assert.ok(!top.some((t) => /Date limite pour r[ée]silier/i.test(t)));
  assert.ok(!top.some((t) => /^Obligation de payer$/i.test(t)));
  assert.ok(!top.some((t) => /^D[ée]lai\s+30\s+jours$/i.test(t)));
}

// Repli : uniquement des génériques → on en garde quelques-uns
{
  const ranked = rankFindingsForWatch(
    [
      finding("Date limite pour résilier / modifier", "resiliation"),
      finding("Obligation de payer", "obligations_importantes"),
      finding("Délai 30 jours", "delais"),
    ],
    { category: "contrat", documentType: "Contrat" },
  );
  assert.ok(ranked.length > 0 && ranked.length <= 3);
}

// Abonnement : pas de « obligation de payer » / « menace » en tête
{
  const merged = mergeWithLocalRiskFindings([], CONTRAT, {
    category: "contrat",
    documentType: "Contrat Internet",
  });
  const verified = verifyAnalysisDraft(
    {
      document_type: "Contrat Internet",
      title: "Fibre",
      summary: "Abonnement",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_findings: merged,
    },
    CONTRAT,
  );
  const ranked = rankFindingsForWatch(
    (verified.risk_findings ?? []).filter((f) => f.status === "confirmed"),
    { category: "contrat", documentType: "Contrat Internet", title: "Fibre" },
  );
  const top = titles(ranked).slice(0, 5);
  console.log("ABONNEMENT_TOP", top);
  assert.ok(
    top.some((t) => /engagement/i.test(t)),
    "engagement first-ish",
  );
  assert.ok(
    top.some((t) => /tacite|reconduction/i.test(t)),
    "tacite present",
  );
  assert.ok(
    !/^Obligation de payer/i.test(top[0] ?? ""),
    "generic pay not first",
  );
  assert.ok(
    !/^Menace de poursuites/i.test(top[0] ?? ""),
    "generic threat not first",
  );
}

// Assurance
{
  const merged = mergeWithLocalRiskFindings([], ASSURANCE, {
    category: "assurance",
  });
  const verified = verifyAnalysisDraft(
    {
      document_type: "Mutuelle",
      title: "Mutuelle",
      summary: "Santé",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_findings: merged,
    },
    ASSURANCE,
  );
  const ranked = rankFindingsForWatch(
    (verified.risk_findings ?? []).filter((f) => f.status === "confirmed"),
    { category: "assurance", documentType: "Mutuelle" },
  );
  const top = titles(ranked).slice(0, 5);
  console.log("ASSURANCE_TOP", top);
  assert.ok(top.some((t) => /tacite|reconduction/i.test(t)), "tacite");
  assert.ok(top.some((t) => /franchise|frais|carence|p[ée]nalit/i.test(t)));
}

// Mise en demeure inchangée
{
  const merged = mergeWithLocalRiskFindings([], MED, {
    category: "courrier-administratif",
    documentType: "Mise en demeure",
  });
  const verified = verifyAnalysisDraft(
    {
      document_type: "Mise en demeure",
      title: "MED",
      summary: "Créance",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_findings: merged,
    },
    MED,
  );
  const ranked = rankFindingsForWatch(
    (verified.risk_findings ?? []).filter((f) => f.status === "confirmed"),
    { documentType: "Mise en demeure", textHint: MED },
  );
  const top = titles(ranked);
  console.log("MED_TOP", top);
  assert.ok(
    top.some((t) =>
      /Total r[ée]clam|P[ée]nalit|Frais de recouvrement|huissier|contester/i.test(
        t,
      ),
    ),
  );
  assert.ok(/^Total\s+r[ée]clam/i.test(top[0] ?? ""), "total réclamé en premier");
}

// Bail : loyer / charges / dépôt / durée / préavis avant délai générique
{
  const merged = mergeWithLocalRiskFindings([], BAIL, {
    category: "bail",
    documentType: "Bail d'habitation",
  });
  const verified = verifyAnalysisDraft(
    {
      document_type: "Bail d'habitation",
      title: "Bail",
      summary: "Location",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_findings: merged,
    },
    BAIL,
  );
  const ranked = rankFindingsForWatch(
    (verified.risk_findings ?? []).filter((f) => f.status === "confirmed"),
    { category: "bail", documentType: "Bail d'habitation", title: "Bail" },
  );
  const top = titles(ranked).slice(0, 7);
  console.log("BAIL_TOP", top);
  assert.ok(top.some((t) => /loyer/i.test(t)), "loyer present");
  assert.ok(top.some((t) => /charges/i.test(t)), "charges present");
  assert.ok(top.some((t) => /d[ée]p[ôo]t/i.test(t)), "depot present");
  const top5 = top.slice(0, 5);
  assert.ok(top5.some((t) => /loyer/i.test(t)), "loyer in top 5");
  assert.ok(top5.some((t) => /charges/i.test(t)), "charges in top 5");
  assert.ok(top5.some((t) => /d[ée]p[ôo]t/i.test(t)), "depot in top 5");
  assert.ok(/^Loyer/i.test(top5[0] ?? ""), "loyer first in top 5");
  assert.ok(
    !/^Délai\s*\/\s*préavis\s*:\s*10/i.test(top[0] ?? ""),
    "generic 10-day delay not first",
  );
  assert.ok(
    !top.some((t) =>
      /50\s*000|120\s*000|capital\s+social|garantie\s+financi/i.test(t),
    ),
    "no agency capital noise",
  );
}

const RELEVE = `
RELEVÉ DE COMPTE — BANQUE POPULAIRE
Période du 01/01/2025 au 31/01/2025

Commission d'intervention : 8,50 €
Intérêts débiteurs : 12,34 €
Frais de rejet de prélèvement : 20 €
Découvert autorisé dépassé le 15/01/2025
Inscription au Fichier des Incidents de remboursement (FICP) possible.
Date de régularisation : 28/02/2025
`;

// Relevé bancaire : frais / intérêts / FICP — pas de résiliation
{
  const merged = mergeWithLocalRiskFindings([], RELEVE, {
    category: "banque",
    documentType: "Relevé bancaire",
  });
  const verified = verifyAnalysisDraft(
    {
      document_type: "Relevé bancaire",
      title: "Relevé janvier",
      summary: "Compte",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_findings: [
        ...merged,
        finding("Date limite pour résilier / modifier", "resiliation"),
        finding("Engagement 24 mois", "engagement"),
      ],
    },
    RELEVE,
  );
  const ranked = rankFindingsForWatch(
    (verified.risk_findings ?? []).filter((f) => f.status === "confirmed"),
    { category: "banque", documentType: "Relevé bancaire", textHint: RELEVE },
  );
  const top = titles(ranked).slice(0, 5);
  console.log("BANQUE_TOP", top);
  assert.ok(top.some((t) => /commission|intervention|8[,.]50/i.test(t)));
  assert.ok(!top.some((t) => /r[ée]silier|engagement\s+24/i.test(t)));
  assert.equal(
    resolveWatchDocFamily({ category: "banque", textHint: RELEVE }),
    "banque",
  );
}

const FACTURE = `
FACTURE N° 2025-042
Date d'échéance : 15/03/2025
Total TTC : 120,00 €
Frais de dossier : 15,00 €
Pénalités de retard : 40 € par mois de retard.
`;

// Facture : total TTC avant frais annexes
{
  const merged = mergeWithLocalRiskFindings([], FACTURE, {
    category: "facture",
    documentType: "Facture",
  });
  const ranked = rankFindingsForWatch(
    merged,
    { category: "facture", documentType: "Facture", textHint: FACTURE },
  );
  const top = titles(ranked).slice(0, 5);
  console.log("FACTURE_TOP", top);
  assert.ok(/^Total\s+TTC/i.test(top[0] ?? "") || /120/.test(top[0] ?? ""));
  assert.ok(/^Total\s+TTC/i.test(top[0] ?? ""), "total TTC en premier");
  const ttcIdx = top.findIndex((t) => /total\s+ttc|120/i.test(t));
  const fraisIdx = top.findIndex((t) => /frais\s+de\s+dossier|15/i.test(t));
  if (ttcIdx >= 0 && fraisIdx >= 0) {
    assert.ok(ttcIdx < fraisIdx, "total TTC avant frais dossier");
  }
}

console.log("OK watch prioritization by document family");
