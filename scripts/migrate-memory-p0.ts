/**
 * Backfill Entity/Clause/Deadline/Relation depuis l’historique existant.
 * Usage: npx tsx --tsconfig tsconfig.json scripts/migrate-memory-p0.ts [userId]
 * Sans userId : migrate tous les dossiers data/users/*
 */
import { readdir } from "fs/promises";
import path from "path";

import { migrateUserHistoryToMemory } from "../src/services/memory/migrate-history";
import { resetUserWorkspaceCache } from "../src/services/auth/workspace";

async function main() {
  resetUserWorkspaceCache();
  const arg = process.argv[2]?.trim();
  const usersDir = path.join(process.cwd(), "data", "users");

  const userIds = arg
    ? [arg]
    : (await readdir(usersDir).catch(() => [])).filter(
        (name) => !name.startsWith("."),
      );

  const summary = [];
  for (const userId of userIds) {
    const result = await migrateUserHistoryToMemory(userId);
    summary.push({ userId, ...result });
    console.log(
      `${userId}: scanned=${result.scanned} synced=${result.synced} skipped=${result.skipped} failed=${result.failed}`,
    );
  }
  console.log(JSON.stringify({ users: summary.length, summary }, null, 2));
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
