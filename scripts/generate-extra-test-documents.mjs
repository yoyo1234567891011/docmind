/**
 * Génère 100 documents de test SUPPLÉMENTAIRES (série 2).
 * - N'écrase pas le corpus existant
 * - 10 catégories × 10 sous-types distincts (structures différentes)
 * - Chaque expected.json est ancré dans le corps du document
 */
import { spawnSync } from "child_process";
import { mkdir, readdir, writeFile } from "fs/promises";
import path from "path";

const ROOT = path.join(process.cwd(), "test-documents");

const FIRST_NAMES = [
  "Amina", "Baptiste", "Céleste", "Diego", "Élodie", "Farid", "Gaëlle",
  "Hadrien", "Ismaël", "Jeanne", "Karim", "Louna", "Malo", "Noémie",
  "Olivier", "Perrine", "Quentin", "Rania", "Sébastien", "Tina",
  "Ulysse", "Valentin", "Wendy", "Yassine", "Zoé", "Amélie", "Boris",
  "Claire", "Damien", "Estelle",
];

const LAST_NAMES = [
  "Alvarez", "Boulanger", "Carpentier", "Delattre", "Esposito", "Faure",
  "Gauthier", "Hamel", "Ibrahim", "Jacquet", "Klein", "Leclerc", "Masson",
  "Noël", "Olivier", "Perrin", "Quéré", "Renard", "Sanchez", "Texier",
  "Urbain", "Vasseur", "Wagner", "Xavier", "Yves", "Zimmermann",
];

const CITIES = [
  ["Lyon", "69003"], ["Nantes", "44000"], ["Toulouse", "31000"],
  ["Bordeaux", "33000"], ["Lille", "59000"], ["Rennes", "35000"],
  ["Strasbourg", "67000"], ["Montpellier", "34000"], ["Nice", "06000"],
  ["Dijon", "21000"], ["Angers", "49000"], ["Reims", "51100"],
  ["Grenoble", "38000"], ["Tours", "37000"], ["Clermont-Ferrand", "63000"],
  ["Le Havre", "76600"], ["Metz", "57000"], ["Orléans", "45000"],
];

const STREETS = [
  "7 rue des Maraîchers", "22 avenue Jean Jaurès", "9 impasse du Pressoir",
  "41 boulevard de la Liberté", "16 place Saint-Michel", "3 chemin des Vignes",
  "58 rue Pasteur", "11 allée des Peupliers", "94 quai de la Loire",
  "2 résidence Les Clarines", "33 rue du Faubourg", "18 cours Mirabeau",
];

const CATEGORY_DIRS = {
  assurances: { id: "assurances", label: "Assurances" },
  banques: { id: "banques", label: "Banques" },
  travail: { id: "contrats-de-travail", label: "Contrats de travail" },
  impots: { id: "impots", label: "Impôts" },
  baux: { id: "baux-de-location", label: "Baux de location" },
  telephonie: { id: "contrats-telephoniques", label: "Contrats téléphoniques" },
  internet: { id: "contrats-internet", label: "Contrats Internet" },
  mutuelles: { id: "mutuelles", label: "Mutuelles" },
  admin: { id: "courriers-administratifs", label: "Courriers administratifs" },
  commercial: { id: "contrats-commerciaux", label: "Contrats commerciaux" },
};

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

function assertDeadlinesGroundedInDocument(body, deadlines, context) {
  const normalizedBody = body
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();

  for (const deadline of deadlines) {
    const value = String(deadline).trim();
    if (!value) continue;

    const dateMatch = value.match(/\d{1,2}\/\d{1,2}\/\d{4}/);
    if (dateMatch && normalizedBody.includes(dateMatch[0])) continue;

    const normalizedDeadline = value
      .normalize("NFD")
      .replace(/[\u0300-\u036f]/g, "")
      .toLowerCase();

    if (normalizedBody.includes(normalizedDeadline)) continue;

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

function footer() {
  return [

    "---",
    "",
    "*Document fictif généré uniquement à des fins de test DocMind. Aucune valeur juridique. Ne reproduit aucun document réel protégé.*",
  ].join("\n");
}

function pack(categoryKey, title, body, expectedFields) {
  return {
    categoryKey,
    title,
    body,
    expected: makeExpected({ ...expectedFields, documentBody: body }),
  };
}

/* -------------------------------------------------------------------------- */
/* ASSURANCES — 10 sous-types                                                  */
/* -------------------------------------------------------------------------- */

function assAuto(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("AUTO", rng);
  const premium = randomAmount(rng, 32, 95);
  const excess = randomAmount(rng, 200, 600);
  const effect = pastDate(rng, 2025);
  const end = futureDate(rng, 2026);
  const reply = futureDate(rng, 2026);
  const title = `Attestation assurance auto ${id}`;
  const body = `# Attestation d'assurance automobile

**Compagnie :** NordAssur Auto (fictif)  
**N° police :** ${id}  
**Assuré :** ${p.fullName}  
**Adresse :** ${a.line}  
**Véhicule :** Peugeot 208 — immatriculation fictive AB-123-CD  
**Période de garantie :** du ${effect} au ${end}

## Garanties
- Responsabilité civile obligatoire
- Dommages collision avec franchise de **${euro(excess, 0)}**
- Cotisation annuelle : **${euro(premium)}**

## Points d'attention
- **Obligation** : signaler tout changement d'usage professionnel sous 15 jours.
- **Sanction** : suspension de garantie en cas de non-paiement après mise en demeure.
- Réponse à toute demande de modification avant le **${reply}**.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Attestation d'assurance automobile ${id} pour ${p.fullName} auprès de NordAssur Auto, valable du ${effect} au ${end}, cotisation ${euro(premium)}.`,
    people: [p.fullName],
    organizations: ["NordAssur Auto"],
    amounts: [euro(excess, 0), euro(premium)],
    dates: [effect, end],
    deadlines: [`Réponse à toute demande de modification avant le ${reply}`],
    importantPoints: [
      `Police ${id} valable jusqu'au ${end}`,
      `Franchise dommages collision ${euro(excess, 0)}`,
      `Cotisation annuelle ${euro(premium)}`,
    ],
    risks: [
      "Suspension de garantie en cas de non-paiement après mise en demeure",
      "Obligation de signaler un usage professionnel sous 15 jours",
    ],
    actions: [
      `Répondre avant le ${reply} pour toute modification`,
      "Vérifier la franchise avant un éventuel sinistre",
    ],
    flags: { obligations: true, sanctions: true, shortDeadline: false },
  });
}

function assVie(rng) {
  const p = person(rng);
  const id = ref("VIE", rng);
  const capital = randomAmount(rng, 50000, 250000);
  const monthly = randomAmount(rng, 28, 120);
  const start = pastDate(rng, 2024);
  const renounce = futureDate(rng, 2026);
  const title = `Contrat assurance vie ${id}`;
  const body = `# Contrat d'assurance-vie — formule Épargne Horizon

**Assureur :** CapVie Mutuelle (fictif)  
**Contrat :** ${id}  
**Souscripteur :** ${p.fullName}  
**Date d'ouverture :** ${start}

## Caractéristiques
- Capital garanti au terme : **${euro(capital, 0)}**
- Versement mensuel programmé : **${euro(monthly)}**
- Supports : fonds euros 70 % / unités de compte 30 %

## Délais
- Droit de renonciation : exercice possible jusqu'au **${renounce}**.
- Préavis de 30 jours pour tout arrêt des versements programmés.

## Alertes
- **Frais d'arbitrage** de 0,80 % non indiqués en première page.
- **Pénalité** de sortie anticipée avant 8 ans : 1 % de l'encours.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Contrat d'assurance-vie ${id} souscrit par ${p.fullName} auprès de CapVie Mutuelle, capital ${euro(capital, 0)}, versements ${euro(monthly)}.`,
    people: [p.fullName],
    organizations: ["CapVie Mutuelle"],
    amounts: [euro(capital, 0), euro(monthly)],
    dates: [start],
    deadlines: [
      `Droit de renonciation jusqu'au ${renounce}`,
      "Préavis de 30 jours pour arrêt des versements",
    ],
    importantPoints: [
      `Capital garanti ${euro(capital, 0)}`,
      `Versement mensuel ${euro(monthly)}`,
      "Allocation 70 % fonds euros / 30 % UC",
    ],
    risks: [
      "Frais d'arbitrage de 0,80 % peu visibles",
      "Pénalité de sortie anticipée de 1 % avant 8 ans",
    ],
    actions: [
      `Exercer le droit de renonciation avant le ${renounce} si besoin`,
      "Anticiper un préavis de 30 jours avant d'arrêter les versements",
    ],
    flags: { penalties: true, hiddenFees: true },
  });
}

function assPro(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("RCP", rng);
  const premium = randomAmount(rng, 480, 1800);
  const ceiling = randomAmount(rng, 500000, 2000000);
  const effect = pastDate(rng, 2025);
  const claim = futureDate(rng, 2026);
  const title = `Police RC professionnelle ${id}`;
  const body = `# Police responsabilité civile professionnelle

**Assureur :** ProShield Assurances  
**N° :** ${id}  
**Assuré :** ${p.fullName} — activité conseil indépendant  
**Siège déclaré :** ${a.line}  
**Effet :** ${effect}

## Couverture
- Plafond par sinistre : **${euro(ceiling, 0)}**
- Prime annuelle : **${euro(premium, 0)}**
- Franchise : **500 €**

## Conditions
- Déclaration de sinistre dans un délai de 5 jours ouvrés.
- Toute demande d'attestation complémentaire avant le **${claim}**.
- **Renouvellement tacite** annuel sauf résiliation 2 mois avant échéance.
- **Sanction** : déchéance de garantie en cas de fausse déclaration.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Police RC professionnelle ${id} pour ${p.fullName} auprès de ProShield, plafond ${euro(ceiling, 0)}, prime ${euro(premium, 0)}.`,
    people: [p.fullName],
    organizations: ["ProShield Assurances"],
    amounts: [euro(ceiling, 0), euro(premium, 0), "500 €"],
    dates: [effect],
    deadlines: [
      "Déclaration de sinistre dans un délai de 5 jours ouvrés",
      `Demande d'attestation complémentaire avant le ${claim}`,
      "Résiliation 2 mois avant échéance",
    ],
    importantPoints: [
      `Plafond ${euro(ceiling, 0)}`,
      `Prime annuelle ${euro(premium, 0)}`,
      `Siège déclaré : ${a.line}`,
    ],
    risks: [
      "Renouvellement tacite annuel",
      "Déchéance de garantie en cas de fausse déclaration",
    ],
    actions: [
      "Respecter le délai de 5 jours ouvrés pour déclarer un sinistre",
      `Demander une attestation avant le ${claim} si nécessaire`,
    ],
    flags: { autoRenewal: true, sanctions: true, shortDeadline: true },
  });
}

function assVoyage(rng) {
  const p = person(rng);
  const id = ref("VOY", rng);
  const price = randomAmount(rng, 29, 89);
  const medical = randomAmount(rng, 50000, 150000);
  const depart = futureDate(rng, 2026);
  const claimLimit = futureDate(rng, 2026);
  const title = `Contrat assurance voyage ${id}`;
  const body = `# Assurance voyage — formule Globetrotter

**Assureur :** TripCare Assurances  
**Réf. :** ${id}  
**Assuré :** ${p.fullName}  
**Départ prévu :** ${depart}  
**Prime :** **${euro(price)}**

## Garanties
- Frais médicaux à l'étranger jusqu'à **${euro(medical, 0)}**
- Annulation voyage (franchise 50 €)
- Bagages : 1 200 €

## Délais & risques
- Déclaration d'annulation au plus tard 48 heures après l'événement.
- Dossier de remboursement à déposer avant le **${claimLimit}**.
- **Exclusion** : sports extrêmes non déclarés → refus d'indemnisation.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Assurance voyage ${id} pour ${p.fullName} auprès de TripCare, départ ${depart}, prime ${euro(price)}.`,
    people: [p.fullName],
    organizations: ["TripCare Assurances"],
    amounts: [euro(price), euro(medical, 0), "50 €", "1 200 €"],
    dates: [depart],
    deadlines: [
      "Déclaration d'annulation au plus tard 48 heures après l'événement",
      `Dossier de remboursement avant le ${claimLimit}`,
    ],
    importantPoints: [
      `Frais médicaux jusqu'à ${euro(medical, 0)}`,
      `Départ prévu le ${depart}`,
      `Prime ${euro(price)}`,
    ],
    risks: [
      "Refus d'indemnisation pour sports extrêmes non déclarés",
      "Franchise annulation de 50 €",
    ],
    actions: [
      "Déclarer une annulation dans les 48 heures",
      `Déposer le dossier avant le ${claimLimit}`,
    ],
    flags: { shortDeadline: true, sanctions: true },
  });
}

function assAnimaux(rng) {
  const p = person(rng);
  const id = ref("ANI", rng);
  const monthly = randomAmount(rng, 12, 45);
  const ceiling = randomAmount(rng, 1200, 3500);
  const start = pastDate(rng, 2025);
  const cancel = futureDate(rng, 2026);
  const title = `Contrat assurance animaux ${id}`;
  const body = `# Contrat assurance santé animale

**Assureur :** PatteProtect  
**Contrat :** ${id}  
**Souscripteur :** ${p.fullName}  
**Animal :** chien — Border Collie (fictif)  
**Effet :** ${start}

## Formule
- Cotisation : **${euro(monthly)}** / mois
- Plafond annuel soins : **${euro(ceiling, 0)}**
- Taux de remboursement : 70 %

## Clauses
- Engagement minimum 12 mois.
- Résiliation possible à la date anniversaire avec préavis de 2 mois, soit avant le **${cancel}**.
- **Pénalité** de résiliation anticipée : **45 €**.
- **Frais cachés** : participation forfaitaire de 15 € par acte.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Contrat assurance animaux ${id} pour ${p.fullName} auprès de PatteProtect, cotisation ${euro(monthly)}, plafond ${euro(ceiling, 0)}.`,
    people: [p.fullName],
    organizations: ["PatteProtect"],
    amounts: [euro(monthly), euro(ceiling, 0), "45 €", "15 €"],
    dates: [start],
    deadlines: [
      "Engagement minimum 12 mois",
      `Résiliation avec préavis de 2 mois avant le ${cancel}`,
    ],
    importantPoints: [
      `Cotisation mensuelle ${euro(monthly)}`,
      `Plafond annuel ${euro(ceiling, 0)}`,
      "Remboursement à 70 %",
    ],
    risks: [
      "Pénalité de résiliation anticipée de 45 €",
      "Participation forfaitaire de 15 € par acte",
      "Engagement minimum de 12 mois",
    ],
    actions: [
      `Anticiper la résiliation avant le ${cancel}`,
      "Vérifier le plafond restant avant un acte coûteux",
    ],
    flags: { penalties: true, hiddenFees: true, obligations: true },
  });
}

function assScolaire(rng) {
  const parent = person(rng);
  const child = person(rng);
  const id = ref("SCO", rng);
  const premium = randomAmount(rng, 18, 42);
  const schoolYear = "2026-2027";
  const payBy = futureDate(rng, 2026);
  const title = `Contrat assurance scolaire ${id}`;
  const body = `# Assurance scolaire et extrascolaire

**Assureur :** ÉcoleSerein Assurances  
**Référence :** ${id}  
**Souscripteur :** ${parent.fullName}  
**Enfant assuré :** ${child.fullName}  
**Année scolaire :** ${schoolYear}

## Garanties
- Accidents corporels à l'école et sur le trajet
- Responsabilité civile vie privée
- Prime : **${euro(premium)}** pour l'année

## Échéances
- Paiement de la prime avant le **${payBy}**.
- Attestation à remettre à l'établissement sous 10 jours après paiement.

## Risques
- Absence d'attestation → exclusion des activités périscolaires.
- **Renouvellement automatique** sauf opposition écrite 1 mois avant la rentrée.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Assurance scolaire ${id} souscrite par ${parent.fullName} pour ${child.fullName} auprès d'ÉcoleSerein, prime ${euro(premium)}.`,
    people: [parent.fullName, child.fullName],
    organizations: ["ÉcoleSerein Assurances"],
    amounts: [euro(premium)],
    dates: [],
    deadlines: [
      `Paiement de la prime avant le ${payBy}`,
      "Attestation à remettre sous 10 jours après paiement",
      "Opposition écrite 1 mois avant la rentrée",
    ],
    importantPoints: [
      `Année scolaire ${schoolYear}`,
      `Prime ${euro(premium)}`,
      `Enfant assuré : ${child.fullName}`,
    ],
    risks: [
      "Exclusion des activités périscolaires sans attestation",
      "Renouvellement automatique",
    ],
    actions: [
      `Régler la prime avant le ${payBy}`,
      "Remettre l'attestation à l'école sous 10 jours",
    ],
    flags: { autoRenewal: true, shortDeadline: true },
  });
}

function assDependance(rng) {
  const p = person(rng);
  const id = ref("DEP", rng);
  const monthly = randomAmount(rng, 35, 95);
  const rente = randomAmount(rng, 500, 1800);
  const start = pastDate(rng, 2023);
  const review = futureDate(rng, 2026);
  const title = `Contrat assurance dépendance ${id}`;
  const body = `# Contrat dépendance — formule Serenity

**Assureur :** VieLongue Prévoyance  
**Contrat :** ${id}  
**Assuré :** ${p.fullName}  
**Souscription :** ${start}

## Prestations
- Rente mensuelle en cas de dépendance totale : **${euro(rente, 0)}**
- Cotisation actuelle : **${euro(monthly)}** / mois
- Délai de carence : 12 mois

## Points critiques
- Révision tarifaire annuelle notifiée ; acceptation tacite sauf refus avant le **${review}**.
- **Obligation** : questionnaire médical exhaustif à la souscription.
- **Sanction** : nullité du contrat en cas d'omission volontaire.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Contrat dépendance ${id} pour ${p.fullName} auprès de VieLongue Prévoyance, rente ${euro(rente, 0)}, cotisation ${euro(monthly)}.`,
    people: [p.fullName],
    organizations: ["VieLongue Prévoyance"],
    amounts: [euro(rente, 0), euro(monthly)],
    dates: [start],
    deadlines: [
      "Délai de carence de 12 mois",
      `Refus de révision tarifaire avant le ${review}`,
    ],
    importantPoints: [
      `Rente mensuelle ${euro(rente, 0)}`,
      `Cotisation ${euro(monthly)}`,
      "Carence de 12 mois",
    ],
    risks: [
      "Acceptation tacite de la révision tarifaire",
      "Nullité en cas d'omission médicale volontaire",
    ],
    actions: [
      `Contester la révision avant le ${review} si besoin`,
      "Conserver le questionnaire médical rempli",
    ],
    flags: { autoRenewal: true, obligations: true, sanctions: true },
  });
}

function assGav(rng) {
  const p = person(rng);
  const id = ref("GAV", rng);
  const capital = randomAmount(rng, 20000, 100000);
  const premium = randomAmount(rng, 8, 28);
  const effect = pastDate(rng, 2025);
  const modif = futureDate(rng, 2026);
  const title = `Contrat garantie accidents de la vie ${id}`;
  const body = `# Garantie des accidents de la vie (GAV)

**Assureur :** SafeDay Assurances  
**Police :** ${id}  
**Bénéficiaire :** ${p.fullName}  
**Effet :** ${effect}

## Couverture
- Capital décès accidentel : **${euro(capital, 0)}**
- Cotisation : **${euro(premium)}** / mois
- Seuil d'AIPP indemnisable : 10 %

## Modalités
- Toute demande de modification de bénéficiaire avant le **${modif}**.
- Déclaration d'accident sous 72 heures.
- **Frais de dossier** sinistre : **35 €** (peu visibles).

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Contrat GAV ${id} pour ${p.fullName} auprès de SafeDay, capital ${euro(capital, 0)}, cotisation ${euro(premium)}.`,
    people: [p.fullName],
    organizations: ["SafeDay Assurances"],
    amounts: [euro(capital, 0), euro(premium), "35 €"],
    dates: [effect],
    deadlines: [
      `Modification de bénéficiaire avant le ${modif}`,
      "Déclaration d'accident sous 72 heures",
    ],
    importantPoints: [
      `Capital décès ${euro(capital, 0)}`,
      "Seuil AIPP 10 %",
      `Cotisation ${euro(premium)}`,
    ],
    risks: [
      "Frais de dossier sinistre de 35 €",
      "Pas d'indemnisation sous le seuil AIPP de 10 %",
    ],
    actions: [
      `Mettre à jour le bénéficiaire avant le ${modif}`,
      "Déclarer tout accident dans les 72 heures",
    ],
    flags: { hiddenFees: true, shortDeadline: true },
  });
}

function assChantier(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("DO", rng);
  const premium = randomAmount(rng, 900, 4500);
  const works = futureDate(rng, 2026);
  const open = pastDate(rng, 2026);
  const title = `Assurance dommages ouvrage ${id}`;
  const body = `# Police dommages-ouvrage

**Assureur :** BâtiGarant Assurances  
**N° police :** ${id}  
**Maître d'ouvrage :** ${p.fullName}  
**Chantier :** ${a.line}  
**Ouverture de chantier :** ${open}

## Garantie
- Couverture des désordres de nature décennale
- Prime unique : **${euro(premium, 0)}**
- Durée : 10 ans à compter de la réception

## Calendrier
- Réception des travaux prévue le **${works}**.
- Déclaration de sinistre dans les 5 jours suivant la constatation.
- **Obligation** : transmettre le PV de réception sous 15 jours.
- **Sanction** : refus de prise en charge si chantier non déclaré.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Police dommages-ouvrage ${id} pour ${p.fullName} sur le chantier ${a.line}, prime ${euro(premium, 0)}, réception prévue ${works}.`,
    people: [p.fullName],
    organizations: ["BâtiGarant Assurances"],
    amounts: [euro(premium, 0)],
    dates: [open],
    deadlines: [
      `Réception des travaux prévue le ${works}`,
      "Déclaration de sinistre dans les 5 jours",
      "Transmission du PV de réception sous 15 jours",
    ],
    importantPoints: [
      `Prime unique ${euro(premium, 0)}`,
      "Garantie décennale 10 ans",
      `Chantier : ${a.line}`,
    ],
    risks: [
      "Refus de prise en charge si chantier non déclaré",
      "Délai court de 5 jours pour déclarer un sinistre",
    ],
    actions: [
      `Préparer la réception du ${works}`,
      "Transmettre le PV de réception sous 15 jours",
    ],
    flags: { obligations: true, sanctions: true, shortDeadline: true },
  });
}

