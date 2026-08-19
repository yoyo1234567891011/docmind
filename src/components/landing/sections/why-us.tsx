const REASONS = [
  {
    title: "Pas ChatGPT sur vos PDF",
    text: "ChatGPT résume un fichier qu’il faut lui coller. DocMind structure chaque document dans une mémoire privée : fiches, alertes, recherche, historique — sans coller le contenu dans un chat public.",
  },
  {
    title: "Privé par conception",
    text: "Vos documents restent dans votre espace isolé. L’analyse IA est dédiée à votre compte — vos PDF ne sont pas collés dans un chat public ni partagés entre utilisateurs.",
  },
  {
    title: "Décision, pas résumé",
    text: "Score de risque, échéances datées, actions et courriers : vous savez quoi faire avant un renouvellement ou un paiement.",
  },
] as const;

export function LandingWhyUs() {
  return (
    <section
      id="pourquoi"
      className="landing-section border-t border-[var(--border)] bg-[var(--background-deep)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[0.9fr_1.1fr] lg:items-start">
          <div>
            <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
              Pourquoi pas ChatGPT
            </h2>
            <p className="mt-3 max-w-md text-base leading-relaxed text-[var(--muted)] sm:text-lg">
              Un assistant généraliste ne remplace pas un outil métier sur vos
              documents administratifs.
            </p>
          </div>
          <ul className="space-y-8">
            {REASONS.map((reason) => (
              <li
                key={reason.title}
                className="border-t border-[var(--border)] pt-6 text-left first:border-t-0 first:pt-0"
              >
                <h3 className="text-lg font-medium text-[var(--foreground)]">
                  {reason.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  {reason.text}
                </p>
              </li>
            ))}
          </ul>
        </div>
      </div>
    </section>
  );
}
