import {
  getAppBaseUrl,
  getStripePriceIdForPlan,
} from "@/config/billing";
import { AppError } from "@/lib/errors";
import { getStripe } from "@/lib/stripe";
import { PAID_BILLING_PLAN_IDS } from "@/types/billing";
import type Stripe from "stripe";

const CONFIG_META = "docmind_plan_change";

/**
 * Configuration Portal dédiée au confirm de changement de plan
 * (`always_invoice` — aligné sur PLAN_CHANGE_PRORATION_UPDATE).
 */
export async function ensurePlanChangePortalConfiguration(
  stripe: ReturnType<typeof getStripe>,
): Promise<string> {
  const listed = await stripe.billingPortal.configurations.list({
    limit: 50,
    active: true,
  });
  const existing = listed.data.find(
    (c) => c.metadata?.[CONFIG_META] === "true",
  );

  const products = await buildPortalProducts(stripe);
  if (products.length === 0) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Aucun price Stripe configuré pour le portail de changement de plan.",
      503,
    );
  }

  const features: Stripe.BillingPortal.ConfigurationCreateParams.Features = {
    customer_update: {
      enabled: true,
      allowed_updates: ["email", "address"],
    },
    invoice_history: { enabled: true },
    payment_method_update: { enabled: true },
    subscription_cancel: {
      enabled: true,
      mode: "at_period_end",
      proration_behavior: "none",
    },
    subscription_update: {
      enabled: true,
      default_allowed_updates: ["price"],
      proration_behavior: "always_invoice",
      products,
    },
  };

  if (existing) {
    const needsUpdate =
      !existing.features.subscription_update?.enabled ||
      existing.features.subscription_update.proration_behavior !==
        "always_invoice";
    if (needsUpdate) {
      const updated = await stripe.billingPortal.configurations.update(
        existing.id,
        { features },
      );
      return updated.id;
    }
    return existing.id;
  }

  const created = await stripe.billingPortal.configurations.create({
    business_profile: {
      headline: "Confirmer votre changement de plan DocMind",
    },
    features,
    metadata: { [CONFIG_META]: "true" },
  });
  return created.id;
}

async function buildPortalProducts(
  stripe: ReturnType<typeof getStripe>,
): Promise<
  Stripe.BillingPortal.ConfigurationCreateParams.Features.SubscriptionUpdate.Product[]
> {
  const byProduct = new Map<string, Set<string>>();

  for (const plan of PAID_BILLING_PLAN_IDS) {
    const priceId = getStripePriceIdForPlan(plan);
    if (!priceId) continue;
    try {
      const price = await stripe.prices.retrieve(priceId);
      const productId =
        typeof price.product === "string" ? price.product : price.product?.id;
      if (!productId) continue;
      const set = byProduct.get(productId) ?? new Set<string>();
      set.add(priceId);
      byProduct.set(productId, set);
    } catch {
      // price manquant / invalide — ignore
    }
  }

  return [...byProduct.entries()].map(([product, prices]) => ({
    product,
    prices: [...prices],
  }));
}

/**
 * Session Portal deep-link : confirmation Stripe du changement de price
 * (carte + 3DS). Aucun `subscriptions.update` côté app avant cette page.
 */
export async function createPlanChangePortalSession(input: {
  customerId: string;
  subscriptionId: string;
  subscriptionItemId: string;
  newPriceId: string;
}): Promise<{ url: string }> {
  const stripe = getStripe();
  const configuration = await ensurePlanChangePortalConfiguration(stripe);

  const session = await stripe.billingPortal.sessions.create({
    customer: input.customerId,
    configuration,
    return_url: `${getAppBaseUrl()}/facturation?checkout=success`,
    flow_data: {
      type: "subscription_update_confirm",
      subscription_update_confirm: {
        subscription: input.subscriptionId,
        items: [
          {
            id: input.subscriptionItemId,
            price: input.newPriceId,
            quantity: 1,
          },
        ],
      },
      after_completion: {
        type: "redirect",
        redirect: {
          return_url: `${getAppBaseUrl()}/facturation?checkout=success`,
        },
      },
    },
  });

  if (!session.url) {
    throw new AppError(
      "INTERNAL_ERROR",
      "Impossible d’ouvrir la confirmation Stripe du changement de plan.",
      502,
    );
  }

  return { url: session.url };
}