function assHabAvenant(rng) {
  const p = person(rng);
  const id = ref("AVH", rng);
  const base = ref("ASS", rng);
  const delta = randomAmount(rng, 4, 22);
  const effect = futureDate(rng, 2026);
  const accept = futureDate(rng, 2026);
  const title = `Avenant assurance habitation ${id}`;
  const body = `# Avenant au contrat d'habitation

**Assureur :** SécuriHome Assurances  
**Contrat initial :** ${base}  
**Avenant :** ${id}  
**Assuré :** ${p.fullName}

## Modification
- Extension vol hors domicile activée
- Surprime mensuelle : **${euro(delta)}**
- Date d'effet : **${effect}**

## Acceptation
- Retour signé de l'avenant avant le **${accept}**.
- À défaut, l'extension ne prendra pas effet.
- **Tacite reconduction** du contrat principal inchangée.

${footer()}`;

  return pack("assurances", title, body, {
    documentType: "Assurance",
    title,
    summary: `Avenant ${id} au contrat habitation ${base} pour ${p.fullName}, surprime ${euro(delta)}, effet au ${effect}.`,
    people: [p.fullName],
    organizations: ["SécuriHome Assurances"],
    amounts: [euro(delta)],
    dates: [effect],
    deadlines: [`Retour signé de l'avenant avant le ${accept}`],
    importantPoints: [
      `Surprime ${euro(delta)}`,
      `Effet au ${effect}`,
      "Extension vol hors domicile",
    ],
    risks: [
      "Sans retour signé, l'extension ne prend pas effet",
      "Tacite reconduction du contrat principal maintenue",
    ],
    actions: [
      `Retourner l'avenant signé avant le ${accept}`,
      "Vérifier la surprime sur le prochain prélèvement",
    ],
    flags: { autoRenewal: true, shortDeadline: false },
  });
}

/* -------------------------------------------------------------------------- */
/* BANQUES — 10 sous-types                                                     */
/* -------------------------------------------------------------------------- */

function banConvention(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("CC", rng);
  const fees = randomAmount(rng, 2, 9);
  const overdraft = randomAmount(rng, 200, 1000);
  const open = pastDate(rng, 2024);
  const notice = futureDate(rng, 2026);
  const title = `Convention de compte ${id}`;
  const body = `# Convention de compte de dépôt

**Banque :** Banque des Vallées  
**N° convention :** ${id}  
**Titulaire :** ${p.fullName}  
**Adresse :** ${a.line}  
**Ouverture :** ${open}

## Tarification
- Tenue de compte : **${euro(fees)}** / mois
- Découvert autorisé : **${euro(overdraft, 0)}**
- Carte Visa Classic incluse

## Engagements
- Préavis de clôture : 30 jours.
- Contestation d'opération sous 13 mois.
- Modification tarifaire opposable sauf résiliation avant le **${notice}**.
- **Pénalités** d'incident de paiement : jusqu'à **20 €** / rejet.
- **Frais annexes** de recherche de document : **12 €**.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Convention de compte ${id} pour ${p.fullName} à la Banque des Vallées, tenue de compte ${euro(fees)}, découvert ${euro(overdraft, 0)}.`,
    people: [p.fullName],
    organizations: ["Banque des Vallées"],
    amounts: [euro(fees), euro(overdraft, 0), "20 €", "12 €"],
    dates: [open],
    deadlines: [
      "Préavis de clôture de 30 jours",
      "Contestation d'opération sous 13 mois",
      `Résiliation avant le ${notice} en cas de modification tarifaire`,
    ],
    importantPoints: [
      `Tenue de compte ${euro(fees)}`,
      `Découvert autorisé ${euro(overdraft, 0)}`,
      "Carte Visa Classic incluse",
    ],
    risks: [
      "Pénalités d'incident jusqu'à 20 € par rejet",
      "Frais de recherche de document de 12 €",
      "Modification tarifaire opposable",
    ],
    actions: [
      `Évaluer une résiliation avant le ${notice} si les tarifs évoluent`,
      "Contester toute opération douteuse sous 13 mois",
    ],
    flags: { penalties: true, hiddenFees: true, autoRenewal: false },
  });
}

function banOpposition(rng) {
  const p = person(rng);
  const id = ref("OPP", rng);
  const card = `4532 **** **** ${Math.floor(1000 + rng() * 8999)}`;
  const fee = randomAmount(rng, 8, 20);
  const declared = pastDate(rng, 2026);
  const confirm = futureDate(rng, 2026);
  const title = `Confirmation opposition carte ${id}`;
  const body = `# Confirmation d'opposition sur carte bancaire

**Établissement :** Banque Horizon  
**Réf. opposition :** ${id}  
**Titulaire :** ${p.fullName}  
**Carte :** ${card}  
**Date de déclaration :** ${declared}

## Suite donnée
- Carte mise en opposition immédiate
- Frais d'opposition : **${euro(fee)}**
- Nouvelle carte expédiée sous 5 jours ouvrés

## À faire
- Confirmer par écrit l'absence d'utilisation frauduleuse avant le **${confirm}**.
- Délai de réclamation des opérations contestées : 70 jours.
- **Sanction** possible : responsabilité du titulaire si négligence caractérisée.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Confirmation d'opposition carte ${id} pour ${p.fullName} auprès de Banque Horizon, frais ${euro(fee)}, déclaration le ${declared}.`,
    people: [p.fullName],
    organizations: ["Banque Horizon"],
    amounts: [euro(fee)],
    dates: [declared],
    deadlines: [
      `Confirmation écrite avant le ${confirm}`,
      "Réclamation des opérations contestées sous 70 jours",
      "Nouvelle carte sous 5 jours ouvrés",
    ],
    importantPoints: [
      `Carte ${card} opposée`,
      `Frais d'opposition ${euro(fee)}`,
      `Déclaration le ${declared}`,
    ],
    risks: [
      "Responsabilité du titulaire en cas de négligence",
      `Frais d'opposition de ${euro(fee)}`,
    ],
    actions: [
      `Confirmer par écrit avant le ${confirm}`,
      "Surveiller les opérations sur 70 jours",
    ],
    flags: { sanctions: true, shortDeadline: false },
  });
}

function banCreditConso(rng) {
  const p = person(rng);
  const id = ref("CRC", rng);
  const amount = randomAmount(rng, 3000, 18000);
  const monthly = randomAmount(rng, 80, 320);
  const taeg = randomAmount(rng, 3.5, 9.9);
  const offer = pastDate(rng, 2026);
  const accept = futureDate(rng, 2026);
  const title = `Offre de crédit consommation ${id}`;
  const body = `# Offre de crédit à la consommation

**Prêteur :** Crédit Fleuve SAS  
**Offre :** ${id}  
**Emprunteur :** ${p.fullName}  
**Date d'offre :** ${offer}

## Conditions
- Montant emprunté : **${euro(amount, 0)}**
- Mensualité : **${euro(monthly)}**
- TAEG fixe : **${formatMoney(taeg, 1)} %**
- Durée : 48 mois

## Délais légaux
- Acceptation de l'offre au plus tard le **${accept}**.
- Droit de rétractation : 14 jours calendaires après acceptation.
- **Pénalités** de remboursement anticipé : 1 % du capital restant dû.
- **Obligation** : assurance emprunteur facultative mais recommandée.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Offre de crédit consommation ${id} de Crédit Fleuve pour ${p.fullName}, montant ${euro(amount, 0)}, mensualité ${euro(monthly)}, TAEG ${formatMoney(taeg, 1)} %.`,
    people: [p.fullName],
    organizations: ["Crédit Fleuve SAS"],
    amounts: [euro(amount, 0), euro(monthly)],
    dates: [offer],
    deadlines: [
      `Acceptation de l'offre au plus tard le ${accept}`,
      "Droit de rétractation de 14 jours calendaires",
    ],
    importantPoints: [
      `Montant ${euro(amount, 0)}`,
      `Mensualité ${euro(monthly)}`,
      `TAEG ${formatMoney(taeg, 1)} %`,
      "Durée 48 mois",
    ],
    risks: [
      "Pénalités de remboursement anticipé de 1 %",
      "Engagement sur 48 mois",
    ],
    actions: [
      `Accepter ou refuser avant le ${accept}`,
      "Utiliser le délai de rétractation de 14 jours si besoin",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function banCloture(rng) {
  const p = person(rng);
  const id = ref("CLO", rng);
  const balance = randomAmount(rng, 12, 890);
  const fee = randomAmount(rng, 0, 45);
  const request = pastDate(rng, 2026);
  const effective = futureDate(rng, 2026);
  const title = `Accusé clôture de compte ${id}`;
  const body = `# Accusé de réception — demande de clôture

**Banque :** Banque Horizon  
**Dossier :** ${id}  
**Client :** ${p.fullName}  
**Demande reçue le :** ${request}

## Traitement
- Solde créditeur à restituer : **${euro(balance)}**
- Frais de clôture : **${euro(fee)}**
- Date d'effet prévue : **${effective}**

## Conditions
- Restituer chéquier et carte sous 10 jours.
- Maintenir provision jusqu'à la date d'effet.
- **Sanction** : maintien des frais si moyens de paiement non restitués.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Accusé de clôture ${id} pour ${p.fullName} à Banque Horizon, solde ${euro(balance)}, effet au ${effective}.`,
    people: [p.fullName],
    organizations: ["Banque Horizon"],
    amounts: [euro(balance), euro(fee)],
    dates: [request, effective],
    deadlines: [
      "Restitution chéquier et carte sous 10 jours",
      `Date d'effet de clôture le ${effective}`,
    ],
    importantPoints: [
      `Solde à restituer ${euro(balance)}`,
      `Frais de clôture ${euro(fee)}`,
      `Effet au ${effective}`,
    ],
    risks: [
      "Maintien des frais si moyens de paiement non restitués",
      `Frais de clôture de ${euro(fee)}`,
    ],
    actions: [
      "Restituer chéquier et carte sous 10 jours",
      "Vérifier le virement du solde après clôture",
    ],
    flags: { sanctions: true, shortDeadline: true },
  });
}

function banPretImmo(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("IMM", rng);
  const capital = randomAmount(rng, 120000, 380000);
  const rate = randomAmount(rng, 2.8, 4.2);
  const monthly = randomAmount(rng, 650, 1600);
  const signed = pastDate(rng, 2025);
  const insurance = futureDate(rng, 2026);
  const title = `Offre de prêt immobilier ${id}`;
  const body = `# Offre de prêt immobilier

**Banque :** Banque des Vallées  
**Offre :** ${id}  
**Emprunteur :** ${p.fullName}  
**Bien financé :** ${a.line}  
**Émission :** ${signed}

## Caractéristiques
- Capital : **${euro(capital, 0)}**
- Taux nominal fixe : **${formatMoney(rate, 2)} %**
- Mensualité hors assurance : **${euro(monthly)}**
- Durée : 25 ans

## Conditions suspensives
- Justification d'assurance emprunteur avant le **${insurance}**.
- Délai de réflexion légal : 10 jours.
- **Pénalités** de remboursement anticipé : 3 % du capital remboursé dans la limite de 6 mois d'intérêts.
- **Frais de dossier** : **450 €**.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Offre de prêt immobilier ${id} pour ${p.fullName}, capital ${euro(capital, 0)}, taux ${formatMoney(rate, 2)} %, mensualité ${euro(monthly)}.`,
    people: [p.fullName],
    organizations: ["Banque des Vallées"],
    amounts: [euro(capital, 0), euro(monthly), "450 €"],
    dates: [signed],
    deadlines: [
      `Justification d'assurance emprunteur avant le ${insurance}`,
      "Délai de réflexion légal de 10 jours",
    ],
    importantPoints: [
      `Capital ${euro(capital, 0)}`,
      `Taux ${formatMoney(rate, 2)} %`,
      `Mensualité ${euro(monthly)}`,
      "Durée 25 ans",
    ],
    risks: [
      "Pénalités de remboursement anticipé jusqu'à 3 %",
      "Frais de dossier de 450 €",
    ],
    actions: [
      `Fournir l'assurance emprunteur avant le ${insurance}`,
      "Respecter le délai de réflexion de 10 jours",
    ],
    flags: { penalties: true, hiddenFees: true },
  });
}

function banAlerteDecouvert(rng) {
  const p = person(rng);
  const id = ref("ALT", rng);
  const balance = -randomAmount(rng, 50, 680);
  const fee = randomAmount(rng, 8, 25);
  const issued = pastDate(rng, 2026);
  const regularize = futureDate(rng, 2026);
  const title = `Alerte découvert non autorisé ${id}`;
  const body = `# Alerte — position débitrice non autorisée

**Banque :** Banque Horizon  
**Alerte :** ${id}  
**Client :** ${p.fullName}  
**Date :** ${issued}

## Situation
- Solde actuel : **${euro(balance)}**
- Commission d'intervention déjà prélevée : **${euro(fee)}**

## Mise en demeure
- Régularisation du solde avant le **${regularize}**.
- À défaut : suspension de la carte et du chéquier.
- **Sanction** : signalement possible à la Banque de France.
- **Obligation** : contacter le conseiller sous 48 heures.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Alerte découvert ${id} pour ${p.fullName} à Banque Horizon, solde ${euro(balance)}, régularisation avant le ${regularize}.`,
    people: [p.fullName],
    organizations: ["Banque Horizon"],
    amounts: [euro(balance), euro(fee)],
    dates: [issued],
    deadlines: [
      `Régularisation du solde avant le ${regularize}`,
      "Contacter le conseiller sous 48 heures",
    ],
    importantPoints: [
      `Solde ${euro(balance)}`,
      `Commission ${euro(fee)}`,
      `Alerte du ${issued}`,
    ],
    risks: [
      "Suspension carte et chéquier",
      "Signalement possible à la Banque de France",
    ],
    actions: [
      `Régulariser avant le ${regularize}`,
      "Contacter le conseiller sous 48 heures",
    ],
    flags: { sanctions: true, obligations: true, shortDeadline: true, penalties: true },
  });
}

function banSepa(rng) {
  const p = person(rng);
  const id = ref("SEPA", rng);
  const amount = randomAmount(rng, 29, 320);
  const creditor = pick(rng, ["Energia Plus", "Mutuelle Harmonie+", "BoxNet Fibre"]);
  const opDate = pastDate(rng, 2026);
  const claim = futureDate(rng, 2026);
  const title = `Contestation prélèvement SEPA ${id}`;
  const body = `# Formulaire de contestation de prélèvement SEPA

**Banque :** Banque des Vallées  
**Dossier :** ${id}  
**Titulaire :** ${p.fullName}  
**Créancier :** ${creditor}  
**Montant contesté :** **${euro(amount)}**  
**Date d'opération :** ${opDate}

## Demande
Le titulaire conteste le prélèvement et demande le remboursement.

## Délais
- Instruction sous 10 jours ouvrés.
- Compléments à fournir avant le **${claim}**.
- Droit de recours : 8 semaines pour un prélèvement autorisé, 13 mois si non autorisé.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Contestation SEPA ${id} de ${p.fullName} contre ${creditor} pour ${euro(amount)} prélevé le ${opDate}.`,
    people: [p.fullName],
    organizations: ["Banque des Vallées", creditor],
    amounts: [euro(amount)],
    dates: [opDate],
    deadlines: [
      "Instruction sous 10 jours ouvrés",
      `Compléments à fournir avant le ${claim}`,
      "Recours sous 8 semaines pour prélèvement autorisé",
    ],
    importantPoints: [
      `Montant contesté ${euro(amount)}`,
      `Créancier ${creditor}`,
      `Opération du ${opDate}`,
    ],
    risks: [
      "Rejet de la contestation si compléments non fournis",
      "Délai de recours limité à 8 semaines si autorisé",
    ],
    actions: [
      `Fournir les compléments avant le ${claim}`,
      "Suivre l'instruction sous 10 jours ouvrés",
    ],
    flags: { shortDeadline: false },
  });
}

function banAssuranceEmprunteur(rng) {
  const p = person(rng);
  const id = ref("AE", rng);
  const loan = ref("IMM", rng);
  const premium = randomAmount(rng, 28, 95);
  const start = pastDate(rng, 2025);
  const switchBy = futureDate(rng, 2026);
  const title = `Contrat assurance emprunteur ${id}`;
  const body = `# Assurance emprunteur déléguée

**Assureur :** EmpruntSerein  
**Contrat :** ${id}  
**Prêt adossé :** ${loan}  
**Assuré :** ${p.fullName}  
**Effet :** ${start}

## Cotisation
- Prime mensuelle : **${euro(premium)}**
- Couverture : décès / PTIA / ITT

## Résiliation / substitution
- Possibilité de changer d'assurance à date anniversaire avec préavis de 2 mois, soit avant le **${switchBy}**.
- **Pénalité** administrative de substitution : **40 €**.
- **Obligation** : équivalence de garanties à démontrer.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Assurance emprunteur ${id} pour ${p.fullName} auprès d'EmpruntSerein, prime ${euro(premium)}, prêt ${loan}.`,
    people: [p.fullName],
    organizations: ["EmpruntSerein"],
    amounts: [euro(premium), "40 €"],
    dates: [start],
    deadlines: [
      `Changement d'assurance avec préavis de 2 mois avant le ${switchBy}`,
    ],
    importantPoints: [
      `Prime ${euro(premium)}`,
      "Garanties décès / PTIA / ITT",
      `Prêt adossé ${loan}`,
    ],
    risks: [
      "Pénalité administrative de substitution de 40 €",
      "Refus possible si non-équivalence de garanties",
    ],
    actions: [
      `Anticiper une substitution avant le ${switchBy}`,
      "Préparer le tableau d'équivalence de garanties",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function banLivret(rng) {
  const p = person(rng);
  const id = ref("LIV", rng);
  const balance = randomAmount(rng, 500, 22000);
  const rate = randomAmount(rng, 1.5, 3.2);
  const period = pastDate(rng, 2026);
  const answer = futureDate(rng, 2026);
  const title = `Relevé livret épargne ${id}`;
  const body = `# Relevé de livret d'épargne

**Banque :** Banque Horizon  
**Compte :** ${id}  
**Titulaire :** ${p.fullName}  
**Arrêté au :** ${period}

## Situation
- Solde : **${euro(balance)}**
- Taux nominal annuel : **${formatMoney(rate, 2)} %**
- Intérêts crédités annuellement au 31/12

## Information
- Réponse à la proposition de transfert vers un livret boosté avant le **${answer}**.
- Plafond réglementaire à surveiller.
- **Frais** de transfert vers un autre établissement : **15 €**.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Relevé de livret ${id} pour ${p.fullName} à Banque Horizon, solde ${euro(balance)}, taux ${formatMoney(rate, 2)} %.`,
    people: [p.fullName],
    organizations: ["Banque Horizon"],
    amounts: [euro(balance), "15 €"],
    dates: [period],
    deadlines: [`Réponse à la proposition de transfert avant le ${answer}`],
    importantPoints: [
      `Solde ${euro(balance)}`,
      `Taux ${formatMoney(rate, 2)} %`,
      "Intérêts au 31/12",
    ],
    risks: [
      "Frais de transfert de 15 €",
      "Risque de dépassement de plafond",
    ],
    actions: [
      `Répondre avant le ${answer} à la proposition de transfert`,
      "Vérifier le plafond réglementaire",
    ],
    flags: { hiddenFees: true },
  });
}

function banChiffreAffairePro(rng) {
  const p = person(rng);
  const id = ref("PRO", rng);
  const fee = randomAmount(rng, 15, 45);
  const tpe = randomAmount(rng, 0.3, 1.2);
  const start = pastDate(rng, 2025);
  const terminate = futureDate(rng, 2026);
  const title = `Convention compte professionnel ${id}`;
  const body = `# Convention de compte professionnel

**Banque :** Banque des Vallées Entreprises  
**Convention :** ${id}  
**Titulaire :** ${p.fullName} — EI  
**Ouverture :** ${start}

## Tarifs
- Abonnement mensuel : **${euro(fee)}**
- Commission TPE : **${formatMoney(tpe, 2)} %** + 0,05 € / transaction
- Virement SEPA instantané : 1 €

## Résiliation
- Préavis de 60 jours, dénonciation à formaliser avant le **${terminate}**.
- **Pénalités** de résiliation anticipée la première année : **90 €**.
- **Obligation** : IBAN de repli pour les prélèvements en cours.

${footer()}`;

  return pack("banques", title, body, {
    documentType: "Banque",
    title,
    summary: `Convention compte professionnel ${id} pour ${p.fullName}, abonnement ${euro(fee)}, commission TPE ${formatMoney(tpe, 2)} %.`,
    people: [p.fullName],
    organizations: ["Banque des Vallées Entreprises"],
    amounts: [euro(fee), "1 €", "90 €"],
    dates: [start],
    deadlines: [
      "Préavis de 60 jours",
      `Dénonciation avant le ${terminate}`,
    ],
    importantPoints: [
      `Abonnement ${euro(fee)}`,
      `Commission TPE ${formatMoney(tpe, 2)} %`,
      "Compte professionnel EI",
    ],
    risks: [
      "Pénalité de résiliation anticipée de 90 €",
      "Commission TPE variable selon volume",
    ],
    actions: [
      `Anticiper la dénonciation avant le ${terminate}`,
      "Prévoir un IBAN de repli",
    ],
    flags: { penalties: true, obligations: true },
  });
}

/* -------------------------------------------------------------------------- */
/* TRAVAIL — 10 sous-types                                                     */
/* -------------------------------------------------------------------------- */

function travCDD(rng) {
  const emp = person(rng);
  const id = ref("CDD", rng);
  const salary = randomAmount(rng, 1800, 2800);
  const start = futureDate(rng, 2026);
  const end = futureDate(rng, 2026);
  const title = `Contrat de travail CDD ${id}`;
  const body = `# Contrat de travail à durée déterminée

**Employeur :** Atelier Lumina SAS  
**Salarié :** ${emp.fullName}  
**Réf. :** ${id}  
**Poste :** Assistant(e) logistique  
**Période :** du ${start} au ${end}

## Rémunération
- Salaire brut mensuel : **${euro(salary, 0)}**
- 35 heures / semaine
- Prime de précarité : 10 % en fin de contrat

## Délais
- Période d'essai : 2 semaines.
- Remise des documents de fin de contrat sous 8 jours après le ${end}.
- **Sanction** disciplinaire possible en cas d'absence injustifiée.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `CDD ${id} d'Atelier Lumina pour ${emp.fullName}, du ${start} au ${end}, salaire ${euro(salary, 0)}.`,
    people: [emp.fullName],
    organizations: ["Atelier Lumina SAS"],
    amounts: [euro(salary, 0)],
    dates: [start, end],
    deadlines: [
      "Période d'essai de 2 semaines",
      `Remise des documents de fin de contrat sous 8 jours après le ${end}`,
    ],
    importantPoints: [
      `Salaire brut ${euro(salary, 0)}`,
      `Fin de CDD le ${end}`,
      "Prime de précarité 10 %",
    ],
    risks: [
      "Sanction disciplinaire en cas d'absence injustifiée",
      "Fin automatique au terme du CDD",
    ],
    actions: [
      "Surveiller la fin de période d'essai de 2 semaines",
      "Anticiper les documents de fin de contrat",
    ],
    flags: { sanctions: true },
  });
}

