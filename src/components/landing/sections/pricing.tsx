"use client";

import Link from "next/link";

import { BILLING_PLANS } from "@/config/billing";

/** Copy landing — bénéfices utilisateur (pas de jargon Stripe). */
const LANDING_PLANS = [
  {
    id: "free" as const,
    name: BILLING_PLANS.free.name,
    priceLabel: "Gratuit",
    period: null as string | null,
    description: "Pour analyser vos premiers PDF et constituer votre mémoire.",
    features: [
      "Analyses PDF privées",
      "Mémoire documentaire & recherche",
      "Alertes échéances / risques",
      "Bibliothèque de documents",
      "Sans carte bancaire",
    ],
    cta: "Commencer gratuitement",
    href: "/auth/signup",
    highlight: false,
  },
  {
    id: "premium" as const,
    name: BILLING_PLANS.premium.name,
    priceLabel: `${BILLING_PLANS.premium.priceMonthlyEur} €`,
    period: "/ mois",
    description:
      "Quand vous voulez passer de l’analyse au courrier prêt à envoyer.",
    features: [
      "Tout l’offre Gratuite",
      "Agent courrier (résiliation, contestation…)",
      "Support prioritaire",
      "Nouveautés en avant-première",
      "Résiliable à tout moment",
    ],
    cta: "Essayer Premium",
    href: "/auth/signup?next=/facturation",
    highlight: true,
  },
] as const;

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
            Commencez gratuitement. Passez à Premium seulement pour les
            courriers IA.
          </p>
        </div>

        <div className="mt-14 grid gap-6 md:grid-cols-2 md:gap-8">
          {LANDING_PLANS.map((plan) => (
            <div
              key={plan.id}
              className={
                plan.highlight
                  ? "rounded-xl border border-[var(--accent)] bg-[var(--surface)] p-6 sm:p-8"
                  : "rounded-xl border border-[var(--border)] bg-[var(--surface)] p-6 sm:p-8"
              }
            >
              <p className="text-sm font-medium text-[var(--muted)]">
                {plan.name}
              </p>
              <p className="mt-2 font-display text-4xl tracking-tight text-[var(--foreground)]">
                {plan.priceLabel}
                {plan.period ? (
                  <span className="ml-2 text-base font-sans text-[var(--muted)]">
                    {plan.period}
                  </span>
                ) : null}
              </p>
              <p className="mt-1 text-sm text-[var(--muted)]">
                {plan.description}
              </p>
              <ul className="mt-6 space-y-2.5 text-sm text-[var(--foreground)]">
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
                href={plan.href}
                className={
                  plan.highlight
                    ? "mt-8 inline-flex h-11 w-full items-center justify-center rounded-md bg-[var(--accent)] text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
                    : "mt-8 inline-flex h-11 w-full items-center justify-center rounded-md border border-[var(--border-strong)] text-sm font-medium text-[var(--foreground)] transition-colors hover:border-[var(--accent)] hover:text-[var(--accent)]"
                }
              >
                {plan.cta}
              </Link>
            </div>
          ))}
        </div>
      </div>
    </section>
  );
}
