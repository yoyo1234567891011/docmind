/**
 * Sauvegarde quotidienne.
 * - DOCMIND_STORAGE=persistent → backup production PG + PDF S3
 * - sinon → backup FS local (dev uniquement, PAS production)
 *
 * Usage: npm run backup:run
 */
import { usePersistentStorage } from "../src/config/persistence";
import {
  createDailyBackup,
  pruneBackups,
  verifyBackup,
} from "../src/services/backup/backup";
import {
  createPersistentBackup,
  verifyPersistentBackup,
} from "../src/services/backup/persistent-backup";

async function main() {
  const keep = Number(process.env.BACKUP_KEEP ?? "14");

  if (usePersistentStorage()) {
    const manifest = await createPersistentBackup();
    const verify = await verifyPersistentBackup(manifest.id);
    const pruned = await pruneBackups(keep);
    console.log(
      JSON.stringify(
        {
          kind: "persistent",
          id: manifest.id,
          documents: manifest.totals.documents,
          pdfBytes: manifest.totals.pdfBytes,
          postgresBytes: manifest.totals.postgresBytes,
          tables: manifest.postgres.tables,
          verifyOk: verify.ok,
          verifyErrors: verify.errors,
          pruned,
        },
        null,
        2,
      ),
    );
    if (!verify.ok) process.exit(1);
    return;
  }

  console.warn(
    "[backup] Mode FS — backup local data/uploads uniquement (NON production).",
  );
  const manifest = await createDailyBackup();
  const verify = await verifyBackup(manifest.id);
  const pruned = await pruneBackups(keep);
  console.log(
    JSON.stringify(
      {
        kind: "fs",
        id: manifest.id,
        files: manifest.totals.files,
        bytes: manifest.totals.bytes,
        verifyOk: verify.ok,
        verifyErrors: verify.errors,
        pruned,
        production: false,
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
