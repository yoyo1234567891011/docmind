import type {
  DocumentAnalysis,
  DocumentClassification,
  LetterType,
  ReadyReply,
} from "@/types";
import { LETTER_TYPE_LABELS } from "@/types";

function firstOrg(analysis: DocumentAnalysis): string {
  return analysis.organizations[0] || "[Destinataire]";
}

function factsUsed(analysis: DocumentAnalysis): string[] {
  return [
    analysis.title && `Titre : ${analysis.title}`,
    analysis.date && `Date : ${analysis.date}`,
    ...analysis.organizations.slice(0, 2).map((o) => `Organisation : ${o}`),
    ...analysis.amounts.slice(0, 2).map((a) => `Montant : ${a}`),
    ...analysis.deadlines.slice(0, 2).map((d) => `Échéance : ${d}`),
    ...analysis.people.slice(0, 2).map((p) => `Personne : ${p}`),
  ].filter(Boolean) as string[];
}

/**
 * Courrier déterministe si le LLM est indisponible.
 * S’appuie uniquement sur les informations extraites.
 */
export function buildFallbackLetter(
  letterType: LetterType,
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
  reason: string,
): ReadyReply {
  const recipient = firstOrg(analysis);
  const ref = analysis.title || classification.label || "votre document";
  const amount = analysis.amounts[0] || "[montant]";
  const deadline = analysis.deadlines[0] || "[date]";
  const dateDoc = analysis.date || "[date du document]";
  const facts = factsUsed(analysis);

  const templates: Record<
    LetterType,
    { subject: string; body: string; reason: string }
  > = {
    resiliation: {
      subject: `Résiliation — ${ref}`,
      reason: reason || "Courrier de résiliation basé sur le document analysé.",
      body: [
        `${recipient},`,
        "",
        `Je vous informe par la présente de ma volonté de résilier le contrat / engagement relatif à « ${ref} » (document du ${dateDoc}).`,
        "",
        analysis.deadlines[0]
          ? `Je vous prie de bien vouloir prendre en compte cette demande en respectant les échéances mentionnées, notamment : ${deadline}.`
          : "Je vous prie de bien vouloir prendre en compte cette demande dans les délais contractuels applicables.",
        "",
        "Je vous remercie de me confirmer par écrit la prise en compte de cette résiliation, ainsi que la date effective de fin.",
        "",
        "Dans l’attente de votre retour, je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
        "",
        "[Votre nom]",
        "[Votre adresse]",
      ].join("\n"),
    },
    remboursement: {
      subject: `Demande de remboursement — ${ref}`,
      reason:
        reason || "Demande de remboursement fondée sur les montants extraits.",
      body: [
        `${recipient},`,
        "",
        `Je vous adresse cette demande de remboursement concernant « ${ref} » (document du ${dateDoc}).`,
        "",
        `Montant concerné : ${amount}.`,
        "",
        analysis.important_points[0]
          ? `Motif : ${analysis.important_points[0]}`
          : "Motif : élément identifié dans le document analysé justifiant un remboursement.",
        "",
        "Je vous remercie de procéder au remboursement dans les meilleurs délais et de m’en confirmer les modalités.",
        "",
        "Veuillez agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
        "",
        "[Votre nom]",
      ].join("\n"),
    },
    contestation: {
      subject: `Contestation — ${ref}`,
      reason: reason || "Contestation fondée sur les éléments du document.",
      body: [
        `${recipient},`,
        "",
        `Je conteste formellement les éléments relatifs à « ${ref} » en date du ${dateDoc}.`,
        "",
        analysis.amounts[0] ? `Montant contesté : ${amount}.` : null,
        analysis.risks[0]
          ? `Point contesté : ${analysis.risks[0]}`
          : analysis.important_points[0]
            ? `Point contesté : ${analysis.important_points[0]}`
            : "Point contesté : élément identifié dans l’analyse du document.",
        "",
        "Je vous prie de réexaminer ce dossier et de me répondre par écrit, en justifiant votre position.",
        analysis.deadlines[0]
          ? `Je vous rappelle l’échéance associée : ${deadline}.`
          : null,
        "",
        "Dans cette attente, je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
        "",
        "[Votre nom]",
      ]
        .filter(Boolean)
        .join("\n"),
    },
    reponse_administrative: {
      subject: `Réponse — ${ref}`,
      reason: reason || "Réponse administrative basée sur le document reçu.",
      body: [
        `${recipient},`,
        "",
        `Suite à votre courrier / document « ${ref} » en date du ${dateDoc}, je vous prie de trouver ci-dessous ma réponse.`,
        "",
        analysis.actions[0]
          ? `Concernant la demande : ${analysis.actions[0]}`
          : "Je vous confirme avoir pris connaissance des éléments transmis.",
        "",
        analysis.deadlines[0]
          ? `Je reste attentif à l’échéance indiquée (${deadline}) et reste à votre disposition pour tout complément.`
          : "Je reste à votre disposition pour tout complément d’information.",
        "",
        "Je vous prie d’agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
        "",
        "[Votre nom]",
      ].join("\n"),
    },
    autre: {
      subject: `Courrier — ${ref}`,
      reason: reason || `Courrier (${LETTER_TYPE_LABELS.autre}).`,
      body: [
        `${recipient},`,
        "",
        `Je vous contacte au sujet de « ${ref} » (document du ${dateDoc}).`,
        "",
        analysis.summary ||
          "Objet : suite au document analysé, je souhaite formaliser ma demande par écrit.",
        "",
        analysis.amounts[0] ? `Montant(s) concerné(s) : ${amount}.` : null,
        analysis.deadlines[0] ? `Échéance : ${deadline}.` : null,
        "",
        "Je vous remercie de l’attention portée à ma demande.",
        "",
        "Veuillez agréer, Madame, Monsieur, l’expression de mes salutations distinguées.",
        "",
        "[Votre nom]",
      ]
        .filter(Boolean)
        .join("\n"),
    },
  };

  const picked = templates[letterType];
  return {
    required: true,
    reason: picked.reason,
    subject: picked.subject,
    body: picked.body,
    letterType,
    recipient,
    factsUsed: facts,
  };
}

