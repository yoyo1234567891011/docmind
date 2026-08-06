/**
 * Sauvegarde quotidienne data/ + uploads/ avec manifeste SHA-256.
 * Usage: npx tsx scripts/backup-run.ts
 * Planifier: Task Scheduler / cron → npm run backup:run
 */
import {
  createDailyBackup,
  pruneBackups,
  verifyBackup,
} from "../src/services/backup/backup";

async function main() {
  const keep = Number(process.env.BACKUP_KEEP ?? "14");
  const manifest = await createDailyBackup();
  const verify = await verifyBackup(manifest.id);
  const pruned = await pruneBackups(keep);

  console.log(
    JSON.stringify(
      {
        id: manifest.id,
        files: manifest.totals.files,
        bytes: manifest.totals.bytes,
        verifyOk: verify.ok,
        verifyErrors: verify.errors,
        pruned,
      },
      null,
      2,
    ),
  );

  if (!verify.ok) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
