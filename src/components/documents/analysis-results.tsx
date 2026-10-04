import type { ReactNode } from "react";

import {
  cleanActionForDisplay,
  cleanActionsForDisplay,
  cleanExcerptForDisplay,
  cleanProseForDisplay,
  cleanTitleForDisplay,
  dedupeDisplayItems,
  dedupeStringList,
} from "@/ai/post-processing/display-cleanup";
import {
  assuranceTitlePriority,
  filterGenericImportantPoints,
  isAssuranceFeeWatchTitle,
  isAssurancePenaltyWatchTitle,
  rankFindingsForWatch,
  resolveWatchDocFamily,
} from "@/ai/post-processing/watch-ranking";
import {
  buildWatchPointsFromCriteria,
  isProdDisplayNoise,
  normalizeFindingCriterionForDisplay,
  resolveDisplaySummary,
  sanitizeProductionDeadlines,
  shouldShowWatchEmptyState,
} from "@/ai/post-processing/prod-quality";
import { AnalysisTtsButton } from "@/components/documents/analysis-tts-button";
import { DocumentRelationsPanel } from "@/components/documents/document-relations-panel";
import { DocumentTimelinePanel } from "@/components/documents/document-timeline-panel";
import { DocumentSheetCard } from "@/components/documents/document-sheet-card";
import { LetterDraftPanel } from "@/components/documents/letter-draft-panel";
import { ReadyReplyCard } from "@/components/documents/ready-reply-card";
import { RiskScoreCard } from "@/components/documents/risk-score-card";
import { SatisfactionPrompt } from "@/components/documents/satisfaction-prompt";
import { CreateReminderAlert } from "@/components/alerts/create-reminder-alert";
import { Button, ProgressBar } from "@/components/ui";
import { AlertIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { parseAmountDisplay } from "@/services/extraction/amounts";
import type {
  CitedConclusion,
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  ReadyReply,
  RiskCriterionId,
  RiskFinding,
  RiskSeverity,
} from "@/types";
import type { MemoryRelationsPhase } from "@/types/memory";

interface AnalysisResultsProps {
  analysis: DocumentAnalysis;
  classification?: DocumentClassification;
  readyReply?: ReadyReply;
  sheet?: DocumentSheet | null;
  /** Si présent, active l’agent de rédaction de courrier. */
  historyId?: string;
  documentId?: string;
  /** Nom du PDF (filtre auto-relations à l’affichage). */
  fileName?: string | null;
  /** preview = P1 locale ; complete = P2 juridique */
  phase?: "preview" | "complete";
  /** Analyse P2 encore en cours (false si échec ou terminé). */
  backgroundPending?: boolean;
  /** Phase graphe mémoire (progressive enhancement). */
  relationsPhase?: MemoryRelationsPhase;
  onLetterDrafted?: (letter: ReadyReply) => void;
  className?: string;
}

interface AnalysisCardProps {
  title: string;
  tone: "neutral" | "info" | "warning" | "action";
  children: ReactNode;
  className?: string;
}

const toneAccent: Record<AnalysisCardProps["tone"], string> = {
  neutral: "bg-[var(--muted)]",
  info: "bg-[var(--accent)]",
  warning: "bg-[var(--danger)]",
  action: "bg-[var(--accent)]",
};

function AnalysisCard({ title, tone, children, className }: AnalysisCardProps) {
  return (
    <article
      className={cn(
        "animate-fade-up surface-panel flex h-full flex-col rounded-[var(--radius-2xl)] text-left",
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-[var(--hairline)] px-5 py-4 sm:px-6 sm:py-5">
        <span
          aria-hidden
          className={cn(
            "h-2 w-2 shrink-0 rounded-full shadow-[0_0_0_3px_color-mix(in_oklab,currentColor_14%,transparent)]",
            toneAccent[tone],
          )}
        />
        <h3 className="font-display text-xl tracking-tight text-[var(--foreground)] sm:text-[1.375rem]">
          {title}
        </h3>
      </header>
      <div className="flex-1 px-5 py-5 sm:px-6 sm:py-5">{children}</div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-sm text-[var(--muted)]">{label}</p>;
}

function BulletList({ items }: { items: string[] }) {
  const unique = dedupeStringList(items);
  if (unique.length === 0) {
    return <EmptyState label="Aucun élément identifié." />;
  }

  return (
    <ul className="space-y-3">
      {unique.map((item, index) => (
        <li
          key={`${index}-${item.slice(0, 24)}`}
          className="flex gap-3 text-[0.9375rem] leading-[1.65] text-[var(--foreground)]"
        >
          <span
            aria-hidden
            className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--border-strong)]"
          />
          <span>{cleanTitleForDisplay(item, 200)}</span>
        </li>
      ))}
    </ul>
  );
}

function ActionBulletList({ items }: { items: string[] }) {
  const cleaned = items
    .map((item) => cleanActionForDisplay(item))
    .filter((item): item is string => Boolean(item));
  const unique = dedupeStringList(cleaned);
  if (unique.length === 0) {
    return <EmptyState label="Aucune action concrète identifiée." />;
  }

  return (
    <ul className="space-y-3">
      {unique.map((item, index) => (
        <li
          key={`${index}-${item.slice(0, 24)}`}
          className="flex gap-3 text-[0.9375rem] leading-[1.65] text-[var(--foreground)]"
        >
          <span
            aria-hidden
            className="mt-2.5 h-1.5 w-1.5 shrink-0 rounded-full bg-[var(--border-strong)]"
          />
          <span>{item}</span>
        </li>
      ))}
    </ul>
  );
}

function AmountList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <EmptyState label="Aucun montant identifié." />;
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => {
        const { value, label } = parseAmountDisplay(item);
        return (
          <li
            key={`${index}-${item.slice(0, 32)}`}
            className="flex gap-2.5 text-sm leading-relaxed text-[var(--foreground)]"
          >
            <span
              aria-hidden
              className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
            />
            <span>
              <span className="font-medium tabular-nums">{value}</span>
              {label ? (
                <span className="text-[var(--muted)]"> — {label}</span>
              ) : null}
            </span>
          </li>
        );
      })}
    </ul>
  );
}

