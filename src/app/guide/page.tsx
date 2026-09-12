import type { Metadata } from "next";
import Link from "next/link";

import { GuideStartButton } from "@/components/guide/guide-start-button";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: "Guide",
  description: `Comment utiliser ${siteConfig.name} : documents adaptés, étapes d’analyse et conseils.`,
};

export default function GuidePage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div className="mx-auto max-w-2xl px-5 py-12 text-left sm:px-6 sm:py-16">
        <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
          Premiers pas
        </p>
        <h1 className="mt-2 font-display text-4xl tracking-tight text-[var(--foreground)]">
          Guide
        </h1>
        <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
          Tout ce qu’il faut savoir pour analyser votre premier document en
          toute confiance.
        </p>

        <div className="mt-10 space-y-6">
          <article className="surface-panel rounded-2xl p-5 sm:p-6">
            <h2 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
              À quoi ça sert
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--foreground)]">
              DocMind analyse vos documents pour faire ressortir les frais
              cachés, délais, obligations et points à surveiller.
            </p>
          </article>

          <article className="surface-panel rounded-2xl p-5 sm:p-6">
            <h2 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
              Documents adaptés
            </h2>
            <p className="mt-3 text-sm leading-relaxed text-[var(--foreground)]">
              Factures, relevés bancaires, contrats, baux, assurances,
              mutuelles, mises en demeure, courriers administratifs.
            </p>
            <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
              Documents PDF avec texte sélectionnable uniquement. Les PDF
              scannés ou photos ne sont pas pris en charge pour l’instant.
            </p>
          </article>

          <article className="surface-panel rounded-2xl p-5 sm:p-6">
            <h2 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
              Comment ça marche
            </h2>
            <ol className="mt-3 list-decimal space-y-2.5 pl-5 text-sm leading-relaxed text-[var(--foreground)]">
              <li>Uploadez un PDF</li>
              <li>Voyez un aperçu rapide</li>
              <li>
                Attendez l’analyse complète (environ 1 à 3 minutes)
              </li>
              <li>Consultez le résumé et les points à surveiller</li>
            </ol>
          </article>

          <article className="surface-panel rounded-2xl p-5 sm:p-6">
            <h2 className="font-display text-2xl tracking-tight text-[var(--foreground)]">
              Conseils
            </h2>
            <ul className="mt-3 space-y-2.5 text-sm leading-relaxed text-[var(--foreground)]">
              <li className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
                />
                <span>Préférez un PDF texte natif</span>
              </li>
              <li className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
                />
                <span>Un document à la fois pour commencer</span>
              </li>
              <li className="flex gap-2.5">
                <span
                  aria-hidden
                  className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
                />
                <span>
                  Si l’analyse est longue, patientez ou réessayez un peu plus
                  tard
                </span>
              </li>
            </ul>
          </article>
        </div>

        <GuideStartButton />

        <p className="mt-6 text-sm text-[var(--muted)]">
          Ou{" "}
          <Link
            href="/analyser"
            className="font-medium text-[var(--accent)] hover:underline"
          >
            aller directement à Analyser
          </Link>{" "}
          (le guide restera accessible dans le menu).
        </p>
      </div>
    </section>
  );
}
