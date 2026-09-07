/**
 * Garde-fous qualité prod — résumé, actions, échéances, preuves score.
 * Déterministe, sans appel LLM supplémentaire.
 */
import { buildLocalFallbackSummary } from "@/ai/agents/core-bundle-outcome";
import {
  cleanActionsForDisplay,
  cleanSummaryForDisplay,
} from "@/ai/post-processing/display-cleanup";
import {
  resolveWatchDocFamily,
  isVacuousGenericWatchTitle,
  type WatchDocFamily,
} from "@/ai/post-processing/watch-ranking";
import { isRecipientObligation } from "@/services/reply/letter-intents";
import type {
  DocumentAnalysis,
  DocumentClassification,
  RiskCriterionResult,
} from "@/types";

export const SUMMARY_PLACEHOLDER_RE =
  /aucun r[ée]sum[ée]|relancer si besoin|analyse de secours|indisponible|non disponible/i;

export const ACTION_NOISE_RE =
  /signaler\s+(?:sans\s+d[eé]lai\s+)?(?:tout\s+)?changement|changement\s+d['']adresse|traiter\s+les\s+r[ée]clamations|dans\s+un\s+d[ée]lai\s+raisonnable|conserver\s+une\s+copie|espace\s+client|journal\s+technique|obligation\s+du\s+(?:client|titulaire|destinataire)|vous\s+devez\s+(?:nous\s+)?informer|mettre\s+[àa]\s+jour\s+vos\s+coordonn|anticiper\s+l['']échéance\s*:\s*(?:signaler|traiter|conserver)/i;

/** Patterns interdits dans le JSON final persisté / affiché (tests d’intégration). */
export const PROD_QUALITY_FORBIDDEN_PATTERNS = [
  /changement\s+d['']adresse/i,
  /échéance\s+n[°o]?\s*\d/i,
  /\|\s*échéance/i,
  /^\s*\|.+\|.+\|/m,
  /date\s+à\s+laquelle\s+une\s+obligation/i,
  /signal\s+d[ée]tect[ée]\s+(?:sur\s+le\s+critère|score)/i,
  /traiter\s+les\s+r[ée]clamations/i,
] as const;

const BANK_PRIORITY_AMOUNT_RE =
  /frais|commission|rejet|tenue|d[ée]couvert|int[ée]r[êe]t|mouvement|p[ée]nalit/i;
const BANK_DEPRIORITY_AMOUNT_RE =
  /solde\s+arr[eê]t[eé]|^\s*solde\b|salaire|loyer|pr[eé]l[eè]vement\s+loyer|d[eé]couvert\s+autoris[eé]/i;

const FISCAL_PRIORITY_AMOUNT_RE =
  /principal|total\s+[àa]\s+r[ée]gler|montant\s+[àa]\s+(?:payer|pr[ée]lever)|taxe|majoration|frais\s+de\s+relance|net\s+[àa]\s+payer/i;
const MED_PRIORITY_AMOUNT_RE =
  /total\s+r[ée]clam|principal|impay|frais\s+de\s+recouvrement|p[ée]nalit|huissier/i;
const BAIL_PRIORITY_AMOUNT_RE =
  /loyer|charges|d[ée]p[ôo]t\s+de\s+garantie|honoraires|frais\s+de\s+relance|irl/i;
const PRET_PRIORITY_AMOUNT_RE =
  /taeg|mensualit|frais\s+de\s+dossier|capital|remboursement|p[ée]nalit/i;
const ASSURANCE_PRIORITY_AMOUNT_RE =
  /cotisation|franchise|prime|exclusion/i;

/** Montants / libellés qui ne sont PAS des « frais cachés ». */
const NOT_HIDDEN_FEE_RE =
  /principal(?:\s+d[ûu])?|taxe\s+fonci[eè]re|montant\s+[àa]\s+pr[ée]lever|montant\s+[àa]\s+(?:payer|r[ée]gler)|total\s+[àa]\s+r[ée]gler|total\s+r[ée]clam|solde\s+arr[eê]t|^\s*solde\b|salaire|loyer(?:\s+mensuel)?|charges\s+locatives|provisions?\s+pour\s+charges|d[ée]p[ôo]t\s+de\s+garantie|capital\s+emprunt|mensualit[ée]/i;

