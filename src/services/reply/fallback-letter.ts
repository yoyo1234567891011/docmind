import type {
  DocumentAnalysis,
  DocumentClassification,
  DocumentSheet,
  LetterType,
  ReadyReply,
} from "@/types";
import { LETTER_TYPE_LABELS } from "@/types";
import {
  filterDeadlinesForLetter,
  resolveLetterDocFamily,
  shortenLetterSubject,
} from "@/services/reply/letter-intents";
import {
  collectAllowedLetterFacts,
  deriveFactsUsedInLetter,
  formatBankFeeBulletLines,
  sanitizeRecipient,
} from "@/services/reply/letter-quality";

function firstOrg(analysis: DocumentAnalysis, sheet?: DocumentSheet | null): string {
  return (
    sheet?.organizations?.[0] ||
    analysis.organizations[0] ||
    "[Destinataire]"
  );
}

function greeting(recipient: string): string {
  if (recipient && recipient !== "[Destinataire]") {
    return `Madame, Monsieur,\n\nÀ l'attention de ${recipient},`;
  }
  return "Madame, Monsieur,";
}

function closing(): string {
  return [
    "",
    "Dans l'attente de votre réponse sous trente jours, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    "",
    "[Votre nom]",
    "[Votre adresse]",
  ].join("\n");
}

function feeBulletLines(
  allowedFacts: ReturnType<typeof collectAllowedLetterFacts>,
  family: ReturnType<typeof resolveLetterDocFamily>,
  documentText: string,
  analysis: DocumentAnalysis,
  sheet?: DocumentSheet | null,
): string[] {
  if (family === "banque") {
    return formatBankFeeBulletLines(documentText, analysis, sheet);
  }
  return allowedFacts
    .filter((f) => f.label.startsWith("Montant :") || f.label.startsWith("Frais :"))
    .map((f) =>
      `- ${f.label.replace(/^(?:Montant|Frais)\s*:\s*/i, "")}`,
    );
}

/**
 * Courrier déterministe si le LLM est indisponible ou invalide.
 */
