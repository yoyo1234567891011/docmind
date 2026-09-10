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

/** Ligne courte pour l’UI : « 8 courriers restants ce mois ». */
export function formatLetterQuotaRemaining(item: QuotaStatusItem): string {
  if (item.unlimited) {
    return `${item.used} courrier${item.used > 1 ? "s" : ""} ce mois`;
  }
  if (item.remaining <= 0) {
    return "0 courrier restant ce mois";
  }
  return `${item.remaining} courrier${item.remaining > 1 ? "s" : ""} restant${item.remaining > 1 ? "s" : ""} ce mois`;
}

/** Ligne courte pour l’UI : « 3 recherches restantes ce mois ». */
export function formatSearchQuotaRemaining(item: QuotaStatusItem): string {
  if (item.unlimited) {
    return `${item.used} recherche${item.used > 1 ? "s" : ""} ce mois`;
  }
  if (item.remaining <= 0) {
    return "0 recherche restante ce mois";
  }
  return `${item.remaining} recherche${item.remaining > 1 ? "s" : ""} restante${item.remaining > 1 ? "s" : ""} ce mois`;
}
