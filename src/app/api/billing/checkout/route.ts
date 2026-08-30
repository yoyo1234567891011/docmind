import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  createPlanCheckoutSession,
  parseCheckoutPlan,
} from "@/services/billing/checkout";

export const runtime = "nodejs";

/**
 * POST /api/billing/checkout — session Stripe Checkout pour un plan payant.
 * Body JSON optionnel : { "plan": "basique" | "pro" | "premium" | "extra" }
 * Défaut : pro (offre mise en avant).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    let plan = parseCheckoutPlan("pro");
    try {
      const body = (await request.json()) as { plan?: unknown };
      const parsed = parseCheckoutPlan(body?.plan);
      if (parsed) plan = parsed;
    } catch {
      // body vide → pro
    }
    if (!plan) {
      throw new Error("Plan invalide");
    }
    const session = await createPlanCheckoutSession({
      userId: user.id,
      email: user.email,
      plan,
    });
    if (session.mode === "changed") {
      return apiSuccess({
        changed: true as const,
        plan: session.plan,
        immediateInvoice: session.immediateInvoice,
      });
    }
    return apiSuccess({ url: session.url });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
