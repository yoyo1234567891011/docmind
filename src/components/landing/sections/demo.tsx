import Link from "next/link";

import { landingCtaPrimary } from "@/components/landing/landing-cta-styles";
import { LandingSectionHeader } from "@/components/landing/landing-section-header";
import { ChevronRightIcon, FileIcon } from "@/components/ui/icons";

const RESULT_ROWS = [
  {
    label: "Fiche",
    value: "Bail · SCI Horizon · 980 € · échéance 31/08/2027",
    dot: "bg-[var(--accent)]",
    delay: "",
    strong: false,
  },
  {
    label: "Risque",
    value: "Renouvellement automatique — vérifier la date de résiliation.",
    dot: "bg-[var(--warning)]",
    delay: "landing-demo-line-delay-1",
    strong: false,
  },
  {
    label: "Action",
    value: "Préparer un courrier de résiliation avant le 31/07/2027.",
    dot: "bg-[var(--foreground)]",
    delay: "landing-demo-line-delay-2",
    strong: true,
  },
] as const;

export function LandingDemo() {
  return (
    <section id="demo" className="landing-section">
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <LandingSectionHeader
          eyebrow="Aperçu produit"
          title="Ce que vous obtenez en un PDF"
          description="Une fiche structurée, un risque prioritaire et une action concrète — pas un long pavé de chat."
        />

        <div className="relative mt-12 sm:mt-14">
          <div
            aria-hidden
            className="pointer-events-none absolute -inset-x-8 -inset-y-10 -z-10 bg-[radial-gradient(ellipse_60%_55%_at_50%_50%,color-mix(in_oklab,var(--accent)_10%,transparent),transparent_70%)]"
          />
          <div className="landing-demo-stage overflow-hidden rounded-[var(--radius-2xl)] border border-[var(--hairline)] bg-[var(--surface)] shadow-[var(--highlight),var(--shadow-lg)]">
            <div className="flex items-center gap-2 border-b border-[var(--hairline)] bg-[color-mix(in_oklab,var(--background-deep)_35%,var(--surface))] px-4 py-3">
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
              <span className="h-2.5 w-2.5 rounded-full bg-[var(--border-strong)]" />
              <span className="ml-3 inline-flex items-center gap-1.5 rounded-[var(--radius-sm)] border border-[var(--hairline)] bg-[var(--surface)] px-2 py-0.5 font-mono text-[11px] text-[var(--muted)]">
                <FileIcon className="h-3 w-3" />
                analyse · bail-habitation.pdf
              </span>
            </div>

            <div className="grid gap-0 lg:grid-cols-[1.1fr_0.9fr]">
              <div className="relative min-h-[280px] border-b border-[var(--hairline)] bg-[var(--background-deep)] p-6 sm:p-8 lg:border-b-0 lg:border-r">
                <div className="landing-demo-page mx-auto max-w-md space-y-3 rounded-[var(--radius-md)] border border-[var(--hairline)] bg-[var(--surface)] p-6 text-left text-sm leading-relaxed text-[var(--muted)] shadow-[var(--shadow-sm)]">
                  <p className="font-display text-lg text-[var(--foreground)]">
                    Bail d’habitation — SCI Horizon
                  </p>
                  <p>
                    Loyer mensuel 980 € · Dépôt de garantie 1 960 € · Entrée des
                    lieux le 01/09/2026.
                  </p>
                  <p>
                    <mark className="rounded-[3px] bg-[color-mix(in_oklab,var(--warning)_16%,transparent)] px-0.5 text-[var(--foreground)]">
                      Reconduction tacite annuelle.
                    </mark>{" "}
                    Préavis de résiliation : un mois avant l’échéance.
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

              <ol className="divide-y divide-[var(--hairline)] text-left">
                {RESULT_ROWS.map((row) => (
                  <li
                    key={row.label}
                    className={`landing-demo-line ${row.delay} px-6 py-5 sm:px-8`}
                  >
                    <p className="flex items-center gap-2 text-[11px] font-semibold uppercase text-[var(--muted)]">
                      <span aria-hidden className={`h-1.5 w-1.5 rounded-full ${row.dot}`} />
                      {row.label}
                    </p>
                    <p
                      className={
                        row.strong
                          ? "mt-1.5 text-[15px] font-medium text-[var(--foreground)]"
                          : "mt-1.5 text-[15px] text-[var(--foreground)]"
                      }
                    >
                      {row.value}
                    </p>
                  </li>
                ))}
              </ol>
            </div>
          </div>
        </div>

        <div className="mt-10 flex flex-wrap items-center gap-x-5 gap-y-3">
          <Link href="/auth/signup" className={landingCtaPrimary}>
            Analyser mon PDF
            <ChevronRightIcon className="h-4 w-4 transition-transform duration-200 group-hover:translate-x-0.5" />
          </Link>
          <p className="text-sm text-[var(--muted)]">
            Même format pour factures, assurances, prêts et courriers admin.
          </p>
        </div>
      </div>
    </section>
  );
}
