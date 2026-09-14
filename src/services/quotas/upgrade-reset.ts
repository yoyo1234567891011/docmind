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
 * (analyze + search + letter + upload).
 * Ne s’applique pas aux downgrades ni aux renouvellements mensuels :
 * l’usage du mois est conservé, la limite = plan effectif actuel.
 */
export async function resetQuotasOnPlanUpgrade(userId: string): Promise<void> {
  await resetUserUsageMetrics(userId, UPGRADE_RESET_METRICS);
}
