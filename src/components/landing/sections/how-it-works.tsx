import { LandingSectionHeader } from "@/components/landing/landing-section-header";

const STEPS = [
  {
    n: "01",
    title: "Importez",
    text: "Déposez un PDF texte (pas de scan). Le texte est extrait sur nos serveurs.",
  },
  {
    n: "02",
    title: "Analysez",
    text: "L’IA structure le document via un prestataire dédié (Groq) : type, montants, échéances, risques — pas ChatGPT public.",
  },
  {
    n: "03",
    title: "Agissez",
    text: "Alertes, recherche en français et courriers prêts à envoyer (~1 à 3 min pour l’analyse complète).",
  },
] as const;

export function LandingHowItWorks() {
  return (
    <section
      id="fonctionnement"
      className="landing-section border-t border-[var(--border)] bg-[var(--background-deep)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <LandingSectionHeader
          eyebrow="Parcours"
          title="En trois étapes"
          description="Du PDF à l’action — sans coller le document dans un chat public."
        />

        <ol className="mt-12 grid gap-5 sm:mt-14 md:grid-cols-3 md:gap-6">
          {STEPS.map((step) => (
            <li
              key={step.n}
              className="landing-card landing-card-hover p-6 text-left sm:p-7"
            >
              <span className="flex h-10 w-10 items-center justify-center rounded-full border border-[color-mix(in_oklab,var(--accent)_35%,var(--border))] bg-[var(--accent-soft)] font-mono text-xs font-medium tabular-nums text-[var(--accent)] shadow-[var(--highlight)]">
                {step.n}
              </span>
              <h3 className="mt-5 font-display text-2xl tracking-tight text-[var(--foreground)]">
                {step.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {step.text}
              </p>
            </li>
          ))}
        </ol>
      </div>
    </section>
  );
}
