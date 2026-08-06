import Link from "next/link";

export function LandingDemo() {
  return (
    <section id="demo" className="landing-section border-t border-[var(--border)]">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <div className="max-w-2xl">
          <h2 className="font-display text-4xl tracking-tight text-[var(--foreground)] sm:text-5xl">
            Ce que vous obtenez en 1 PDF
          </h2>
          <p className="mt-3 text-base leading-relaxed text-[var(--muted)] sm:text-lg">
            Fiche structurée, risque prioritaire, action concrète — pas un long
            pavé de chat.
          </p>
        </div>

        <div className="landing-demo-stage mt-12 overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--surface)]">
          <div className="flex items-center gap-2 border-b border-[var(--border)] px-4 py-3">
            <span className="h-2 w-2 rounded-sm bg-[var(--border-strong)]" />
            <span className="h-2 w-2 rounded-sm bg-[var(--border-strong)]" />
            <span className="h-2 w-2 rounded-sm bg-[var(--border-strong)]" />
            <span className="ml-2 text-xs text-[var(--muted)]">
              analyse · bail-habitation.pdf
            </span>
          </div>

          <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
            <div className="relative min-h-[280px] border-b border-[var(--border)] bg-[var(--background-deep)] p-6 lg:border-b-0 lg:border-r">
              <div className="landing-demo-page space-y-3 text-left text-sm leading-relaxed text-[var(--muted)]">
                <p className="font-medium text-[var(--foreground)]">
                  Bail d’habitation — SCI Horizon
                </p>
                <p>
                  Loyer mensuel 980 € · Dépôt de garantie 1 960 € · Entrée des
                  lieux le 01/09/2026.
                </p>
                <p>
                  Reconduction tacite annuelle. Préavis de résiliation : un
                  mois avant l’échéance.
                </p>
                <p>
                  En cas de retard de paiement supérieur à quinze jours, des
                  pénalités pourront être appliquées.
                </p>
              </div>
              <div
                aria-hidden
                className="landing-demo-beam pointer-events-none absolute inset-x-6 top-0 h-16"
              />
            </div>

            <div className="space-y-5 p-6 text-left">
              <div className="landing-demo-line">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Fiche
                </p>
                <p className="mt-1 text-sm text-[var(--foreground)]">
                  Bail · SCI Horizon · 980 € · échéance 31/08/2027
                </p>
              </div>
              <div className="landing-demo-line landing-demo-line-delay-1">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Risque
                </p>
                <p className="mt-1 text-sm text-[var(--foreground)]">
                  Renouvellement automatique — vérifier la date de résiliation.
                </p>
              </div>
              <div className="landing-demo-line landing-demo-line-delay-2">
                <p className="text-[11px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
                  Action
                </p>
                <p className="mt-1 text-sm text-[var(--foreground)]">
                  Préparer un courrier de résiliation avant le 31/07/2027.
                </p>
              </div>
            </div>
          </div>
        </div>

        <div className="mt-8">
          <Link
            href="/auth/signup"
            className="inline-flex h-11 items-center rounded-md bg-[var(--accent)] px-5 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
          >
            Analyser mon PDF
          </Link>
        </div>
      </div>
    </section>
  );
}
