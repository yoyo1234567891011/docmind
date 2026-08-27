/**
 * Messages UI — file d’analyse (bêta).
 * P1 = aperçu local rapide ; P2 = génération IA (souvent 1 à 3 minutes).
 */
import { ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE } from "@/lib/sanitize";

export function analysisJobStatusTitle(
  status: "pending" | "processing" | "unknown" = "unknown",
): string {
  if (status === "pending") return "Analyse en cours…";
  if (status === "processing") return "Analyse en cours…";
  return "Analyse en cours…";
}

export function analysisJobStatusBody(): string {
  return "Cela peut prendre 1 à 3 minutes. L’aperçu ci-dessous reste disponible pendant le traitement. Fermer l’onglet n’annule pas l’analyse — vous pourrez la retrouver dans l’historique.";
}

export function analysisJobQueuePositionLine(position: number): string {
  const prochain = position === 1 ? " (prochain)" : "";
  return `Position dans la file : ${position}${prochain}.`;
}

export function analysisJobProcessingHint(): string {
  return "L’IA lit encore le document — merci de patienter, ce n’est pas bloqué.";
}

/** Job remis en file après saturation Groq (pas un échec). */
export function analysisJobSaturationWaitHint(): string {
  return "Le service d’analyse est temporairement saturé. Votre document reste en file — nouvelle tentative automatique sous peu.";
}

export function isAnalysisJobSaturationHint(lastError?: string | null): boolean {
  if (!lastError?.trim()) return false;
  return /satur|file d['’]attente|limite de débit|rate.?limit|TPM/i.test(
    lastError,
  );
}

export function analysisJobPollTimeoutMessage(): string {
  return "Le suivi à l’écran s’est arrêté, mais l’analyse continue côté serveur. Rouvrez ce document depuis l’historique dans quelques minutes — l’aperçu reste disponible.";
}

/** Job en retry saturation ou dépassement habituel — rassurer sans masquer l’échec. */
export function analysisJobLongWaitHint(attempts: number): string | null {
  if (attempts >= 2) {
    return "Le service IA est saturé — nouvelle tentative automatique en cours. Si le délai de 3 minutes est dépassé, l’analyse s’arrêtera avec un message clair.";
  }
  return null;
}

/** Message d’échec définitif après saturation TPM ou timeout job. */
export function analysisJobSaturationFailMessage(): string {
  return ANALYSIS_SATURATION_OR_TIMEOUT_MESSAGE;
}

/** Message pendant l’appel initial (P1 / démarrage P2). */
export function analysisLoadingShortMessage(): string {
  return "Analyse en cours… Cela peut prendre 1 à 3 minutes.";
}
