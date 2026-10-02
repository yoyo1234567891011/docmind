"use client";

import Link from "next/link";

import {
  landingCtaPrimaryBlock,
  landingCtaSecondaryBlock,
} from "@/components/landing/landing-cta-styles";
import { LandingSectionHeader } from "@/components/landing/landing-section-header";
import { CheckIcon } from "@/components/ui/icons";
import { BILLING_PLANS, getPlanCardFeatures } from "@/config/billing";
import type { BillingPlanId } from "@/types/billing";

const PLAN_ORDER: BillingPlanId[] = [
  "free",
  "basique",
  "pro",
  "premium",
  "extra",
];

const LANDING_EXTRA: Record<
  BillingPlanId,
  { cta: string; href: string; period: string | null }
> = {
  free: {
    cta: "Commencer gratuitement",
    href: "/auth/signup",
    period: null,
  },
  basique: {
    cta: "Choisir Basique",
    href: "/auth/signup?next=/facturation",
    period: "/ mois",
  },
  pro: {
    cta: "Essayer Pro",
    href: "/auth/signup?next=/facturation",
    period: "/ mois",
  },
  premium: {
    cta: "Choisir Premium",
    href: "/auth/signup?next=/facturation",
    period: "/ mois",
  },
  extra: {
    cta: "Choisir Extra",
    href: "/auth/signup?next=/facturation",
    period: "/ mois",
  },
};

export function LandingPricing() {
  return (
    <section
      id="tarifs"
      className="landing-section border-t border-[var(--border)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <LandingSectionHeader
          eyebrow="Tarifs"
          title="Des offres simples et transparentes"
          description="Commencez gratuitement. PDF texte uniquement (pas de scans). L’agent courrier est inclus dès Basique."
        />

        <div className="mt-12 grid items-stretch gap-4 sm:mt-14 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLAN_ORDER.map((id) => {
            const plan = BILLING_PLANS[id];
            const extra = LANDING_EXTRA[id];
            const highlight = Boolean(plan.highlighted);
            return (
              <div
                key={id}
                className={
                  highlight
                    ? "relative flex h-full flex-col rounded-[var(--radius-xl)] border border-[color-mix(in_oklab,var(--accent)_55%,var(--border))] bg-[linear-gradient(180deg,color-mix(in_oklab,var(--accent)_6%,var(--surface)),var(--surface)_45%)] p-5 shadow-[var(--highlight),0_0_0_1px_color-mix(in_oklab,var(--accent)_20%,transparent),var(--shadow-lg)] sm:p-6 xl:-my-2 xl:py-8"
                    : "relative flex h-full flex-col rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--surface)] p-5 shadow-[var(--highlight),var(--shadow-sm)] transition-[border-color,box-shadow,transform] duration-200 hover:-translate-y-0.5 hover:border-[var(--border-strong)] hover:shadow-[var(--highlight),var(--shadow-md)] sm:p-6"
                }
              >
                <div className="flex min-h-0 flex-1 flex-col">
                  <p className="flex flex-wrap items-center gap-2 text-sm font-medium tracking-[-0.01em] text-[var(--foreground)]">
                    {plan.name}
                    {highlight ? (
                      <span className="ui-badge border-[color-mix(in_oklab,var(--accent)_30%,transparent)] bg-[var(--accent-soft)] text-[var(--accent)]">
                        recommandé
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-4 flex flex-wrap items-baseline gap-x-1 gap-y-1 font-display text-[2.5rem] leading-none tracking-tight text-[var(--foreground)]">
                    {plan.priceMonthlyEur == null
                      ? "Gratuit"
                      : `${plan.priceMonthlyEur} €`}
                    {extra.period ? (
                      <span className="font-sans text-sm tracking-normal text-[var(--muted)]">
                        {extra.period}
                      </span>
                    ) : null}
                  </p>
                  <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                    {plan.description}
                  </p>
                  <div aria-hidden className="ui-divider-fade my-5" />
                  <ul className="space-y-2.5 text-sm leading-relaxed text-[var(--foreground)]">
                    {getPlanCardFeatures(id).map((feature) => (
                      <li key={feature} className="flex gap-2.5">
                        <CheckIcon
                          className={
                            highlight
                              ? "mt-0.5 h-4 w-4 text-[var(--accent)]"
                              : "mt-0.5 h-4 w-4 text-[color-mix(in_oklab,var(--accent)_70%,var(--muted))]"
                          }
                        />
                        <span>{feature}</span>
                      </li>
                    ))}
                  </ul>
                </div>
                <Link
                  href={extra.href}
                  className={
                    highlight ? landingCtaPrimaryBlock : landingCtaSecondaryBlock
                  }
                >
                  {extra.cta}
                </Link>
              </div>
            );
          })}
        </div>
      </div>
    </section>
  );
}