function travAvenant(rng) {
  const emp = person(rng);
  const id = ref("AVT", rng);
  const oldSal = randomAmount(rng, 2200, 3000);
  const newSal = oldSal + randomAmount(rng, 80, 250);
  const effect = futureDate(rng, 2026);
  const signBy = futureDate(rng, 2026);
  const title = `Avenant contrat de travail ${id}`;
  const body = `# Avenant au contrat de travail CDI

**Employeur :** NovaTech Solutions  
**Salarié :** ${emp.fullName}  
**Avenant :** ${id}

## Modifications
- Passage au forfait jours (218 jours / an)
- Salaire brut : de **${euro(oldSal, 0)}** à **${euro(newSal, 0)}**
- Date d'effet : **${effect}**

## Formalités
- Signature de l'avenant avant le **${signBy}**.
- Droit de reflexion : 7 jours.
- **Obligation** : suivi du forfait jours via outil RH.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Avenant ${id} pour ${emp.fullName} chez NovaTech, salaire porté à ${euro(newSal, 0)}, effet ${effect}.`,
    people: [emp.fullName],
    organizations: ["NovaTech Solutions"],
    amounts: [euro(oldSal, 0), euro(newSal, 0)],
    dates: [effect],
    deadlines: [
      `Signature de l'avenant avant le ${signBy}`,
      "Droit de réflexion de 7 jours",
    ],
    importantPoints: [
      "Passage au forfait 218 jours",
      `Nouveau salaire ${euro(newSal, 0)}`,
      `Effet au ${effect}`,
    ],
    risks: [
      "Charge de travail liée au forfait jours",
      "Sans signature, l'avenant est sans effet",
    ],
    actions: [
      `Signer avant le ${signBy}`,
      "Utiliser le délai de réflexion de 7 jours",
    ],
    flags: { obligations: true },
  });
}

function travRupture(rng) {
  const emp = person(rng);
  const id = ref("RC", rng);
  const indemnity = randomAmount(rng, 2500, 12000);
  const meeting = futureDate(rng, 2026);
  const sign = futureDate(rng, 2026);
  const title = `Proposition rupture conventionnelle ${id}`;
  const body = `# Proposition de rupture conventionnelle

**Employeur :** Atelier Lumina SAS  
**Salarié :** ${emp.fullName}  
**Dossier :** ${id}

## Proposition
- Indemnité spécifique : **${euro(indemnity, 0)}**
- Entretien prévu le **${meeting}**
- Signature envisageable le **${sign}**

## Calendrier
- Délai de rétractation : 15 jours calendaires après signature.
- Homologation DREETS : 15 jours ouvrés.
- **Obligation** : présence libre et éclairée des deux parties.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Proposition de rupture conventionnelle ${id} pour ${emp.fullName}, indemnité ${euro(indemnity, 0)}, entretien ${meeting}.`,
    people: [emp.fullName],
    organizations: ["Atelier Lumina SAS"],
    amounts: [euro(indemnity, 0)],
    dates: [],
    deadlines: [
      `Entretien prévu le ${meeting}`,
      `Signature envisageable le ${sign}`,
      "Délai de rétractation de 15 jours calendaires",
      "Homologation DREETS sous 15 jours ouvrés",
    ],
    importantPoints: [
      `Indemnité ${euro(indemnity, 0)}`,
      `Entretien le ${meeting}`,
    ],
    risks: [
      "Homologation refusée si délais non respectés",
      "Consentement contestable en cas de pression",
    ],
    actions: [
      `Préparer l'entretien du ${meeting}`,
      "Respecter le délai de rétractation de 15 jours",
    ],
    flags: { obligations: true },
  });
}

function travAvertissement(rng) {
  const emp = person(rng);
  const id = ref("AVR", rng);
  const incident = pastDate(rng, 2026);
  const reply = futureDate(rng, 2026);
  const title = `Avertissement disciplinaire ${id}`;
  const body = `# Avertissement disciplinaire

**Employeur :** NovaTech Solutions  
**Salarié :** ${emp.fullName}  
**Réf. :** ${id}  
**Faits du :** ${incident}

## Motif
Retards répétés non justifiés sur une période de deux semaines.

## Suites
- Observations écrites à formuler avant le **${reply}**.
- Conservation au dossier pendant 2 ans.
- **Sanction** ultérieure possible en cas de récidive (mise à pied).
- **Obligation** de respecter les horaires contractuels.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Avertissement disciplinaire ${id} adressé à ${emp.fullName} par NovaTech pour faits du ${incident}.`,
    people: [emp.fullName],
    organizations: ["NovaTech Solutions"],
    amounts: [],
    dates: [incident],
    deadlines: [`Observations écrites avant le ${reply}`],
    importantPoints: [
      `Faits du ${incident}`,
      "Conservation au dossier 2 ans",
    ],
    risks: [
      "Mise à pied possible en cas de récidive",
      "Impact sur le dossier disciplinaire",
    ],
    actions: [
      `Répondre par écrit avant le ${reply}`,
      "Respecter strictement les horaires",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

function travSTC(rng) {
  const emp = person(rng);
  const id = ref("STC", rng);
  const net = randomAmount(rng, 1200, 4800);
  const end = pastDate(rng, 2026);
  const claim = futureDate(rng, 2026);
  const title = `Solde de tout compte ${id}`;
  const body = `# Reçu pour solde de tout compte

**Employeur :** Atelier Lumina SAS  
**Salarié :** ${emp.fullName}  
**Réf. :** ${id}  
**Fin de contrat :** ${end}

## Montants
- Net à payer : **${euro(net)}**
- Dont congés payés et prime de précarité inclus

## Contestation
- Délai de dénonciation du reçu : 6 mois.
- Contestation détaillée à adresser avant le **${claim}** pour accélérer le traitement interne.
- Documents remis : certificat de travail, attestation France Travail, solde.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Solde de tout compte ${id} pour ${emp.fullName} suite à fin de contrat au ${end}, net ${euro(net)}.`,
    people: [emp.fullName],
    organizations: ["Atelier Lumina SAS"],
    amounts: [euro(net)],
    dates: [end],
    deadlines: [
      "Délai de dénonciation du reçu de 6 mois",
      `Contestation détaillée avant le ${claim}`,
    ],
    importantPoints: [
      `Net à payer ${euro(net)}`,
      `Fin de contrat ${end}`,
    ],
    risks: [
      "Renonciation partielle aux créances si reçu non dénoncé",
    ],
    actions: [
      "Vérifier le calcul avant signature définitive",
      `Contester avant le ${claim} si écart constaté`,
    ],
    flags: {},
  });
}

function travPromesse(rng) {
  const emp = person(rng);
  const id = ref("PEM", rng);
  const salary = randomAmount(rng, 2600, 4200);
  const start = futureDate(rng, 2026);
  const accept = futureDate(rng, 2026);
  const title = `Promesse d'embauche ${id}`;
  const body = `# Promesse unilatérale d'embauche

**Société :** PixelForge SARL  
**Candidat :** ${emp.fullName}  
**Réf. :** ${id}  
**Poste :** Développeur(se) full-stack  
**Date d'entrée prévue :** ${start}

## Conditions
- CDI — salaire brut : **${euro(salary, 0)}**
- Lieu : télétravail hybride 3 jours / semaine

## Validité
- Acceptation écrite avant le **${accept}**.
- À défaut, la promesse devient caduque.
- **Pénalité** de rétractation employeur injustifiée : **${euro(salary * 0.5, 0)}**.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Promesse d'embauche ${id} de PixelForge pour ${emp.fullName}, CDI à ${euro(salary, 0)}, entrée le ${start}.`,
    people: [emp.fullName],
    organizations: ["PixelForge SARL"],
    amounts: [euro(salary, 0), euro(salary * 0.5, 0)],
    dates: [start],
    deadlines: [`Acceptation écrite avant le ${accept}`],
    importantPoints: [
      `Salaire ${euro(salary, 0)}`,
      `Entrée le ${start}`,
      "Télétravail hybride 3 jours",
    ],
    risks: [
      "Promesse caduque sans acceptation écrite",
      `Pénalité employeur de ${euro(salary * 0.5, 0)} en cas de rétractation injustifiée`,
    ],
    actions: [
      `Accepter par écrit avant le ${accept}`,
      "Conserver la promesse signée",
    ],
    flags: { penalties: true, shortDeadline: false },
  });
}

function travStage(rng) {
  const stu = person(rng);
  const id = ref("STG", rng);
  const gratification = randomAmount(rng, 600, 900);
  const start = futureDate(rng, 2026);
  const end = futureDate(rng, 2026);
  const title = `Convention de stage ${id}`;
  const body = `# Convention de stage tripartite

**Organisme d'accueil :** NovaTech Solutions  
**Stagiaire :** ${stu.fullName}  
**Établissement :** Université des Sciences Appliquées  
**Réf. :** ${id}  
**Période :** du ${start} au ${end}

## Conditions
- Gratification mensuelle : **${euro(gratification, 0)}**
- Durée : 4 mois — 35 h / semaine
- Tuteur entreprise désigné

## Échéances
- Signature de la convention avant le **${start}**.
- Évaluation intermédiaire à mi-parcours.
- Remise du rapport de stage sous 15 jours après le ${end}.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Convention de stage ${id} pour ${stu.fullName} chez NovaTech du ${start} au ${end}, gratification ${euro(gratification, 0)}.`,
    people: [stu.fullName],
    organizations: ["NovaTech Solutions", "Université des Sciences Appliquées"],
    amounts: [euro(gratification, 0)],
    dates: [start, end],
    deadlines: [
      `Signature de la convention avant le ${start}`,
      `Remise du rapport de stage sous 15 jours après le ${end}`,
    ],
    importantPoints: [
      `Gratification ${euro(gratification, 0)}`,
      "Durée 4 mois",
      `Fin le ${end}`,
    ],
    risks: [
      "Stage non valide sans convention signée",
      "Pas de rémunération au SMIC",
    ],
    actions: [
      `Signer avant le ${start}`,
      "Prévoir le rapport dans les 15 jours suivant la fin",
    ],
    flags: {},
  });
}

function travTeletravail(rng) {
  const emp = person(rng);
  const id = ref("TT", rng);
  const allowance = randomAmount(rng, 10, 30);
  const effect = futureDate(rng, 2026);
  const review = futureDate(rng, 2026);
  const title = `Charte télétravail ${id}`;
  const body = `# Avenant télétravail

**Employeur :** PixelForge SARL  
**Salarié :** ${emp.fullName}  
**Réf. :** ${id}  
**Effet :** ${effect}

## Modalités
- 2 jours de télétravail / semaine (mardi, jeudi)
- Indemnité forfaitaire : **${euro(allowance)}** / mois
- Plages de joignabilité : 9h30–12h30 / 14h–17h30

## Révision
- Clause révisable ; notification de modification avant le **${review}**.
- Préavis de 15 jours pour suspendre le télétravail.
- **Obligation** : espace de travail conforme et connexion stable.
- **Sanction** : retrait du télétravail en cas de non-respect répété.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Avenant télétravail ${id} pour ${emp.fullName} chez PixelForge, indemnité ${euro(allowance)}, effet ${effect}.`,
    people: [emp.fullName],
    organizations: ["PixelForge SARL"],
    amounts: [euro(allowance)],
    dates: [effect],
    deadlines: [
      `Notification de modification avant le ${review}`,
      "Préavis de 15 jours pour suspendre le télétravail",
    ],
    importantPoints: [
      "2 jours de télétravail par semaine",
      `Indemnité ${euro(allowance)}`,
      `Effet au ${effect}`,
    ],
    risks: [
      "Retrait du télétravail en cas de non-respect",
      "Clause révisable unilatéralement avec préavis",
    ],
    actions: [
      `Surveiller une éventuelle modification avant le ${review}`,
      "Respecter les plages de joignabilité",
    ],
    flags: { obligations: true, sanctions: true },
  });
}

function travLicenciement(rng) {
  const emp = person(rng);
  const id = ref("LIC", rng);
  const indemnity = randomAmount(rng, 1800, 9000);
  const interview = futureDate(rng, 2026);
  const decision = futureDate(rng, 2026);
  const title = `Convocation entretien préalable ${id}`;
  const body = `# Convocation à entretien préalable à un éventuel licenciement

**Employeur :** Atelier Lumina SAS  
**Salarié :** ${emp.fullName}  
**Réf. :** ${id}

## Entretien
- Date : **${interview}** à 10h00
- Lieu : siège social — salle 2
- Motif envisagé : motif économique (réorganisation)

## Droits
- Assistance possible par un conseiller du salarié.
- Notification de décision au plus tôt le **${decision}**.
- Indemnité légale estimée si licenciement : **${euro(indemnity, 0)}**.
- **Délai** de recours prud'homal : 12 mois.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Convocation à entretien préalable ${id} pour ${emp.fullName} le ${interview}, décision possible au ${decision}.`,
    people: [emp.fullName],
    organizations: ["Atelier Lumina SAS"],
    amounts: [euro(indemnity, 0)],
    dates: [],
    deadlines: [
      `Entretien le ${interview}`,
      `Notification de décision au plus tôt le ${decision}`,
      "Délai de recours prud'homal de 12 mois",
    ],
    importantPoints: [
      `Entretien le ${interview}`,
      `Indemnité estimée ${euro(indemnity, 0)}`,
      "Motif économique envisagé",
    ],
    risks: [
      "Licenciement possible après l'entretien",
      "Délai de recours limité à 12 mois",
    ],
    actions: [
      `Se présenter à l'entretien du ${interview}`,
      "Se faire assister si besoin",
    ],
    flags: { shortDeadline: false },
  });
}

function travClauseNonConcurrence(rng) {
  const emp = person(rng);
  const id = ref("CNC", rng);
  const indemnity = randomAmount(rng, 200, 600);
  const start = pastDate(rng, 2022);
  const waive = futureDate(rng, 2026);
  const title = `Clause de non-concurrence ${id}`;
  const body = `# Rappel de clause de non-concurrence

**Employeur :** PixelForge SARL  
**Salarié :** ${emp.fullName}  
**Contrat d'origine :** ${id} signé le ${start}

## Périmètre
- Durée : 12 mois après rupture
- Zone : région Auvergne-Rhône-Alpes
- Contrepartie mensuelle : **${euro(indemnity)}**

## Levée
- L'employeur peut renoncer à la clause avant le **${waive}**.
- À défaut, la contrepartie devient due.
- **Sanction** : astreinte journalière en cas de violation.
- **Obligation** : informer de tout nouvel employeur dans le secteur.

${footer()}`;

  return pack("travail", title, body, {
    documentType: "Contrat de travail",
    title,
    summary: `Rappel de clause de non-concurrence ${id} pour ${emp.fullName}, contrepartie ${euro(indemnity)}, renonciation possible avant ${waive}.`,
    people: [emp.fullName],
    organizations: ["PixelForge SARL"],
    amounts: [euro(indemnity)],
    dates: [start],
    deadlines: [
      "Durée de 12 mois après rupture",
      `Renonciation employeur avant le ${waive}`,
    ],
    importantPoints: [
      `Contrepartie ${euro(indemnity)}`,
      "Zone Auvergne-Rhône-Alpes",
      "Durée 12 mois",
    ],
    risks: [
      "Astreinte journalière en cas de violation",
      "Contrepartie due si non-renonciation",
    ],
    actions: [
      `Vérifier une éventuelle renonciation avant le ${waive}`,
      "Informer de tout nouvel employeur concerné",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

/* -------------------------------------------------------------------------- */
/* IMPÔTS — 10 sous-types                                                      */
/* -------------------------------------------------------------------------- */

function impTaxeFonciere(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("TF", rng);
  const due = randomAmount(rng, 450, 2200);
  const issued = pastDate(rng, 2026);
  const deadline = futureDate(rng, 2026);
  const title = `Avis taxe foncière ${id}`;
  const body = `# Avis d'imposition — taxe foncière

**DGFiP (document fictif)**  
**Référence :** ${id}  
**Propriétaire :** ${p.fullName}  
**Local :** ${a.line}  
**Émission :** ${issued}

## Montant
- Taxe foncière due : **${euro(due, 0)}**

## Paiement
- Date limite de paiement : **${deadline}**.
- Majoration de 10 % en cas de retard.
- **Pénalités** supplémentaires après mise en demeure.
- Paiement possible en 2 échéances si montant > 300 €.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Avis de taxe foncière ${id} pour ${p.fullName} sur ${a.line}, montant ${euro(due, 0)}, échéance ${deadline}.`,
    people: [p.fullName],
    organizations: ["DGFiP"],
    amounts: [euro(due, 0)],
    dates: [issued],
    deadlines: [`Date limite de paiement le ${deadline}`],
    importantPoints: [
      `Montant ${euro(due, 0)}`,
      `Local ${a.line}`,
      `Échéance ${deadline}`,
    ],
    risks: [
      "Majoration de 10 % en cas de retard",
      "Pénalités supplémentaires après mise en demeure",
    ],
    actions: [
      `Payer avant le ${deadline}`,
      "Vérifier l'éligibilité au paiement en 2 fois",
    ],
    flags: { penalties: true },
  });
}

function impCFE(rng) {
  const p = person(rng);
  const id = ref("CFE", rng);
  const due = randomAmount(rng, 200, 1400);
  const year = 2025;
  const deadline = futureDate(rng, 2026);
  const title = `Avis CFE ${id}`;
  const body = `# Cotisation foncière des entreprises

**Service des impôts des entreprises (fictif)**  
**Réf. :** ${id}  
**Redevable :** ${p.fullName} — micro-entreprise  
**Année :** ${year}

## Montant
- CFE due : **${euro(due, 0)}**
- Échéance unique : **${deadline}**

## Alertes
- Défaut de paiement → majoration et frais de poursuite.
- **Obligation** : déclarer tout changement d'adresse professionnelle sous 30 jours.
- Réclamation contentieuse sous 60 jours après réception.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Avis CFE ${id} pour ${p.fullName}, année ${year}, montant ${euro(due, 0)}, échéance ${deadline}.`,
    people: [p.fullName],
    organizations: ["Service des impôts des entreprises"],
    amounts: [euro(due, 0)],
    dates: [],
    deadlines: [
      `Échéance de paiement le ${deadline}`,
      "Changement d'adresse sous 30 jours",
      "Réclamation contentieuse sous 60 jours",
    ],
    importantPoints: [
      `CFE ${euro(due, 0)}`,
      `Année ${year}`,
    ],
    risks: [
      "Majoration et frais de poursuite en cas de défaut",
    ],
    actions: [
      `Régler avant le ${deadline}`,
      "Déposer une réclamation sous 60 jours si contestation",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function impControle(rng) {
  const p = person(rng);
  const id = ref("CTRL", rng);
  const years = "2023-2024";
  const notice = pastDate(rng, 2026);
  const docs = futureDate(rng, 2026);
  const title = `Avis de contrôle fiscal ${id}`;
  const body = `# Avis de vérification de comptabilité

**Direction régionale des finances publiques (fictif)**  
**Dossier :** ${id}  
**Contribuable :** ${p.fullName}  
**Périodes :** ${years}  
**Notification :** ${notice}

## Demande
- Présentation des pièces comptables et justificatifs.
- Remise du dossier complet avant le **${docs}**.
- Entretien possible sur place ou dans les locaux du service.

## Conséquences
- **Sanction** : évaluation d'office en cas de non-coopération.
- Intérêts de retard potentiels.
- Assistance d'un conseil recommandée.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Avis de contrôle fiscal ${id} pour ${p.fullName} sur ${years}, pièces à remettre avant le ${docs}.`,
    people: [p.fullName],
    organizations: ["Direction régionale des finances publiques"],
    amounts: [],
    dates: [notice],
    deadlines: [`Remise du dossier complet avant le ${docs}`],
    importantPoints: [
      `Périodes ${years}`,
      `Notification du ${notice}`,
    ],
    risks: [
      "Évaluation d'office en cas de non-coopération",
      "Intérêts de retard potentiels",
    ],
    actions: [
      `Remettre les pièces avant le ${docs}`,
      "Contacter un conseil fiscal",
    ],
    flags: { sanctions: true, shortDeadline: true },
  });
}

function impPrelevement(rng) {
  const p = person(rng);
  const id = ref("PAS", rng);
  const rate = randomAmount(rng, 0, 18);
  const issued = pastDate(rng, 2026);
  const apply = futureDate(rng, 2026);
  const title = `Taux prélèvement à la source ${id}`;
  const body = `# Notification de taux de prélèvement à la source

**DGFiP (document fictif)**  
**Réf. :** ${id}  
**Contribuable :** ${p.fullName}  
**Émission :** ${issued}

## Taux
- Taux personnalisé : **${formatMoney(rate, 1)} %**
- Application à compter du **${apply}**

## Options
- Demande de modulation à déposer sous 60 jours.
- Option pour le taux non personnalisé possible.
- **Obligation** : informer l'employeur du nouveau taux.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Notification de taux PAS ${id} pour ${p.fullName} : ${formatMoney(rate, 1)} %, applicable au ${apply}.`,
    people: [p.fullName],
    organizations: ["DGFiP"],
    amounts: [],
    dates: [issued, apply],
    deadlines: [
      `Application du taux à compter du ${apply}`,
      "Demande de modulation sous 60 jours",
    ],
    importantPoints: [
      `Taux ${formatMoney(rate, 1)} %`,
      `Application au ${apply}`,
    ],
    risks: [
      "Retenue incorrecte si l'employeur n'est pas informé",
    ],
    actions: [
      "Transmettre le taux à l'employeur",
      "Déposer une modulation sous 60 jours si besoin",
    ],
    flags: { obligations: true },
  });
}

