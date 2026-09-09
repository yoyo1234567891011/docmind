import type { DocumentCategory, RiskCriterionId, RiskFinding } from "@/types";
import { areFindingsNearDuplicates, isMorePreciseFinding } from "@/ai/post-processing/dedupe-findings";

export type WatchDocFamily =
  | "recouvrement"
  | "abonnement"
  | "assurance"
  | "banque"
  | "bail"
  | "pret"
  | "facture"
  | "administratif"
  /** CAF / prestations sociales (≠ bail, ≠ fiscal). */
  | "social"
  | "default";

/**
 * En-tête utile pour typer le document — coupe avant le glossaire
 * boilerplate (Préambule / Définitions) qui pollue bail/MED/engagement.
 */
export function extractDocumentSignalHead(
  text: string,
  maxLen = 2800,
): string {
  const cut = text.search(
    /\n##\s*1\.\s*Pr[ée]ambule|\n##\s*2\.\s*D[ée]finitions|\n##\s*D[ée]finitions\b|\nPour l['']application du pr[ée]sent document/i,
  );
  const head = cut > 80 ? text.slice(0, cut) : text.slice(0, maxLen);
  return head.slice(0, maxLen);
}

export function hasPretDocumentSignal(blob: string): boolean {
  return /offre\s+de\s+pr[êe]t|\bpr[êe]t\s+(?:personnel|immobilier|consommation)|capital\s+emprunt[ée]|\btaeg\b|d[ée]ch[ée]ance\s+du\s+terme|pr[êe]teur\s*:|n[°o]\s*offre\s*:?\s*prt-/i.test(
    blob,
  );
}

export function hasCafDocumentSignal(blob: string): boolean {
  return /\bcaf\b|caisse\s+d['']allocations|allocataire|aide\s+au\s+logement|trop[\s-]per[çc]us|\bindu\b|espace\s+allocataire|maintien\s+de\s+vos\s+droits/i.test(
    blob,
  );
}

export function hasReleveBancaireSignal(blob: string): boolean {
  return /relev[ée]\s+(?:de\s+compte|bancaire)|commission\s+d['']intervention|tenue\s+de\s+compte|int[ée]r[êe]ts?\s+d[ée]biteurs|agios|fichier\s+des\s+incidents|ficp/i.test(
    blob,
  );
}

export function hasBailDocumentSignal(blob: string): boolean {
  return /\bbail\b|loyer\s*:|loyer\s+mensuel|d[ée]p[ôo]t\s+de\s+garantie|bailleur|charges\s+locatives|clause\s+r[ée]solutoire|location\s+(?:vide|meubl)/i.test(
    blob,
  );
}

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
    "obligations_importantes",
    "frais_caches",
    "penalites",
    "delais",
    "sanctions",
    "engagement",
    "resiliation",
    "clauses_abusives",
    "augmentation_tarif",
    "renouvellement_tacite",
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
    "obligations_importantes",
    "frais_caches",
    "engagement",
    "renouvellement_tacite",
    "resiliation",
    "clauses_abusives",
    "augmentation_tarif",
    "delais",
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
    "obligations_importantes",
    "penalites",
    "delais",
    "frais_caches",
    "sanctions",
    "engagement",
    "resiliation",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
  /** CAF / social : pièces, délais, indu — jamais engagement boîte. */
  social: [
    "obligations_importantes",
    "delais",
    "sanctions",
    "penalites",
    "frais_caches",
    "resiliation",
    "engagement",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
  default: [
    "obligations_importantes",
    "frais_caches",
    "penalites",
    "delais",
    "sanctions",
    "engagement",
    "resiliation",
    "renouvellement_tacite",
    "augmentation_tarif",
    "clauses_abusives",
  ],
};

/** Critères à injecter localement selon la famille (évite les génériques hors recouvrement). */
export const LOCAL_INJECT_CRITERIA_BY_FAMILY: Record<
  WatchDocFamily,
  readonly RiskCriterionId[]