function MetaRow({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
        {label}
      </p>
      <p className="mt-1 text-sm font-medium text-[var(--foreground)]">
        {value || "—"}
      </p>
    </div>
  );
}

function severityLabel(severity: RiskSeverity): string {
  switch (severity) {
    case "critique":
      return "À vérifier en priorité";
    case "eleve":
      return "Important";
    case "modere":
      return "À noter";
    default:
      return "Faible";
  }
}

function severityBadgeClass(severity: RiskSeverity): string {
  switch (severity) {
    case "critique":
    case "eleve":
      return "border border-[color-mix(in_oklab,var(--danger)_22%,var(--border))] bg-[var(--surface)] text-[var(--danger)]";
    case "modere":
      return "border border-[color-mix(in_oklab,var(--warning)_22%,var(--border))] bg-[var(--surface)] text-[var(--warning)]";
    default:
      return "border border-[var(--border)] bg-[var(--surface)] text-[var(--muted)]";
  }
}

function statusLabel(status: RiskFinding["status"]): string {
  switch (status) {
    case "confirmed":
      return "Confirmé";
    case "ambiguous":
      return "À clarifier";
    default:
      return "Non retenu";
  }
}

function criterionPlainLabel(id: RiskCriterionId | undefined): string | null {
  switch (id) {
    case "frais_caches":
      return "Frais cachés";
    case "augmentation_tarif":
      return "Hausse automatique";
    case "renouvellement_tacite":
      return "Reconduction tacite";
    case "clauses_abusives":
      return "Clause délicate";
    case "penalites":
      return "Pénalités";
    case "resiliation":
      return "Résiliation";
    case "delais":
      return "Délais";
    case "obligations_importantes":
      return "Obligation importante";
    case "engagement":
      return "Engagement";
    case "sanctions":
      return "Sanctions";
    default:
      return null;
  }
}

/** Libellé UI : frais / pénalités mutuelle même si mal classés en obligations. */
function watchCategoryLabel(
  finding: RiskFinding,
  family: ReturnType<typeof resolveWatchDocFamily>,
): string | null {
  if (family === "assurance") {
    if (isAssuranceFeeWatchTitle(finding.description)) return "Frais cachés";
    if (isAssurancePenaltyWatchTitle(finding.description)) return "Pénalités";
    if (/carence/i.test(finding.description)) return "Délais";
    if (/tacite|reconduction/i.test(finding.description)) {
      return "Reconduction tacite";
    }
  }
  return criterionPlainLabel(finding.criterion_id);
}

/** Titre court lisible (1 ligne). */
function shortTitle(raw: string, max = 90): string {
  return cleanTitleForDisplay(raw, max);
}

/** 1–2 phrases d’explication grand public. */
function shortExplanation(finding: RiskFinding): string {
  const why = (finding.why || finding.justification || "").trim();
  const implication = (finding.implication || finding.impact || "").trim();
  const parts = [why, implication].filter(Boolean);
  const fallback =
    "Point signalé dans le document — à relire attentivement.";
  if (parts.length === 0) {
    const consequence = finding.consequence?.trim();
    const cleaned = cleanProseForDisplay(consequence || fallback, {
      minLength: 8,
    });
    return cleaned || fallback;
  }
  const text = parts.join(" ");
  const sentences = text.match(/[^.!?]+[.!?]+|[^.!?]+$/g) ?? [text];
  const joined = sentences.slice(0, 2).join(" ").trim();
  return cleanProseForDisplay(joined, { minLength: 8 }) || fallback;
}