function impRedressement(rng) {
  const p = person(rng);
  const id = ref("RED", rng);
  const principal = randomAmount(rng, 800, 6500);
  const interest = randomAmount(rng, 40, 400);
  const issued = pastDate(rng, 2026);
  const pay = futureDate(rng, 2026);
  const title = `Proposition de redressement ${id}`;
  const body = `# Proposition de rectification

**Service des impôts (fictif)**  
**Dossier :** ${id}  
**Contribuable :** ${p.fullName}  
**Date :** ${issued}

## Montants
- Droits rappelés : **${euro(principal, 0)}**
- Intérêts de retard : **${euro(interest)}**
- Total : **${euro(principal + interest, 0)}**

## Délais
- Observations du contribuable avant le **${pay}**.
- À défaut, mise en recouvrement.
- **Pénalités** pour manquement délibéré : 40 % éventuels.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Proposition de redressement ${id} pour ${p.fullName}, droits ${euro(principal, 0)} + intérêts ${euro(interest)}, réponse avant ${pay}.`,
    people: [p.fullName],
    organizations: ["Service des impôts"],
    amounts: [euro(principal, 0), euro(interest), euro(principal + interest, 0)],
    dates: [issued],
    deadlines: [`Observations avant le ${pay}`],
    importantPoints: [
      `Droits ${euro(principal, 0)}`,
      `Intérêts ${euro(interest)}`,
    ],
    risks: [
      "Mise en recouvrement sans réponse",
      "Pénalités de 40 % pour manquement délibéré",
    ],
    actions: [
      `Formuler des observations avant le ${pay}`,
      "Réunir les justificatifs contestés",
    ],
    flags: { penalties: true, shortDeadline: true },
  });
}

function impDelaiPaiement(rng) {
  const p = person(rng);
  const id = ref("DEL", rng);
  const debt = randomAmount(rng, 900, 4000);
  const monthly = randomAmount(rng, 80, 250);
  const decision = pastDate(rng, 2026);
  const first = futureDate(rng, 2026);
  const title = `Accord délai de paiement ${id}`;
  const body = `# Accord de délai de paiement

**Trésorerie (fictif)**  
**Dossier :** ${id}  
**Débiteur :** ${p.fullName}  
**Décision :** ${decision}

## Échéancier
- Dette totale : **${euro(debt, 0)}**
- Mensualité : **${euro(monthly, 0)}**
- Première échéance : **${first}**

## Conditions
- Tout retard annule l'accord.
- **Sanction** : reprise immédiate des poursuites.
- **Obligation** : informer de tout changement de situation sous 15 jours.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Accord de délai de paiement ${id} pour ${p.fullName}, dette ${euro(debt, 0)}, mensualité ${euro(monthly, 0)} dès le ${first}.`,
    people: [p.fullName],
    organizations: ["Trésorerie"],
    amounts: [euro(debt, 0), euro(monthly, 0)],
    dates: [decision],
    deadlines: [
      `Première échéance le ${first}`,
      "Information de changement de situation sous 15 jours",
    ],
    importantPoints: [
      `Dette ${euro(debt, 0)}`,
      `Mensualité ${euro(monthly, 0)}`,
    ],
    risks: [
      "Reprise des poursuites en cas de retard",
      "Annulation de l'accord si incident",
    ],
    actions: [
      `Honorer la première échéance du ${first}`,
      "Signaler tout changement sous 15 jours",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

function impIRComplement(rng) {
  const p = person(rng);
  const id = ref("IRC", rng);
  const due = randomAmount(rng, 150, 1800);
  const issued = pastDate(rng, 2026);
  const deadline = futureDate(rng, 2026);
  const title = `Avis IR complément ${id}`;
  const body = `# Avis d'impôt sur le revenu — reste à payer

**DGFiP (document fictif)**  
**Réf. :** ${id}  
**Contribuable :** ${p.fullName}  
**Émission :** ${issued}

## Solde
- Reste à payer : **${euro(due, 0)}**
- Date limite : **${deadline}**

## Modalités
- Prélèvement automatique si mandat actif, sinon paiement en ligne.
- Majoration de 10 % après la date limite.
- Réclamation sous 60 jours.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Avis IR complément ${id} pour ${p.fullName}, reste à payer ${euro(due, 0)} avant le ${deadline}.`,
    people: [p.fullName],
    organizations: ["DGFiP"],
    amounts: [euro(due, 0)],
    dates: [issued],
    deadlines: [
      `Date limite de paiement le ${deadline}`,
      "Réclamation sous 60 jours",
    ],
    importantPoints: [
      `Reste à payer ${euro(due, 0)}`,
      `Échéance ${deadline}`,
    ],
    risks: [
      "Majoration de 10 % après la date limite",
    ],
    actions: [
      `Payer avant le ${deadline}`,
      "Contester sous 60 jours si nécessaire",
    ],
    flags: { penalties: true },
  });
}

function impTVApro(rng) {
  const p = person(rng);
  const id = ref("TVA", rng);
  const due = randomAmount(rng, 300, 5200);
  const period = "T1 2026";
  const deadline = futureDate(rng, 2026);
  const title = `Rappel déclaration TVA ${id}`;
  const body = `# Rappel — déclaration et paiement de TVA

**SIE (document fictif)**  
**Réf. :** ${id}  
**Assujetti :** ${p.fullName}  
**Période :** ${period}

## Montant estimé
- TVA collectée nette estimée : **${euro(due, 0)}**
- Dépôt de la déclaration CA3 avant le **${deadline}**.

## Risques
- **Pénalités** de retard déclaratif : 10 %.
- Intérêts de retard au taux légal.
- **Sanction** : taxation d'office possible.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Rappel TVA ${id} pour ${p.fullName}, période ${period}, dépôt avant le ${deadline}, montant estimé ${euro(due, 0)}.`,
    people: [p.fullName],
    organizations: ["SIE"],
    amounts: [euro(due, 0)],
    dates: [],
    deadlines: [`Dépôt de la déclaration CA3 avant le ${deadline}`],
    importantPoints: [
      `Période ${period}`,
      `TVA estimée ${euro(due, 0)}`,
    ],
    risks: [
      "Pénalités de retard déclaratif de 10 %",
      "Taxation d'office possible",
    ],
    actions: [
      `Déposer la CA3 avant le ${deadline}`,
      "Régler la TVA due",
    ],
    flags: { penalties: true, sanctions: true },
  });
}

function impHabitation(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("TH", rng);
  const due = randomAmount(rng, 80, 420);
  const issued = pastDate(rng, 2025);
  const claim = futureDate(rng, 2026);
  const title = `Notification taxe habitation residuelle ${id}`;
  const body = `# Notification — taxe d'habitation sur résidences secondaires

**DGFiP (document fictif)**  
**Réf. :** ${id}  
**Occupant :** ${p.fullName}  
**Local :** ${a.line}  
**Émission :** ${issued}

## Montant
- Taxe due : **${euro(due, 0)}**

## Contestation
- Réclamation motivée avant le **${claim}**.
- Justificatif de résidence principale à joindre si exonération demandée.
- Majoration en cas de défaut de paiement après titre exécutoire.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Notification taxe habitation résiduelle ${id} pour ${p.fullName} à ${a.line}, montant ${euro(due, 0)}.`,
    people: [p.fullName],
    organizations: ["DGFiP"],
    amounts: [euro(due, 0)],
    dates: [issued],
    deadlines: [`Réclamation motivée avant le ${claim}`],
    importantPoints: [
      `Taxe ${euro(due, 0)}`,
      `Local ${a.line}`,
    ],
    risks: [
      "Majoration après titre exécutoire",
      "Rejet d'exonération sans justificatif",
    ],
    actions: [
      `Déposer une réclamation avant le ${claim} si besoin`,
      "Joindre le justificatif de résidence principale",
    ],
    flags: { penalties: true },
  });
}

function impIS(rng) {
  const p = person(rng);
  const id = ref("IS", rng);
  const due = randomAmount(rng, 1500, 28000);
  const fy = "2025";
  const deadline = futureDate(rng, 2026);
  const title = `Acompte impôt sociétés ${id}`;
  const body = `# Avis d'acompte d'impôt sur les sociétés

**SIE entreprises (fictif)**  
**Réf. :** ${id}  
**Société représentée par :** ${p.fullName}  
**Exercice :** ${fy}

## Acompte
- Montant de l'acompte : **${euro(due, 0)}**
- Date limite de versement : **${deadline}**

## Suite
- Régularisation à la liquidation annuelle.
- **Pénalités** de retard : 5 % + intérêts.
- **Obligation** : télérèglement obligatoire.

${footer()}`;

  return pack("impots", title, body, {
    documentType: "Impôts",
    title,
    summary: `Acompte IS ${id} pour la société représentée par ${p.fullName}, exercice ${fy}, montant ${euro(due, 0)} avant ${deadline}.`,
    people: [p.fullName],
    organizations: ["SIE entreprises"],
    amounts: [euro(due, 0)],
    dates: [],
    deadlines: [`Date limite de versement le ${deadline}`],
    importantPoints: [
      `Acompte ${euro(due, 0)}`,
      `Exercice ${fy}`,
    ],
    risks: [
      "Pénalités de retard de 5 % + intérêts",
    ],
    actions: [
      `Téléreglér avant le ${deadline}`,
      "Anticiper la liquidation annuelle",
    ],
    flags: { penalties: true, obligations: true },
  });
}

/* -------------------------------------------------------------------------- */
/* BAUX — 10 sous-types                                                        */
/* -------------------------------------------------------------------------- */

function bailMeuble(rng) {
  const tenant = person(rng);
  const owner = person(rng);
  const a = address(rng);
  const id = ref("BM", rng);
  const rent = randomAmount(rng, 550, 1100);
  const start = futureDate(rng, 2026);
  const notice = futureDate(rng, 2026);
  const title = `Bail meublé ${id}`;
  const body = `# Contrat de location meublée

**Bailleur :** ${owner.fullName}  
**Locataire :** ${tenant.fullName}  
**Réf. :** ${id}  
**Local :** ${a.line}  
**Prise d'effet :** ${start}

## Loyers
- Loyer mensuel charges comprises : **${euro(rent, 0)}**
- Dépôt de garantie : **${euro(rent, 0)}**
- Durée : 1 an renouvelable

## Congé
- Préavis locataire : 1 mois.
- Congé bailleur pour reprise : notification avant le **${notice}**.
- **Pénalité** de retard de loyer : majoration de 5 € après 10 jours.
- Inventaire d'entrée annexé.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Bail meublé ${id} entre ${owner.fullName} et ${tenant.fullName} à ${a.line}, loyer ${euro(rent, 0)}, effet ${start}.`,
    people: [owner.fullName, tenant.fullName],
    organizations: [],
    amounts: [euro(rent, 0)],
    dates: [start],
    deadlines: [
      "Préavis locataire de 1 mois",
      `Congé bailleur avant le ${notice}`,
    ],
    importantPoints: [
      `Loyer ${euro(rent, 0)}`,
      "Durée 1 an",
      `Adresse ${a.line}`,
    ],
    risks: [
      "Pénalité de retard de loyer de 5 €",
      "Congé bailleur pour reprise possible",
    ],
    actions: [
      `Surveiller un éventuel congé avant le ${notice}`,
      "Respecter le préavis d'1 mois",
    ],
    flags: { penalties: true },
  });
}

function bailCommercial(rng) {
  const tenant = person(rng);
  const id = ref("BC", rng);
  const a = address(rng);
  const rent = randomAmount(rng, 1200, 4500);
  const start = pastDate(rng, 2024);
  const renew = futureDate(rng, 2026);
  const title = `Bail commercial 3-6-9 ${id}`;
  const body = `# Bail commercial (3/6/9)

**Bailleur :** SCI Les Arcades  
**Preneur :** ${tenant.fullName}  
**Réf. :** ${id}  
**Locaux :** ${a.line}  
**Effet initial :** ${start}

## Conditions
- Loyer annuel HT : **${euro(rent * 12, 0)}** soit **${euro(rent, 0)}** / mois
- Destination : commerce de détail alimentaire
- Indexation ILC annuelle

## Échéances
- Renouvellement / congé à formaliser 6 mois avant terme, soit avant le **${renew}**.
- Dépôt de garantie : 3 mois.
- **Sanction** : clause résolutoire après mise en demeure de 30 jours.
- **Obligation** : exploitation effective du fonds.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Bail commercial ${id} pour ${tenant.fullName} dans les locaux ${a.line}, loyer mensuel ${euro(rent, 0)}.`,
    people: [tenant.fullName],
    organizations: ["SCI Les Arcades"],
    amounts: [euro(rent * 12, 0), euro(rent, 0)],
    dates: [start],
    deadlines: [
      `Congé ou renouvellement avant le ${renew}`,
      "Mise en demeure de 30 jours avant clause résolutoire",
    ],
    importantPoints: [
      `Loyer mensuel ${euro(rent, 0)}`,
      "Bail 3/6/9",
      "Indexation ILC",
    ],
    risks: [
      "Clause résolutoire après mise en demeure",
      "Perte du droit au renouvellement si congé hors délai",
    ],
    actions: [
      `Anticiper congé/renouvellement avant le ${renew}`,
      "Suivre l'indexation ILC",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

function bailColocation(rng) {
  const t1 = person(rng);
  const t2 = person(rng);
  const owner = person(rng);
  const a = address(rng);
  const id = ref("COL", rng);
  const rent = randomAmount(rng, 800, 1400);
  const start = futureDate(rng, 2026);
  const leave = futureDate(rng, 2026);
  const title = `Bail colocation ${id}`;
  const body = `# Bail de colocation solidaire

**Bailleur :** ${owner.fullName}  
**Colocataires :** ${t1.fullName} et ${t2.fullName}  
**Réf. :** ${id}  
**Logement :** ${a.line}  
**Effet :** ${start}

## Loyers
- Loyer total CC : **${euro(rent, 0)}**
- Solidarité des colocataires sur l'intégralité du loyer

## Départ
- Préavis d'un colocataire : 1 mois, notification avant le **${leave}** pour un départ anticipé envisagé.
- Remplacement possible sous agrément du bailleur.
- **Obligation** : souscription assurance habitation nominative.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Bail de colocation ${id} pour ${t1.fullName} et ${t2.fullName} à ${a.line}, loyer ${euro(rent, 0)}.`,
    people: [owner.fullName, t1.fullName, t2.fullName],
    organizations: [],
    amounts: [euro(rent, 0)],
    dates: [start],
    deadlines: [
      "Préavis d'un colocataire de 1 mois",
      `Notification de départ anticipé avant le ${leave}`,
    ],
    importantPoints: [
      `Loyer total ${euro(rent, 0)}`,
      "Solidarité des colocataires",
      `Effet ${start}`,
    ],
    risks: [
      "Solidarité sur l'intégralité du loyer",
      "Remplacement soumis à agrément",
    ],
    actions: [
      `Notifier un départ avant le ${leave} si prévu`,
      "Souscrire une assurance habitation nominative",
    ],
    flags: { obligations: true },
  });
}

function bailConge(rng) {
  const tenant = person(rng);
  const owner = person(rng);
  const a = address(rng);
  const id = ref("CG", rng);
  const rent = randomAmount(rng, 600, 1200);
  const notice = pastDate(rng, 2026);
  const leave = futureDate(rng, 2026);
  const title = `Congé locataire ${id}`;
  const body = `# Congé du locataire

**Locataire :** ${tenant.fullName}  
**Bailleur :** ${owner.fullName}  
**Réf. bail :** ${id}  
**Logement :** ${a.line}  
**Date du congé :** ${notice}

## Effet
- Date de départ : **${leave}**
- Préavis de 3 mois respecté
- Loyer actuel : **${euro(rent, 0)}**

## Suite
- État des lieux de sortie à planifier 8 jours avant le départ.
- Restitution des clés le jour du départ.
- **Sanction** : retenue sur dépôt si dégradations constatées.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Congé du locataire ${tenant.fullName} pour le logement ${a.line}, départ le ${leave}, loyer ${euro(rent, 0)}.`,
    people: [tenant.fullName, owner.fullName],
    organizations: [],
    amounts: [euro(rent, 0)],
    dates: [notice, leave],
    deadlines: [
      `Date de départ le ${leave}`,
      "État des lieux de sortie 8 jours avant le départ",
    ],
    importantPoints: [
      `Départ le ${leave}`,
      "Préavis de 3 mois",
      `Loyer ${euro(rent, 0)}`,
    ],
    risks: [
      "Retenue sur dépôt de garantie en cas de dégradations",
    ],
    actions: [
      "Planifier l'état des lieux 8 jours avant",
      "Restituer les clés le jour du départ",
    ],
    flags: { sanctions: true },
  });
}

function bailRevision(rng) {
  const tenant = person(rng);
  const id = ref("REV", rng);
  const oldRent = randomAmount(rng, 700, 1300);
  const newRent = oldRent * 1.032;
  const effect = futureDate(rng, 2026);
  const contest = futureDate(rng, 2026);
  const title = `Révision annuelle de loyer ${id}`;
  const body = `# Notification de révision de loyer

**Agence :** ImmoClarité  
**Bail :** ${id}  
**Locataire :** ${tenant.fullName}

## Nouveau loyer
- Loyer actuel : **${euro(oldRent, 0)}**
- Loyer révisé (IRL) : **${euro(newRent, 0)}**
- Date d'effet : **${effect}**

## Contestation
- Observation écrite avant le **${contest}**.
- À défaut, le nouveau loyer est réputé accepté.
- **Obligation** : paiement du loyer révisé à compter de l'effet.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Révision de loyer ${id} pour ${tenant.fullName} : de ${euro(oldRent, 0)} à ${euro(newRent, 0)} au ${effect}.`,
    people: [tenant.fullName],
    organizations: ["ImmoClarité"],
    amounts: [euro(oldRent, 0), euro(newRent, 0)],
    dates: [effect],
    deadlines: [
      `Date d'effet de la révision le ${effect}`,
      `Observation écrite avant le ${contest}`,
    ],
    importantPoints: [
      `Nouveau loyer ${euro(newRent, 0)}`,
      "Indexation IRL",
    ],
    risks: [
      "Acceptation tacite sans observation écrite",
    ],
    actions: [
      `Contester avant le ${contest} si besoin`,
      `Anticiper le prélèvement au ${effect}`,
    ],
    flags: { obligations: true, autoRenewal: true },
  });
}

function bailEtatLieux(rng) {
  const tenant = person(rng);
  const owner = person(rng);
  const a = address(rng);
  const id = ref("EDL", rng);
  const deposit = randomAmount(rng, 600, 1200);
  const visit = futureDate(rng, 2026);
  const title = `Convocation état des lieux sortie ${id}`;
  const body = `# Convocation — état des lieux de sortie

**Agence :** ImmoClarité  
**Réf. :** ${id}  
**Locataire :** ${tenant.fullName}  
**Bailleur :** ${owner.fullName}  
**Logement :** ${a.line}

## Rendez-vous
- Date proposée : **${visit}** à 9h30
- Dépôt de garantie concerné : **${euro(deposit, 0)}**

## Suites
- Restitution du dépôt sous 1 mois si logement conforme.
- **Sanction** : retenues justifiées pour réparations locatives.
- Contestation des retenues sous 2 mois après notification.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Convocation à état des lieux de sortie ${id} pour ${tenant.fullName} le ${visit}, dépôt ${euro(deposit, 0)}.`,
    people: [tenant.fullName, owner.fullName],
    organizations: ["ImmoClarité"],
    amounts: [euro(deposit, 0)],
    dates: [],
    deadlines: [
      `État des lieux le ${visit}`,
      "Restitution du dépôt sous 1 mois",
      "Contestation des retenues sous 2 mois",
    ],
    importantPoints: [
      `RDV le ${visit}`,
      `Dépôt ${euro(deposit, 0)}`,
      `Logement ${a.line}`,
    ],
    risks: [
      "Retenues pour réparations locatives",
      "Délai de contestation limité à 2 mois",
    ],
    actions: [
      `Se présenter le ${visit}`,
      "Photographier le logement avant le rendez-vous",
    ],
    flags: { sanctions: true },
  });
}

function bailParking(rng) {
  const tenant = person(rng);
  const id = ref("PKG", rng);
  const rent = randomAmount(rng, 40, 120);
  const start = pastDate(rng, 2025);
  const end = futureDate(rng, 2026);
  const title = `Bail emplacement parking ${id}`;
  const body = `# Contrat de location d'emplacement de stationnement

**Bailleur :** Copropriété Résidence Horizon  
**Preneur :** ${tenant.fullName}  
**Réf. :** ${id}  
**Effet :** ${start}

## Conditions
- Loyer mensuel : **${euro(rent, 0)}**
- Emplacement n°12 — box fermé
- Résiliation possible avec préavis de 1 mois avant le **${end}**.

## Règles
- Usage exclusif véhicule léger.
- **Pénalité** de 25 € en cas de sous-location non autorisée.
- Tacite reconduction mensuelle.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Bail parking ${id} pour ${tenant.fullName}, loyer ${euro(rent, 0)}, résiliation possible avant ${end}.`,
    people: [tenant.fullName],
    organizations: ["Copropriété Résidence Horizon"],
    amounts: [euro(rent, 0), "25 €"],
    dates: [start],
    deadlines: [
      "Préavis de 1 mois",
      `Résiliation avant le ${end}`,
    ],
    importantPoints: [
      `Loyer ${euro(rent, 0)}`,
      "Box n°12",
      "Tacite reconduction mensuelle",
    ],
    risks: [
      "Pénalité de 25 € pour sous-location",
      "Reconduction tacite mensuelle",
    ],
    actions: [
      `Donner congé avant le ${end} si besoin`,
      "Respecter l'usage véhicule léger",
    ],
    flags: { penalties: true, autoRenewal: true },
  });
}

function bailSaisonnier(rng) {
  const guest = person(rng);
  const id = ref("SAI", rng);
  const a = address(rng);
  const price = randomAmount(rng, 450, 1600);
  const arrive = futureDate(rng, 2026);
  const pay = futureDate(rng, 2026);
  const title = `Contrat location saisonnière ${id}`;
  const body = `# Contrat de location saisonnière

**Loueur :** Agence Côte Bleue  
**Locataire saisonnier :** ${guest.fullName}  
**Réf. :** ${id}  
**Bien :** ${a.line}  
**Arrivée :** ${arrive} (7 nuits)

## Tarif
- Prix séjour : **${euro(price, 0)}**
- Caution : **300 €**
- Solde à régler avant le **${pay}**.

## Annulation
- Annulation J-15 : remboursement 50 %.
- **Pénalité** d'annulation tardive : 100 % du séjour.
- Check-in à 16h — check-out à 10h.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Location saisonnière ${id} pour ${guest.fullName} à ${a.line}, arrivée ${arrive}, prix ${euro(price, 0)}.`,
    people: [guest.fullName],
    organizations: ["Agence Côte Bleue"],
    amounts: [euro(price, 0), "300 €"],
    dates: [arrive],
    deadlines: [`Solde à régler avant le ${pay}`],
    importantPoints: [
      `Prix ${euro(price, 0)}`,
      `Arrivée ${arrive}`,
      "Durée 7 nuits",
    ],
    risks: [
      "Pénalité d'annulation tardive de 100 %",
      "Remboursement limité à 50 % si annulation J-15",
    ],
    actions: [
      `Payer le solde avant le ${pay}`,
      "Respecter les horaires check-in/out",
    ],
    flags: { penalties: true, shortDeadline: false },
  });
}

