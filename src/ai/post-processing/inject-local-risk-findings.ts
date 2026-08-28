import { RISK_CRITERIA } from "@/services/risk/criteria";
import { detectRiskCriterion } from "@/services/risk/detect";
import {
  cleanExcerptForDisplay,
  truncateAtTextBoundary,
} from "@/ai/post-processing/display-cleanup";
import {
  LOCAL_INJECT_CRITERIA_BY_FAMILY,
  resolveWatchDocFamily,
  isFactureTtcWatchTitle,
  isRecouvrementTotalWatchTitle,
  type WatchDocFamily,
  type WatchFamilyContext,
} from "@/ai/post-processing/watch-ranking";
import type { RiskCriterionId, RiskFinding, RiskSeverity } from "@/types";

/** @deprecated Préférer LOCAL_INJECT_CRITERIA_BY_FAMILY — conservé pour les tests. */
export const LOCAL_PRIORITY_CRITERION_IDS: readonly RiskCriterionId[] =
  LOCAL_INJECT_CRITERIA_BY_FAMILY.recouvrement;

type LocalFindingMeta = {
  why: string;
  implication: string;
  consequence: string;
  mitigation: string;
  severity: RiskSeverity;
  confidence: number;
};

const LOCAL_FINDING_META: Partial<Record<RiskCriterionId, LocalFindingMeta>> = {
  frais_caches: {
    why: "Le document mentionne des frais annexes, cachés ou de gestion.",
    implication: "Le coût réel peut dépasser le prix affiché ou le principal.",
    consequence: "Surprise financière ou contestation plus difficile après coup.",
    mitigation: "Lister chaque frais et vérifier son fondement avant d’accepter.",
    severity: "eleve",
    confidence: 0.9,
  },
  penalites: {
    why: "Des pénalités ou indemnités sont expressément prévues.",
    implication: "Un manquement (retard, résiliation, matériel) augmente la dette.",
    consequence: "Majoration rapide du montant dû.",
    mitigation: "Contrôler le montant et contester toute pénalité non due.",
    severity: "eleve",
    confidence: 0.92,
  },
  delais: {
    why: "Un délai, une échéance ou une date limite est fixé dans le document.",
    implication: "Le destinataire doit agir avant cette échéance.",
    consequence: "Perte de droits (résiliation, contestation) ou passage à l’exécution.",
    mitigation: "Noter la date limite et répondre par écrit avec preuve d’envoi.",
    severity: "eleve",
    confidence: 0.9,
  },
  sanctions: {
    why: "Le document annonce des poursuites, un huissier ou un recouvrement forcé.",
    implication: "Sans réaction, la situation peut basculer vers l’exécution judiciaire.",
    consequence: "Frais d’huissier, saisie ou contentieux plus coûteux.",
    mitigation: "Traiter la mise en demeure sans délai et solliciter un conseil si besoin.",
    severity: "critique",
    confidence: 0.92,
  },
  obligations_importantes: {
    why: "Le destinataire est sommé d’agir (payer, contester, régulariser).",
    implication: "L’inaction peut être interprétée comme une acceptation.",
    consequence: "Perte de moyens de défense ou aggravation de la créance.",
    mitigation: "Identifier l’obligation exacte et y répondre dans le délai indiqué.",
    severity: "eleve",
    confidence: 0.88,
  },
  engagement: {
    why: "Une durée d’engagement minimale est prévue.",
    implication: "Résilier avant terme peut coûter cher ou être impossible.",
    consequence: "Frais de résiliation anticipée ou maintien forcé du contrat.",
    mitigation: "Vérifier la durée restante et le coût d’une sortie anticipée.",
    severity: "eleve",
    confidence: 0.9,
  },
  resiliation: {
    why: "Des conditions de résiliation (préavis, frais, date limite) sont prévues.",
    implication: "Manquer la fenêtre de résiliation prolonge l’engagement.",
    consequence: "Reconduction ou frais de sortie.",
    mitigation: "Repérer le préavis et la date limite de dénonciation.",
    severity: "eleve",
    confidence: 0.9,
  },
  renouvellement_tacite: {
    why: "Le contrat prévoit une reconduction ou un renouvellement automatique.",
    implication: "Sans dénonciation dans les délais, l’engagement continue.",
    consequence: "Nouvelle période facturée sans action explicite.",
    mitigation: "Calendrier de dénonciation et envoi d’une résiliation datée.",
    severity: "eleve",
    confidence: 0.92,
  },
  augmentation_tarif: {
    why: "Le document prévoit une révision, indexation ou hausse de tarif/loyer.",
    implication: "Le montant peut augmenter sans nouvel accord explicite.",
    consequence: "Budget plus élevé après révision (ex. IRL).",
    mitigation: "Vérifier l’indice, la périodicité et le plafond de révision.",
    severity: "modere",
    confidence: 0.88,
  },
  clauses_abusives: {
    why: "Une clause déséquilibrée ou particulièrement sévère est présente (ex. résolutoire).",
    implication: "Un manquement peut entraîner une sanction rapide.",
    consequence: "Résiliation de plein droit, expulsion ou perte de droits.",
    mitigation: "Faire vérifier la clause et les délais de mise en demeure.",
    severity: "eleve",
    confidence: 0.9,
  },
};

function firstEuroAmount(text: string): string | null {
  const m = text.match(
    /(\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|euros?\b)/i,
  );
  if (!m) return null;
  return `${m[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`;
}

function euroAmountNear(text: string, keyword: RegExp): string | null {
  const amountGroup =
    "(\\d+(?:[\\s\\u00a0]\\d{3})*(?:[.,]\\d{1,2})?)\\s*(?:€|euros?\\b)";
  const after = text.match(
    new RegExp(`${keyword.source}[^\\d]{0,40}${amountGroup}`, "i"),
  );
  if (after) {
    return `${after[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`;
  }
  const before = text.match(
    new RegExp(`${amountGroup}[^\\d]{0,40}${keyword.source}`, "i"),
  );
  if (before) {
    return `${before[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`;
  }
  return firstEuroAmount(text);
}

function firstDayDeadline(text: string): string | null {
  const num = text.match(
    /(?:sous|dans|délai\s+de|contester\s+sous)\s+(\d+)\s*jours?/i,
  );
  if (num) return `${num[1]} jours`;
  if (/sous\s+huit\s+jours/i.test(text)) return "8 jours";
  if (/sous\s+dix\s+jours/i.test(text)) return "10 jours";
  if (/sous\s+quinze\s+jours/i.test(text)) return "15 jours";
  const loose = text.match(/(\d+)\s*jours?/i);
  if (loose) return `${loose[1]} jours`;
  return null;
}

