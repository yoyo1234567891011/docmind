import type { QuotaMetric } from "@/config/quotas";
import { resetUserUsageMetrics } from "@/services/quotas/store";

/** Compteurs remis à 0 lors d’un upgrade de palier (métriques produit). */
const UPGRADE_RESET_METRICS: QuotaMetric[] = [
  "analyze",
  "search",
  "letter",
  "upload",
];

/**
 * Donne le quota complet du nouveau plan après upgrade
 * (analyze + search + letter + upload compteur legacy).
 * Ne s’applique pas aux downgrades ni aux renouvellements mensuels.
 * Produit : import PDF = plafond analyze (l’API upload ne débite plus `upload`).
 */
export async function resetQuotasOnPlanUpgrade(userId: string): Promise<void> {
  await resetUserUsageMetrics(userId, UPGRADE_RESET_METRICS);
}
