import { resolveWatchDocFamily } from "@/ai/post-processing/watch-ranking";
import type { WatchDocFamily } from "@/ai/post-processing/watch-ranking";
import type {
  DocumentAnalysis,
  DocumentClassification,
  LetterType,
} from "@/types";

export type { WatchDocFamily };

export interface LetterFamilyRule {
  /** Types autorisés pour cette famille (ordre = priorité d’affichage). */
  allowed: readonly LetterType[];
  /** Types interdits même si le texte les évoque. */
  forbidden: readonly LetterType[];
  /** Intention par défaut si aucun signal clair. */
  defaultType: LetterType;
  defaultReason: string;
}

/** Politique intention courrier par famille documentaire (alignée watch-ranking). */
export const LETTER_FAMILY_RULES: Record<WatchDocFamily, LetterFamilyRule> = {
  banque: {
    allowed: ["contestation", "autre", "remboursement"],
    forbidden: ["resiliation"],
    defaultType: "autre",
    defaultReason:
      "Relevé ou document bancaire : demande d’information ou de précision (pas de résiliation de relevé).",
  },
  recouvrement: {
    allowed: ["contestation", "reponse_administrative", "remboursement"],
    forbidden: ["resiliation"],
    defaultType: "reponse_administrative",
    defaultReason:
      "Courrier de recouvrement : réponse formelle, contestation ou demande de décompte.",
  },
  facture: {
    allowed: ["contestation", "remboursement", "resiliation"],
    forbidden: [],
    defaultType: "contestation",
    defaultReason: "Facture : contestation ou demande de remboursement si montant litigieux.",
  },
  abonnement: {
    allowed: ["resiliation", "contestation", "remboursement"],
    forbidden: [],
    defaultType: "resiliation",
    defaultReason: "Contrat d’abonnement : résiliation ou contestation de facturation.",
  },
  bail: {
    allowed: ["autre", "contestation", "reponse_administrative", "resiliation"],
    forbidden: [],
    defaultType: "autre",
    defaultReason:
      "Bail / location : congé, quittance ou contestation de charges (selon votre objectif).",
  },
  assurance: {
    allowed: ["resiliation", "contestation", "reponse_administrative", "autre"],
    forbidden: [],
    defaultType: "reponse_administrative",
    defaultReason:
      "Assurance / mutuelle : réponse, résiliation à échéance ou demande d’informations.",
  },
  pret: {
    allowed: ["contestation", "reponse_administrative", "autre"],
    forbidden: ["resiliation"],
    defaultType: "autre",
    defaultReason:
      "Prêt / crédit : demande d’information (TAEG, échéancier) ou contestation ciblée.",
  },
  administratif: {
    allowed: ["reponse_administrative", "contestation", "autre"],
    forbidden: ["resiliation", "remboursement"],
    defaultType: "reponse_administrative",
    defaultReason:
      "Courrier administratif : réponse avec pièces, demande de délai ou contestation.",
  },
  default: {
    allowed: ["autre", "contestation", "reponse_administrative"],
    forbidden: ["resiliation"],
    defaultType: "autre",
    defaultReason:
      "Document non identifié : demande d’information ou de clarification uniquement.",
  },
};

const RECIPIENT_OBLIGATION_RE =
  /signaler\s+(?:sans\s+d[eé]lai\s+)?(?:tout\s+)?changement|sans\s+d[eé]lai\s+tout\s+changement|mettre\s+[àa]\s+jour\s+vos\s+coordonn|informer\s+(?:la\s+)?banque|obligation\s+du\s+(?:client|titulaire)|vous\s+devez\s+(?:nous\s+)?informer|tenue\s+de\s+compte\s+incombe|traiter\s+les\s+r[ée]clamations/i;

const TECHNICAL_TITLE_RE =
  /^(?:relev[ée]|extrait|avis|document)\s+(?:de\s+compte|bancaire)|p[ée]riode\s+du\s+\d|compte\s+n[°o]/i;

/** Obligations du client/bénéficiaire — ne pas les traiter comme échéance contractuelle. */
export function isRecipientObligation(text: string): boolean {
  return RECIPIENT_OBLIGATION_RE.test(text.trim());
}

export function filterDeadlinesForLetter(deadlines: string[]): string[] {
  return deadlines.filter((d) => d.trim() && !isRecipientObligation(d));
}

