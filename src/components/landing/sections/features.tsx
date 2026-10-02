import { LandingSectionHeader } from "@/components/landing/landing-section-header";
import {
  BellIcon,
  FileIcon,
  FolderIcon,
  LockIcon,
  MailIcon,
  SearchIcon,
} from "@/components/ui/icons";

const FEATURES = [
  {
    title: "Mémoire documentaire",
    text: "Chaque analyse devient une fiche : personnes, montants, échéances, mots-clés — consultable plus tard.",
    icon: FileIcon,
  },
  {
    title: "Recherche en français",
    text: "« Factures EDF », « contrats qui expirent cette année » — vos fiches d’abord, le texte ensuite.",
    icon: SearchIcon,
  },
  {
    title: "Alertes utiles",
    text: "Échéances, renouvellements et risques avec une action recommandée, avant qu’il soit trop tard.",
    icon: BellIcon,
  },
  {
    title: "Agent courrier",
    text: "Résiliation, remboursement, contestation : un brouillon basé sur les faits extraits (dès Basique).",
    icon: MailIcon,
  },
  {
    title: "Bibliothèque claire",
    text: "Aperçu PDF, dossiers, tags, favoris et filtres — toute votre pile au même endroit.",
    icon: FolderIcon,
  },
  {
    title: "Compte isolé",
    text: "Vos documents et analyses restent privés à votre compte. Pas de partage entre utilisateurs.",
    icon: LockIcon,
  },
] as const;

export function LandingFeatures() {
  return (
    <section
      id="fonctionnalites"
      className="landing-section border-t border-[var(--border)]"
    >
      <div className="mx-auto max-w-6xl px-5 py-20 sm:px-6 sm:py-28">
        <LandingSectionHeader
          eyebrow="Fonctionnalités"
          title="Tout pour piloter vos documents"
          description="Au-delà du résumé : retrouver, anticiper et agir sur votre pile administrative."
        />

        <ul className="mt-12 grid overflow-hidden rounded-[var(--radius-xl)] border border-[var(--hairline)] bg-[var(--hairline)] shadow-[var(--shadow-sm)] sm:mt-14 md:grid-cols-2 lg:grid-cols-3 [&>li]:bg-[var(--surface)] gap-px">
          {FEATURES.map((feature) => {
            const Icon = feature.icon;
            return (
              <li
                key={feature.title}
                className="group relative p-6 text-left transition-colors duration-200 hover:bg-[var(--surface-elevated)] sm:p-7"
              >
                <span className="landing-glyph transition-transform duration-300 ease-[var(--ease-spring)] group-hover:-translate-y-0.5">
                  <Icon className="h-4 w-4" />
                </span>
                <h3 className="mt-5 text-base font-semibold tracking-[-0.015em] text-[var(--foreground)]">
                  {feature.title}
                </h3>
                <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
                  {feature.text}
                </p>
              </li>
            );
          })}
        </ul>
      </div>
    </section>
  );
}
