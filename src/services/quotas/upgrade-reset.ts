import type { QuotaMetric } from "@/config/quotas";
import { resetUserUsageMetrics } from "@/services/quotas/store";

/** Compteurs remis à 0 lors d’un upgrade de palier (analyze + search). */
const UPGRADE_RESET_METRICS: QuotaMetric[] = ["analyze", "search"];

/**
 * Donne le quota complet du nouveau plan après upgrade.
 * Ne s’applique pas aux downgrades ni aux renouvellements mensuels.
 */
export async function resetQuotasOnPlanUpgrade(userId: string): Promise<void> {
  await resetUserUsageMetrics(userId, UPGRADE_RESET_METRICS);
}
