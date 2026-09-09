import type { Page } from "@playwright/test";

/**
 * Méthode de paiement « Carte » sur Stripe Checkout (locale FR).
 * Cible l’aria-label exact — unique, évite le strict-mode sur /Payer|Pay|Subscribe/.
 * (Ce n’est PAS le CTA final d’abonnement.)
 */
export function stripePayByCardButton(page: Page) {
  return page.getByRole("button", { name: "Payer par carte" });
}

/**
 * CTA final Checkout hébergé FR (« Payer et s'abonner »).
 */
export function stripeSubmitSubscribeButton(page: Page) {
  return page.getByRole("button", { name: /Payer et s'abonner/i });
}
