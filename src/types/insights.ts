/**
 * Insights produit — lecture seule sur la mémoire documentaire.
 * Ne modifie pas le moteur (relations, stores, detectors).
 */

export type SubscriptionStatusInsight = "active" | "possibly_replaced" | "unknown";

export interface SubscriptionInsight {
  id: string;
  entityId: string | null;
  name: string;
  category: string;
  /** Clé produit/service (sépare Internet vs Mobile chez le même fournisseur). */
  productKey: string | null;
  monthlyEur: number | null;
  annualEur: number | null;
  /** Périodicité extraite (null = inconnue — hors KPI dépenses/mois). */
  billingPeriod: string | null;
  /** Montant brut extrait du document source (avant conversion mensuelle). */
  extractedAmountEur: number | null;
  nextDeadline: {
    date: string;
    label: string;
    kind: string;
  } | null;
  terminationHint: string | null;
  documentCount: number;
  primaryHistoryId: string | null;
  primaryDocumentId: string | null;
  status: SubscriptionStatusInsight;
}

export interface FinanceCategoryBucket {
  category: string;
  label: string;
  monthlyEur: number;
  annualEur: number;
  count: number;
}

export interface FinanceMonthPoint {
  month: string;
  totalEur: number;
  documentCount: number;
}

export interface FinanceInsight {
  /** null si aucun montant récurrent fiable — jamais de faux 0 €. */
  monthlyTotalEur: number | null;
  annualTotalEur: number | null;
  byCategory: FinanceCategoryBucket[];
  series: FinanceMonthPoint[];
}

export type SavingsKind =
  | "duplicate"
  | "redundant_insurance"
  | "redundant_payment"
  | "contradiction"
  | "obsolete_fact";

export interface SavingsOpportunity {
  id: string;
  kind: SavingsKind;
  title: string;
  message: string;
  /** Montant uniquement si présent dans les preuves — jamais inventé. */
  estimatedMonthlySavingEur: number | null;
  /** Toujours potentiel tant que non confirmé par l’utilisateur. */
  certainty: "potential";
  relationType: string;
  relationId: string;
  score: number;
  historyId: string | null;
  secondaryHistoryId: string | null;
  documentId: string;
  documentTitle: string;
  evidence?: Array<{
    field: string;
    left: string;
    right: string;
    note?: string;
  }>;
}

export interface DigestHighlight {
  kind: string;
  text: string;
}

export interface MemoryDigest {
  period: "week" | "month";
  from: string;
  to: string;
  newDocuments: number;
  upcomingDeadlines: number;
  savingsCount: number;
  relationHighlights: DigestHighlight[];
  topCounterparties: Array<{ name: string; documentCount: number }>;
  summary: string;
}

export interface RelationLetterIntent {
  id: string;
  letterType:
    | "resiliation"
    | "remboursement"
    | "contestation"
    | "reponse_administrative"
    | "autre";
  title: string;
  reason: string;
  recipient: string;
  historyId: string | null;
  documentId: string;
  relationType: string;
  relationId: string;
}

export interface PremiumMemoryDashboard {
  /** null si aucun montant récurrent fiable — jamais de faux 0 €. */
  monthlySpendEur: number | null;
  annualSpendEur: number | null;
  subscriptionCount: number;
  savingsCount: number;
  estimatedMonthlySavingsEur: number;
  upcomingDeadlines: number;
  contradictionCount: number;
  topSubscriptions: SubscriptionInsight[];
  topSavings: SavingsOpportunity[];
  digest: MemoryDigest;
  letterIntents: RelationLetterIntent[];
  uniqueValuePoints: string[];
}
