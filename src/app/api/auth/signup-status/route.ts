import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { getSignupAvailability } from "@/services/auth/signup-limit";

export const runtime = "nodejs";

/**
 * GET /api/auth/signup-status — capacité d’inscription (public).
 */
export async function GET() {
  try {
    const availability = await getSignupAvailability();
    return apiSuccess(availability);
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
