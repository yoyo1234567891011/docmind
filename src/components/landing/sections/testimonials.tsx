/**
 * Outcomes produit — pas d’avis clients inventés.
 */
import { LandingSectionHeader } from "@/components/landing/landing-section-header";

const OUTCOMES = [
  {
    title: "Éviter une reconduction tacite",
    text: "Bail ou assurance : Échélia remonte la date de préavis et l’action à mener avant renouvellement automatique.",
  },
  {
    title: "Suivre vos échéances",
    text: "Paiements, résiliations et renouvellements apparaissent dans vos alertes et votre vue Mes échéances.",
  },
  {
    title: "Préparer un courrier",
    text: "Brouillon de résiliation, contestation ou remboursement à partir des faits déjà extraits (dès Basique).",
  },
  {
    title: "Retrouver dans vos documents",
    text: "Recherche en français sur vos fiches : montants, organisations, dates — sans relire toute la pile PDF.",
  },
] as const;

export function LandingTestimonials() {
  return (
    <section
      id="preuves"
      className="landing-section border-t border-[var(--border)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <LandingSectionHeader
          eyebrow="Résultats"
          title="Ce qu’Échélia vous permet de faire"
          description="Des usages concrets dès le premier PDF — sans témoignages inventés."
        />

        <ul className="mt-12 grid gap-5 sm:mt-14 sm:grid-cols-2">
          {OUTCOMES.map((item) => (
            <li
              key={item.title}
              className="landing-card landing-card-hover group overflow-hidden p-6 text-left sm:p-7"
            >
              <span
                aria-hidden
                className="absolute inset-y-6 left-0 w-[2px] rounded-full bg-[var(--accent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
              />
              <h3 className="font-display text-2xl leading-snug tracking-tight text-[var(--foreground)]">
                {item.title}
              </h3>
              <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
                {item.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
