import type { Metadata } from "next";
import Link from "next/link";

import { legalContactEmail, legalEntityName } from "@/config/legal";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Cookies",
  description: `Cookies techniques ${siteConfig.name} — session, Stripe, Supabase.`,
  robots: { index: true, follow: true },
};

export default function CookiesPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-5 py-10 text-left sm:px-6">
      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          ← Accueil
        </Link>
      </p>
      <h1 className="font-display text-3xl tracking-tight md:text-4xl">
        Cookies
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Dernière mise à jour : 28 septembre 2026 · {legalEntityName()}
      </p>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Cookies techniques uniquement</h2>
        <p>
          {siteConfig.name} utilise des cookies ou stockage technique
          nécessaires au fonctionnement du service : session
          d’authentification (Supabase), sécurité (CSRF), préférences
          d’affichage (thème), et paiement / portail (Stripe). Aucun cookie
          publicitaire ou de mesure d’audience marketing n’est déposé par
          Échélia.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Sous-traitants</h2>
        <p>
          Supabase (auth / session) et Stripe (checkout, portail client)
          peuvent déposer leurs propres cookies techniques lors de l’usage de
          leurs interfaces. Consultez leurs politiques respectives.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Plus d’infos</h2>
        <p>
          Détail des traitements :{" "}
          <Link
            href="/confidentialite"
            className="text-[var(--accent)] hover:underline"
          >
            politique de confidentialité
          </Link>
          . Contact :{" "}
          <a
            href={`mailto:${legalContactEmail()}`}
            className="text-[var(--accent)] hover:underline"
          >
            {legalContactEmail()}
          </a>
          .
        </p>
      </section>
    </article>
  );
}
