import { usePersistentStorage } from "@/config/persistence";
import {
  pgGetUserBlob,
  pgSaveUserBlob,
} from "@/services/persistence/user-blobs-pg";

const PRESENCE_KEY = "presence";
/** Throttle écriture last_seen (≥ 60s / user). */
export const LAST_SEEN_THROTTLE_MS = 60_000;

export type UserPresenceBlob = {
  lastSeenAt: string;
};

/**
 * Best-effort last_seen (PG blobs). No-op hors persistent / erreurs.
 * Throttle 60s pour éviter un write à chaque /api/me.
 */
export async function touchUserLastSeen(userId: string): Promise<void> {
  if (!userId || !usePersistentStorage()) return;
  try {
    const prev = await pgGetUserBlob<UserPresenceBlob>(userId, PRESENCE_KEY);
    const lastMs = prev?.lastSeenAt ? Date.parse(prev.lastSeenAt) : 0;
    if (Number.isFinite(lastMs) && Date.now() - lastMs < LAST_SEEN_THROTTLE_MS) {
      return;
    }
    await pgSaveUserBlob(userId, PRESENCE_KEY, {
      lastSeenAt: new Date().toISOString(),
    } satisfies UserPresenceBlob);
  } catch {
    /* fail-open */
  }
}
