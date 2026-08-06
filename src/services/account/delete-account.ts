import { rm } from "fs/promises";

import { clearUserAnalysisCache } from "@/ai/optimizations/analysis-cache";
import { usePersistentStorage } from "@/config/persistence";
import { userDataDir, userUploadsDir } from "@/config/paths";
import { query } from "@/lib/db/pool";
import { AppError } from "@/lib/errors";
import { getStripe, isStripeConfigured } from "@/lib/stripe";
import { deletePdfObject } from "@/lib/storage/s3";
import { anonymizeAnalyticsForUser } from "@/services/analytics/store";
import { anonymizeAppEventsForUser } from "@/services/beta/app-events";
import { anonymizeErrorReportsForUser } from "@/services/beta/error-reports-store";
import { anonymizeFeedbackForUser } from "@/services/beta/feedback-store";
import { getUserSubscription } from "@/services/billing/store";
import { anonymizeMonitoringForUser } from "@/services/monitoring/store";

async function wipePersistentUserData(userId: string): Promise<{
  dataRemoved: boolean;
  uploadsRemoved: boolean;
}> {
  const tables = [
    `delete from public.app_history where user_id = $1`,
    `delete from public.app_usage where user_id = $1`,
    `delete from public.app_subscriptions where user_id = $1`,
    `delete from public.app_user_blobs where user_id = $1`,
    `delete from public.app_user_files where user_id = $1`,
  ];
  for (const sql of tables) {
    await query(sql, [userId]);
  }

  const docs = await query<{ document_id: string }>(
    `select document_id from public.app_documents where user_id = $1`,
    [userId],
  );
  for (const row of docs.rows) {
    await deletePdfObject(userId, row.document_id);
  }
  await query(`delete from public.app_documents where user_id = $1`, [userId]);
  await clearUserAnalysisCache(userId);

  return { dataRemoved: true, uploadsRemoved: true };
}

/**
 * Efface les données DocMind d’un utilisateur (RGPD Art. 17).
 * Annule l’abonnement Stripe si possible — bloque le wipe si l’annulation échoue.
 * La suppression Auth Supabase nécessite SUPABASE_SERVICE_ROLE_KEY.
 */
export async function wipeUserLocalData(userId: string): Promise<{
  dataRemoved: boolean;
  uploadsRemoved: boolean;
  stripeCanceled: boolean;
  authDeleted: boolean;
}> {
  let stripeCanceled = true;
  let authDeleted = false;

  if (isStripeConfigured()) {
    const sub = await getUserSubscription(userId);
    if (sub.stripeSubscriptionId) {
      stripeCanceled = false;
      try {
        const stripe = getStripe();
        const remote = await stripe.subscriptions.retrieve(
          sub.stripeSubscriptionId,
        );
        if (remote.status === "canceled") {
          stripeCanceled = true;
        } else {
          await stripe.subscriptions.cancel(sub.stripeSubscriptionId);
          stripeCanceled = true;
        }
      } catch {
        throw new AppError(
          "INTERNAL_ERROR",
          "Impossible d’annuler l’abonnement Stripe. La suppression du compte est annulée pour éviter une facturation continue. Réessayez ou contactez le support.",
          502,
        );
      }
    }
  }

  let dataRemoved = false;
  let uploadsRemoved = false;
  const persistent = usePersistentStorage();

  if (persistent) {
    try {
      const wiped = await wipePersistentUserData(userId);
      dataRemoved = wiped.dataRemoved;
      uploadsRemoved = wiped.uploadsRemoved;
    } catch {
      dataRemoved = false;
      uploadsRemoved = false;
    }

    // Résidus FS best-effort — ne doit PAS marquer dataRemoved si le wipe cloud a échoué.
    await rm(userDataDir(userId), { recursive: true, force: true }).catch(
      () => undefined,
    );
    await rm(userUploadsDir(userId), { recursive: true, force: true }).catch(
      () => undefined,
    );

    if (!dataRemoved) {
      throw new AppError(
        "INTERNAL_ERROR",
        "Échec de la suppression des données cloud (base / stockage). Le compte Auth n’a pas été supprimé. Réessayez ou contactez le support.",
        500,
      );
    }
  } else {
    try {
      await rm(userDataDir(userId), { recursive: true, force: true });
      dataRemoved = true;
    } catch {
      dataRemoved = false;
    }
    try {
      await rm(userUploadsDir(userId), { recursive: true, force: true });
      uploadsRemoved = true;
    } catch {
      uploadsRemoved = false;
    }
    await clearUserAnalysisCache(userId).catch(() => undefined);
  }

  try {
    await anonymizeAnalyticsForUser(userId);
    await anonymizeFeedbackForUser(userId);
    await anonymizeErrorReportsForUser(userId);
    await anonymizeAppEventsForUser(userId);
    await anonymizeMonitoringForUser(userId);
  } catch {
    throw new AppError(
      "INTERNAL_ERROR",
      "Échec de l’anonymisation des données opérationnelles (analytics / feedback / monitoring). La suppression Auth est annulée. Réessayez ou contactez le support.",
      500,
    );
  }

  const serviceKey = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  const supabaseUrl = process.env.NEXT_PUBLIC_SUPABASE_URL?.trim();
  if (serviceKey && supabaseUrl) {
    try {
      const { createClient } = await import("@supabase/supabase-js");
      const admin = createClient(supabaseUrl, serviceKey, {
        auth: { persistSession: false, autoRefreshToken: false },
      });
      const { error } = await admin.auth.admin.deleteUser(userId);
      authDeleted = !error;
    } catch {
      authDeleted = false;
    }
  }

  return { dataRemoved, uploadsRemoved, stripeCanceled, authDeleted };
}