function engagementDuration(text: string): string | null {
  const m = text.match(
    /engagement(?:\s+de|\s+pour|\s*:)?\s*(\d+)\s*(mois|ans?)/i,
  );
  if (m) return `${m[1]} ${m[2]!.toLowerCase()}`;
  const m2 = text.match(/dur[ée]e\s+(?:minimale\s+)?(?:d['']engagement\s+)?(?:de\s+)?(\d+)\s*(mois|ans?)/i);
  if (m2) return `${m2[1]} ${m2[2]!.toLowerCase()}`;
  return null;
}

/** Titre court orienté « Points à surveiller ». */
export function describeLocalFinding(
  criterionId: RiskCriterionId,
  excerpt: string,
  family: WatchDocFamily = "default",
): string {
  const days = firstDayDeadline(excerpt);

  switch (criterionId) {
    case "penalites": {
      if (/mat[ée]riel|non[\s-]retour|box|routeur|d[ée]codeur/i.test(excerpt)) {
        const amount = firstEuroAmount(excerpt);
        return amount
          ? `Pénalités de non-retour de matériel : ${amount}`
          : "Pénalités liées au matériel";
      }
      if (/r[ée]siliation/i.test(excerpt)) {
        const amount = firstEuroAmount(excerpt);
        return amount
          ? `Pénalité de résiliation : ${amount}`
          : "Pénalité de résiliation";
      }
      const amount =
        euroAmountNear(excerpt, /p[ée]nalit[ée]s?(?:\s+de\s+retard)?/) ||
        firstEuroAmount(excerpt);
      if (family === "recouvrement" || /retard/i.test(excerpt)) {
        return amount
          ? `Pénalités de retard : ${amount}`
          : "Pénalités ou indemnités de retard";
      }
      return amount ? `Pénalités : ${amount}` : "Pénalités prévues au contrat";
    }
    case "frais_caches": {
      if (family === "bail") {
        if (/loyer/i.test(excerpt)) {
          const amount = euroAmountNear(excerpt, /loyer/) || firstEuroAmount(excerpt);
          return amount ? `Loyer : ${amount}/mois` : "Loyer mensuel";
        }
        if (/charges/i.test(excerpt)) {
          const amount =
            euroAmountNear(excerpt, /charges/) || firstEuroAmount(excerpt);
          return amount
            ? `Charges : ${amount}/mois`
            : "Charges locatives / provisions";
        }
        if (/d[ée]p[ôo]t\s+de\s+garantie/i.test(excerpt)) {
          const amount =
            euroAmountNear(excerpt, /d[ée]p[ôo]t/) || firstEuroAmount(excerpt);
          return amount
            ? `Dépôt de garantie : ${amount}`
            : "Dépôt de garantie";
        }
        if (/honoraires?/i.test(excerpt)) {
          const amount =
            euroAmountNear(excerpt, /honoraires?/) || firstEuroAmount(excerpt);
          return amount
            ? `Honoraires / frais de location : ${amount}`
            : "Honoraires de mise en location";
        }
      }
      if (family === "pret") {
        if (/\btaeg\b|taux\s+annuel/i.test(excerpt)) {
          return "TAEG / taux effectif global";
        }
        if (/mensualit/i.test(excerpt)) {
          const amount = firstEuroAmount(excerpt);
          return amount ? `Mensualité : ${amount}` : "Mensualité de remboursement";
        }
        if (/capital/i.test(excerpt)) {
          const amount = firstEuroAmount(excerpt);
          return amount ? `Capital emprunté : ${amount}` : "Capital emprunté";
        }
        if (/frais\s+de\s+dossier/i.test(excerpt)) {
          const amount = firstEuroAmount(excerpt);
          return amount ? `Frais de dossier : ${amount}` : "Frais de dossier";
        }
        if (/assurance\s+emprunteur/i.test(excerpt)) {
          return "Assurance emprunteur";
        }
      }
      if (family === "administratif") {
        if (/taxe\s+fonci/i.test(excerpt)) {
          const amount =
            euroAmountNear(excerpt, /taxe\s+fonci/) || firstEuroAmount(excerpt);
          return amount ? `Taxe foncière : ${amount}` : "Taxe foncière";
        }
        if (/pr[ée]l[eè]v/i.test(excerpt)) {
          const amount =
            euroAmountNear(excerpt, /pr[ée]l[eè]v/) || firstEuroAmount(excerpt);
          return amount
            ? `Montant à prélever : ${amount}`
            : "Montant à prélever";
        }
        if (/[àa]\s+payer|montant\s+d[ûu]|cotisation/i.test(excerpt)) {
          const amount = firstEuroAmount(excerpt);
          return amount ? `Montant à payer : ${amount}` : "Montant à payer";
        }
      }
      if (family === "facture") {
        if (/total\s+ttc|net\s+[àa]\s+payer/i.test(excerpt)) {
          const amount = firstEuroAmount(excerpt);
          return amount ? `Total TTC : ${amount}` : "Total TTC";
        }
        if (/[ée]ch[ée]ance/i.test(excerpt)) {
          return "Date d'échéance de paiement";
        }
      }
      if (/franchise/i.test(excerpt)) {
        const amount = euroAmountNear(excerpt, /franchise/) || firstEuroAmount(excerpt);
        return amount ? `Franchise : ${amount}` : "Franchise élevée";
      }
      if (/tenue\s+de\s+compte/i.test(excerpt)) {
        const amount = euroAmountNear(excerpt, /tenue/);
        return amount
          ? `Frais de tenue de compte : ${amount}`
          : "Frais de tenue de compte";
      }
      if (/commission\s+d['']intervention/i.test(excerpt)) {
        const amount = euroAmountNear(excerpt, /intervention/);
        return amount
          ? `Commission d’intervention : ${amount}`
          : "Commission d’intervention";
      }
      if (/int[ée]r[êe]ts?\s+d[ée]biteurs/i.test(excerpt)) {
        const amount = euroAmountNear(excerpt, /int[ée]r[êe]ts?\s+d[ée]biteurs/);
        return amount ? `Intérêts débiteurs : ${amount}` : "Intérêts débiteurs";
      }
      if (/frais\s+de\s+rejet/i.test(excerpt)) {
        const amount = euroAmountNear(excerpt, /rejet/);
        return amount ? `Frais de rejet : ${amount}` : "Frais de rejet";
      }
      if (/d[ée]couvert/i.test(excerpt)) {
        return "Découvert autorisé / dépassé";
      }
      if (/recouvrement/i.test(excerpt)) {
        const amount = euroAmountNear(excerpt, /recouvrement/);
        return amount
          ? `Frais de recouvrement : ${amount}`
          : "Frais de recouvrement";
      }
      if (/r[ée]siliation/i.test(excerpt)) {
        const amount = firstEuroAmount(excerpt);
        return amount
          ? `Frais de résiliation anticipée : ${amount}`
          : "Frais de résiliation anticipée";
      }
      if (/mensuel|par\s+mois|\/mois/i.test(excerpt)) {
        const amount = firstEuroAmount(excerpt);
        return amount
          ? `Frais cachés mensuels : ${amount}`
          : "Frais cachés récurrents";
      }
      const amount = firstEuroAmount(excerpt);
      return amount
        ? `Frais annexes : ${amount}`
        : "Frais cachés ou annexes";
    }
    case "delais": {
      if (family === "bail" && /pr[ée]avis/i.test(excerpt)) {
        const months = excerpt.match(/(\d+)\s*mois/i);
        if (months) {
          if (/locataire/i.test(excerpt)) {
            return `Préavis locataire : ${months[1]} mois`;
          }
          if (/bailleur/i.test(excerpt)) {
            return `Préavis bailleur : ${months[1]} mois`;
          }
          return `Préavis : ${months[1]} mois`;
        }
        return "Préavis de congé / résiliation";
      }
      if (family === "pret" && /r[ée]tractation/i.test(excerpt)) {
        return days
          ? `Délai de rétractation : ${days}`
          : "Délai de rétractation";
      }
      if (family === "administratif") {
        const dateMatch = excerpt.match(
          /(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i,
        );
        const dateLabel = dateMatch?.[1]?.replace(/\s+/g, " ").trim();
        if (/opposition|contest/i.test(excerpt) && dateLabel) {
          return `Opposition possible avant le ${dateLabel}`;
        }
        if (/pr[ée]l[eè]v/i.test(excerpt) && dateLabel) {
          return `Prélèvement le ${dateLabel}`;
        }
        if (
          /date\s+limite\s+(?:de\s+)?paiement|payer\s+(?:avant|au\s+plus\s+tard)/i.test(
            excerpt,
          ) &&
          dateLabel
        ) {
          return `Date limite de paiement : ${dateLabel}`;
        }
      }
      if (/carence/i.test(excerpt)) {
        return days ? `Délai de carence : ${days}` : "Délai de carence";
      }
      if (
        family !== "administratif" &&
        /r[ée]sili|d[ée]nonc|modifier|modification|cong[eé]/i.test(excerpt)
      ) {
        return days
          ? `Date limite pour résilier / modifier : ${days}`
          : "Date limite pour résilier / modifier";
      }
      if (/[ée]ch[ée]ance/i.test(excerpt)) {
        return "Date d’échéance à surveiller";
      }
      if (family === "recouvrement") {
        return days ? `Délai très court : ${days}` : "Délai court pour agir ou payer";
      }
      return days ? `Délai / préavis : ${days}` : "Délai ou échéance à noter";
    }
    case "sanctions":
      if (/huissier/i.test(excerpt)) return "Risque huissier / poursuites";
      return "Menace de poursuites ou recouvrement forcé";
    case "engagement": {
      if (family === "bail") {
        const bailDur = excerpt.match(
          /(?:dur[ée]e(?:\s+du\s+bail)?|bail)[^\d]{0,30}(\d+)\s*(ans?|mois)/i,
        );
        if (bailDur) {
          return `Durée du bail : ${bailDur[1]} ${bailDur[2]!.toLowerCase()}`;
        }
      }
      if (family === "pret") {
        const cap = firstEuroAmount(excerpt);
        if (/capital/i.test(excerpt) && cap) return `Capital emprunté : ${cap}`;
        const dur = engagementDuration(excerpt);
        if (dur) return `Durée du crédit : ${dur}`;
      }
      const dur = engagementDuration(excerpt);
      return dur
        ? `Engagement de ${dur}`
        : "Durée d’engagement minimale";
    }
    case "resiliation": {
      if (family === "bail") {
        if (/clause\s+r[ée]solutoire|plein\s+droit/i.test(excerpt)) {
          return "Clause résolutoire";
        }
        if (/pr[ée]avis|cong[eé]/i.test(excerpt)) {
          const months = excerpt.match(/(\d+)\s*mois/i);
          if (months) {
            if (/locataire/i.test(excerpt)) {
              return `Préavis locataire : ${months[1]} mois`;
            }
            if (/bailleur/i.test(excerpt)) {
              return `Préavis bailleur : ${months[1]} mois`;
            }
            return `Préavis : ${months[1]} mois`;
          }
          return "Préavis de congé / résiliation";
        }
      }
      if (/anticip/i.test(excerpt) || /frais\s+de\s+r[ée]siliation/i.test(excerpt)) {
        const amount = firstEuroAmount(excerpt);
        return amount
          ? `Frais de résiliation anticipée : ${amount}`
          : "Frais de résiliation anticipée";
      }
      if (/pr[ée]avis|date\s+limite|avant\s+le/i.test(excerpt)) {
        return "Date limite / préavis de résiliation";
      }
      return "Conditions de résiliation à vérifier";
    }
    case "renouvellement_tacite":
      return "Tacite reconduction / renouvellement automatique";
    case "augmentation_tarif": {
      if (/\birl\b|indice\s+de\s+r[ée]f[ée]rence|r[ée]vision.{0,20}loyer/i.test(excerpt)) {
        return "Révision du loyer (IRL / indexation)";
      }
      return "Augmentation ou révision de tarif";
    }
    case "clauses_abusives":
      if (/clause\s+r[ée]solutoire/i.test(excerpt)) {
        return "Clause résolutoire";
      }
      return "Clause potentiellement déséquilibrée";
    case "obligations_importantes":
      if (family === "bail" && /assurance/i.test(excerpt)) {
        return "Obligation d’assurance habitation";
      }
      if (/contest/i.test(excerpt)) {
        const contestDays = firstDayDeadline(excerpt);
        if (contestDays) return `Obligation de contester sous ${contestDays}`;
        return "Obligation de contester dans le délai indiqué";
      }
      if (/payer|paiement|régularis/i.test(excerpt)) {
        return days
          ? `Obligation de payer sous ${days}`
          : "Obligation de payer / régulariser";
      }
      return "Obligation importante imposée au destinataire";
    default:
      return "Point de vigilance";
  }
}

function findClaimedTotalSnippet(documentText: string): {
  excerpt: string;
  amount: string;
} | null {
  const patterns = [
    /somme\s+totale\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b)/i,
    /montant\s+total\s+(?:de\s+)?(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b)/i,
    /total\s+(?:r[ée]clam[ée]|d[ûu]|[àa]\s+payer)\s*:?\s*(\d+(?:[.,]\d+)?)\s*(?:€|euros?\b)/i,
  ];
  for (const re of patterns) {
    const m = documentText.match(re);
    if (!m) continue;
    const amount = `${m[1]!.replace(/\s/g, "")} €`;
    const idx = m.index ?? 0;
    const excerpt = snippetAround(documentText, idx, m[0]!.length);
    return { excerpt, amount };
  }
  return null;
}

