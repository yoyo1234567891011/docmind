const STEPS = [
  {
    n: "01",
    title: "Importez",
    text: "Déposez un PDF. Le texte est extrait localement, page par page.",
  },
  {
    n: "02",
    title: "Analysez",
    text: "L’IA structure le document : type, montants, échéances, risques.",
  },
  {
    n: "03",
    title: "Agissez",
    text: "Alertes, recherche en français et courriers prêts à envoyer.",
  },
] as const;

export function LandingHowItWorks() {
  return (
    <section
      id="fonctionnement"
      className="landing-section border-t border-[var(--border)] bg-[var(--background-deep)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            En 3 étapes
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Du PDF à l’action — sans coller le document dans un chat.
          </p>
        </div>

        <ol className="mt-14 grid gap-10 md:grid-cols-3 md:gap-8">
          {STEPS.map((step) => (
            <li key={step.n} className="text-left">
              <p className="font-display text-3xl text-[var(--accent)]">
                {step.n}
              </p>
              <h3 className="mt-3 text-lg font-medium text-[var(--foreground)]">
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
