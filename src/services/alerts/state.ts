import { createHash } from "crypto";

import {
  isFsDualWriteEnabled,
  isFsFallbackEnabled,
  usePersistentStorage,
} from "@/config/persistence";
import { userAlertsStateFile } from "@/config/paths";
import {
  pgGetUserBlob,
  pgSaveUserBlob,
} from "@/services/persistence/user-blobs-pg";
import { userFileRead, userFileWrite } from "@/lib/user-files";
import type { AlertsStateFile, DocumentAlert } from "@/types";

const EMPTY_STATE: AlertsStateFile = {
  readIds: [],
  dismissedIds: [],
  updatedAt: new Date(0).toISOString(),
};

const ALERTS_BLOB_KEY = "alerts-state";

function normalizeState(parsed: AlertsStateFile): AlertsStateFile {
  return {
    readIds: Array.isArray(parsed.readIds) ? parsed.readIds : [],
    dismissedIds: Array.isArray(parsed.dismissedIds)
      ? parsed.dismissedIds
      : [],
    pinnedAlerts: Array.isArray(parsed.pinnedAlerts)
      ? parsed.pinnedAlerts
      : [],
    updatedAt: parsed.updatedAt || EMPTY_STATE.updatedAt,
  };
}

async function readFromFs(userId: string): Promise<AlertsStateFile | null> {
  const content = await userFileRead(userId, userAlertsStateFile(userId));
  // userFileRead already promotes when persistent — but alerts use blob key.
  // For FS-only path under userDataDir/alerts-state.json we need raw FS when
  // blob miss. When not persistent, userFileRead hits FS directly.
  if (!content) return null;
  try {
    return normalizeState(JSON.parse(content) as AlertsStateFile);
  } catch {
    return null;
  }
}

export async function readAlertsState(
  userId: string,
): Promise<AlertsStateFile> {
  try {
    if (usePersistentStorage()) {
      const parsed = await pgGetUserBlob<AlertsStateFile>(
        userId,
        ALERTS_BLOB_KEY,
      );
      if (parsed) return normalizeState(parsed);

      if (isFsFallbackEnabled()) {
        // Lecture FS directe (pas via userFileRead → éviter double couche PG files)
        const { readFile } = await import("fs/promises");
        try {
          const raw = await readFile(userAlertsStateFile(userId), "utf8");
          const fromFs = normalizeState(JSON.parse(raw) as AlertsStateFile);
          await pgSaveUserBlob(userId, ALERTS_BLOB_KEY, fromFs).catch(
            () => undefined,
          );
          return fromFs;
        } catch {
          /* miss */
        }
      }
      return { ...EMPTY_STATE, pinnedAlerts: [] };
    }

    const fromFs = await readFromFs(userId);
    return fromFs ?? { ...EMPTY_STATE, pinnedAlerts: [] };
  } catch {
    return { ...EMPTY_STATE, pinnedAlerts: [] };
  }
}

async function writeAlertsState(
  userId: string,
  state: AlertsStateFile,
): Promise<void> {
  const next = { ...state, updatedAt: new Date().toISOString() };
  if (usePersistentStorage()) {
    await pgSaveUserBlob(userId, ALERTS_BLOB_KEY, next);
    if (isFsDualWriteEnabled()) {
      await userFileWrite(
        userId,
        userAlertsStateFile(userId),
        JSON.stringify(next, null, 2),
      ).catch(() => undefined);
    }
    return;
  }
  await userFileWrite(
    userId,
    userAlertsStateFile(userId),
    JSON.stringify(next, null, 2),
  );
}

export async function markAlertsRead(
  userId: string,
  ids: string[],
): Promise<AlertsStateFile> {
  const state = await readAlertsState(userId);
  const next = new Set([...state.readIds, ...ids]);
  const updated = {
    ...state,
    readIds: [...next],
  };
  await writeAlertsState(userId, updated);
  return updated;
}

export async function markAlertsDismissed(
  userId: string,
  ids: string[],
): Promise<AlertsStateFile> {
  const state = await readAlertsState(userId);
  const dismissed = new Set([...state.dismissedIds, ...ids]);
  const read = new Set([...state.readIds, ...ids]);
  const updated = {
    ...state,
    dismissedIds: [...dismissed],
    readIds: [...read],
  };
  await writeAlertsState(userId, updated);
  return updated;
}

export async function markAllAlertsRead(
  userId: string,
  alertIds: string[],
): Promise<AlertsStateFile> {
  return markAlertsRead(userId, alertIds);
}

/**
 * Épingle une alerte ponctuelle (ex. analyse complète prête).
 * Remplace une éventuelle entrée du même id.
 */
export async function pinAlert(
  userId: string,
  alert: DocumentAlert,
): Promise<void> {
  const state = await readAlertsState(userId);
  const pinned = (state.pinnedAlerts ?? []).filter((item) => item.id !== alert.id);
  pinned.unshift({ ...alert, read: false, dismissed: false });
  await writeAlertsState(userId, {
    ...state,
    pinnedAlerts: pinned.slice(0, 50),
  });
}

/**
 * Retire les alertes épinglées liées à une analyse (et l’id « analysis ready »).
 */
export async function removeAlertsLinkedToHistory(
  userId: string,
  historyId: string,
): Promise<void> {
  const state = await readAlertsState(userId);
  const readyId = `analysis-ready-${historyId}`;
  const pinned = (state.pinnedAlerts ?? []).filter(
    (alert) =>
      alert.historyId !== historyId &&
      alert.secondaryHistoryId !== historyId &&
      alert.id !== readyId,
  );
  const readIds = state.readIds.filter((id) => id !== readyId);
  const dismissedIds = state.dismissedIds.filter((id) => id !== readyId);

  if (
    pinned.length === (state.pinnedAlerts ?? []).length &&
    readIds.length === state.readIds.length &&
    dismissedIds.length === state.dismissedIds.length
  ) {
    return;
  }

  await writeAlertsState(userId, {
    ...state,
    pinnedAlerts: pinned,
    readIds,
    dismissedIds,
  });
}

/** Stable id so the same detection stays consistent across regenerations */
export function buildAlertId(
  historyId: string,
  kind: string,
  fingerprint: string,
): string {
  const hash = createHash("sha1")
    .update(`${historyId}:${kind}:${fingerprint}`)
    .digest("hex")
    .slice(0, 12);
  return `alert_${kind}_${hash}`;
}
