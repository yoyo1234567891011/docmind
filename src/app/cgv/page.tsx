import type { Metadata } from "next";
import Link from "next/link";

import { legalContactEmail, legalEntityName } from "@/config/legal";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Conditions générales de vente",
  description: `CGV ${siteConfig.name} — abonnement Premium`,
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
      <h1 className="font-display text-4xl tracking-tight">
        Conditions générales de vente
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Dernière mise à jour : 30 juillet 2026 · {legalEntityName()}
      </p>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Offre Premium</h2>
        <p>
          L’abonnement Premium est un service en ligne à durée mensuelle (ou
          selon le prix Stripe configuré), renouvelé automatiquement tant
          qu’il n’est pas résilié. Le prix TTC est affiché sur la page
          Facturation avant paiement.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Paiement</h2>
        <p>
          Les paiements sont traités par Stripe. DocMind ne stocke pas les
          numéros de carte. En cas d’échec de paiement, l’accès Premium peut
          être suspendu après les relances Stripe.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Résiliation</h2>
        <p>
          Vous pouvez annuler le renouvellement depuis Facturation. L’accès
          Premium reste actif jusqu’à la fin de la période déjà payée, sauf
          résiliation immédiate via le portail Stripe ou cas prévus (fraude,
          litige).
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Remboursements</h2>
        <p>
          Les demandes de remboursement sont examinées au cas par cas. Un
          remboursement intégral du dernier paiement peut entraîner la
          révocation immédiate de l’accès Premium.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Droit de rétractation</h2>
        <p>
          Conformément au Code de la consommation, pour un contenu numérique
          fourni immédiatement après acceptation, vous reconnaissez démarrer
          l’exécution du service et, le cas échéant, renoncer au délai de
          rétractation de 14 jours lorsque la loi le permet.
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
