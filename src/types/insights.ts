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
  monthlyEur: number | null;
  annualEur: number | null;
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
  monthlyTotalEur: number;
  annualTotalEur: number;
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
  estimatedMonthlySavingEur: number | null;
  relationType: string;
  relationId: string;
  score: number;
  historyId: string | null;
  secondaryHistoryId: string | null;
  documentId: string;
  documentTitle: string;
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
  monthlySpendEur: number;
  annualSpendEur: number;
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
