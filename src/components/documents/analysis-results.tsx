import type { ReactNode } from "react";

import { DocumentRelationsPanel } from "@/components/documents/document-relations-panel";
import { DocumentTimelinePanel } from "@/components/documents/document-timeline-panel";
import { DocumentSheetCard } from "@/components/documents/document-sheet-card";
import { LetterDraftPanel } from "@/components/documents/letter-draft-panel";
import { ReadyReplyCard } from "@/components/documents/ready-reply-card";
import { RiskScoreCard } from "@/components/documents/risk-score-card";
import { SatisfactionPrompt } from "@/components/documents/satisfaction-prompt";
import { cn } from "@/lib/utils";
import type {
  CitedConclusion,
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  ReadyReply,
  RiskFinding,
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
      <header className="flex items-center gap-3 border-b border-[var(--border)] px-5 py-4">
        <span
          aria-hidden
          className={cn("h-2 w-2 shrink-0 rounded-sm", toneAccent[tone])}
        />
        <h3 className="font-display text-xl tracking-tight text-[var(--foreground)]">
          {title}
        </h3>
      </header>
      <div className="flex-1 px-5 py-4">{children}</div>
    </article>
  );
}

function EmptyState({ label }: { label: string }) {
  return <p className="text-sm text-[var(--muted)]">{label}</p>;
}

