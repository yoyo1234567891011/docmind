import { spawnSync } from "child_process";
import { mkdir, readdir, rm, writeFile } from "fs/promises";
import path from "path";

import { expandToRealisticDocument } from "./lib/expand-test-document.mjs";

const ROOT = path.join(process.cwd(), "test-documents");

const FIRST_NAMES = [
  "Camille", "Lucas", "Léa", "Hugo", "Chloé", "Nathan", "Manon", "Louis",
  "Emma", "Gabriel", "Inès", "Arthur", "Jade", "Raphaël", "Sarah", "Adam",
  "Nina", "Théo", "Clara", "Maxime", "Pauline", "Julien", "Sophie", "Antoine",
];

const LAST_NAMES = [
  "Martin", "Bernard", "Dubois", "Thomas", "Robert", "Richard", "Petit",
  "Durand", "Leroy", "Moreau", "Simon", "Laurent", "Lefebvre", "Michel",
  "Garcia", "David", "Bertrand", "Roux", "Vincent", "Fournier", "Morel",
  "Girard", "André", "Mercier",
];

const CITIES = [
  ["Lyon", "69003"], ["Nantes", "44000"], ["Toulouse", "31000"],
  ["Bordeaux", "33000"], ["Lille", "59000"], ["Rennes", "35000"],
  ["Strasbourg", "67000"], ["Montpellier", "34000"], ["Nice", "06000"],
  ["Dijon", "21000"], ["Angers", "49000"], ["Reims", "51100"],
];

const STREETS = [
  "12 rue des Lilas", "45 avenue Victor Hugo", "8 impasse des Cerisiers",
  "27 boulevard Gambetta", "3 place de la République", "19 chemin du Moulin",
  "61 rue Sainte-Catherine", "14 allée des Tilleuls", "88 rue Nationale",
  "5 résidence Les Oliviers",
];

const CATEGORIES = [
  { id: "assurances", label: "Assurances", count: 6 },
  { id: "banques", label: "Banques", count: 6 },
  { id: "impots", label: "Impôts", count: 6 },
  { id: "caf", label: "CAF", count: 5 },
  { id: "mutuelles", label: "Mutuelles", count: 5 },
  { id: "contrats-de-travail", label: "Contrats de travail", count: 6 },
  { id: "baux-de-location", label: "Baux de location", count: 6 },
  { id: "factures-edf", label: "Factures EDF", count: 6 },
  { id: "factures-orange", label: "Factures Orange", count: 5 },
  { id: "factures-free", label: "Factures Free", count: 5 },
  { id: "factures-sfr", label: "Factures SFR", count: 5 },
  { id: "contrats-internet", label: "Contrats Internet", count: 5 },
  { id: "contrats-telephoniques", label: "Contrats téléphoniques", count: 5 },
  { id: "courriers-administratifs", label: "Courriers administratifs", count: 6 },
  { id: "relances-de-paiement", label: "Relances de paiement", count: 6 },
  { id: "conditions-generales-de-vente", label: "Conditions générales de vente", count: 6 },
  { id: "devis", label: "Devis", count: 6 },
  { id: "contrats-de-pret", label: "Contrats de prêt", count: 5 },
];

function seededRandom(seed) {
  let value = seed % 2147483647;
  if (value <= 0) value += 2147483646;
  return () => {
    value = (value * 16807) % 2147483647;
    return (value - 1) / 2147483646;
  };
}

function pick(rng, list) {
  return list[Math.floor(rng() * list.length)];
}

