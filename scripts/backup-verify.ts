import { listBackups, verifyBackup } from "../src/services/backup/backup";

async function main() {
  const id = process.argv[2];
  if (id) {
    const result = await verifyBackup(id);
    console.log(JSON.stringify(result, null, 2));
    process.exit(result.ok ? 0 : 1);
  }

  const list = await listBackups();
  const results = [];
  for (const item of list.slice(0, 5)) {
    results.push({ id: item.id, ...(await verifyBackup(item.id)) });
  }
  console.log(JSON.stringify({ backups: list.length, results }, null, 2));
  if (results.some((r) => !r.ok)) process.exit(1);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