function bailAvenantCharges(rng) {
  const tenant = person(rng);
  const id = ref("ACH", rng);
  const charges = randomAmount(rng, 40, 120);
  const effect = futureDate(rng, 2026);
  const accept = futureDate(rng, 2026);
  const title = `Avenant régularisation charges ${id}`;
  const body = `# Avenant — provision pour charges

**Agence :** ImmoClarité  
**Bail :** ${id}  
**Locataire :** ${tenant.fullName}

## Modification
- Nouvelle provision mensuelle : **${euro(charges, 0)}**
- Date d'effet : **${effect}**
- Régularisation annuelle sur justificatifs

## Acceptation
- Retour signé avant le **${accept}**.
- **Obligation** : paiement de la provision révisée.
- Contestation de la régularisation sous 30 jours après réception du décompte.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Avenant charges ${id} pour ${tenant.fullName}, provision ${euro(charges, 0)} à compter du ${effect}.`,
    people: [tenant.fullName],
    organizations: ["ImmoClarité"],
    amounts: [euro(charges, 0)],
    dates: [effect],
    deadlines: [
      `Retour signé avant le ${accept}`,
      `Effet au ${effect}`,
      "Contestation sous 30 jours après décompte",
    ],
    importantPoints: [
      `Provision ${euro(charges, 0)}`,
      "Régularisation annuelle",
    ],
    risks: [
      "Augmentation de la charge mensuelle",
      "Délai court de contestation du décompte",
    ],
    actions: [
      `Signer avant le ${accept}`,
      "Conserver les décomptes annuels",
    ],
    flags: { obligations: true },
  });
}

function bailGarant(rng) {
  const tenant = person(rng);
  const guarantor = person(rng);
  const id = ref("GAR", rng);
  const rent = randomAmount(rng, 700, 1400);
  const start = futureDate(rng, 2026);
  const signBy = futureDate(rng, 2026);
  const title = `Acte de caution solidaire ${id}`;
  const body = `# Acte de cautionnement solidaire

**Bénéficiaire (bailleur) :** SCI Les Arcades  
**Locataire :** ${tenant.fullName}  
**Caution :** ${guarantor.fullName}  
**Réf. :** ${id}  
**Bail lié — effet :** ${start}

## Engagement
- Couverture du loyer de **${euro(rent, 0)}** et accessoires
- Durée : celle du bail et de ses renouvellements
- Caution solidaire sans bénéfice de discussion

## Formalités
- Signature manuscrite avant le **${signBy}**.
- **Sanction** : poursuite directe de la caution en cas d'impayé.
- **Obligation** : mention manuscrite du montant en toutes lettres.

${footer()}`;

  return pack("baux", title, body, {
    documentType: "Bail",
    title,
    summary: `Acte de caution solidaire ${id} de ${guarantor.fullName} pour ${tenant.fullName}, loyer ${euro(rent, 0)}.`,
    people: [tenant.fullName, guarantor.fullName],
    organizations: ["SCI Les Arcades"],
    amounts: [euro(rent, 0)],
    dates: [start],
    deadlines: [`Signature manuscrite avant le ${signBy}`],
    importantPoints: [
      `Loyer couvert ${euro(rent, 0)}`,
      "Caution solidaire",
      `Bail effet ${start}`,
    ],
    risks: [
      "Poursuite directe de la caution en cas d'impayé",
      "Engagement sur la durée du bail renouvelé",
    ],
    actions: [
      `Signer avant le ${signBy}`,
      "Rédiger la mention manuscrite du montant",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

/* -------------------------------------------------------------------------- */
/* TÉLÉPHONIE — 10 sous-types                                                  */
/* -------------------------------------------------------------------------- */

function telResiliation(rng) {
  const p = person(rng);
  const id = ref("RES", rng);
  const fee = randomAmount(rng, 0, 79);
  const request = pastDate(rng, 2026);
  const effect = futureDate(rng, 2026);
  const title = `Confirmation résiliation mobile ${id}`;
  const body = `# Confirmation de résiliation — forfait mobile

**Opérateur :** MobiLigne  
**Dossier :** ${id}  
**Abonné :** ${p.fullName}  
**Demande reçue :** ${request}

## Effet
- Date de résiliation : **${effect}**
- Frais de rupture d'engagement : **${euro(fee)}**
- Portabilité sortante possible jusqu'à J-1

## Suite
- Dernière facture sous 15 jours après effet.
- Restitution de la SIM sous 10 jours.
- **Pénalité** si engagement non échu déjà intégrée ci-dessus.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Résiliation mobile ${id} pour ${p.fullName} chez MobiLigne, effet ${effect}, frais ${euro(fee)}.`,
    people: [p.fullName],
    organizations: ["MobiLigne"],
    amounts: [euro(fee)],
    dates: [request, effect],
    deadlines: [
      `Date de résiliation le ${effect}`,
      "Dernière facture sous 15 jours après effet",
      "Restitution de la SIM sous 10 jours",
    ],
    importantPoints: [
      `Effet ${effect}`,
      `Frais ${euro(fee)}`,
    ],
    risks: [
      `Frais de rupture d'engagement de ${euro(fee)}`,
      "Perte de numéro sans portabilité anticipée",
    ],
    actions: [
      "Demander la portabilité avant J-1",
      "Restituer la SIM sous 10 jours",
    ],
    flags: { penalties: true },
  });
}

function telPortabilite(rng) {
  const p = person(rng);
  const id = ref("RIO", rng);
  const fee = 0;
  const request = pastDate(rng, 2026);
  const port = futureDate(rng, 2026);
  const title = `Demande portabilité numéro ${id}`;
  const body = `# Demande de portabilité de numéro mobile

**Opérateur donneur :** MobiLigne  
**Opérateur receveur :** TeleMax  
**Abonné :** ${p.fullName}  
**RIO / dossier :** ${id}  
**Demande :** ${request}

## Planning
- Date de portage souhaitée : **${port}**
- Frais de portabilité : **${euro(fee, 0)}**
- Conservation du numéro 06 XX XX XX XX (fictif)

## Conditions
- Ligne active le jour du portage.
- Annulation possible jusqu'à 48 h avant.
- **Sanction** : échec de portabilité si RIO erroné.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Demande de portabilité ${id} pour ${p.fullName} vers TeleMax, portage le ${port}.`,
    people: [p.fullName],
    organizations: ["MobiLigne", "TeleMax"],
    amounts: [euro(fee, 0)],
    dates: [request],
    deadlines: [
      `Date de portage le ${port}`,
      "Annulation possible jusqu'à 48 h avant",
    ],
    importantPoints: [
      `Portage le ${port}`,
      "Passage MobiLigne → TeleMax",
    ],
    risks: [
      "Échec de portabilité si RIO erroné",
      "Ligne doit rester active",
    ],
    actions: [
      `Maintenir la ligne active jusqu'au ${port}`,
      "Vérifier le RIO",
    ],
    flags: { sanctions: true, shortDeadline: true },
  });
}

function telRoaming(rng) {
  const p = person(rng);
  const id = ref("ROAM", rng);
  const option = randomAmount(rng, 9, 29);
  const start = futureDate(rng, 2026);
  const cancel = futureDate(rng, 2026);
  const title = `Option roaming voyage ${id}`;
  const body = `# Activation option roaming hors UE

**Opérateur :** TeleMax  
**Option :** ${id}  
**Client :** ${p.fullName}  
**Activation :** ${start}

## Tarif
- Forfait voyage 10 Go : **${euro(option)}** / période de 30 jours
- Hors forfait data : 0,10 € / Mo

## Résiliation option
- Désactivation à demander avant le **${cancel}**.
- **Frais cachés** : SMS hors UE à 0,30 € non inclus.
- **Obligation** : activer le roaming data dans les réglages téléphone.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Option roaming ${id} pour ${p.fullName} chez TeleMax, ${euro(option)} / 30 jours, activation ${start}.`,
    people: [p.fullName],
    organizations: ["TeleMax"],
    amounts: [euro(option), "0,10 €", "0,30 €"],
    dates: [start],
    deadlines: [
      `Désactivation avant le ${cancel}`,
      "Période de 30 jours",
    ],
    importantPoints: [
      `Forfait 10 Go à ${euro(option)}`,
      `Activation ${start}`,
    ],
    risks: [
      "SMS hors UE facturés 0,30 €",
      "Hors forfait data à 0,10 € / Mo",
    ],
    actions: [
      `Désactiver avant le ${cancel} si besoin`,
      "Activer le roaming data sur le téléphone",
    ],
    flags: { hiddenFees: true, obligations: true },
  });
}

function telFactureLitige(rng) {
  const p = person(rng);
  const id = ref("LIT", rng);
  const amount = randomAmount(rng, 45, 220);
  const bill = pastDate(rng, 2026);
  const reply = futureDate(rng, 2026);
  const title = `Réclamation facture mobile ${id}`;
  const body = `# Réclamation — facturation mobile

**Opérateur :** MobiLigne  
**Dossier réclamation :** ${id}  
**Abonné :** ${p.fullName}  
**Facture contestée du :** ${bill}  
**Montant contesté :** **${euro(amount)}**

## Objet
Facturation de communications internationales non reconnues.

## Traitement
- Réponse du service clients avant le **${reply}**.
- Suspension des relances pendant l'instruction.
- **Sanction** : reprise des poursuites si réclamation jugée abusive.
- Médiation possible sous 2 mois après réponse écrite.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Réclamation facture mobile ${id} de ${p.fullName} pour ${euro(amount)} sur facture du ${bill}.`,
    people: [p.fullName],
    organizations: ["MobiLigne"],
    amounts: [euro(amount)],
    dates: [bill],
    deadlines: [
      `Réponse du service clients avant le ${reply}`,
      "Médiation possible sous 2 mois après réponse",
    ],
    importantPoints: [
      `Montant contesté ${euro(amount)}`,
      `Facture du ${bill}`,
    ],
    risks: [
      "Reprise des poursuites si réclamation abusive",
      "Délai de médiation limité",
    ],
    actions: [
      `Attendre la réponse avant le ${reply}`,
      "Préparer un dossier médiation si besoin",
    ],
    flags: { sanctions: true },
  });
}

function telB2B(rng) {
  const p = person(rng);
  const id = ref("B2B", rng);
  const lines = 5 + Math.floor(rng() * 20);
  const monthly = randomAmount(rng, 120, 680);
  const start = futureDate(rng, 2026);
  const engage = futureDate(rng, 2027);
  const title = `Contrat flotte mobile pro ${id}`;
  const body = `# Contrat flotte mobile professionnelle

**Opérateur :** TeleMax Business  
**Contrat :** ${id}  
**Client :** ${p.fullName} — gérant  
**Nombre de lignes :** ${lines}  
**Effet :** ${start}

## Offre
- Abonnement global : **${euro(monthly)}** / mois
- Engagement jusqu'au **${engage}**
- SIM M2M incluses : 2

## Clauses
- Préavis de résiliation : 90 jours.
- **Pénalités** de résiliation anticipée : mois restants × 50 %.
- **Frais** de gestion parc : **8 €** / ligne / an.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Contrat flotte mobile ${id} pour ${p.fullName}, ${lines} lignes, ${euro(monthly)} / mois, engagement jusqu'au ${engage}.`,
    people: [p.fullName],
    organizations: ["TeleMax Business"],
    amounts: [euro(monthly), "8 €"],
    dates: [start, engage],
    deadlines: [
      `Engagement jusqu'au ${engage}`,
      "Préavis de résiliation de 90 jours",
    ],
    importantPoints: [
      `${lines} lignes`,
      `Abonnement ${euro(monthly)}`,
      `Effet ${start}`,
    ],
    risks: [
      "Pénalités de résiliation anticipée (50 % des mois restants)",
      "Frais de gestion parc de 8 € par ligne et par an",
    ],
    actions: [
      "Anticiper un préavis de 90 jours",
      "Suivre le parc SIM M2M",
    ],
    flags: { penalties: true, hiddenFees: true, obligations: true },
  });
}

function telAvenantData(rng) {
  const p = person(rng);
  const id = ref("DATA", rng);
  const extra = randomAmount(rng, 3, 12);
  const effect = futureDate(rng, 2026);
  const accept = futureDate(rng, 2026);
  const title = `Avenant option data ${id}`;
  const body = `# Avenant — option data supplémentaire

**Opérateur :** MobiLigne  
**Avenant :** ${id}  
**Abonné :** ${p.fullName}

## Modification
- +20 Go / mois pour **${euro(extra)}**
- Effet : **${effect}**
- Reconduction tacite mensuelle

## Acceptation
- Validation dans l'espace client avant le **${accept}**.
- Résiliation de l'option : préavis de 30 jours.
- **Frais cachés** : hors forfait international inchangé.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Avenant data ${id} pour ${p.fullName} chez MobiLigne, +20 Go pour ${euro(extra)}, effet ${effect}.`,
    people: [p.fullName],
    organizations: ["MobiLigne"],
    amounts: [euro(extra)],
    dates: [effect],
    deadlines: [
      `Validation avant le ${accept}`,
      `Effet au ${effect}`,
      "Préavis de 30 jours pour résilier l'option",
    ],
    importantPoints: [
      `+20 Go pour ${euro(extra)}`,
      "Reconduction tacite mensuelle",
    ],
    risks: [
      "Reconduction tacite mensuelle",
      "Hors forfait international non modifié",
    ],
    actions: [
      `Valider avant le ${accept}`,
      "Surveiller la conso data",
    ],
    flags: { autoRenewal: true, hiddenFees: true },
  });
}

function telMiseEnDemeure(rng) {
  const p = person(rng);
  const id = ref("MED", rng);
  const debt = randomAmount(rng, 49, 280);
  const issued = pastDate(rng, 2026);
  const pay = futureDate(rng, 2026);
  const title = `Mise en demeure facture mobile ${id}`;
  const body = `# Mise en demeure — impayé forfait mobile

**Opérateur :** TeleMax  
**Réf. :** ${id}  
**Abonné :** ${p.fullName}  
**Date :** ${issued}

## Créance
- Montant exigible : **${euro(debt)}**
- Paiement avant le **${pay}**

## Conséquences
- Suspension de ligne à défaut de paiement.
- **Pénalités** de retard : **8 €**
- **Sanction** : résiliation de plein droit après 15 jours de suspension.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Mise en demeure ${id} de TeleMax à ${p.fullName} pour ${euro(debt)}, paiement avant ${pay}.`,
    people: [p.fullName],
    organizations: ["TeleMax"],
    amounts: [euro(debt), "8 €"],
    dates: [issued],
    deadlines: [
      `Paiement avant le ${pay}`,
      "Résiliation de plein droit après 15 jours de suspension",
    ],
    importantPoints: [
      `Montant ${euro(debt)}`,
      `Échéance ${pay}`,
    ],
    risks: [
      "Suspension de ligne",
      "Résiliation de plein droit",
      "Pénalités de retard de 8 €",
    ],
    actions: [
      `Payer avant le ${pay}`,
      "Contacter le service recouvrement si besoin d'échelonnement",
    ],
    flags: { penalties: true, sanctions: true, shortDeadline: true },
  });
}

function telSimPerdue(rng) {
  const p = person(rng);
  const id = ref("SIM", rng);
  const fee = randomAmount(rng, 5, 15);
  const declared = pastDate(rng, 2026);
  const receive = futureDate(rng, 2026);
  const title = `Remplacement SIM perdue ${id}`;
  const body = `# Remplacement de carte SIM

**Opérateur :** MobiLigne  
**Dossier :** ${id}  
**Abonné :** ${p.fullName}  
**Déclaration :** ${declared}

## Traitement
- Ancienne SIM désactivée
- Frais de remplacement : **${euro(fee)}**
- Réception de la nouvelle SIM avant le **${receive}**

## Sécurité
- Signalement de toute utilisation suspecte sous 48 heures.
- **Obligation** : activer la nouvelle SIM sous 10 jours.
- À défaut, ligne maintenue suspendue.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Remplacement SIM ${id} pour ${p.fullName}, frais ${euro(fee)}, réception avant ${receive}.`,
    people: [p.fullName],
    organizations: ["MobiLigne"],
    amounts: [euro(fee)],
    dates: [declared],
    deadlines: [
      `Réception de la nouvelle SIM avant le ${receive}`,
      "Signalement sous 48 heures",
      "Activation sous 10 jours",
    ],
    importantPoints: [
      `Frais ${euro(fee)}`,
      `Déclaration ${declared}`,
    ],
    risks: [
      "Ligne suspendue si SIM non activée",
      "Usurpation possible avant désactivation",
    ],
    actions: [
      `Activer la SIM dès réception (avant le ${receive})`,
      "Signaler toute anomalie sous 48 heures",
    ],
    flags: { obligations: true, shortDeadline: true },
  });
}

function telForfait5G(rng) {
  const p = person(rng);
  const id = ref("5G", rng);
  const price = randomAmount(rng, 19, 49);
  const start = pastDate(rng, 2026);
  const cooloff = futureDate(rng, 2026);
  const title = `Contrat forfait 5G ${id}`;
  const body = `# Contrat forfait mobile 5G

**Opérateur :** TeleMax  
**Offre :** ${id}  
**Abonné :** ${p.fullName}  
**Souscription :** ${start}

## Offre
- 100 Go 5G — appels illimités
- Prix : **${euro(price)}** / mois
- Engagement 12 mois

## Délais
- Droit de rétractation jusqu'au **${cooloff}** (distance).
- Préavis de résiliation en fin d'engagement : 30 jours.
- **Renouvellement tacite** mensuel après engagement.
- **Pénalité** de résiliation anticipée : mois restants × abonnement.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Forfait 5G ${id} pour ${p.fullName} chez TeleMax, ${euro(price)} / mois, souscrit le ${start}.`,
    people: [p.fullName],
    organizations: ["TeleMax"],
    amounts: [euro(price)],
    dates: [start],
    deadlines: [
      `Droit de rétractation jusqu'au ${cooloff}`,
      "Préavis de résiliation de 30 jours",
      "Engagement de 12 mois",
    ],
    importantPoints: [
      `Prix ${euro(price)}`,
      "100 Go 5G",
      "Engagement 12 mois",
    ],
    risks: [
      "Renouvellement tacite mensuel après engagement",
      "Pénalité égale aux mois restants",
    ],
    actions: [
      `Exercer la rétractation avant le ${cooloff} si besoin`,
      "Noter la fin d'engagement pour résilier",
    ],
    flags: { autoRenewal: true, penalties: true },
  });
}

function telOptionTV(rng) {
  const p = person(rng);
  const id = ref("OTT", rng);
  const price = randomAmount(rng, 5, 15);
  const start = futureDate(rng, 2026);
  const endOpt = futureDate(rng, 2026);
  const title = `Option streaming mobile ${id}`;
  const body = `# Option streaming mobile

**Opérateur :** MobiLigne  
**Option :** ${id}  
**Client :** ${p.fullName}  
**Activation :** ${start}

## Contenu
- Accès StreamingPack Mobile
- Tarif : **${euro(price)}** / mois
- Data streaming non décomptée dans la limite de 20 Go

## Fin d'option
- Résiliation de l'option avant le **${endOpt}**.
- **Frais cachés** : qualité HD hors forfait data hors option.
- Reconduction mensuelle automatique.

${footer()}`;

  return pack("telephonie", title, body, {
    documentType: "Contrat téléphonique",
    title,
    summary: `Option streaming ${id} pour ${p.fullName}, ${euro(price)} / mois, activation ${start}.`,
    people: [p.fullName],
    organizations: ["MobiLigne"],
    amounts: [euro(price)],
    dates: [start],
    deadlines: [`Résiliation de l'option avant le ${endOpt}`],
    importantPoints: [
      `Tarif ${euro(price)}`,
      "20 Go streaming non décomptés",
    ],
    risks: [
      "Reconduction mensuelle automatique",
      "HD hors option consomme la data",
    ],
    actions: [
      `Résilier avant le ${endOpt} si besoin`,
      "Surveiller l'usage HD",
    ],
    flags: { autoRenewal: true, hiddenFees: true },
  });
}
/* -------------------------------------------------------------------------- */
/* INTERNET — 10 sous-types                                                    */
/* -------------------------------------------------------------------------- */

