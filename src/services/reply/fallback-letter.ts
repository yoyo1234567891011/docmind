/**
 * Courrier déterministe « prêt à copier » — templates par famille documentaire.
 * Pas d’appel LLM.
 */
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
  type WatchDocFamily,
} from "@/services/reply/letter-intents";
import {
  collectAllowedLetterFacts,
  deriveFactsUsedInLetter,
  formatBankFeeBulletLines,
  sanitizeRecipient,
} from "@/services/reply/letter-quality";

function firstOrg(
  analysis: DocumentAnalysis,
  sheet?: DocumentSheet | null,
): string {
  return (
    sheet?.organizations?.find((o) => o.trim().length > 2) ||
    analysis.organizations.find((o) => o.trim().length > 2) ||
    ""
  );
}

/** Article + destinataire : « la Direction… », « la Banque… ». */
export function formatAttentionRecipient(recipient: string): string {
  const r = recipient.replace(/\s+/g, " ").trim();
  if (!r || /^\[/.test(r)) return "";
  if (/^(madame|monsieur|messieurs|mesdames)\b/i.test(r)) {
    return `À l'attention de ${r},`;
  }
  const stripped = r.replace(/^(la|le|les|l['’])\s+/i, "").trim();
  if (
    /^(direction|dgfip|banque|caisse|mutuelle|administration|soci[eé]t[eé]|agence|assurance)/i.test(
      stripped,
    )
  ) {
    return `À l'attention de la ${stripped},`;
  }
  if (/^(service|organisme|etablissement|établissement|tribunal|centre)/i.test(stripped)) {
    return `À l'attention du ${stripped},`;
  }
  return `À l'attention de ${stripped},`;
}

function greeting(recipient: string): string {
  const attention = formatAttentionRecipient(recipient);
  if (attention) {
    return `Madame, Monsieur,\n\n${attention}`;
  }
  return "Madame, Monsieur,";
}

function closing(): string {
  return [
    "",
    "Dans l'attente de votre réponse écrite sous trente jours, je vous prie d'agréer, Madame, Monsieur, l'expression de mes salutations distinguées.",
    "",
    "[Votre nom]",
    "[Votre adresse]",
  ].join("\n");
}

function extractDocReference(documentText: string, analysis: DocumentAnalysis): string {
  const blob = `${documentText}\n${analysis.title}\n${(analysis.amounts ?? []).join("\n")}`;
  const m =
    blob.match(
      /\b((?:IMP|REL|BQE|BAIL|FAC|DOS|PIE)[-–]?\d{4,})\b/i,
    ) ||
    blob.match(/\br[eé]f[eé]rence\s*[:\-]?\s*([A-Z]{2,5}[-–]?\d{4,})/i);
  return m?.[1]?.replace(/–/g, "-").toUpperCase() ?? "";
}

function cleanFactsList(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    const t = raw
      .replace(/^[-•*]\s*/, "")
      .replace(/^v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:\s*/i, "")
      .replace(/^anticiper\s+l['']échéance\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length < 4) continue;
    if (/^\[|destinataire\]/i.test(t)) continue;
    if (/^\d+(?:[,.]\d+)?\s*€\s*:\s*\d+/i.test(t)) continue;
    const key = t.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(t.startsWith("-") ? t : `- ${t}`);
  }
  return out.slice(0, 6);
}

function familyAmountLines(
  family: WatchDocFamily,
  analysis: DocumentAnalysis,
  documentText: string,
  sheet: DocumentSheet | null | undefined,
  allowedFacts: ReturnType<typeof collectAllowedLetterFacts>,
): string[] {
  if (family === "banque") {
    return cleanFactsList(
      formatBankFeeBulletLines(documentText, analysis, sheet).map((l) =>
        l.replace(/^-\s*/, ""),
      ),
    );
  }

  const findingAmounts = (analysis.risk_findings ?? [])
    .map((f) => f.description)
    .filter((d) => /\d/.test(d) && /€|%|euro|\/mois/i.test(d));

  const pool = [
    ...(analysis.amounts ?? []),
    ...findingAmounts,
  ];

  const fromAmounts = pool.filter((a) => {
    if (!/\d/.test(a)) return false;
    if (family === "administratif") {
      return /principal|total|majoration|relance|pr[ée]lever|payer|taxe/i.test(
        a,
      );
    }
    if (family === "recouvrement") {
      return /total|principal|impay|frais|p[ée]nalit|recouvrement/i.test(a);
    }
    if (family === "bail") {
      return /loyer|charges|d[ée]p[ôo]t|honoraires|relance/i.test(a);
    }
    if (family === "pret") {
      return /taeg|mensualit|frais|capital|p[ée]nalit/i.test(a);
    }
    if (family === "assurance") {
      return /cotisation|franchise|prime/i.test(a);
    }
    return /€|%|euro/i.test(a);
  });

  const fromFacts = allowedFacts
    .filter(
      (f) =>
        f.label.startsWith("Montant :") ||
        f.label.startsWith("Frais :") ||
        /principal|total|majoration|loyer|commission|relance/i.test(f.label),
    )
    .map((f) => f.label.replace(/^(?:Montant|Frais)\s*:\s*/i, ""));

  // Extraire majoration % depuis le texte si absente du pool.
  const extra: string[] = [];
  if (
    family === "administratif" &&
    !fromAmounts.some((a) => /majoration/i.test(a))
  ) {
    const maj = documentText.match(
      /majoration[^.\n]{0,40}?(\d+\s*%)/i,
    );
    if (maj) {
      extra.push(`Majoration pour retard : ${maj[1]!.replace(/\s+/g, " ")}`);
    }
  }

  return cleanFactsList([...fromAmounts, ...fromFacts, ...extra]).filter(
    (line) => !/date\s+limite|au\s+plus\s+tard/i.test(line),
  );
}

function usefulDeadline(deadlines: string[]): string | null {
  const hit = deadlines.find((d) =>
    /au\s+plus\s+tard|date\s+limite|sous\s+\d+\s*jours|payer|paiement|pr[ée]l[eè]v|contest/i.test(
      d,
    ),
  );
  return hit?.replace(/\s+/g, " ").trim().slice(0, 140) ?? null;
}

function buildFamilyLetter(input: {
  letterType: LetterType;
  family: WatchDocFamily;
  recipient: string;
  orgLabel: string;
  dateDoc: string;
  ref: string;
  amountLines: string[];
  deadline: string | null;
  reason: string;
}): { subject: string; body: string; reason: string } {
  const {
    letterType,
    family,
    recipient,
    orgLabel,
    dateDoc,
    ref,
    amountLines,
    deadline,
    reason,
  } = input;
  const head = greeting(recipient);
  const factsBlock =
    amountLines.length > 0
      ? `Faits relevés dans le document :\n${amountLines.join("\n")}`
      : null;
  const deadlineBlock = deadline
    ? `Je prends note de l'échéance suivante : ${deadline}.`
    : "Je vous demande une réponse écrite sous trente jours.";
  const refBit = ref ? ` (réf. ${ref})` : "";

  if (letterType === "resiliation") {
    return {
      subject: shortenLetterSubject(
        family === "abonnement"
          ? "Résiliation d'abonnement"
          : family === "assurance"
            ? "Résiliation de contrat d'assurance"
            : "Résiliation de contrat",
        "resiliation",
        family,
      ),
      reason: reason || "Demande de résiliation fondée sur le document analysé.",
      body: [
        head,
        "",
        `Par la présente, je vous informe de ma décision de résilier le contrat concerné auprès de ${orgLabel}, tel qu'identifié dans votre document en date du ${dateDoc}${refBit}.`,
        "",
        factsBlock,
        "",
        deadline
          ? `Je vous prie de prendre en compte cette demande en respectant les délais applicables, notamment : ${deadline}.`
          : "Je vous prie de prendre en compte cette demande dans les délais contractuels applicables.",
        "",
        "Je vous remercie de me confirmer par écrit la prise en compte de cette résiliation et la date effective de fin.",
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (letterType === "remboursement") {
    return {
      subject: "Demande de remboursement",
      reason: reason || "Demande de remboursement fondée sur les montants extraits.",
      body: [
        head,
        "",
        `Je vous adresse la présente demande de remboursement concernant le document de ${orgLabel} du ${dateDoc}${refBit}.`,
        "",
        factsBlock ?? "Montant concerné : à préciser selon le décompte du document.",
        "",
        "Je vous remercie de procéder au remboursement et de m'en confirmer les modalités sous trente jours.",
        closing(),
      ].join("\n"),
    };
  }

  // Contestation / réponse / autre — adaptés par famille
  if (family === "administratif") {
    const subject = shortenLetterSubject(
      ref
        ? `Contestation / demande de délai — avis fiscal ${ref}`
        : "Contestation / demande de délai — avis fiscal",
      "contestation",
      family,
    );
    return {
      subject,
      reason:
        reason ||
        "Contestation ou demande de délai sur la créance fiscale identifiée.",
      body: [
        head,
        "",
        `Je vous écris au sujet de l'avis fiscal émis par ${orgLabel} en date du ${dateDoc}${refBit}.`,
        "",
        "Par la présente, je conteste tout ou partie des montants réclamés, ou à défaut je sollicite un délai de paiement.",
        "",
        factsBlock ??
          "Je vous demande de me communiquer le détail motivé du principal, de la majoration et des frais annexes.",
        "",
        "Je vous prie de réexaminer mon dossier, de justifier chaque montant et de me confirmer par écrit la suite donnée.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (family === "banque") {
    const subject = shortenLetterSubject(
      dateDoc && dateDoc !== "[date du document]"
        ? `Contestation de frais bancaires — relevé du ${dateDoc}`
        : "Contestation de frais bancaires",
      "contestation",
      family,
    );
    return {
      subject,
      reason: reason || "Contestation des frais et commissions du relevé.",
      body: [
        head,
        "",
        `Je conteste formellement les frais et commissions débités sur mon compte, figurant sur le relevé de ${orgLabel} en date du ${dateDoc}.`,
        "",
        factsBlock ??
          "Je vous demande un décompte clair et distinct de chaque frais, commission et pénalité appliqués sur la période.",
        "",
        "Je vous prie de justifier par écrit le fondement de chaque montant et de procéder aux corrections ou remboursements nécessaires.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (family === "recouvrement") {
    return {
      subject: shortenLetterSubject(
        ref
          ? `Contestation de la créance réclamée — ${ref}`
          : "Contestation de la créance réclamée",
        "contestation",
        family,
      ),
      reason: reason || "Contestation de la mise en demeure / créance réclamée.",
      body: [
        head,
        "",
        `Suite à votre mise en demeure / courrier de recouvrement de ${orgLabel} en date du ${dateDoc}${refBit}, je conteste tout ou partie de la créance réclamée.`,
        "",
        factsBlock ??
          "Je vous demande un décompte détaillé (principal, frais, pénalités) avant toute poursuite.",
        "",
        "Je vous prie de suspendre toute mesure d'huissier le temps de l'examen de ma contestation et de me répondre par écrit.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (family === "bail") {
    const isConge = letterType === "resiliation";
    return {
      subject: shortenLetterSubject(
        isConge ? "Congé / fin de bail" : "Demande relative au bail de location",
        letterType === "contestation" ? "contestation" : "autre",
        family,
      ),
      reason: reason || "Courrier relatif au bail de location.",
      body: [
        head,
        "",
        `Je vous contacte au sujet du bail / contrat de location (${orgLabel}), document en date du ${dateDoc}${refBit}.`,
        "",
        factsBlock,
        "",
        letterType === "contestation"
          ? "Je conteste les montants ou clauses concernés et vous demande une réponse motivée."
          : "Je vous prie de me confirmer les éléments utiles (loyer, charges, dépôt, préavis) et la suite à donner.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (family === "assurance") {
    return {
      subject: shortenLetterSubject(
        letterType === "resiliation"
          ? "Résiliation / demande relative au contrat d'assurance"
          : "Demande de précisions — contrat d'assurance",
        letterType === "resiliation" ? "resiliation" : "reponse_administrative",
        family,
      ),
      reason: reason || "Courrier relatif au contrat d'assurance / mutuelle.",
      body: [
        head,
        "",
        `Je vous écris au sujet de mon contrat d'assurance / mutuelle auprès de ${orgLabel} (document du ${dateDoc})${refBit}.`,
        "",
        factsBlock,
        "",
        "Je vous prie de me confirmer cotisation, franchise, délais de carence et modalités de résiliation applicables.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (family === "abonnement" || family === "facture") {
    return {
      subject: shortenLetterSubject(
        letterType === "resiliation"
          ? "Résiliation d'abonnement / contrat"
          : "Contestation de facturation",
        letterType === "resiliation" ? "resiliation" : "contestation",
        family,
      ),
      reason: reason || "Courrier relatif à l'abonnement ou à la facture.",
      body: [
        head,
        "",
        `Je vous contacte au sujet du document de ${orgLabel} en date du ${dateDoc}${refBit}.`,
        "",
        factsBlock,
        "",
        letterType === "resiliation"
          ? "Je vous demande de confirmer la résiliation et la date de fin d'engagement."
          : "Je conteste les frais ou options concernés et demande un décompte corrigé.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  if (family === "pret") {
    return {
      subject: shortenLetterSubject(
        "Demande relative à mon prêt / crédit",
        "autre",
        family,
      ),
      reason: reason || "Demande d'information ou contestation sur un prêt.",
      body: [
        head,
        "",
        `Je souhaite obtenir des précisions sur mon prêt / crédit auprès de ${orgLabel} (document du ${dateDoc})${refBit}.`,
        "",
        factsBlock,
        "",
        "Je vous prie de me communiquer le TAEG, le tableau d'amortissement et le détail des frais de dossier ou pénalités applicables.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  // Admin générique / default
  if (letterType === "reponse_administrative") {
    return {
      subject: "Réponse à votre courrier",
      reason: reason || "Réponse administrative fondée sur le document reçu.",
      body: [
        head,
        "",
        `Suite à votre courrier de ${orgLabel} en date du ${dateDoc}${refBit}, je vous prie de trouver ci-dessous ma réponse.`,
        "",
        factsBlock ??
          "Je vous confirme avoir pris connaissance des éléments transmis.",
        "",
        deadlineBlock,
        closing(),
      ]
        .filter((l) => l !== null)
        .join("\n"),
    };
  }

  return {
    subject: shortenLetterSubject(
      letterType === "contestation" ? "Contestation" : "Demande d'information",
      letterType,
      family,
    ),
    reason: reason || `Courrier (${LETTER_TYPE_LABELS[letterType]}).`,
    body: [
      head,
      "",
      `Je vous contacte au sujet du document de ${orgLabel} en date du ${dateDoc}${refBit}.`,
      "",
      factsBlock,
      "",
      letterType === "contestation"
        ? "Je conteste les éléments concernés et demande un réexamen motivé."
        : "Je vous prie de me fournir les précisions utiles par écrit.",
      "",
      deadlineBlock,
      closing(),
    ]
      .filter((l) => l !== null)
      .join("\n"),
  };
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
  const orgs = [...(sheet?.organizations ?? []), ...analysis.organizations];
  const recipient = sanitizeRecipient(
    firstOrg(analysis, sheet),
    orgs,
    documentText,
    analysis.title,
  );
  const dateFromText =
    documentText.match(
      /date\s+d[''][ée]mission\s*:\s*(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i,
    )?.[1] ??
    documentText.match(
      /\b(\d{1,2}[./]\d{1,2}[./]\d{2,4})\b/,
    )?.[1];
  const dateDoc =
    analysis.date?.trim() ||
    analysis.dates?.[0]?.trim() ||
    dateFromText ||
    "[date du document]";
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
  const amountLines = familyAmountLines(
    family,
    analysis,
    documentText,
    sheet,
    allowedFacts,
  );
  let orgLabel = orgs.find((o) => o.trim().length > 2) || "votre établissement";
  if (
    /^(direction|banque|caisse|mutuelle|administration|soci[eé]t[eé])/i.test(
      orgLabel,
    ) &&
    !/^(la|le|les)\s/i.test(orgLabel)
  ) {
    orgLabel = `la ${orgLabel}`;
  }  const ref = extractDocReference(documentText, analysis);
  const deadline = usefulDeadline(safeDeadlines);

  // Intention : ne pas laisser « autre » molle si la famille impose contestation.
  let effectiveType = letterType;
  if (
    (family === "administratif" ||
      family === "banque" ||
      family === "recouvrement") &&
    (letterType === "autre" || letterType === "reponse_administrative") &&
    amountLines.length > 0
  ) {
    effectiveType = "contestation";
  }

  const picked = buildFamilyLetter({
    letterType: effectiveType,
    family,
    recipient,
    orgLabel,
    dateDoc,
    ref,
    amountLines,
    deadline,
    reason,
  });

  const body = picked.body
    .replace(/\n{3,}/g, "\n\n")
    .replace(/V[ée]rifier l[''][ée]ch[ée]ance\s*:/gi, "")
    .trim();

  return {
    required: true,
    reason: picked.reason,
    subject: picked.subject,
    body,
    letterType: effectiveType,
    recipient,
    factsUsed: deriveFactsUsedInLetter(body, allowedFacts),
  };
}
