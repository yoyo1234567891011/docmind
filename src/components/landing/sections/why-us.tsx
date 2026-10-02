import { LandingSectionHeader } from "@/components/landing/landing-section-header";

const REASONS = [
  {
    title: "Vos PDF restent hors du chat public",
    text: "Avec ChatGPT, vous collez souvent le document dans un fil généraliste. Avec Échélia, vous téléversez un PDF dans votre compte : le texte est extrait sur nos serveurs, puis seul ce texte est envoyé à une API d’analyse dédiée (Groq). Le fichier PDF n’est pas collé dans un chat public.",
  },
  {
    title: "Une mémoire, pas une conversation jetable",
    text: "Échélia structure chaque document en fiche (montants, échéances, risques, actions) et la conserve dans votre espace isolé. Vous retrouvez l’historique, les alertes et la recherche — sans recommencer à zéro à chaque PDF.",
  },
  {
    title: "Décider avant la date limite",
    text: "Score de risque, points à surveiller, échéances datées et brouillons de courrier : l’objectif n’est pas un résumé vague, c’est de savoir quoi faire avant un préavis, un renouvellement ou un paiement.",
  },
] as const;

export function LandingWhyUs() {
  return (
    <section
      id="pourquoi"
      className="landing-section border-t border-[var(--border)] bg-[var(--background-deep)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="grid gap-12 lg:grid-cols-[minmax(0,0.9fr)_minmax(0,1.1fr)] lg:items-start lg:gap-20">
          <LandingSectionHeader
            eyebrow="Différenciation"
            title="Pourquoi pas ChatGPT seul ?"
            description="ChatGPT aide à lire une page. Échélia organise vos documents administratifs dans un parcours privé, durable et orienté action."
            className="lg:sticky lg:top-24"
          />
          <ol className="grid gap-4">
            {REASONS.map((reason, index) => (
              <li
                key={reason.title}
                className="landing-card landing-card-hover grid grid-cols-[auto_1fr] gap-x-5 p-6 text-left sm:p-7"
              >
                <span className="font-mono text-xs font-medium tabular-nums text-[var(--accent)]">
                  {String(index + 1).padStart(2, "0")}
                </span>
                <div>
                  <h3 className="text-lg font-semibold tracking-[-0.015em] text-[var(--foreground)]">
                    {reason.title}
                  </h3>
                  <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                    {reason.text}
                  </p>
                </div>
              </li>
            ))}
          </ol>
        </div>
      </div>
    </section>
  );
}
