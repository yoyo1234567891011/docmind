import { randomUUID } from "crypto";
import path from "path";

import { userDeadlinesDir } from "@/config/paths";
import { userFileList } from "@/lib/user-files";
import {
  listDeadlinesForDoc,
  saveDeadlinesForDoc,
} from "@/services/memory/deadline-store";
import type { MemoryDeadline } from "@/types/memory";

const WINDOW_DAYS = 7;

function parseDay(iso: string): number | null {
  const t = Date.parse(`${iso}T12:00:00.000Z`);
  return Number.isFinite(t) ? t : null;
}

/**
 * Assigne cluster_id aux échéances du document + voisines (±7 j).
 * Incrémental — charge au plus ~80 autres fichiers deadlines.
 */
export async function assignDeadlineClustersForDoc(
  userId: string,
  documentId: string,
): Promise<{ clustersTouched: number; deadlinesUpdated: number }> {
  const mine = await listDeadlinesForDoc(userId, documentId);
  if (mine.length === 0) return { clustersTouched: 0, deadlinesUpdated: 0 };

  let otherFiles: string[] = [];
  try {
    otherFiles = (await userFileList(userId, userDeadlinesDir(userId)))
      .filter((f) => f.endsWith(".json") && f !== `${documentId}.json`)
      .slice(0, 80);
  } catch {
    otherFiles = [];
  }

  const othersByDoc = new Map<string, MemoryDeadline[]>();
  for (const file of otherFiles) {
    const docId = path.basename(file, ".json");
    othersByDoc.set(docId, await listDeadlinesForDoc(userId, docId));
  }

  const allOthers = [...othersByDoc.values()].flat();
  const patches = new Map<string, Map<string, string>>(); // docId -> deadlineId -> clusterId

  const setPatch = (docId: string, deadlineId: string, clusterId: string) => {
    let m = patches.get(docId);
    if (!m) {
      m = new Map();
      patches.set(docId, m);
    }
    m.set(deadlineId, clusterId);
  };

  let clustersTouched = 0;

  for (const d of mine) {
    if (!d.dueDate) continue;
    const t = parseDay(d.dueDate);
    if (t == null) continue;

    const neighbors = allOthers.filter((o) => {
      if (!o.dueDate) return false;
      const ot = parseDay(o.dueDate);
      if (ot == null) return false;
      if (Math.abs(t - ot) / 86400_000 > WINDOW_DAYS) return false;
      if (d.entityId && o.entityId && d.entityId !== o.entityId) return false;
      return true;
    });
    if (neighbors.length === 0) continue;

    const clusterId =
      d.clusterId ||
      neighbors.map((n) => n.clusterId).find(Boolean) ||
      randomUUID();
    clustersTouched += 1;
    setPatch(documentId, d.id, clusterId);
    for (const n of neighbors) {
      setPatch(n.docId, n.id, clusterId);
    }
  }

  let deadlinesUpdated = 0;
  for (const [docId, map] of patches) {
    const list =
      docId === documentId
        ? [...mine]
        : [...(othersByDoc.get(docId) ?? (await listDeadlinesForDoc(userId, docId)))];
    let dirty = false;
    for (const [deadlineId, clusterId] of map) {
      const idx = list.findIndex((x) => x.id === deadlineId);
      if (idx < 0) continue;
      if (list[idx].clusterId !== clusterId) {
        list[idx] = { ...list[idx], clusterId };
        dirty = true;
        deadlinesUpdated += 1;
      }
    }
    if (dirty) await saveDeadlinesForDoc(userId, docId, list);
  }

  return { clustersTouched, deadlinesUpdated };
}