/** Contexte hors sujet (agence, RCS, totaux nationaux fiscaux…). */
const IRRELEVANT_MONEY_CONTEXT =
  /capital\s+social|garantie\s+financi[eè]re|rcs\b|siren|immatriculation|chiffre\s+d['']affaires|plafond\s+de\s+garantie|caisse\s+de\s+garantie|taxe\s+d['']habitation|suppression\s+(?:de\s+)?la\s+taxe|milliards?|national(?:e|es)?|collectivit[ée]s?|ensemble\s+des\s+(?:foyers|contribuables)|produit\s+(?:net\s+)?(?:de\s+la\s+)?taxe|statistiques?|budget\s+(?:de\s+)?l[''][ée]tat|france\s+enti[eè]re|nombre\s+de\s+foyers|base\s+nationale|montant\s+global\s+(?:des|de)|total\s+(?:des\s+)?recettes|r[ée]f[ée]rence\s+(?:nationale|cadastrale)|valeur\s+locative\s+(?:cadastrale|moyenne)/i;

function snippetAround(text: string, index: number, length: number): string {
  let start = Math.max(0, index - 48);
  let end = Math.min(text.length, index + length + 56);
  // Bornes de mots (évite « sion de… » / fins coupées)
  while (start > 0 && /[A-Za-zÀ-ÿ0-9]/.test(text.charAt(start))) {
    start -= 1;
  }
  if (start > 0) start += 1;
  while (end < text.length && /[A-Za-zÀ-ÿ0-9]/.test(text.charAt(end))) {
    end += 1;
  }
  const raw = text.slice(start, end).replace(/\s+/g, " ").trim();
  const capped =
    raw.length <= 180 ? raw : truncateAtTextBoundary(raw, 180);
  return cleanExcerptForDisplay(capped) ?? capped;
}

