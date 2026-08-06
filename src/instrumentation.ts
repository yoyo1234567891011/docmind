/**
 * Boot Next.js — valide la config en production/beta.
 * En environnement déployé, refuse le démarrage si des variables critiques manquent
 * (sauf DOCMIND_SKIP_ENV_ASSERT=1 pour CI contrôlée).
 */
export async function register(): Promise<void> {
  if (process.env.NEXT_RUNTIME === "edge") return;

  const { validateProductionEnv, isDeployedEnv } = await import(
    "@/lib/env-validate"
  );

  const issues = validateProductionEnv();
  for (const issue of issues) {
    const line = `[docmind:env] ${issue.message}`;
    if (issue.level === "error") console.error(line);
    else console.warn(line);
  }

  if (isDeployedEnv()) {
    const fatal = issues.filter((i) => i.level === "error");
    if (fatal.length > 0 && process.env.DOCMIND_SKIP_ENV_ASSERT !== "1") {
      throw new Error(
        `[docmind:env] ${fatal.length} variable(s) manquante(s) — démarrage refusé. Définissez-les ou DOCMIND_SKIP_ENV_ASSERT=1 (CI uniquement).`,
      );
    }
  }
}
