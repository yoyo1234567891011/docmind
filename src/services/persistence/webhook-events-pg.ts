import { query } from "@/lib/db/pool";
import { usePersistentStorage } from "@/config/persistence";

/**
 * Idempotence webhook Stripe — insert-only.
 * @returns true si l’événement est nouveau (à marquer traité)
 */
export async function claimStripeWebhookEvent(
  eventId: string,
  eventType: string,
): Promise<boolean> {
  if (!usePersistentStorage()) {
    // FS mode : table absente — pas de dédup durable (dev)
    return true;
  }
  const result = await query(
    `insert into public.stripe_webhook_events (event_id, event_type)
     values ($1, $2)
     on conflict (event_id) do nothing
     returning event_id`,
    [eventId, eventType],
  );
  return (result.rowCount ?? 0) > 0;
}

/** True si l’événement a déjà été marqué traité. */
export async function isStripeWebhookEventClaimed(
  eventId: string,
): Promise<boolean> {
  if (!usePersistentStorage()) return false;
  const result = await query(
    `select 1 from public.stripe_webhook_events where event_id = $1 limit 1`,
    [eventId],
  );
  return (result.rowCount ?? 0) > 0;
}

/** Libère le claim si le traitement échoue (permet retry Stripe). */
export async function releaseStripeWebhookEvent(eventId: string): Promise<void> {
  if (!usePersistentStorage()) return;
  await query(`delete from public.stripe_webhook_events where event_id = $1`, [
    eventId,
  ]);
}