function findLabeledEuroFact(
  documentText: string,
  keyword: RegExp,
): { amount: string; excerpt: string } | null {
  // Encapsuler le keyword (évite qu’un | interne casse le motif global).
  const kw = `(?:${keyword.source})`;
  const amountGroup =
    "(\\d+(?:[\\s\\u00a0]\\d{3})*(?:[.,]\\d{1,2})?)\\s*(?:€|euros?\\b)";
  const after = new RegExp(`${kw}[^\\d]{0,60}${amountGroup}`, "i");
  const before = new RegExp(`${amountGroup}[^\\d]{0,60}${kw}`, "i");
  for (const re of [after, before]) {
    const m = documentText.match(re);
    if (!m) continue;
    const idx = m.index ?? 0;
    const excerpt = snippetAround(documentText, idx, m[0]!.length);
    if (IRRELEVANT_MONEY_CONTEXT.test(excerpt)) continue;
    const raw = (m[1] ?? "").replace(/[\s\u00a0]+/g, " ").trim();
    if (!raw) continue;
    return { amount: `${raw} €`, excerpt };
  }
  return null;
}

type BailLabeledFact = {
  criterionId: RiskCriterionId;
  description: string;
  excerpt: string;
};

/** Faits économiques du bail — titres chiffrés pour « Points à surveiller ». */
function findBailLabeledFacts(documentText: string): BailLabeledFact[] {
  const facts: BailLabeledFact[] = [];

  const loyer = findLabeledEuroFact(
    documentText,
    /loyer(?:\s+mensuel)?(?:\s+hors\s+charges|\s+hc)?/i,
  );
  if (loyer) {
    facts.push({
      criterionId: "frais_caches",
      description: `Loyer : ${loyer.amount}/mois`,
      excerpt: loyer.excerpt,
    });
  }

  const charges = findLabeledEuroFact(
    documentText,
    /(?:provisions?\s+(?:pour\s+)?charges|charges\s+locatives|charges\s+mensuelles)/i,
  );
  if (charges) {
    facts.push({
      criterionId: "frais_caches",
      description: `Charges : ${charges.amount}/mois`,
      excerpt: charges.excerpt,
    });
  }

  const depot = findLabeledEuroFact(
    documentText,
    /d[ée]p[ôo]t\s+de\s+garantie/i,
  );
  if (depot) {
    facts.push({
      criterionId: "frais_caches",
      description: `Dépôt de garantie : ${depot.amount}`,
      excerpt: depot.excerpt,
    });
  }

  const honoraires = findLabeledEuroFact(
    documentText,
    /honoraires?(?:\s+d['']agence|\s+de\s+(?:mise\s+en\s+)?location)?|frais\s+de\s+(?:mise\s+en\s+)?location/i,
  );
  if (honoraires && !IRRELEVANT_MONEY_CONTEXT.test(honoraires.excerpt)) {
    facts.push({
      criterionId: "frais_caches",
      description: `Honoraires / frais de location : ${honoraires.amount}`,
      excerpt: honoraires.excerpt,
    });
  }

  const duree = documentText.match(
    /(?:dur[ée]e(?:\s+du\s+bail)?|le\s+pr[ée]sent\s+bail(?:\s+est\s+consent[ie])?)[^\d]{0,40}(\d+)\s*(ans?|mois)/i,
  );
  if (duree) {
    const idx = duree.index ?? 0;
    facts.push({
      criterionId: "engagement",
      description: `Durée du bail : ${duree[1]} ${duree[2]!.toLowerCase()}`,
      excerpt: snippetAround(documentText, idx, duree[0]!.length),
    });
  }

  const preavisLoc = documentText.match(
    /pr[ée]avis(?:\s+de\s+cong[eé])?\s+(?:du\s+)?locataire[^\d]{0,40}(\d+)\s*mois/i,
  );
  const preavisBail = documentText.match(
    /pr[ée]avis(?:\s+de\s+cong[eé])?\s+(?:du\s+)?bailleur[^\d]{0,40}(\d+)\s*mois/i,
  );
  const preavisGeneric = documentText.match(
    /pr[ée]avis[^\d]{0,30}(\d+)\s*mois/i,
  );
  if (preavisLoc) {
    const idx = preavisLoc.index ?? 0;
    facts.push({
      criterionId: "resiliation",
      description: `Préavis locataire : ${preavisLoc[1]} mois`,
      excerpt: snippetAround(documentText, idx, preavisLoc[0]!.length),
    });
  } else if (preavisBail) {
    const idx = preavisBail.index ?? 0;
    facts.push({
      criterionId: "resiliation",
      description: `Préavis bailleur : ${preavisBail[1]} mois`,
      excerpt: snippetAround(documentText, idx, preavisBail[0]!.length),
    });
  } else if (preavisGeneric) {
    const idx = preavisGeneric.index ?? 0;
    facts.push({
      criterionId: "resiliation",
      description: `Préavis : ${preavisGeneric[1]} mois`,
      excerpt: snippetAround(documentText, idx, preavisGeneric[0]!.length),
    });
  }

  const resolutoire = documentText.match(/clause\s+r[ée]solutoire/i);
  if (resolutoire) {
    const idx = resolutoire.index ?? 0;
    facts.push({
      criterionId: "clauses_abusives",
      description: "Clause résolutoire",
      excerpt: snippetAround(documentText, idx, resolutoire[0]!.length),
    });
  }

  const tacite = documentText.match(
    /tacite\s+reconduction|reconduction\s+tacite|renouvellement\s+(?:tacite|automatique)/i,
  );
  if (tacite) {
    const idx = tacite.index ?? 0;
    facts.push({
      criterionId: "renouvellement_tacite",
      description: "Tacite reconduction / renouvellement automatique",
      excerpt: snippetAround(documentText, idx, tacite[0]!.length),
    });
  }

  const irl = documentText.match(
    /\birl\b|indice\s+de\s+r[ée]f[ée]rence\s+des\s+loyers|r[ée]vision(?:\s+annuelle)?\s+du\s+loyer/i,
  );
  if (irl) {
    const idx = irl.index ?? 0;
    facts.push({
      criterionId: "augmentation_tarif",
      description: "Révision du loyer (IRL / indexation)",
      excerpt: snippetAround(documentText, idx, irl[0]!.length),
    });
  }

  return facts;
}