function displayFindingField(raw: string | undefined | null): string {
  const cleaned = cleanProseForDisplay(raw, { minLength: 8 });
  return cleaned || "—";
}

type WatchPoint = {
  key: string;
  category: string | null;
  title: string;
  explanation: string;
  severity: RiskSeverity;
  finding?: RiskFinding;
  excerpt?: string;
};

/**
 * Si le top persisté n’a que tacite/carence, remonte frais / pénalités
 * depuis les findings restants ou les critères détectés (sans relancer P2).
 */
function supplementAssuranceWatchPoints(
  points: WatchPoint[],
  analysis: DocumentAnalysis,
  family: ReturnType<typeof resolveWatchDocFamily>,
): WatchPoint[] {
  const hasFee = points.some((p) => isAssuranceFeeWatchTitle(p.title));
  const hasPenalty = points.some((p) => isAssurancePenaltyWatchTitle(p.title));
  if (hasFee && hasPenalty) return points;

  const extras: WatchPoint[] = [];
  const seen = new Set(points.map((p) => p.title.toLowerCase()));

  const pushFinding = (finding: RiskFinding, keyPrefix: string) => {
    const normalized = normalizeFindingCriterionForDisplay(finding);
    const title = shortTitle(normalized.description);
    if (!title || isProdDisplayNoise(title)) return;
    if (seen.has(title.toLowerCase())) return;
    const explanation = shortExplanation(normalized);
    if (isProdDisplayNoise(explanation)) return;
    seen.add(title.toLowerCase());
    extras.push({
      key: `${keyPrefix}-${title.slice(0, 24)}`,
      category: watchCategoryLabel(normalized, family),
      title,
      explanation,
      severity: normalized.severity,
      finding: normalized,
      excerpt:
        cleanExcerptForDisplay(
          normalized.citation?.excerpt || normalized.excerpt,
        ) || undefined,
    });
  };

  for (const finding of analysis.risk_findings ?? []) {
    if (finding.status === "rejected") continue;
    const desc = finding.description || "";
    if (!hasFee && isAssuranceFeeWatchTitle(desc)) {
      pushFinding(finding, "as-fee");
    }
    if (!hasPenalty && isAssurancePenaltyWatchTitle(desc)) {
      pushFinding(finding, "as-pen");
    }
  }

  for (const criterion of analysis.risk_criteria ?? []) {
    if (!criterion.detected || criterion.score <= 0) continue;
    const reason = (criterion.reasons ?? []).find(
      (r) => typeof r === "string" && r.trim().length > 8,
    );
    if (!reason) continue;
    if (
      !hasFee &&
      criterion.id === "frais_caches" &&
      (isAssuranceFeeWatchTitle(reason) || /\d/.test(reason))
    ) {
      const title = shortTitle(
        isAssuranceFeeWatchTitle(reason)
          ? reason
          : `Frais de gestion : ${reason.match(/[\d\s.,]+\s*€(?:\s*\/\s*mois)?/i)?.[0] ?? reason}`,
      );
      if (title && !seen.has(title.toLowerCase()) && !isProdDisplayNoise(title)) {
        seen.add(title.toLowerCase());
        extras.push({
          key: `as-crit-fee-${title.slice(0, 20)}`,
          category: "Frais cachés",
          title,
          explanation:
            "Frais annexes ou de gestion repérés dans le contrat — à intégrer au coût réel.",
          severity: criterion.score >= 8 ? "eleve" : "modere",
        });
      }
    }
    if (
      !hasPenalty &&
      criterion.id === "penalites" &&
      (isAssurancePenaltyWatchTitle(reason) ||
        (/p[ée]nalit|radiation/i.test(reason) && /\d/.test(reason)))
    ) {
      const title = shortTitle(reason);
      if (title && !seen.has(title.toLowerCase()) && !isProdDisplayNoise(title)) {
        seen.add(title.toLowerCase());
        extras.push({
          key: `as-crit-pen-${title.slice(0, 20)}`,
          category: "Pénalités",
          title,
          explanation:
            "Pénalité chiffrée prévue au contrat — à anticiper en cas de radiation ou résiliation.",
          severity: criterion.score >= 8 ? "eleve" : "modere",
        });
      }
    }
  }

  // Montants du résumé / liste si toujours manquant (ex. « 3,91 € » frais gestion).
  if (!hasFee && !extras.some((e) => isAssuranceFeeWatchTitle(e.title))) {
    for (const amount of analysis.amounts ?? []) {
      if (typeof amount !== "string") continue;
      if (
        /frais|gestion|hors\s+cotisation/i.test(amount) &&
        /\d/.test(amount)
      ) {
        const title = shortTitle(
          /frais/i.test(amount) ? amount : `Frais de gestion : ${amount}`,
        );
        if (
          title &&
          !seen.has(title.toLowerCase()) &&
          !isProdDisplayNoise(title)
        ) {
          seen.add(title.toLowerCase());
          extras.push({
            key: `as-amt-fee-${title.slice(0, 20)}`,
            category: "Frais cachés",
            title,
            explanation:
              "Frais de gestion ou annexes mentionnés hors cotisation.",
            severity: "modere",
          });
          break;
        }
      }
    }
  }

  if (extras.length === 0) return points;
  return dedupeDisplayItems([...points, ...extras], (p) => p.title);
}

