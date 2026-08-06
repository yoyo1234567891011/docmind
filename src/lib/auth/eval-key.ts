import { isDeployedEnv } from "@/lib/env-validate";

/**
 * Compare x-eval-api-key de façon timing-safe.
 * Compatible Edge (pas de node:crypto) — utilisé aussi par le middleware.
 */
function timingSafeEqualString(a: string, b: string): boolean {
  if (a.length !== b.length) return false;
  let out = 0;
  for (let i = 0; i < a.length; i += 1) {
    out |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return out === 0;
}

/**
 * En environnement déployé : désactivé sauf EVAL_ALLOW_IN_DEPLOY=1.
 */
export function matchEvalApiKey(provided: string | null | undefined): boolean {
  const evalKey = process.env.EVAL_API_KEY?.trim();
  const value = provided?.trim() ?? "";
  if (!evalKey || !value) return false;

  if (isDeployedEnv() && process.env.EVAL_ALLOW_IN_DEPLOY !== "1") {
    return false;
  }

  return timingSafeEqualString(evalKey, value);
}
