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

/** Stripe est utilisable pour checkout / webhooks. */
export function isStripeConfigured(): boolean {
  return Boolean(
    getStripeSecretKey() && process.env.STRIPE_PRICE_PREMIUM?.trim(),
  );
}
