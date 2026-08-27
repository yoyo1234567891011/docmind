import type { DocumentCategory, RiskCriterionId, RiskFinding } from "@/types";

export type WatchDocFamily =
  | "recouvrement"
  | "abonnement"
  | "assurance"
  | "banque"
  | "bail"
  | "pret"
  | "facture"
  | "administratif"
  | "default";

/** Ordre des critères pour « Points à surveiller » selon le type de document. */
export const WATCH_CRITERION_ORDER_BY_FAMILY: Record<
  WatchDocFamily,
  readonly RiskCriterionId[]
> = {
  abonnement: [
    "engagement",
    "resiliation",
    "penalites",
    "renouvellement_tacite",
    "frais_caches",
    "delais",
    "augmentation_tarif",
    "clauses_abusives",
    "obligations_importantes",
    "sanctions",
  ],
  assurance: [
    "renouvellement_tacite",
    "frais_caches",
    "penalites",
    "delais",
    "resiliation",
    "engagement",
    "augmentation_tarif",
    "clauses_abusives",
    "obligations_importantes",
    "sanctions",
  ],
  recouvrement: [
    "frais_caches",
    "penalites",
    "delais",
    "sanctions",
    "obligations_importantes",
    "engagement",
    "resiliation",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
  facture: [
    "frais_caches",
    "penalites",
    "delais",
    "obligations_importantes",
    "sanctions",
    "engagement",
    "resiliation",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
  banque: [
    "frais_caches",
    "penalites",
    "delais",
    "engagement",
    "sanctions",
    "obligations_importantes",
    "resiliation",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
  /** Bail / location : économie du logement avant délais génériques. */
  bail: [
    "frais_caches",
    "engagement",
    "renouvellement_tacite",
    "resiliation",
    "clauses_abusives",
    "augmentation_tarif",
    "delais",
    "obligations_importantes",
    "penalites",
    "sanctions",
  ],
  pret: [
    "engagement",
    "frais_caches",
    "penalites",
    "delais",
    "obligations_importantes",
    "resiliation",
    "sanctions",
    "augmentation_tarif",
    "renouvellement_tacite",
    "clauses_abusives",
  ],
  /** Impôts / taxe / avis de prélèvement : montant dû puis échéances. */
  administratif: [
    "frais_caches",
    "delais",
    "penalites",
    "obligations_importantes",
    "sanctions",
    "engagement",
    "resiliation",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
  default: [
    "frais_caches",
    "renouvellement_tacite",
    "engagement",
    "penalites",
    "resiliation",
    "augmentation_tarif",
    "delais",
    "clauses_abusives",
    "obligations_importantes",
    "sanctions",
  ],
};

/** Critères à injecter localement selon la famille (évite les génériques hors recouvrement). */
export const LOCAL_INJECT_CRITERIA_BY_FAMILY: Record<
  WatchDocFamily,
  readonly RiskCriterionId[]
> = {
  recouvrement: [
    "frais_caches",
    "penalites",
    "delais",
    "sanctions",
    "obligations_importantes",
  ],
  abonnement: [
    "engagement",
    "resiliation",
    "penalites",
    "renouvellement_tacite",
    "frais_caches",
    "delais",
  ],
  assurance: [
    "renouvellement_tacite",
    "frais_caches",
    "penalites",
    "delais",
    "resiliation",
  ],
  banque: ["frais_caches", "penalites", "delais", "sanctions"],
  bail: [
    "frais_caches",
    "engagement",
    "renouvellement_tacite",
    "resiliation",
    "augmentation_tarif",
    "delais",
    "obligations_importantes",
    "clauses_abusives",
  ],
  pret: [
    "engagement",
    "frais_caches",
    "penalites",
    "delais",
    "obligations_importantes",
  ],
  administratif: [
    "frais_caches",
    "delais",
    "penalites",
    "obligations_importantes",
    "sanctions",
  ],
  facture: ["frais_caches", "penalites", "delais", "obligations_importantes"],
  default: [
    "renouvellement_tacite",
    "frais_caches",
    "penalites",
    "engagement",
    "resiliation",
    "delais",
  ],
};

const GENERIC_TITLE_RE =
  /obligation\s+de\s+payer|obligation\s+(?:de\s+)?r[ée]gulariser|obligation\s+importante\s+impos|menace\s+de\s+poursuites|recouvrement\s+forc[ée]|d[ée]lai\s+tr[èe]s\s+court\s*:\s*\d+\s*jours|d[ée]lai\s+court\s+pour\s+agir|^d[ée]lai\s*\/\s*pr[ée]avis\b|^d[ée]lai\s+ou\s+[ée]ch[ée]ance|^d[ée]lai\s*[:\-–]?\s*\d+\s*jours?\s*$|^d[ée]lai\s+de\s+\d+\s*jours?\s*$|^point\s+de\s+vigilance|^frais\s+annexes\s*:|date\s+limite\s+pour\s+r[ée]silier|r[ée]silier\s*\/\s*modifier|modifier\s*(?:\/\s*)?r[ée]silier/i;

/** Sur relevé bancaire : libellés abonnement/contrat hors sujet. */
const BANQUE_OFFTOPIC_TITLE_RE =
  /r[ée]silier|modifier\s+l['']abonnement|engagement\s+minimum|renouvellement\s+tacite|pr[ée]avis\s+de\s+r[ée]siliation/i;

/** Signaux concrets : chiffre, frais nommé, délai utile (préavis, prélèvement…). */
const SPECIFIC_SIGNAL_RE =
  /engagement|franchise|carence|tacite|reconduction|r[ée]siliation\s+anticip|frais\s+de\s+r[ée]siliation|mat[ée]riel|non[\s-]retour|tenue\s+de\s+compte|commission\s+d['']intervention|int[ée]r[êe]ts?\s+d[ée]biteurs|frais\s+de\s+rejet|d[ée]couvert|ficp|suspension|p[ée]nalit[ée].{0,20}retard|frais\s+de\s+recouvrement|total\s+r[ée]clam|huissier|contester\s+sous|pr[ée]avis|loyer|charges\s+locatives|d[ée]p[ôo]t\s+de\s+garantie|clause\s+r[ée]solutoire|honoraires?|taeg|mensualit[ée]|capital\s+emprunt|r[ée]tractation|irl\b|r[ée]vision\s+du\s+loyer|pr[ée]l[eè]v|taxe\s+fonci|remboursement\s+anticip|total\s+ttc|[ée]ch[ée]ance|\d[\d\s.,]*\s*€|€\s*\d|\d+\s*%|\d+\s*mois/i;

/** Titre vague type « Date limite pour résilier / modifier » sans montant ni délai utile. */
const VACUOUS_RESILIATION_TITLE_RE =
  /^date\s+limite\s+pour\s+r[ée]silier(?:\s*\/\s*modifier)?\s*$|^r[ée]silier\s*\/\s*modifier(?:\s+l['']abonnement)?\s*$/i;

/**
 * True si le libellé est trop générique pour la section « Points à surveiller »
 * (pas de chiffre / frais / préavis / pénalité concrète).
 */
export function isVacuousGenericWatchTitle(description: string): boolean {
  const t = description.trim();
  if (!t) return true;
  if (hasConcreteWatchSignal(t)) return false;
  if (VACUOUS_RESILIATION_TITLE_RE.test(t)) return true;
  if (GENERIC_TITLE_RE.test(t)) return true;
  // « Délai 30 jours » / « Délai : 10 jours » sans autre contexte
  if (
    /^d[ée]lai(?:\s*\/\s*pr[ée]avis)?\s*[:\-–]?\s*\d+\s*jours?\s*\.?$/i.test(t)
  ) {
    return true;
  }
  if (
    /^obligation\s+(?:de\s+)?(?:payer|r[ée]gulariser)(?:\s+(?:le\s+)?solde)?\s*\.?$/i.test(
      t,
    )
  ) {
    return true;
  }
  return false;
}

export function hasConcreteWatchSignal(text: string): boolean {
  return SPECIFIC_SIGNAL_RE.test(text);
}

export type WatchFamilyContext = {
  category?: DocumentCategory | string | null;
  documentType?: string | null;
  title?: string | null;
  textHint?: string | null;
};

export function resolveWatchDocFamily(
  ctx: WatchFamilyContext = {},
): WatchDocFamily {
  const blob = [
    ctx.category,
    ctx.documentType,
    ctx.title,
    ctx.textHint?.slice(0, 1200),
  ]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

  if (
    /mise\s+en\s+demeure|recouvrement|huissier|commandement\s+de\s+payer|cr[ée]ance/.test(
      blob,
    )
  ) {
    return "recouvrement";
  }
  if (
    ctx.category === "bail" ||
    /\bbail\b|location\s+(?:vide|meubl[ée]e)|loyer\s+mensuel|d[ée]p[ôo]t\s+de\s+garantie|bailleur|locataire|charges\s+locatives|clause\s+r[ée]solutoire/.test(
      blob,
    )
  ) {
    return "bail";
  }
  if (
    ctx.category === "assurance" ||
    /assurance|mutuelle|franchise|sinistre|cotisation/.test(blob)
  ) {
    return "assurance";
  }
  if (
    ctx.category === "banque" ||
    /relev[ée]\s+bancaire|tenue\s+de\s+compte|d[ée]couvert|commission\s+d['']intervention|fichier\s+des\s+incidents|ficp|int[ée]r[êe]ts?\s+d[ée]biteurs/.test(
      blob,
    )
  ) {
    return "banque";
  }
  if (
    ctx.category === "facture" ||
    /\bfacture\b|n[°o]\s*(?:de\s*)?facture|total\s+ttc|net\s+[àa]\s+payer/.test(
      blob,
    )
  ) {
    return "facture";
  }
  if (
    /offre\s+de\s+pr[êe]t|\bpr[êe]t\s+(?:immobilier|personnel|consommation)|cr[ée]dit\s+(?:immobilier|consommation)|taeg|assurance\s+emprunteur|remboursement\s+anticip[ée]/.test(
      blob,
    )
  ) {
    return "pret";
  }
  if (
    (ctx.category === "impots" ||
      ctx.category === "courrier-administratif" ||
      /\bcaf\b|imp[ôo]ts?|amendes?\s+fiscale|avis\s+d['']imposition|avis\s+de\s+pr[ée]l[eè]vement|taxe\s+fonci[eè]re|montant\s+[àa]\s+pr[ée]lever|dgfip|direction\s+g[ée]n[ée]rale\s+des\s+finances|notification\s+(?:caf|urssaf)/.test(
        blob,
      )) &&
    !/mise\s+en\s+demeure|recouvrement|huissier/.test(blob)
  ) {
    return "administratif";
  }
  if (
    ctx.category === "contrat" ||
    ctx.category === "conditions-generales" ||
    /abonnement|box|fibre|forfait|internet|t[ée]l[ée]phonie|mobile|engagement\s+de\s+\d+\s*mois/.test(
      blob,
    )
  ) {
    return "abonnement";
  }
  return "default";
}

function severityBoost(severity: RiskFinding["severity"]): number {
  switch (severity) {
    case "critique":
      return 0;
    case "eleve":
      return 1;
    case "modere":
      return 2;
    default:
      return 3;
  }
}

function specificityBoost(finding: RiskFinding): number {
  const text = `${finding.description} ${finding.excerpt}`.toLowerCase();
  if (hasConcreteWatchSignal(text)) return -8;
  if (isVacuousGenericWatchTitle(finding.description)) return 40;
  if (GENERIC_TITLE_RE.test(finding.description)) return 25;
  return 0;
}

function bailTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/^loyer\b|loyer\s*:/i.test(t)) return 0;
  if (
    /^charges\b|charges\s*:|provisions?\s+pour\s+charges|charges\s+locatives/i.test(
      t,
    )
  ) {
    return 1;
  }
  if (/d[ée]p[ôo]t\s+de\s+garantie|d[ée]p[ôo]t\s*:/i.test(t)) return 2;
  if (/honoraires?|frais\s+de\s+(?:mise\s+en\s+)?location/i.test(t)) return 3;
  if (/dur[ée]e\s+du\s+bail/.test(t)) return 10;
  if (/tacite|reconduction/.test(t)) return 11;
  if (/pr[ée]avis/.test(t)) return 12;
  if (/clause\s+r[ée]solutoire/.test(t)) return 13;
  if (/r[ée]vision|irl/.test(t)) return 14;
  return 50;
}

/** Loyer / charges / dépôt — toujours en tête du watch bail. */
export function isBailEconomicWatchTitle(description: string): boolean {
  return bailTitlePriority(description) <= 2;
}

/** Ordre d’affichage impôts / taxe / avis de prélèvement. */
function administratifTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/taxe\s+fonci|montant\s+[àa]\s+pr[ée]lever|montant\s+[àa]\s+payer|cotisation\s+[àa]\s+payer/.test(t)) {
    return 0;
  }
  if (/^pr[ée]l[eè]vement\s+le\b/.test(t)) return 1;
  if (/opposition|date\s+limite\s+de\s+paiement|date\s+limite\s+de\s+d[ée]claration/.test(t)) {
    return 2;
  }
  if (/majoration|p[ée]nalit/.test(t)) return 3;
  if (
    /produit\s+national|ensemble\s+des\s+foyers|taxe\s+d['']habitation|valeur\s+locative\s+cadastrale|collectivit/.test(
      t,
    )
  ) {
    return 200;
  }
  return 50;
}

function recouvrementTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/total\s+r[ée]clam|somme\s+totale|montant\s+total|montant\s+d[ûu]/.test(t)) {
    return 0;
  }
  if (/p[ée]nalit|retard/.test(t)) return 2;
  if (/frais\s+de\s+recouvrement|huissier/.test(t)) return 3;
  if (/contester|d[ée]lai|sous\s+\d+\s*jours?|8\s*jours|10\s*jours/.test(t)) {
    return 4;
  }
  if (/frais\s+de\s+dossier|frais\s+annexes/.test(t)) return 80;
  return 50;
}

function banqueTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/commission\s+d['']intervention|frais\s+de\s+rejet|tenue\s+de\s+compte/.test(t)) {
    return 0;
  }
  if (/int[ée]r[êe]ts?\s+d[ée]biteurs|agios/.test(t)) return 1;
  if (/d[ée]couvert/.test(t)) return 2;
  if (/ficp|fichier\s+des\s+incidents|suspension/.test(t)) return 3;
  if (/r[ée]gularis|date\s+de\s+r[ée]gularisation/.test(t)) return 4;
  if (/r[ée]silier|abonnement|tacite/.test(t)) return 200;
  return 50;
}

function factureTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/total\s+ttc|net\s+[àa]\s+payer|montant\s+[àa]\s+payer|montant\s+d[ûu]/.test(t)) {
    return 0;
  }
  if (/[ée]ch[ée]ance|date\s+limite/.test(t)) return 2;
  if (/p[ée]nalit|retard|majoration/.test(t)) return 3;
  if (/frais\s+(?:annexes|de\s+dossier)/.test(t)) return 80;
  return 50;
}

