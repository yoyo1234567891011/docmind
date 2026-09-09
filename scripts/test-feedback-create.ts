/**
 * Teste createFeedback en mode persistent (comme Vercel prod).
 *
 * Usage: npx tsx --tsconfig tsconfig.json scripts/test-feedback-create.ts
 */
import { readFileSync, existsSync } from "fs";
import path from "path";

function loadEnvFile(filePath: string): Record<string, string> {
  if (!existsSync(filePath)) return {};
  const out: Record<string, string> = {};
  for (const line of readFileSync(filePath, "utf8").split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const eq = trimmed.indexOf("=");
    if (eq <= 0) continue;
    const key = trimmed.slice(0, eq).trim();
    let value = trimmed.slice(eq + 1).trim();
    if (
      (value.startsWith('"') && value.endsWith('"')) ||
      (value.startsWith("'") && value.endsWith("'"))
    ) {
      value = value.slice(1, -1);
    }
    out[key] = value;
  }
  return out;
}

async function main() {
  const root = process.cwd();
  const env = {
    ...loadEnvFile(path.join(root, ".env")),
    ...loadEnvFile(path.join(root, ".env.local")),
  };
  process.env.DATABASE_URL = env.DATABASE_URL;
  process.env.DOCMIND_STORAGE = "persistent";
  process.env.NEXT_PUBLIC_APP_ENV = "production";

  const { createFeedback } = await import("@/services/beta/feedback-store");
  const entry = await createFeedback({
    userId: null,
    email: null,
    category: "ux",
    rating: 5,
    message: "Test script feedback persistent",
    page: "/feedback",
    userAgent: "test-feedback-create",
  });
  console.log("createFeedback OK:", entry.id);

  const { pgListFeedback } = await import("@/services/persistence/feedback-pg");
  const rows = await pgListFeedback(5);
  console.log("latest feedback count:", rows.length, "top id:", rows[0]?.id);
}

main().catch((err) => {
  console.error("FAIL:", err);
  process.exit(1);
});