function buildWatchPoints(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): WatchPoint[] {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });
  const findings = (analysis.risk_findings ?? [])
    .filter((f) => f.status !== "rejected")
    .map(normalizeFindingCriterionForDisplay);
  // Priorité aux findings confirmés ; sinon ambigus (évite « rien » avec score élevé).
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const usable =
    confirmed.length > 0
      ? confirmed
      : findings.filter((f) => f.status === "ambiguous");

  const ranked = rankFindingsForWatch(usable, {
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });

  const fromFindings: WatchPoint[] = ranked.flatMap((finding, index) => {
    const title = shortTitle(finding.description);
    if (!title || isProdDisplayNoise(title)) return [];
    const explanation = shortExplanation(finding);
    if (isProdDisplayNoise(explanation)) return [];
    const excerptRaw =
      finding.citation?.excerpt || finding.excerpt || undefined;
    if (excerptRaw && isProdDisplayNoise(excerptRaw)) return [];
    return [
      {
        key: `rf-${index}-${finding.description.slice(0, 20)}`,
        category: watchCategoryLabel(finding, family),
        title,
        explanation,
        severity: finding.severity,
        finding,
        excerpt: cleanExcerptForDisplay(excerptRaw) || undefined,
      },
    ];
  });

  let dedupedFindings = dedupeDisplayItems(fromFindings, (p) => p.title);

  // Assurance / mutuelle : compléter depuis critères si frais / pénalités absents du top.
  if (family === "assurance") {
    dedupedFindings = supplementAssuranceWatchPoints(
      dedupedFindings,
      analysis,
      family,
    );
  }

  if (dedupedFindings.length > 0) {
    if (family === "assurance") {
      return [...dedupedFindings]
        .sort(
          (a, b) =>
            assuranceTitlePriority(a.title) - assuranceTitlePriority(b.title),
        )
        .slice(0, 8);
    }
    return dedupedFindings;
  }

  // Fallback : points importants / risques texte (P1 ou bundle sans findings)
  const importantTitles = filterGenericImportantPoints(
    analysis.important_point_findings?.length
      ? analysis.important_point_findings.map((p) => p.statement)
      : analysis.important_points,
  );
  const importantByTitle = new Map(
    (analysis.important_point_findings ?? []).map((p) => [
      p.statement,
      p.citation?.excerpt,
    ]),
  );
  const fromImportant: WatchPoint[] = importantTitles.flatMap((title, index) => {
    const cleanedTitle = shortTitle(title);
    if (!cleanedTitle || isProdDisplayNoise(cleanedTitle)) return [];
    return [
      {
        key: `ip-${index}`,
        category: "Point important",
        title: cleanedTitle,
        explanation:
          "Élément notable du document. L’analyse détaillée peut encore compléter ce point.",
        severity: "modere" as const,
        excerpt:
          cleanExcerptForDisplay(importantByTitle.get(title)) || undefined,
      },
    ];
  });

  const fromRisks: WatchPoint[] = (analysis.risks ?? []).flatMap((r, index) => {
    const title = shortTitle(r);
    if (!title || isProdDisplayNoise(title)) return [];
    return [
      {
        key: `rk-${index}`,
        category: "À surveiller",
        title,
        explanation: "Signalé comme un point de vigilance dans ce document.",
        severity: "modere" as const,
      },
    ];
  });

  const fallback = dedupeDisplayItems(
    [...fromImportant, ...fromRisks],
    (p) => p.title,
  ).slice(0, 8);
  if (fallback.length > 0) return fallback;

  return buildWatchPointsFromCriteria(analysis, classification).map(
    (point) => ({
      ...point,
      finding: undefined,
    }),
  );
}

function CitationBlock({
  page,
  paragraph,
  excerpt,
}: {
  page: number;
  paragraph: number;
  excerpt: string;
}) {
  const cleaned = cleanExcerptForDisplay(excerpt);
  if (!cleaned) return null;
  return (
    <div className="mt-3">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
        Extrait du document · p.{page} · §{paragraph}
      </p>
      <blockquote className="mt-1.5 border-l-2 border-[var(--border-strong)] pl-3 text-sm italic leading-[1.65] text-[var(--muted)]">
        « {cleaned} »
      </blockquote>
    </div>
  );
}

