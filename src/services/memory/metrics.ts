import path from "path";

import { userMemoryDir } from "@/config/paths";
import {
  userFileEnsureDir,
  userFileRead,
  userFileWrite,
} from "@/lib/user-files";

export interface RelationRunMetrics {
  at: string;
  userId: string;
  documentId: string;
  historyId: string;
  corpusSize: number;
  candidateSelectorMs: number;
  candidateCount: number;
  relationEngineMs: number;
  pairsCompared: number;
  relationsCreated: number;
  byType: Partial<
    Record<
      | "duplicate_of"
      | "supersedes"
      | "same_contract_family"
      | "party_shared"
      | "covers_same_risk"
      | "same_guarantee"
      | "redundant_payment"
      | "linked_deadline"
      | "contradicts_clause"
      | "obsoletes_fact"
      | "amends"
      | "invoice_for",
      number
    >
  >;
  /** Heuristique : scores ambigus (0.70–0.84) ou supersedes sans date. */
  potentialFalsePositives: number;
  deferred?: boolean;
}

const MAX_ENTRIES = 2_000;

function metricsFile(userId: string): string {
  return path.join(userMemoryDir(userId), "relation-metrics.jsonl");
}

export async function appendRelationMetrics(
  metrics: RelationRunMetrics,
): Promise<void> {
  await userFileEnsureDir(userMemoryDir(metrics.userId));
  const file = metricsFile(metrics.userId);
  const prev = (await userFileRead(metrics.userId, file)) ?? "";
  const lines = prev
    .split(/\r?\n/)
    .map((l) => l.trim())
    .filter(Boolean);
  lines.push(JSON.stringify(metrics));
  const trimmed = lines.slice(-MAX_ENTRIES);
  await userFileWrite(metrics.userId, file, trimmed.join("\n") + "\n");
}

export async function listRelationMetrics(
  userId: string,
  limit = 50,
): Promise<RelationRunMetrics[]> {
  try {
    const raw = await userFileRead(userId, metricsFile(userId));
    if (!raw) return [];
    return raw
      .split(/\r?\n/)
      .map((l) => l.trim())
      .filter(Boolean)
      .slice(-limit)
      .map((l) => JSON.parse(l) as RelationRunMetrics);
  } catch {
    return [];
  }
}