/** Critères souvent déclenchés par le glossaire boilerplate des relevés bancaires. */
const BANQUE_GLOSSARY_CRITERIA = new Set([
  "resiliation",
  "obligations_importantes",
  "engagement",
  "renouvellement_tacite",
  "delais",
]);

/** Sur MED/recouvrement : pas de reconduction tacite inventée via glossaire. */
const RECOUVREMENT_GLOSSARY_CRITERIA = new Set([
  "renouvellement_tacite",
  "resiliation",
  "augmentation_tarif",
  "engagement",
]);

const BANK_LOW_QUALITY_SUMMARY_RE =
  /montants?\s+rep[eé]r[eé]s/i;

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
  if (containsProdQualityForbiddenPattern(t)) return true;
  return ACTION_NOISE_RE.test(t);
}

/** Texte display (finding / point / preuve) à exclure. */
export function isProdDisplayNoise(text: string): boolean {
  const t = text.replace(/\s+/g, " ").trim();
  if (!t || t.length < 4) return true;
  if (isAnalysisActionNoise(t)) return true;
  if (isDictionaryDefinitionSnippet(t)) return true;
  if (isFakeScheduleDeadline(t)) return true;
  if (/signal\s+d[ée]tect[ée]/i.test(t)) return true;
  return false;
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
  if (family === "recouvrement" || family === "administratif") {
    if (
      /reconduction\s+tacite|renouvellement\s+tacite|prorogation\s+automatique/i.test(
        t,
      ) &&
      !/mise\s+en\s+demeure|huissier|frais\s+de\s+recouvrement/i.test(t)
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

function shouldZeroGlossaryCriterion(
  criterion: RiskCriterionResult,
  family: WatchDocFamily,
  reasons: string[],
): boolean {
  const glossarySet =
    family === "banque"
      ? BANQUE_GLOSSARY_CRITERIA
      : family === "recouvrement"
        ? RECOUVREMENT_GLOSSARY_CRITERIA
        : null;
  if (!glossarySet || !glossarySet.has(criterion.id)) {
    return false;
  }
  if (reasons.length === 0) {
    return criterion.score > 0;
  }
  return reasons.every(
    (reason) =>
      isWeakScoreProofSnippet(reason, family) ||
      isDictionaryDefinitionSnippet(reason),
  );
}

export function prioritizeProductionAmounts(
  amounts: string[],
  family: WatchDocFamily,
): string[] {
  const usable = amounts.filter(
    (amount) => /\d/.test(amount) && !FICTITIOUS_AMOUNT_RE.test(amount),
  );

  const priorityRe =
    family === "banque"
      ? BANK_PRIORITY_AMOUNT_RE
      : family === "administratif"
        ? FISCAL_PRIORITY_AMOUNT_RE
        : family === "recouvrement"
          ? MED_PRIORITY_AMOUNT_RE
          : family === "bail"
            ? BAIL_PRIORITY_AMOUNT_RE
            : family === "pret"
              ? PRET_PRIORITY_AMOUNT_RE
              : family === "assurance"
                ? ASSURANCE_PRIORITY_AMOUNT_RE
                : null;
  const depriorityRe =
    family === "banque" ? BANK_DEPRIORITY_AMOUNT_RE : null;

  if (!priorityRe) {
    return usable.slice(0, 8);
  }

  const scored = usable.map((amount, index) => {
    let score = 1;
    if (priorityRe.test(amount) && !(depriorityRe?.test(amount))) {
      score = 3;
    } else if (depriorityRe?.test(amount)) {
      score = 0;
    }
    return { amount, index, score };
  });

  scored.sort((a, b) => b.score - a.score || a.index - b.index);
  return scored.map((entry) => entry.amount).slice(0, 8);
}

export function filterCriteriaProofs(
  criteria: RiskCriterionResult[],
  family: ReturnType<typeof resolveWatchDocFamily>,
): RiskCriterionResult[] {
  return criteria.map((criterion) => {
    const reasons = (criterion.reasons ?? []).filter(
      (reason) => !isWeakScoreProofSnippet(reason, family),
    );
    if (shouldZeroGlossaryCriterion(criterion, family, reasons)) {
      return {
        ...criterion,
        reasons: [],
        detected: false,
        score: 0,
      };
    }
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

export function containsProdQualityForbiddenPattern(value: string): boolean {
  return PROD_QUALITY_FORBIDDEN_PATTERNS.some((pattern) => pattern.test(value));
}

export function assertProdQualityCleanPayload(parts: {
  summary?: string;
  deadlines?: string[];
  actions?: string[];
  riskCriteriaReasons?: string[];
  findings?: string[];
  importantPoints?: string[];
  risks?: string[];
  riskExplanation?: string;
}): void {
  const blobs = [
    parts.summary ?? "",
    parts.riskExplanation ?? "",
    ...(parts.deadlines ?? []),
    ...(parts.actions ?? []),
    ...(parts.riskCriteriaReasons ?? []),
    ...(parts.findings ?? []),
    ...(parts.importantPoints ?? []),
    ...(parts.risks ?? []),
  ];
  for (const blob of blobs) {
    for (const pattern of PROD_QUALITY_FORBIDDEN_PATTERNS) {
      if (pattern.test(blob)) {
        throw new Error(
          `prod-quality forbidden pattern ${pattern}: ${blob.slice(0, 120)}`,
        );
      }
    }
  }
}

/** Résumé FR déterministe (2–4 phrases) si le LLM ou le scrub a vidé le champ. */
export function buildDeterministicDisplaySummary(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): string {
  const categoryLabel =
    classification?.label || analysis.document_type || "Document";
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });
  const org = analysis.organizations?.find((o) => o.trim().length > 0);
  const amounts = prioritizeProductionAmounts(
    analysis.amounts ?? [],
    family,
  ).slice(0, 2);
  const risks = (analysis.risks ?? []).filter(
    (r) => r.trim().length > 8 && !isAnalysisActionNoise(r),
  );
  const criteria = (analysis.risk_criteria ?? []).filter(
    (c) => c.detected && c.score > 0,
  );
  const deadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);
  const findings = (analysis.risk_findings ?? [])
    .filter((f) => f.status !== "rejected")
    .map((f) => f.description)
    .filter((d) => d.trim().length > 8 && !isProdDisplayNoise(d));

  const alert =
    findings[0] ||
    risks[0] ||
    criteria[0]?.label ||
    deadlines[0];

  const sentences: string[] = [];

  const familyLead: Record<WatchDocFamily, string> = {
    banque: org
      ? `Relevé bancaire émis par ${org}.`
      : `Relevé bancaire de type « ${categoryLabel} ».`,
    administratif: org
      ? `Avis fiscal / administratif émis par ${org}.`
      : `Document fiscal ou administratif (« ${categoryLabel} »).`,
    recouvrement: org
      ? `Mise en demeure / recouvrement de ${org}.`
      : `Mise en demeure ou courrier de recouvrement.`,
    bail: org
      ? `Bail / location — ${org}.`
      : `Bail de location (« ${categoryLabel} »).`,
    pret: org
      ? `Offre ou contrat de prêt — ${org}.`
      : `Document de prêt / crédit.`,
    assurance: org
      ? `Contrat d'assurance / mutuelle — ${org}.`
      : `Document d'assurance.`,
    abonnement: org
      ? `Abonnement / contrat — ${org}.`
      : `Abonnement ou conditions contractuelles.`,
    facture: org
      ? `Facture émise par ${org}.`
      : `Facture (« ${categoryLabel} »).`,
    default: org
      ? `Document ${categoryLabel} émis par ${org}.`
      : `Document de type « ${categoryLabel} ».`,
  };
  sentences.push(familyLead[family] ?? familyLead.default);

  if (amounts.length > 0) {
    const prefix =
      family === "banque"
        ? "Frais / montants à surveiller"
        : family === "administratif" || family === "recouvrement"
          ? "Montants clés"
          : family === "bail"
            ? "Loyers / montants"
            : "Montants repérés";
    sentences.push(`${prefix} : ${amounts.join(", ")}.`);
  }

  if (alert) {
    const clean = alert.replace(/\s+/g, " ").trim().slice(0, 140);
    sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
  } else {
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
    if (local && !SUMMARY_PLACEHOLDER_RE.test(local)) {
      sentences.push(local);
    }
  }

  return sentences.join(" ").slice(0, 420);
}

function isFamilySummaryLowQuality(
  summary: string,
  family: WatchDocFamily,
): boolean {
  if (family === "banque") {
    const hasFeeSignal =
      /frais|commission|tenue|rejet|mouvement|agios|int[ée]r[êe]ts?\s+d[ée]bite/i.test(
        summary,
      );
    if (
      /solde|salaire|loyer|\+\s*\d[\d\s]{2,}/i.test(summary) &&
      !hasFeeSignal
    ) {
      return true;
    }
    if (!BANK_LOW_QUALITY_SUMMARY_RE.test(summary)) return false;
    const hasNoiseAmount =
      /solde|salaire|loyer|\+\s*2\s*\d{3}/i.test(summary) && !hasFeeSignal;
    return hasNoiseAmount || /2\s*148|2\s*086/i.test(summary);
  }
  if (family === "administratif") {
    // Résumé faible si solde/salaire en tête sans principal/taxe/délai
    if (
      /solde|salaire/i.test(summary) &&
      !/principal|taxe|pr[ée]lever|majoration|dgfip|finances/i.test(summary)
    ) {
      return true;
    }
  }
  if (family === "bail") {
    if (
      /capital\s+social|garantie\s+financi[eè]re/i.test(summary) &&
      !/loyer|charges|d[ée]p[ôo]t/i.test(summary)
    ) {
      return true;
    }
  }
  return false;
}

export function resolveDisplaySummary(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): string {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });
  const cleaned = cleanSummaryForDisplay(analysis.summary);
  if (
    cleaned &&
    !SUMMARY_PLACEHOLDER_RE.test(cleaned) &&
    !isFamilySummaryLowQuality(cleaned, family)
  ) {
    return cleaned;
  }

  const raw = analysis.summary?.trim() ?? "";
  if (raw && !SUMMARY_PLACEHOLDER_RE.test(raw)) {
    const relaxed = raw.replace(/\s+/g, " ").slice(0, 360);
    if (
      relaxed.length >= 36 &&
      !/^(relev[ée]|document|contrat)\s*$/i.test(relaxed) &&
      !isFamilySummaryLowQuality(relaxed, family)
    ) {
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

  const findingsByCriterion = new Map(
    (analysis.risk_findings ?? [])
      .filter((finding) => finding.status !== "rejected")
      .map((finding) => [finding.criterion_id, finding]),
  );

  for (const [index, criterion] of criteria.entries()) {
    const finding = findingsByCriterion.get(criterion.id);
    const reason =
      finding?.why?.trim() ||
      finding?.excerpt?.trim() ||
      (criterion.reasons ?? []).find(
        (r) => !isWeakScoreProofSnippet(r, family),
      ) ||
      "";
    const title =
      finding?.description?.trim().slice(0, 120) ||
      criterion.label.trim();
    if (!title) continue;
    const explanation =
      reason && reason.length > 12 && !isWeakScoreProofSnippet(reason, family)
        ? reason.slice(0, 160)
        : title;
    out.push({
      key: `crit-${criterion.id}-${index}`,
      category: criterion.label.trim() || null,
      title,
      explanation,
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

/** Normalise l'analyse persistée avant stockage (verify / enrich / worker). */
export function finalizeAnalysisForProd(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
): DocumentAnalysis {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
  });

  const amounts = prioritizeProductionAmounts(analysis.amounts ?? [], family);
  const deadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);
  const actions = cleanActionsForDisplay(
    (analysis.actions ?? []).filter((action) => !isAnalysisActionNoise(action)),
  ).slice(0, 6);

  const risk_findings = (analysis.risk_findings ?? [])
    .map((finding) => {
      const blob = [
        finding.description,
        finding.why,
        finding.excerpt,
        finding.implication,
      ]
        .filter(Boolean)
        .join(" ");
      if (isProdDisplayNoise(blob) || isWeakScoreProofSnippet(blob, family)) {
        return { ...finding, status: "rejected" as const };
      }
      if (isVacuousGenericWatchTitle(finding.description)) {
        return { ...finding, status: "rejected" as const };
      }
      // Principal / loyer / solde ne doivent jamais rester sous « frais cachés ».
      if (
        finding.criterion_id === "frais_caches" &&
        NOT_HIDDEN_FEE_RE.test(blob) &&
        !/frais\s+de\s+relance|commission|franchise|frais\s+de\s+recouvrement|honoraires/i.test(
          blob,
        )
      ) {
        return {
          ...finding,
          criterion_id: "obligations_importantes" as const,
        };
      }
      return finding;
    })
    .filter((finding) => finding.status !== "rejected")
    .slice(0, 6);

  const feeAmounts = amounts.filter((a) => BANK_PRIORITY_AMOUNT_RE.test(a));
  const important_points = (analysis.important_points ?? [])
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 8 && !isProdDisplayNoise(p))
    .filter((p) => {
      if (family !== "banque" || feeAmounts.length === 0) return true;
      if (/solde\s+arr[eê]t|salaire|loyer/i.test(p) && !BANK_PRIORITY_AMOUNT_RE.test(p)) {
        return false;
      }
      return true;
    })
    .slice(0, 6);

  const risks = (analysis.risks ?? [])
    .map((r) => r.replace(/\s+/g, " ").trim())
    .filter((r) => r.length >= 8 && !isProdDisplayNoise(r))
    .slice(0, 6);

  const risk_criteria = filterCriteriaProofs(
    analysis.risk_criteria ?? [],
    family,
  );
  const risk_score = Math.min(
    100,
    Math.max(
      0,
      risk_criteria.reduce((total, criterion) => total + criterion.score, 0),
    ),
  );

  const risk_explanation = rebuildRiskExplanation(risk_criteria, risk_score);

  const draft: DocumentAnalysis = {
    ...analysis,
    amounts,
    deadlines,
    actions,
    risk_findings,
    important_points,
    risks,
    risk_criteria,
    risk_score,
    risk_explanation,
  };
  const summary = resolveDisplaySummary(draft, classification);

  return {
    ...draft,
    summary,
  };
}

function rebuildRiskExplanation(
  criteria: RiskCriterionResult[],
  riskScore: number,
): string {
  const detected = criteria.filter((c) => c.detected && c.score > 0);
  const lines = [
    `Score de risque pondéré : ${riskScore}/100.`,
    "",
  ];
  if (detected.length === 0) {
    lines.push("Aucun critère confirmé avec preuve exploitable.");
    return lines.join("\n");
  }
  lines.push("Critères retenus :");
  for (const item of detected) {
    const proofs = (item.reasons ?? [])
      .filter((r) => !isProdDisplayNoise(r))
      .slice(0, 2);
    const evidence =
      proofs.length > 0
        ? ` Preuve(s) : ${proofs.map((r) => `"${r}"`).join(" ; ")}`
        : "";
    lines.push(`- ${item.label} : +${item.score}/${item.max_score}.${evidence}`);
  }
  return lines.join("\n");
}
