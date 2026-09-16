import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  listAdminAnalysisJobs,
  retryAdminAnalysisJob,
} from "@/services/admin/jobs-admin";
import { appendAdminActionLog } from "@/services/admin/ops-status";
import { ANALYSIS_JOB_STATUSES } from "@/services/analysis-jobs/types";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/** GET /api/admin/jobs?status=&userId=&limit= */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    const url = new URL(request.url);
    const statusRaw = url.searchParams.get("status") ?? "all";
    const userId = url.searchParams.get("userId")?.trim() || undefined;
    const limit = Number(url.searchParams.get("limit") ?? "50");

    const allowed = new Set([
      "all",
      "stuck",
      ...ANALYSIS_JOB_STATUSES,
    ]);
    if (!allowed.has(statusRaw)) {
      throw new AppError("BAD_REQUEST", "status invalide");
    }

    const data = await listAdminAnalysisJobs({
      status: statusRaw as
        | "all"
        | "stuck"
        | (typeof ANALYSIS_JOB_STATUSES)[number],
      userId,
      limit: Number.isFinite(limit) ? limit : 50,
    });
    return apiSuccess(data);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/** POST /api/admin/jobs — { action: "retry", jobId } */
export async function POST(request: Request) {
  try {
    const admin = await requireAdmin(request);
    const body = (await request.json()) as {
      action?: unknown;
      jobId?: unknown;
    };
    if (body.action !== "retry") {
      throw new AppError("BAD_REQUEST", "action doit être retry");
    }
    if (typeof body.jobId !== "string" || !body.jobId.trim()) {
      throw new AppError("BAD_REQUEST", "jobId requis");
    }
    const job = await retryAdminAnalysisJob(body.jobId.trim());
    await appendAdminActionLog({
      action: "job_retry",
      adminUserId: admin.id,
      targetUserId: job.userId,
      targetEmail: job.userEmail,
      ok: true,
      detail: `jobId=${job.id}`,
    });
    return apiSuccess({ job });
  } catch (error) {
    if (error instanceof Error && !(error instanceof AppError)) {
      return apiFromUnknownError(
        new AppError("BAD_REQUEST", error.message.slice(0, 300)),
      );
    }
    return apiFromUnknownError(error);
  }
}