function WatchPointsSection({
  points,
  analysis,
  isPreview,
  isPreviewLoading,
}: {
  points: WatchPoint[];
  analysis: DocumentAnalysis;
  isPreview: boolean;
  isPreviewLoading: boolean;
}) {
  return (
    <section
      className="ui-card animate-fade-up rounded-[var(--radius-2xl)] text-left"
      aria-labelledby="watch-points-heading"
    >
      <header className="border-b border-[var(--hairline)] px-5 py-5 sm:px-7 sm:py-6">
        <h3
          id="watch-points-heading"
          className="flex items-center gap-3 font-display text-[1.625rem] tracking-tight text-[var(--foreground)]"
        >
          <span
            aria-hidden
            className="flex h-7 w-7 items-center justify-center rounded-[var(--radius-md)] bg-[var(--warning-soft)] text-[var(--warning)] shadow-[var(--highlight)]"
          >
            <AlertIcon className="h-3.5 w-3.5" />
          </span>
          Points à surveiller
        </h3>
        <p className="mt-1.5 max-w-2xl text-sm leading-relaxed text-[var(--muted)]">
          {isPreviewLoading
            ? "Aperçu rapide — l’analyse IA complétera bientôt les points critiques."
            : isPreview
              ? "Aperçu rapide — sections approfondies non disponibles."
              : "Les éléments les plus importants à vérifier en premier."}
        </p>
      </header>

      <div className="px-5 py-5 sm:px-7 sm:py-6">
        {isPreviewLoading && points.length === 0 ? (
          <PendingLegalBlock label="Points à surveiller" />
        ) : points.length === 0 ? (
          shouldShowWatchEmptyState(analysis) ? (
            <EmptyState label="Rien de critique détecté pour l’instant — les détails restent disponibles plus bas." />
          ) : (
            <p className="text-sm leading-relaxed text-[var(--muted)]">
              Des signaux sont présents dans le score et les montants ci-dessous —
              consultez le détail pour les preuves et actions.
            </p>
          )
        ) : (
          <ul className="space-y-4">
            {points.map((point) => (
              <li
                key={point.key}
                className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--surface-elevated)_70%,var(--surface))] shadow-[var(--highlight)] transition-[border-color,box-shadow] duration-200 hover:border-[var(--border)] hover:shadow-[var(--highlight),var(--shadow-sm)] px-4 py-4 sm:px-5 sm:py-5"
              >
                <div className="flex flex-wrap items-start justify-between gap-3">
                  <div className="min-w-0 flex-1">
                    {point.category ? (
                      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
                        {point.category}
                      </p>
                    ) : null}
                    <p className="mt-1 text-base font-semibold leading-snug text-[var(--foreground)] sm:text-[1.05rem]">
                      {point.title}
                    </p>
                  </div>
                  <span
                    className={cn(
                      "ui-badge shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
                      severityBadgeClass(point.severity),
                    )}
                  >
                    {severityLabel(point.severity)}
                  </span>
                </div>
                <p className="mt-3 text-[0.9375rem] leading-[1.65] text-[var(--foreground)]">
                  {point.explanation}
                </p>
                {point.excerpt ? (
                  <details className="mt-3.5 group">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--muted)] transition-colors hover:text-[var(--accent)]">
                      Voir l’extrait du document
                    </summary>
                    <blockquote className="mt-2.5 border-l-2 border-[var(--border-strong)] pl-3 text-sm italic leading-[1.65] text-[var(--muted)]">
                      « {point.excerpt} »
                    </blockquote>
                  </details>
                ) : null}
                {point.finding ? (
                  <details className="mt-2.5 group">
                    <summary className="cursor-pointer text-xs font-medium text-[var(--muted)] hover:text-[var(--foreground)]">
                      Détail complet
                    </summary>
                    <dl className="mt-3 space-y-3 text-xs leading-[1.6]">
                      <div>
                        <dt className="font-medium text-[var(--muted)]">
                          Pourquoi
                        </dt>
                        <dd className="text-[var(--foreground)]">
                          {displayFindingField(
                            point.finding.why || point.finding.justification,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[var(--muted)]">
                          Ce que ça change pour vous
                        </dt>
                        <dd className="text-[var(--foreground)]">
                          {displayFindingField(
                            point.finding.implication || point.finding.impact,
                          )}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[var(--muted)]">
                          Si vous ne faites rien
                        </dt>
                        <dd className="text-[var(--foreground)]">
                          {displayFindingField(point.finding.consequence)}
                        </dd>
                      </div>
                      <div>
                        <dt className="font-medium text-[var(--muted)]">
                          Que faire
                        </dt>
                        <dd className="text-[var(--foreground)]">
                          {displayFindingField(point.finding.mitigation)}
                        </dd>
                      </div>
                      <p className="text-[var(--muted)]">
                        {statusLabel(point.finding.status)} · confiance{" "}
                        {Math.round(point.finding.confidence * 100)} %
                      </p>
                    </dl>
                  </details>
                ) : null}
              </li>
            ))}
          </ul>
        )}
      </div>
    </section>
  );
}

