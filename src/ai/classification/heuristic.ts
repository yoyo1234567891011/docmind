import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/types";
import type { DocumentClassification } from "@/types";

type WeightedPattern = { re: RegExp; weight: number };

const CATEGORY_PATTERNS: Record<
  Exclude<DocumentCategory, "autre">,
  WeightedPattern[]
> = {
  facture: [
    { re: /\bfacture\b/i, weight: 4 },
    { re: /\bn[°o]\s*(?:de\s*)?facture\b/i, weight: 5 },
    { re: /\bmontant\s*ttc\b/i, weight: 3 },
    { re: /\bmontant\s*ht\b/i, weight: 2 },
    { re: /\btva\b/i, weight: 1 },
    { re: /\bconditions?\s+de\s+r[èe]glement\b/i, weight: 2 },
    { re: /\bdate\s+d['’]?[ée]ch[ée]ance\b/i, weight: 2 },
  ],
  bail: [
    { re: /\bbail\b/i, weight: 5 },
    { re: /\blocation\b/i, weight: 2 },
    { re: /\bloyer\b/i, weight: 3 },
    { re: /\blocataire\b/i, weight: 3 },
    { re: /\bbailleur\b/i, weight: 3 },
    { re: /\bd[ée]p[ôo]t\s+de\s+garantie\b/i, weight: 3 },
    { re: /\bcharges\s+locatives\b/i, weight: 2 },
  ],
  "contrat-de-travail": [
    { re: /\bcontrat\s+de\s+travail\b/i, weight: 6 },
    { re: /\b(?:cdi|cdd)\b/i, weight: 4 },
    { re: /\bsalaire\s+(?:brut|net)\b/i, weight: 3 },
    { re: /\bemployeur\b/i, weight: 2 },
    { re: /\bsalari[ée]\b/i, weight: 2 },
    { re: /\bp[ée]riode\s+d['’]?essai\b/i, weight: 3 },
    { re: /\bconvention\s+collective\b/i, weight: 2 },
  ],
  assurance: [
    { re: /\bassurance\b/i, weight: 4 },
    { re: /\bpolice\s+d['’]?assurance\b/i, weight: 5 },
    { re: /\bprime\s+(?:annuelle|mensuelle)\b/i, weight: 3 },
    { re: /\bfranchise\b/i, weight: 2 },
    { re: /\bsinistre\b/i, weight: 2 },
    { re: /\bgaranties?\b/i, weight: 1 },
    { re: /\bassur[ée]\b/i, weight: 1 },
  ],
  banque: [
    { re: /\brelev[ée]\s+(?:de\s+compte|bancaire)\b/i, weight: 6 },
    { re: /\brelev[ée]\s+bancaire\b/i, weight: 6 },
    { re: /\bbanque\b/i, weight: 2 },
    { re: /\biban\b/i, weight: 3 },
    { re: /\bbic\b/i, weight: 2 },
    { re: /\bcompte\s+bancaire\b/i, weight: 3 },
    { re: /\bsolde\s+(?:cr[ée]diteur|d[ée]biteur|disponible)\b/i, weight: 3 },
    { re: /\bpr[êe]t\s+(?:immobilier|personnel)\b/i, weight: 3 },
    { re: /\bcarte\s+bancaire\b/i, weight: 2 },
    { re: /\bagios?\b/i, weight: 2 },
    { re: /\bvirement\b/i, weight: 1 },
  ],
  impots: [
    { re: /\bimp[ôo]ts?\b/i, weight: 3 },
    { re: /\bavis\s+d['’]?imposition\b/i, weight: 5 },
    { re: /\bd[ée]claration\s+(?:de\s+)?revenus?\b/i, weight: 4 },
    { re: /\bdgfip\b/i, weight: 4 },
    { re: /\burssaf\b/i, weight: 3 },
    { re: /\btva\s+(?:due|collect[ée]e)\b/i, weight: 2 },
    { re: /\bnum[ée]ro\s+fiscal\b/i, weight: 3 },
  ],
  "courrier-administratif": [
    { re: /\bmonsieur\s+le\s+pr[ée]fet\b/i, weight: 3 },
    { re: /\bcourrier\b/i, weight: 1 },
    { re: /\bnotification\b/i, weight: 2 },
    { re: /\bmise\s+en\s+demeure\b/i, weight: 4 },
    { re: /\brecommand[ée]\b/i, weight: 2 },
    { re: /\badministration\b/i, weight: 1 },
  ],
  "conditions-generales": [
    { re: /\bconditions\s+g[ée]n[ée]rales\b/i, weight: 6 },
    { re: /\bcg[uv]\b/i, weight: 4 },
    { re: /\bcgvu\b/i, weight: 4 },
    { re: /\bmentions\s+l[ée]gales\b/i, weight: 2 },
    { re: /\bpolitique\s+de\s+confidentialit[ée]\b/i, weight: 2 },
  ],
  contrat: [
    { re: /\bcontrat\b/i, weight: 3 },
    { re: /\bconvention\b/i, weight: 2 },
    { re: /\bparties\s+contractantes\b/i, weight: 3 },
    { re: /\bobjet\s+du\s+contrat\b/i, weight: 3 },
    { re: /\br[ée]siliation\b/i, weight: 1 },
    { re: /\bclause\b/i, weight: 1 },
    { re: /\bprestataire\b/i, weight: 1 },
  ],
};

/** Seuil au-dessus duquel on saute l’appel LLM de classification. */
export const HEURISTIC_CLASSIFY_MIN_SCORE = 4;
export const HEURISTIC_CLASSIFY_MIN_MARGIN = 1;

function scoreCategory(
  text: string,
  patterns: WeightedPattern[],
): number {
  let score = 0;
  for (const { re, weight } of patterns) {
    if (re.test(text)) score += weight;
  }
  return score;
}

function fallbackAutre(): DocumentClassification {
  return {
    category: "autre",
    label: DOCUMENT_CATEGORY_LABELS.autre,
    confidence: 0,
  };
}

/**
 * Classification locale instantanée (mots-clés).
 * Retourne toujours une catégorie (au pire "autre").
 */
export function classifyDocumentHeuristic(
  documentText: string,
): DocumentClassification {
  const sample = documentText.slice(0, 12_000);
  const scores = (
    Object.entries(CATEGORY_PATTERNS) as Array<
      [Exclude<DocumentCategory, "autre">, WeightedPattern[]]
    >
  ).map(([category, patterns]) => ({
    category,
    score: scoreCategory(sample, patterns),
  }));

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];

  if (!best || best.score < HEURISTIC_CLASSIFY_MIN_SCORE) {
    return fallbackAutre();
  }
  if (second && best.score - second.score < HEURISTIC_CLASSIFY_MIN_MARGIN) {
    // Signal ambigu → on garde quand même le meilleur si score correct
    if (best.score < HEURISTIC_CLASSIFY_MIN_SCORE + 2) {
      return fallbackAutre();
    }
  }

  const confidence = Math.min(0.95, 0.55 + best.score * 0.04);

  return {
    category: best.category,
    label: DOCUMENT_CATEGORY_LABELS[best.category],
    confidence,
  };
}

/** true si la classification heuristique est assez nette pour éviter le LLM. */
export function isHeuristicConfident(
  classification: DocumentClassification,
): boolean {
  return (
    classification.category !== "autre" && classification.confidence >= 0.6
  );
}
