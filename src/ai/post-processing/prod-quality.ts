/**
 * Garde-fous qualité prod — résumé, actions, échéances, preuves score.
 * Déterministe, sans appel LLM supplémentaire.
 */
import { buildLocalFallbackSummary } from "@/ai/agents/core-bundle-outcome";
import { cleanSummaryForDisplay } from "@/ai/post-processing/display-cleanup";
import { resolveWatchDocFamily } from "@/ai/post-processing/watch-ranking";
import { isRecipientObligation } from "@/services/reply/letter-intents";
import type {
  DocumentAnalysis,
  DocumentClassification,
  RiskCriterionResult,
} from "@/types";

export const SUMMARY_PLACEHOLDER_RE =
  /aucun r[ée]sum[ée]|relancer si besoin|analyse de secours|indisponible|non disponible/i;

export const ACTION_NOISE_RE =
  /signaler\s+(?:sans\s+d[eé]lai\s+)?(?:tout\s+)?changement|changement\s+d['']adresse|traiter\s+les\s+r[ée]clamations|conserver\s+une\s+copie|espace\s+client|journal\s+technique|obligation\s+du\s+(?:client|titulaire|destinataire)|vous\s+devez\s+(?:nous\s+)?informer|mettre\s+[àa]\s+jour\s+vos\s+coordonn/i;

export const MARKDOWN_TABLE_ROW_RE = /^\s*\|.*\|.*\|/;

export const DICTIONARY_DEFINITION_RE =
  /^(?:[•\-*]\s*)?(?:\*\*)?(?:échéance|echeance|partie|incident|force\s+majeure|pièce\s+justificative|mise\s+en\s+demeure)(?:\*\*)?\s*:\s*(?:date\s+à\s+laquelle|toute\s+personne|tout\s+retard|événement\s+imprévisible)/i;

export const FAKE_SCHEDULE_RE =
  /échéance\s+n[°o]?\s*\d+|échéancier\s+pr[ée]visionnel|montants?\s+de\s+r[ée]f[ée]rence/i;

export const FICTITIOUS_AMOUNT_RE =
  /\bfictif(?:s|ve|ves)?\b|illustr(?:ent|ation|atif)?|exemple[\s-]fictif|montants?\s+de\s+r[ée]f[ée]rence\s+compl[ée]mentaires/i;

const BANQUE_BOILERPLATE_RESILIATION_RE =
  /r[ée]sili(?:ation|er)|reconduction\s+tacite|renouvellement\s+tacite|prorogation\s+automatique/i;

export function isAnalysisActionNoise(text: string): boolean {
  const t = text.trim();
  if (!t) return true;
  if (isRecipientObligation(t)) return true;
  if (MARKDOWN_TABLE_ROW_RE.test(t)) return true;
  if (FAKE_SCHEDULE_RE.test(t)) return true;
  if (DICTIONARY_DEFINITION_RE.test(t)) return true;
  return ACTION_NOISE_RE.test(t);
}

export function isDictionaryDefinitionSnippet(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (DICTIONARY_DEFINITION_RE.test(t)) return true;
  if (
    /:\s*date\s+à\s+laquelle\s+une\s+obligation/i.test(t) &&
    !/\d{1,2}[\/.\-]\d{1,2}/.test(t)
  ) {
    return true;
  }
  return false;
}

export function isFakeScheduleDeadline(text: string): boolean {
  const t = text.trim();
  if (!t) return false;
  if (FAKE_SCHEDULE_RE.test(t)) return true;
  if (MARKDOWN_TABLE_ROW_RE.test(t)) return true;
  return false;
}

export function isWeakScoreProofSnippet(
  text: string,
  family: ReturnType<typeof resolveWatchDocFamily>,
): boolean {
  const t = text.trim();
  if (!t || t.length < 12) return true;
  if (isDictionaryDefinitionSnippet(t)) return true;
  if (isAnalysisActionNoise(t)) return true;
  if (family === "banque") {
    if (
      BANQUE_BOILERPLATE_RESILIATION_RE.test(t) &&
      !/\d+[,.]?\d*\s*€/.test(t) &&
      !/ficp|rejet|commission|frais|int[ée]r[êe]ts?\s+d[ée]biteurs/i.test(t)
    ) {
      return true;
    }
    if (/d[ée]finitions?\b|obligations?\s+r[ée]ciproques/i.test(t)) {
      return true;
    }
  }
  return false;
}

export function sanitizeProductionDeadlines(deadlines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of deadlines) {
    const value = raw.replace(/\s+/g, " ").trim();
    if (!value || value.length < 8 || value.length > 160) continue;
    if (isRecipientObligation(value)) continue;
    if (isFakeScheduleDeadline(value)) continue;
    if (isDictionaryDefinitionSnippet(value)) continue;
    if (ACTION_NOISE_RE.test(value)) continue;
    const key = value.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(value);
  }
  return out.slice(0, 8);
}

export function filterCriteriaProofs(
  criteria: RiskCriterionResult[],
  family: ReturnType<typeof resolveWatchDocFamily>,
): RiskCriterionResult[] {
  return criteria.map((criterion) => {
    const reasons = (criterion.reasons ?? []).filter(
      (reason) => !isWeakScoreProofSnippet(reason, family),
    );
    if (reasons.length === (criterion.reasons ?? []).length) {
      return criterion;
    }
    const detected = reasons.length > 0 && criterion.detected;
    return {
      ...criterion,
      reasons,
      detected,
      score: detected ? criterion.score : 0,
    };
  });
}

