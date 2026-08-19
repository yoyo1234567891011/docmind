import type { QuotaStatusItem } from "@/lib/client/quotas";

/** Ligne courte pour l’UI : « 12 analyses restantes ce mois ». */
export function formatAnalyzeQuotaRemaining(item: QuotaStatusItem): string {
  if (item.unlimited) {
    return `${item.used} analyse${item.used > 1 ? "s" : ""} ce mois`;
  }
  if (item.remaining <= 0) {
    return "0 analyse restante ce mois";
  }
  return `${item.remaining} analyse${item.remaining > 1 ? "s" : ""} restante${item.remaining > 1 ? "s" : ""} ce mois`;
}
