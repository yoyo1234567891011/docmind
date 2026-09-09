import { readFile } from "fs/promises";
import path from "path";

import { BACKUPS_DIR } from "../src/config/paths";
import { listBackups, verifyBackup } from "../src/services/backup/backup";
import { verifyPersistentBackup } from "../src/services/backup/persistent-backup";

async function detectKind(
  id: string,
): Promise<"persistent" | "fs" | "unknown"> {
  try {
    const raw = await readFile(
      path.join(BACKUPS_DIR, id, "manifest.json"),
      "utf8",
    );
    const manifest = JSON.parse(raw) as { kind?: string };
    if (manifest.kind === "persistent") return "persistent";
    return "fs";
  } catch {
    return "unknown";
  }
}

async function main() {
  const id = process.argv[2];
  if (id) {
    const kind = await detectKind(id);
    const result =
      kind === "persistent"
        ? await verifyPersistentBackup(id)
        : await verifyBackup(id);
    console.log(JSON.stringify({ id, kind, ...result }, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const list = await listBackups();
  const results = [];
  for (const item of list.slice(0, 5)) {
    const kind = await detectKind(item.id);
    const verified =
      kind === "persistent"
        ? await verifyPersistentBackup(item.id)
        : await verifyBackup(item.id);
    results.push({ id: item.id, kind, ...verified });
  }
  console.log(JSON.stringify({ backups: list.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
