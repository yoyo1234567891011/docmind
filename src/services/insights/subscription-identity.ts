/**
 * Identité d’abonnement pour insights (lecture seule).
 * Ne remplace pas le graphe entities — affine seulement l’agrégation Dashboard.
 *
 * Règles documentées :
 * - fournisseur = entity organization ;
 * - produit/service = signal lexical (Internet, Mobile…) ou « default » ;
 * - sans signal produit fort : un fournisseur = une ligne (évite faux split Netflix A/B) ;
 * - montants proches (±2 % ou 0,50 €) = même abonnement (dédup) ;
 * - montants éloignés sans relation de remplacement = 1 ligne, montant le plus récent (pas la somme).
 */
import type { DocRelationSignals } from "@/services/memory/relation-signals";
import type { MemoryDocumentNode } from "@/types/memory";

export type ProductSignal = {
  key: string;
  label: string;
};

const PRODUCT_PATTERNS: Array<{ key: string; label: string; re: RegExp }> = [
  {
    key: "internet",
    label: "Internet",
    re: /\b(internet|fibre|livebox|adsl|ftth|box\s*internet)\b/i,
  },
  {
    key: "mobile",
    label: "Mobile",
    re: /\b(mobile|forfait\s*mobile|smartphone|ligne\s*mobile|\b5g\b|\b4g\b)\b/i,
  },
  {
    key: "tv",
    label: "TV",
    re: /\b(tv|television|télévision|canal\+|disney\+|netflix)\b/i,
  },
  {
    key: "electricite",
    label: "Électricité",
    re: /\b(electricite|électricité|edf|enedis|kwh)\b/i,
  },
  {
    key: "gaz",
    label: "Gaz",
    re: /\b(gaz|engie)\b/i,
  },
  {
    key: "assurance_auto",
    label: "Assurance auto",
    re: /\b(auto|vehicule|véhicule|automobile)\b/i,
  },
  {
    key: "assurance_habitation",
    label: "Assurance habitation",
    re: /\b(habitation|logement|mrh|multirisque)\b/i,
  },
  {
    key: "assurance_sante",
    label: "Santé",
    re: /\b(sante|santé|mutuelle)\b/i,
  },
];

function slug(raw: string): string {
  return raw
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "-")
    .replace(/^-|-$/g, "")
    .slice(0, 48);
}

function corpusForProduct(
  doc: MemoryDocumentNode,
  signals: DocRelationSignals | null,
  orgName: string,
): string {
  const parts = [
    signals?.productHints ?? "",
    signals?.title ?? "",
    doc.displayName ?? "",
    doc.fileName ?? "",
    ...(signals?.riskLabels ?? []),
    ...(signals?.guaranteeLabels ?? []),
  ];
  let text = parts.join(" ");
  if (orgName.trim()) {
    const re = new RegExp(
      orgName.replace(/[.*+?^${}()|[\]\\]/g, "\\$&"),
      "ig",
    );
    text = text.replace(re, " ");
  }
  return text.replace(/\s+/g, " ").trim();
}

/**
 * Signal produit/service pour distinguer plusieurs contrats chez le même fournisseur.
 * Déterministe — pas d’invention de fusion.
 */
export function resolveProductSignal(
  doc: MemoryDocumentNode,
  signals: DocRelationSignals | null,
  orgName: string,
): ProductSignal {
  const text = corpusForProduct(doc, signals, orgName);
  for (const p of PRODUCT_PATTERNS) {
    if (p.re.test(text)) {
      return { key: p.key, label: p.label };
    }
  }

  // Sans lexique produit : regrouper sous le fournisseur (clé default).
  // Évite de scinder artificiellement « Netflix A » / « Netflix B ».
  void slug;
  return { key: "default", label: "" };
}

export function subscriptionAggregateId(
  orgId: string,
  productKey: string,
  amountSuffix?: string | null,
): string {
  const base = `sub:${orgId}:${productKey}`;
  return amountSuffix ? `${base}:amt:${amountSuffix}` : base;
}

export function subscriptionDisplayName(
  orgName: string,
  product: ProductSignal,
): string {
  if (!product.label || product.key === "default") {
    return orgName;
  }
  if (product.key.startsWith("title:") || product.key.startsWith("doc:")) {
    return product.label ? `${orgName} — ${product.label}` : orgName;
  }
  return `${orgName} — ${product.label}`;
}

const PERIOD_PATTERNS: Array<{ re: RegExp; key: string }> = [
  { re: /mensuel|par mois|\/mois|chaque mois/i, key: "mensuel" },
  { re: /trimestriel|par trimestre/i, key: "trimestriel" },
  { re: /annuel|par an|\/an|chaque annee|chaque année/i, key: "annuel" },
  { re: /hebdomadaire|par semaine/i, key: "hebdomadaire" },
];

/** Périodicité récurrente détectée dans le texte (sans LLM). */
export function inferRecurringPeriod(sourceText: string): string | null {
  const text = sourceText || "";
  for (const p of PERIOD_PATTERNS) {
    if (p.re.test(text)) return p.key;
  }
  return null;
}

/** Montants suffisamment proches pour être traités comme le même abonnement. */
export function amountsClose(a: number, b: number): boolean {
  if (a <= 0 || b <= 0) return false;
  if (Math.abs(a - b) <= 0.5) return true;
  return Math.abs(a - b) / Math.max(a, b) <= 0.02;
}

/**
 * Choisit un montant récurrent parmi plusieurs candidats.
 * Préfère un montant voisin de « mensuel / abonnement / cotisation » dans le texte.
 * Sinon ne prend amounts[0] que s’il n’y a qu’un seul montant.
 * Si plusieurs montants sans ancrage → null (ambigu, pas de certitude).
 */
export function pickRecurringAmountEur(
  amounts: number[],
  period: string | null,
  sourceText: string,
): number | null {
  const uniq = [...new Set(amounts.filter((n) => n > 0))];
  if (uniq.length === 0) return null;
  if (uniq.length === 1) return uniq[0]!;

  const text = sourceText || "";
  const anchored: number[] = [];
  const patterns = [
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros)?\s*(?:\/\s*|par\s+)?mois/gi,
    /(\d+(?:[.,]\d+)?)\s*(?:€|eur|euros)?\s*(?:\/\s*|par\s+)?an(?:nee|ée)?/gi,
    /(?:abonnement|cotisation|mensualite|mensualité|redevance)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi,
    /(?:mensuel(?:le)?|prix\s+mensuel)\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi,
    /(?:prime|cotisation)\s+annuelle\s*[:=]?\s*(\d+(?:[.,]\d+)?)/gi,
  ];
  for (const re of patterns) {
    for (const m of text.matchAll(re)) {
      const n = Number(String(m[1]).replace(",", "."));
      if (Number.isFinite(n) && n > 0) {
        const rounded = Math.round(n * 100) / 100;
        if (uniq.some((u) => Math.abs(u - rounded) < 0.02)) {
          anchored.push(rounded);
        }
      }
    }
  }
  if (anchored.length === 1) return anchored[0]!;
  if (anchored.length > 1) {
    const counts = new Map<number, number>();
    for (const a of anchored) counts.set(a, (counts.get(a) ?? 0) + 1);
    const best = [...counts.entries()].sort((x, y) => y[1] - x[1])[0];
    if (best) return best[0];
  }

  void period;
  return null;
}
