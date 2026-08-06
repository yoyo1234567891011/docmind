import { readFile } from "fs/promises";
import path from "path";

import { runMonitoringCheck } from "../src/services/monitoring/collect";

async function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const content = await readFile(path.join(process.cwd(), fileName), "utf8");
      for (const line of content.split(/\r?\n/)) {
        const t = line.trim();
        if (!t || t.startsWith("#")) continue;
        const eq = t.indexOf("=");
        if (eq <= 0) continue;
        const key = t.slice(0, eq).trim();
        let value = t.slice(eq + 1).trim();
        if (
          (value.startsWith('"') && value.endsWith('"')) ||
          (value.startsWith("'") && value.endsWith("'"))
        ) {
          value = value.slice(1, -1);
        }
        if (process.env[key] === undefined) process.env[key] = value;
      }
    } catch {
      // optional
    }
  }
}

async function main() {
  await loadEnv();
  const result = await runMonitoringCheck();
  console.log(JSON.stringify(result, null, 2));
  if (result.newAlerts.some((c) => c === "OLLAMA_DOWN" || c === "LOW_SUCCESS_RATE")) {
    process.exit(2);
  }
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
