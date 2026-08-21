import { after } from "next/server";

import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  drainAnalysisJobs,
  getAnalysisJobPublicStatus,
  scheduleAnalysisDrainKick,
} from "@/services/analysis-jobs";

export const runtime = "nodejs";

/**
 * GET /api/analysis-jobs/:jobId
 * Statut durable + position approximative dans la file (pas d’ETA).
 * Le timeout client n’annule pas le job.
 * Si pending/processing : kick drain opportuniste (complète after()+cron).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ jobId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { jobId } = await context.params;
    if (!jobId?.trim()) {
      throw new AppError("BAD_REQUEST", "jobId requis.");
    }
    const status = await getAnalysisJobPublicStatus(jobId.trim(), user.id);
    if (!status) {
      throw new AppError("NOT_FOUND", "Job d’analyse introuvable.", 404);
    }

    if (status.status === "pending" || status.status === "processing") {
      after(async () => {
        // Drain inline : ne dépend pas du cron externe ni du kick HTTP.
        try {
          await drainAnalysisJobs(1);
        } catch (error) {
          console.error(
            "[analysis-jobs] inline drain failed",
            error instanceof Error ? error.message : error,
          );
        }
        scheduleAnalysisDrainKick(1);
      });
    }

    return apiSuccess(status);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
