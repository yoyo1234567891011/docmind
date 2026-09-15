/**
 * Historique : reset used à l’upgrade — **interdit** (règle produit 2026-09).
 * Upgrade = conserver `used`, appliquer les nouvelles `limit` du plan.
 * Conservé comme no-op pour ne pas casser d’anciens imports / scripts.
 */
export async function resetQuotasOnPlanUpgrade(_userId: string): Promise<void> {
  // Intentionnellement vide.
}
