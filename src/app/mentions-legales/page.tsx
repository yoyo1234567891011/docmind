import type { Metadata } from "next";
import Link from "next/link";

import {
  legalAddress,
  legalContactEmail,
  legalEntityName,
} from "@/config/legal";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Mentions légales",
  description: `Mentions légales ${siteConfig.name}`,
  robots: { index: true, follow: true },
};

export default function MentionsLegalesPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-5 py-10 text-left sm:px-6">
      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          ← Accueil
        </Link>
      </p>
      <h1 className="font-display text-4xl tracking-tight">Mentions légales</h1>
      <p className="text-sm text-[var(--muted)]">
        Dernière mise à jour : 30 juillet 2026
      </p>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Éditeur</h2>
        <p>
          {legalEntityName()}
          <br />
          {legalAddress()}
          <br />
          Contact :{" "}
          <a
            href={`mailto:${legalContactEmail()}`}
            className="text-[var(--accent)] hover:underline"
          >
            {legalContactEmail()}
          </a>
        </p>
        <p className="text-[var(--muted)]">
          Complétez SIRET, forme juridique et directeur de publication via les
          variables d’environnement légales avant ouverture au public.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Hébergement</h2>
        <p>
          Application web hébergée par l’infrastructure choisie par l’éditeur
          (à préciser : hébergeur, adresse). Authentification : Supabase.
          Paiements : Stripe.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Propriété intellectuelle</h2>
        <p>
          L’ensemble des éléments de {siteConfig.name} (marque, textes,
          interface) est protégé. Toute reproduction non autorisée est
          interdite.
        </p>
      </section>
    </article>
  );
}
