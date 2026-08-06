/**
 * Tests isolation multi-utilisateurs (filesystem + cache + ownership).
 */
import assert from "assert";
import { mkdir, writeFile, rm } from "fs/promises";
import path from "path";

import {
  ANALYSIS_PIPELINE_VERSION,
  getCachedAnalysis,
  setCachedAnalysis,
  type CacheFingerprint,
} from "../src/ai/optimizations/analysis-cache";
import { assertOwnedByUser } from "../src/lib/auth/ownership";
import { userHistoryDir } from "../src/config/paths";
import { AppError } from "../src/lib/errors";
import { ensureUserWorkspace, resetUserWorkspaceCache } from "../src/services/auth/workspace";
import { listHistoryRecords } from "../src/services/history/store";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import { EMPTY_READY_REPLY } from "../src/types";

const TEST_FP: CacheFingerprint = {
  model: "mistral",
  promptsFingerprint: "iso-test",
  pipelineVersion: ANALYSIS_PIPELINE_VERSION,
};

async function main() {
  resetUserWorkspaceCache();

  const userA = "user-a-iso-test";
  const userB = "user-b-iso-test";

  await ensureUserWorkspace(userA);
  await ensureUserWorkspace(userB);

  // Cache isolé
  const text = `secret-doc-${Date.now()}`;
  await setCachedAnalysis({
    userId: userA,
    text,
    fingerprint: TEST_FP,
    model: "mistral",
    classification: {
      category: "contrat",
      label: "Contrat",
      confidence: 0.9,
    },
    analysis: {
      document_type: "Contrat",
      title: "Privé A",
      summary: "ne doit pas fuiter",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: [],
      risks: [],
      actions: [],
      risk_score: 10,
      risk_level: "faible",
      risk_explanation: "",
      risk_criteria: RISK_CRITERIA.map((c) => ({
        id: c.id,
        label: c.label,
        detected: false,
        score: 0,
        max_score: c.maxScore,
        reasons: [],
      })),
      risk_findings: [],
    },
    readyReply: EMPTY_READY_REPLY,
  });

  const hitA = await getCachedAnalysis(userA, text, TEST_FP);
  const hitB = await getCachedAnalysis(userB, text, TEST_FP);
  assert.ok(hitA, "user A voit son cache");
  assert.equal(hitB, null, "user B ne voit pas le cache de A");

  // Ownership
  try {
    assertOwnedByUser(userA, userB, "analyse");
    assert.fail("devrait refuser l’accès croisé");
  } catch (error) {
    assert.ok(error instanceof AppError);
    assert.equal(error.code, "FORBIDDEN");
  }
  assertOwnedByUser(userA, userA, "analyse");

  // Historique : fiche d’un autre user ignorée dans le listing
  const dir = userHistoryDir(userB);
  await mkdir(dir, { recursive: true });
  await writeFile(
    path.join(dir, "poison.json"),
    JSON.stringify({
      id: "poison",
      userId: userA,
      documentId: "x",
      fileName: "x.pdf",
      createdAt: new Date().toISOString(),
      classification: {
        category: "autre",
        label: "Autre",
        confidence: 0.5,
      },
      analysis: {
        document_type: "X",
        title: "Poison",
        summary: "",
        date: "",
        dates: [],
        people: [],
        organizations: [],
        amounts: [],
        deadlines: [],
        important_points: [],
        risks: [],
        actions: [],
        risk_score: 0,
        risk_level: "faible",
        risk_explanation: "",
        risk_criteria: [],
        risk_findings: [],
      },
      readyReply: EMPTY_READY_REPLY,
      model: "t",
      analyzedAt: new Date().toISOString(),
      extractedText: "",
      folderId: null,
    }),
    "utf8",
  );

  const listed = await listHistoryRecords(userB);
  assert.ok(
    !listed.some((item) => item.id === "poison"),
    "fiche étrangère exclue du listing",
  );

  await Promise.all([
    rm(path.join(process.cwd(), "data", "users", userA), {
      recursive: true,
      force: true,
    }),
    rm(path.join(process.cwd(), "data", "users", userB), {
      recursive: true,
      force: true,
    }),
  ]);

  console.log("OK test-auth-isolation");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
