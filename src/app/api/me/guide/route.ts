import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { hasSeenGuide, markGuideSeen } from "@/services/onboarding/guide";

export const runtime = "nodejs";

/** Statut « guide déjà vu » pour le compte connecté. */
export async function GET(request: Request) {
  try {
    const user = await requireUser(request);
    const guideSeen = await hasSeenGuide(user.id);
    return apiSuccess({ guideSeen });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}

/** Marque le guide comme vu (bouton « Commencer »). */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    await markGuideSeen(user.id);
    return apiSuccess({ guideSeen: true });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