function formatMoney(value, decimals = 2) {
  return Number(value).toLocaleString("fr-FR", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

function randomAmount(rng, min, max) {
  return min + rng() * (max - min);
}

function money(rng, min, max, decimals = 2) {
  return formatMoney(randomAmount(rng, min, max), decimals);
}

function euro(value, decimals = 2) {
  return `${formatMoney(value, decimals)} €`;
}

function dateFr(year, month, day) {
  return `${String(day).padStart(2, "0")}/${String(month).padStart(2, "0")}/${year}`;
}

function futureDate(rng, baseYear = 2026) {
  return dateFr(baseYear, 1 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 28));
}

function pastDate(rng, baseYear = 2025) {
  return dateFr(baseYear, 1 + Math.floor(rng() * 12), 1 + Math.floor(rng() * 28));
}

function person(rng) {
  const firstName = pick(rng, FIRST_NAMES);
  const lastName = pick(rng, LAST_NAMES);
  return { firstName, lastName, fullName: `${firstName} ${lastName}` };
}

function address(rng) {
  const [city, zip] = pick(rng, CITIES);
  const street = pick(rng, STREETS);
  return { street, city, zip, line: `${street}, ${zip} ${city}` };
}

function ref(prefix, rng) {
  return `${prefix}-${Math.floor(100000 + rng() * 899999)}`;
}

function unique(values) {
  return [...new Set(values.filter(Boolean))];
}

/**
 * Ensures every expected deadline is grounded in the document body
 * (explicit date or enough overlapping significant tokens).
 */
function assertDeadlinesGroundedInDocument(body, deadlines, context) {
  const normalizedBody = body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  for (const deadline of deadlines) {
    const value = String(deadline).trim();
    if (!value) continue;

    const dateMatch = value.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    if (dateMatch && normalizedBody.includes(dateMatch[0])) {
      continue;
    }

    const normalizedDeadline = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (normalizedBody.includes(normalizedDeadline)) {
      continue;
    }

    const tokens = normalizedDeadline
      .split(/[^a-z0-9]+/)
      .filter((token) => token.length > 3);
    const hits = tokens.filter((token) => normalizedBody.includes(token)).length;
    const required = Math.max(1, Math.ceil(tokens.length * 0.6));

    if (tokens.length === 0 || hits < required) {
      throw new Error(
        `Deadline non ancrée dans le document [${context}]: "${value}"`,
      );
    }
  }
}

function computeRiskScore(flags) {
  let score = 0;
  if (flags.penalties) score += 18;
  if (flags.autoRenewal) score += 15;
  if (flags.hiddenFees) score += 15;
  if (flags.shortDeadline) score += 15;
  if (flags.obligations) score += 18;
  if (flags.sanctions) score += 15;
  return Math.min(100, score);
}

function makeExpected({
  documentType,
  title,
  summary,
  people = [],
  organizations = [],
  amounts = [],
  dates = [],
  deadlines = [],
  importantPoints = [],
  risks = [],
  actions = [],
  flags = {},
  documentBody = "",
}) {
  const groundedDeadlines = unique(deadlines);
  if (documentBody) {
    assertDeadlinesGroundedInDocument(documentBody, groundedDeadlines, title);
  }

  return {
    document_type: documentType,
    title,
    summary,
    people: unique(people),
    organizations: unique(organizations),
    amounts: unique(amounts),
    dates: unique(dates),
    deadlines: groundedDeadlines,
    important_points: unique(importantPoints),
    risks: unique(risks),
    actions: unique(actions),
    risk_score: computeRiskScore(flags),
  };
}

function footerDisclaimer() {
  return [

    "---",
    "",
    "*Document fictif généré uniquement à des fins de test DocMind. Aucune valeur juridique. Ne reproduit aucun document réel protégé.*",
  ].join("\n");
}

function buildAssurance(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const premium = randomAmount(rng, 18, 89);
  const franchise = randomAmount(rng, 150, 500);
  const fee = randomAmount(rng, 35, 90);
  const claimFee = randomAmount(rng, 25, 80);
  const effect = pastDate(rng, 2025);
  const renew = futureDate(rng, 2026);
  const deadline = futureDate(rng, 2026);
  const contract = ref("ASS", rng);
  const autoRenewal = rng() > 0.5;
  const title = `Contrat assurance habitation ${contract}`;

  const renewalClause = autoRenewal
    ? "Renouvellement automatique : sauf dénonciation 60 jours avant l'échéance, le contrat est reconduit tacitement pour un an."
    : "Tacite reconduction : le contrat se renouvelle automatiquement chaque année sauf résiliation par lettre recommandée.";

  const modificationDeadline = `Toute demande de modification doit être adressée avant le ${deadline}`;

  // Deadlines must come only from content written into the document body.
  const deadlines = [modificationDeadline];
  const actions = [
    `Vérifier la date d'échéance du ${renew}`,
    `Adresser toute demande de modification avant le ${deadline}`,
  ];

  if (autoRenewal) {
    deadlines.push("Dénonciation 60 jours avant l'échéance");
    actions.splice(
      1,
      0,
      "Anticiper une éventuelle résiliation avant le délai de 60 jours",
    );
  }

  const body = `# Contrat d'assurance habitation — ${contract}

**Assureur fictif :** SécuriHome Assurances  
**Assuré :** ${p.fullName}  
**Adresse du risque :** ${a.line}  
**Date d'effet :** ${effect}  
**Date d'échéance principale :** ${renew}

## Objet
Le présent contrat garantit le logement situé à l'adresse ci-dessus contre incendie, dégâts des eaux, vol et responsabilité civile vie privée.

## Cotisation
- Cotisation mensuelle : **${euro(premium)}**
- Mode de paiement : prélèvement automatique le 5 de chaque mois
- Franchise générale : **${euro(franchise, 0)}**

## Clauses importantes
- **${renewalClause}**
- **Pénalité de résiliation anticipée** : frais de dossier de **${euro(fee, 0)}**.
- **Frais annexes** : frais de gestion de sinistre de **${euro(claimFee, 0)}** hors franchise.
- **Obligation importante** : toute déclaration inexacte peut entraîner la nullité des garanties.
- **Sanction possible** : en cas de non-paiement après mise en demeure, suspension puis résiliation de plein droit.

## Délai
${modificationDeadline}.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Assurance",
      title,
      summary: `Contrat d'assurance habitation ${contract} souscrit par ${p.fullName} auprès de SécuriHome Assurances pour le logement situé à ${a.line}, avec cotisation de ${euro(premium)} et échéance au ${renew}.`,
      people: [p.fullName],
      organizations: ["SécuriHome Assurances"],
      amounts: [euro(premium), euro(franchise, 0), euro(fee, 0), euro(claimFee, 0)],
      dates: [effect, renew],
      deadlines,
      importantPoints: [
        `Cotisation mensuelle de ${euro(premium)}`,
        `Franchise générale de ${euro(franchise, 0)}`,
        renewalClause,
        `Adresse du risque : ${a.line}`,
      ],
      risks: [
        renewalClause,
        `Pénalité de résiliation anticipée de ${euro(fee, 0)}`,
        `Frais de gestion de sinistre de ${euro(claimFee, 0)} hors franchise`,
        "Nullité des garanties en cas de déclaration inexacte",
        "Résiliation de plein droit après mise en demeure restée sans effet",
      ],
      actions,
      flags: {
        penalties: true,
        autoRenewal,
        hiddenFees: true,
        shortDeadline: false,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildBanque(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const fees = randomAmount(rng, 2.5, 12);
  const overdraft = randomAmount(rng, 15, 45);
  const balance = randomAmount(rng, -420, 2450);
  const salary = randomAmount(rng, 1800, 3200);
  const rent = randomAmount(rng, 650, 1200);
  const commission = randomAmount(rng, 1.5, 4);
  const rejectFee = randomAmount(rng, 8, 20);
  const rate = randomAmount(rng, 12, 19);
  const dateEnd = pastDate(rng, 2026);
  const dateStart = pastDate(rng, 2026);
  const op1 = pastDate(rng, 2026);
  const op2 = pastDate(rng, 2026);
  const op3 = pastDate(rng, 2026);
  const deadline = futureDate(rng, 2026);
  const title = `Relevé bancaire Banque Horizon ${ref("BQE", rng)}`;

  const body = `# Relevé de compte courant

**Établissement fictif :** Banque Horizon  
**Titulaire :** ${p.fullName}  
**Adresse :** ${a.line}  
**Période :** du ${dateStart} au ${dateEnd}

## Situation
- Solde arrêté : **${euro(balance)}**
- Découvert autorisé : **${euro(randomAmount(rng, 200, 800), 0)}**
- Commission d'intervention : **${euro(overdraft)}** / opération
- Frais de tenue de compte : **${euro(fees)}** / mois

## Opérations notables
| Date | Libellé | Montant |
|------|---------|---------|
| ${op1} | Prélèvement loyer | -${euro(rent, 0)} |
| ${op2} | Salaire | +${euro(salary, 0)} |
| ${op3} | Frais de découvert | -${euro(overdraft)} |

## Clauses et alertes
- **Frais cachés** : commission de mouvement de **${euro(commission)}** hors forfait.
- **Frais annexes** : rejet de prélèvement facturé **${euro(rejectFee, 0)}**.
- **Pénalités** : intérêts débiteurs au taux de **${formatMoney(rate, 1)} %** l'an.
- **Délai** : régularisation du solde avant le **${deadline}**, sous peine de suspension des moyens de paiement.
- **Obligation** : maintenir une provision suffisante.
- **Sanction possible** : inscription au FICP en cas d'incidents répétés.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Banque",
      title,
      summary: `Relevé de compte Banque Horizon pour ${p.fullName}, solde de ${euro(balance)}, avec frais de tenue de ${euro(fees)} et demande de régularisation avant le ${deadline}.`,
      people: [p.fullName],
      organizations: ["Banque Horizon"],
      amounts: [
        euro(balance),
        euro(overdraft),
        euro(fees),
        euro(rent, 0),
        euro(salary, 0),
        euro(commission),
        euro(rejectFee, 0),
      ],
      dates: [dateStart, dateEnd, op1, op2, op3],
      deadlines: [`Régularisation du solde avant le ${deadline}`],
      importantPoints: [
        `Solde arrêté à ${euro(balance)}`,
        `Frais de tenue de compte de ${euro(fees)} par mois`,
        `Commission d'intervention de ${euro(overdraft)}`,
      ],
      risks: [
        `Frais cachés : commission de mouvement de ${euro(commission)}`,
        `Frais de rejet de prélèvement de ${euro(rejectFee, 0)}`,
        `Intérêts débiteurs à ${formatMoney(rate, 1)} % l'an`,
        "Risque de suspension des moyens de paiement",
        "Risque d'inscription au FICP",
      ],
      actions: [
        `Régulariser le solde avant le ${deadline}`,
        "Vérifier les frais de découvert et commissions prélevées",
        "Maintenir une provision suffisante sur le compte",
      ],
      flags: {
        penalties: true,
        autoRenewal: false,
        hiddenFees: true,
        shortDeadline: false,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildImpots(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const due = randomAmount(rng, 180, 2450);
  const penaltyPct = randomAmount(rng, 10, 25);
  const total = due * (1 + penaltyPct / 100);
  const reminder = randomAmount(rng, 10, 30);
  const refNum = ref("IMP", rng);
  const issued = pastDate(rng, 2026);
  const deadline = futureDate(rng, 2026);
  const title = `Avis fiscal ${refNum}`;

  const body = `# Direction générale des Finances publiques (document fictif)

**Référence :** ${refNum}  
**Contribuable :** ${p.fullName}  
**Adresse :** ${a.line}  
**Année concernée :** 2025  
**Date d'émission :** ${issued}

## Objet
Notification d'un reste à payer au titre de l'impôt sur le revenu.

## Montants
- Principal dû : **${euro(due, 0)}**
- Majoration pour retard : **${formatMoney(penaltyPct, 0)} %**
- Total à régler : **${euro(total, 0)}**

## Délai impératif
Le règlement doit intervenir **au plus tard le ${deadline}**.

## Clauses
- **Pénalités** : majoration automatique en cas de défaut de paiement à l'échéance.
- **Sanction possible** : engagement d'une procédure de recouvrement forcé.
- **Obligation importante** : produire les justificatifs demandés sous **15 jours**.
- **Frais annexes** : frais de relance de **${euro(reminder, 0)}**.

## Réponse attendue
Veuillez régulariser ou contester motivement avant la date limite. À défaut, des poursuites pourront être engagées.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Impôts",
      title,
      summary: `Avis fiscal ${refNum} adressé à ${p.fullName} pour un reste à payer de ${euro(total, 0)} au titre de 2025, à régler avant le ${deadline}.`,
      people: [p.fullName],
      organizations: ["Direction générale des Finances publiques"],
      amounts: [euro(due, 0), euro(total, 0), euro(reminder, 0)],
      dates: [issued, "2025"],
      deadlines: [
        `Le règlement doit intervenir au plus tard le ${deadline}`,
        "Produire les justificatifs demandés sous 15 jours",
      ],
      importantPoints: [
        `Principal dû de ${euro(due, 0)}`,
        `Majoration de ${formatMoney(penaltyPct, 0)} %`,
        `Total à régler de ${euro(total, 0)}`,
        `Échéance de paiement au ${deadline}`,
      ],
      risks: [
        "Majoration automatique en cas de retard",
        "Procédure de recouvrement forcé possible",
        `Frais de relance de ${euro(reminder, 0)}`,
      ],
      actions: [
        `Régler ${euro(total, 0)} avant le ${deadline}`,
        "Contester de façon motivée avant la date limite si désaccord",
        "Fournir les justificatifs demandés sous 15 jours",
      ],
      flags: {
        penalties: true,
        autoRenewal: false,
        hiddenFees: true,
        shortDeadline: true,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildCaf(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const amount = randomAmount(rng, 120, 680);
  const indu = randomAmount(rng, 200, 900);
  const deadline = futureDate(rng, 2026);
  const issued = pastDate(rng, 2026);
  const refNum = ref("CAF", rng);
  const title = `Notification CAF ${refNum}`;

  const body = `# Caisse d'Allocations Familiales (document fictif)

**N° allocataire fictif :** ${refNum}  
**Allocataire :** ${p.fullName}  
**Adresse :** ${a.line}  
**Date :** ${issued}

## Objet
Demande de pièces pour le maintien de vos droits à l'aide au logement.

## Montant concerné
Aide mensuelle en cours : **${euro(amount, 0)}**

## Délai
Les documents doivent être transmis **avant le ${deadline}**, sous 10 jours ouvrés à compter de la présente.

## Points de vigilance
- **Obligation importante** : déclarer tout changement de situation sous peine d'indu.
- **Sanction possible** : suspension du versement et demande de remboursement des trop-perçus.
- **Pénalités** : en cas d'omission, un indu de **${euro(indu, 0)}** pourra être mis à votre charge.
- **Renouvellement** : le droit est réexaminé automatiquement chaque trimestre.

Veuillez répondre via votre espace allocataire ou par courrier.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "CAF",
      title,
      summary: `Notification CAF ${refNum} demandant des pièces à ${p.fullName} pour maintenir une aide de ${euro(amount, 0)}, avec délai au ${deadline}.`,
      people: [p.fullName],
      organizations: ["Caisse d'Allocations Familiales"],
      amounts: [euro(amount, 0), euro(indu, 0)],
      dates: [issued],
      deadlines: [
        `Les documents doivent être transmis avant le ${deadline}`,
        "sous 10 jours ouvrés à compter de la présente",
      ],
      importantPoints: [
        `Aide mensuelle de ${euro(amount, 0)}`,
        "Demande de pièces pour maintien des droits",
        "Réexamen automatique trimestriel des droits",
      ],
      risks: [
        "Suspension du versement en cas d'absence de réponse",
        `Indu possible de ${euro(indu, 0)}`,
        "Remboursement des trop-perçus",
      ],
      actions: [
        `Envoyer les pièces avant le ${deadline}`,
        "Déclarer tout changement de situation",
        "Répondre via l'espace allocataire ou par courrier",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: false,
        shortDeadline: true,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildMutuelle(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const premium = randomAmount(rng, 42, 125);
  const optic = randomAmount(rng, 100, 250);
  const dental = randomAmount(rng, 200, 450);
  const hidden = randomAmount(rng, 1.5, 4);
  const exitFee = randomAmount(rng, 20, 60);
  const contract = ref("MUT", rng);
  const renew = futureDate(rng, 2027);
  const title = `Contrat mutuelle santé ${contract}`;

  const body = `# Mutuelle Santé Équilibre (document fictif)

**Adhérent :** ${p.fullName}  
**Adresse :** ${a.line}  
**N° contrat :** ${contract}  
**Cotisation mensuelle :** ${euro(premium)}  
**Échéance :** ${renew}

## Garanties principales
- Soins courants : 100 % BR
- Optique : forfait **${euro(optic, 0)}** / an
- Dentaire : **${euro(dental, 0)}** / an

## Clauses sensibles
- **Renouvellement automatique** par tacite reconduction annuelle.
- **Frais cachés** : contribution aux frais de gestion de **${euro(hidden)}** / mois hors cotisation affichée.
- **Délai de carence** : 90 jours sur certaines garanties dentaires.
- **Pénalité** : frais de radiation anticipée de **${euro(exitFee, 0)}**.
- **Obligation** : déclarer les ayants droit sous 30 jours.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Mutuelle",
      title,
      summary: `Contrat de mutuelle ${contract} pour ${p.fullName} auprès de Mutuelle Santé Équilibre, cotisation ${euro(premium)}, échéance ${renew}.`,
      people: [p.fullName],
      organizations: ["Mutuelle Santé Équilibre"],
      amounts: [euro(premium), euro(optic, 0), euro(dental, 0), euro(hidden), euro(exitFee, 0)],
      dates: [renew],
      deadlines: [
        "Déclarer les ayants droit sous 30 jours",
        "Délai de carence : 90 jours sur certaines garanties dentaires",
      ],
      importantPoints: [
        `Cotisation mensuelle de ${euro(premium)}`,
        `Forfait optique de ${euro(optic, 0)} par an`,
        "Tacite reconduction annuelle",
      ],
      risks: [
        "Renouvellement automatique par tacite reconduction",
        `Frais de gestion cachés de ${euro(hidden)} par mois`,
        `Frais de radiation anticipée de ${euro(exitFee, 0)}`,
        "Délai de carence de 90 jours",
      ],
      actions: [
        `Anticiper l'échéance du ${renew} pour une éventuelle résiliation`,
        "Vérifier les frais de gestion hors cotisation",
        "Déclarer les ayants droit sous 30 jours",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: false,
        obligations: true,
        sanctions: false,
      },
      documentBody: body,
    }),
  };
}

function buildContratTravail(i, rng) {
  const employee = person(rng);
  const employer = pick(rng, ["TechnoNova SAS", "Atelier Lumière SARL", "GreenLogistique SA", "MediConseil SAS"]);
  const salary = randomAmount(rng, 2100, 3800);
  const tickets = randomAmount(rng, 8, 11);
  const nonCompete = randomAmount(rng, 20, 40);
  const start = pastDate(rng, 2025);
  const city = pick(rng, CITIES)[0];
  const role = pick(rng, ["Chargé de projet", "Développeur", "Assistant commercial", "Technicien support", "Comptable"]);
  const trial = pick(rng, ["2 mois", "3 mois", "4 mois"]);
  const notice = pick(rng, ["1 mois", "2 mois", "3 mois"]);
  const sector = pick(rng, ["numérique", "logistique", "santé"]);
  const title = `Contrat de travail CDI ${employee.lastName} ${ref("CDI", rng)}`;

  const body = `# Contrat de travail à durée indéterminée (fictif)

**Employeur :** ${employer}  
**Salarié :** ${employee.fullName}  
**Poste :** ${role}  
**Lieu de travail :** ${city}  
**Date d'entrée :** ${start}

## Rémunération
- Salaire brut mensuel : **${euro(salary, 0)}**
- Tickets restaurant : **${euro(tickets)}**

## Clauses importantes
- **Période d'essai** : ${trial}, renouvelable une fois.
- **Obligation de non-concurrence** : 12 mois sur le secteur ${sector}, contrepartie **${formatMoney(nonCompete, 0)} %** du salaire.
- **Clause de mobilité** : mutation possible dans un rayon de 50 km.
- **Pénalités** : indemnité forfaitaire en cas de rupture abusive de la période d'essai.
- **Sanction possible** : licenciement pour faute en cas de manquement grave à la confidentialité.
- **Délai de préavis** : ${notice}.

Fait à ${city}, le ${start}.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Contrat de travail",
      title,
      summary: `CDI de ${employee.fullName} chez ${employer} en tant que ${role} à ${city}, salaire brut de ${euro(salary, 0)}, entrée le ${start}.`,
      people: [employee.fullName],
      organizations: [employer],
      amounts: [euro(salary, 0), euro(tickets)],
      dates: [start],
      deadlines: [`Délai de préavis : ${notice}`, `Période d'essai : ${trial}`],
      importantPoints: [
        `Poste de ${role}`,
        `Salaire brut mensuel de ${euro(salary, 0)}`,
        `Clause de non-concurrence de 12 mois (${formatMoney(nonCompete, 0)} % du salaire)`,
        `Période d'essai de ${trial}`,
      ],
      risks: [
        "Clause de non-concurrence de 12 mois",
        "Clause de mobilité dans un rayon de 50 km",
        "Risque de licenciement pour faute en cas de manquement à la confidentialité",
        "Pénalité possible en cas de rupture abusive de période d'essai",
      ],
      actions: [
        "Relire la clause de non-concurrence avant signature",
        "Vérifier la durée et le renouvellement de la période d'essai",
        `Noter le préavis de ${notice}`,
      ],
      flags: {
        penalties: true,
        autoRenewal: false,
        hiddenFees: false,
        shortDeadline: false,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildBail(i, rng) {
  const tenant = person(rng);
  const landlord = person(rng);
  const a = address(rng);
  const rent = randomAmount(rng, 620, 1450);
  const charges = randomAmount(rng, 40, 120);
  const deposit = rent;
  const latePct = randomAmount(rng, 2, 5);
  const reminderFee = randomAmount(rng, 15, 40);
  const start = pastDate(rng, 2024);
  const notice = futureDate(rng, 2026);
  const surface = 30 + Math.floor(rng() * 50);
  const title = `Bail location ${a.city} ${ref("BAIL", rng)}`;

  const body = `# Bail de location (document fictif)

**Bailleur :** ${landlord.fullName}  
**Locataire :** ${tenant.fullName}  
**Bien :** ${a.line}  
**Surface :** ${surface} m²  
**Date de prise d'effet :** ${start}

## Loyers et charges
- Loyer mensuel hors charges : **${euro(rent, 0)}**
- Provisions pour charges : **${euro(charges, 0)}**
- Dépôt de garantie : **${euro(deposit, 0)}**

## Clauses
- **Renouvellement automatique** du bail pour 3 ans sauf congé donné 6 mois avant terme.
- **Pénalités de retard** : majoration de **${formatMoney(latePct, 1)} %** après 15 jours de retard de loyer.
- **Frais annexes** : frais de relance locative de **${euro(reminderFee, 0)}**.
- **Obligation importante** : souscription d'une assurance habitation et transmission d'attestation annuelle.
- **Délai** : état des lieux contradictoire à organiser avant le **${notice}** en cas de départ.
- **Sanction** : résiliation de plein droit après commandement de payer demeuré infructueux.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Bail",
      title,
      summary: `Bail entre ${landlord.fullName} et ${tenant.fullName} pour un logement de ${surface} m² à ${a.line}, loyer ${euro(rent, 0)}, effet au ${start}.`,
      people: [landlord.fullName, tenant.fullName],
      organizations: [],
      amounts: [euro(rent, 0), euro(charges, 0), euro(deposit, 0), euro(reminderFee, 0)],
      dates: [start],
      deadlines: [
        `État des lieux contradictoire à organiser avant le ${notice}`,
        "Congé donné 6 mois avant terme",
        "Majoration après 15 jours de retard de loyer",
      ],
      importantPoints: [
        `Loyer mensuel de ${euro(rent, 0)}`,
        `Dépôt de garantie de ${euro(deposit, 0)}`,
        "Renouvellement automatique pour 3 ans",
        "Assurance habitation obligatoire",
      ],
      risks: [
        "Renouvellement automatique du bail",
        `Pénalités de retard de ${formatMoney(latePct, 1)} %`,
        `Frais de relance de ${euro(reminderFee, 0)}`,
        "Résiliation de plein droit après commandement de payer infructueux",
      ],
      actions: [
        "Souscrire et transmettre l'attestation d'assurance habitation",
        `Prévoir l'état des lieux avant le ${notice} en cas de départ`,
        "Anticiper un congé 6 mois avant terme si non-renouvellement souhaité",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: false,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildFactureEdF(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const kwh = randomAmount(rng, 180, 920);
  const subscription = randomAmount(rng, 12, 22);
  const amount = randomAmount(rng, 48, 210);
  const penalty = randomAmount(rng, 8, 15);
  const start = pastDate(rng, 2025);
  const end = pastDate(rng, 2026);
  const deadline = futureDate(rng, 2026);
  const invoice = ref("EDF", rng);
  const title = `Facture electricite ${invoice}`;

  const body = `# Facture d'électricité — Fournisseur ÉnergieClaire (fictif)

**Client :** ${p.fullName}  
**Adresse de fourniture :** ${a.line}  
**N° facture :** ${invoice}  
**Période :** ${start} → ${end}

## Montants
- Consommation : **${formatMoney(kwh, 0)} kWh**
- Abonnement : **${euro(subscription)}**
- Total TTC à payer : **${euro(amount)}**
- Date limite de paiement : **${deadline}**

## Mentions
- **Pénalités de retard** : ${euro(penalty, 0)} après échéance.
- **Frais cachés** : contribution d'acheminement et taxes locales incluses mais ventilées en page 2.
- **Délai** : en l'absence de règlement sous 15 jours, mise en demeure puis coupure possible.
- **Obligation** : relever le compteur ou accepter l'estimation.
- **Renouvellement** : offre à durée indéterminée avec reconduction mensuelle.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Facture EDF",
      title,
      summary: `Facture ÉnergieClaire ${invoice} pour ${p.fullName}, total TTC ${euro(amount)}, payable avant le ${deadline}.`,
      people: [p.fullName],
      organizations: ["ÉnergieClaire"],
      amounts: [euro(subscription), euro(amount), euro(penalty, 0)],
      dates: [start, end],
      deadlines: [
        `Date limite de paiement : ${deadline}`,
        "En l'absence de règlement sous 15 jours, mise en demeure",
      ],
      importantPoints: [
        `Consommation de ${formatMoney(kwh, 0)} kWh`,
        `Total TTC de ${euro(amount)}`,
        `Date limite de paiement au ${deadline}`,
      ],
      risks: [
        `Pénalités de retard de ${euro(penalty, 0)}`,
        "Frais et taxes d'acheminement peu visibles",
        "Risque de coupure en cas de non-paiement",
        "Reconduction mensuelle automatique de l'offre",
      ],
      actions: [
        `Payer ${euro(amount)} avant le ${deadline}`,
        "Vérifier le détail des taxes et contribution d'acheminement",
        "Relever le compteur si demandé",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: true,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildFactureTelecom(brand, i, rng) {
  const p = person(rng);
  const a = address(rng);
  const amountValue = randomAmount(rng, 19.99, 79.99);
  const optionsValue = randomAmount(rng, 0, 15);
  const hiddenValue = randomAmount(rng, 1.5, 6);
  const rejectFee = randomAmount(rng, 5, 12);
  const totalValue = amountValue + optionsValue + hiddenValue;
  const deadline = futureDate(rng, 2026);
  const issued = pastDate(rng, 2026);
  const invoice = ref(brand.toUpperCase().slice(0, 3), rng);
  const offer = pick(rng, ["Mobile 100 Go", "Fibre 1 Gb/s", "Box + Mobile", "Forfait 5G"]);
  const notice = pick(rng, ["10 jours", "30 jours", "60 jours"]);
  const title = `Facture ${brand} ${invoice}`;

  const body = `# Facture ${brand} (document fictif)

**Abonné :** ${p.fullName}  
**Adresse de facturation :** ${a.line}  
**N° facture :** ${invoice}  
**Ligne / offre :** ${offer}  
**Date d'émission :** ${issued}

## Détail
- Abonnement : **${euro(amountValue)}**
- Options : **${euro(optionsValue)}**
- **Frais de service / frais cachés** : **${euro(hiddenValue)}** (gestion de compte hors forfait annoncé)
- Total TTC : **${euro(totalValue)}**
- À régler avant le **${deadline}**

## Clauses
- **Pénalités** : frais de rejet de prélèvement **${euro(rejectFee, 0)}**.
- **Renouvellement automatique** de l'abonnement mensuel.
- **Délai de résiliation** : préavis de ${notice}.
- **Sanction possible** : suspension de ligne après incident de paiement.
- **Obligation** : maintenir un moyen de paiement valide.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: `Facture ${brand}`,
      title,
      summary: `Facture ${brand} ${invoice} pour ${p.fullName} (${offer}), total ${euro(totalValue)}, à payer avant le ${deadline}.`,
      people: [p.fullName],
      organizations: [brand],
      amounts: [euro(amountValue), euro(optionsValue), euro(hiddenValue), euro(totalValue), euro(rejectFee, 0)],
      dates: [issued],
      deadlines: [
        `Date limite de paiement : ${deadline}`,
        `Délai de résiliation : préavis de ${notice}`,
      ],
      importantPoints: [
        `Offre ${offer}`,
        `Total TTC de ${euro(totalValue)}`,
        `Échéance de paiement au ${deadline}`,
      ],
      risks: [
        `Frais cachés de gestion de ${euro(hiddenValue)}`,
        `Frais de rejet de prélèvement de ${euro(rejectFee, 0)}`,
        "Renouvellement automatique mensuel",
        "Suspension de ligne possible après incident de paiement",
      ],
      actions: [
        `Régler ${euro(totalValue)} avant le ${deadline}`,
        "Vérifier les frais hors forfait",
        `Respecter un préavis de ${notice} pour résilier`,
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: notice === "10 jours",
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildContratInternet(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const price = randomAmount(rng, 29.99, 49.99);
  const box = randomAmount(rng, 3, 8);
  const activation = randomAmount(rng, 0, 49);
  const exitFee = randomAmount(rng, 50, 150);
  const equipmentFee = randomAmount(rng, 60, 120);
  const engage = pick(rng, ["12 mois", "24 mois", "sans engagement"]);
  const start = pastDate(rng, 2025);
  const cancelBefore = futureDate(rng, 2026);
  const title = `Contrat Internet fibre ${ref("NET", rng)}`;

  const body = `# Contrat d'accès Internet (fictif)

**Opérateur fictif :** NetHorizon  
**Client :** ${p.fullName}  
**Installation :** ${a.line}  
**Début :** ${start}  
**Engagement :** ${engage}  
**Mensualité :** ${euro(price)}

## Services
- Débit théorique : jusqu'à 1 Gb/s
- Location box : **${euro(box)}** / mois
- Frais d'activation : **${euro(activation, 0)}**

## Clauses à surveiller
- **Renouvellement automatique** à l'issue de l'engagement, au tarif catalogue.
- **Frais cachés** : frais de résiliation anticipée de **${euro(exitFee, 0)}** + restitution du matériel.
- **Pénalités** : **${euro(equipmentFee, 0)}** si matériel non retourné sous 30 jours.
- **Délai** : résiliation à notifier avant le **${cancelBefore}** pour éviter un mois supplémentaire.
- **Obligation** : accès au logement pour intervention technicien sous 8 jours.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Contrat Internet",
      title,
      summary: `Contrat Internet NetHorizon pour ${p.fullName} à ${a.line}, mensualité ${euro(price)}, engagement ${engage}, début ${start}.`,
      people: [p.fullName],
      organizations: ["NetHorizon"],
      amounts: [euro(price), euro(box), euro(activation, 0), euro(exitFee, 0), euro(equipmentFee, 0)],
      dates: [start],
      deadlines: [
        `Résiliation à notifier avant le ${cancelBefore}`,
        "matériel non retourné sous 30 jours",
        "intervention technicien sous 8 jours",
      ],
      importantPoints: [
        `Mensualité de ${euro(price)}`,
        `Engagement ${engage}`,
        `Location box de ${euro(box)} par mois`,
      ],
      risks: [
        "Renouvellement automatique au tarif catalogue",
        `Frais de résiliation anticipée de ${euro(exitFee, 0)}`,
        `Pénalité de ${euro(equipmentFee, 0)} si matériel non restitué`,
      ],
      actions: [
        `Notifier une résiliation avant le ${cancelBefore} si souhaité`,
        "Anticiper la restitution du matériel",
        "Prévoir l'accès logement pour le technicien sous 8 jours",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: true,
        obligations: true,
        sanctions: false,
      },
      documentBody: body,
    }),
  };
}

function buildContratTelephone(i, rng) {
  const p = person(rng);
  const price = randomAmount(rng, 9.99, 39.99);
  const phoneFee = randomAmount(rng, 5, 25);
  const insurance = randomAmount(rng, 4, 9);
  const start = pastDate(rng, 2025);
  const engage = pick(rng, ["24 mois", "12 mois", "sans engagement"]);
  const offer = pick(rng, ["70 Go 5G", "120 Go 5G", "Illimité + roaming UE"]);
  const title = `Contrat forfait mobile ${ref("MOB", rng)}`;

  const body = `# Contrat de services mobiles (fictif)

**Client :** ${p.fullName}  
**Forfait :** ${offer}  
**Date de souscription :** ${start}  
**Prix mensuel affiché :** ${euro(price)}  
**Location / financement terminal :** ${euro(phoneFee)} / mois

## Conditions
- Engagement : ${engage}
- **Renouvellement automatique** du forfait.
- **Frais cachés** : assurance casse optionnelle pré-cochée à **${euro(insurance)}** / mois.
- **Pénalités** de résiliation anticipée : mensualités restantes du terminal.
- **Délai** de rétractation : 14 jours à compter de la souscription.
- **Sanction** : suspension après 2 prélèvements rejetés.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Contrat téléphonique",
      title,
      summary: `Forfait mobile ${offer} pour ${p.fullName} à ${euro(price)} par mois, engagement ${engage}, souscrit le ${start}.`,
      people: [p.fullName],
      organizations: [],
      amounts: [euro(price), euro(phoneFee), euro(insurance)],
      dates: [start],
      deadlines: ["Délai de rétractation : 14 jours à compter de la souscription"],
      importantPoints: [
        `Forfait ${offer}`,
        `Prix mensuel de ${euro(price)}`,
        `Financement terminal de ${euro(phoneFee)} par mois`,
        `Engagement ${engage}`,
      ],
      risks: [
        "Renouvellement automatique du forfait",
        `Assurance casse pré-cochée à ${euro(insurance)} par mois`,
        "Pénalités égales aux mensualités restantes du terminal",
        "Suspension après 2 prélèvements rejetés",
      ],
      actions: [
        "Vérifier et désactiver l'assurance casse si non souhaitée",
        "Exercer la rétractation sous 14 jours si besoin",
        "Anticiper le coût de résiliation anticipée lié au terminal",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: false,
        obligations: false,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildCourrierAdmin(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const deadline = futureDate(rng, 2026);
  const issued = pastDate(rng, 2026);
  const fee = randomAmount(rng, 0, 50);
  const refNum = ref("ADM", rng);
  const title = `Courrier administratif ${refNum}`;

  const body = `# Préfecture / Service administratif (document fictif)

**Référence dossier :** ${refNum}  
**Destinataire :** ${p.fullName}  
**Adresse :** ${a.line}  
**Date :** ${issued}

## Objet
Demande de complément de dossier — titre / autorisation / inscription fictive.

## Contenu
Nous vous prions de bien vouloir transmettre les pièces suivantes :
1. Justificatif de domicile de moins de 3 mois
2. Copie de pièce d'identité
3. Formulaire cerfa complété

## Délai
Votre réponse est attendue **avant le ${deadline}**, sous 15 jours, sous peine de classement sans suite.

## Mentions
- **Obligation importante** : répondre dans le délai imparti.
- **Sanction possible** : rejet de la demande et nécessité de redéposer un dossier.
- **Frais** : droits de dossier éventuels de **${euro(fee, 0)}**.

Veuillez agréer, Madame, Monsieur, l'expression de nos salutations distinguées.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Courrier administratif",
      title,
      summary: `Courrier administratif ${refNum} demandant à ${p.fullName} de compléter un dossier avant le ${deadline}, sous peine de classement sans suite.`,
      people: [p.fullName],
      organizations: ["Préfecture / Service administratif"],
      amounts: fee > 0 ? [euro(fee, 0)] : [],
      dates: [issued],
      deadlines: [
        `Votre réponse est attendue avant le ${deadline}`,
        "sous 15 jours, sous peine de classement sans suite",
      ],
      importantPoints: [
        "Demande de complément de dossier",
        "Pièces demandées : justificatif de domicile, pièce d'identité, formulaire cerfa",
        `Réponse attendue avant le ${deadline}`,
      ],
      risks: [
        "Classement sans suite en cas d'absence de réponse",
        "Rejet de la demande et perte d'antériorité du dépôt",
      ],
      actions: [
        `Transmettre les pièces avant le ${deadline}`,
        "Répondre sous 15 jours",
        "Conserver la référence de dossier",
      ],
      flags: {
        penalties: false,
        autoRenewal: false,
        hiddenFees: fee > 0,
        shortDeadline: true,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildRelance(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const due = randomAmount(rng, 89, 980);
  const penalty = randomAmount(rng, 12, 45);
  const recovery = randomAmount(rng, 20, 60);
  const total = due + penalty + recovery;
  const origin = pastDate(rng, 2025);
  const deadline = futureDate(rng, 2026);
  const invoice = ref("REL", rng);
  const level = pick(rng, ["1ère relance", "2e relance", "Mise en demeure"]);
  const title = `${level} de paiement ${invoice}`;

  const body = `# ${level} — Service recouvrement (fictif)

**Destinataire :** ${p.fullName}  
**Adresse :** ${a.line}  
**Facture concernée :** ${invoice}  
**Montant impayé :** **${euro(due)}**  
**Date d'origine :** ${origin}

## Objet
${level} amiable / mise en demeure de payer.

## Montants
- Principal : **${euro(due)}**
- Pénalités de retard : **${euro(penalty, 0)}**
- Frais de recouvrement : **${euro(recovery, 0)}**
- Total réclamé : **${euro(total, 0)}**

## Délai
Règlement exigé **sous 8 jours**, et au plus tard le **${deadline}**.

## Clauses
- **Sanction possible** : transmission à un huissier et poursuites judiciaires.
- **Obligation** : contester par écrit sous 10 jours si désaccord.
- **Frais cachés** : intérêts moratoires au taux légal majoré.
- À défaut de réponse, le dossier sera considéré comme contentieux.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Relance de paiement",
      title,
      summary: `${level} adressée à ${p.fullName} pour la facture ${invoice}, total réclamé ${euro(total, 0)}, à régler avant le ${deadline}.`,
      people: [p.fullName],
      organizations: ["Service recouvrement"],
      amounts: [euro(due), euro(penalty, 0), euro(recovery, 0), euro(total, 0)],
      dates: [origin],
      deadlines: [
        `Règlement exigé sous 8 jours, et au plus tard le ${deadline}`,
        "Contester par écrit sous 10 jours si désaccord",
      ],
      importantPoints: [
        `${level} sur facture ${invoice}`,
        `Principal impayé de ${euro(due)}`,
        `Total réclamé de ${euro(total, 0)}`,
      ],
      risks: [
        `Pénalités de retard de ${euro(penalty, 0)}`,
        `Frais de recouvrement de ${euro(recovery, 0)}`,
        "Transmission possible à un huissier",
        "Intérêts moratoires au taux légal majoré",
      ],
      actions: [
        `Régler ${euro(total, 0)} avant le ${deadline}`,
        "Contester par écrit sous 10 jours en cas de désaccord",
        "Répondre rapidement pour éviter le contentieux",
      ],
      flags: {
        penalties: true,
        autoRenewal: false,
        hiddenFees: true,
        shortDeadline: true,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

function buildCgv(i, rng) {
  const company = pick(rng, ["Boutique Nordik", "Studio Forma", "Maison Clarisse", "ElectroPlaza"]);
  const version = `${1 + Math.floor(rng() * 4)}.${Math.floor(rng() * 9)}`;
  const start = pastDate(rng, 2025);
  const dossierFee = randomAmount(rng, 0, 9.9);
  const rate = randomAmount(rng, 8, 12);
  const title = `CGV ${company} ${ref("CGV", rng)}`;

  const body = `# Conditions générales de vente — ${company} (fictives)

**Version :** ${version}  
**Date d'entrée en vigueur :** ${start}

## 1. Objet
Les présentes CGV régissent les ventes de produits et services proposés par ${company}.

## 2. Prix et paiement
Les prix sont indiqués en euros TTC. Des **frais de dossier** de **${euro(dossierFee)}** peuvent s'ajouter hors panier affiché.

## 3. Clauses sensibles
- **Renouvellement automatique** des abonnements associés aux services numériques.
- **Frais cachés** : contribution environnementale et frais de préparation de commande.
- **Pénalités** : intérêts de retard de **${formatMoney(rate, 1)} %** l'an pour les professionnels.
- **Délai de rétractation** : 14 jours pour les consommateurs.
- **Limitation de responsabilité** : plafonnée au montant de la commande.
- **Sanction** : suspension de compte en cas d'abus de retours.
- **Obligation** : vérifier la conformité à la livraison sous 48 h.

## 4. Droit applicable
Droit français. Tribunaux du siège de ${company}.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Conditions générales de vente",
      title,
      summary: `CGV version ${version} de ${company}, en vigueur au ${start}, avec renouvellement automatique des abonnements et frais de dossier de ${euro(dossierFee)}.`,
      people: [],
      organizations: [company],
      amounts: [euro(dossierFee)],
      dates: [start],
      deadlines: [
        "Délai de rétractation : 14 jours pour les consommateurs",
        "vérifier la conformité à la livraison sous 48 h",
      ],
      importantPoints: [
        `Version ${version} en vigueur au ${start}`,
        `Frais de dossier possibles de ${euro(dossierFee)}`,
        "Renouvellement automatique des abonnements",
      ],
      risks: [
        "Renouvellement automatique des abonnements",
        "Frais cachés (contribution environnementale, préparation)",
        `Intérêts de retard de ${formatMoney(rate, 1)} % pour les professionnels`,
        "Limitation de responsabilité au montant de la commande",
        "Suspension de compte possible",
      ],
      actions: [
        "Lire les clauses de renouvellement automatique avant souscription",
        "Exercer la rétractation sous 14 jours si besoin",
        "Vérifier la conformité des produits sous 48 h",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: true,
        obligations: true,
        sanctions: true,
      },
    documentBody: body,
    }),
  };
}

function buildDevis(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const labor = randomAmount(rng, 200, 900);
  const supplies = randomAmount(rng, 150, 1200);
  const travel = randomAmount(rng, 40, 120);
  const ht = labor + supplies + travel;
  const tva = ht * 0.2;
  const ttc = ht + tva;
  const debris = randomAmount(rng, 80, 200);
  const validity = futureDate(rng, 2026);
  const issued = pastDate(rng, 2026);
  const quote = ref("DEV", rng);
  const company = pick(rng, ["Atelier Pro Renov", "Services Multitech", "Habitat Conseil"]);
  const delay = pick(rng, ["10 jours", "3 semaines", "1 mois"]);
  const title = `Devis ${quote}`;

  const body = `# Devis n°${quote}

**Émetteur :** ${company} (société fictive)  
**Client :** ${p.fullName}  
**Chantier / lieu :** ${a.line}  
**Date :** ${issued}  
**Validité du devis :** jusqu'au **${validity}**

## Prestations
| Désignation | Montant HT |
|-------------|------------:|
| Main d'œuvre | ${euro(labor, 0)} |
| Fournitures | ${euro(supplies, 0)} |
| Déplacement | ${euro(travel, 0)} |

- Total HT : **${euro(ht)}**
- TVA 20 % : **${euro(tva)}**
- Total TTC : **${euro(ttc)}**

## Conditions
- Acompte de **30 %** à la commande.
- **Pénalités de retard** de paiement : ${formatMoney(randomAmount(rng, 8, 12), 1)} % l'an + indemnité forfaitaire de 40 €.
- **Frais annexes** non inclus : évacuation gravats **${euro(debris, 0)}**.
- **Délai d'intervention** estimé : ${delay} après acceptation.
- **Obligation** : accès chantier et décisions client sous 48 h.
- Le devis devient contrat dès signature / bon pour accord.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Devis",
      title,
      summary: `Devis ${quote} de ${company} pour ${p.fullName}, total TTC ${euro(ttc)}, valable jusqu'au ${validity}.`,
      people: [p.fullName],
      organizations: [company],
      amounts: [
        euro(labor, 0),
        euro(supplies, 0),
        euro(travel, 0),
        euro(ht),
        euro(tva),
        euro(ttc),
        "40 €",
        euro(debris, 0),
      ],
      dates: [issued],
      deadlines: [validity, "Décisions client sous 48 h", `Intervention estimée sous ${delay}`],
      importantPoints: [
        `Total TTC de ${euro(ttc)}`,
        "Acompte de 30 % à la commande",
        `Validité jusqu'au ${validity}`,
        `Frais d'évacuation des gravats non inclus : ${euro(debris, 0)}`,
      ],
      risks: [
        "Pénalités de retard de paiement et indemnité forfaitaire de 40 €",
        `Frais annexes non inclus de ${euro(debris, 0)}`,
        "Le devis devient contrat dès signature",
      ],
      actions: [
        `Accepter ou refuser avant le ${validity}`,
        "Prévoir l'acompte de 30 %",
        "Garantir l'accès chantier et les décisions sous 48 h",
      ],
      flags: {
        penalties: true,
        autoRenewal: false,
        hiddenFees: true,
        shortDeadline: true,
        obligations: true,
        sanctions: false,
      },
    documentBody: body,
    }),
  };
}

function buildPret(i, rng) {
  const p = person(rng);
  const a = address(rng);
  const capital = randomAmount(rng, 5000, 35000);
  const rate = randomAmount(rng, 3.2, 8.9);
  const monthly = randomAmount(rng, 120, 520);
  const dossier = randomAmount(rng, 0, 150);
  const deferFee = randomAmount(rng, 20, 50);
  const insurance = randomAmount(rng, 8, 25);
  const earlyPct = randomAmount(rng, 0.5, 1);
  const months = 24 + Math.floor(rng() * 48);
  const start = pastDate(rng, 2025);
  const contract = ref("PRT", rng);
  const title = `Offre de pret personnel ${contract}`;

  const body = `# Contrat / offre de prêt personnel (fictif)

**Prêteur :** Crédit Serein  
**Emprunteur :** ${p.fullName}  
**Adresse :** ${a.line}  
**N° offre :** ${contract}  
**Date :** ${start}

## Caractéristiques
- Capital emprunté : **${euro(capital, 0)}**
- TAEG : **${formatMoney(rate, 2)} %**
- Durée : **${months} mois**
- Mensualité : **${euro(monthly, 0)}**
- Frais de dossier : **${euro(dossier, 0)}**

## Clauses
- **Renouvellement / report** : possibilité de report d'échéance moyennant frais de **${euro(deferFee, 0)}**.
- **Frais cachés** : assurance emprunteur facultative proposée à **${euro(insurance)}** / mois.
- **Pénalités de remboursement anticipé** : **${formatMoney(earlyPct, 1)} %** du capital restant dû.
- **Délai de rétractation** : 14 jours.
- **Obligation** : informer de tout changement de situation financière.
- **Sanction possible** : déchéance du terme et exigibilité immédiate en cas d'impayés.

${footerDisclaimer()}
`;

  return {
    title,
    body,
    expected: makeExpected({
      documentType: "Contrat de prêt",
      title,
      summary: `Offre de prêt ${contract} de Crédit Serein pour ${p.fullName} : capital ${euro(capital, 0)}, TAEG ${formatMoney(rate, 2)} %, mensualité ${euro(monthly, 0)} sur ${months} mois.`,
      people: [p.fullName],
      organizations: ["Crédit Serein"],
      amounts: [
        euro(capital, 0),
        euro(monthly, 0),
        euro(dossier, 0),
        euro(deferFee, 0),
        euro(insurance),
      ],
      dates: [start],
      deadlines: ["Délai de rétractation : 14 jours"],
      importantPoints: [
        `Capital de ${euro(capital, 0)}`,
        `TAEG de ${formatMoney(rate, 2)} %`,
        `Mensualité de ${euro(monthly, 0)}`,
        `Durée de ${months} mois`,
      ],
      risks: [
        `Frais de report d'échéance de ${euro(deferFee, 0)}`,
        `Assurance emprunteur proposée à ${euro(insurance)} par mois`,
        `Pénalités de remboursement anticipé de ${formatMoney(earlyPct, 1)} %`,
        "Déchéance du terme en cas d'impayés",
      ],
      actions: [
        "Comparer le coût de l'assurance emprunteur avant acceptation",
        "Exercer la rétractation sous 14 jours si besoin",
        "Anticiper le coût d'un remboursement anticipé",
      ],
      flags: {
        penalties: true,
        autoRenewal: true,
        hiddenFees: true,
        shortDeadline: false,
        obligations: true,
        sanctions: true,
      },
      documentBody: body,
    }),
  };
}

const BUILDERS = {
  assurances: buildAssurance,
  banques: buildBanque,
  impots: buildImpots,
  caf: buildCaf,
  mutuelles: buildMutuelle,
  "contrats-de-travail": buildContratTravail,
  "baux-de-location": buildBail,
  "factures-edf": buildFactureEdF,
  "factures-orange": (i, rng) => buildFactureTelecom("Orange", i, rng),
  "factures-free": (i, rng) => buildFactureTelecom("Free", i, rng),
  "factures-sfr": (i, rng) => buildFactureTelecom("SFR", i, rng),
  "contrats-internet": buildContratInternet,
  "contrats-telephoniques": buildContratTelephone,
  "courriers-administratifs": buildCourrierAdmin,
  "relances-de-paiement": buildRelance,
  "conditions-generales-de-vente": buildCgv,
  devis: buildDevis,
  "contrats-de-pret": buildPret,
};

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

const PRESERVE_DIRS = new Set(["real-anonymized"]);

async function main() {
  // Ne pas détruire le corpus réel anonymisé
  await mkdir(ROOT, { recursive: true });
  const existing = await readdir(ROOT, { withFileTypes: true }).catch(() => []);
  for (const entry of existing) {
    if (PRESERVE_DIRS.has(entry.name)) continue;
    await rm(path.join(ROOT, entry.name), { recursive: true, force: true });
  }

  let total = 0;
  const indexRows = [];

  for (const category of CATEGORIES) {
    const dir = path.join(ROOT, category.id);
    await mkdir(dir, { recursive: true });

    for (let i = 1; i <= category.count; i += 1) {
      const seed = category.id.length * 1000 + i * 97 + total * 13;
      const rng = seededRandom(seed);
      const doc = BUILDERS[category.id](i, rng);
      const expandRng = seededRandom(seed + 777);
      doc.body = expandToRealisticDocument(doc.body, expandRng, category.id, {
        person,
        pastDate,
        futureDate,
        dateFr,
        euro,
        randomAmount,
        pick,
      });
      const baseName = `${String(i).padStart(2, "0")}-${slugify(doc.title)}`;
      const mdName = `${baseName}.md`;
      const expectedName = `${baseName}_expected.json`;

      await writeFile(path.join(dir, mdName), doc.body, "utf8");      await writeFile(
        path.join(dir, expectedName),
        `${JSON.stringify(doc.expected, null, 2)}\n`,
        "utf8",
      );

      total += 1;
      indexRows.push(
        `| ${total} | ${category.label} | \`${category.id}/${mdName}\` | \`${category.id}/${expectedName}\` |`,
      );
    }
  }

  const readme = `# Documents de test DocMind

Ce dossier contient **${total} documents fictifs multi-pages** et **${total} fichiers de vérité terrain** (\`*_expected.json\`).

## Avertissement

- Documents **100 % fictifs**, volontairement **longs et complexes** (préambule, définitions, échéanciers, historique, RGPD, annexes, signatures)
- Aucune copie de document réel protégé
- Aucune valeur juridique
- Chaque \`*_expected.json\` est généré avec les **mêmes données clés** que le corps principal du document

## Convention de nommage (extensible)

Pour ajouter un nouveau document de test :

\`\`\`text
test-documents/<categorie>/01-mon-document.pdf
test-documents/<categorie>/01-mon-document_expected.json
\`\`\`

Le script \`npm run evaluate\` découvre automatiquement tous les PDF et charge le \`*_expected.json\` du même nom.

Source Markdown (optionnelle, pour régénération) :

\`\`\`text
01-mon-document.md
01-mon-document.pdf
01-mon-document_expected.json
\`\`\`

## Format ground truth

\`\`\`json
{
  "document_type": "",
  "title": "",
  "summary": "",
  "people": [],
  "organizations": [],
  "amounts": [],
  "dates": [],
  "deadlines": [],
  "important_points": [],
  "risks": [],
  "actions": [],
  "risk_score": 0
}
\`\`\`

## Répartition

| # | Catégorie | Document | Expected |
|---|-----------|----------|----------|
${indexRows.join("\n")}

## Régénération

\`\`\`bash
npm run generate:docs
npm run generate:pdfs
\`\`\`

## Évaluation (\`npm run evaluate\`)

Prérequis : serveur DocMind démarré (\`npm run dev\`) + Ollama.

\`\`\`bash
npm run evaluate
npm run evaluate:quick
npx tsx --tsconfig tsconfig.json scripts/evaluate.ts --category assurances --limit 5
\`\`\`

Rapport HTML dans \`reports/\`.
`;

  await writeFile(path.join(ROOT, "README.md"), readme, "utf8");
  console.log(`Generated ${total} documents + ${total} expected JSON files`);

  const convert = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "convert-md-to-pdf.mjs"), "--force"],
    { stdio: "inherit" },
  );
  if (convert.status !== 0) {
    throw new Error("Conversion MD → PDF échouée");
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