/** Titre hors sujet (totaux nationaux, TH, VL cadastrale…). */
export function isNationalTaxNoiseTitle(description: string): boolean {
  if (
    /produit\s+(?:net\s+)?(?:de\s+la\s+)?taxe|ensemble\s+des\s+(?:foyers|contribuables)|suppression\s+(?:de\s+)?la\s+taxe\s+d['']habitation|valeur\s+locative\s+(?:cadastrale|moyenne)|base\s+nationale|total\s+(?:des\s+)?recettes|budget\s+(?:de\s+)?l[''][ée]tat|collectivit[ée]s?\s+territoriales|france\s+enti[eè]re/i.test(
      description,
    )
  ) {
    return true;
  }
  // Montants « nationaux » : au moins 3 blocs de milliers (ex. 234 079 050 €).
  return /\d{1,3}(?:[\s\u00a0]\d{3}){2,}(?:[.,]\d+)?\s*€/.test(description);
}

/**
 * Score de classement (plus bas = plus haut dans « Points à surveiller »).
 */
export function watchRankScore(
  finding: RiskFinding,
  family: WatchDocFamily,
): number {
  const order = WATCH_CRITERION_ORDER_BY_FAMILY[family];
  const id = finding.criterion_id;
  const criterionIdx = id ? order.indexOf(id) : -1;
  const base =
    criterionIdx >= 0 ? criterionIdx * 10 : 200 + severityBoost(finding.severity);

  // Hors recouvrement : déprioriser fortement les titres génériques.
  let genericPenalty = 0;
  if (
    family !== "recouvrement" &&
    isVacuousGenericWatchTitle(finding.description)
  ) {
    genericPenalty = 120;
  } else if (
    family !== "recouvrement" &&
    GENERIC_TITLE_RE.test(finding.description)
  ) {
    genericPenalty = 80;
  }
  // Bail / prêt : un délai générique « 10 jours » ne doit pas passer devant loyer / dépôt.
  if (
    (family === "bail" || family === "pret") &&
    /^d[ée]lai/i.test(finding.description) &&
    !/pr[ée]avis|carence|r[ée]tractation|r[ée]sili/i.test(finding.description)
  ) {
    genericPenalty += 40;
  }
  // Banque : écarter les libellés « résiliation / abonnement » hors sujet.
  if (family === "banque") {
    if (BANQUE_OFFTOPIC_TITLE_RE.test(finding.description)) {
      genericPenalty += 120;
    }
    if (
      finding.criterion_id === "resiliation" ||
      finding.criterion_id === "renouvellement_tacite" ||
      finding.criterion_id === "engagement"
    ) {
      genericPenalty += 100;
    }
  }

  let bailBoost = 0;
  if (family === "bail") {
    bailBoost = bailTitlePriority(finding.description);
  }

  let adminBoost = 0;
  if (family === "administratif") {
    adminBoost = administratifTitlePriority(finding.description);
    if (isNationalTaxNoiseTitle(finding.description)) {
      adminBoost += 150;
    }
  }

  let recouvrementBoost = 0;
  if (family === "recouvrement") {
    recouvrementBoost = recouvrementTitlePriority(finding.description);
  }

  let banqueBoost = 0;
  if (family === "banque") {
    banqueBoost = banqueTitlePriority(finding.description);
  }

  let factureBoost = 0;
  if (family === "facture") {
    factureBoost = factureTitlePriority(finding.description);
  }

  return (
    base +
    severityBoost(finding.severity) +
    specificityBoost(finding) +
    genericPenalty +
    bailBoost +
    adminBoost +
    recouvrementBoost +
    banqueBoost +
    factureBoost
  );
}

