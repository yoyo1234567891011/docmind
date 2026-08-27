/**
 * Garde : aucun chemin data/ ou users/ ne doit être écrit en mode persistent / serverless.
 * Simule Vercel + DOCMIND_STORAGE=persistent sans toucher le disque.
 */
import assert from "node:assert/strict";

async function main() {
  process.env.VERCEL = "1";
  process.env.VERCEL_ENV = "production";
  process.env.DOCMIND_STORAGE = "persistent";
  process.env.DATABASE_URL = process.env.DATABASE_URL || "postgres://local/test";
  process.env.S3_BUCKET = process.env.S3_BUCKET || "test-bucket";
  process.env.S3_ACCESS_KEY_ID = process.env.S3_ACCESS_KEY_ID || "test-key";
  process.env.S3_SECRET_ACCESS_KEY =
    process.env.S3_SECRET_ACCESS_KEY || "test-secret";
  process.env.AWS_REGION = process.env.AWS_REGION || "eu-west-1";

  const { canUseLocalFilesystem, usePersistentStorage } = await import(
    "../src/config/persistence"
  );
  const { isServerlessRuntime, isDeployedEnv } = await import(
    "../src/lib/env-validate"
  );
  const { readAdminConfig } = await import("../src/services/admin/config-store");
  const { readAdminPrompts } = await import("../src/services/admin/prompts-store");

  assert.equal(isServerlessRuntime(), true, "VERCEL=1 → serverless");
  assert.equal(isDeployedEnv(), true, "serverless → deployed");
  assert.equal(usePersistentStorage(), true, "persistent forcé");
  assert.equal(canUseLocalFilesystem(), false, "FS local interdit");

  const config = await readAdminConfig();
  const prompts = await readAdminPrompts();
  assert.ok(config.profileId, "admin config mémoire");
  assert.ok(Array.isArray(prompts.versions), "admin prompts mémoire");

  console.log("OK test-persistent-no-local-fs");
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