function netInstallation(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("INST", rng);
  const fee = randomAmount(rng, 0, 79);
  const slot = futureDate(rng, 2026);
  const title = `RDV installation fibre ${id}`;
  const body = `# Confirmation de rendez-vous d'installation fibre

**Fournisseur :** BoxNet Fibre  
**Dossier :** ${id}  
**Client :** ${p.fullName}  
**Adresse :** ${a.line}

## Intervention
- Date : **${slot}** (créneau 8h–13h)
- Frais de mise en service : **${euro(fee)}**
- Présence obligatoire d'un majeur

## Conditions
- Report possible jusqu'à 48 h avant.
- **Pénalité** d'absence : **50 €**.
- Activation du service sous 24 h après installation.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `RDV installation fibre ${id} pour ${p.fullName} à ${a.line} le ${slot}, frais ${euro(fee)}.`,
    people: [p.fullName],
    organizations: ["BoxNet Fibre"],
    amounts: [euro(fee), "50 €"],
    dates: [],
    deadlines: [
      `Intervention le ${slot}`,
      "Report possible jusqu'à 48 h avant",
      "Activation sous 24 h après installation",
    ],
    importantPoints: [
      `Créneau ${slot}`,
      `Frais ${euro(fee)}`,
      `Adresse ${a.line}`,
    ],
    risks: [
      "Pénalité d'absence de 50 €",
      "Présence obligatoire d'un majeur",
    ],
    actions: [
      `Être présent le ${slot}`,
      "Prévenir 48 h à l'avance en cas d'empêchement",
    ],
    flags: { penalties: true, shortDeadline: true },
  });
}

function netResiliation(rng) {
  const p = person(rng);
  const id = ref("NRES", rng);
  const fee = randomAmount(rng, 0, 120);
  const request = pastDate(rng, 2026);
  const effect = futureDate(rng, 2026);
  const title = `Résiliation abonnement fibre ${id}`;
  const body = `# Accusé de résiliation — accès Internet

**Fournisseur :** BoxNet Fibre  
**Dossier :** ${id}  
**Abonné :** ${p.fullName}  
**Demande :** ${request}

## Effet
- Fin de service : **${effect}**
- Frais de résiliation anticipée : **${euro(fee)}**
- Restitution box sous 15 jours (étiquette jointe)

## Suite
- Facture de clôture sous 20 jours.
- **Sanction** : facturation de la box non restituée (**120 €**).
- Portabilité de la ligne téléphonique fixe si demandée avant effet.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Résiliation fibre ${id} pour ${p.fullName}, effet ${effect}, frais ${euro(fee)}.`,
    people: [p.fullName],
    organizations: ["BoxNet Fibre"],
    amounts: [euro(fee), "120 €"],
    dates: [request, effect],
    deadlines: [
      `Fin de service le ${effect}`,
      "Restitution box sous 15 jours",
      "Facture de clôture sous 20 jours",
    ],
    importantPoints: [
      `Effet ${effect}`,
      `Frais ${euro(fee)}`,
    ],
    risks: [
      "Facturation de la box non restituée (120 €)",
      `Frais de résiliation anticipée de ${euro(fee)}`,
    ],
    actions: [
      "Restituer la box sous 15 jours",
      "Demander la portabilité fixe avant effet",
    ],
    flags: { penalties: true, sanctions: true },
  });
}

function netLitigeDebit(rng) {
  const p = person(rng);
  const id = ref("DEB", rng);
  const credit = randomAmount(rng, 5, 30);
  const open = pastDate(rng, 2026);
  const measure = futureDate(rng, 2026);
  const title = `Dossier litige débit ${id}`;
  const body = `# Ouverture de dossier — non-conformité de débit

**Fournisseur :** FibreOcéan  
**Dossier :** ${id}  
**Client :** ${p.fullName}  
**Ouverture :** ${open}

## Constats
- Débit mesuré inférieur à 30 % du débit commercialisé
- Avoir commercial proposé : **${euro(credit)}** / mois pendant 2 mois

## Calendrier
- Test contradictoire technicien avant le **${measure}**.
- Réponse définitive sous 30 jours.
- **Obligation** : laisser accès au local technique.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Litige débit ${id} pour ${p.fullName} chez FibreOcéan, avoir ${euro(credit)}, test avant ${measure}.`,
    people: [p.fullName],
    organizations: ["FibreOcéan"],
    amounts: [euro(credit)],
    dates: [open],
    deadlines: [
      `Test contradictoire avant le ${measure}`,
      "Réponse définitive sous 30 jours",
    ],
    importantPoints: [
      `Avoir ${euro(credit)} / mois pendant 2 mois`,
      "Débit < 30 % du commercialisé",
    ],
    risks: [
      "Rejet du litige sans accès technicien",
      "Avoir limité à 2 mois",
    ],
    actions: [
      `Laisser accès pour le test avant le ${measure}`,
      "Conserver les mesures de débit",
    ],
    flags: { obligations: true },
  });
}

function netPro(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("NPRO", rng);
  const monthly = randomAmount(rng, 49, 149);
  const start = futureDate(rng, 2026);
  const engageEnd = futureDate(rng, 2027);
  const title = `Contrat Internet pro ${id}`;
  const body = `# Contrat d'accès Internet professionnel

**Opérateur :** FibreOcéan Business  
**Contrat :** ${id}  
**Client :** ${p.fullName}  
**Site :** ${a.line}  
**Effet :** ${start}

## Offre
- Fibre dédiée 500 Mbps symétrique
- Abonnement : **${euro(monthly)}** / mois HT
- Engagement jusqu'au **${engageEnd}**
- GTR 4 heures ouvrées

## Clauses
- Préavis de résiliation : 90 jours.
- **Pénalités** de résiliation anticipée : 40 % des mensualités restantes.
- IP fixe : /29 incluse.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Contrat Internet pro ${id} pour ${p.fullName}, ${euro(monthly)} HT / mois, engagement jusqu'au ${engageEnd}.`,
    people: [p.fullName],
    organizations: ["FibreOcéan Business"],
    amounts: [euro(monthly)],
    dates: [start, engageEnd],
    deadlines: [
      `Engagement jusqu'au ${engageEnd}`,
      "Préavis de résiliation de 90 jours",
    ],
    importantPoints: [
      "500 Mbps symétrique",
      `Abonnement ${euro(monthly)} HT`,
      "GTR 4 heures",
    ],
    risks: [
      "Pénalités de résiliation anticipée (40 %)",
      "Engagement long",
    ],
    actions: [
      "Anticiper un préavis de 90 jours",
      "Documenter les incidents GTR",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function netDemenagement(rng) {
  const p = person(rng);
  const oldA = address(rng);
  const newA = address(rng);
  const id = ref("DEM", rng);
  const fee = randomAmount(rng, 0, 60);
  const move = futureDate(rng, 2026);
  const title = `Demande déménagement ligne ${id}`;
  const body = `# Demande de déménagement d'accès Internet

**Fournisseur :** BoxNet Fibre  
**Dossier :** ${id}  
**Client :** ${p.fullName}  
**Ancienne adresse :** ${oldA.line}  
**Nouvelle adresse :** ${newA.line}

## Planning
- Date de déménagement souhaitée : **${move}**
- Frais de transfert : **${euro(fee)}**
- Continuité de service non garantie plus de 72 h

## Conditions
- Éligibilité fibre à confirmer sous 5 jours.
- **Sanction** : facturation pleine si adresse non éligible et maintien demandé.
- Restitution matériel de l'ancienne adresse sous 15 jours après transfert.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Déménagement ligne ${id} pour ${p.fullName} vers ${newA.line} le ${move}, frais ${euro(fee)}.`,
    people: [p.fullName],
    organizations: ["BoxNet Fibre"],
    amounts: [euro(fee)],
    dates: [],
    deadlines: [
      `Déménagement souhaité le ${move}`,
      "Éligibilité à confirmer sous 5 jours",
      "Restitution matériel sous 15 jours après transfert",
    ],
    importantPoints: [
      `Nouvelle adresse ${newA.line}`,
      `Frais ${euro(fee)}`,
    ],
    risks: [
      "Coupure possible jusqu'à 72 h",
      "Facturation pleine si non éligible",
    ],
    actions: [
      `Préparer le déménagement du ${move}`,
      "Vérifier l'éligibilité sous 5 jours",
    ],
    flags: { sanctions: true },
  });
}

function netBoxTV(rng) {
  const p = person(rng);
  const id = ref("TV", rng);
  const price = randomAmount(rng, 5, 16);
  const start = pastDate(rng, 2026);
  const cancel = futureDate(rng, 2026);
  const title = `Option TV box ${id}`;
  const body = `# Option TV — bouquet CinéMax

**Fournisseur :** BoxNet Fibre  
**Option :** ${id}  
**Abonné :** ${p.fullName}  
**Activation :** ${start}

## Tarif
- Bouquet : **${euro(price)}** / mois
- Décodeur TV déjà en place

## Résiliation
- Désactivation avant le **${cancel}** pour éviter le cycle suivant.
- **Renouvellement tacite** mensuel.
- **Frais cachés** : replay 4K consomme la data mobile associée si option multi-écran.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Option TV ${id} pour ${p.fullName}, bouquet ${euro(price)} / mois, activée le ${start}.`,
    people: [p.fullName],
    organizations: ["BoxNet Fibre"],
    amounts: [euro(price)],
    dates: [start],
    deadlines: [`Désactivation avant le ${cancel}`],
    importantPoints: [
      `Tarif ${euro(price)}`,
      "Bouquet CinéMax",
    ],
    risks: [
      "Renouvellement tacite mensuel",
      "Consommation data multi-écran",
    ],
    actions: [
      `Désactiver avant le ${cancel} si besoin`,
      "Vérifier les options multi-écran",
    ],
    flags: { autoRenewal: true, hiddenFees: true },
  });
}

function netEngagement(rng) {
  const p = person(rng);
  const id = ref("ENG", rng);
  const price = randomAmount(rng, 29, 45);
  const start = pastDate(rng, 2025);
  const end = futureDate(rng, 2026);
  const title = `Contrat fibre engagement 12 mois ${id}`;
  const body = `# Contrat d'abonnement fibre optique

**Fournisseur :** FibreOcéan  
**Contrat :** ${id}  
**Abonné :** ${p.fullName}  
**Souscription :** ${start}

## Offre
- Fibre 1 Gb/s
- Prix promo 6 mois puis **${euro(price)}** / mois
- Engagement jusqu'au **${end}**

## Sortie
- Résiliation anticipée : mensualités restantes dues à 100 %.
- Préavis : 30 jours avant fin d'engagement.
- **Obligation** : restitution du matériel sous 15 jours.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Contrat fibre ${id} pour ${p.fullName} chez FibreOcéan, prix ${euro(price)}, engagement jusqu'au ${end}.`,
    people: [p.fullName],
    organizations: ["FibreOcéan"],
    amounts: [euro(price)],
    dates: [start, end],
    deadlines: [
      `Engagement jusqu'au ${end}`,
      "Préavis de 30 jours",
      "Restitution du matériel sous 15 jours",
    ],
    importantPoints: [
      "Fibre 1 Gb/s",
      `Prix ${euro(price)}`,
      `Fin d'engagement ${end}`,
    ],
    risks: [
      "Mensualités restantes dues à 100 % si résiliation anticipée",
      "Augmentation après période promo",
    ],
    actions: [
      `Prévoir résiliation 30 jours avant le ${end}`,
      "Anticiper la restitution matériel",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function netSAV(rng) {
  const p = person(rng);
  const id = ref("SAV", rng);
  const open = pastDate(rng, 2026);
  const callback = futureDate(rng, 2026);
  const title = `Ticket SAV panne box ${id}`;
  const body = `# Ticket support — panne d'accès

**Fournisseur :** BoxNet Fibre  
**Ticket :** ${id}  
**Client :** ${p.fullName}  
**Ouverture :** ${open}

## Diagnostic
- Box non synchronisée / LED rouge
- Soft reset déjà effectué

## Prochaines étapes
- Rappel technicien avant le **${callback}**.
- Échange matériel sous 5 jours si panne confirmée.
- Avoir d'1 jour de service par 24 h d'interruption au-delà de 48 h.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Ticket SAV ${id} pour ${p.fullName} chez BoxNet, panne du ${open}, rappel avant ${callback}.`,
    people: [p.fullName],
    organizations: ["BoxNet Fibre"],
    amounts: [],
    dates: [open],
    deadlines: [
      `Rappel technicien avant le ${callback}`,
      "Échange matériel sous 5 jours",
    ],
    importantPoints: [
      "Box non synchronisée",
      `Ticket ${id}`,
    ],
    risks: [
      "Interruption prolongée sans avoir si < 48 h",
    ],
    actions: [
      `Rester joignable avant le ${callback}`,
      "Noter les durées d'interruption",
    ],
    flags: { shortDeadline: true },
  });
}

function netDevisFTTH(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("DFT", rng);
  const setup = randomAmount(rng, 0, 99);
  const monthly = randomAmount(rng, 27, 42);
  const valid = futureDate(rng, 2026);
  const title = `Devis raccordement fibre ${id}`;
  const body = `# Devis de raccordement FTTH

**Fournisseur :** FibreOcéan  
**Devis :** ${id}  
**Prospect :** ${p.fullName}  
**Adresse :** ${a.line}

## Proposition
- Mise en service : **${euro(setup)}**
- Abonnement 12 mois : **${euro(monthly)}** / mois
- Débit annoncé : 500 Mbps

## Validité
- Devis valable jusqu'au **${valid}**.
- Après acceptation : installation sous 21 jours.
- **Frais cachés** éventuels de parcours long : jusqu'à **150 €** si confirmés en étude.

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Devis fibre ${id} pour ${p.fullName} à ${a.line}, mise en service ${euro(setup)}, abo ${euro(monthly)}, valable jusqu'au ${valid}.`,
    people: [p.fullName],
    organizations: ["FibreOcéan"],
    amounts: [euro(setup), euro(monthly), "150 €"],
    dates: [],
    deadlines: [
      `Devis valable jusqu'au ${valid}`,
      "Installation sous 21 jours après acceptation",
    ],
    importantPoints: [
      `Abonnement ${euro(monthly)}`,
      "500 Mbps",
      `Adresse ${a.line}`,
    ],
    risks: [
      "Frais de parcours long jusqu'à 150 €",
      "Devis caduc après la date de validité",
    ],
    actions: [
      `Accepter avant le ${valid}`,
      "Demander le détail du parcours long",
    ],
    flags: { hiddenFees: true },
  });
}

function netIPFixe(rng) {
  const p = person(rng);
  const id = ref("IP", rng);
  const fee = randomAmount(rng, 3, 12);
  const start = futureDate(rng, 2026);
  const notice = futureDate(rng, 2026);
  const title = `Option IP fixe ${id}`;
  const body = `# Option adresse IP fixe

**Fournisseur :** FibreOcéan Business  
**Option :** ${id}  
**Client :** ${p.fullName}  
**Activation :** ${start}

## Service
- IPv4 fixe /32
- Tarif : **${euro(fee)}** / mois HT
- Compatible VPN site-à-site

## Résiliation
- Préavis de 30 jours, notification avant le **${notice}**.
- **Obligation** : mettre à jour les reverse DNS sous 7 jours.
- Coupure possible sans préavis en cas d'usage abusif (spam).

${footer()}`;

  return pack("internet", title, body, {
    documentType: "Contrat Internet",
    title,
    summary: `Option IP fixe ${id} pour ${p.fullName}, ${euro(fee)} HT / mois, activation ${start}.`,
    people: [p.fullName],
    organizations: ["FibreOcéan Business"],
    amounts: [euro(fee)],
    dates: [start],
    deadlines: [
      "Préavis de 30 jours",
      `Notification avant le ${notice}`,
      "Mise à jour reverse DNS sous 7 jours",
    ],
    importantPoints: [
      `Tarif ${euro(fee)} HT`,
      "IPv4 /32",
    ],
    risks: [
      "Coupure sans préavis en cas d'usage abusif",
    ],
    actions: [
      `Notifier avant le ${notice} pour résilier`,
      "Configurer le reverse DNS sous 7 jours",
    ],
    flags: { obligations: true, sanctions: true },
  });
}

/* -------------------------------------------------------------------------- */
/* MUTUELLES — 10 sous-types                                                   */
/* -------------------------------------------------------------------------- */

function mutDentaire(rng) {
  const p = person(rng);
  const id = ref("DEN", rng);
  const monthly = randomAmount(rng, 18, 55);
  const ceiling = randomAmount(rng, 400, 1200);
  const start = pastDate(rng, 2025);
  const claim = futureDate(rng, 2026);
  const title = `Garantie dentaire renforcée ${id}`;
  const body = `# Avenant mutuelle — renfort dentaire

**Mutuelle :** Harmonie+ Santé  
**Avenant :** ${id}  
**Adhérent :** ${p.fullName}  
**Effet initial contrat :** ${start}

## Prestations
- Surprime : **${euro(monthly)}** / mois
- Plafond prothèses : **${euro(ceiling, 0)}** / an
- Orthodontie adulte : 200 % BR

## Délais
- Devis à faire valider avant soins > 300 €
- Envoi des factures avant le **${claim}** pour l'exercice en cours
- **Carence** : 3 mois sur prothèses

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Renfort dentaire ${id} pour ${p.fullName} chez Harmonie+, surprime ${euro(monthly)}, plafond ${euro(ceiling, 0)}.`,
    people: [p.fullName],
    organizations: ["Harmonie+ Santé"],
    amounts: [euro(monthly), euro(ceiling, 0)],
    dates: [start],
    deadlines: [
      "Devis à valider avant soins > 300 €",
      `Envoi des factures avant le ${claim}`,
      "Carence de 3 mois sur prothèses",
    ],
    importantPoints: [
      `Surprime ${euro(monthly)}`,
      `Plafond ${euro(ceiling, 0)}`,
    ],
    risks: [
      "Carence de 3 mois sur prothèses",
      "Refus si devis non validé",
    ],
    actions: [
      "Faire valider les devis > 300 €",
      `Envoyer les factures avant le ${claim}`,
    ],
    flags: {},
  });
}

function mutOptique(rng) {
  const p = person(rng);
  const id = ref("OPT", rng);
  const forfait = randomAmount(rng, 100, 350);
  const monthly = randomAmount(rng, 8, 25);
  const renew = futureDate(rng, 2026);
  const title = `Forfait optique ${id}`;
  const body = `# Notice — forfait optique

**Mutuelle :** VistaMut  
**Contrat :** ${id}  
**Assuré :** ${p.fullName}

## Garanties
- Forfait monture + verres complexes : **${euro(forfait, 0)}** / 2 ans
- Surcote mensuelle : **${euro(monthly)}**
- Lentilles : 120 € / an

## Renouvellement
- Nouveau forfait disponible à partir du **${renew}**.
- Tiers payant optique partenaires uniquement.
- **Sanction** : refus hors réseau si non-respect du parcours.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Forfait optique ${id} pour ${p.fullName} chez VistaMut, forfait ${euro(forfait, 0)}, surcote ${euro(monthly)}.`,
    people: [p.fullName],
    organizations: ["VistaMut"],
    amounts: [euro(forfait, 0), euro(monthly), "120 €"],
    dates: [],
    deadlines: [`Nouveau forfait disponible à partir du ${renew}`],
    importantPoints: [
      `Forfait ${euro(forfait, 0)} / 2 ans`,
      "Lentilles 120 € / an",
    ],
    risks: [
      "Refus hors réseau partenaires",
    ],
    actions: [
      `Attendre le ${renew} pour un nouveau forfait`,
      "Utiliser le tiers payant partenaires",
    ],
    flags: { sanctions: true },
  });
}

function mutResiliation(rng) {
  const p = person(rng);
  const id = ref("MRES", rng);
  const monthly = randomAmount(rng, 35, 90);
  const request = pastDate(rng, 2026);
  const effect = futureDate(rng, 2026);
  const title = `Résiliation mutuelle santé ${id}`;
  const body = `# Accusé de résiliation — complémentaire santé

**Mutuelle :** Harmonie+ Santé  
**Dossier :** ${id}  
**Adhérent :** ${p.fullName}  
**Demande :** ${request}

## Effet
- Radiation au **${effect}**
- Dernière cotisation : **${euro(monthly)}**
- Attestation de droits à télécharger sous 7 jours

## Suite
- Portabilité éventuelle si licenciement (à justifier sous 15 jours).
- **Obligation** : informer la nouvelle mutuelle de la date de fin.
- Soins postérieurs à l'effet non remboursés.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Résiliation mutuelle ${id} pour ${p.fullName}, radiation au ${effect}, dernière cotisation ${euro(monthly)}.`,
    people: [p.fullName],
    organizations: ["Harmonie+ Santé"],
    amounts: [euro(monthly)],
    dates: [request, effect],
    deadlines: [
      `Radiation au ${effect}`,
      "Attestation sous 7 jours",
      "Justificatif portabilité sous 15 jours",
    ],
    importantPoints: [
      `Radiation ${effect}`,
      `Cotisation ${euro(monthly)}`,
    ],
    risks: [
      "Soins non remboursés après radiation",
      "Perte de portabilité sans justificatif",
    ],
    actions: [
      "Télécharger l'attestation sous 7 jours",
      "Informer la nouvelle mutuelle",
    ],
    flags: { obligations: true },
  });
}

function mutRemboursement(rng) {
  const p = person(rng);
  const id = ref("RBT", rng);
  const amount = randomAmount(rng, 25, 280);
  const care = pastDate(rng, 2026);
  const paid = futureDate(rng, 2026);
  const title = `Détail remboursement soins ${id}`;
  const body = `# Décompte de remboursement

**Mutuelle :** VistaMut  
**Décompte :** ${id}  
**Assuré :** ${p.fullName}  
**Soins du :** ${care}

## Montants
- Base remboursée : **${euro(amount)}**
- Virement prévu au plus tard le **${paid}**

## Observations
- Ticket modérateur partiellement couvert
- Dépassements non pris en charge sur cet acte
- Contestation du décompte sous 60 jours

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Décompte ${id} pour ${p.fullName} : remboursement ${euro(amount)} pour soins du ${care}, virement avant ${paid}.`,
    people: [p.fullName],
    organizations: ["VistaMut"],
    amounts: [euro(amount)],
    dates: [care],
    deadlines: [
      `Virement au plus tard le ${paid}`,
      "Contestation sous 60 jours",
    ],
    importantPoints: [
      `Remboursement ${euro(amount)}`,
      `Soins du ${care}`,
    ],
    risks: [
      "Dépassements non pris en charge",
    ],
    actions: [
      `Vérifier le virement avant le ${paid}`,
      "Contester sous 60 jours si écart",
    ],
    flags: {},
  });
}

function mutFamille(rng) {
  const p = person(rng);
  const child = person(rng);
  const id = ref("FAM", rng);
  const monthly = randomAmount(rng, 70, 160);
  const start = futureDate(rng, 2026);
  const docs = futureDate(rng, 2026);
  const title = `Adhésion mutuelle famille ${id}`;
  const body = `# Bulletin d'adhésion — formule Famille

**Mutuelle :** Harmonie+ Santé  
**Contrat :** ${id}  
**Assuré principal :** ${p.fullName}  
**Ayant droit :** ${child.fullName}  
**Effet souhaité :** ${start}

## Cotisation
- Mensuelle : **${euro(monthly)}**
- Niveau : panier 100 % santé + renforts

## Pièces
- Justificatifs d'identité et RIB avant le **${docs}**.
- **Tacite reconduction** annuelle.
- **Pénalité** de fausse déclaration : nullité des garanties.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Adhésion famille ${id} pour ${p.fullName} et ${child.fullName}, cotisation ${euro(monthly)}, effet ${start}.`,
    people: [p.fullName, child.fullName],
    organizations: ["Harmonie+ Santé"],
    amounts: [euro(monthly)],
    dates: [start],
    deadlines: [
      `Justificatifs avant le ${docs}`,
      `Effet souhaité le ${start}`,
    ],
    importantPoints: [
      `Cotisation ${euro(monthly)}`,
      "Formule Famille",
    ],
    risks: [
      "Tacite reconduction annuelle",
      "Nullité en cas de fausse déclaration",
    ],
    actions: [
      `Envoyer les pièces avant le ${docs}`,
      "Vérifier le panier de soins",
    ],
    flags: { autoRenewal: true, penalties: true, sanctions: true },
  });
}

function mutSenior(rng) {
  const p = person(rng);
  const id = ref("SEN", rng);
  const monthly = randomAmount(rng, 90, 180);
  const start = pastDate(rng, 2024);
  const review = futureDate(rng, 2026);
  const title = `Contrat mutuelle senior ${id}`;
  const body = `# Contrat complémentaire santé senior

**Mutuelle :** VistaMut Sérénité  
**Contrat :** ${id}  
**Adhérent :** ${p.fullName}  
**Souscription :** ${start}

## Garanties
- Cotisation : **${euro(monthly)}** / mois
- Hospitalisation 200 % BR
- Aides auditives : 1 700 € / oreille / 4 ans

## Révision
- Proposition tarifaire 2027 à accepter ou refuser avant le **${review}**.
- **Obligation** : questionnaire de santé à jour tous les 3 ans.
- Résiliation infra-annuelle possible après 1 an.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Mutuelle senior ${id} pour ${p.fullName}, cotisation ${euro(monthly)}, révision à traiter avant ${review}.`,
    people: [p.fullName],
    organizations: ["VistaMut Sérénité"],
    amounts: [euro(monthly), "1 700 €"],
    dates: [start],
    deadlines: [
      `Acceptation ou refus tarifaire avant le ${review}`,
      "Questionnaire de santé tous les 3 ans",
    ],
    importantPoints: [
      `Cotisation ${euro(monthly)}`,
      "Hospitalisation 200 % BR",
    ],
    risks: [
      "Hausse tarifaire annuelle",
      "Résiliation conditionnée à 1 an d'ancienneté",
    ],
    actions: [
      `Répondre à la proposition avant le ${review}`,
      "Mettre à jour le questionnaire de santé",
    ],
    flags: { obligations: true, autoRenewal: true },
  });
}