function findingDedupeKey(finding: RiskFinding): string {
  const criterion = finding.criterion_id ?? "";
  const desc = finding.description
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 96);
  return `${criterion}::${desc}`;
}

/** Trie, déduplique, filtre les génériques vides et borne les findings. */
export function rankFindingsForWatch(
  findings: RiskFinding[],
  ctx: WatchFamilyContext = {},
  limit = 7,
): RiskFinding[] {
  const family = resolveWatchDocFamily(ctx);
  const sorted = [...findings].sort((a, b) => {
    const diff = watchRankScore(a, family) - watchRankScore(b, family);
    if (diff !== 0) return diff;
    return (b.confidence ?? 0) - (a.confidence ?? 0);
  });

  const hasConcreteAlternative = sorted.some(
    (f) =>
      !isVacuousGenericWatchTitle(f.description) &&
      hasConcreteWatchSignal(`${f.description} ${f.excerpt ?? ""}`),
  );

  const seen = new Set<string>();
  const out: RiskFinding[] = [];
  const deferredGenerics: RiskFinding[] = [];

  for (const finding of sorted) {
    if (
      family === "banque" &&
      (BANQUE_OFFTOPIC_TITLE_RE.test(finding.description) ||
        finding.criterion_id === "resiliation" ||
        finding.criterion_id === "renouvellement_tacite" ||
        finding.criterion_id === "engagement") &&
      !hasConcreteWatchSignal(finding.description)
    ) {
      // Sur relevé : masquer les cartes « résiliation / abonnement » hors sujet.
      if (
        !/tenue\s+de\s+compte|commission|intervention|rejet|d[ée]couvert|int[ée]r[êe]ts?\s+d[ée]biteurs|frais\s+bancaires?/i.test(
          finding.description,
        )
      ) {
        continue;
      }
    }

    // Hors recouvrement : masquer les titres vagues si des points concrets existent.
    if (
      family !== "recouvrement" &&
      isVacuousGenericWatchTitle(finding.description)
    ) {
      if (hasConcreteAlternative) continue;
      deferredGenerics.push(finding);
      continue;
    }

    // Impôts : masquer totaux nationaux / chiffres hors sujet.
    if (
      family === "administratif" &&
      isNationalTaxNoiseTitle(finding.description) &&
      hasConcreteAlternative
    ) {
      continue;
    }

    const key = findingDedupeKey(finding);
    if (seen.has(key)) continue;
    // Soft : même critère + description très proche
    let softDup = false;
    for (const prev of seen) {
      const [, prevDesc] = prev.split("::");
      const [, desc] = key.split("::");
      if (
        prev.startsWith(`${finding.criterion_id ?? ""}::`) &&
        prevDesc &&
        desc &&
        prevDesc.length >= 24 &&
        desc.length >= 24 &&
        (prevDesc.includes(desc) || desc.includes(prevDesc))
      ) {
        softDup = true;
        break;
      }
    }
    if (softDup) continue;
    seen.add(key);
    out.push(finding);
    if (out.length >= limit) break;
  }

  // Repli : aucun point concret → garder quelques génériques dépriorisés.
  if (out.length === 0 && deferredGenerics.length > 0) {
    for (const finding of deferredGenerics) {
      const key = findingDedupeKey(finding);
      if (seen.has(key)) continue;
      seen.add(key);
      out.push(finding);
      if (out.length >= Math.min(3, limit)) break;
    }
  }

  if (family === "bail" && out.length > 0) {
    const economic = out.filter((f) =>
      isBailEconomicWatchTitle(f.description),
    );
    const rest = out.filter((f) => !isBailEconomicWatchTitle(f.description));
    return [...economic, ...rest].slice(0, limit);
  }

  return out;
}

/** Filtre les libellés trop vagues dans important_points (fallback UI). */
export function filterGenericImportantPoints(points: string[]): string[] {
  const concrete = points.filter((p) => !isVacuousGenericWatchTitle(p));
  if (concrete.length > 0) return concrete;
  return points.slice(0, 3);
}
