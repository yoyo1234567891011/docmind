/**
 * Preuves orientées résultat (pas d’avis clients inventés).
 * Les faux témoignages “illustratifs” détruisent la confiance en conversion.
 */
const OUTCOMES = [
  {
    title: "Éviter un renouvellement tacite",
    text: "Bail ou assurance : DocMind remonte la date limite et l’action à mener avant préavis.",
  },
  {
    title: "Gagner du temps par dossier",
    text: "Fiche + risques + prochaines étapes en une lecture — sans relire 20 pages de conditions.",
  },
  {
    title: "Garder le contrôle des données",
    text: "Analyse via Ollama en local : vos PDF ne sont pas collés dans un chat cloud généraliste.",
  },
] as const;

export function LandingTestimonials() {
  return (
    <section
      id="preuves"
      className="landing-section border-t border-[var(--border)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Preuves concrètes
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Ce que DocMind doit vous permettre de faire dès le premier PDF —
            sans testimonials inventés.
          </p>
        </div>

        <ul className="mt-14 grid gap-10 md:grid-cols-3">
          {OUTCOMES.map((item) => (
            <li key={item.title} className="text-left">
              <h3 className="font-display text-xl leading-snug tracking-tight text-[var(--foreground)] sm:text-2xl">
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
