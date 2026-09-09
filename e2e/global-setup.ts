/**
 * Prépare un workspace FS vierge pour chaque run E2E (data-e2e/).
 * Évite la pollution mémoire/historique entre runs.
 */
import fs from "fs";
import path from "path";

export default async function globalSetup(): Promise<void> {
  const dataDir = process.env.DOCMIND_E2E_DATA_DIR || "data-e2e";
  const abs = path.join(process.cwd(), dataDir);
  if (fs.existsSync(abs)) {
    fs.rmSync(abs, { recursive: true, force: true });
  }
  fs.mkdirSync(abs, { recursive: true });
  // eslint-disable-next-line no-console
  console.log(`[e2e:setup] Workspace FS isolé réinitialisé : ${dataDir}/`);
}