export function buildFallbackLetter(
  letterType: LetterType,
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
  reason: string,
  documentText = "",
  sheet?: DocumentSheet | null,
): ReadyReply {
  const family = resolveLetterDocFamily(documentText, analysis, classification);
  const orgs = [
    ...(sheet?.organizations ?? []),
    ...analysis.organizations,
  ];
  const recipient = sanitizeRecipient(
    firstOrg(analysis, sheet),
    orgs,
    documentText,
    analysis.title,
  );
  const dateDoc = analysis.date || "[date du document]";
  const safeDeadlines = filterDeadlinesForLetter(
    sheet?.deadlines?.length ? sheet.deadlines : analysis.deadlines,
  );
  const allowedFacts = collectAllowedLetterFacts({
    documentText,
    analysis,
    sheet,
    letterType,
    family,
  });
  const feeLines = feeBulletLines(
    allowedFacts,
    family,
    documentText,
    analysis,
    sheet,
  );
  const orgLabel = orgs[0] || "votre établissement";

  const templates: Record<
    LetterType,
    { subject: string; body: string; reason: string }
  > = {
    resiliation: {
      subject: `Résiliation de contrat`,
      reason: reason || "Courrier de résiliation basé sur le document analysé.",
      body: [
        greeting(recipient),
        "",
        `Par la présente, je vous informe de ma décision de résilier le contrat ou l'abonnement concerné, tel qu'identifié dans votre document en date du ${dateDoc}.`,
        "",
        safeDeadlines[0]
          ? `Je vous prie de prendre en compte cette demande en respectant les délais applicables, notamment : ${safeDeadlines[0]}.`
          : "Je vous prie de prendre en compte cette demande dans les délais contractuels applicables.",
        "",
        "Je vous remercie de me confirmer par écrit la prise en compte de cette résiliation et la date effective de fin.",
        closing(),
      ].join("\n"),
    },
    remboursement: {
      subject: `Demande de remboursement`,
      reason:
        reason || "Demande de remboursement fondée sur les montants extraits.",
      body: [
        greeting(recipient),
        "",
        `Je vous adresse la présente demande de remboursement concernant le document du ${dateDoc}.`,
        "",
        feeLines.length > 0
          ? `Montant(s) concerné(s) :\n${feeLines.join("\n")}`
          : "Montant concerné : [montant à préciser selon le document].",
        "",
        analysis.important_points[0]
          ? `Motif : ${analysis.important_points[0]}`
          : "Motif : élément identifié dans le document analysé justifiant un remboursement.",
        "",
        "Je vous remercie de procéder au remboursement et de m'en confirmer les modalités sous trente jours.",
        closing(),
      ].join("\n"),
    },
    contestation: {
      subject: shortenLetterSubject(
        family === "banque"
          ? feeLines.length > 0
            ? "Contestation de frais bancaires"
            : "Demande de détail des frais bancaires"
          : "Contestation",
        feeLines.length > 0 ? "contestation" : "autre",
        family,
      ),
      reason: reason || "Contestation fondée sur les éléments du document.",
      body: [
        greeting(recipient),
        "",
        family === "banque"
          ? feeLines.length > 0
            ? `Je conteste formellement les frais et commissions débités sur mon compte, figurant sur le relevé de ${orgLabel} en date du ${dateDoc}.`
            : `Je vous contacte au sujet du relevé de compte de ${orgLabel} en date du ${dateDoc}. Je souhaite obtenir le détail motivé de l'ensemble des frais, commissions et pénalités appliqués sur cette période.`
          : `Je conteste formellement les éléments figurant dans votre document en date du ${dateDoc}.`,
        "",
        feeLines.length > 0
          ? `Je conteste notamment les éléments suivants :\n${feeLines.join("\n")}`
          : family === "banque"
            ? "À ce jour, je ne dispose pas d'un décompte clair et distinct de chaque frais facturé. Je vous demande donc un relevé détaillé avant toute régularisation."
            : analysis.important_points[0]
              ? `Point contesté : ${analysis.important_points[0]}`
              : "Je conteste les montants et opérations identifiés dans le document joint.",
        "",
        "Je vous demande de réexaminer ce dossier, de justifier par écrit chaque montant contesté et de procéder aux corrections nécessaires.",
        closing(),
      ]
        .filter(Boolean)
        .join("\n"),
    },
    reponse_administrative: {
      subject: `Réponse à votre courrier`,
      reason: reason || "Réponse administrative basée sur le document reçu.",
      body: [
        greeting(recipient),
        "",
        `Suite à votre courrier reçu en date du ${dateDoc}, je vous prie de trouver ci-dessous ma réponse.`,
        "",
        analysis.actions[0]
          ? `Concernant votre demande : ${analysis.actions[0]}`
          : "Je vous confirme avoir pris connaissance des éléments transmis et reste à votre disposition pour tout complément.",
        "",
        safeDeadlines[0]
          ? `Je reste attentif à l'échéance du ${safeDeadlines[0]} et vous transmets les pièces demandées dans les meilleurs délais.`
          : "Je reste à votre disposition pour tout complément d'information sous trente jours.",
        closing(),
      ].join("\n"),
    },
    autre: {
      subject: shortenLetterSubject(
        family === "banque"
          ? "Demande d'information sur mon relevé"
          : "Demande d'information",
        "autre",
        family,
      ),
      reason: reason || `Courrier (${LETTER_TYPE_LABELS.autre}).`,
      body: [
        greeting(recipient),
        "",
        family === "banque"
          ? `Je souhaite obtenir des précisions sur les opérations et frais mentionnés sur mon relevé de compte du ${dateDoc}.`
          : `Je souhaite obtenir des précisions concernant le document en date du ${dateDoc}.`,
        "",
        feeLines.length > 0
          ? `Points sur lesquels je souhaite des explications :\n${feeLines.join("\n")}`
          : null,
        "",
        "Je vous remercie de me répondre par écrit sous trente jours.",
        closing(),
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };

  const picked = templates[letterType];
  const body = picked.body;

  return {
    required: true,
    reason: picked.reason,
    subject: shortenLetterSubject(picked.subject, letterType, family),
    body,
    letterType,
    recipient,
    factsUsed: deriveFactsUsedInLetter(body, allowedFacts),
  };
}
