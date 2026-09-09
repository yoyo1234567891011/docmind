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
  documentText = "",
): string {
  const fromLists =
    sheet?.organizations?.find(
      (o) => typeof o === "string" && o.trim().length > 2,
    ) ||
    analysis.organizations?.find(
      (o) => typeof o === "string" && o.trim().length > 2,
    ) ||
    "";
  if (fromLists) return fromLists;

  const bailleur = documentText.match(
    /(?:^|\n)\s*(?:\*\*)?\s*bailleur\s*(?:\*\*)?\s*:\s*(?:\*\*)?\s*([^\n*]{3,60})/i,
  )?.[1];
  if (bailleur) return bailleur.replace(/\*\*/g, "").trim();

  const person = analysis.people?.find(
    (p) => typeof p === "string" && p.trim().length > 2,
  );
  return person ?? "";
}

/** Article + destinataire : « la Direction… », « la Banque… », « du Crédit… ». */
export function formatAttentionRecipient(recipient: string): string {
  if (typeof recipient !== "string") return "";
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
  if (
    /^(service|organisme|etablissement|établissement|tribunal|centre|cr[ée]dit)\b/i.test(
      stripped,
    )
  ) {
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
  const head = documentText.slice(0, 2500);
  const blob = `${head}\n${analysis.title}\n${(analysis.amounts ?? []).join("\n")}`;
  const preferred =
    blob.match(
      /\b((?:IMP|REL|BQE|BAIL|FAC|PRT|CAF|MUT|ASS|NET|MOB|EDF)[-–]?\d{4,})\b/i,
    ) ||
    blob.match(
      /n[°o]\s*allocataire[^:\n]{0,20}:\s*([A-Z]{2,5}[-–]?\d{4,})/i,
    ) ||
    blob.match(/\bn[°o]\s*offre\s*[:\-]?\s*([A-Z]{2,5}[-–]?\d{4,})/i) ||
    blob.match(/\br[eé]f[eé]rence\s*[:\-]?\s*([A-Z]{2,5}[-–]?\d{4,})/i);
  return preferred?.[1]?.replace(/–/g, "-").toUpperCase() ?? "";
}

function cleanFactsList(lines: string[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const raw of lines) {
    if (typeof raw !== "string") continue;
    const t = raw
      .replace(/^[-•*]\s*/, "")
      .replace(/^v[ée]rifier\s+l[''][ée]ch[ée]ance\s*:\s*/i, "")
      .replace(/^anticiper\s+l['']échéance\s*:\s*/i, "")
      .replace(/\s+/g, " ")
      .trim();
    if (!t || t.length < 4) continue;
    if (/^\[|destinataire\]/i.test(t)) continue;
    if (/^\d+(?:[,.]\d+)?\s*€\s*:\s*\d+/i.test(t)) continue;
    // Refuser un montant nu sans libellé (« 483 € »)
    if (/^\d[\d\s.,]*\s*€\s*$/i.test(t)) continue;
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
    .filter(
      (d): d is string =>
        typeof d === "string" && /\d/.test(d) && /€|%|euro|\/mois/i.test(d),
    );

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
    if (family === "social") {
      return /aide|indu|trop|allocation|mensuel/i.test(a);
    }
    if (family === "recouvrement") {
      return /total|principal|impay|frais|p[ée]nalit|recouvrement/i.test(a);
    }
    if (family === "bail") {
      return /loyer|charges|d[ée]p[ôo]t|honoraires|relance/i.test(a);
    }
    if (family === "pret") {
      return /taeg|mensualit|frais\s+de\s+dossier|capital|p[ée]nalit|assurance\s+emprunteur/i.test(
        a,
      );
    }
    if (family === "assurance") {
      return /cotisation|franchise|prime/i.test(a);
    }
    if (family === "facture") {
      return /total\s+ttc|net\s+[àa]\s+payer|montant|option|frais|p[ée]nalit/i.test(
        a,
      );
    }
    return /€|%|euro/i.test(a);
  });

  const fromFacts = allowedFacts
    .filter(
      (f) =>
        typeof f.label === "string" &&
        (f.label.startsWith("Montant :") ||
          f.label.startsWith("Frais :") ||
          /principal|total|majoration|loyer|commission|relance|aide|indu|ttc|capital|taeg/i.test(
            f.label,
          )),
    )
    .map((f) => f.label.replace(/^(?:Montant|Frais)\s*:\s*/i, ""));

  // Extraire majoration % / aide / total TTC depuis le texte si absents du pool.
  const extra: string[] = [];
  if (
    family === "administratif" &&
    !fromAmounts.some((a) => /majoration/i.test(a))
  ) {
    const maj = documentText.match(/majoration[^.\n]{0,40}?(\d+\s*%)/i);
    if (maj) {
      extra.push(`Majoration pour retard : ${maj[1]!.replace(/\s+/g, " ")}`);
    }
  }
  if (family === "social") {
    if (!fromAmounts.some((a) => /aide\s+mensuelle/i.test(a))) {
      const aide = documentText.match(
        /aide\s+mensuelle[^\n€]{0,60}?(\d[\d\s\u00a0\u202f.,]*)\s*€/i,
      );
      if (aide) {
        extra.push(
          `Aide mensuelle : ${aide[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`,
        );
      }
    }
    if (!fromAmounts.some((a) => /indu/i.test(a))) {
      const indu = documentText.match(
        /indu[^\n€]{0,60}?(\d[\d\s\u00a0\u202f.,]*)\s*€/i,
      );
      if (indu) {
        extra.push(
          `Indu éventuel : ${indu[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`,
        );
      }
    }
    const limit = documentText.match(
      /avant\s+le\s+(\d{1,2}[./]\d{1,2}[./]\d{2,4})/i,
    );
    if (limit) {
      extra.push(`Date limite de transmission des pièces : ${limit[1]}`);
    }
  }
  if (
    family === "facture" &&
    !fromAmounts.some((a) => /total\s+ttc|net\s+[àa]\s+payer/i.test(a))
  ) {
    const ttc = documentText.match(
      /total\s+ttc[^\n€]{0,40}?(\d[\d\s.,]*)\s*€/i,
    );
    if (ttc) {
      extra.push(
        `Total TTC : ${ttc[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`,
      );
    }
  }

  return cleanFactsList([...fromAmounts, ...fromFacts, ...extra]);
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
      ? `Faits du document :\n${amountLines.join("\n")}`
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

  if (family === "social") {
    return {
      subject: shortenLetterSubject(
        ref
          ? `Transmission de pièces / maintien des droits — dossier CAF ${ref}`
          : "Transmission de pièces / maintien des droits — dossier CAF",
        "reponse_administrative",
        family,
      ),
      reason:
        reason ||
        "Réponse à une notification CAF : pièces ou maintien des droits.",
      body: [
        head,
        "",
        `Suite à votre notification de ${orgLabel} en date du ${dateDoc}${refBit}, je vous adresse la présente afin de transmettre les pièces demandées et de solliciter le maintien de mes droits.`,
        "",
        factsBlock ??
          "Je vous prie de préciser les pièces attendues, le montant de l'aide concernée et tout indu éventuel.",
        "",
        "Je vous confirme que je procède / procéderai à la transmission des justificatifs demandés. Je vous demande de confirmer le maintien de mon aide au logement (ou prestations concernées) et de m'indiquer par écrit toute suite donnée concernant un éventuel indu ou trop-perçu.",
        "",
        deadline
          ? `Je prends note de la date limite indiquée : ${deadline}.`
          : "Je vous demande une réponse écrite sous trente jours.",
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
    return {
      subject: shortenLetterSubject(
        "Demande relative au bail de location",
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
        "Demande de précisions — contrat d'assurance",
        "reponse_administrative",
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
        "Contestation de facturation",
        "contestation",
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
        "Je conteste les frais ou options concernés et demande un décompte corrigé.",
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
        ref
          ? `Demande relative à l'offre de crédit ${ref}`
          : "Demande relative à mon offre de crédit",
        letterType === "contestation" ? "contestation" : "autre",
        family,
      ),
      reason: reason || "Demande d'information ou contestation sur une offre de prêt.",
      body: [
        head,
        "",
        `Je vous contacte au sujet de l'offre de prêt / crédit de ${orgLabel} en date du ${dateDoc}${refBit}.`,
        "",
        factsBlock ??
          "Je vous prie de me communiquer le TAEG, le capital, la mensualité et le détail des frais (dossier, assurance).",
        "",
        letterType === "contestation"
          ? "Je conteste les frais ou clauses concernés et demande un réexamen motivé avant toute acceptation définitive."
          : "Je vous prie de me communiquer le TAEG, le tableau d'amortissement, les modalités de rétractation et le détail des frais de dossier ou pénalités de remboursement anticipé. La présente ne porte pas sur un relevé de compte.",
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
  const orgs = [
    ...(sheet?.organizations ?? []),
    ...(analysis.organizations ?? []),
  ].filter((o): o is string => typeof o === "string");
  const recipient = sanitizeRecipient(
    firstOrg(analysis, sheet, documentText),
    orgs,
    documentText,
    analysis.title ?? "",
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
    analysis.dates?.find((d) => typeof d === "string" && d.trim())?.trim() ||
    dateFromText ||
    "[date du document]";
  const safeDeadlines = filterDeadlinesForLetter(
    sheet?.deadlines?.length
      ? sheet.deadlines
      : (analysis.deadlines ?? []),
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
  }
  const ref = extractDocReference(documentText, analysis);
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
  if (
    family === "social" &&
    (letterType === "autre" || letterType === "contestation") &&
    !/indu|trop[\s-]per|contest/i.test(documentText.slice(0, 2000))
  ) {
    effectiveType = "reponse_administrative";
  }
  if (family === "pret" && letterType === "reponse_administrative") {
    effectiveType = "autre";
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

  const body = (picked.body ?? "")
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
