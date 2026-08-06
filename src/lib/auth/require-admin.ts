import { AppError } from "@/lib/errors";
import { requireUser, type AuthUser } from "@/lib/auth/require-user";

function adminEmails(): string[] {
  return (process.env.ADMIN_EMAILS ?? "")
    .split(",")
    .map((item) => item.trim().toLowerCase())
    .filter(Boolean);
}

/**
 * Accès admin uniquement.
 * - Mode local (Supabase absent, hors production) : autorisé
 * - Clé EVAL : toujours refusée
 * - Production / Supabase : email dans ADMIN_EMAILS
 */
export async function requireAdmin(request?: Request): Promise<AuthUser> {
  const user = await requireUser(request);

  if (user.isEval) {
    throw new AppError(
      "FORBIDDEN",
      "La clé d'évaluation n'a pas accès à l'administration.",
      403,
    );
  }

  if (user.isLocalDev) {
    return user;
  }

  const allowed = adminEmails();
  if (allowed.length === 0) {
    throw new AppError(
      "FORBIDDEN",
      "Accès administrateur non configuré (ADMIN_EMAILS).",
      403,
    );
  }

  const email = user.email?.trim().toLowerCase();
  if (!email || !allowed.includes(email)) {
    throw new AppError(
      "FORBIDDEN",
      "Accès administrateur requis.",
      403,
    );
  }

  return user;
}