function RiskFindingsList({ findings }: { findings: RiskFinding[] }) {
  const unique = dedupeDisplayItems(
    findings.filter((f) => f.status !== "rejected"),
    (f) => f.description,
  );
  if (unique.length === 0) {
    return <EmptyState label="Aucun élément identifié." />;
  }

  return (
    <ul className="space-y-4">
      {unique.map((finding, index) => {
        const citation = finding.citation;
        const excerpt = cleanExcerptForDisplay(
          citation?.excerpt || finding.excerpt,
        );
        return (
          <li
            key={`${index}-${finding.description.slice(0, 24)}`}
            className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--surface-elevated)_70%,var(--surface))] shadow-[var(--highlight)] transition-[border-color,box-shadow] duration-200 hover:border-[var(--border)] hover:shadow-[var(--highlight),var(--shadow-sm)] px-4 py-4 text-left sm:px-5"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-[0.9375rem] font-medium leading-snug text-[var(--foreground)]">
                {cleanTitleForDisplay(finding.description, 160)}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {statusLabel(finding.status)} · {severityLabel(finding.severity)} ·{" "}
                {Math.round(finding.confidence * 100)} %
              </p>
            </div>
            {excerpt ? (
              <CitationBlock
                page={citation?.page ?? 1}
                paragraph={citation?.paragraph ?? 1}
                excerpt={excerpt}
              />
            ) : citation?.excerpt || finding.excerpt ? null : (
              <p className="mt-2 text-xs text-[var(--danger)]">
                Conclusion sans preuve — non retenue.
              </p>
            )}
            <dl className="mt-4 space-y-3 text-xs leading-[1.6]">
              <div>
                <dt className="font-medium text-[var(--muted)]">Pourquoi</dt>
                <dd className="text-[var(--foreground)]">
                  {displayFindingField(finding.why || finding.justification)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--muted)]">
                  Ce que ça change pour vous
                </dt>
                <dd className="text-[var(--foreground)]">
                  {displayFindingField(finding.implication || finding.impact)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--muted)]">
                  Si vous ne faites rien
                </dt>
                <dd className="text-[var(--foreground)]">
                  {displayFindingField(finding.consequence)}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--muted)]">Que faire</dt>
                <dd className="text-[var(--foreground)]">
                  {displayFindingField(finding.mitigation)}
                </dd>
              </div>
            </dl>
          </li>
        );
      })}
    </ul>
  );
}

function CitedConclusionsList({ items }: { items: CitedConclusion[] }) {
  const unique = dedupeDisplayItems(items, (item) => item.statement);
  if (unique.length === 0) {
    return <EmptyState label="Aucun élément identifié." />;
  }

  return (
    <ul className="space-y-3">
      {unique.map((item, index) => (
        <li
          key={`${index}-${item.statement.slice(0, 24)}`}
          className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[color-mix(in_oklab,var(--surface-elevated)_70%,var(--surface))] shadow-[var(--highlight)] transition-[border-color,box-shadow] duration-200 hover:border-[var(--border)] hover:shadow-[var(--highlight),var(--shadow-sm)] px-4 py-3 text-left"
        >
          <p className="text-sm font-medium text-[var(--foreground)]">
            {cleanTitleForDisplay(item.statement, 160)}
          </p>
          <CitationBlock
            page={item.citation.page}
            paragraph={item.citation.paragraph}
            excerpt={item.citation.excerpt}
          />
        </li>
      ))}
    </ul>
  );
}

function PendingLegalBlock({ label }: { label: string }) {
  return (
    <p className="text-sm text-[var(--muted)]">
      {label} — analyse en cours… Cela peut prendre 1 à 3 minutes.
    </p>
  );
}

function PreviewSectionPlaceholder({
  label,
  loading,
}: {
  label: string;
  loading: boolean;
}) {
  if (loading) {
    return <PendingLegalBlock label={label} />;
  }
  return (
    <EmptyState
      label={`${label} — non disponible (analyse approfondie interrompue).`}
    />
  );
}

