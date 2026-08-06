import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { AppError } from "@/lib/errors";
import {
  buildFinanceInsight,
  buildMemoryDigest,
  buildPremiumMemoryDashboard,
  listRelationLetterIntents,
  listSavingsOpportunities,
  listSubscriptionInsights,
} from "@/services/insights";
import { buildEntityTimeline } from "@/services/memory/timeline";

export const runtime = "nodejs";

/**
 * GET /api/insights?view=overview|subscriptions|finance|savings|digest|letters|timeline
 * digest: &period=week|month
 * timeline: &entityId=
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const { searchParams } = new URL(request.url);
    const view = searchParams.get("view") || "overview";
    const period =
      searchParams.get("period") === "month" ? "month" : "week";
    const entityId = searchParams.get("entityId");

    switch (view) {
      case "overview":
        return apiSuccess(await buildPremiumMemoryDashboard(user.id));
      case "subscriptions":
        return apiSuccess({
          subscriptions: await listSubscriptionInsights(user.id),
        });
      case "finance":
        return apiSuccess(await buildFinanceInsight(user.id));
      case "savings":
        return apiSuccess({
          savings: await listSavingsOpportunities(user.id),
        });
      case "digest":
        return apiSuccess(await buildMemoryDigest(user.id, period));
      case "letters":
        return apiSuccess({
          intents: await listRelationLetterIntents(user.id),
        });
      case "timeline": {
        if (!entityId) {
          throw new AppError(
          "BAD_REQUEST",
          "entityId requis pour view=timeline.",
          400,
        );
        }
        const events = await buildEntityTimeline(user.id, entityId, {
          limit: 100,
        });
        return apiSuccess({ entityId, events });
      }
      default:
        throw new AppError(
          "BAD_REQUEST",
          "view inconnu (overview|subscriptions|finance|savings|digest|letters|timeline).",
          400,
        );
    }
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