> = {
  recouvrement: [
    "obligations_importantes",
    "frais_caches",
    "penalites",
    "delais",
    "sanctions",
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
    "obligations_importantes",
    "frais_caches",
    "engagement",
    "renouvellement_tacite",
    "resiliation",
    "augmentation_tarif",
    "delais",
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
    "obligations_importantes",
    "penalites",
    "delais",
    "frais_caches",
    "sanctions",
  ],
  social: [
    "obligations_importantes",
    "delais",
    "sanctions",
    "penalites",
  ],
  facture: ["frais_caches", "penalites", "delais", "obligations_importantes"],
  default: [
    "obligations_importantes",
    "frais_caches",
    "penalites",
    "engagement",
    "delais",
    "sanctions",
  ],
};

const GENERIC_TITLE_RE =
  /obligation\s+de\s+payer|obligation\s+(?:de\s+)?r[ée]gulariser|obligation\s+importante\s+impos|menace\s+de\s+poursuites|^recouvrement\s+forc[ée]\s*$|d[ée]lai\s+tr[èe]s\s+court\s*:\s*\d+\s*jours|d[ée]lai\s+court\s+pour\s+agir|^d[ée]lai\s*\/\s*pr[ée]avis\b|^d[ée]lai\s+ou\s+[ée]ch[ée]ance|^d[ée]lai\s*[:\-–]?\s*\d+\s*jours?\s*$|^d[ée]lai\s+de\s+\d+\s*jours?\s*$|^point\s+de\s+vigilance|^frais\s+annexes\s*:|date\s+limite\s+pour\s+r[ée]silier|r[ée]silier\s*\/\s*modifier|modifier\s*(?:\/\s*)?r[ée]silier/i;

/** Sur relevé bancaire : libellés abonnement/contrat hors sujet. */
const BANQUE_OFFTOPIC_TITLE_RE =
  /r[ée]silier|modifier\s+l['']abonnement|engagement\s+minimum|renouvellement\s+tacite|pr[ée]avis\s+de\s+r[ée]siliation/i;