type ImpotsLabeledFact = {
  criterionId: RiskCriterionId;
  description: string;
  excerpt: string;
};

const FR_DATE_RE =
  /(\d{1,2}[/.]\d{1,2}[/.]\d{2,4}|\d{1,2}\s+(?:janvier|f[ée]vrier|mars|avril|mai|juin|juillet|ao[ûu]t|septembre|octobre|novembre|d[ée]cembre)\s+\d{4})/i;

function normalizeFrDateLabel(raw: string): string {
  return raw.replace(/\s+/g, " ").trim();
}

/** Faits fiscaux — montant dû / prélèvement / opposition. */
function findImpotsLabeledFacts(documentText: string): ImpotsLabeledFact[] {
  const facts: ImpotsLabeledFact[] = [];
  const isTaxeFonciere = /taxe\s+fonci[eè]re/i.test(documentText);

  const prelever = findLabeledEuroFact(
    documentText,
    /montant\s+[àa]\s+pr[ée]lever|somme\s+[àa]\s+pr[ée]lever|sera\s+pr[ée]lev/i,
  );
  const taxeDue = findLabeledEuroFact(
    documentText,
    /taxe\s+fonci[eè]re(?:\s+(?:due|sur\s+les\s+propri[ée]t[ée]s))?|cotisation\s+(?:de\s+)?taxe\s+fonci[eè]re|montant\s+(?:de\s+)?(?:la\s+)?taxe\s+fonci[eè]re/i,
  );
  const aPayer = findLabeledEuroFact(
    documentText,
    /montant\s+[àa]\s+(?:payer|r[ée]gler)|somme\s+[àa]\s+payer|solde\s+[àa]\s+payer|reste\s+[àa]\s+payer|montant\s+d[ûu]|cotisation\s+[àa]\s+payer|total\s+[àa]\s+payer|net\s+[àa]\s+payer/i,
  );

  const due =
    (isTaxeFonciere ? taxeDue || prelever || aPayer : null) ||
    prelever ||
    taxeDue ||
    aPayer;

  if (due && !IRRELEVANT_MONEY_CONTEXT.test(due.excerpt)) {
    let description: string;
    if (isTaxeFonciere) {
      description = `Taxe foncière : ${due.amount}`;
    } else if (prelever && due.amount === prelever.amount) {
      description = `Montant à prélever : ${due.amount}`;
    } else if (aPayer && due.amount === aPayer.amount) {
      description = `Montant à payer : ${due.amount}`;
    } else if (taxeDue) {
      description = `Taxe foncière : ${due.amount}`;
    } else {
      description = `Montant à payer : ${due.amount}`;
    }
    facts.push({
      criterionId: "frais_caches",
      description,
      excerpt: due.excerpt,
    });
  }

  const prelevDate = documentText.match(
    new RegExp(
      `(?:(?:date\\s+de\\s+)?pr[ée]l[eè]vement\\s*[:\\-–]?\\s*|sera\\s+pr[ée]lev[ée]e?\\s+le\\s+|pr[ée]l[eè]vement\\s+le\\s+|pr[ée]lev[ée]\\s+le\\s+)${FR_DATE_RE.source}`,
      "i",
    ),
  );
  if (prelevDate?.[1]) {
    const idx = prelevDate.index ?? 0;
    const dateLabel = normalizeFrDateLabel(prelevDate[1]);
    facts.push({
      criterionId: "delais",
      description: `Prélèvement le ${dateLabel}`,
      excerpt: snippetAround(documentText, idx, prelevDate[0]!.length),
    });
  }

  const opposition = documentText.match(
    new RegExp(
      `(?:opposition|contester|recours).{0,60}(?:avant|jusqu['’]au|au\\s+plus\\s+tard)\\s+(?:le\\s+)?${FR_DATE_RE.source}|(?:avant|jusqu['’]au)\\s+(?:le\\s+)?${FR_DATE_RE.source}.{0,40}(?:opposition|contest)`,
      "i",
    ),
  );
  if (opposition) {
    const dateRaw = opposition[1] || opposition[2];
    if (dateRaw) {
      const idx = opposition.index ?? 0;
      facts.push({
        criterionId: "delais",
        description: `Opposition possible avant le ${normalizeFrDateLabel(dateRaw)}`,
        excerpt: snippetAround(documentText, idx, opposition[0]!.length),
      });
    }
  }

  const paymentDeadline = documentText.match(
    new RegExp(
      `(?:date\\s+limite\\s+(?:de\\s+)?paiement|payer\\s+(?:avant|au\\s+plus\\s+tard)\\s+le|paiement\\s+avant\\s+le)\\s*[:\\-–]?\\s*${FR_DATE_RE.source}`,
      "i",
    ),
  );
  if (paymentDeadline?.[1] && !prelevDate) {
    const idx = paymentDeadline.index ?? 0;
    facts.push({
      criterionId: "delais",
      description: `Date limite de paiement : ${normalizeFrDateLabel(paymentDeadline[1])}`,
      excerpt: snippetAround(documentText, idx, paymentDeadline[0]!.length),
    });
  } else if (paymentDeadline?.[1] && prelevDate) {
    // Garder aussi la date limite si distincte du prélèvement
    const payLabel = normalizeFrDateLabel(paymentDeadline[1]);
    const prelevLabel = normalizeFrDateLabel(prelevDate[1]!);
    if (payLabel.toLowerCase() !== prelevLabel.toLowerCase()) {
      const idx = paymentDeadline.index ?? 0;
      facts.push({
        criterionId: "delais",
        description: `Date limite de paiement : ${payLabel}`,
        excerpt: snippetAround(documentText, idx, paymentDeadline[0]!.length),
      });
    }
  }

  const majoration = documentText.match(
    /majoration(?:\s+de)?\s+(\d+)\s*%|p[ée]nalit[ée]s?(?:\s+de\s+retard)?[^\d%]{0,20}(\d+)\s*%/i,
  );
  if (majoration) {
    const pct = majoration[1] || majoration[2];
    const idx = majoration.index ?? 0;
    facts.push({
      criterionId: "penalites",
      description: `Majoration / pénalités : ${pct} %`,
      excerpt: snippetAround(documentText, idx, majoration[0]!.length),
    });
  }

  return facts;
}

