import type { ApiResponse, UploadPdfResult } from "@/types";

import { csrfHeaders } from "@/lib/client/csrf";

/** Timeout client — évite spinner infini si le réseau reste ouvert. */
const UPLOAD_TIMEOUT_MS = 120_000;

export async function uploadPdf(
  file: File,
  options?: { signal?: AbortSignal },
): Promise<UploadPdfResult> {
  const formData = new FormData();
  formData.append("file", file);

  const timeout = AbortSignal.timeout(UPLOAD_TIMEOUT_MS);
  const signal = options?.signal
    ? AbortSignal.any([options.signal, timeout])
    : timeout;

  let response: Response;
  try {
    response = await fetch("/api/upload", {
      method: "POST",
      headers: await csrfHeaders(),
      body: formData,
      signal,
      credentials: "same-origin",
    });
  } catch (error) {
    if (
      error instanceof DOMException &&
      (error.name === "AbortError" || error.name === "TimeoutError")
    ) {
      throw new Error(
        "Envoi interrompu ou trop long. Vérifiez la connexion et réessayez.",
      );
    }
    throw new Error(
      "Impossible de joindre le serveur (upload). Vérifiez que l’application tourne, puis réessayez.",
    );
  }

  let payload: ApiResponse<UploadPdfResult>;
  try {
    payload = (await response.json()) as ApiResponse<UploadPdfResult>;
  } catch {
    throw new Error(
      `Réponse invalide à l'upload (${response.status}). Réessayez dans un instant.`,
    );
  }

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}
