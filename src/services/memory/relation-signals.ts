import path from "path";

import { userMemoryDir } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileUnlink,
  userFileWrite,
} from "@/lib/user-files";

export interface DocRelationSignals {
  documentId: string;
  category: string;
  title: string;
  /**
   * Indices produit/service (titre, résumé, points importants…)
   * pour distinguer plusieurs contrats chez le même fournisseur.
   */
  productHints?: string;
  guaranteeLabels: string[];
  riskLabels: string[];
  amounts: number[];
  period: string | null;
  updatedAt: string;
}

function signalsFile(userId: string, documentId: string): string {
  return path.join(userMemoryDir(userId), "signals", `${documentId}.json`);
}

export async function saveRelationSignals(
  userId: string,
  signals: DocRelationSignals,
): Promise<void> {
  const file = signalsFile(userId, signals.documentId);
  await userFileEnsureDir(path.dirname(file));
  await userFileWrite(userId, file, JSON.stringify(signals, null, 2));
}

export async function loadRelationSignals(
  userId: string,
  documentId: string,
): Promise<DocRelationSignals | null> {
  try {
    const raw = await userFileRead(userId, signalsFile(userId, documentId));
    if (!raw) return null;
    return JSON.parse(raw) as DocRelationSignals;
  } catch {
    return null;
  }
}

export async function deleteRelationSignals(
  userId: string,
  documentId: string,
): Promise<void> {
  await userFileUnlink(userId, signalsFile(userId, documentId));
}