export function criterionSupportedByExcerpt(
  criterionId: RiskCriterionId | undefined,
  excerpt: string,
): boolean {
  if (!criterionId) return true;
  const def = RISK_CRITERIA.find((c) => c.id === criterionId);
  if (!def) return true;
  const text = excerpt.trim();
  if (!text) return false;
  return def.patterns.some((pattern) => pattern.test(text));
}

function findingCoversCriterion(
  findings: RiskFinding[],
  criterionId: RiskCriterionId,
): boolean {
  return findings.some(
    (f) =>
      f.criterion_id === criterionId &&
      f.status !== "rejected" &&
      (f.excerpt?.trim().length ?? 0) > 0,
  );
}

function pickBestExcerpt(
  id: RiskCriterionId,
  reasons: string[],
  family: WatchDocFamily,
): string {
  if (reasons.length === 0) return "";
  const preferred =
    id === "sanctions"
      ? reasons.find((r) => /huissier|poursuite|saisie|ex[ée]cution/i.test(r))
      : id === "frais_caches"
        ? (family === "bail"
            ? reasons.find((r) => /loyer/i.test(r) && !IRRELEVANT_MONEY_CONTEXT.test(r)) ||
              reasons.find((r) => /d[ée]p[ôo]t\s+de\s+garantie/i.test(r)) ||
              reasons.find((r) => /charges\s+locatives|provisions?\s+pour\s+charges/i.test(r)) ||
              reasons.find((r) => /honoraires?/i.test(r) && !IRRELEVANT_MONEY_CONTEXT.test(r))
            : family === "administratif"
              ? reasons.find(
                  (r) =>
                    /montant\s+[àa]\s+pr[ée]lever|taxe\s+fonci|montant\s+[àa]\s+payer|montant\s+d[ûu]/i.test(
                      r,
                    ) && !IRRELEVANT_MONEY_CONTEXT.test(r),
                ) ||
                reasons.find(
                  (r) => /\d/.test(r) && !IRRELEVANT_MONEY_CONTEXT.test(r),
                )
              : undefined) ||
          reasons.find((r) => /franchise/i.test(r)) ||
          reasons.find((r) => /tenue\s+de\s+compte|commission\s+d['']intervention|rejet|d[ée]couvert/i.test(r)) ||
          reasons.find((r) => /recouvrement|frais/i.test(r) && /\d/.test(r) && !IRRELEVANT_MONEY_CONTEXT.test(r)) ||
          reasons.find((r) => /recouvrement|r[ée]siliation/i.test(r))
        : id === "penalites"
          ? reasons.find((r) => /mat[ée]riel|non[\s-]retour/i.test(r)) ||
            reasons.find((r) => /majoration|p[ée]nalit/i.test(r) && /\d/.test(r)) ||
            reasons.find((r) => /p[ée]nalit/i.test(r))
          : id === "obligations_importantes"
            ? reasons.find((r) => /contest|opposition/i.test(r)) ||
              reasons.find((r) => /payer|r[ée]gularis|demeure/i.test(r))
            : id === "delais"
              ? (family === "administratif"
                  ? reasons.find((r) =>
                      /opposition|pr[ée]l[eè]vement|date\s+limite\s+(?:de\s+)?paiement/i.test(
                        r,
                      ),
                    )
                  : undefined) ||
                reasons.find((r) => /carence/i.test(r)) ||
                reasons.find((r) => /pr[ée]avis/i.test(r)) ||
                reasons.find((r) => /r[ée]sili|d[ée]nonc|modifier/i.test(r)) ||
                (family === "recouvrement"
                  ? reasons.find((r) =>
                      /sous\s+8\s*jours|sous\s+huit|payer.{0,40}jours/i.test(r),
                    )
                  : undefined) ||
                reasons.find((r) =>
                  /sous\s+\d+|pr[ée]avis|d[ée]lai\s+de\s+\d+/i.test(r),
                )
              : id === "engagement"
                ? (family === "bail"
                    ? reasons.find((r) => /dur[ée]e.{0,20}bail|\bbail.{0,20}\d+\s*(ans?|mois)/i.test(r))
                    : undefined) ||
                  reasons.find((r) => /engagement.{0,20}\d+\s*(mois|ans?)/i.test(r)) ||
                  reasons.find((r) => /engagement/i.test(r))
                : id === "resiliation"
                  ? (family === "bail"
                      ? reasons.find((r) => /clause\s+r[ée]solutoire/i.test(r)) ||
                        reasons.find((r) => /pr[ée]avis|cong[eé]/i.test(r))
                      : undefined) ||
                    reasons.find((r) => /anticip|frais\s+de\s+r[ée]siliation/i.test(r)) ||
                    reasons.find((r) => /pr[ée]avis|date\s+limite/i.test(r)) ||
                    reasons.find((r) => /r[ée]sili/i.test(r))
                  : id === "renouvellement_tacite"
                    ? reasons.find((r) => /tacite|reconduction|renouvellement\s+auto/i.test(r))
                    : id === "augmentation_tarif"
                      ? reasons.find((r) => /\birl\b|r[ée]vision.{0,20}loyer|indexation/i.test(r)) ||
                        reasons.find((r) => /augmentation|hausse|r[ée]vision/i.test(r))
                      : id === "clauses_abusives"
                        ? reasons.find((r) => /clause\s+r[ée]solutoire|abusive|d[ée]s[ée]quilibre/i.test(r))
                        : undefined;
  return (preferred ?? reasons[0]!).trim();
}

