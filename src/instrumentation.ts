/**
 * Boot Next.js — valide la config en production/beta/staging.
 * DOCMIND_SKIP_ENV_ASSERT=1 est ignoré en environnement déployé
 * (ne peut pas contourner STORAGE/FALLBACK/REDIS/secrets).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { validateProductionEnv, isDeployedEnv } = await import(
    "@/lib/env-validate"
  );
  const { assertPersistentReadyOrThrow } = await import(
    "@/config/persistence"
  );

  const issues = validateProductionEnv();
  for (const issue of issues) {
    const line = `[docmind:env] ${issue.message}`;
    if (issue.level === "error") console.error(line);
    else console.warn(line);
  }

  if (isDeployedEnv()) {
    if (process.env.DOCMIND_SKIP_ENV_ASSERT === "1") {
      console.warn(
        "[docmind:env] DOCMIND_SKIP_ENV_ASSERT=1 ignoré en environnement déployé — protections critiques appliquées.",
      );
    }
    const fatal = issues.filter((i) => i.level === "error");
    if (fatal.length > 0) {
      throw new Error(
        `[docmind:env] ${fatal.length} variable(s) manquante(s) ou invalide(s) — démarrage refusé.`,
      );
    }
    // Double contrôle persistance (STORAGE=persistent + FS_FALLBACK=0 + Redis).
    assertPersistentReadyOrThrow();
  }
}
