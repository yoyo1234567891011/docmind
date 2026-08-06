import type { AnalyzeDocumentResult, ApiResponse } from "@/types";

import { csrfHeaders } from "@/lib/client/csrf";

/** Progressive (P1) doit répondre vite ; full peut aller jusqu’à ~5 min. */
const ANALYZE_TIMEOUT_MS: Record<"full" | "progressive", number> = {
  progressive: 180_000,
  full: 300_000,
};

export async function analyzeDocument(
  documentId: string,
  text: string,
  fileName?: string,
  pages?: string[],
  options?: {
    /** progressive = résumé immédiat + analyse complète en arrière-plan */
    mode?: "full" | "progressive";
    skipReadyReply?: boolean;
    signal?: AbortSignal;
  },
): Promise<AnalyzeDocumentResult> {
  const mode = options?.mode ?? "progressive";
  const timeout = AbortSignal.timeout(ANALYZE_TIMEOUT_MS[mode]);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch("/api/analyze", {
      method: "POST",
      headers: await csrfHeaders({
        "Content-Type": "application/json",
      }),
      body: JSON.stringify({
        documentId,
        text,
        fileName,
        pages,
        skipReadyReply: options?.skipReadyReply ?? true,
        mode,
      }),
      signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error(
        "L’analyse a été interrompue ou a trop tardé. Réessayez — l’aperçu local peut déjà être disponible après un nouvel essai.",
      );
    }
    throw new Error(
      "Connexion perdue avec le serveur. Vérifiez que l’application tourne, puis réessayez.",
    );
  }

  let payload: ApiResponse<AnalyzeDocumentResult>;
  try {
    payload = (await response.json()) as ApiResponse<AnalyzeDocumentResult>;
  } catch {
    throw new Error(
      `Réponse invalide du serveur (${response.status}). Réessayez dans un instant.`,
    );
  }

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}