function makeLocalFinding(
  id: RiskCriterionId,
  excerpt: string,
  family: WatchDocFamily,
  description?: string,
): RiskFinding | null {
  const meta = LOCAL_FINDING_META[id];
  if (!meta) return null;
  const label = description ?? describeLocalFinding(id, excerpt, family);
  const pinnedTotal =
    isRecouvrementTotalWatchTitle(label) || isFactureTtcWatchTitle(label);
  return {
    description: label,
    why: meta.why,
    implication: meta.implication,
    consequence: meta.consequence,
    mitigation: meta.mitigation,
    justification: meta.why,
    impact: meta.implication,
    excerpt,
    confidence: pinnedTotal ? Math.max(meta.confidence, 0.92) : meta.confidence,
    severity: meta.severity,
    criterion_id: id,
    status: pinnedTotal ? "confirmed" : "ambiguous",
  };
}

/** Injecte / remplace les faits labelisés du bail (loyer, charges, dépôt…). */
function injectBailLabeledFindings(
  documentText: string,
  existing: RiskFinding[],
  injected: RiskFinding[],
): void {
  const labeled = findBailLabeledFacts(documentText);
  for (const fact of labeled) {
    const finding = makeLocalFinding(
      fact.criterionId,
      fact.excerpt,
      "bail",
      fact.description,
    );
    if (!finding) continue;

    const dupIdx = [...existing, ...injected].findIndex((f) => {
      const sameTitle =
        f.description.toLowerCase() === fact.description.toLowerCase();
      const sameKind =
        (/^loyer\b/i.test(f.description) &&
          /^loyer\b/i.test(fact.description)) ||
        (/^charges\b/i.test(f.description) &&
          /^charges\b/i.test(fact.description)) ||
        (/d[ée]p[ôo]t\s+de\s+garantie/i.test(f.description) &&
          /d[ée]p[ôo]t\s+de\s+garantie/i.test(fact.description)) ||
        (/^pr[ée]avis\b/i.test(f.description) &&
          /^pr[ée]avis\b/i.test(fact.description)) ||
        (/dur[ée]e\s+du\s+bail/i.test(f.description) &&
          /dur[ée]e\s+du\s+bail/i.test(fact.description)) ||
        (/^clause\s+r[ée]solutoire/i.test(f.description) &&
          /^clause\s+r[ée]solutoire/i.test(fact.description)) ||
        (/^tacite|^reconduction/i.test(f.description) &&
          /^tacite|^reconduction/i.test(fact.description)) ||
        (/^r[ée]vision\s+du\s+loyer/i.test(f.description) &&
          /^r[ée]vision\s+du\s+loyer/i.test(fact.description)) ||
        (/^honoraires?/i.test(f.description) &&
          /^honoraires?/i.test(fact.description));
      return sameTitle || sameKind;
    });

    if (dupIdx >= 0) {
      if (dupIdx >= existing.length) {
        const injIdx = dupIdx - existing.length;
        const prev = injected[injIdx]!;
        if (fact.description.length >= prev.description.length) {
          injected[injIdx] = finding;
        }
      }
      continue;
    }
    injected.push(finding);
  }

  const hasEconomic = injected.some((f) =>
    /loyer|charges|d[ée]p[ôo]t/i.test(f.description),
  );
  if (hasEconomic) {
    for (let i = injected.length - 1; i >= 0; i -= 1) {
      const f = injected[i]!;
      if (
        f.criterion_id === "frais_caches" &&
        /^frais\s+(annexes|cachés)/i.test(f.description)
      ) {
        injected.splice(i, 1);
      }
    }
  }
}

/**
 * Findings locaux déterministes selon la famille de document.
 */