export function AnalysisResults({
  analysis,
  classification,
  readyReply,
  sheet,
  historyId,
  documentId,
  fileName,
  phase = "complete",
  backgroundPending,
  relationsPhase,
  onLetterDrafted,
  className,
}: AnalysisResultsProps) {
  const documentType =
    analysis.document_type || classification?.label || "Document";
  const isPreview = phase === "preview";
  const isPreviewLoading =
    isPreview && (backgroundPending ?? true);
  const watchPoints = buildWatchPoints(analysis, classification);
  const summary = resolveDisplaySummary(analysis, classification);
  const displayDeadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);
  const summaryTitle =
    cleanTitleForDisplay(analysis.title?.trim() || documentType) ||
    documentType;
  const ttsActions = cleanActionsForDisplay(analysis.actions ?? []);

  return (
    <section
      className={cn("w-full space-y-8", className)}
      aria-label="Résultat d'analyse"
    >
      {/* En-tête léger — TTS hors carte résumé (chrome UI ≠ texte d’analyse) */}
      <div className="flex flex-wrap items-end justify-between gap-4 text-left">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-[2.25rem] leading-[1.08] tracking-[-0.025em] text-[var(--foreground)] sm:text-[2.5rem]">
            {isPreview ? "Aperçu du document" : "Résultat de l’analyse"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            {isPreviewLoading
              ? "Aperçu disponible — l’analyse approfondie (risques, citations) est encore en cours."
              : isPreview
                ? "Aperçu disponible — l’analyse approfondie n’a pas abouti. Si un crédit avait été consommé, il a été rendu."
                : "Résumé et points à surveiller en premier — détails plus bas."}
          </p>
          {isPreviewLoading ? (
            <div className="mt-4 max-w-md">
              <ProgressBar
                indeterminate
                label="Analyse en arrière-plan — 1 à 3 minutes"
              />
            </div>
          ) : null}
        </div>

        <div className="flex flex-col items-stretch gap-3 sm:items-end">
          <div className="rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--surface)] px-4 py-2.5 text-left shadow-[var(--highlight),var(--shadow-xs)] sm:text-right">
            <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
              Type de document
            </p>
            <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
              {documentType}
            </p>
          </div>
          <AnalysisTtsButton
            documentKey={documentId ?? historyId ?? summaryTitle}
            title={summaryTitle}
            summary={summary ?? ""}
            watchPoints={watchPoints.map((p) => ({
              title: p.title,
              explanation: p.explanation,
            }))}
            actions={ttsActions}
          />
        </div>
      </div>

      {/* 1. Résumé — héros (texte d’analyse uniquement) */}
      <section
        className="ui-card-elevated animate-fade-up relative isolate overflow-hidden rounded-[var(--radius-2xl)] px-5 py-7 text-left sm:px-9 sm:py-9"
        aria-labelledby="analysis-summary-heading"
        data-analysis-summary
      >
        <div
          aria-hidden
          className="pointer-events-none absolute inset-0 -z-10 bg-[radial-gradient(ellipse_55%_70%_at_0%_0%,color-mix(in_oklab,var(--accent)_9%,transparent),transparent_65%)]"
        />
        <span
          aria-hidden
          className="pointer-events-none absolute inset-x-0 top-0 h-[2px] bg-[linear-gradient(90deg,var(--accent),color-mix(in_oklab,var(--accent)_20%,transparent)_60%,transparent)]"
        />
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
          Résumé
        </p>
        <h3
          id="analysis-summary-heading"
          className="mt-3 font-display text-[1.75rem] leading-[1.15] tracking-[-0.02em] text-[var(--foreground)] sm:text-[2.125rem]"
        >
          {summaryTitle}
        </h3>
        {summary || isPreviewLoading || isPreview ? (
          <p
            className="mt-5 max-w-3xl text-base leading-[1.7] text-[var(--foreground)] sm:text-[1.0625rem]"
            data-testid="analysis-summary-text"
          >
            {summary ||
              (isPreviewLoading
                ? "Aperçu en cours — un résumé plus complet arrivera après l’analyse (1 à 3 minutes)."
                : "Aperçu disponible — l’analyse approfondie n’a pas abouti.")}
          </p>
        ) : (
          <EmptyState label="Aucun résumé disponible pour ce document." />
        )}
        {(analysis.date || analysis.amounts?.length > 0) && (
          <div className="mt-7 flex flex-wrap gap-x-8 gap-y-2 border-t border-[var(--hairline)] pt-5 text-sm leading-relaxed tabular-nums text-[var(--muted)]">
            {analysis.date ? (
              <span>
                Date repérée :{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {analysis.date}
                </span>
              </span>
            ) : null}
            {analysis.amounts?.length ? (
              <span>
                Montants :{" "}
                <span className="font-medium text-[var(--foreground)]">
                  {analysis.amounts
                    .slice(0, 3)
                    .map((a) => {
                      const { value, label } = parseAmountDisplay(a);
                      return label ? `${value} (${label})` : value;
                    })
                    .join(" · ")}
                </span>
              </span>
            ) : null}
          </div>
        )}
      </section>

      {/* 2. Points à surveiller */}
      <WatchPointsSection
        points={watchPoints}
        analysis={analysis}
        isPreview={isPreview}
        isPreviewLoading={isPreviewLoading}
      />

      {/* Actions recommandées — toujours utiles, juste sous les points */}
      {!isPreview &&
      cleanActionsForDisplay(analysis.actions ?? []).length > 0 ? (
        <AnalysisCard title="Que faire ensuite" tone="action">
          <ActionBulletList items={analysis.actions} />
        </AnalysisCard>
      ) : null}

      {isPreview ? (
        <AnalysisCard title="Que faire ensuite" tone="action">
          <PreviewSectionPlaceholder
            label="Suggestions d’actions"
            loading={isPreviewLoading}
          />
        </AnalysisCard>
      ) : null}

      {!isPreview && historyId ? (
        <div className="flex flex-col gap-3 sm:flex-row sm:flex-wrap sm:items-start">
          <CreateReminderAlert
            historyId={historyId}
            defaultDueDate={displayDeadlines[0] ?? null}
          />
          <Button
            type="button"
            variant="secondary"
            size="sm"
            onClick={() => {
              document
                .getElementById("agent-courrier")
                ?.scrollIntoView({ behavior: "smooth", block: "start" });
            }}
          >
            Générer un courrier
          </Button>
        </div>
      ) : null}

      {/* 3. Reste — second plan, tout conservé */}
      <div className="space-y-5 border-t border-[var(--border)] pt-8 opacity-90">
        <div className="text-left">
          <h3 className="font-display text-base tracking-tight text-[var(--muted)] sm:text-lg">
            Détails complets
          </h3>
          <p className="mt-1 text-sm leading-relaxed text-[var(--muted)]">
            Score, fiches, entités, preuves et outils — mêmes données qu’avant.
          </p>
        </div>

        {sheet ? <DocumentSheetCard sheet={sheet} /> : null}

        <div className="grid gap-5 md:grid-cols-2">
          <div className="md:col-span-2">
            {isPreview ? (
              <AnalysisCard title="Score de risque" tone="neutral">
                <PreviewSectionPlaceholder
                  label="Score"
                  loading={isPreviewLoading}
                />
              </AnalysisCard>
            ) : (
              <RiskScoreCard
                assessment={{
                  risk_score: analysis.risk_score,
                  risk_level: analysis.risk_level,
                  risk_explanation: analysis.risk_explanation,
                  risk_criteria: analysis.risk_criteria,
                }}
              />
            )}
          </div>

          <div className="md:col-span-2">
            <AnalysisCard title="Informations du document" tone="neutral">
              <div className="grid gap-4 md:grid-cols-3">
                <MetaRow label="Titre" value={analysis.title} />
                <MetaRow label="Date" value={analysis.date} />
                <MetaRow label="Type" value={documentType} />
              </div>
            </AnalysisCard>
          </div>

          <AnalysisCard title="Personnes" tone="info">
            <BulletList items={analysis.people} />
          </AnalysisCard>

          <AnalysisCard title="Organisations" tone="info">
            <BulletList items={analysis.organizations} />
          </AnalysisCard>

          <AnalysisCard title="Montants" tone="action">
            <AmountList items={analysis.amounts} />
          </AnalysisCard>

          <AnalysisCard title="Échéances" tone="warning">
            <BulletList items={displayDeadlines} />
          </AnalysisCard>

          <AnalysisCard title="Dates" tone="info">
            <BulletList items={analysis.dates} />
          </AnalysisCard>

          <AnalysisCard
            title="Autres points importants"
            tone="info"
            className={isPreview ? undefined : "md:col-span-2"}
          >
            {isPreview ? (
              <BulletList items={analysis.important_points} />
            ) : analysis.important_point_findings &&
              analysis.important_point_findings.length > 0 ? (
              <CitedConclusionsList items={analysis.important_point_findings} />
            ) : (
              <BulletList items={analysis.important_points} />
            )}
          </AnalysisCard>

          <AnalysisCard
            title="Risques (détail technique)"
            tone="warning"
            className="md:col-span-2"
          >
            {isPreview ? (
              <PreviewSectionPlaceholder
                label="Risques et citations"
                loading={isPreviewLoading}
              />
            ) : analysis.risk_findings && analysis.risk_findings.length > 0 ? (
              <RiskFindingsList findings={analysis.risk_findings} />
            ) : (
              <BulletList items={analysis.risks} />
            )}
          </AnalysisCard>

          {!isPreview && documentId ? (
            <div className="md:col-span-2">
              <DocumentRelationsPanel
                documentId={documentId}
                fileName={fileName ?? sheet?.fileName ?? null}
                relationsPhase={relationsPhase}
              />
              <DocumentTimelinePanel documentId={documentId} className="mt-4" />
            </div>
          ) : null}

          {!isPreview && historyId ? (
            <div id="agent-courrier" className="md:col-span-2 space-y-4">
              <LetterDraftPanel
                historyId={historyId}
                initialReply={readyReply}
                onDrafted={onLetterDrafted}
              />
            </div>
          ) : null}

          {!isPreview && !historyId && readyReply ? (
            <div className="md:col-span-2">
              <ReadyReplyCard reply={readyReply} />
            </div>
          ) : null}
        </div>
      </div>

      {!isPreview ? (
        <SatisfactionPrompt
          historyId={historyId}
          documentId={documentId}
          documentType={documentType}
        />
      ) : null}
    </section>
  );
}
