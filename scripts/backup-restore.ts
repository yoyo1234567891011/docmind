import { restoreBackup } from "../src/services/backup/backup";

async function main() {
  const id = process.argv[2];
  const dry = process.argv.includes("--dry-run");
  if (!id) {
    console.error("Usage: npx tsx scripts/backup-restore.ts <backup-id> [--dry-run]");
    process.exit(1);
  }
  const result = await restoreBackup(id, { dryRun: dry });
  console.log(JSON.stringify(result, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
