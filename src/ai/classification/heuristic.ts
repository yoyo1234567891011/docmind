import { DOCUMENT_CATEGORY_LABELS, type DocumentCategory } from "@/types";
import type { DocumentClassification } from "@/types";
import {
  extractDocumentSignalHead,
  hasCafDocumentSignal,
  hasPretDocumentSignal,
  hasReleveBancaireSignal,
} from "@/ai/post-processing/watch-ranking";

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
    { re: /\blocation\s+(?:vide|meubl)/i, weight: 4 },
    { re: /\bloyer\s*:/i, weight: 4 },
    { re: /\bloyer\s+mensuel\b/i, weight: 4 },
    { re: /\bbailleur\b/i, weight: 3 },
    { re: /\bd[ée]p[ôo]t\s+de\s+garantie\b/i, weight: 3 },
    { re: /\bcharges\s+locatives\b/i, weight: 2 },
    // « locataire » seul trop fréquent dans le glossaire → poids faible
    { re: /\blocataire\b/i, weight: 1 },
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
    { re: /\bpolice\s+d['’]?assurance\b/i, weight: 5 },
    { re: /\bmutuelle\b/i, weight: 5 },
    { re: /\bcontrat\s+d['’]?assurance\b/i, weight: 4 },
    { re: /\bprime\s+(?:annuelle|mensuelle)\b/i, weight: 3 },
    { re: /\bfranchise\b/i, weight: 2 },
    { re: /\bsinistre\b/i, weight: 2 },
    { re: /\bgaranties?\b/i, weight: 1 },
    // « assurance » seul + « assurance emprunteur » → poids réduit
    { re: /\bassurance\b/i, weight: 2 },
  ],
  banque: [
    { re: /\brelev[ée]\s+(?:de\s+compte|bancaire)\b/i, weight: 6 },
    { re: /\brelev[ée]\s+bancaire\b/i, weight: 6 },
    { re: /\bcommission\s+d['’]?intervention\b/i, weight: 4 },
    { re: /\btenue\s+de\s+compte\b/i, weight: 3 },
    { re: /\bbanque\b/i, weight: 2 },
    { re: /\biban\b/i, weight: 1 },
    { re: /\bbic\b/i, weight: 1 },
    { re: /\bcompte\s+bancaire\b/i, weight: 2 },
    { re: /\bsolde\s+(?:cr[ée]diteur|d[ée]biteur|disponible)\b/i, weight: 3 },
    { re: /\bcarte\s+bancaire\b/i, weight: 2 },
    { re: /\bagios?\b/i, weight: 2 },
    { re: /\bvirement\b/i, weight: 1 },
  ],
  impots: [
    { re: /\bimp[ôo]ts?\b/i, weight: 3 },
    { re: /\bavis\s+d['’]?imposition\b/i, weight: 5 },
    { re: /\bavis\s+de\s+somme\s+[àa]\s+payer\b/i, weight: 5 },
    { re: /\btaxe\s+fonci[eè]re\b/i, weight: 5 },
    { re: /\bdirection\s+g[ée]n[ée]rale\s+des\s+finances\s+publiques\b/i, weight: 6 },
    { re: /\bfinances\s+publiques\b/i, weight: 4 },
    { re: /\bd[ée]claration\s+(?:de\s+)?revenus?\b/i, weight: 4 },
    { re: /\bdgfip\b/i, weight: 5 },
    { re: /\bprincipal\s+d[ûu]\b/i, weight: 3 },
    { re: /\breste\s+[àa]\s+payer\b/i, weight: 2 },
    { re: /\burssaf\b/i, weight: 3 },
    { re: /\btva\s+(?:due|collect[ée]e)\b/i, weight: 2 },
    { re: /\bnum[ée]ro\s+fiscal\b/i, weight: 3 },
    { re: /\bcontribuable\b/i, weight: 2 },
  ],
  "courrier-administratif": [
    { re: /\bcaisse\s+d['’]?allocations\s+familiales\b/i, weight: 8 },
    { re: /\bcaf\b/i, weight: 6 },
    { re: /\ballocataire\b/i, weight: 4 },
    { re: /\baide\s+au\s+logement\b/i, weight: 5 },
    { re: /\btrop[\s-]per[çc]us\b/i, weight: 4 },
    { re: /\bmonsieur\s+le\s+pr[ée]fet\b/i, weight: 3 },
    { re: /\bmise\s+en\s+demeure\b/i, weight: 5 },
    { re: /\bcommandement\s+de\s+payer\b/i, weight: 4 },
    { re: /\bhuissier\b/i, weight: 3 },
    { re: /\bservice\s+recouvrement\b/i, weight: 3 },
    { re: /\bnotification\b/i, weight: 1 },
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
    { re: /\boffre\s+de\s+pr[êe]t\b/i, weight: 8 },
    { re: /\bpr[êe]t\s+(?:personnel|immobilier|consommation)\b/i, weight: 7 },
    { re: /\bcapital\s+emprunt[ée]\b/i, weight: 6 },
    { re: /\btaeg\b/i, weight: 5 },
    { re: /\bd[ée]ch[ée]ance\s+du\s+terme\b/i, weight: 5 },
    { re: /\bpr[êe]teur\s*:/i, weight: 4 },
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
 * Les overrides prêt / CAF se basent sur l’en-tête (hors glossaire).
 */
export function classifyDocumentHeuristic(
  documentText: string,
): DocumentClassification {
  const head = extractDocumentSignalHead(documentText);
  const sample = documentText.slice(0, 12_000);

  // Overrides durs : ne jamais laisser IBAN / glossaire gagner.
  if (hasPretDocumentSignal(head) && !hasReleveBancaireSignal(head)) {
    return {
      category: "contrat",
      label: "Offre de prêt",
      confidence: 0.92,
    };
  }
  if (hasCafDocumentSignal(head)) {
    return {
      category: "courrier-administratif",
      label: "Notification CAF",
      confidence: 0.92,
    };
  }

  const scores = (
    Object.entries(CATEGORY_PATTERNS) as Array<
      [Exclude<DocumentCategory, "autre">, WeightedPattern[]]
    >
  ).map(([category, patterns]) => ({
    category,
    // Scorer d’abord sur l’en-tête (x1.5) puis le corps (x1) pour limiter le glossaire.
    score:
      scoreCategory(head, patterns) * 1.5 + scoreCategory(sample, patterns) * 0.35,
  }));

  scores.sort((a, b) => b.score - a.score);
  const best = scores[0];
  const second = scores[1];

  if (!best || best.score < HEURISTIC_CLASSIFY_MIN_SCORE) {
    return fallbackAutre();
  }
  if (second && best.score - second.score < HEURISTIC_CLASSIFY_MIN_MARGIN) {
    if (best.score < HEURISTIC_CLASSIFY_MIN_SCORE + 2) {
      return fallbackAutre();
    }
  }

  // Banque gagnante uniquement via IBAN sans relevé → autre / contrat
  if (
    best.category === "banque" &&
    !hasReleveBancaireSignal(head) &&
    hasPretDocumentSignal(sample)
  ) {
    return {
      category: "contrat",
      label: "Offre de prêt",
      confidence: 0.88,
    };
  }

  const confidence = Math.min(0.95, 0.55 + best.score * 0.03);

  let label = DOCUMENT_CATEGORY_LABELS[best.category];
  if (best.category === "contrat" && hasPretDocumentSignal(head)) {
    label = "Offre de prêt";
  }
  if (
    best.category === "courrier-administratif" &&
    hasCafDocumentSignal(head)
  ) {
    label = "Notification CAF";
  }

  return {
    category: best.category,
    label,
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
