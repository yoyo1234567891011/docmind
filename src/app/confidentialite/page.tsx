import type { Metadata } from "next";
import Link from "next/link";

import { legalContactEmail, legalEntityName } from "@/config/legal";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Confidentialité",
  description: `Politique de confidentialité ${siteConfig.name} — RGPD.`,
  robots: { index: true, follow: true },
};

export default function PrivacyPage() {
  const contact = legalContactEmail();
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-5 py-10 text-left sm:px-6">
      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          ← Accueil
        </Link>
      </p>
      <h1 className="font-display text-4xl tracking-tight">
        Confidentialité & RGPD
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Dernière mise à jour : 30 juillet 2026 · {siteConfig.name}
      </p>

      <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground)]">
        <h2 className="font-display text-2xl">Responsable de traitement</h2>
        <p>
          {legalEntityName()}
          <br />
          Contact :{" "}
          <a
            href={`mailto:${contact}`}
            className="text-[var(--accent)] hover:underline"
          >
            {contact}
          </a>
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed text-[var(--foreground)]">
        <h2 className="font-display text-2xl">Données traitées</h2>
        <p>
          Compte (email, nom), documents PDF que vous téléversez, textes
          extraits, analyses, alertes, préférences, et données de facturation
          Stripe (identifiants client / abonnement — pas le numéro de carte
          stocké chez DocMind). Des cookies techniques de session sont utilisés
          pour l’authentification.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Finalités</h2>
        <p>
          Fournir l’analyse documentaire, la mémoire / recherche, les alertes,
          l’agent courrier Premium, et la facturation. Base légale :
          exécution du contrat et intérêt légitime (sécurité, amélioration
          produit anonymisée).
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Hébergement & sous-traitants</h2>
        <p>
          L’analyse LLM s’effectue via Ollama sur l’infrastructure configurée
          pour le service. Authentification : Supabase. Paiements : Stripe.
          Consultez leurs politiques respectives.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Vos droits</h2>
        <p>
          Accès, rectification, portabilité (RGPD Art. 20), opposition, et
          effacement. Depuis{" "}
          <Link href="/profil" className="text-[var(--accent)] hover:underline">
            votre profil
          </Link>
          , vous pouvez télécharger un export ZIP ou supprimer votre compte.
          Réclamation possible auprès de la CNIL (
          <a
            href="https://www.cnil.fr"
            className="text-[var(--accent)] hover:underline"
            target="_blank"
            rel="noreferrer"
          >
            cnil.fr
          </a>
          ). Contact :{" "}
          <a
            href={`mailto:${contact}`}
            className="text-[var(--accent)] hover:underline"
          >
            {contact}
          </a>
          .
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Conservation</h2>
        <p>
          Les documents et analyses sont conservés tant que le compte est
          actif. Après suppression de compte, les fichiers utilisateur sont
          effacés ; des journaux techniques agrégés peuvent être retenus pour
          la sécurité.
        </p>
      </section>

      <p className="text-xs text-[var(--muted)]">
        Voir aussi :{" "}
        <Link href="/cgu" className="hover:underline">
          CGU
        </Link>
        {" · "}
        <Link href="/cgv" className="hover:underline">
          CGV
        </Link>
        {" · "}
        <Link href="/mentions-legales" className="hover:underline">
          Mentions légales
        </Link>
      </p>
    </article>
  );
}
