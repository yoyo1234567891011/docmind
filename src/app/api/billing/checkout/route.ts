import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import {
  createPlanCheckoutSession,
  parseCheckoutPlan,
} from "@/services/billing/checkout";

export const runtime = "nodejs";

/**
 * POST /api/billing/checkout — session Stripe Checkout pour un plan payant.
 * Body JSON : { "plan": "basique" | "pro" | "premium" | "extra",
 *   "acceptedImmediateExecution": true } — case CGV/rétractation obligatoire
 * pour un nouveau Checkout (Free → payant). Défaut plan : pro.
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    let plan = parseCheckoutPlan("pro");
    let acceptedImmediateExecution = false;
    try {
      const body = (await request.json()) as {
        plan?: unknown;
        acceptedImmediateExecution?: unknown;
      };
      const parsed = parseCheckoutPlan(body?.plan);
      if (parsed) plan = parsed;
      acceptedImmediateExecution = body?.acceptedImmediateExecution === true;
    } catch {
      // body vide → pro, sans consent (rejeté si nouveau Checkout)
    }
    if (!plan) {
      throw new Error("Plan invalide");
    }
    const session = await createPlanCheckoutSession({
      userId: user.id,
      email: user.email,
      plan,
      acceptedImmediateExecution,
    });
    if (session.mode === "changed") {
      return apiSuccess({
        changed: true as const,
        plan: session.plan,
        immediateInvoice: session.immediateInvoice,
      });
    }
    if (session.mode === "scheduled") {
      return apiSuccess({
        scheduled: true as const,
        currentPlan: session.currentPlan,
        pendingPlan: session.pendingPlan,
        effectiveAt: session.effectiveAt,
      });
    }
    return apiSuccess({ url: session.url });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
