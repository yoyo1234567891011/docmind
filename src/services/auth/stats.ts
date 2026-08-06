import { listDocumentAlerts } from "@/services/alerts";
import { listFoldersWithCounts } from "@/services/folders";
import { listHistoryRecords } from "@/services/history";
import { listTags } from "@/services/tags";
import type { UserAccountStats } from "@/types";

export type { UserAccountStats };

/**
 * Statistiques isolées au compte utilisateur courant.
 */
export async function getUserAccountStats(
  userId: string,
): Promise<UserAccountStats> {
  const [records, foldersResult, tags, alertsResult] = await Promise.all([
    listHistoryRecords(userId),
    listFoldersWithCounts(userId),
    listTags(userId),
    listDocumentAlerts(userId, { includeDismissed: false }),
  ]);

  return {
    documents: records.length,
    analyses: records.length,
    alerts: alertsResult.summary.total,
    folders: foldersResult.folders.length,
    tags: tags.length,
    favorites: records.filter((record) => record.favorite).length,
  };
}
