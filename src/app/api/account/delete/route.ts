import { apiFromUnknownError, apiSuccess } from "@/lib/api-response";
import { requireUser } from "@/lib/auth";
import { isDeployedEnv } from "@/lib/env-validate";
import { AppError } from "@/lib/errors";
import { createClient } from "@/lib/supabase/server";
import { wipeUserLocalData } from "@/services/account/delete-account";
import { trackAnalyticsEvent } from "@/services/analytics";

export const runtime = "nodejs";

/**
 * POST /api/account/delete
 * Body: { confirm: "DELETE" }
 * Supprime les données locales (+ Stripe / Auth) puis déconnecte.
 * En production : refuse si Auth ne peut pas être effacé (RGPD Art. 17).
 */
export async function POST(request: Request) {
  try {
    const user = await requireUser(request);
    if (user.isEval || user.isLocalDev) {
      throw new AppError(
        "FORBIDDEN",
        "Suppression de compte indisponible pour ce type de session.",
        403,
      );
    }

    if (isDeployedEnv() && !process.env.SUPABASE_SERVICE_ROLE_KEY?.trim()) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Suppression de compte indisponible : configuration serveur incomplète. Contactez le support.",
        503,
      );
    }

    const body = (await request.json().catch(() => ({}))) as {
      confirm?: string;
    };
    if (body.confirm !== "DELETE") {
      throw new AppError(
        "BAD_REQUEST",
        "Confirmez la suppression en tapant DELETE.",
      );
    }

    const result = await wipeUserLocalData(user.id);

    if (isDeployedEnv() && !result.authDeleted) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Échec de la suppression du compte d’authentification. Réessayez ou contactez le support — vos données locales ont pu être partiellement effacées.",
        500,
      );
    }

    // Analytics global — pas de userId stable (Art. 17) ; wipe a déjà anonymisé l’historique.
    await trackAnalyticsEvent({
      name: "account.deleted",
      userId: null,
      idempotencyKey: `account.deleted:${user.id}`,
      meta: {
        source: "account_delete_api",
        authDeleted: Boolean(result.authDeleted),
        deployed: isDeployedEnv(),
      },
    });

    const supabase = await createClient();
    await supabase.auth.signOut();

    return apiSuccess({
      deleted: true,
      ...result,
      message: "Compte et données associés supprimés.",
    });
  } catch (error) {
    return apiFromUnknownError(error);
  }
}
