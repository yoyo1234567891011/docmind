import { after } from "next/server";

import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  drainAnalysisJobs,
  findAnalysisJobByHistoryId,
  getAnalysisJobPublicStatus,
  scheduleAnalysisDrainKick,
} from "@/services/analysis-jobs";

export const runtime = "nodejs";

/**
 * GET /api/analysis-jobs/by-history/:historyId
 * Retrouve le job lié à un historyId (refresh / historique).
 */
export async function GET(
  request: Request,
  context: { params: Promise<{ historyId: string }> },
) {
  try {
    const user = await requireUser(request);
    const { historyId } = await context.params;
    if (!historyId?.trim()) {
      throw new AppError("BAD_REQUEST", "historyId requis.");
    }
    const job = await findAnalysisJobByHistoryId({
      userId: user.id,
      historyId: historyId.trim(),
    });
    if (!job) {
      throw new AppError("NOT_FOUND", "Aucun job pour cet historique.", 404);
    }
    const status = await getAnalysisJobPublicStatus(job.id, user.id);
    if (!status) {
      throw new AppError("NOT_FOUND", "Job d’analyse introuvable.", 404);
    }
    if (status.status === "pending" || status.status === "processing") {
      after(async () => {
        try {
          await drainAnalysisJobs(1);
        } catch (error) {
          console.error(
            "[analysis-jobs] inline drain by-history failed",
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
