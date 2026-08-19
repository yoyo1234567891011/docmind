import type { AnalysisJobPublicStatus } from "@/services/analysis-jobs/types";
import type { ApiResponse } from "@/types";

export type AnalysisJobStatusPayload = AnalysisJobPublicStatus;

async function parseJobResponse(
  response: Response,
): Promise<AnalysisJobStatusPayload> {
  let payload: ApiResponse<AnalysisJobStatusPayload>;
  try {
    payload = (await response.json()) as ApiResponse<AnalysisJobStatusPayload>;
  } catch {
    throw new Error(
      `Réponse invalide du serveur (${response.status}) pour le suivi d’analyse.`,
    );
  }
  if (!payload.success) {
    throw new Error(payload.error.message);
  }
  return payload.data;
}

export async function fetchAnalysisJob(
  jobId: string,
  signal?: AbortSignal,
): Promise<AnalysisJobStatusPayload> {
  const response = await fetch(
    `/api/analysis-jobs/${encodeURIComponent(jobId)}`,
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    },
  );
  return parseJobResponse(response);
}

/** Reprise après refresh : job lié à un historyId. */
export async function fetchAnalysisJobByHistory(
  historyId: string,
  signal?: AbortSignal,
): Promise<AnalysisJobStatusPayload> {
  const response = await fetch(
    `/api/analysis-jobs/by-history/${encodeURIComponent(historyId)}`,
    {
      method: "GET",
      credentials: "same-origin",
      cache: "no-store",
      signal,
    },
  );
  return parseJobResponse(response);
}