/** Signaux concrets : chiffre, frais nommé, délai utile (préavis, prélèvement…). */
const SPECIFIC_SIGNAL_RE =
  /engagement|franchise|carence|tacite|reconduction|r[ée]siliation\s+anticip|frais\s+de\s+r[ée]siliation|mat[ée]riel|non[\s-]retour|tenue\s+de\s+compte|commission\s+d['']intervention|int[ée]r[êe]ts?\s+d[ée]biteurs|frais\s+de\s+rejet|d[ée]couvert|ficp|suspension|p[ée]nalit[ée].{0,20}retard|frais\s+de\s+recouvrement|total\s+r[ée]clam|huissier|contester\s+sous|pr[ée]avis|loyer|charges\s+locatives|d[ée]p[ôo]t\s+de\s+garantie|clause\s+r[ée]solutoire|honoraires?|taeg|mensualit[ée]|capital\s+emprunt|r[ée]tractation|irl\b|r[ée]vision\s+du\s+loyer|pr[ée]l[eè]v|taxe\s+fonci|remboursement\s+anticip|total\s+ttc|[ée]ch[ée]ance|recouvrement\s+forc|poursuites?\s+(?:pourront|engag)|date\s+limite\s+de\s+paiement|\d[\d\s.,]*\s*€|€\s*\d|\d+\s*%|\d+\s*mois/i;

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
  // « Délai / préavis : 10 jours » — avant le signal « préavis » générique
  if (
    /^d[ée]lai(?:\s*\/\s*pr[ée]avis)?\s*[:\-–]?\s*\d+\s*jours?\s*\.?$/i.test(t)
  ) {
    return true;
  }
  if (hasConcreteWatchSignal(t)) return false;
  if (VACUOUS_RESILIATION_TITLE_RE.test(t)) return true;
  if (GENERIC_TITLE_RE.test(t)) return true;
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
  const headSource = [ctx.documentType, ctx.title, ctx.textHint ?? ""]
    .filter(Boolean)
    .join("\n");
  const head = extractDocumentSignalHead(headSource).toLowerCase();
  const blob = [ctx.category, ctx.documentType, ctx.title, head]
    .filter(Boolean)
    .join(" \n ")
    .toLowerCase();

  // --- Signaux forts (prioritaires sur une mauvaise catégorie heuristique) ---
  if (hasPretDocumentSignal(blob) && !hasReleveBancaireSignal(head)) {
    return "pret";
  }
  if (hasCafDocumentSignal(blob)) {
    return "social";
  }

  // Bail avant MED : les baux citent souvent « commandement de payer » / résiliation.
  if (hasBailDocumentSignal(head) || (ctx.category === "bail" && hasBailDocumentSignal(blob))) {
    return "bail";
  }

  // Assurance / mutuelle avant MED (glossaire « mise en demeure »).
  if (
    (ctx.category === "assurance" ||
      /mutuelle|police\s+d['']assurance|\bfranchise\b|sinistre|cotisation\s+(?:mensuelle|annuelle)|contrat\s+d['']assurance/.test(
        head,
      )) &&
    !hasPretDocumentSignal(head)
  ) {
    return "assurance";
  }

  if (ctx.category === "facture") {
    return "facture";
  }
  // Impôts / avis fiscal : priorité catégorie (évite glossaire « mise en demeure »).
  if (ctx.category === "impots") {
    return "administratif";
  }

  const strongRecouvrement =
    /(?:^|[\n\r#])[^\n]{0,120}(?:1[èe]re\s+relance|mise\s+en\s+demeure\s+de\s+payer|mise\s+en\s+demeure\s*[—–-]|montant\s+impay[ée]|total\s+r[ée]clam[ée]\s*:)/i.test(
      head,
    ) ||
    (/huissier|commandement\s+de\s+payer|recouvrement\s+judiciaire|service\s+recouvrement/.test(
      head,
    ) &&
      !hasBailDocumentSignal(head));

  const looksFacture =
    /\bfacture\b|total\s+ttc|net\s+[àa]\s+payer|n[°o]\s*(?:de\s*)?facture|[ée]lectricit[ée]/i.test(
      head,
    );

  if (looksFacture && !strongRecouvrement) {
    return "facture";
  }

  if (strongRecouvrement) {
    return "recouvrement";
  }
  if (
    /(?:^|[\n\r#*])[^\n]{0,80}mise\s+en\s+demeure|montant\s+impay[ée]\s*:|total\s+r[ée]clam[ée]\s*:|1[èe]re\s+relance|2[eè]me\s+relance|commandement\s+de\s+payer/.test(
      head,
    ) &&
    !hasBailDocumentSignal(head)
  ) {
    return "recouvrement";
  }

  // Bail déjà traité plus haut ; garde-fou si catégorie seule.
  if (ctx.category === "bail") {
    return "bail";
  }

  // Assurance déjà traitée plus haut.
  if (ctx.category === "assurance") {
    return "assurance";
  }

  // Relevé bancaire — jamais une offre de prêt.
  if (
    ((ctx.category === "banque" && hasReleveBancaireSignal(head)) ||
      hasReleveBancaireSignal(head)) &&
    !hasPretDocumentSignal(head)
  ) {
    return "banque";
  }
  // Catégorie banque sans signal relevé mais aussi sans prêt → banque par défaut catégorie.
  if (ctx.category === "banque" && !hasPretDocumentSignal(head)) {
    return "banque";
  }

  if (
    /\bfacture\b|n[°o]\s*(?:de\s*)?facture|total\s+ttc|net\s+[àa]\s+payer/.test(
      head,
    )
  ) {
    return "facture";
  }

  if (
    /avis\s+d['']imposition|avis\s+fiscal|avis\s+de\s+pr[ée]l[eè]vement|taxe\s+fonci[eè]re|montant\s+[àa]\s+pr[ée]lever|dgfip|direction\s+g[ée]n[ée]rale\s+des\s+finances|principal\s+d[ûu]|reste\s+[àa]\s+payer/.test(
      head,
    )
  ) {
    return "administratif";
  }

  if (
    ctx.category === "contrat" ||
    ctx.category === "conditions-generales" ||
    /abonnement|box|fibre|forfait|internet|t[ée]l[ée]phonie|mobile|engagement\s+de\s+\d+\s*mois/.test(
      head,
    )
  ) {
    if (hasPretDocumentSignal(head)) return "pret";
    return "abonnement";
  }

  if (ctx.category === "courrier-administratif") {
    return "administratif";
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

/** Total dû en tête — mise en demeure / recouvrement. */
export function isRecouvrementTotalWatchTitle(description: string): boolean {
  const t = description.trim();
  if (!/\d/.test(t)) return false;
  return /total\s+r[ée]clam|somme\s+totale|montant\s+total|montant\s+d[ûu]|principal\s*\/\s*montant\s+impay|montant\s+impay/i.test(
    t,
  );
}

/** Montant principal en tête — facture. */
export function isFactureTtcWatchTitle(description: string): boolean {
  const t = description.trim();
  if (!/\d/.test(t)) return false;
  return /total\s+ttc|net\s+[àa]\s+payer|montant\s+[àa]\s+payer|montant\s+d[ûu]/i.test(
    t,
  );
}

/** Ordre d’affichage impôts / taxe / avis de prélèvement. */
function administratifTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (
    /principal\s+d[ûu]|total\s+[àa]\s+r[ée]gler|taxe\s+fonci|montant\s+[àa]\s+pr[ée]lever|montant\s+[àa]\s+payer|cotisation\s+[àa]\s+payer/.test(
      t,
    )
  ) {
    return 0;
  }
  if (/^pr[ée]l[eè]vement\s+le\b/.test(t)) return 1;
  if (/opposition|date\s+limite\s+de\s+paiement|date\s+limite\s+de\s+d[ée]claration/.test(t)) {
    return 2;
  }
  if (/majoration|p[ée]nalit|frais\s+de\s+relance/.test(t)) return 3;
  if (
    /recouvrement\s+forc|poursuites?\s+(?:pourront|engag|possibles)|huissier|saisie/.test(
      t,
    )
  ) {
    return 4;
  }
  if (/contester|obligation\s+de\s+contester/.test(t)) return 40;
  if (
    /produit\s+national|ensemble\s+des\s+foyers|taxe\s+d['']habitation|valeur\s+locative\s+cadastrale|collectivit/.test(
      t,
    )
  ) {
    return 200;
  }
  return 50;
}

/** CAF / social : pièces et délais avant suspension / indu. */
function socialTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/pi[èe]ce|produire|maintien|obligation\s+de\s+produire/.test(t)) return 0;
  if (/d[ée]lai|avant\s+le|transmission/.test(t)) return 1;
  if (/aide\s+mensuelle|aide\s+au\s+logement/.test(t)) return 2;
  if (/suspension/.test(t)) return 3;
  if (/indu|trop[\s-]per/.test(t)) return 4;
  return 50;
}