function mutEntreprise(rng) {
  const p = person(rng);
  const id = ref("ENT", rng);
  const employeeShare = randomAmount(rng, 20, 60);
  const start = pastDate(rng, 2025);
  const optOut = futureDate(rng, 2026);
  const title = `Affiliation mutuelle entreprise ${id}`;
  const body = `# Affiliation obligatoire — mutuelle d'entreprise

**Organisme :** Harmonie+ Collective  
**Contrat collectif :** ${id}  
**Salarié :** ${p.fullName}  
**Employeur :** NovaTech Solutions  
**Affiliation :** ${start}

## Cotisation
- Part salariale : **${euro(employeeShare)}** / mois
- Part patronale : 60 %

## Dispenses
- Demande de dispense à déposer avant le **${optOut}** si couverture par ailleurs.
- **Sanction** : défaut d'affiliation = rappel de cotisations.
- Portabilité de 12 mois max en cas de chômage.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Affiliation mutuelle entreprise ${id} pour ${p.fullName} chez NovaTech, part salariale ${euro(employeeShare)}.`,
    people: [p.fullName],
    organizations: ["Harmonie+ Collective", "NovaTech Solutions"],
    amounts: [euro(employeeShare)],
    dates: [start],
    deadlines: [
      `Demande de dispense avant le ${optOut}`,
      "Portabilité de 12 mois max",
    ],
    importantPoints: [
      `Part salariale ${euro(employeeShare)}`,
      "Part patronale 60 %",
    ],
    risks: [
      "Rappel de cotisations si défaut d'affiliation",
      "Dispense limitée dans le temps",
    ],
    actions: [
      `Déposer une dispense avant le ${optOut} si éligible`,
      "Vérifier la portabilité en cas de départ",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

function mutHospitalisation(rng) {
  const p = person(rng);
  const id = ref("HOS", rng);
  const daily = randomAmount(rng, 20, 60);
  const care = pastDate(rng, 2026);
  const docs = futureDate(rng, 2026);
  const title = `Prise en charge hospitalisation ${id}`;
  const body = `# Accord de prise en charge hospitalière

**Mutuelle :** VistaMut  
**Dossier :** ${id}  
**Assuré :** ${p.fullName}  
**Admission :** ${care}

## Couverture
- Chambre particulière : **${euro(daily)}** / nuit (10 nuits max)
- Ticket modérateur : 100 %
- Dépassements d'honoraires : 150 % BR

## Formalités
- Bulletin de situation à transmettre avant le **${docs}**.
- **Obligation** : passer par l'établissement conventionné déclaré.
- À défaut : reste à charge majoré.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Prise en charge hospitalisation ${id} pour ${p.fullName}, chambre ${euro(daily)} / nuit, dossier à compléter avant ${docs}.`,
    people: [p.fullName],
    organizations: ["VistaMut"],
    amounts: [euro(daily)],
    dates: [care],
    deadlines: [`Bulletin de situation avant le ${docs}`],
    importantPoints: [
      `Chambre particulière ${euro(daily)} / nuit`,
      "Ticket modérateur 100 %",
    ],
    risks: [
      "Reste à charge majoré hors établissement déclaré",
    ],
    actions: [
      `Transmettre le bulletin avant le ${docs}`,
      "Vérifier le conventionnement",
    ],
    flags: { obligations: true },
  });
}

function mutCotisationImpaye(rng) {
  const p = person(rng);
  const id = ref("IMP", rng);
  const due = randomAmount(rng, 35, 180);
  const issued = pastDate(rng, 2026);
  const pay = futureDate(rng, 2026);
  const title = `Relance cotisation mutuelle ${id}`;
  const body = `# Relance de cotisation impayée

**Mutuelle :** Harmonie+ Santé  
**Réf. :** ${id}  
**Adhérent :** ${p.fullName}  
**Émission :** ${issued}

## Montant
- Cotisation due : **${euro(due)}**
- Paiement avant le **${pay}**

## Conséquences
- Suspension des remboursements après cette date.
- **Pénalités** de relance : **12 €**.
- **Sanction** : radiation après 2 relances restées sans effet.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Relance cotisation ${id} pour ${p.fullName}, montant ${euro(due)}, paiement avant ${pay}.`,
    people: [p.fullName],
    organizations: ["Harmonie+ Santé"],
    amounts: [euro(due), "12 €"],
    dates: [issued],
    deadlines: [`Paiement avant le ${pay}`],
    importantPoints: [
      `Cotisation ${euro(due)}`,
      `Échéance ${pay}`,
    ],
    risks: [
      "Suspension des remboursements",
      "Radiation après 2 relances",
      "Pénalités de relance de 12 €",
    ],
    actions: [
      `Régler avant le ${pay}`,
      "Mettre à jour le mandat SEPA",
    ],
    flags: { penalties: true, sanctions: true, shortDeadline: true },
  });
}

function mutMedecineDouce(rng) {
  const p = person(rng);
  const id = ref("DOU", rng);
  const forfait = randomAmount(rng, 80, 200);
  const year = 2026;
  const claim = futureDate(rng, 2026);
  const title = `Forfait médecines douces ${id}`;
  const body = `# Forfait médecines douces

**Mutuelle :** VistaMut  
**Garantie :** ${id}  
**Assuré :** ${p.fullName}  
**Année :** ${year}

## Couverture
- Forfait annuel ostéo / chiro / acu : **${euro(forfait, 0)}**
- Limite : 4 séances / an
- Hors parcours médical classique

## Demande
- Factures originales à déposer avant le **${claim}**.
- Pas de tiers payant sur ces actes.
- **Frais cachés** : dépassement au-delà du forfait intégralement à charge.

${footer()}`;

  return pack("mutuelles", title, body, {
    documentType: "Mutuelle",
    title,
    summary: `Forfait médecines douces ${id} pour ${p.fullName}, ${euro(forfait, 0)} / an, factures avant ${claim}.`,
    people: [p.fullName],
    organizations: ["VistaMut"],
    amounts: [euro(forfait, 0)],
    dates: [],
    deadlines: [`Factures à déposer avant le ${claim}`],
    importantPoints: [
      `Forfait ${euro(forfait, 0)}`,
      "4 séances / an",
    ],
    risks: [
      "Dépassement du forfait à charge",
      "Pas de tiers payant",
    ],
    actions: [
      `Envoyer les factures avant le ${claim}`,
      "Suivre le solde du forfait",
    ],
    flags: { hiddenFees: true },
  });
}
/* -------------------------------------------------------------------------- */
/* COURRIERS ADMINISTRATIFS — 10 sous-types                                    */
/* -------------------------------------------------------------------------- */

function admPrefecture(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("PREF", rng);
  const issued = pastDate(rng, 2026);
  const reply = futureDate(rng, 2026);
  const title = `Convocation préfecture titre séjour ${id}`;
  const body = `# Convocation — dépôt de dossier titre de séjour

**Préfecture (document fictif)**  
**Dossier :** ${id}  
**Concerné :** ${p.fullName}  
**Adresse :** ${a.line}  
**Émission :** ${issued}

## Rendez-vous
- Présentation obligatoire avant le **${reply}** (prise de RDV en ligne).
- Pièces : passeport, justificatif de domicile, photos.

## Suite
- Absence non justifiée : classement sans suite.
- **Obligation** : se présenter muni des originaux.
- Délai de traitement indicatif : 90 jours.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Convocation préfecture ${id} pour ${p.fullName}, présentation à organiser avant le ${reply}.`,
    people: [p.fullName],
    organizations: ["Préfecture"],
    amounts: [],
    dates: [issued],
    deadlines: [
      `Présentation obligatoire avant le ${reply}`,
      "Délai de traitement indicatif de 90 jours",
    ],
    importantPoints: [
      `Dossier ${id}`,
      `Adresse ${a.line}`,
    ],
    risks: [
      "Classement sans suite en cas d'absence",
    ],
    actions: [
      `Prendre RDV avant le ${reply}`,
      "Préparer passeport et justificatifs",
    ],
    flags: { obligations: true, shortDeadline: true },
  });
}

function admMairie(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("MAI", rng);
  const issued = pastDate(rng, 2026);
  const works = futureDate(rng, 2026);
  const title = `Autorisation travaux mairie ${id}`;
  const body = `# Arrêté municipal — autorisation de travaux

**Mairie de ${a.city} (document fictif)**  
**Réf. :** ${id}  
**Demandeur :** ${p.fullName}  
**Adresse des travaux :** ${a.line}  
**Date :** ${issued}

## Décision
- Déclaration préalable acceptée pour ravalement de façade
- Début des travaux autorisé à compter du **${works}**
- Affichage obligatoire sur le terrain pendant 2 mois

## Conditions
- Respect du nuancier communal.
- **Sanction** : astreinte journalière en cas de non-conformité.
- Achèvement à déclarer sous 30 jours après fin de chantier.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Autorisation de travaux ${id} pour ${p.fullName} à ${a.line}, début possible au ${works}.`,
    people: [p.fullName],
    organizations: [`Mairie de ${a.city}`],
    amounts: [],
    dates: [issued],
    deadlines: [
      `Début des travaux à compter du ${works}`,
      "Affichage pendant 2 mois",
      "Déclaration d'achèvement sous 30 jours",
    ],
    importantPoints: [
      "Ravalement de façade autorisé",
      `Adresse ${a.line}`,
    ],
    risks: [
      "Astreinte journalière en cas de non-conformité",
    ],
    actions: [
      `Démarrer à compter du ${works}`,
      "Afficher l'autorisation 2 mois",
    ],
    flags: { sanctions: true },
  });
}

function admCPAM(rng) {
  const p = person(rng);
  const id = ref("CPAM", rng);
  const amount = randomAmount(rng, 40, 320);
  const care = pastDate(rng, 2026);
  const info = futureDate(rng, 2026);
  const title = `Demande justificatifs CPAM ${id}`;
  const body = `# Demande de pièces complémentaires — Assurance Maladie

**CPAM (document fictif)**  
**Dossier :** ${id}  
**Assuré :** ${p.fullName}  
**Soins du :** ${care}  
**Montant en attente :** **${euro(amount)}**

## Demande
- Ordonnance originale et facture détaillée
- Transmission avant le **${info}**

## À défaut
- Rejet de la demande de remboursement.
- Nouvelle demande possible sous 2 ans.
- **Obligation** : numéro de sécurité sociale lisible.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Demande de justificatifs CPAM ${id} pour ${p.fullName}, soins du ${care}, pièces avant ${info}.`,
    people: [p.fullName],
    organizations: ["CPAM"],
    amounts: [euro(amount)],
    dates: [care],
    deadlines: [
      `Transmission des pièces avant le ${info}`,
      "Nouvelle demande possible sous 2 ans",
    ],
    importantPoints: [
      `Montant en attente ${euro(amount)}`,
      `Soins du ${care}`,
    ],
    risks: [
      "Rejet du remboursement sans pièces",
    ],
    actions: [
      `Envoyer ordonnance et facture avant le ${info}`,
      "Vérifier le numéro de sécurité sociale",
    ],
    flags: { obligations: true, shortDeadline: true },
  });
}

function admFranceTravail(rng) {
  const p = person(rng);
  const id = ref("FT", rng);
  const amount = randomAmount(rng, 800, 1600);
  const issued = pastDate(rng, 2026);
  const update = futureDate(rng, 2026);
  const title = `Notification allocation chômage ${id}`;
  const body = `# Notification de droits — allocation de retour à l'emploi

**France Travail (document fictif)**  
**Dossier :** ${id}  
**Demandeur d'emploi :** ${p.fullName}  
**Décision :** ${issued}

## Droits
- Allocation mensuelle estimée : **${euro(amount, 0)}**
- Actualisation mensuelle obligatoire

## Échéances
- Prochaine actualisation avant le **${update}**.
- Convocation éventuelle sous 15 jours après non-réponse.
- **Sanction** : radiation temporaire en cas de non-actualisation.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Notification France Travail ${id} pour ${p.fullName}, allocation ${euro(amount, 0)}, actualisation avant ${update}.`,
    people: [p.fullName],
    organizations: ["France Travail"],
    amounts: [euro(amount, 0)],
    dates: [issued],
    deadlines: [
      `Actualisation avant le ${update}`,
      "Convocation éventuelle sous 15 jours",
    ],
    importantPoints: [
      `Allocation ${euro(amount, 0)}`,
      "Actualisation mensuelle obligatoire",
    ],
    risks: [
      "Radiation temporaire si non-actualisation",
    ],
    actions: [
      `S'actualiser avant le ${update}`,
      "Conserver les justificatifs de recherche d'emploi",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

function admJustice(rng) {
  const p = person(rng);
  const id = ref("TGI", rng);
  const fee = randomAmount(rng, 35, 125);
  const hearing = futureDate(rng, 2026);
  const title = `Convocation audience tribunal ${id}`;
  const body = `# Convocation devant le tribunal judiciaire

**Greffe (document fictif)**  
**Affaire :** ${id}  
**Convoqué :** ${p.fullName}  
**Audience :** **${hearing}** à 14h00

## Objet
Litige civil — demande en paiement.

## Formalités
- Comparution personnelle ou représentation par avocat.
- Constitution éventuelle avant l'audience.
- Timbre fiscal de **${euro(fee, 0)}** si applicable.
- **Sanction** : jugement réputé contradictoire en cas d'absence.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Convocation tribunal ${id} pour ${p.fullName}, audience le ${hearing}.`,
    people: [p.fullName],
    organizations: ["Tribunal judiciaire"],
    amounts: [euro(fee, 0)],
    dates: [],
    deadlines: [`Audience le ${hearing}`],
    importantPoints: [
      `Audience ${hearing}`,
      "Litige civil — demande en paiement",
    ],
    risks: [
      "Jugement réputé contradictoire en cas d'absence",
    ],
    actions: [
      `Se présenter le ${hearing}`,
      "Envisager une représentation par avocat",
    ],
    flags: { sanctions: true },
  });
}

function admPermis(rng) {
  const p = person(rng);
  const id = ref("PER", rng);
  const points = 1 + Math.floor(rng() * 6);
  const issued = pastDate(rng, 2026);
  const stage = futureDate(rng, 2026);
  const title = `Notification retrait points permis ${id}`;
  const body = `# Notification de retrait de points

**Ministère de l'Intérieur (document fictif)**  
**Réf. :** ${id}  
**Titulaire :** ${p.fullName}  
**Date :** ${issued}

## Décision
- Retrait de **${points}** point(s)
- Solde à consulter sur le téléservice

## Stages
- Stage de sensibilisation possible avant le **${stage}** pour récupération anticipée.
- **Sanction** : invalidation du permis si solde nul.
- **Obligation** : restitution du titre en cas d'invalidation.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Notification retrait de ${points} point(s) ${id} pour ${p.fullName}, stage possible avant ${stage}.`,
    people: [p.fullName],
    organizations: ["Ministère de l'Intérieur"],
    amounts: [],
    dates: [issued],
    deadlines: [`Stage de sensibilisation avant le ${stage}`],
    importantPoints: [
      `Retrait de ${points} point(s)`,
      `Notification du ${issued}`,
    ],
    risks: [
      "Invalidation du permis si solde nul",
    ],
    actions: [
      `Envisager un stage avant le ${stage}`,
      "Consulter le solde en ligne",
    ],
    flags: { sanctions: true, obligations: true },
  });
}

function admCadastre(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("CAD", rng);
  const fee = randomAmount(rng, 12, 45);
  const issued = pastDate(rng, 2026);
  const reply = futureDate(rng, 2026);
  const title = `Avis modification cadastrale ${id}`;
  const body = `# Avis de mise à jour cadastrale

**Centre des impôts fonciers (document fictif)**  
**Réf. :** ${id}  
**Propriétaire :** ${p.fullName}  
**Parcelle :** ${a.line}  
**Date :** ${issued}

## Objet
Modification de consistance suite à agrandissement déclaré.

## Suite
- Observations éventuelles avant le **${reply}**.
- Frais de documentation : **${euro(fee)}**
- Impact possible sur la taxe foncière N+1.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Avis cadastral ${id} pour ${p.fullName} sur ${a.line}, observations avant ${reply}.`,
    people: [p.fullName],
    organizations: ["Centre des impôts fonciers"],
    amounts: [euro(fee)],
    dates: [issued],
    deadlines: [`Observations avant le ${reply}`],
    importantPoints: [
      `Parcelle ${a.line}`,
      `Frais ${euro(fee)}`,
    ],
    risks: [
      "Augmentation possible de la taxe foncière N+1",
    ],
    actions: [
      `Formuler des observations avant le ${reply}`,
      "Vérifier la consistance déclarée",
    ],
    flags: {},
  });
}

function admEcole(rng) {
  const parent = person(rng);
  const child = person(rng);
  const id = ref("SCOA", rng);
  const fee = randomAmount(rng, 20, 80);
  const issued = pastDate(rng, 2026);
  const pay = futureDate(rng, 2026);
  const title = `Facture cantine scolaire ${id}`;
  const body = `# Facture — restauration scolaire

**Ville / caisse des écoles (document fictif)**  
**Facture :** ${id}  
**Responsable légal :** ${parent.fullName}  
**Élève :** ${child.fullName}  
**Émission :** ${issued}

## Montant
- Prestations cantine : **${euro(fee)}**
- Paiement avant le **${pay}**

## Suite
- Impayé : suspension du service de restauration.
- **Pénalités** de retard : **5 €**.
- Contestation sous 30 jours.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Facture cantine ${id} pour ${child.fullName} (resp. ${parent.fullName}), montant ${euro(fee)}, échéance ${pay}.`,
    people: [parent.fullName, child.fullName],
    organizations: ["Caisse des écoles"],
    amounts: [euro(fee), "5 €"],
    dates: [issued],
    deadlines: [
      `Paiement avant le ${pay}`,
      "Contestation sous 30 jours",
    ],
    importantPoints: [
      `Montant ${euro(fee)}`,
      `Élève ${child.fullName}`,
    ],
    risks: [
      "Suspension du service de restauration",
      "Pénalités de retard de 5 €",
    ],
    actions: [
      `Payer avant le ${pay}`,
      "Contester sous 30 jours si besoin",
    ],
    flags: { penalties: true, sanctions: true },
  });
}

function admURSSAF(rng) {
  const p = person(rng);
  const id = ref("URS", rng);
  const due = randomAmount(rng, 200, 2800);
  const issued = pastDate(rng, 2026);
  const pay = futureDate(rng, 2026);
  const title = `Mise en demeure URSSAF ${id}`;
  const body = `# Mise en demeure — cotisations sociales

**URSSAF (document fictif)**  
**Compte :** ${id}  
**Cotisant :** ${p.fullName}  
**Date :** ${issued}

## Créance
- Cotisations exigibles : **${euro(due, 0)}**
- Paiement ou contestation motivée avant le **${pay}**

## Conséquences
- Contrainte possible après ce délai.
- **Pénalités** et majorations de retard applicables.
- **Obligation** : déclaration à jour sur le compte en ligne.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Mise en demeure URSSAF ${id} pour ${p.fullName}, cotisations ${euro(due, 0)}, délai ${pay}.`,
    people: [p.fullName],
    organizations: ["URSSAF"],
    amounts: [euro(due, 0)],
    dates: [issued],
    deadlines: [`Paiement ou contestation avant le ${pay}`],
    importantPoints: [
      `Cotisations ${euro(due, 0)}`,
      `Échéance ${pay}`,
    ],
    risks: [
      "Contrainte après le délai",
      "Pénalités et majorations de retard",
    ],
    actions: [
      `Payer ou contester avant le ${pay}`,
      "Mettre à jour les déclarations en ligne",
    ],
    flags: { penalties: true, obligations: true, shortDeadline: true },
  });
}

function admANAH(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("ANAH", rng);
  const grant = randomAmount(rng, 1500, 9000);
  const issued = pastDate(rng, 2026);
  const works = futureDate(rng, 2026);
  const title = `Décision aide renovation ${id}`;
  const body = `# Décision d'attribution d'aide à la rénovation

**ANAH — document fictif**  
**Dossier :** ${id}  
**Bénéficiaire :** ${p.fullName}  
**Logement :** ${a.line}  
**Décision :** ${issued}

## Aide
- Montant attribué : **${euro(grant, 0)}**
- Travaux à démarrer avant le **${works}**
- Versement après contrôle de conformité

## Conditions
- Conservation des factures 5 ans.
- **Sanction** : remboursement de l'aide en cas de fausse déclaration.
- Achèvement sous 18 mois.

${footer()}`;

  return pack("admin", title, body, {
    documentType: "Courrier administratif",
    title,
    summary: `Aide rénovation ${id} de ${euro(grant, 0)} pour ${p.fullName} à ${a.line}, travaux avant ${works}.`,
    people: [p.fullName],
    organizations: ["ANAH"],
    amounts: [euro(grant, 0)],
    dates: [issued],
    deadlines: [
      `Travaux à démarrer avant le ${works}`,
      "Achèvement sous 18 mois",
    ],
    importantPoints: [
      `Aide ${euro(grant, 0)}`,
      `Logement ${a.line}`,
    ],
    risks: [
      "Remboursement de l'aide en cas de fausse déclaration",
      "Perte de l'aide si travaux hors délai",
    ],
    actions: [
      `Démarrer les travaux avant le ${works}`,
      "Conserver les factures 5 ans",
    ],
    flags: { sanctions: true },
  });
}

/* -------------------------------------------------------------------------- */
/* CONTRATS COMMERCIAUX — 10 sous-types                                        */
/* -------------------------------------------------------------------------- */

