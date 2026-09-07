/**
 * Politique requeue P2 — 429 / timeout / parse.
 * npx tsx --tsconfig tsconfig.json scripts/test-p2-requeue-policy.ts
 */
import assert from "node:assert/strict";

import { AppError } from "../src/lib/errors";
import {
  classifyP2Error,
  computeRequeueDeferMs,
  formatP2LastError,
  RATE_LIMIT_MAX_ATTEMPTS,
  shouldRequeueAfterP2Failure,
} from "../src/services/analysis-jobs/requeue-policy";
import {
  ANALYSIS_JOB_GLOBAL_TIMEOUT_MS,
  ANALYSIS_MAX_TRANSIENT_ATTEMPTS,
} from "../src/services/analysis-jobs/store";
import type { AnalysisJob } from "../src/services/analysis-jobs/types";
import {
  analysisJobFailMessageFromLastError,
  analysisJobSaturationFailMessage,
  analysisJobSaturationWaitHint,
  isAnalysisJobSaturationHint,
} from "../src/components/documents/analysis-job-status-copy";

function job(overrides: Partial<AnalysisJob> = {}): AnalysisJob {
  return {
    id: "j1",
    userId: "u1",
    documentId: "d1",
    historyId: "h1",
    fileName: "x.pdf",
    status: "processing",
    attempts: 1,
    skipReadyReply: true,
    createdAt: new Date().toISOString(),
    updatedAt: new Date().toISOString(),
    ...overrides,
  };
}

function main() {
  assert.equal(
    classifyP2Error(
      new AppError("OLLAMA_UNAVAILABLE", "rate_limit: saturé", 503),
    ),
    "rate_limit",
  );
  assert.equal(
    classifyP2Error(new AppError("ANALYSIS_FAILED", "JSON d'analyse invalide", 502)),
    "parse_error",
  );
  assert.equal(
    classifyP2Error(new AppError("OLLAMA_UNAVAILABLE", "timeout sous 270s", 504)),
    "timeout",
  );
  console.log("OK classifyP2Error");

  // 1er 429 → TOUJOURS requeue (même budget serré)
  const almostExpired = job({
    attempts: 1,
    createdAt: new Date(
      Date.now() - ANALYSIS_JOB_GLOBAL_TIMEOUT_MS + 20_000,
    ).toISOString(),
  });
  const first429 = shouldRequeueAfterP2Failure(
    almostExpired,
    new AppError("OLLAMA_UNAVAILABLE", "rate_limit: TPM", 503),
  );
  assert.equal(first429.requeue, true, "1er 429 ne doit pas fail");
  assert.equal(first429.errorClass, "rate_limit");
  console.log("OK requeue 429 au 1er essai (même budget serré)");

  const exhausted = job({ attempts: RATE_LIMIT_MAX_ATTEMPTS });
  const noMore = shouldRequeueAfterP2Failure(
    exhausted,
    new AppError("OLLAMA_UNAVAILABLE", "rate_limit", 503),
  );
  assert.equal(noMore.requeue, false);
  console.log(`OK pas de requeue après ${RATE_LIMIT_MAX_ATTEMPTS} attempts rate_limit`);

  const parseFail = shouldRequeueAfterP2Failure(
    job({ attempts: 1 }),
    new AppError("ANALYSIS_FAILED", "JSON tronqué", 502),
  );
  assert.equal(parseFail.requeue, false);
  console.log("OK parse_error → fail direct (pas requeue)");

  const requeueMsg = formatP2LastError("rate_limit", "requeue", 1);
  assert.match(requeueMsg, /^rate_limit:/);
  assert.ok(isAnalysisJobSaturationHint(requeueMsg));
  assert.match(analysisJobSaturationWaitHint(), /en file|essai automatique/i);

  const failMsg = formatP2LastError("rate_limit", "fail", 5);
  assert.match(failMsg, /^rate_limit:/);
  assert.equal(
    analysisJobFailMessageFromLastError(failMsg),
    analysisJobSaturationFailMessage(),
  );
  assert.match(
    analysisJobFailMessageFromLastError(
      formatP2LastError("parse_error", "fail", 1),
    ),
    /incomplète|invalide|JSON|champs/i,
  );
  console.log("OK last_error classé + UX wait vs fail");

  assert.equal(RATE_LIMIT_MAX_ATTEMPTS, 5);
  assert.equal(ANALYSIS_MAX_TRANSIENT_ATTEMPTS, 5);
  const defer = computeRequeueDeferMs(job());
  assert.ok(defer >= 8_000 && defer <= 22_000);
  console.log("OK constants N=5 + defer");

  console.log("\nALL p2 requeue policy tests passed.");
}

main();
