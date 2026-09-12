/**
 * Helpers d’affichage tableau de bord / mémoire — pas de logique analyse P2.
 */
import type { DocumentAlert } from "@/types/alerts";
import type { DocumentCategory } from "@/types/document-category";
import type { HistoryListItem } from "@/types/history";

const GENERIC_LABELS = new Set([
  "Courrier administratif",
  "Contrat",
  "Banque",
  "Facture",
  "Assurance",
  "Autre",
  "Impôts",
  "Bail",
  "Conditions générales",
  "Contrat de travail",
]);

const CATEGORY_ID_FR: Record<string, string> = {
  contrat: "Contrat",
  facture: "Facture",
  assurance: "Assurance",
  banque: "Banque",
  impots: "Impôts",
  bail: "Bail",
  "courrier-administratif": "Courrier administratif",
  "contrat-de-travail": "Contrat de travail",
  "conditions-generales": "Conditions générales",
  autre: "Autre",
  pret: "Offre de prêt",
};

export type HistoryDisplayItem = HistoryListItem & {
  /** Nombre d’analyses fusionnées (même hash / même doc). */
  duplicateCount?: number;
};

export type RelationAlertDisplay = DocumentAlert & {
  duplicateCount?: number;
};

function normalizeKeyPart(value: string): string {
  return value
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, " ")
    .trim();
}

function historyCollapseKey(item: HistoryListItem): string {
  const hash = item.contentHash?.trim();
  if (hash && hash.length >= 12) return `hash:${hash}`;
  return `meta:${item.category}|${normalizeKeyPart(item.title)}|${normalizeKeyPart(item.fileName)}`;
}

/**
 * Fusionne les lignes historique identiques (re-upload / re-analyse).
 * Conserve la plus récente ; badge ×N via duplicateCount.
 */
export function collapseHistoryDuplicates(
  items: HistoryListItem[],
): HistoryDisplayItem[] {
  const groups = new Map<string, HistoryListItem[]>();
  for (const item of items) {
    const key = historyCollapseKey(item);
    const list = groups.get(key);
    if (list) list.push(item);
    else groups.set(key, [item]);
  }

  const out: HistoryDisplayItem[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) =>
      b.analyzedAt.localeCompare(a.analyzedAt),
    );
    const primary = sorted[0]!;
    out.push({
      ...primary,
      duplicateCount: sorted.length > 1 ? sorted.length : undefined,
    });
  }
  return out.sort((a, b) => b.analyzedAt.localeCompare(a.analyzedAt));
}

function relationCollapseKey(alert: DocumentAlert): string {
  const fileKey = normalizeKeyPart(alert.fileName);
  const titleKey = normalizeKeyPart(alert.documentTitle);

  // Re-uploads du même PDF (ex. MED ×4) : une ligne par kind + fichier,
  // comme collapseHistoryDuplicates — pas une ligne par paire A↔B / A↔C…
  if (alert.kind === "relation_duplicate") {
    return `dup:${fileKey || titleKey}`;
  }

  const a = alert.historyId || "";
  const b = alert.secondaryHistoryId || "";
  const pair = [a, b].filter(Boolean).sort().join("|");
  if (pair.includes("|")) {
    // Même paire + même kind ; ancrage fichier pour éviter les variantes d’id
    return `${alert.kind}|${pair}|${fileKey || titleKey}`;
  }
  return `${alert.kind}|meta:${titleKey}|${fileKey}`;
}

/**
 * Une ligne par type + identité documentaire (fichier / paire).
 * Les « Document en doublon » sur le même MED sont fusionnés avec badge ×N.
 */
export function collapseRelationAlerts(
  alerts: DocumentAlert[],
): RelationAlertDisplay[] {
  const groups = new Map<string, DocumentAlert[]>();
  for (const alert of alerts) {
    const key = relationCollapseKey(alert);
    const list = groups.get(key);
    if (list) list.push(alert);
    else groups.set(key, [alert]);
  }

  const out: RelationAlertDisplay[] = [];
  for (const group of groups.values()) {
    const sorted = [...group].sort((a, b) =>
      b.createdAt.localeCompare(a.createdAt),
    );
    const primary = sorted[0]!;
    out.push({
      ...primary,
      duplicateCount: sorted.length > 1 ? sorted.length : undefined,
      title: softenRelationAlertTitle(primary),
    });
  }
  return out;
}