export function buildMissingLocalRiskFindings(
  documentText: string,
  existing: RiskFinding[] = [],
  ctx: WatchFamilyContext = {},
): RiskFinding[] {
  const family = resolveWatchDocFamily({
    ...ctx,
    textHint: ctx.textHint ?? documentText,
  });
  const injectIds = LOCAL_INJECT_CRITERIA_BY_FAMILY[family];
  const injected: RiskFinding[] = [];

  // Bail : loyer / charges / dépôt injectés en premier (évite le slice(0,10)).
  if (family === "bail") {
    injectBailLabeledFindings(documentText, existing, injected);
  }

  for (const id of injectIds) {
    if (findingCoversCriterion([...existing, ...injected], id)) continue;
    const def = RISK_CRITERIA.find((c) => c.id === id);
    if (!def) continue;

    const hit = detectRiskCriterion(def, documentText);
    if (!hit.detected || hit.reasons.length === 0) continue;

    const excerpt = pickBestExcerpt(id, hit.reasons, family);
    const finding = makeLocalFinding(
      id,
      excerpt.length > 180
        ? (() => {
            const cut = excerpt.slice(0, 180);
            const sp = cut.lastIndexOf(" ");
            return (sp > 80 ? cut.slice(0, sp) : cut).trim();
          })()
        : excerpt,
      family,
    );
    if (finding) injected.push(finding);
  }

  if (family === "recouvrement") {
    const total = findClaimedTotalSnippet(documentText);
    if (total) {
      const alreadyLabeled = [...existing, ...injected].some((f) =>
        isRecouvrementTotalWatchTitle(f.description),
      );
      if (!alreadyLabeled) {
        const finding = makeLocalFinding(
          "frais_caches",
          total.excerpt,
          family,
          `Total réclamé : ${total.amount}`,
        );
        if (finding) injected.unshift(finding);
      }
    }
  }

  if (family === "administratif") {
    const labeled = findImpotsLabeledFacts(documentText);
    for (const fact of labeled) {
      const finding = makeLocalFinding(
        fact.criterionId,
        fact.excerpt,
        family,
        fact.description,
      );
      if (!finding) continue;

      const dupIdx = [...existing, ...injected].findIndex((f) => {
        const sameTitle =
          f.description.toLowerCase() === fact.description.toLowerCase();
        const sameKind =
          (/taxe\s+fonci|montant\s+[àa]\s+pr[ée]lever|montant\s+[àa]\s+payer/i.test(
            f.description,
          ) &&
            /taxe\s+fonci|montant\s+[àa]\s+pr[ée]lever|montant\s+[àa]\s+payer/i.test(
              fact.description,
            )) ||
          (/^pr[ée]l[eè]vement\s+le\b/i.test(f.description) &&
            /^pr[ée]l[eè]vement\s+le\b/i.test(fact.description)) ||
          (/opposition\s+possible/i.test(f.description) &&
            /opposition\s+possible/i.test(fact.description)) ||
          (/date\s+limite\s+de\s+paiement/i.test(f.description) &&
            /date\s+limite\s+de\s+paiement/i.test(fact.description)) ||
          (/majoration|p[ée]nalit/i.test(f.description) &&
            /majoration|p[ée]nalit/i.test(fact.description) &&
            f.criterion_id === "penalites" &&
            fact.criterionId === "penalites");
        return sameTitle || sameKind;
      });

      if (dupIdx >= 0) {
        if (dupIdx >= existing.length) {
          const injIdx = dupIdx - existing.length;
          const prev = injected[injIdx]!;
          const preferTaxeTitle =
            /^taxe\s+fonci/i.test(fact.description) &&
            /montant\s+[àa]\s+(?:pr[ée]lever|payer)/i.test(prev.description);
          const preferLabeled =
            /taxe\s+fonci|montant\s+[àa]\s+|pr[ée]l[eè]vement\s+le|opposition\s+possible|date\s+limite\s+de\s+paiement|majoration\s*\//i.test(
              fact.description,
            ) &&
            !/taxe\s+fonci|montant\s+[àa]\s+|pr[ée]l[eè]vement\s+le|opposition\s+possible|date\s+limite\s+de\s+paiement|majoration\s*\//i.test(
              prev.description,
            );
          if (
            preferTaxeTitle ||
            preferLabeled ||
            fact.description.length >= prev.description.length
          ) {
            injected[injIdx] = finding;
          }
        }
        continue;
      }
      injected.push(finding);
    }

    const hasTaxDue = injected.some((f) =>
      /taxe\s+fonci|montant\s+[àa]\s+pr[ée]lever|montant\s+[àa]\s+payer/i.test(
        f.description,
      ),
    );
    if (hasTaxDue) {
      for (let i = injected.length - 1; i >= 0; i -= 1) {
        const f = injected[i]!;
        if (
          (f.criterion_id === "frais_caches" &&
            /^frais\s+(annexes|cachés)/i.test(f.description)) ||
          /produit\s+national|ensemble\s+des\s+foyers|valeur\s+locative/i.test(
            f.description,
          )
        ) {
          injected.splice(i, 1);
        }
      }
    }
  }

  if (family === "banque") {
    const banqueSignals: Array<{ re: RegExp; title: string; criterion: RiskCriterionId }> = [
      {
        re: /fichier\s+des\s+incidents|ficp|interdiction\s+bancaire/i,
        title: "FICP / suspension bancaire",
        criterion: "sanctions",
      },
      {
        re: /int[ée]r[êe]ts?\s+d[ée]biteurs|agios/i,
        title: "Intérêts débiteurs",
        criterion: "penalites",
      },
      {
        re: /r[ée]gularis|date\s+de\s+r[ée]gularisation/i,
        title: "Date de régularisation",
        criterion: "delais",
      },
    ];
    for (const sig of banqueSignals) {
      const m = documentText.match(sig.re);
      if (!m) continue;
      const idx = m.index ?? 0;
      const already = [...existing, ...injected].some((f) =>
        f.description.toLowerCase().includes(sig.title.toLowerCase().slice(0, 10)),
      );
      if (already) continue;
      const finding = makeLocalFinding(
        sig.criterion,
        snippetAround(documentText, idx, m[0]!.length),
        family,
        sig.title,
      );
      if (finding) injected.push(finding);
    }
  }

  if (family === "facture") {
    const totalTtc = documentText.match(
      /total\s+ttc[^0-9]{0,30}(\d+(?:[\s\u00a0]\d{3})*(?:[.,]\d{1,2})?)\s*(?:€|euros?)/i,
    );
    if (totalTtc) {
      const idx = totalTtc.index ?? 0;
      const amount = `${totalTtc[1]!.replace(/[\s\u00a0]/g, " ").trim()} €`;
      const already = [...existing, ...injected].some((f) =>
        isFactureTtcWatchTitle(f.description),
      );
      if (!already) {
        const finding = makeLocalFinding(
          "frais_caches",
          snippetAround(documentText, idx, totalTtc[0]!.length),
          family,
          `Total TTC : ${amount}`,
        );
        if (finding) injected.unshift(finding);
      }
    }
  }

  return injected;
}

/**
 * Fusionne findings LLM + locaux manquants (locaux prioritaires en tête).
 */
export function mergeWithLocalRiskFindings(
  findings: RiskFinding[] | undefined,
  documentText: string,
  ctx: WatchFamilyContext = {},
): RiskFinding[] {
  const existing = Array.isArray(findings) ? [...findings] : [];
  const missing = buildMissingLocalRiskFindings(documentText, existing, ctx);
  if (missing.length === 0) return existing.slice(0, 8);

  const family = resolveWatchDocFamily({
    ...ctx,
    textHint: ctx.textHint ?? documentText,
  });

  const priorityIds = new Set(
    missing.map((f) => f.criterion_id).filter(Boolean),
  );
  const rest = existing.filter(
    (f) => !f.criterion_id || !priorityIds.has(f.criterion_id),
  );
  const merged = [...missing, ...rest].filter((f, i, arr) => {
    const key = f.description.replace(/\s+/g, " ").trim().toLowerCase();
    return (
      arr.findIndex(
        (o) => o.description.replace(/\s+/g, " ").trim().toLowerCase() === key,
      ) === i
    );
  });

  if (family === "bail") {
    const economic = merged.filter((f) =>
      /^loyer\b|^charges\b|d[ée]p[ôo]t\s+de\s+garantie/i.test(f.description),
    );
    const other = merged.filter(
      (f) => !/^loyer\b|^charges\b|d[ée]p[ôo]t\s+de\s+garantie/i.test(f.description),
    );
    return [...economic, ...other].slice(0, 12);
  }

  return merged.slice(0, 10);
}
