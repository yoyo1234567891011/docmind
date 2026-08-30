import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { parseCheckoutPlan } from "@/services/billing/checkout";
import { previewPlanChange } from "@/services/billing/plan-change-preview";

export const runtime = "nodejs";

/**
 * GET /api/billing/plan-change-preview?plan=extra
 * Estimation du prélèvement immédiat avant changement de plan payant.
 */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const url = new URL(request.url);
    const plan = parseCheckoutPlan(url.searchParams.get("plan"));
    if (!plan) {
      throw new Error("Plan invalide");
    }
    const preview = await previewPlanChange(user.id, plan);
    return apiSuccess(preview);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
