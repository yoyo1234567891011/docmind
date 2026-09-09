/**
 * Teste createErrorReport en mode persistent (comme Vercel prod).
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-error-reports-persistent.ts
 */
import { loadEnvFiles } from "./lib/load-env-files";

loadEnvFiles();
process.env.DOCMIND_STORAGE = "persistent";
// SSL Supabase local : assouplissement dev uniquement (prod Vercel vérifie le cert).
process.env.PG_SSL_REJECT_UNAUTHORIZED = "0";

async function main() {
  const { createErrorReport, listErrorReports } = await import(
    "@/services/beta/error-reports-store"
  );

  const entry = await createErrorReport({
    userId: null,
    email: null,
    kind: "bug",
    severity: "medium",
    message: "Test signalement persistent beta gate",
    page: "/signalement",
    userAgent: "test-error-reports-persistent",
  });
  console.log("createErrorReport OK:", entry.id);

  const rows = await listErrorReports(5);
  const found = rows.some((r) => r.id === entry.id);
  if (!found) {
    throw new Error("Signalement non retrouvé via listErrorReports");
  }
  console.log("listErrorReports OK:", rows.length, "entries");
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