/** Objet court : évite titres techniques de PDF. */
export function shortenLetterSubject(
  raw: string,
  letterType: LetterType,
  family: WatchDocFamily,
): string {
  let subject = raw
    .replace(/\s+/g, " ")
    .replace(/p[ée]riode\s+du\s+[\d/.\s]+\s+au\s+[\d/.\s]+/gi, "")
    .replace(/relev[ée]\s+de\s+compte\s*[-–—]?\s*/gi, "")
    .trim();

  if (!subject || TECHNICAL_TITLE_RE.test(subject) || subject.length > 80) {
    const defaults: Partial<Record<LetterType, string>> = {
      contestation: "Contestation de frais ou d’opérations",
      remboursement: "Demande de remboursement",
      resiliation: "Résiliation de contrat",
      reponse_administrative: "Réponse à votre courrier",
      autre:
        family === "banque"
          ? "Demande d’information bancaire"
          : "Demande d’information",
    };
    subject = defaults[letterType] ?? "Courrier relatif au document";
  }

  if (subject.length > 80) {
    subject = `${subject.slice(0, 77).trimEnd()}…`;
  }
  return subject;
}

export function resolveLetterDocFamily(
  documentText: string,
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
): WatchDocFamily {
  const family = resolveWatchDocFamily({
    category: classification.category,
    documentType: analysis.document_type,
    title: analysis.title,
    textHint: documentText,
  });

  if (
    family === "default" &&
    (classification.category === "contrat" ||
      classification.category === "conditions-generales")
  ) {
    const blob = `${documentText}\n${analysis.document_type}\n${analysis.title}`.toLowerCase();
    if (/abonnement|forfait|offre\s+(?:mobile|internet|fibre)/.test(blob)) {
      return "abonnement";
    }
  }

  return family;
}

export function isLetterTypeAllowed(
  family: WatchDocFamily,
  letterType: LetterType,
): boolean {
  const rule = LETTER_FAMILY_RULES[family];
  if (rule.forbidden.includes(letterType)) return false;
  return rule.allowed.includes(letterType);
}

export interface IntentCandidate {
  letterType: LetterType;
  reason: string;
  confidence: number;
  score: number;
}

function pushCandidate(
  list: IntentCandidate[],
  candidate: IntentCandidate,
  family: WatchDocFamily,
): void {
  if (!isLetterTypeAllowed(family, candidate.letterType)) return;
  if (list.some((c) => c.letterType === candidate.letterType)) return;
  list.push(candidate);
}

/**
 * Détecte les intentions pertinentes selon la famille et le contenu.
 * Retourne 1 intention principale + jusqu’à 2 alternatives.
 */