function comPrestation(rng) {
  const client = person(rng);
  const id = ref("PRE", rng);
  const amount = randomAmount(rng, 2500, 18000);
  const start = futureDate(rng, 2026);
  const delivery = futureDate(rng, 2026);
  const title = `Contrat de prestation intellectuelle ${id}`;
  const body = `# Contrat de prestation de services

**Prestataire :** Agence Nordik Studio  
**Client :** ${client.fullName}  
**Réf. :** ${id}  
**Début :** ${start}

## Mission
- Refonte site vitrine + SEO technique
- Prix forfaitaire HT : **${euro(amount, 0)}**
- Acompte 30 % à la commande

## Livraison
- Livraison finale avant le **${delivery}**.
- Révisions incluses : 2 cycles.
- **Pénalités** de retard prestataire : 0,5 % / jour ouvré (plafond 10 %).
- **Obligation** : client fournit contenus sous 10 jours.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Contrat de prestation ${id} entre Nordik Studio et ${client.fullName}, forfait ${euro(amount, 0)}, livraison avant ${delivery}.`,
    people: [client.fullName],
    organizations: ["Agence Nordik Studio"],
    amounts: [euro(amount, 0)],
    dates: [start],
    deadlines: [
      `Livraison finale avant le ${delivery}`,
      "Fourniture des contenus sous 10 jours",
    ],
    importantPoints: [
      `Forfait ${euro(amount, 0)} HT`,
      "Acompte 30 %",
      "2 cycles de révisions",
    ],
    risks: [
      "Pénalités de retard 0,5 % / jour",
      "Retard client sur contenus décale la livraison",
    ],
    actions: [
      `Suivre la livraison avant le ${delivery}`,
      "Fournir les contenus sous 10 jours",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function comNDA(rng) {
  const p = person(rng);
  const id = ref("NDA", rng);
  const start = pastDate(rng, 2026);
  const duration = 24;
  const endNotice = futureDate(rng, 2026);
  const title = `Accord de confidentialité ${id}`;
  const body = `# Accord de non-divulgation (NDA)

**Partie divulgatrice :** InnovLab SAS  
**Partie réceptrice :** ${p.fullName}  
**Réf. :** ${id}  
**Signature :** ${start}

## Périmètre
- Informations techniques et commerciales échangées
- Durée de confidentialité : **${duration} mois** après fin des discussions

## Sortie
- Restitution / destruction des supports avant le **${endNotice}** en cas d'arrêt des pourparlers.
- **Sanction** : clause pénale de **10 000 €** par violation caractérisée.
- Droit applicable : droit français.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `NDA ${id} entre InnovLab et ${p.fullName}, confidentialité ${duration} mois, restitution avant ${endNotice}.`,
    people: [p.fullName],
    organizations: ["InnovLab SAS"],
    amounts: ["10 000 €"],
    dates: [start],
    deadlines: [
      `Restitution des supports avant le ${endNotice}`,
      `Confidentialité de ${duration} mois`,
    ],
    importantPoints: [
      `Durée ${duration} mois`,
      "Droit français",
    ],
    risks: [
      "Clause pénale de 10 000 € par violation",
    ],
    actions: [
      `Restituer les supports avant le ${endNotice} si arrêt`,
      "Limiter le cercle des personnes informées",
    ],
    flags: { sanctions: true, penalties: true },
  });
}

function comDistribution(rng) {
  const p = person(rng);
  const id = ref("DIS", rng);
  const fee = randomAmount(rng, 2000, 8000);
  const start = pastDate(rng, 2025);
  const renew = futureDate(rng, 2026);
  const title = `Contrat de distribution exclusive ${id}`;
  const body = `# Contrat de distribution exclusive

**Fournisseur :** Maison Boréal SA  
**Distributeur :** ${p.fullName}  
**Réf. :** ${id}  
**Effet :** ${start}

## Conditions
- Territoire : Grand Est
- Redevance annuelle minimale : **${euro(fee, 0)}**
- Objectif volume annuel défini en annexe

## Durée
- Renouvellement tacite sauf dénonciation 3 mois avant, soit avant le **${renew}**.
- **Pénalités** de non-atteinte d'objectifs : 5 % du manque à gagner.
- **Obligation** : stock tampon de 30 jours.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Contrat de distribution ${id} pour ${p.fullName} avec Maison Boréal, redevance ${euro(fee, 0)}, dénonciation avant ${renew}.`,
    people: [p.fullName],
    organizations: ["Maison Boréal SA"],
    amounts: [euro(fee, 0)],
    dates: [start],
    deadlines: [
      "Dénonciation 3 mois avant échéance",
      `Dénonciation avant le ${renew}`,
    ],
    importantPoints: [
      "Territoire Grand Est",
      `Redevance ${euro(fee, 0)}`,
      "Exclusivité",
    ],
    risks: [
      "Renouvellement tacite",
      "Pénalités de 5 % si objectifs non atteints",
    ],
    actions: [
      `Anticiper la dénonciation avant le ${renew}`,
      "Maintenir un stock tampon 30 jours",
    ],
    flags: { autoRenewal: true, penalties: true, obligations: true },
  });
}

function comMaintenance(rng) {
  const p = person(rng);
  const id = ref("MNT", rng);
  const monthly = randomAmount(rng, 120, 480);
  const start = pastDate(rng, 2025);
  const visit = futureDate(rng, 2026);
  const title = `Contrat maintenance industrielle ${id}`;
  const body = `# Contrat de maintenance préventive

**Prestataire :** TechKeep Services  
**Client :** ${p.fullName}  
**Contrat :** ${id}  
**Effet :** ${start}

## Prestations
- Abonnement : **${euro(monthly)}** / mois HT
- 4 visites préventives / an
- GTI 8 heures ouvrées

## Planning
- Prochaine visite avant le **${visit}**.
- Préavis de résiliation : 60 jours.
- **Pénalités** de retard d'intervention : **80 €** / jour ouvré.
- Pièces hors contrat facturées au barème annexe.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Contrat maintenance ${id} TechKeep pour ${p.fullName}, ${euro(monthly)} HT / mois, visite avant ${visit}.`,
    people: [p.fullName],
    organizations: ["TechKeep Services"],
    amounts: [euro(monthly), "80 €"],
    dates: [start],
    deadlines: [
      `Prochaine visite avant le ${visit}`,
      "Préavis de résiliation de 60 jours",
    ],
    importantPoints: [
      `Abonnement ${euro(monthly)} HT`,
      "4 visites / an",
      "GTI 8 heures",
    ],
    risks: [
      "Pièces hors contrat facturées en sus",
      "Pénalités de retard d'intervention",
    ],
    actions: [
      `Planifier la visite avant le ${visit}`,
      "Anticiper un préavis de 60 jours",
    ],
    flags: { penalties: true, hiddenFees: true },
  });
}

function comSaaS(rng) {
  const p = person(rng);
  const id = ref("SAAS", rng);
  const seats = 5 + Math.floor(rng() * 40);
  const monthly = randomAmount(rng, 79, 490);
  const start = pastDate(rng, 2026);
  const renew = futureDate(rng, 2026);
  const title = `Contrat abonnement SaaS ${id}`;
  const body = `# Contrat d'abonnement logiciel (SaaS)

**Éditeur :** CloudPilot SAS  
**Client :** ${p.fullName}  
**Contrat :** ${id}  
**Souscription :** ${start}

## Offre
- ${seats} licences utilisateurs
- Abonnement : **${euro(monthly)}** / mois HT
- SLA disponibilité : 99,5 %

## Renouvellement
- Reconduction tacite annuelle sauf résiliation 30 jours avant, soit avant le **${renew}**.
- **Frais** de réactivation après suspension : **50 €**.
- Export des données sous 15 jours après fin de contrat.
- **Sanction** : suspension immédiate en cas d'impayé > 15 jours.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Abonnement SaaS ${id} CloudPilot pour ${p.fullName}, ${seats} licences, ${euro(monthly)} HT / mois.`,
    people: [p.fullName],
    organizations: ["CloudPilot SAS"],
    amounts: [euro(monthly), "50 €"],
    dates: [start],
    deadlines: [
      "Résiliation 30 jours avant échéance",
      `Résiliation avant le ${renew}`,
      "Export des données sous 15 jours après fin",
    ],
    importantPoints: [
      `${seats} licences`,
      `Abonnement ${euro(monthly)} HT`,
      "SLA 99,5 %",
    ],
    risks: [
      "Reconduction tacite annuelle",
      "Suspension après 15 jours d'impayé",
      "Frais de réactivation 50 €",
    ],
    actions: [
      `Résilier avant le ${renew} si besoin`,
      "Prévoir l'export des données",
    ],
    flags: { autoRenewal: true, hiddenFees: true, sanctions: true },
  });
}

function comSousTraitance(rng) {
  const p = person(rng);
  const id = ref("STT", rng);
  const amount = randomAmount(rng, 8000, 45000);
  const start = futureDate(rng, 2026);
  const end = futureDate(rng, 2026);
  const title = `Contrat de sous-traitance ${id}`;
  const body = `# Contrat de sous-traitance

**Contractant principal :** BâtiPlus Construction  
**Sous-traitant :** ${p.fullName}  
**Réf. :** ${id}  
**Chantier — période :** du ${start} au ${end}

## Marché
- Montant HT : **${euro(amount, 0)}**
- Lot : second œuvre plâtrerie
- Paiement à 45 jours fin de mois

## Obligations
- Attestations URSSAF et assurance à jour avant démarrage.
- **Pénalités** de retard : 1 ‰ / jour du montant du lot.
- **Obligation** : respect du planning joint en annexe B.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Sous-traitance ${id} pour ${p.fullName} avec BâtiPlus, montant ${euro(amount, 0)}, du ${start} au ${end}.`,
    people: [p.fullName],
    organizations: ["BâtiPlus Construction"],
    amounts: [euro(amount, 0)],
    dates: [start, end],
    deadlines: [
      `Période du ${start} au ${end}`,
      "Paiement à 45 jours fin de mois",
    ],
    importantPoints: [
      `Montant ${euro(amount, 0)} HT`,
      "Lot plâtrerie",
    ],
    risks: [
      "Pénalités de retard 1 ‰ / jour",
      "Démarrage bloqué sans attestations",
    ],
    actions: [
      "Fournir URSSAF et assurance avant démarrage",
      "Respecter le planning annexe B",
    ],
    flags: { penalties: true, obligations: true },
  });
}

function comMandat(rng) {
  const p = person(rng);
  const id = ref("MAN", rng);
  const commission = randomAmount(rng, 3, 8);
  const start = pastDate(rng, 2026);
  const end = futureDate(rng, 2026);
  const title = `Mandat de représentation commerciale ${id}`;
  const body = `# Mandat d'agent commercial

**Mandant :** Maison Boréal SA  
**Agent :** ${p.fullName}  
**Mandat :** ${id}  
**Prise d'effet :** ${start}

## Rémunération
- Commission : **${formatMoney(commission, 1)} %** HT sur CA encaissé
- Territoire : Bretagne
- Exclusivité limitée aux produits listés

## Fin de mandat
- Échéance : **${end}** sauf reconduction.
- Préavis de 2 mois.
- **Indemnité** de fin de mandat selon usage si conditions réunies.
- **Obligation** : compte rendu mensuel avant le 5.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Mandat d'agent commercial ${id} pour ${p.fullName}, commission ${formatMoney(commission, 1)} %, échéance ${end}.`,
    people: [p.fullName],
    organizations: ["Maison Boréal SA"],
    amounts: [],
    dates: [start, end],
    deadlines: [
      `Échéance du mandat le ${end}`,
      "Préavis de 2 mois",
      "Compte rendu mensuel avant le 5",
    ],
    importantPoints: [
      `Commission ${formatMoney(commission, 1)} %`,
      "Territoire Bretagne",
    ],
    risks: [
      "Perte d'indemnité si conditions non réunies",
      "Fin de mandat à l'échéance sans reconduction",
    ],
    actions: [
      `Anticiper le préavis avant le ${end}`,
      "Envoyer le compte rendu avant le 5",
    ],
    flags: { obligations: true },
  });
}

function comPartenariat(rng) {
  const p = person(rng);
  const id = ref("PAR", rng);
  const budget = randomAmount(rng, 5000, 25000);
  const start = futureDate(rng, 2026);
  const report = futureDate(rng, 2026);
  const title = `Accord de partenariat commercial ${id}`;
  const body = `# Accord de partenariat

**Partenaire A :** InnovLab SAS  
**Partenaire B :** ${p.fullName}  
**Réf. :** ${id}  
**Lancement :** ${start}

## Objet
Co-marketing sur lancement produit — budget commun **${euro(budget, 0)}** HT.

## Gouvernance
- Comité de pilotage mensuel
- Rapport d'exécution avant le **${report}**
- Répartition 50/50 des leads qualifiés

## Sortie
- Résiliation pour convenance : préavis de 45 jours.
- **Sanction** : restitution du budget non consommé sous 30 jours.
- Propriété intellectuelle : chaque partie conserve ses marques.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Partenariat ${id} entre InnovLab et ${p.fullName}, budget ${euro(budget, 0)}, lancement ${start}.`,
    people: [p.fullName],
    organizations: ["InnovLab SAS"],
    amounts: [euro(budget, 0)],
    dates: [start],
    deadlines: [
      `Lancement le ${start}`,
      `Rapport d'exécution avant le ${report}`,
      "Préavis de résiliation de 45 jours",
      "Restitution du budget non consommé sous 30 jours",
    ],
    importantPoints: [
      `Budget ${euro(budget, 0)} HT`,
      "Répartition leads 50/50",
    ],
    risks: [
      "Restitution du budget non consommé exigée",
      "Désaccord sur la qualification des leads",
    ],
    actions: [
      `Préparer le rapport avant le ${report}`,
      "Planifier le comité mensuel",
    ],
    flags: { sanctions: true },
  });
}

function comVenteMateriel(rng) {
  const p = person(rng);
  const id = ref("VTM", rng);
  const amount = randomAmount(rng, 3500, 22000);
  const order = pastDate(rng, 2026);
  const delivery = futureDate(rng, 2026);
  const title = `Bon de commande matériel pro ${id}`;
  const body = `# Bon de commande — matériel professionnel

**Vendeur :** EquipPro Distribution  
**Acheteur :** ${p.fullName}  
**Commande :** ${id}  
**Date :** ${order}

## Contenu
- 2 imprimantes laser réseau + consommables an 1
- Montant HT : **${euro(amount, 0)}**
- TVA 20 % en sus

## Livraison / paiement
- Livraison prévue au plus tard le **${delivery}**.
- Paiement : 40 % commande / 60 % livraison.
- **Pénalités** de retard de livraison : 0,3 % / jour (plafond 5 %).
- Garantie constructeur 24 mois.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Bon de commande ${id} EquipPro pour ${p.fullName}, montant ${euro(amount, 0)} HT, livraison avant ${delivery}.`,
    people: [p.fullName],
    organizations: ["EquipPro Distribution"],
    amounts: [euro(amount, 0)],
    dates: [order],
    deadlines: [`Livraison au plus tard le ${delivery}`],
    importantPoints: [
      `Montant ${euro(amount, 0)} HT`,
      "Paiement 40/60",
      "Garantie 24 mois",
    ],
    risks: [
      "Pénalités de retard de livraison plafonnées à 5 %",
    ],
    actions: [
      `Suivre la livraison avant le ${delivery}`,
      "Prévoir le solde à la livraison",
    ],
    flags: { penalties: true },
  });
}

function comFranchise(rng) {
  const p = person(rng);
  const a = address(rng);
  const id = ref("FRA", rng);
  const entry = randomAmount(rng, 15000, 45000);
  const royalty = randomAmount(rng, 4, 8);
  const start = futureDate(rng, 2026);
  const training = futureDate(rng, 2026);
  const title = `Contrat de franchise ${id}`;
  const body = `# Contrat de franchise

**Franchiseur :** Réseau Vertigo  
**Franchisé :** ${p.fullName}  
**Réf. :** ${id}  
**Point de vente :** ${a.line}  
**Ouverture prévue :** ${start}

## Conditions financières
- Droit d'entrée : **${euro(entry, 0)}**
- Redevance : **${formatMoney(royalty, 1)} %** du CA HT
- Redevance pub : 1 % du CA HT

## Calendrier
- Formation initiale avant le **${training}**.
- Durée : 5 ans — reconduction tacite sauf préavis 6 mois.
- **Obligation** : respect de la charte visuelle et des process.
- **Sanction** : déchéance de l'exclusivité territoriale en cas de manquement grave.

${footer()}`;

  return pack("commercial", title, body, {
    documentType: "Contrat commercial",
    title,
    summary: `Contrat de franchise ${id} Réseau Vertigo pour ${p.fullName} à ${a.line}, droit d'entrée ${euro(entry, 0)}, ouverture ${start}.`,
    people: [p.fullName],
    organizations: ["Réseau Vertigo"],
    amounts: [euro(entry, 0)],
    dates: [start],
    deadlines: [
      `Ouverture prévue le ${start}`,
      `Formation initiale avant le ${training}`,
      "Préavis de 6 mois",
    ],
    importantPoints: [
      `Droit d'entrée ${euro(entry, 0)}`,
      `Redevance ${formatMoney(royalty, 1)} %`,
      "Durée 5 ans",
    ],
    risks: [
      "Reconduction tacite",
      "Déchéance de l'exclusivité territoriale",
    ],
    actions: [
      `Suivre la formation avant le ${training}`,
      "Anticiper un préavis de 6 mois pour sortir",
    ],
    flags: { autoRenewal: true, obligations: true, sanctions: true },
  });
}

/* -------------------------------------------------------------------------- */
/* Catalogue & main                                                            */
/* -------------------------------------------------------------------------- */

const BUILDERS = [
  // Assurances (10)
  assAuto, assVie, assPro, assVoyage, assAnimaux,
  assScolaire, assDependance, assGav, assChantier, assHabAvenant,
  // Banques (10)
  banConvention, banOpposition, banCreditConso, banCloture, banPretImmo,
  banAlerteDecouvert, banSepa, banAssuranceEmprunteur, banLivret, banChiffreAffairePro,
  // Travail (10)
  travCDD, travAvenant, travRupture, travAvertissement, travSTC,
  travPromesse, travStage, travTeletravail, travLicenciement, travClauseNonConcurrence,
  // Impôts (10)
  impTaxeFonciere, impCFE, impControle, impPrelevement, impRedressement,
  impDelaiPaiement, impIRComplement, impTVApro, impHabitation, impIS,
  // Baux (10)
  bailMeuble, bailCommercial, bailColocation, bailConge, bailRevision,
  bailEtatLieux, bailParking, bailSaisonnier, bailAvenantCharges, bailGarant,
  // Téléphonie (10)
  telResiliation, telPortabilite, telRoaming, telFactureLitige, telB2B,
  telAvenantData, telMiseEnDemeure, telSimPerdue, telForfait5G, telOptionTV,
  // Internet (10)
  netInstallation, netResiliation, netLitigeDebit, netPro, netDemenagement,
  netBoxTV, netEngagement, netSAV, netDevisFTTH, netIPFixe,
  // Mutuelles (10)
  mutDentaire, mutOptique, mutResiliation, mutRemboursement, mutFamille,
  mutSenior, mutEntreprise, mutHospitalisation, mutCotisationImpaye, mutMedecineDouce,
  // Admin (10)
  admPrefecture, admMairie, admCPAM, admFranceTravail, admJustice,
  admPermis, admCadastre, admEcole, admURSSAF, admANAH,
  // Commercial (10)
  comPrestation, comNDA, comDistribution, comMaintenance, comSaaS,
  comSousTraitance, comMandat, comPartenariat, comVenteMateriel, comFranchise,
];

function slugify(value) {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/(^-|-$)/g, "")
    .slice(0, 60);
}

async function nextIndex(dir) {
  await mkdir(dir, { recursive: true });
  const entries = await readdir(dir);
  let max = 0;
  for (const name of entries) {
    const match = name.match(/^(\d+)-/);
    if (match) max = Math.max(max, Number(match[1]));
  }
  return max + 1;
}

async function rebuildReadme() {
  const categories = await readdir(ROOT, { withFileTypes: true });
  const rows = [];
  let total = 0;

  const dirs = categories
    .filter((e) => e.isDirectory())
    .map((e) => e.name)
    .sort((a, b) => a.localeCompare(b, "fr"));

  for (const dirName of dirs) {
    const dir = path.join(ROOT, dirName);
    const files = (await readdir(dir))
      .filter((f) => f.endsWith("_expected.json"))
      .sort((a, b) => a.localeCompare(b, "fr"));

    const label =
      Object.values(CATEGORY_DIRS).find((c) => c.id === dirName)?.label ||
      dirName;

    for (const expectedName of files) {
      total += 1;
      const mdName = expectedName.replace(/_expected\.json$/, ".md");
      rows.push(
        `| ${total} | ${label} | \`${dirName}/${mdName}\` | \`${dirName}/${expectedName}\` |`,
      );
    }
  }

  const readme = `# Documents de test DocMind

Ce dossier contient **${total} documents fictifs** et **${total} fichiers de vérité terrain** (\`*_expected.json\`).

## Avertissement

- Documents **100 % fictifs**
- Aucune copie de document réel protégé
- Aucune valeur juridique
- Chaque \`*_expected.json\` est généré avec les **mêmes données** que le document correspondant

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
${rows.join("\n")}

## Régénération

\`\`\`bash
npm run generate:docs
npm run generate:docs:extra
npm run generate:pdfs
\`\`\`

- \`generate:docs\` : régénère le corpus de base (écrase \`test-documents/\`)
- \`generate:docs:extra\` : ajoute 100 documents série 2 (sous-types distincts)

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
  return total;
}

async function main() {
  if (BUILDERS.length !== 100) {
    throw new Error(`Attendu 100 builders, trouvé ${BUILDERS.length}`);
  }

  const counters = {};
  let created = 0;

  for (let i = 0; i < BUILDERS.length; i += 1) {
    const seed = 900000 + i * 7919 + BUILDERS[i].name.length * 17;
    const rng = seededRandom(seed);
    const doc = BUILDERS[i](rng);
    const meta = CATEGORY_DIRS[doc.categoryKey];
    if (!meta) throw new Error(`Catégorie inconnue: ${doc.categoryKey}`);

    const dir = path.join(ROOT, meta.id);
    if (counters[meta.id] == null) {
      counters[meta.id] = await nextIndex(dir);
    }
    const index = counters[meta.id];
    counters[meta.id] += 1;

    const baseName = `${String(index).padStart(2, "0")}-${slugify(doc.title)}`;
    await writeFile(path.join(dir, `${baseName}.md`), doc.body, "utf8");
    await writeFile(
      path.join(dir, `${baseName}_expected.json`),
      `${JSON.stringify(doc.expected, null, 2)}\n`,
      "utf8",
    );
    created += 1;
  }

  const total = await rebuildReadme();
  console.log(`Série 2 : ${created} documents ajoutés (corpus total: ${total})`);

  const convert = spawnSync(
    process.execPath,
    [path.join(process.cwd(), "scripts", "convert-md-to-pdf.mjs")],
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
