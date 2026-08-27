import type { ReactNode } from "react";

import {
  cleanActionForDisplay,
  cleanActionsForDisplay,
  cleanExcerptForDisplay,
  cleanProseForDisplay,
  cleanSummaryForDisplay,
  cleanTitleForDisplay,
  dedupeDisplayItems,
  dedupeStringList,
} from "@/ai/post-processing/display-cleanup";
import {
  filterGenericImportantPoints,
  rankFindingsForWatch,
} from "@/ai/post-processing/watch-ranking";
import { DocumentRelationsPanel } from "@/components/documents/document-relations-panel";
import { DocumentTimelinePanel } from "@/components/documents/document-timeline-panel";
import { DocumentSheetCard } from "@/components/documents/document-sheet-card";
import { LetterDraftPanel } from "@/components/documents/letter-draft-panel";
import { ReadyReplyCard } from "@/components/documents/ready-reply-card";
import { RiskScoreCard } from "@/components/documents/risk-score-card";
import { SatisfactionPrompt } from "@/components/documents/satisfaction-prompt";
import { ProgressBar } from "@/components/ui";
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
        "animate-fade-up surface-panel flex h-full flex-col rounded-2xl text-left",
        className,
      )}
    >
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4 sm:px-6 sm:py-5">
        <span
          aria-hidden
          className={cn("h-1.5 w-1.5 shrink-0 rounded-full", toneAccent[tone])}
        />
        <h3 className="font-display text-lg tracking-tight text-[var(--foreground)] sm:text-xl">
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

function buildWatchPoints(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): WatchPoint[] {
  const findings = (analysis.risk_findings ?? []).filter(
    (f) => f.status !== "rejected",
  );
  // Priorité aux findings confirmés (injection locale + preuves) pour la section principale.
  const confirmed = findings.filter((f) => f.status === "confirmed");
  const usable = confirmed.length > 0 ? confirmed : findings;

  const ranked = rankFindingsForWatch(usable, {
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });

  const fromFindings: WatchPoint[] = ranked.flatMap((finding, index) => {
    const title = shortTitle(finding.description);
    if (!title) return [];
    return [
      {
        key: `rf-${index}-${finding.description.slice(0, 20)}`,
        category: criterionPlainLabel(finding.criterion_id),
        title,
        explanation: shortExplanation(finding),
        severity: finding.severity,
        finding,
        excerpt:
          cleanExcerptForDisplay(
            finding.citation?.excerpt || finding.excerpt || undefined,
          ) || undefined,
      },
    ];
  });

  const dedupedFindings = dedupeDisplayItems(fromFindings, (p) => p.title);
  if (dedupedFindings.length > 0) return dedupedFindings;

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
    if (!cleanedTitle) return [];
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
    if (!title) return [];
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

  return dedupeDisplayItems(
    [...fromImportant, ...fromRisks],
    (p) => p.title,
  ).slice(0, 8);
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
  isPreview,
  isPreviewLoading,
}: {
  points: WatchPoint[];
  isPreview: boolean;
  isPreviewLoading: boolean;
}) {
  return (
    <section
      className="animate-fade-up rounded-2xl border border-[var(--border)] bg-[var(--surface)] text-left shadow-[var(--shadow-sm)]"
      aria-labelledby="watch-points-heading"
    >
      <header className="border-b border-[var(--border)] px-5 py-5 sm:px-7">
        <h3
          id="watch-points-heading"
          className="font-display text-2xl tracking-tight text-[var(--foreground)]"
        >
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
          <EmptyState label="Rien de critique détecté pour l’instant — les détails restent disponibles plus bas." />
        ) : (
          <ul className="space-y-4">
            {points.map((point) => (
              <li
                key={point.key}
                className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-4 sm:px-5 sm:py-5"
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
                      "shrink-0 rounded-full px-2.5 py-1 text-[11px] font-medium",
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
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-4 text-left sm:px-5"
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
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-left"
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
  const summary =
    cleanSummaryForDisplay(analysis.summary) ||
    (isPreviewLoading
      ? "Aperçu en cours — un résumé plus complet arrivera après l’analyse (1 à 3 minutes)."
      : isPreview
        ? "Aperçu disponible — l’analyse approfondie n’a pas abouti."
        : "");

  return (
    <section
      className={cn("w-full space-y-8", className)}
      aria-label="Résultat d'analyse"
    >
      {/* En-tête léger */}
      <div className="flex flex-wrap items-end justify-between gap-4 text-left">
        <div className="min-w-0 flex-1">
          <h2 className="font-display text-3xl tracking-tight text-[var(--foreground)]">
            {isPreview ? "Aperçu du document" : "Résultat de l’analyse"}
          </h2>
          <p className="mt-2 max-w-xl text-sm leading-relaxed text-[var(--muted)]">
            {isPreviewLoading
              ? "Aperçu disponible — l’analyse approfondie (risques, citations) est encore en cours."
              : isPreview
                ? "Aperçu disponible — l’analyse approfondie n’a pas abouti."
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

        <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-3.5 py-2.5 text-left">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Type de document
          </p>
          <p className="mt-0.5 text-sm font-medium text-[var(--foreground)]">
            {documentType}
          </p>
        </div>
      </div>

      {/* 1. Résumé — héros */}
      <section
        className="animate-fade-up rounded-2xl border border-[var(--border-strong)] bg-[var(--surface)] px-5 py-7 text-left shadow-[var(--shadow-sm)] sm:px-8 sm:py-8"
        aria-labelledby="analysis-summary-heading"
      >
        <p className="text-[11px] font-medium uppercase tracking-[0.12em] text-[var(--accent)]">
          Résumé
        </p>
        <h3
          id="analysis-summary-heading"
          className="mt-2.5 font-display text-2xl leading-snug tracking-tight text-[var(--foreground)] sm:text-[1.85rem]"
        >
          {cleanTitleForDisplay(analysis.title?.trim() || documentType) ||
            documentType}
        </h3>
        {summary ? (
          <p className="mt-5 max-w-3xl text-base leading-[1.7] text-[var(--foreground)] sm:text-[1.0625rem]">
            {summary}
          </p>
        ) : (
          <EmptyState label="Aucun résumé disponible pour ce document." />
        )}
        {(analysis.date || analysis.amounts?.length > 0) && (
          <div className="mt-6 flex flex-wrap gap-x-6 gap-y-2 border-t border-[var(--border)] pt-5 text-sm leading-relaxed text-[var(--muted)]">
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
            <BulletList items={analysis.deadlines} />
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
                relationsPhase={relationsPhase}
              />
              <DocumentTimelinePanel documentId={documentId} className="mt-4" />
            </div>
          ) : null}

          {!isPreview && historyId ? (
            <div className="md:col-span-2 space-y-4">
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
