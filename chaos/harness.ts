import assert from "assert";
import { access, readFile } from "fs/promises";

import { userHistoryRecordPath } from "../src/config/paths";
import {
  clearChaosFaults,
  isChaosEnabled,
  type ChaosFault,
  withChaosFault,
} from "../src/lib/chaos";
import { AppError } from "../src/lib/errors";
import {
  ensureUserWorkspace,
  resetUserWorkspaceCache,
} from "../src/services/auth/workspace";
import {
  getHistoryRecord,
  getUserPdfAbsolutePath,
  listHistoryRecords,
  saveHistoryRecord,
} from "../src/services/history/store";
import { savePdfToUploads } from "../src/services/storage";

import {
  buildChaosAnalysisResult,
  chaosDocumentId,
  chaosUserId,
} from "./fixtures";

export interface ChaosScenarioResult {
  id: string;
  title: string;
  ok: boolean;
  detail: string;
  durationMs: number;
}

export type ChaosScenario = {
  id: string;
  title: string;
  run: () => Promise<string>;
};

export async function withChaosEnv<T>(fn: () => Promise<T>): Promise<T> {
  const prevChaos = process.env.DOCMIND_CHAOS;
  const prevStorage = process.env.DOCMIND_STORAGE;
  const prevAppEnv = process.env.NEXT_PUBLIC_APP_ENV;
  process.env.DOCMIND_CHAOS = "1";
  process.env.DOCMIND_STORAGE = "fs";
  process.env.NEXT_PUBLIC_APP_ENV = "development";
  resetUserWorkspaceCache();
  clearChaosFaults();
  try {
    if (!isChaosEnabled()) {
      throw new Error("DOCMIND_CHAOS=1 attendu mais chaos désactivé");
    }
    return await fn();
  } finally {
    clearChaosFaults();
    if (prevChaos === undefined) delete process.env.DOCMIND_CHAOS;
    else process.env.DOCMIND_CHAOS = prevChaos;
    if (prevStorage === undefined) delete process.env.DOCMIND_STORAGE;
    else process.env.DOCMIND_STORAGE = prevStorage;
    if (prevAppEnv === undefined) delete process.env.NEXT_PUBLIC_APP_ENV;
    else process.env.NEXT_PUBLIC_APP_ENV = prevAppEnv;
    resetUserWorkspaceCache();
  }
}

/** Seed durable user data (PDF + history preview) for integrity checks. */
export async function seedDurableUserData(label: string): Promise<{
  userId: string;
  documentId: string;
  historyId: string;
  pdfBytes: Buffer;
  summary: string;
}> {
  const userId = chaosUserId(label);
  await ensureUserWorkspace(userId);
  const documentId = chaosDocumentId();
  const pdfBytes = Buffer.from(
    `%PDF-1.4\n1 0 obj<<>>endobj\ntrailer<<>>\n%%EOF\nchaos-${label}`,
    "utf8",
  );
  await savePdfToUploads(userId, documentId, pdfBytes);
  const result = buildChaosAnalysisResult(documentId, "preview");
  const record = await saveHistoryRecord(userId, {
    fileName: `chaos-${label}.pdf`,
    extractedText: `Texte durable chaos ${label}`,
    result,
  });
  return {
    userId,
    documentId,
    historyId: record.id,
    pdfBytes,
    summary: record.analysis.summary,
  };
}

export async function assertUserDataIntact(input: {
  userId: string;
  documentId: string;
  historyId: string;
  summary: string;
}): Promise<void> {
  const record = await getHistoryRecord(input.userId, input.historyId);
  assert.equal(record.id, input.historyId);
  assert.equal(record.documentId, input.documentId);
  assert.equal(record.analysis.summary, input.summary);
  assert.ok(
    record.analysisPhase === "preview" ||
      record.analysisPhase === "complete" ||
      record.analysisPhase === "failed",
  );

  const pdfPath = getUserPdfAbsolutePath(input.userId, input.documentId);
  await access(pdfPath);
  const onDisk = await readFile(pdfPath);
  assert.ok(onDisk.byteLength > 20, "PDF utilisateur présent");
  assert.equal(onDisk.subarray(0, 4).toString(), "%PDF");

  const historyPath = userHistoryRecordPath(input.userId, input.historyId);
  const raw = await readFile(historyPath, "utf8");
  assert.ok(raw.includes(input.summary), "JSON historique intact");
}

export async function expectFailure(
  fn: () => Promise<unknown>,
  match: RegExp | ((error: unknown) => boolean),
): Promise<void> {
  let threw = false;
  try {
    await fn();
  } catch (error) {
    threw = true;
    if (typeof match === "function") {
      assert.ok(match(error), `échec inattendu: ${String(error)}`);
    } else {
      const msg =
        error instanceof Error
          ? `${error.message} ${error.name}`
          : String(error);
      assert.ok(match.test(msg), `message non matché: ${msg}`);
    }
  }
  assert.ok(threw, "une erreur était attendue");
}

export function isAppErrorCode(error: unknown, code: string): boolean {
  return error instanceof AppError && error.code === code;
}

export async function runWithFault(
  fault: ChaosFault,
  fn: () => Promise<void>,
): Promise<void> {
  await withChaosFault(fault, fn);
}

export async function countUserHistory(userId: string): Promise<number> {
  const items = await listHistoryRecords(userId);
  return items.length;
}
