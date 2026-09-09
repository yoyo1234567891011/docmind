/**
 * Garde-fous qualité prod — résumé, actions, échéances, preuves score.
 * Déterministe, sans appel LLM supplémentaire.
 */
import {
  cleanActionsForDisplay,
  cleanSummaryForDisplay,
} from "@/ai/post-processing/display-cleanup";
import {
  resolveWatchDocFamily,
  isVacuousGenericWatchTitle,
  rankFindingsForWatch,
  type WatchDocFamily,
} from "@/ai/post-processing/watch-ranking";
import {
  dedupeLabeledAmounts,
  dedupeRiskFindings,
  dedupeRiskStrings,
} from "@/ai/post-processing/dedupe-findings";
import { isRecipientObligation } from "@/services/reply/letter-intents";
import type {
  DocumentAnalysis,
  DocumentClassification,
  RiskCriterionResult,
} from "@/types";

export const SUMMARY_PLACEHOLDER_RE =
  /aucun r[ée]sum[ée]|relancer si besoin|analyse de secours|indisponible|non disponible/i;

export const ACTION_NOISE_RE =
  /signaler\s+(?:sans\s+d[eé]lai\s+)?(?:tout\s+)?changement|changement\s+d['']adresse|traiter\s+les\s+r[ée]clamations|dans\s+un\s+d[ée]lai\s+raisonnable|conserver\s+une\s+copie|espace\s+client|journal\s+technique|obligation\s+du\s+(?:client|titulaire|destinataire)|vous\s+devez\s+(?:nous\s+)?informer|mettre\s+[àa]\s+jour\s+vos\s+coordonn|anticiper\s+l['']échéance\s*:\s*(?:signaler|traiter|conserver)|d[ée]lai\s+moyen\s+de\s+traitement|traitement\s+(?:du\s+)?courrier|accus[ée]\s+de\s+r[ée]ception|10\s+jours\s+ouvr[ée]s|jours\s+ouvr[ée]s\s+lorsque\s+la\s+r[ée]glementation|v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:/i;

