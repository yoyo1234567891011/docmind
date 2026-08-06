import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireAdmin } from "@/lib/auth";
import { getRateLimitMetrics, cleanupRateLimitState } from "@/lib/rate-limit";
import { isRedisConfigured } from "@/lib/redis";
import { runMonitoringCheck } from "@/services/monitoring/collect";
import {
  listMonitoringAlerts,
  readMonitoringSnapshot,
} from "@/services/monitoring/store";

export const runtime = "nodejs";

/** GET /api/admin/monitoring — snapshot + alertes (admin). */
export async function GET(request: Request) {
  try {
    await requireAdmin(request);
    cleanupRateLimitState();
    const snapshot =
      (await readMonitoringSnapshot()) ??
      (await runMonitoringCheck()).snapshot;
    const alerts = await listMonitoringAlerts();
    return apiSuccess({
      snapshot,
      alerts: alerts.slice(-50).reverse(),
      rateLimit: {
        redisConfigured: isRedisConfigured(),
        ...getRateLimitMetrics(),
      },
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/** POST /api/admin/monitoring — force un check + alertes. */
export async function POST(request: Request) {
  try {
    await requireAdmin(request);
    cleanupRateLimitState();
    const result = await runMonitoringCheck();
    const alerts = await listMonitoringAlerts();
    return apiSuccess({
      ...result,
      alerts: alerts.slice(-50).reverse(),
      rateLimit: {
        redisConfigured: isRedisConfigured(),
        ...getRateLimitMetrics(),
      },
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
