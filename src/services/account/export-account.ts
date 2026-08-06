import { access, readFile } from "fs/promises";

import { usePersistentStorage } from "@/config/persistence";
import { AppError } from "@/lib/errors";
import { buildZipBuffer } from "@/lib/zip";
import { getPdfObject } from "@/lib/storage/s3";
import { listDocumentAlerts } from "@/services/alerts";
import { readAlertsState } from "@/services/alerts/state";
import { getUserSubscription } from "@/services/billing/store";
import { listFolders } from "@/services/folders";
import {
  getUserPdfAbsolutePath,
  listHistoryRecords,
} from "@/services/history";
import { readAnalysisLogs } from "@/services/logs";
import { readNotificationPreferences } from "@/services/notifications/preferences";
import { listPendingOutbox } from "@/services/notifications/outbox";
import { getQuotaStatus } from "@/services/quotas/enforce";
import { listTags } from "@/services/tags";
import {
  listClausesForDoc,
  listDeadlinesForDoc,
  listEntities,
  listRelationsForDoc,
} from "@/services/memory";
import { getMemoryDocument } from "@/services/memory/document-store";

async function loadExportPdf(
  userId: string,
  documentId: string,
): Promise<Buffer | null> {
  if (usePersistentStorage()) {
    try {
      return await getPdfObject(userId, documentId);
    } catch (error) {
      // PDF absent = omis ; panne S3 = échec export (pas de ZIP incomplet silencieux)
      if (error instanceof AppError && error.status === 404) return null;
      throw error;
    }
  }
  try {
    const pdfPath = getUserPdfAbsolutePath(userId, documentId);
    await access(pdfPath);
    return await readFile(pdfPath);
  } catch {
    return null;
  }
}

export async function buildUserDataExportZip(userId: string): Promise<{
  buffer: Buffer;
  fileName: string;
  entryCount: number;
}> {
  const [
    history,
    folders,
    tags,
    alertsState,
    alerts,
    prefs,
    outbox,
    subscription,
    logs,
    quotas,
    entities,
  ] = await Promise.all([
    listHistoryRecords(userId),
    listFolders(userId),
    listTags(userId),
    readAlertsState(userId),
    listDocumentAlerts(userId).catch(() => null),
    readNotificationPreferences(userId),
    listPendingOutbox(userId).catch(() => []),
    getUserSubscription(userId),
    readAnalysisLogs(userId).catch(() => ({ entries: [] })),
    getQuotaStatus(userId),
    listEntities(userId).catch(() => []),
  ]);

  const exportedAt = new Date().toISOString();
  const entries: Array<{ path: string; data: Buffer | string }> = [
    {
      path: "manifest.json",
      data: JSON.stringify(
        {
          schema: "docmind-export-v1",
          userId,
          exportedAt,
          article: "RGPD Art. 20 — portabilité",
          counts: {
            history: history.length,
            folders: folders.length,
            tags: tags.length,
            alerts: alerts?.alerts?.length ?? 0,
          },
        },
        null,
        2,
      ),
    },
    {
      path: "account/subscription.json",
      data: JSON.stringify(subscription, null, 2),
    },
    {
      path: "account/quotas.json",
      data: JSON.stringify(quotas, null, 2),
    },
    {
      path: "account/notification-preferences.json",
      data: JSON.stringify(prefs, null, 2),
    },
    {
      path: "account/notification-outbox.json",
      data: JSON.stringify(outbox, null, 2),
    },
    {
      path: "library/folders.json",
      data: JSON.stringify(folders, null, 2),
    },
    {
      path: "library/tags.json",
      data: JSON.stringify(tags, null, 2),
    },
    {
      path: "alerts/state.json",
      data: JSON.stringify(alertsState, null, 2),
    },
    {
      path: "alerts/current.json",
      data: JSON.stringify(alerts, null, 2),
    },
    {
      path: "logs/analysis-logs.json",
      data: JSON.stringify(logs, null, 2),
    },
    {
      path: "memory/entities.json",
      data: JSON.stringify(entities, null, 2),
    },
  ];

  for (const record of history) {
    const docId = record.documentId;
    const [clauses, deadlines, relations, memDoc] = await Promise.all([
      listClausesForDoc(userId, docId).catch(() => []),
      listDeadlinesForDoc(userId, docId).catch(() => []),
      listRelationsForDoc(userId, docId).catch(() => []),
      getMemoryDocument(userId, docId).catch(() => null),
    ]);
    if (memDoc) {
      entries.push({
        path: `memory/documents/${docId}.json`,
        data: JSON.stringify(memDoc, null, 2),
      });
    }
    if (clauses.length) {
      entries.push({
        path: `memory/clauses/${docId}.json`,
        data: JSON.stringify(clauses, null, 2),
      });
    }
    if (deadlines.length) {
      entries.push({
        path: `memory/deadlines/${docId}.json`,
        data: JSON.stringify(deadlines, null, 2),
      });
    }
    if (relations.length) {
      entries.push({
        path: `memory/relations/${docId}.json`,
        data: JSON.stringify(relations, null, 2),
      });
    }
  }

  for (const record of history) {
    entries.push({
      path: `history/${record.id}.json`,
      data: JSON.stringify(record, null, 2),
    });
    const pdf = await loadExportPdf(userId, record.documentId);
    if (!pdf) continue;
    const safeName = (record.fileName || `${record.documentId}.pdf`).replace(
      /[^\w.\- ()]+/g,
      "_",
    );
    entries.push({
      path: `pdfs/${record.documentId}_${safeName}`,
      data: pdf,
    });
  }

  const buffer = await buildZipBuffer(entries);
  const stamp = exportedAt.replace(/[:.]/g, "-");
  return {
    buffer,
    fileName: `docmind-export-${userId.slice(0, 8)}-${stamp}.zip`,
    entryCount: entries.length,
  };
}
