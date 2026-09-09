/**
 * Debug 1 VU live — imprime chaque step error.
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

import { LoadHttpClient } from "./load-simulator/http-client";
import { LiveQueueTracker, runVirtualUser } from "./load-simulator/scenario";
import type { SimulatorOptions } from "./load-simulator/types";

function loadEnvFile(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) process.env[key] = value;
  }
}

async function main() {
  for (const name of [".env.local", ".env"]) {
    try {
      loadEnvFile(readFileSync(path.join(process.cwd(), name), "utf8"));
    } catch {
      /* optional */
    }
  }
  process.env.EVAL_ALLOW_IN_DEPLOY = "1";
  process.env.PG_SSL_REJECT_UNAUTHORIZED = "0";

  const options: SimulatorOptions = {
    baseUrl: "http://127.0.0.1:3000",
    usersLevels: [1],
    mode: "live",
    auth: "eval",
    docsPerUser: 1,
    p2TimeoutMs: 180_000,
    pollIntervalMs: 2000,
    forceLive: true,
    calibrateUsers: 1,
    evalApiKey: process.env.EVAL_API_KEY,
    outDir: path.join(process.cwd(), "reports"),
  };

  const pdfCandidates = [
    "test-documents/assurances/01-contrat-assurance-habitation-ass-821915.pdf",
    "e2e/fixtures/sample.pdf",
  ];
  const pdfPath = pdfCandidates.find((p) => existsSync(p));
  if (!pdfPath) throw new Error("PDF introuvable");

  const client = new LoadHttpClient(
    options.baseUrl,
    "eval",
    options.evalApiKey,
  );

  const result = await runVirtualUser({
    index: 0,
    options,
    pdfPath,
    queue: new LiveQueueTracker(),
    baseClient: client,
  });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