/** Résumé FR déterministe (2–4 phrases) si le LLM ou le scrub a vidé le champ. */
export function buildDeterministicDisplaySummary(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): string {
  const categoryLabel =
    classification?.label || analysis.document_type || "Document";
  const org = analysis.organizations?.find((o) => o.trim().length > 0);
  const amounts = (analysis.amounts ?? [])
    .filter((a) => /\d/.test(a) && !FICTITIOUS_AMOUNT_RE.test(a))
    .slice(0, 2);
  const risks = (analysis.risks ?? []).filter(
    (r) => r.trim().length > 8 && !isAnalysisActionNoise(r),
  );
  const criteria = (analysis.risk_criteria ?? []).filter(
    (c) => c.detected && c.score > 0,
  );
  const deadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);

  const local = buildLocalFallbackSummary({
    categoryLabel,
    fileName: analysis.title,
    amounts,
    deadlines,
    risks:
      risks.length > 0
        ? risks
        : criteria.map((c) => c.label).slice(0, 3),
    importantPoints: analysis.important_points,
  });

  const sentences: string[] = [];
  if (org) {
    sentences.push(
      `Document ${categoryLabel} émis par ${org}.`,
    );
  } else {
    sentences.push(`Document de type « ${categoryLabel} ».`);
  }

  if (amounts.length > 0) {
    sentences.push(`Montants repérés : ${amounts.join(", ")}.`);
  }

  const alert =
    risks[0] ||
    criteria[0]?.label ||
    (analysis.risk_findings ?? [])
      .filter((f) => f.status !== "rejected")
      .map((f) => f.description)
      .find((d) => d.trim().length > 8);

  if (alert) {
    const clean = alert.replace(/\s+/g, " ").trim().slice(0, 140);
    sentences.push(
      clean.endsWith(".") ? clean : `${clean}.`,
    );
  } else if (deadlines[0]) {
    sentences.push(`Échéance notable : ${deadlines[0].slice(0, 100)}.`);
  } else if (local && !SUMMARY_PLACEHOLDER_RE.test(local)) {
    sentences.push(local);
  }

  return sentences.join(" ").slice(0, 420);
}

export function resolveDisplaySummary(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): string {
  const cleaned = cleanSummaryForDisplay(analysis.summary);
  if (cleaned && !SUMMARY_PLACEHOLDER_RE.test(cleaned)) {
    return cleaned;
  }

  const raw = analysis.summary?.trim() ?? "";
  if (raw && !SUMMARY_PLACEHOLDER_RE.test(raw)) {
    const relaxed = raw.replace(/\s+/g, " ").slice(0, 360);
    if (relaxed.length >= 36 && !/^(relev[ée]|document|contrat)\s*$/i.test(relaxed)) {
      return relaxed;
    }
  }

  return buildDeterministicDisplaySummary(analysis, classification);
}

export function shouldShowWatchEmptyState(analysis: DocumentAnalysis): boolean {
  if ((analysis.risk_score ?? 0) >= 30) return false;
  const findings = (analysis.risk_findings ?? []).filter(
    (f) => f.status !== "rejected",
  );
  if (findings.length > 0) return false;
  const criteria = (analysis.risk_criteria ?? []).filter(
    (c) => c.detected && c.score > 0,
  );
  if (criteria.length > 0) return false;
  const risks = (analysis.risks ?? []).filter((r) => r.trim().length > 8);
  if (risks.length > 0) return false;
  return true;
}

export type WatchPointDraft = {
  key: string;
  category: string | null;
  title: string;
  explanation: string;
  severity: "faible" | "modere" | "eleve" | "critique";
};

export function buildWatchPointsFromCriteria(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): WatchPointDraft[] {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });
  const criteria = (analysis.risk_criteria ?? []).filter(
    (c) => c.detected && c.score > 0,
  );
  const out: WatchPointDraft[] = [];

  for (const [index, criterion] of criteria.entries()) {
    const reason =
      (criterion.reasons ?? []).find(
        (r) => !isWeakScoreProofSnippet(r, family),
      ) ?? "";
    const title = criterion.label.trim();
    if (!title) continue;
    out.push({
      key: `crit-${criterion.id}-${index}`,
      category: title,
      title,
      explanation:
        reason && reason.length > 12
          ? reason.slice(0, 160)
          : `Signal détecté sur le critère « ${title} » (score ${criterion.score}/${criterion.max_score}).`,
      severity:
        criterion.score >= 8
          ? "eleve"
          : criterion.score >= 4
            ? "modere"
            : "faible",
    });
  }

  return out.slice(0, 4);
}

/** Normalise l'analyse persistée avant stockage (verify / enrich). */
export function finalizeAnalysisForProd(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): DocumentAnalysis {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });

  const summary = resolveDisplaySummary(analysis, classification);
  const deadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);
  const risk_criteria = filterCriteriaProofs(
    analysis.risk_criteria ?? [],
    family,
  );

  return {
    ...analysis,
    summary,
    deadlines,
    risk_criteria,
  };
}