function recouvrementTitlePriority(description: string): number {
  const t = description.toLowerCase();
  if (/total\s+r[ée]clam|somme\s+totale|montant\s+total/.test(t)) {
    return 0;
  }
  if (/principal\s*\/\s*montant\s+impay|montant\s+impay|^principal\b/.test(t)) {
    return 1;
  }
  if (/p[ée]nalit|retard/.test(t)) return 2;
  if (/frais\s+de\s+recouvrement|huissier/.test(t)) return 3;
  if (/contester|d[ée]lai|sous\s+\d+\s*jours?|8\s*jours|10\s*jours|paiement/.test(t)) {
    return 4;
  }
  if (/frais\s+de\s+dossier|frais\s+annexes/.test(t)) return 80;
  if (/r[ée]silier|modifier\s+l['']abonnement/.test(t)) return 200;
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
  if (/[ée]ch[ée]ance|date\s+limite\s+de\s+paiement/.test(t)) return 2;
  if (/p[ée]nalit|retard|majoration|coupure|mise\s+en\s+demeure/.test(t)) return 3;
  if (/abonnement|forfait/.test(t)) return 85;
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

  // Hors recouvrement : déprioriser fortement les titres génériques
  // (sauf sanctions concrètes déjà couvertes par SPECIFIC_SIGNAL_RE).
  let genericPenalty = 0;
  if (
    family !== "recouvrement" &&
    isVacuousGenericWatchTitle(finding.description)
  ) {
    genericPenalty = 120;
  } else if (
    family !== "recouvrement" &&
    GENERIC_TITLE_RE.test(finding.description) &&
    !(
      finding.criterion_id === "sanctions" &&
      /recouvrement|poursuite|huissier|saisie/.test(
        finding.description.toLowerCase(),
      )
    )
  ) {
    genericPenalty = 80;
  }
  // Banque / fiscal : délai générique « 10 jours » = bruit glossaire.
  if (
    (family === "banque" || family === "administratif") &&
    /^d[ée]lai(?:\s*\/\s*pr[ée]avis)?\s*[:\-–]?\s*\d+\s*jours?\s*\.?$/i.test(
      finding.description,
    )
  ) {
    genericPenalty += 150;
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
  // Recouvrement : pas de « résilier / modifier » (définitions contractuelles).
  if (family === "recouvrement") {
    if (
      VACUOUS_RESILIATION_TITLE_RE.test(finding.description) ||
      /date\s+limite\s+pour\s+r[ée]silier|r[ée]silier\s*\/\s*modifier/i.test(
        finding.description,
      )
    ) {
      genericPenalty += 150;
    }
    if (
      finding.criterion_id === "resiliation" ||
      finding.criterion_id === "renouvellement_tacite"
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
  if (family === "social") {
    adminBoost = socialTitlePriority(finding.description);
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

    if (
      family === "recouvrement" &&
      (VACUOUS_RESILIATION_TITLE_RE.test(finding.description) ||
        /date\s+limite\s+pour\s+r[ée]silier|r[ée]silier\s*\/\s*modifier/i.test(
          finding.description,
        ) ||
        finding.criterion_id === "resiliation" ||
        finding.criterion_id === "renouvellement_tacite") &&
      !/huissier|recouvrement|p[ée]nalit|principal|montant\s+impay|total\s+r[ée]clam/i.test(
        finding.description,
      )
    ) {
      continue;
    }

  // Social / CAF : masquer engagement issu du glossaire annexes.
  if (
    family === "social" &&
    (finding.criterion_id === "engagement" ||
      /^engagement\b/i.test(finding.description)) &&
    !/aide|allocation|droits|pi[èe]ces/i.test(finding.description)
  ) {
    continue;
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
    // Soft dedup : similarité titre/extrait (Jaccard / inclusion / synonymes)
    let softDup = false;
    for (let i = 0; i < out.length; i += 1) {
      const prevFinding = out[i]!;
      if (areFindingsNearDuplicates(prevFinding, finding)) {
        if (isMorePreciseFinding(finding, prevFinding)) {
          out[i] = finding;
        }
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

  if (family === "recouvrement" && out.length > 0) {
    const total = out.filter((f) =>
      isRecouvrementTotalWatchTitle(f.description),
    );
    const rest = out.filter(
      (f) => !isRecouvrementTotalWatchTitle(f.description),
    );
    return [...total, ...rest].slice(0, limit);
  }

  if (family === "facture" && out.length > 0) {
    const ttc = out.filter((f) => isFactureTtcWatchTitle(f.description));
    const rest = out.filter((f) => !isFactureTtcWatchTitle(f.description));
    return [...ttc, ...rest].slice(0, limit);
  }

  return out;
}

/** Filtre les libellés trop vagues dans important_points (fallback UI). */
export function filterGenericImportantPoints(points: string[]): string[] {
  const concrete = points.filter((p) => !isVacuousGenericWatchTitle(p));
  if (concrete.length > 0) return concrete;
  return points.slice(0, 3);
}
