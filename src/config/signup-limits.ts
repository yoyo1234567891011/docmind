/**
 * Plafond temporaire d’inscriptions Échélia.
 *
 * Source unique : `MAX_USERS`.
 *
 * Désactiver sans toucher au code :
 *   SIGNUP_MAX_USERS=0
 * (aussi accepté : off | false | unlimited | -1)
 *
 * Surcharger le plafond :
 *   SIGNUP_MAX_USERS=50
 *
 * Absent / vide → limite active à `MAX_USERS`.
 */

/** Cap temporaire — modifier ici si besoin d’un autre plafond par défaut. */
export const MAX_USERS = 35;

export const SIGNUP_FULL_MESSAGE =
  "Les inscriptions sont actuellement complètes.";

function parseDisableFlag(raw: string): boolean {
  const v = raw.trim().toLowerCase();
  return (
    v === "0" ||
    v === "off" ||
    v === "false" ||
    v === "unlimited" ||
    v === "-1" ||
    v === "none"
  );
}

/**
 * `null` = pas de plafond (inscriptions normales).
 * Sinon = plafond effectif (> 0).
 */
export function getSignupMaxUsers(): number | null {
  const raw = process.env.SIGNUP_MAX_USERS;
  if (raw === undefined || raw.trim() === "") {
    return MAX_USERS;
  }
  if (parseDisableFlag(raw)) {
    return null;
  }
  const n = Number(raw.trim());
  if (!Number.isFinite(n) || n <= 0) {
    return MAX_USERS;
  }
  return Math.trunc(n);
}

export function isSignupUserLimitEnabled(): boolean {
  return getSignupMaxUsers() != null;
}

export function evaluateSignupCapacity(
  currentCount: number,
  maxUsers: number | null = getSignupMaxUsers(),
): { allowed: boolean; message: string | null } {
  if (maxUsers == null) {
    return { allowed: true, message: null };
  }
  if (currentCount >= maxUsers) {
    return { allowed: false, message: SIGNUP_FULL_MESSAGE };
  }
  return { allowed: true, message: null };
}
