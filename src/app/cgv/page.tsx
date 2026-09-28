import type { Metadata } from "next";
import Link from "next/link";

import {
  BILLING_PLANS,
  getPlanQuotaFeatureLines,
} from "@/config/billing";
import { legalContactEmail, legalEntityName } from "@/config/legal";
import { siteConfig } from "@/config/site";
import type { BillingPlanId } from "@/types/billing";

const PLAN_ORDER: BillingPlanId[] = [
  "free",
  "basique",
  "pro",
  "premium",
  "extra",
];

export const metadata: Metadata = {
  title: "Conditions générales de vente",
  description: `CGV ${siteConfig.name} — offres Gratuit, Basique, Pro, Premium, Extra`,
  robots: { index: true, follow: true },
};

export default function CgvPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-5 py-10 text-left sm:px-6">
      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          ← Accueil
        </Link>
      </p>
      <h1 className="font-display text-3xl tracking-tight md:text-4xl">
        Conditions générales de vente
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Dernière mise à jour : 28 septembre 2026 · {legalEntityName()}
      </p>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Offres</h2>
        <p>
          DocMind propose une offre Gratuite et des abonnements payants
          mensuels (Basique, Pro, Premium, Extra). Les prix TTC, quotas
          (analyses, recherches, courriers) et fonctionnalités sont affichés
          sur la page d’accueil et sur{" "}
          <Link href="/facturation" className="text-[var(--accent)] hover:underline">
            Facturation
          </Link>{" "}
          avant tout paiement. Il n’y a pas d’engagement de durée : chaque
          abonnement se renouvelle automatiquement jusqu’à résiliation.
        </p>
        <ul className="mt-3 list-disc space-y-2 pl-5">
          {PLAN_ORDER.map((id) => {
            const plan = BILLING_PLANS[id];
            const price =
              plan.priceMonthlyEur == null
                ? "Gratuit"
                : `${plan.priceMonthlyEur.toLocaleString("fr-FR", {
                    minimumFractionDigits: 2,
                  })} € / mois`;
            return (
              <li key={id}>
                <strong>{plan.name}</strong> — {price}.{" "}
                {getPlanQuotaFeatureLines(id).join(" · ")}.
              </li>
            );
          })}
        </ul>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Paiement</h2>
        <p>
          Les paiements sont traités par Stripe. DocMind ne stocke pas les
          numéros de carte. En cas d’échec de paiement, l’accès au plan payant
          est suspendu (quotas de l’offre Gratuite) jusqu’à régularisation via
          le portail de facturation. Le statut « paiement en retard » reste
          visible sur Facturation.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Résiliation</h2>
        <p>
          Vous pouvez résilier à tout moment depuis Facturation → « Gérer /
          Annuler l’abonnement » (portail Stripe). L’annulation prend effet à
          la fin de la période déjà payée : vous conservez l’accès jusqu’à
          cette date, sans renouvellement ensuite. Aucun engagement minimum.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Remboursements</h2>
        <p>
          Les demandes de remboursement sont examinées au cas par cas
          (manuel). Un remboursement intégral du dernier paiement peut
          entraîner la révocation immédiate de l’accès payant.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Droit de rétractation</h2>
        <p>
          Conformément au Code de la consommation, pour un service numérique
          fourni immédiatement, vous pouvez disposer d’un délai de
          rétractation de 14 jours. En cochant la case d’acceptation avant le
          paiement Stripe, vous demandez l’exécution immédiate du service et
          reconnaissez renoncer à ce délai de rétractation pour la période
          déjà consommée, dans les conditions prévues par la loi.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Contact</h2>
        <p>
          <a
            href={`mailto:${legalContactEmail()}`}
            className="text-[var(--accent)] hover:underline"
          >
            {legalContactEmail()}
          </a>
        </p>
      </section>
    </article>
  );
}
