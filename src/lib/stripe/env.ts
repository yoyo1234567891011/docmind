import { areStripePaidPricesConfigured } from "@/config/billing";

export function getStripeSecretKey(): string | undefined {
  return process.env.STRIPE_SECRET_KEY?.trim() || undefined;
}

export function getStripeWebhookSecret(): string | undefined {
  return process.env.STRIPE_WEBHOOK_SECRET?.trim() || undefined;
}

export function getStripePublishableKey(): string | undefined {
  return (
    process.env.NEXT_PUBLIC_STRIPE_PUBLISHABLE_KEY?.trim() || undefined
  );
}

/** Stripe est utilisable pour checkout / webhooks (4 prices + secret). */
export function isStripeConfigured(): boolean {
  return Boolean(getStripeSecretKey() && areStripePaidPricesConfigured());
}
