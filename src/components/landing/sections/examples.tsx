/**
 * Exemples anonymisés — pure UI marketing (pas d’analyse live).
 * Pas de faux témoignages clients.
 */
import { LandingSectionHeader } from "@/components/landing/landing-section-header";

const EXAMPLES = [
  {
    title: "Bail d’habitation",
    fiche: "Loyer, dépôt, durée, préavis et clause de reconduction.",
    risque: "Renouvellement tacite si le préavis n’est pas respecté.",
    action: "Noter la date limite et préparer un courrier de résiliation.",
  },
  {
    title: "Facture d’énergie",
    fiche: "Montant TTC, période, options et éventuels frais annexes.",
    risque: "Surfacturation ou option peu claire dans le décompte.",
    action: "Contester le montant ou demander un décompte corrigé.",
  },
  {
    title: "Contrat d’assurance",
    fiche: "Cotisation, franchise, échéance annuelle et modalités de résiliation.",
    risque: "Date de résiliation trop proche ou conditions mal lues.",
    action: "Créer une alerte avant l’échéance et vérifier le préavis.",
  },
] as const;

const ROWS = [
  { key: "fiche", label: "Fiche", dot: "bg-[var(--accent)]", tone: "text-[var(--accent)]" },
  { key: "risque", label: "Risque", dot: "bg-[var(--warning)]", tone: "text-[var(--warning)]" },
  { key: "action", label: "Action", dot: "bg-[var(--foreground)]", tone: "text-[var(--muted)]" },
] as const;

export function LandingExamples() {
  return (
    <section
      id="exemples"
      className="landing-section border-t border-[var(--border)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <LandingSectionHeader
          eyebrow="Cas concrets"
          title="Trois situations types"
          description="Ce que vous pouvez attendre d’une fiche Échélia — exemples anonymisés, sans document réel ni avis inventé."
        />

        <ul className="mt-12 grid gap-5 sm:mt-14 md:grid-cols-3">
          {EXAMPLES.map((item) => (
            <li
              key={item.title}
              className="landing-card landing-card-hover flex flex-col overflow-hidden text-left"
            >
              <h3 className="border-b border-[var(--hairline)] px-6 py-5 font-display text-2xl tracking-tight text-[var(--foreground)]">
                {item.title}
              </h3>
              <dl className="flex-1 divide-y divide-[var(--hairline)] text-sm leading-relaxed">
                {ROWS.map((row) => (
                  <div key={row.key} className="px-6 py-4">
                    <dt
                      className={`flex items-center gap-2 text-[11px] font-medium uppercase ${row.tone}`}
                    >
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${row.dot}`} />
                      {row.label}
                    </dt>
                    <dd
                      className={
                        row.key === "action"
                          ? "mt-1.5 font-medium text-[var(--foreground)]"
                          : "mt-1.5 text-[var(--foreground)]"
                      }
                    >
                      {item[row.key]}
                    </dd>
                  </div>
                ))}
              </dl>
            </li>
          ))}
        </ul>
      </div>
    </section>
  );
}
