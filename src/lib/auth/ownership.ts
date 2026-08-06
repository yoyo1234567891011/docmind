import { AppError } from "@/lib/errors";

/**
 * Refuse tout accès croisé : la ressource doit appartenir à l’utilisateur courant.
 */
export function assertOwnedByUser(
  ownerId: string | null | undefined,
  userId: string,
  resourceLabel = "ressource",
): void {
  if (!ownerId || ownerId !== userId) {
    throw new AppError(
      "FORBIDDEN",
      `Accès refusé : cette ${resourceLabel} ne vous appartient pas.`,
      403,
    );
  }
}
