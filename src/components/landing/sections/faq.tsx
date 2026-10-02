"use client";

import Link from "next/link";
import type { ReactNode } from "react";

import { LandingSectionHeader } from "@/components/landing/landing-section-header";

const FAQ_ITEMS: Array<{ q: string; a: ReactNode }> = [
  {
    q: "En quoi Échélia est différent de ChatGPT ?",
    a: "ChatGPT est un chat généraliste où l’on colle souvent un PDF. Échélia construit une mémoire privée (fiches, alertes, recherche, historique) et prépare des actions. L’analyse passe par une API dédiée (Groq), pas par ChatGPT public.",
  },
  {
    q: "Où vont mes documents ?",
    a: (
      <>
        Vous téléversez un PDF : le texte est extrait sur nos serveurs. Seul ce
        texte est envoyé à Groq (États-Unis) pour l’analyse — le fichier PDF
        n’est pas transmis au prestataire IA. Votre compte est isolé (pas de
        partage entre utilisateurs). Échélia n’entraîne pas de modèles sur vos
        documents. Détails :{" "}
        <Link
          href="/confidentialite"
          className="font-medium text-[var(--accent)] hover:underline"
        >
          confidentialité
        </Link>
        {" · "}
        <a
          href="https://groq.com/privacy-policy/"
          target="_blank"
          rel="noreferrer"
          className="font-medium text-[var(--accent)] hover:underline"
        >
          politique Groq
        </a>
        .
      </>
    ),
  },
  {
    q: "Quels PDF sont acceptés ?",
    a: "Uniquement les PDF avec texte sélectionnable. Les scans / photos / PDF image ne sont pas supportés pour l’instant (pas d’OCR). Comptez environ 1 à 3 minutes pour une analyse complète. Détails dans le Guide.",
  },
  {
    q: "Dois-je installer un logiciel ?",
    a: "Non. Échélia fonctionne dans le navigateur. Créez un compte, déposez un PDF texte — l’analyse démarre automatiquement.",
  },
  {
    q: "Faut-il une carte bancaire pour commencer ?",
    a: "Non. L’offre Gratuite suffit pour analyser, rechercher et recevoir des alertes. L’agent courrier est inclus dès Basique.",
  },
  {
    q: "Puis-je changer ou annuler mon abonnement facilement ?",
    a: "Oui. Depuis Facturation → portail Stripe : annulation en fin de période déjà payée. Aucun engagement long. Détails dans les CGV.",
  },
  {
    q: "Échélia remplace-t-il un avocat ?",
    a: "Non. C’est un outil d’aide à la lecture et à l’organisation. Les conclusions restent à valider selon votre situation.",
  },
];

export function LandingFaq() {
  return (
    <section
      id="faq"
      className="landing-section border-t border-[var(--border)] bg-[var(--background-deep)]"
    >
      <div className="mx-auto grid max-w-6xl gap-12 px-5 py-20 sm:px-6 sm:py-28 lg:grid-cols-[minmax(0,0.8fr)_minmax(0,1.2fr)] lg:gap-16">
        <LandingSectionHeader
          eyebrow="FAQ"
          title="Questions fréquentes"
          description="Les objections avant de créer un compte — réponses directes."
          className="lg:sticky lg:top-24 lg:self-start"
        />

        <div className="landing-card divide-y divide-[var(--hairline)] overflow-hidden">
          {FAQ_ITEMS.map((item) => (
            <details
              key={item.q}
              className="group transition-colors duration-200 open:bg-[color-mix(in_oklab,var(--accent)_3%,var(--surface))]"
            >
              <summary className="cursor-pointer list-none px-5 py-5 text-left text-[15px] font-medium tracking-[-0.01em] text-[var(--foreground)] transition-colors marker:content-none hover:bg-[color-mix(in_oklab,var(--foreground)_3%,transparent)] sm:px-6 [&::-webkit-details-marker]:hidden">
                <span className="flex items-start justify-between gap-4">
                  {item.q}
                  <span
                    aria-hidden
                    className="mt-px flex h-6 w-6 shrink-0 items-center justify-center rounded-full border border-[var(--hairline)] text-[var(--muted)] transition-[transform,color,border-color,background-color] duration-300 ease-[var(--ease-out)] group-open:rotate-45 group-open:border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] group-open:bg-[var(--accent-soft)] group-open:text-[var(--accent)]"
                  >
                    +
                  </span>
                </span>
              </summary>
              <div className="max-w-2xl px-5 pb-5 text-sm leading-relaxed text-[var(--muted)] sm:px-6">
                {item.a}
              </div>
            </details>
          ))}
        </div>
      </div>
    </section>
  );
}