export function rankLetterIntents(
  corpus: string,
  family: WatchDocFamily,
): IntentCandidate[] {
  const rule = LETTER_FAMILY_RULES[family];
  const candidates: IntentCandidate[] = [];

  const hasResiliationSignal =
    /r[ée]sili|d[ée]nonci|mettre\s+fin\s+au\s+contrat|pr[ée]avis\s+de\s+r[ée]siliation/i.test(
      corpus,
    ) && !/relev[ée]\s+(?:de\s+)?compte/i.test(corpus);

  const hasRefundSignal =
    /rembours|trop[- ]?per[çc]u|avoir\s+client|cr[ée]dit\s+[àa]\s+votre\s+faveur|demande\s+de\s+remboursement/i.test(
      corpus,
    );

  const hasContestSignal =
    /contest|d[ée]saccord|erreur\s+de\s+facturation|montant\s+erron[ée]|je\s+conteste|litige|frais\s+(?:bancaires|de\s+tenue)|commission|agios|d[ée]couvert/i.test(
      corpus,
    );

  const hasAdminSignal =
    /mise\s+en\s+demeure|r[ée]ponse\s+attendue|observation|d[ée]lai\s+de\s+r[ée]ponse|pi[èe]ces?\s+justificatives|d[ée]compte/i.test(
      corpus,
    );

  const hasCongeSignal =
    /cong[ée]\s+(?:du\s+)?bail|quittance|d[ée]p[ôo]t\s+de\s+garantie|charges\s+locatives/i.test(
      corpus,
    );

  const hasClosureSignal =
    /cl[ôo]ture\s+(?:de\s+)?compte|fermeture\s+(?:de\s+)?compte|opposition\s+(?:au\s+)?pr[ée]l[èe]vement/i.test(
      corpus,
    );

  const hasInfoSignal =
    /demande\s+(?:de\s+)?(?:information|pr[ée]cision|d[ée]tail)|taeg|[ée]ch[ée]ancier|conditions\s+(?:tarifaires|g[ée]n[ée]rales)/i.test(
      corpus,
    );

  switch (family) {
    case "banque":
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Frais, commissions ou opérations à contester sur le relevé.",
            confidence: 0.88,
            score: 90,
          },
          family,
        );
      }
      if (hasClosureSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "autre",
            reason: "Demande de clôture de compte ou opposition à un prélèvement.",
            confidence: 0.82,
            score: 80,
          },
          family,
        );
      }
      if (hasRefundSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "remboursement",
            reason: "Remboursement d’un prélèvement ou frais indûment facturés.",
            confidence: 0.75,
            score: 70,
          },
          family,
        );
      }
      pushCandidate(
        candidates,
        {
          letterType: "autre",
          reason: "Demande de détail tarifaire ou d’information sur les opérations.",
          confidence: 0.65,
          score: 50,
        },
        family,
      );
      break;

    case "recouvrement":
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation du montant réclamé ou de la créance.",
            confidence: 0.9,
            score: 95,
          },
          family,
        );
      }
      if (hasAdminSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "reponse_administrative",
            reason: "Réponse formelle, demande de délai ou de décompte détaillé.",
            confidence: 0.85,
            score: 85,
          },
          family,
        );
      }
      if (hasRefundSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "remboursement",
            reason: "Trop-perçu ou paiement déjà effectué à faire reconnaître.",
            confidence: 0.7,
            score: 65,
          },
          family,
        );
      }
      break;

    case "facture":
    case "abonnement":
      if (hasResiliationSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "resiliation",
            reason: "Résiliation d’abonnement ou de contrat de fourniture.",
            confidence: 0.88,
            score: 90,
          },
          family,
        );
      }
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation de la facture ou d’un montant facturé.",
            confidence: 0.85,
            score: 85,
          },
          family,
        );
      }
      if (hasRefundSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "remboursement",
            reason: "Demande de remboursement ou d’avoir.",
            confidence: 0.8,
            score: 75,
          },
          family,
        );
      }
      break;

    case "bail":
      if (hasCongeSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "resiliation",
            reason: "Congé du bail ou fin de location (préavis).",
            confidence: 0.88,
            score: 90,
          },
          family,
        );
        pushCandidate(
          candidates,
          {
            letterType: "autre",
            reason: "Demande de quittance ou d’état des lieux / charges.",
            confidence: 0.75,
            score: 70,
          },
          family,
        );
      }
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation de charges, dépôt de garantie ou montant dû.",
            confidence: 0.82,
            score: 80,
          },
          family,
        );
      }
      break;

    case "assurance":
      if (hasResiliationSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "resiliation",
            reason: "Résiliation du contrat d’assurance à l’échéance.",
            confidence: 0.85,
            score: 85,
          },
          family,
        );
      }
      if (hasAdminSignal || hasInfoSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "reponse_administrative",
            reason: "Réponse sur sinistre, garanties ou conditions contractuelles.",
            confidence: 0.8,
            score: 75,
          },
          family,
        );
      }
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation de refus de prise en charge ou de montant.",
            confidence: 0.78,
            score: 72,
          },
          family,
        );
      }
      break;

    case "pret":
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation d’un montant ou d’une clause du prêt.",
            confidence: 0.82,
            score: 80,
          },
          family,
        );
      }
      if (hasAdminSignal || hasInfoSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "reponse_administrative",
            reason: "Demande d’informations (TAEG, assurance, échéancier).",
            confidence: 0.78,
            score: 75,
          },
          family,
        );
      }
      pushCandidate(
        candidates,
        {
          letterType: "autre",
          reason: "Demande de remboursement anticipé ou de rétractation (si délai légal applicable).",
          confidence: 0.6,
          score: 55,
        },
        family,
      );
      break;

    case "administratif":
      if (hasAdminSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "reponse_administrative",
            reason: "Réponse administrative avec pièces ou demande de délai.",
            confidence: 0.88,
            score: 90,
          },
          family,
        );
      }
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation d’un montant ou d’une décision administrative.",
            confidence: 0.82,
            score: 80,
          },
          family,
        );
      }
      break;

    default:
      if (hasContestSignal) {
        pushCandidate(
          candidates,
          {
            letterType: "contestation",
            reason: "Contestation fondée sur les éléments du document.",
            confidence: 0.7,
            score: 65,
          },
          family,
        );
      }
      pushCandidate(
        candidates,
        {
          letterType: "autre",
          reason: "Demande d’information ou de clarification sur le document.",
          confidence: 0.55,
          score: 40,
        },
        family,
      );
      break;
  }

  candidates.sort((a, b) => b.score - a.score);

  if (candidates.length === 0) {
    return [
      {
        letterType: rule.defaultType,
        reason: rule.defaultReason,
        confidence: 0.5,
        score: 30,
      },
    ];
  }

  return candidates;
}
