const FEATURES = [
  {
    title: "Mémoire documentaire",
    text: "Chaque analyse devient une fiche : personnes, montants, échéances, mots-clés — consultable plus tard.",
  },
  {
    title: "Recherche en français",
    text: "« Factures EDF », « contrats qui expirent cette année » — vos fiches d’abord, le texte ensuite.",
  },
  {
    title: "Alertes utiles",
    text: "Échéances, renouvellements et risques avec une action recommandée, avant qu’il soit trop tard.",
  },
  {
    title: "Agent courrier",
    text: "Résiliation, remboursement, contestation : un brouillon basé sur les faits extraits (Premium).",
  },
  {
    title: "Bibliothèque claire",
    text: "Aperçu PDF, dossiers, tags, favoris et filtres — toute votre pile au même endroit.",
  },
  {
    title: "Compte isolé",
    text: "Vos documents et analyses restent privés à votre compte. Pas de partage entre utilisateurs.",
  },
] as const;

export function LandingFeatures() {
  return (
    <section
      id="fonctionnalites"
      className="landing-section border-t border-[var(--border)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Tout pour piloter vos documents
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Au-delà du résumé : une suite pour retrouver, anticiper et agir.
          </p>
        </div>

        <ul className="mt-14 grid gap-x-10 gap-y-12 sm:grid-cols-2 lg:grid-cols-3">
          {FEATURES.map((feature) => (
            <li key={feature.title} className="text-left">
              <h3 className="text-lg font-medium text-[var(--foreground)]">
                {feature.title}
              </h3>
              <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                {feature.text}
              </p>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
