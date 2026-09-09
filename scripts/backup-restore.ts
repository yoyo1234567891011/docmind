/**
 * Restauration.
 * - Backup persistent → staging (NEXT_PUBLIC_APP_ENV=staging) ou
 *   BACKUP_RESTORE_ALLOW_PRODUCTION=1
 * - Backup FS → data/uploads (dev uniquement)
 *
 * Usage:
 *   npm run backup:restore -- <backup-id> [--dry-run]
 *   npm run backup:restore -- <backup-id> --allow-production
 */
import { readFile } from "fs/promises";
import path from "path";

import { BACKUPS_DIR } from "../src/config/paths";
import { restoreBackup } from "../src/services/backup/backup";
import { restorePersistentBackup } from "../src/services/backup/persistent-backup";

async function main() {
  const id = process.argv[2];
  const dry = process.argv.includes("--dry-run");
  const allowProduction = process.argv.includes("--allow-production");
  if (!id) {
    console.error(
      "Usage: npx tsx scripts/backup-restore.ts <backup-id> [--dry-run] [--allow-production]",
    );
    process.exit(1);
  }

  let kind: "persistent" | "fs" = "fs";
  try {
    const manifest = JSON.parse(
      await readFile(path.join(BACKUPS_DIR, id, "manifest.json"), "utf8"),
    ) as { kind?: string };
    if (manifest.kind === "persistent") kind = "persistent";
  } catch {
    /* verify will fail later */
  }

  if (kind === "persistent") {
    const result = await restorePersistentBackup(id, {
      dryRun: dry,
      allowProduction,
      wipeBeforeRestore: !dry,
    });
    console.log(JSON.stringify({ kind, ...result }, null, 2));
    return;
  }

  const result = await restoreBackup(id, { dryRun: dry });
  console.log(JSON.stringify({ kind: "fs", ...result }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