/** Libellé FR plus précis quand le titre / type le permet. */
export function resolveDisplayCategoryLabel(input: {
  category: DocumentCategory | string;
  categoryLabel?: string | null;
  title?: string | null;
  documentType?: string | null;
}): string {
  const blob = [
    input.title ?? "",
    input.documentType ?? "",
    input.categoryLabel ?? "",
  ].join(" ");

  if (
    /mise\s+en\s+demeure|\bmed\b|recouvrement|huissier/i.test(blob) ||
    (input.category === "courrier-administratif" &&
      /demeure|relance\s+de\s+paiement|impay/i.test(blob))
  ) {
    return "Mise en demeure";
  }

  if (
    /\bcaf\b|allocations\s+familiales|caisse\s+d['']allocations/i.test(blob)
  ) {
    return "Notification CAF";
  }

  if (
    /offre\s+de\s+pr[eê]t|pr[eê]t\s+personnel|cr[eé]dit\s+serein|\btaeg\b|capital\s+emprunt/i.test(
      blob,
    ) ||
    ((input.category === "contrat" || input.category === "banque") &&
      /\bpr[eê]t\b|\bcr[eé]dit\b/i.test(blob))
  ) {
    return "Offre de prêt";
  }

  const label = (input.categoryLabel ?? "").trim();
  if (label && !GENERIC_LABELS.has(label)) return label;

  return (
    CATEGORY_ID_FR[input.category] ||
    label ||
    String(input.category)
  );
}

/** Ids catégorie contreparties → FR ; crédit/prêt / CAF si le nom le dit. */
export function formatCounterpartyCategoryLabels(
  entityName: string,
  categories: string[],
): string[] {
  const creditName = /cr[eé]dit|pr[eê]t|serein|taeg/i.test(entityName);
  const cafName =
    /\bcaf\b|allocations\s+familiales|caisse\s+d['']allocations/i.test(
      entityName,
    );
  const out: string[] = [];
  const seen = new Set<string>();

  for (const raw of categories) {
    let label = CATEGORY_ID_FR[raw] ?? raw;
    if (
      creditName &&
      (raw === "banque" || raw === "contrat" || raw === "autre")
    ) {
      label = "Offre de prêt";
    }
    if (cafName && raw === "courrier-administratif") {
      label = "Notification CAF";
    }
    if (seen.has(label)) continue;
    seen.add(label);
    out.push(label);
  }
  return out;
}

export function isSoftRedundantPaymentEvidence(
  evidence:
    | Array<{ field: string; left?: string; right?: string; note?: string }>
    | undefined,
): boolean {
  if (!evidence?.length) return true;
  const period = evidence.find((e) => e.field === "periodicity");
  if (!period) return true;
  if (/partielle/i.test(period.note ?? "")) return true;
  if (
    period.left === "inconnue" ||
    period.right === "inconnue" ||
    !period.left ||
    !period.right
  ) {
    return true;
  }
  return false;
}

export function softenRelationAlertTitle(alert: DocumentAlert): string {
  if (alert.kind !== "relation_redundant_payment") return alert.title;
  if (/facture\s+li[eé]e/i.test(alert.title)) return alert.title;
  // Soften copy générique « redondant »
  if (/redondant/i.test(alert.title) || /paiement/i.test(alert.title)) {
    return "Même montant récurrent ?";
  }
  return alert.title;
}

export function softenRedundantPaymentTypeLabel(
  soft: boolean,
): string {
  return soft ? "Même montant récurrent ?" : "Paiement redondant";
}

/**
 * Compteur KPI affiché : relations « dures » + moitié des soft redundant_payment.
 */
export function countRelationsToVerify(opts: {
  total: number;
  softRedundantCount: number;
}): number {
  const hard = Math.max(0, opts.total - opts.softRedundantCount);
  const softWeight = Math.ceil(opts.softRedundantCount / 2);
  return hard + softWeight;
}
