import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { getOptionalUser } from "@/lib/auth";
import { getPublicRuntimeInfo } from "@/config/runtime";
import { getUserAccountStats } from "@/services/auth/stats";
import { ensureUserWorkspace } from "@/services/auth/workspace";

export const runtime = "nodejs";

function isAdminEmail(email: string | null | undefined): boolean {
  if (!email) return false;
  const allowed = (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
  return allowed.includes(email.trim().toLowerCase());
}

/**
 * Session + statistiques isolées du compte (documents, analyses, alertes…).
 */
export async function GET() {
  try {
    const user = await getOptionalUser();
    const runtime = getPublicRuntimeInfo();

    if (!user) {
      return apiSuccess({
        user: null,
        stats: null,
        runtime,
      });
    }

    await ensureUserWorkspace(user.id).catch(() => undefined);
    const stats = await getUserAccountStats(user.id).catch(() => null);

    return apiSuccess({
      user: {
        id: user.id,
        email: user.email,
        isLocalDev: Boolean(user.isLocalDev),
        isAdmin: Boolean(user.isLocalDev) || isAdminEmail(user.email),
      },
      stats,
      runtime,
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