function BulletList({ items }: { items: string[] }) {
  if (items.length === 0) {
    return <EmptyState label="Aucun élément identifié." />;
  }

  return (
    <ul className="space-y-2.5">
      {items.map((item, index) => (
        <li
          key={`${index}-${item.slice(0, 24)}`}
          className="flex gap-2.5 text-sm leading-relaxed text-[var(--foreground)]"
        >
          <span
            aria-hidden
            className="mt-2 h-1.5 w-1.5 shrink-0 rounded-sm bg-[var(--accent)]"
          />
          <span>{item}</span>
        </li>
      ))}
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

function severityLabel(severity: RiskFinding["severity"]): string {
  switch (severity) {
    case "critique":
      return "Critique";
    case "eleve":
      return "Élevé";
    case "modere":
      return "Modéré";
    default:
      return "Faible";
  }
}

function statusLabel(status: RiskFinding["status"]): string {
  switch (status) {
    case "confirmed":
      return "Confirmé";
    case "ambiguous":
      return "Ambigu";
    default:
      return "Rejeté";
  }
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
  return (
    <div className="mt-2">
      <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
        Preuve · p.{page} · §{paragraph}
      </p>
      <blockquote className="mt-1 border-l-2 border-[var(--accent)] pl-3 text-sm italic leading-relaxed text-[var(--foreground)]">
        « {excerpt} »
      </blockquote>
    </div>
  );
}

function RiskFindingsList({ findings }: { findings: RiskFinding[] }) {
  if (findings.length === 0) {
    return <EmptyState label="Aucun élément identifié." />;
  }

  return (
    <ul className="space-y-3">
      {findings.map((finding, index) => {
        const citation = finding.citation;
        const excerpt = citation?.excerpt || finding.excerpt;
        return (
          <li
            key={`${index}-${finding.description.slice(0, 24)}`}
            className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-left"
          >
            <div className="flex flex-wrap items-baseline justify-between gap-2">
              <p className="text-sm font-medium text-[var(--foreground)]">
                {finding.description}
              </p>
              <p className="text-xs text-[var(--muted)]">
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
            ) : (
              <p className="mt-2 text-xs text-[var(--danger)]">
                Conclusion sans preuve — non retenue.
              </p>
            )}
            <dl className="mt-3 space-y-2 text-xs leading-relaxed">
              <div>
                <dt className="font-medium text-[var(--muted)]">
                  Pourquoi il existe
                </dt>
                <dd className="text-[var(--foreground)]">
                  {finding.why || finding.justification || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--muted)]">
                  Ce qu’il implique
                </dt>
                <dd className="text-[var(--foreground)]">
                  {finding.implication || finding.impact || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--muted)]">
                  Ce qui peut arriver
                </dt>
                <dd className="text-[var(--foreground)]">
                  {finding.consequence || "—"}
                </dd>
              </div>
              <div>
                <dt className="font-medium text-[var(--muted)]">
                  Comment le réduire
                </dt>
                <dd className="text-[var(--foreground)]">
                  {finding.mitigation || "—"}
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
  if (items.length === 0) {
    return <EmptyState label="Aucun élément identifié." />;
  }

  return (
    <ul className="space-y-3">
      {items.map((item, index) => (
        <li
          key={`${index}-${item.statement.slice(0, 24)}`}
          className="rounded-xl border border-[var(--border)] bg-[var(--surface-elevated)] px-4 py-3 text-left"
        >
          <p className="text-sm font-medium text-[var(--foreground)]">
            {item.statement}
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
      {label} — analyse juridique en cours…
    </p>
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
  relationsPhase,
  onLetterDrafted,
  className,
}: AnalysisResultsProps) {
  const documentType =
    analysis.document_type || classification?.label || "Non déterminé";
  const isPreview = phase === "preview";

  return (
    <section
      className={cn("w-full space-y-4", className)}
      aria-label="Résultat d'analyse"
    >
      <div className="flex flex-wrap items-end justify-between gap-3 text-left">
        <div>
          <h2 className="font-display text-3xl text-[var(--foreground)]">
            {isPreview ? "Aperçu du document" : "Analyse du document"}
          </h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            {isPreview
              ? "Extraction locale instantanée — faits structurés"
              : "Extraction automatique des informations importantes"}
          </p>
        </div>

        <div className="surface-panel rounded-xl px-3 py-2 text-left">
          <p className="text-[11px] font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
            Type détecté
          </p>
          <p className="text-sm font-medium text-[var(--foreground)]">
            {documentType}
          </p>
        </div>
      </div>

      {sheet ? <DocumentSheetCard sheet={sheet} /> : null}

      <div className="grid gap-4 md:grid-cols-2">
        <div className="md:col-span-2">
          {isPreview ? (
            <AnalysisCard title="Score de risque" tone="neutral">
              <PendingLegalBlock label="Score" />
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
          <AnalysisCard title="Informations clés" tone="neutral">
            <div className="grid gap-4 sm:grid-cols-3">
              <MetaRow label="Titre" value={analysis.title} />
              <MetaRow label="Date" value={analysis.date} />
              <MetaRow label="Type" value={documentType} />
            </div>
            {analysis.summary ? (
              <p className="mt-4 text-sm leading-relaxed text-[var(--foreground)]">
                {analysis.summary}
              </p>
            ) : null}
          </AnalysisCard>
        </div>

        <AnalysisCard title="Personnes" tone="info">
          <BulletList items={analysis.people} />
        </AnalysisCard>

        <AnalysisCard title="Organisations" tone="info">
          <BulletList items={analysis.organizations} />
        </AnalysisCard>

        <AnalysisCard title="Montants" tone="action">
          <BulletList items={analysis.amounts} />
        </AnalysisCard>

        <AnalysisCard title="Échéances" tone="warning">
          <BulletList items={analysis.deadlines} />
        </AnalysisCard>

        <AnalysisCard title="Dates" tone="info">
          <BulletList items={analysis.dates} />
        </AnalysisCard>

        <AnalysisCard
          title="Points importants"
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

        <AnalysisCard title="Risques" tone="warning" className="md:col-span-2">
          {isPreview ? (
            <PendingLegalBlock label="Risques et citations" />
          ) : analysis.risk_findings && analysis.risk_findings.length > 0 ? (
            <RiskFindingsList findings={analysis.risk_findings} />
          ) : (
            <BulletList items={analysis.risks} />
          )}
        </AnalysisCard>

        <div className="md:col-span-2">
          <AnalysisCard title="Actions" tone="action">
            {isPreview ? (
              <PendingLegalBlock label="Recommandations" />
            ) : (
              <BulletList items={analysis.actions} />
            )}
          </AnalysisCard>
        </div>

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
