import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { assertCronAuthorized } from "@/lib/cron-auth";
import { AppError } from "@/lib/errors";
import {
  drainAnalysisJobs,
  getAnalysisJobStats,
} from "@/services/analysis-jobs";

export const runtime = "nodejs";
/** Hobby Vercel ≤ 300s ; Pro peut remonter à 480. */
export const maxDuration = 300;

/**
 * POST /api/cron/drain-analysis-jobs
 * Watchdog file d’analyse — indépendant du trafic UI / after().
 * Auth : Authorization: Bearer $CRON_SECRET (Vercel Cron envoie GET + Bearer)
 */
async function handleDrain(request: Request) {
  assertCronAuthorized(request);

  let maxJobs = 3;
  try {
    const body = (await request.json()) as { maxJobs?: unknown };
    if (typeof body.maxJobs === "number" && Number.isFinite(body.maxJobs)) {
      maxJobs = Math.max(1, Math.min(10, Math.floor(body.maxJobs)));
    }
  } catch {
    // body optionnel (GET Vercel Cron n'a pas de body)
  }

  const before = await getAnalysisJobStats();
  const processed = await drainAnalysisJobs(maxJobs);
  const after = await getAnalysisJobStats();

  return apiSuccess({
    processed,
    maxJobs,
    before,
    after,
  });
}

export async function POST(request: Request) {
  try {
    return await handleDrain(request);
  } catch (error) {
    // Auth déjà passée : exposer le message pour ops (sinon INTERNAL_ERROR opaque).
    if (!(error instanceof AppError) && error instanceof Error) {
      console.error("[cron/drain-analysis-jobs]", error.message);
      return apiFromUnknownError(
        new AppError(
          "INTERNAL_ERROR",
          error.message.slice(0, 400),
          500,
        ),
      );
    }
    return apiFromUnknownError(error);
  }
}

/** Vercel Cron invoque GET (Bearer CRON_SECRET automatique si env défini). */
export async function GET(request: Request) {
  return POST(request);
}
