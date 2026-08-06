import Stripe from "stripe";

import { chaosGate, isChaosFaultActive } from "@/lib/chaos";
import { getStripeSecretKey, isStripeConfigured } from "@/lib/stripe/env";
import { AppError } from "@/lib/errors";

type StripeGlobal = typeof globalThis & {
  __docmindStripe?: Stripe | null;
};

const g = globalThis as StripeGlobal;

export function getStripe(): Stripe {
  if (isChaosFaultActive("stripe_timeout")) {
    // Sync entrypoint — throw immediately; async path uses requireStripeAsync.
    throw new AppError(
      "BAD_REQUEST",
      "[chaos] Stripe timeout (simulé).",
      504,
    );
  }

  const key = getStripeSecretKey();
  if (!key) {
    throw new AppError(
      "BAD_REQUEST",
      "Stripe n’est pas configuré (STRIPE_SECRET_KEY manquant).",
      503,
    );
  }

  if (!g.__docmindStripe) {
    g.__docmindStripe = new Stripe(key, {
      apiVersion: "2026-06-24.dahlia",
      typescript: true,
      appInfo: {
        name: "DocMind",
        version: process.env.NEXT_PUBLIC_APP_VERSION || "0.1.0",
      },
    });
  }

  return g.__docmindStripe;
}

/** Async Stripe accessor — supports chaos delay before timeout. */
export async function getStripeAsync(): Promise<Stripe> {
  await chaosGate("stripe_timeout");
  return getStripe();
}

export function requireStripeConfigured(): void {
  if (!isStripeConfigured()) {
    throw new AppError(
      "BAD_REQUEST",
      "Stripe n’est pas configuré. Ajoutez STRIPE_SECRET_KEY et STRIPE_PRICE_PREMIUM.",
      503,
    );
  }
}
