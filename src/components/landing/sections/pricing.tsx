"use client";

import Link from "next/link";

import { BILLING_PLANS } from "@/config/billing";
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
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Tarifs simples
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Commencez gratuitement. Passez à Pro pour l’agent courrier, ou
            choisissez le volume qui vous convient.
          </p>
        </div>

        <div className="mt-14 grid gap-4 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
          {PLAN_ORDER.map((id) => {
            const plan = BILLING_PLANS[id];
            const extra = LANDING_EXTRA[id];
            const highlight = Boolean(plan.highlighted);
            return (
              <div
                key={id}
                className={
                  highlight
                    ? "rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-5 sm:p-6"
                    : "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-5 sm:p-6"
                }
              >
                <p className="text-sm font-medium text-[var(--muted)]">
                  {plan.name}
                  {highlight ? " · recommandé" : ""}
                </p>
                <p className="mt-2 font-display text-3xl tracking-tight text-[var(--foreground)]">
                  {plan.priceMonthlyEur == null
                    ? "Gratuit"
                    : `${plan.priceMonthlyEur} €`}
                  {extra.period ? (
                    <span className="ml-1 text-base font-sans text-[var(--muted)]">
                      {extra.period}
                    </span>
                  ) : null}
                </p>
                <p className="mt-1 text-sm text-[var(--muted)]">
                  {plan.description}
                </p>
                <ul className="mt-5 space-y-2 text-sm text-[var(--foreground)]">
                  {plan.features.map((feature) => (
                    <li key={feature} className="flex gap-2">
                      <span className="text-[var(--accent)]" aria-hidden>
                        —
                      </span>
                      <span>{feature}</span>
                    </li>
                  ))}
                </ul>
                <Link
                  href={extra.href}
                  className={
                    highlight
                      ? "mt-6 inline-flex h-11 w-full items-center justify-center rounded-md bg-[var(--accent)] text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
                      : "mt-6 inline-flex h-11 w-full items-center justify-center rounded-md border border-[var(--border-strong)] text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
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
