/**
 * Politique requeue P2 — 429 / timeout / parse.
 * npx tsx --tsconfig tsconfig.json scripts/test-p2-requeue-policy.ts
 */
import assert from "node:assert/strict";

import { AppError } from "../src/lib/errors";
import {
  classifyP2Error,
  computeRequeueDeferMs,
  shouldRequeueAfterP2Failure,
} from "../src/services/analysis-jobs/requeue-policy";
import {
  ANALYSIS_JOB_GLOBAL_TIMEOUT_MS,
  ANALYSIS_MAX_TRANSIENT_ATTEMPTS,
} from "../src/services/analysis-jobs/store";
import type { AnalysisJob } from "../src/services/analysis-jobs/types";

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
    "rate_limit_429",
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

  const fresh = job({ attempts: 1 });
  const rateLimit = shouldRequeueAfterP2Failure(
    fresh,
    new AppError("OLLAMA_UNAVAILABLE", "rate_limit: TPM", 503),
  );
  assert.equal(rateLimit.requeue, true);
  assert.ok(rateLimit.deferMs >= 8_000);
  console.log("OK requeue 429 au 1er essai");

  const exhausted = job({ attempts: ANALYSIS_MAX_TRANSIENT_ATTEMPTS });
  const noMore = shouldRequeueAfterP2Failure(
    exhausted,
    new AppError("OLLAMA_UNAVAILABLE", "rate_limit", 503),
  );
  assert.equal(noMore.requeue, false);
  console.log("OK pas de requeue après max attempts");

  const old = job({
    attempts: 2,
    createdAt: new Date(Date.now() - ANALYSIS_JOB_GLOBAL_TIMEOUT_MS + 5_000).toISOString(),
  });
  const tooLate = shouldRequeueAfterP2Failure(
    old,
    new AppError("OLLAMA_UNAVAILABLE", "rate_limit", 503),
  );
  assert.equal(tooLate.requeue, false);
  console.log("OK pas de requeue si budget global presque épuisé");

  const parseFail = shouldRequeueAfterP2Failure(
    job({ attempts: 1 }),
    new AppError("ANALYSIS_FAILED", "JSON tronqué", 502),
  );
  assert.equal(parseFail.requeue, false);
  console.log("OK parse_error → fail direct (pas requeue)");

  const defer = computeRequeueDeferMs(job());
  assert.ok(defer >= 8_000 && defer <= 22_000);
  console.log("OK computeRequeueDeferMs");

  console.log("\nALL p2 requeue policy tests passed.");
}

main();