/** Patterns interdits dans le JSON final persisté / affiché (tests d’intégration). */
export const PROD_QUALITY_FORBIDDEN_PATTERNS = [
  /changement\s+d['']adresse/i,
  /échéance\s+n[°o]?\s*\d/i,
  /\|\s*échéance/i,
  /^\s*\|.+\|.+\|/m,
  /date\s+à\s+laquelle\s+une\s+obligation/i,
  /signal\s+d[ée]tect[ée]\s+(?:sur\s+le\s+critère|score)/i,
  /traiter\s+les\s+r[ée]clamations/i,
  /d[ée]lai\s+moyen\s+de\s+traitement/i,
  /traitement\s+(?:du\s+)?courrier/i,
  /v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:/i,
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
    if (isAnalysisActionNoise(value)) continue;
    // Accusé / traitement générique service (hors date de paiement utile)
    if (
      /accus[ée]\s+de\s+r[ée]ception|d[ée]lai\s+moyen|jours\s+ouvr[ée]s/i.test(
        value,
      ) &&
      !/payer|paiement|r[ée]gler|contest|opposition|pr[ée]l[eè]v|au\s+plus\s+tard\s+le\s+\d/i.test(
        value,
      )
    ) {
      continue;
    }
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
        : family === "social"
          ? /aide|indu|trop|allocation|mensuel|€/i
          : family === "pret"
            ? PRET_PRIORITY_AMOUNT_RE
            : family === "recouvrement"
              ? MED_PRIORITY_AMOUNT_RE
              : family === "bail"
                ? BAIL_PRIORITY_AMOUNT_RE
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

function pickLabeledAmount(
  amounts: string[],
  pattern: RegExp,
): string | null {
  const hit = amounts.find((a) => pattern.test(a));
  return hit ? hit.replace(/\s+/g, " ").trim() : null;
}

function formatAmountClause(amounts: string[]): string | null {
  if (amounts.length === 0) return null;
  if (amounts.length === 1) return amounts[0]!;
  if (amounts.length === 2) return `${amounts[0]} et ${amounts[1]}`;
  return `${amounts.slice(0, -1).join(", ")} et ${amounts[amounts.length - 1]}`;
}

/** Résumé FR déterministe (2–4 phrases naturelles) si le LLM ou le scrub a vidé le champ. */
export function buildDeterministicDisplaySummary(
  analysis: DocumentAnalysis,
  classification?: DocumentClassification,
  documentText?: string,
): string {
  const categoryLabel =
    classification?.label || analysis.document_type || "Document";
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
    textHint: documentText?.slice(0, 4500),
  });
  const org = analysis.organizations?.find((o) => o.trim().length > 0);
  const amounts = dedupeLabeledAmounts(
    prioritizeProductionAmounts(
      [
        ...(analysis.amounts ?? []),
        ...(analysis.risk_findings ?? [])
          .filter((f) => f.status !== "rejected")
          .map((f) => f.description),
      ],
      family,
    ),
  ).slice(0, 3);
  const deadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);
  const findings = (analysis.risk_findings ?? [])
    .filter((f) => f.status !== "rejected")
    .map((f) => f.description)
    .filter((d) => d.trim().length > 8 && !isProdDisplayNoise(d));

  const amountClause = formatAmountClause(amounts.slice(0, 2));
  const deadlineHint =
    deadlines.find((d) =>
      /au\s+plus\s+tard|date\s+limite|payer|paiement|sous\s+\d+\s*jours|pr[ée]l[eè]v/i.test(
        d,
      ),
    ) || deadlines[0];
  const alertFinding =
    findings.find((f) =>
      /majoration|recouvrement|huissier|ficp|commission|frais\s+de\s+relance|clause\s+r[ée]solutoire|p[ée]nalit/i.test(
        f,
      ),
    ) || findings[0];

  const sentences: string[] = [];

  switch (family) {
    case "administratif": {
      const principal = pickLabeledAmount(amounts, /principal/i);
      const total = pickLabeledAmount(
        amounts,
        /total\s+[àa]\s+r[ée]gler|montant\s+[àa]\s+(?:payer|pr[ée]lever)/i,
      );
      const majoration = pickLabeledAmount(amounts, /majoration|relance/i);
      sentences.push(
        org
          ? `Cet avis d'impôt / fiscal est émis par ${org}.`
          : `Il s'agit d'un avis fiscal ou administratif (« ${categoryLabel} »).`,
      );
      if (principal || total) {
        const parts = [principal, total, majoration].filter(Boolean);
        sentences.push(
          `Montants à retenir : ${parts.join(", ")}.`,
        );
      } else if (amountClause) {
        sentences.push(`Montants clés : ${amountClause}.`);
      }
      if (deadlineHint) {
        sentences.push(
          `Échéance à respecter : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      } else if (alertFinding) {
        sentences.push(
          `${alertFinding.replace(/\s+/g, " ").trim().slice(0, 120)}.`.replace(
            /\.\.$/,
            ".",
          ),
        );
      } else {
        sentences.push(
          "En l'absence de règlement, un recouvrement ou des poursuites peuvent être engagés.",
        );
      }
      break;
    }
    case "social": {
      sentences.push(
        org
          ? `Cette notification sociale / CAF est émise par ${org}.`
          : "Il s'agit d'une notification CAF ou de prestations sociales.",
      );
      if (amountClause) {
        sentences.push(`Montants concernés : ${amountClause}.`);
      }
      if (deadlineHint) {
        sentences.push(
          `Délai pour transmettre les pièces : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      } else if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else {
        sentences.push(
          "Sans réponse dans le délai, une suspension de droits ou un indu peut être engagé.",
        );
      }
      break;
    }
    case "pret": {
      sentences.push(
        org
          ? `Cette offre de prêt / crédit est proposée par ${org}.`
          : "Il s'agit d'une offre de prêt ou de crédit.",
      );
      if (amountClause) {
        sentences.push(`Conditions financières : ${amountClause}.`);
      }
      if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else if (deadlineHint) {
        sentences.push(
          `Point d'attention : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      } else {
        sentences.push(
          "Vérifier TAEG, mensualité, assurance emprunteur et délai de rétractation avant acceptation.",
        );
      }
      break;
    }
    case "facture": {
      sentences.push(
        org
          ? `Cette facture est émise par ${org}.`
          : `Il s'agit d'une facture (« ${categoryLabel} »).`,
      );
      if (amountClause) {
        sentences.push(`Montants facturés : ${amountClause}.`);
      }
      if (deadlineHint) {
        sentences.push(
          `Échéance de paiement : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      } else if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      }
      break;
    }
    case "abonnement": {
      sentences.push(
        org
          ? `Ce contrat d'abonnement / service est proposé par ${org}.`
          : `Il s'agit d'un contrat d'abonnement (« ${categoryLabel} »).`,
      );
      if (amountClause) {
        sentences.push(`Montants et options : ${amountClause}.`);
      }
      if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else if (deadlineHint) {
        sentences.push(
          `Engagement / préavis : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      }
      break;
    }
    case "assurance": {
      sentences.push(
        org
          ? `Ce contrat d'assurance / mutuelle est émis par ${org}.`
          : `Il s'agit d'un contrat d'assurance ou de mutuelle (« ${categoryLabel} »).`,
      );
      if (amountClause) {
        sentences.push(`Cotisations et montants : ${amountClause}.`);
      }
      if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else if (deadlineHint) {
        sentences.push(
          `Point d'attention : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      }
      break;
    }
    case "banque": {
      sentences.push(
        org
          ? `Ce relevé bancaire est émis par ${org}.`
          : "Il s'agit d'un relevé ou document bancaire.",
      );
      if (amountClause) {
        sentences.push(
          `Frais et commissions à surveiller : ${amountClause}.`,
        );
      }
      if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else if (deadlineHint) {
        sentences.push(
          `Point d'attention : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      }
      break;
    }
    case "recouvrement": {
      sentences.push(
        org
          ? `Cette mise en demeure / relance est adressée par ${org}.`
          : "Il s'agit d'une mise en demeure ou d'un courrier de recouvrement.",
      );
      if (amountClause) {
        sentences.push(`Créance réclamée : ${amountClause}.`);
      }
      if (deadlineHint) {
        sentences.push(
          `Délai d'action : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      } else if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      }
      break;
    }
    case "bail": {
      sentences.push(
        org
          ? `Ce bail / contrat de location implique ${org}.`
          : `Il s'agit d'un bail de location (« ${categoryLabel} »).`,
      );
      if (amountClause) {
        sentences.push(`Loyers et montants : ${amountClause}.`);
      }
      if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else if (deadlineHint) {
        sentences.push(
          `Échéance notable : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      }
      break;
    }
    default: {
      sentences.push(
        org
          ? `Document « ${categoryLabel} » émis par ${org}.`
          : `Document de type « ${categoryLabel} ».`,
      );
      if (amountClause) {
        sentences.push(`Montants repérés : ${amountClause}.`);
      }
      if (alertFinding) {
        const clean = alertFinding.replace(/\s+/g, " ").trim().slice(0, 120);
        sentences.push(clean.endsWith(".") ? clean : `${clean}.`);
      } else if (deadlineHint) {
        sentences.push(
          `Échéance notable : ${deadlineHint.replace(/\s+/g, " ").slice(0, 110)}.`,
        );
      }
      break;
    }
  }

  let summary = sentences
    .map((s) => s.replace(/\s+/g, " ").trim())
    .filter(Boolean)
    .join(" ")
    .slice(0, 420);

  // Garantir une ponctuation de phrase.
  if (summary && !/[.!?…]/.test(summary)) {
    summary = `${summary.replace(/[.;:\s]+$/, "")}.`;
  }
  return summary;
}

function isTelegraphicSummary(summary: string): boolean {
  const t = summary.replace(/\s+/g, " ").trim();
  if (!t) return true;
  // Pas de ponctuation de phrase → télégraphique
  if (!/[.!?…]/.test(t) && t.length < 180) return true;
  // « Document Impôts 1 073 € Principal… » sans verbe utile
  if (
    /^document\s+\S+/i.test(t) &&
    !/\b(est|sont|porte|concerne|indique|émet|réclame|fixe)\b/i.test(t) &&
    /\d/.test(t)
  ) {
    return true;
  }
  return false;
}

function isFamilySummaryLowQuality(
  summary: string,
  family: WatchDocFamily,
): boolean {
  if (isTelegraphicSummary(summary)) return true;
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
    if (
      /solde|salaire/i.test(summary) &&
      !/principal|taxe|pr[ée]lever|majoration|dgfip|finances|total/i.test(
        summary,
      )
    ) {
      return true;
    }
    // Montants collés sans phrase
    if (/imp[ôo]ts?\s+\d/i.test(summary) && !/[.!?…]/.test(summary)) {
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
  documentText?: string,
): string {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
    textHint: documentText?.slice(0, 4500),
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

  return buildDeterministicDisplaySummary(analysis, classification, documentText);
}

/** Réactive délais/sanctions/etc. quand un finding solide existe mais le score LLM est à 0. */
export function syncCriteriaScoresFromFindings(
  criteria: RiskCriterionResult[],
  findings: DocumentAnalysis["risk_findings"],
): RiskCriterionResult[] {
  const byId = new Map(
    (findings ?? [])
      .filter((f) => f.status !== "rejected" && f.criterion_id)
      .map((f) => [f.criterion_id!, f]),
  );

  return criteria.map((criterion) => {
    const finding = byId.get(criterion.id);
    if (!finding) return criterion;

    const proof =
      finding.excerpt?.trim() ||
      finding.description?.trim() ||
      "";
    if (!proof || proof.length < 8) return criterion;

    // Ne pas réactiver sur glossaire / bruit.
    if (
      isProdDisplayNoise(proof) ||
      isDictionaryDefinitionSnippet(proof) ||
      isVacuousGenericWatchTitle(finding.description)
    ) {
      return criterion;
    }

    if (criterion.detected && criterion.score > 0) {
      const reasons = [...new Set([...(criterion.reasons ?? []), proof])].slice(
        0,
        3,
      );
      return { ...criterion, reasons };
    }

    const minScore = Math.max(
      4,
      Math.round(criterion.max_score * 0.7),
    );
    return {
      ...criterion,
      detected: true,
      score: minScore,
      reasons: [proof.slice(0, 160)],
    };
  });
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
  documentText?: string,
): DocumentAnalysis {
  const family = resolveWatchDocFamily({
    category: classification?.category,
    documentType: analysis.document_type,
    title: analysis.title,
    textHint: documentText?.slice(0, 4500),
  });

  const risk_findings_raw = (analysis.risk_findings ?? [])
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
      // Copy « ce que ça change » hors contexte (matériel sur avis fiscal, etc.)
      let implication = finding.implication;
      if (
        implication &&
        /mat[ée]riel|abonnement|r[ée]siliation\s+anticip/i.test(implication) &&
        (family === "administratif" ||
          family === "recouvrement" ||
          family === "banque")
      ) {
        implication = familyImplicationFallback(
          finding.criterion_id,
          family,
          finding.description,
        );
      }
      return implication === finding.implication
        ? finding
        : { ...finding, implication, impact: implication };
    })
    .filter((finding) => finding.status !== "rejected");

  // Sync score avant le slice (sinon délais/sanctions utiles peuvent être coupés).
  let risk_criteria = filterCriteriaProofs(
    analysis.risk_criteria ?? [],
    family,
  );
  risk_criteria = syncCriteriaScoresFromFindings(
    risk_criteria,
    risk_findings_raw,
  );

  const risk_findings = dedupeRiskFindings(
    rankFindingsForWatch(
      risk_findings_raw,
      {
        category: classification?.category,
        documentType: analysis.document_type,
        title: analysis.title,
        textHint: documentText?.slice(0, 4500),
      },
      8,
    ),
  ).slice(0, 6);

  const amounts = dedupeLabeledAmounts(
    prioritizeProductionAmounts(
      [
        ...(analysis.amounts ?? []),
        ...risk_findings
          .map((f) => f.description)
          .filter((d) => /\d/.test(d) && /€|euro|%|\/mois/i.test(d)),
      ],
      family,
    ),
  );
  const deadlines = sanitizeProductionDeadlines(analysis.deadlines ?? []);
  const actions = cleanActionsForDisplay(
    (analysis.actions ?? [])
      .map((action) =>
        action
          .replace(/^v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:\s*/i, "")
          .replace(/^anticiper\s+l['']échéance\s*:\s*/i, "")
          .trim(),
      )
      .filter((action) => !isAnalysisActionNoise(action)),
  ).slice(0, 6);

  const feeAmounts = amounts.filter((a) => BANK_PRIORITY_AMOUNT_RE.test(a));
  const important_points = dedupeRiskStrings(
    (analysis.important_points ?? [])
      .map((p) => p.replace(/\s+/g, " ").trim())
      .filter((p) => p.length >= 8 && !isProdDisplayNoise(p))
      .filter((p) => {
        if (family !== "banque" || feeAmounts.length === 0) return true;
        if (
          /solde\s+arr[eê]t|salaire|loyer/i.test(p) &&
          !BANK_PRIORITY_AMOUNT_RE.test(p)
        ) {
          return false;
        }
        return true;
      }),
  ).slice(0, 6);

  const risks = dedupeRiskStrings(
    (analysis.risks ?? [])
      .map((r) => r.replace(/\s+/g, " ").trim())
      .filter((r) => r.length >= 8 && !isProdDisplayNoise(r)),
  ).slice(0, 6);

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
  const summary = resolveDisplaySummary(draft, classification, documentText);

  return {
    ...draft,
    summary,
  };
}

function familyImplicationFallback(
  criterionId: string | undefined,
  family: WatchDocFamily,
  description: string,
): string {
  if (family === "administratif") {
    if (criterionId === "penalites" || /majoration/i.test(description)) {
      return "La créance fiscale augmente rapidement en cas de retard.";
    }
    if (criterionId === "delais") {
      return "Dépasser la date limite expose à majoration et recouvrement.";
    }
    if (criterionId === "sanctions") {
      return "Sans règlement, l'administration peut engager un recouvrement forcé.";
    }
    if (criterionId === "frais_caches") {
      return "Des frais de relance s'ajoutent au principal déjà dû.";
    }
    return "L'inaction peut aggraver la dette fiscale et les poursuites.";
  }
  if (family === "banque") {
    if (criterionId === "frais_caches") {
      return "Ces frais réduisent le solde disponible de façon récurrente.";
    }
    if (criterionId === "sanctions") {
      return "Un incident bancaire peut entraîner fichage ou restrictions.";
    }
    return "Il faut vérifier le fondement de chaque débit avant d'accepter.";
  }
  if (family === "recouvrement") {
    return "Sans réponse dans le délai, le dossier peut passer à l'huissier.";
  }
  return "Agir avant l'échéance pour limiter le risque financier.";
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
