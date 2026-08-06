import type { Metadata } from "next";
import Link from "next/link";

import { legalContactEmail, legalEntityName } from "@/config/legal";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Conditions générales d’utilisation",
  description: `CGU ${siteConfig.name}`,
  robots: { index: true, follow: true },
};

export default function CguPage() {
  return (
    <article className="mx-auto max-w-3xl space-y-6 px-5 py-10 text-left sm:px-6">
      <p className="text-sm text-[var(--muted)]">
        <Link href="/" className="hover:text-[var(--accent)]">
          ← Accueil
        </Link>
      </p>
      <h1 className="font-display text-4xl tracking-tight">
        Conditions générales d’utilisation
      </h1>
      <p className="text-sm text-[var(--muted)]">
        Dernière mise à jour : 30 juillet 2026 · {legalEntityName()}
      </p>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Objet</h2>
        <p>
          Les présentes CGU régissent l’accès et l’usage de {siteConfig.name},
          service d’analyse documentaire assistée. L’inscription vaut
          acceptation des CGU et de la{" "}
          <Link
            href="/confidentialite"
            className="text-[var(--accent)] hover:underline"
          >
            politique de confidentialité
          </Link>
          .
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Compte</h2>
        <p>
          Vous êtes responsable de la confidentialité de vos identifiants et
          des documents que vous téléversez. Vous garantissez disposer des
          droits nécessaires sur ces documents.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Service</h2>
        <p>
          Les analyses et suggestions sont fournies à titre d’aide à la
          décision. Elles ne constituent pas un conseil juridique
          personnalisé. En cas de doute, consultez un professionnel.
        </p>
      </section>

      <section className="space-y-2 text-sm leading-relaxed">
        <h2 className="font-display text-2xl">Abonnement payant</h2>
        <p>
          Les conditions tarifaires et de résiliation de l’offre Premium sont
          précisées dans les{" "}
          <Link href="/cgv" className="text-[var(--accent)] hover:underline">
            CGV
          </Link>
          .
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
