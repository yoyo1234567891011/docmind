/**
 * Copy « Pourquoi / Ce que ça change / Que faire » par famille documentaire.
 * Évite huissier sur CAF, matériel sur fiscal, découvert sur prêt, etc.
 */
import type { RiskCriterionId } from "@/types";
import type { WatchDocFamily } from "@/ai/post-processing/watch-ranking";

export type FindingCopy = {
  why: string;
  implication: string;
  consequence: string;
  mitigation: string;
};

const DEFAULT_COPY: Partial<Record<RiskCriterionId, FindingCopy>> = {
  frais_caches: {
    why: "Le document mentionne des frais annexes, cachés ou de gestion.",
    implication: "Le coût réel peut dépasser le prix affiché ou le principal.",
    consequence: "Surprise financière ou contestation plus difficile après coup.",
    mitigation: "Lister chaque frais et vérifier son fondement avant d’accepter.",
  },
  penalites: {
    why: "Des pénalités ou indemnités sont expressément prévues.",
    implication: "Un manquement augmente la dette ou réduit les droits.",
    consequence: "Majoration rapide du montant dû.",
    mitigation: "Contrôler le montant et contester toute pénalité non due.",
  },
  delais: {
    why: "Un délai, une échéance ou une date limite est fixé dans le document.",
    implication: "Le destinataire doit agir avant cette échéance.",
    consequence: "Perte de droits ou aggravation de la situation.",
    mitigation: "Noter la date limite et répondre par écrit avec preuve d’envoi.",
  },
  sanctions: {
    why: "Le document annonce une sanction en cas de manquement.",
    implication: "Sans réaction, la situation peut s’aggraver.",
    consequence: "Mesures coercitives ou perte de droits.",
    mitigation: "Traiter le point sans délai et conserver une preuve écrite.",
  },
  obligations_importantes: {
    why: "Le destinataire est sommé d’agir (payer, contester, régulariser, produire).",
    implication: "L’inaction peut être interprétée comme une acceptation.",
    consequence: "Perte de moyens de défense ou aggravation de la créance.",
    mitigation: "Identifier l’obligation exacte et y répondre dans le délai indiqué.",
  },
  engagement: {
    why: "Une durée d’engagement minimale est prévue.",
    implication: "Résilier avant terme peut coûter cher ou être impossible.",
    consequence: "Frais de résiliation anticipée ou maintien forcé du contrat.",
    mitigation: "Vérifier la durée restante et le coût d’une sortie anticipée.",
  },
  resiliation: {
    why: "Des conditions de résiliation (préavis, frais, date limite) sont prévues.",
    implication: "Manquer la fenêtre de résiliation prolonge l’engagement.",
    consequence: "Reconduction ou frais de sortie.",
    mitigation: "Repérer le préavis et la date limite de dénonciation.",
  },
  renouvellement_tacite: {
    why: "Le contrat prévoit une reconduction ou un renouvellement automatique.",
    implication: "Sans dénonciation dans les délais, l’engagement continue.",
    consequence: "Nouvelle période facturée sans action explicite.",
    mitigation: "Calendrier de dénonciation et envoi d’une résiliation datée.",
  },
  augmentation_tarif: {
    why: "Le document prévoit une révision, indexation ou hausse de tarif/loyer.",
    implication: "Le montant peut augmenter sans nouvel accord explicite.",
    consequence: "Budget plus élevé après révision.",
    mitigation: "Vérifier l’indice, la périodicité et le plafond de révision.",
  },
  clauses_abusives: {
    why: "Une clause déséquilibrée ou particulièrement sévère est présente.",
    implication: "Un manquement peut entraîner une sanction rapide.",
    consequence: "Résiliation de plein droit ou perte de droits.",
    mitigation: "Faire vérifier la clause et les délais applicables.",
  },
};

const FAMILY_COPY: Partial<
  Record<WatchDocFamily, Partial<Record<RiskCriterionId, FindingCopy>>>
> = {
  administratif: {
    penalites: {
      why: "Une majoration ou des pénalités fiscales sont annoncées.",
      implication: "La créance fiscale augmente rapidement en cas de retard.",
      consequence: "Majoration et total à régler plus élevés.",
      mitigation: "Payer ou contester avant la date limite indiquée.",
    },
    delais: {
      why: "Une date limite de paiement ou de réponse est fixée.",
      implication: "Dépasser la date limite expose à majoration et recouvrement.",
      consequence: "Perte de la possibilité de régulariser sans majoration.",
      mitigation: "Noter la date limite et répondre par écrit avec preuve d'envoi.",
    },
    sanctions: {
      why: "L'avis annonce un recouvrement forcé ou des poursuites possibles.",
      implication: "Sans règlement, un recouvrement forcé peut être engagé.",
      consequence: "Poursuites, frais de poursuite et contrainte de paiement.",
      mitigation: "Régulariser ou contester motivement avant l'échéance.",
    },
    frais_caches: {
      why: "Des frais de relance ou annexes s'ajoutent au principal.",
      implication: "Des frais de relance s'ajoutent au principal déjà dû.",
      consequence: "Surcoût même si le principal est juste.",
      mitigation: "Vérifier le fondement de chaque frais de relance.",
    },
    obligations_importantes: {
      why: "Un principal et/ou un total à régler sont indiqués.",
      implication: "Le principal et le total dus doivent être traités avant l'échéance.",
      consequence: "Majoration, relances et éventuel recouvrement.",
      mitigation: "Contrôler principal, majoration et total puis payer ou contester.",
    },
  },
  social: {
    penalites: {
      why: "Un indu ou trop-perçu peut être mis à votre charge.",
      implication: "Un indu peut être réclamé et réduire vos droits.",
      consequence: "Demande de remboursement et possible suspension d'aide.",
      mitigation: "Vérifier le calcul de l'indu et transmettre les pièces demandées.",
    },
    delais: {
      why: "Un délai de transmission de pièces ou de réponse est fixé.",
      implication: "Sans pièces dans le délai, les droits peuvent être suspendus.",
      consequence: "Interruption du versement de l'aide.",
      mitigation: "Transmettre les justificatifs avant la date limite via l'espace allocataire ou par courrier.",
    },
    sanctions: {
      why: "Le document annonce une suspension de versement ou une perte de droits.",
      implication: "Sans réponse, le versement de l'aide peut être suspendu.",
      consequence: "Interruption des prestations et éventuel indu.",
      mitigation: "Répondre rapidement avec les pièces demandées pour maintenir vos droits.",
    },
    obligations_importantes: {
      why: "Des pièces ou une déclaration de situation sont exigées pour le maintien des droits.",
      implication: "Le maintien de l'aide dépend de la transmission des éléments demandés.",
      consequence: "Suspension ou réexamen défavorable du dossier.",
      mitigation: "Préparer et envoyer les pièces avant la date limite.",
    },
    frais_caches: {
      why: "Un montant d'aide ou d'indu est indiqué.",
      implication: "Ce montant conditionne vos droits ou une éventuelle dette sociale.",
      consequence: "Erreur de versement ou réclamation d'indu.",
      mitigation: "Contrôler le montant et contester un calcul erroné par écrit.",
    },
  },
  banque: {
    frais_caches: {
      why: "Des frais ou commissions figurent sur le relevé.",
      implication: "Ces frais réduisent le solde disponible de façon récurrente.",
      consequence: "Budget amputé sans contrepartie claire.",
      mitigation: "Demander le détail tarifaire et contester les frais non dus.",
    },
    penalites: {
      why: "Des intérêts débiteurs, rejets ou pénalités apparaissent.",
      implication: "Intérêts débiteurs ou pénalités alourdissent le découvert.",
      consequence: "Coût du découvert qui s'auto-alimente.",
      mitigation: "Vérifier le taux et régulariser le solde si une date est fixée.",
    },
    sanctions: {
      why: "Un incident bancaire (FICP, suspension) est annoncé.",
      implication: "Un incident bancaire peut entraîner fichage ou restrictions.",
      consequence: "Difficultés d'accès au crédit ou blocage de moyens de paiement.",
      mitigation: "Régulariser et demander confirmation écrite de la levée d'incident.",
    },
    delais: {
      why: "Une date de régularisation ou d'action est mentionnée.",
      implication: "Agir avant cette date limite la situation du compte.",
      consequence: "Frais supplémentaires ou restrictions.",
      mitigation: "Noter la date et régulariser ou contester par écrit.",
    },
  },
  pret: {
    engagement: {
      why: "Un capital emprunté et une durée de remboursement sont fixés.",
      implication: "Vous vous engagez sur le capital, la durée et les mensualités annoncés.",
      consequence: "Obligation de remboursement sur toute la durée du crédit.",
      mitigation: "Vérifier capital, durée et capacité de remboursement avant acceptation.",
    },
    frais_caches: {
      why: "Des frais de dossier, assurance ou TAEG sont indiqués.",
      implication: "Le coût total du crédit dépasse le capital emprunté.",
      consequence: "Coût du crédit plus élevé que le seul capital.",
      mitigation: "Comparer TAEG, frais de dossier et assurance emprunteur.",
    },
    penalites: {
      why: "Des pénalités de remboursement anticipé sont prévues.",
      implication: "Un remboursement anticipé peut entraîner une pénalité.",
      consequence: "Surcoût en cas de sortie anticipée.",
      mitigation: "Vérifier le taux de pénalité et les conditions de remboursement anticipé.",
    },
    delais: {
      why: "Un délai de rétractation ou une échéance est indiqué.",
      implication: "Le délai de rétractation permet de renoncer à l'offre sans frais.",
      consequence: "Perte du droit de rétractation après expiration.",
      mitigation: "Noter la date limite de rétractation et agir par écrit si besoin.",
    },
    sanctions: {
      why: "Une déchéance du terme ou exigibilité immédiate est prévue.",
      implication: "En cas d'impayés, le prêteur peut exiger le capital restant dû.",
      consequence: "Exigibilité immédiate et contentieux possible.",
      mitigation: "Anticiper les difficultés de paiement et contacter le prêteur par écrit.",
    },
    obligations_importantes: {
      why: "Une mensualité ou une obligation de remboursement est fixée.",
      implication: "Les mensualités doivent être honorées aux dates prévues.",
      consequence: "Incidents de paiement et déchéance du terme.",
      mitigation: "Intégrer la mensualité au budget et vérifier l'assurance emprunteur.",
    },
  },
  recouvrement: {
    penalites: {
      why: "Des pénalités ou frais de recouvrement s'ajoutent au principal.",
      implication: "Pénalités et frais de recouvrement s'ajoutent au principal.",
      consequence: "Total réclamé plus élevé sans nouvelle créance de fond.",
      mitigation: "Exiger un décompte et contester les accessoires non dus.",
    },
    sanctions: {
      why: "Le créancier annonce des poursuites ou un huissier.",
      implication: "Sans réponse dans le délai, le dossier peut passer à l'huissier.",
      consequence: "Frais d'huissier et mesures d'exécution.",
      mitigation: "Contester ou demander un délai de paiement par écrit avant l'échéance.",
    },
    delais: {
      why: "Un délai court pour payer ou contester est fixé.",
      implication: "Le délai de réponse est impératif.",
      consequence: "Passage aux poursuites.",
      mitigation: "Répondre dans le délai avec un décompte contesté ou une proposition.",
    },
    obligations_importantes: {
      why: "Un total ou principal est réclamé.",
      implication: "La créance réclamée doit être vérifiée avant tout paiement.",
      consequence: "Paiement indu ou poursuites.",
      mitigation: "Exiger un décompte détaillé puis payer ou contester.",
    },
  },
  facture: {
    frais_caches: {
      why: "Un total TTC ou des frais annexes figurent sur la facture.",
      implication: "Le montant facturé doit correspondre aux prestations fournies.",
      consequence: "Paiement d'options ou frais non dus.",
      mitigation: "Vérifier total TTC, options et échéance de prélèvement.",
    },
    delais: {
      why: "Une échéance de paiement ou de prélèvement est indiquée.",
      implication: "Le prélèvement ou le paiement interviendra à la date indiquée.",
      consequence: "Retard, pénalités ou rejet de prélèvement.",
      mitigation: "Anticiper la date d'échéance et contester avant le prélèvement si besoin.",
    },
    penalites: {
      why: "Des pénalités de retard sont prévues.",
      implication: "Un retard de paiement augmente le montant dû.",
      consequence: "Majoration et relances.",
      mitigation: "Payer à échéance ou contester le total TTC avant.",
    },
  },
  bail: {
    obligations_importantes: {
      why: "Un loyer, des charges ou un dépôt de garantie sont fixés.",
      implication: "Les montants locatifs engagent le locataire chaque mois.",
      consequence: "Impayés, relances ou clause résolutoire.",
      mitigation: "Vérifier loyer, charges et dépôt avant signature ou paiement.",
    },
    delais: {
      why: "Un préavis ou une date d'état des lieux est indiqué.",
      implication: "Le préavis conditionne la fin du bail.",
      consequence: "Prolongation du bail ou perte de dépôt.",
      mitigation: "Respecter le préavis par lettre recommandée.",
    },
  },
  assurance: {
    frais_caches: {
      why: "Une cotisation, franchise ou frais annexes sont indiqués.",
      implication: "Le coût réel de la couverture inclut cotisation et franchise.",
      consequence: "Reste à charge élevé en cas de sinistre.",
      mitigation: "Comparer cotisation, franchise et exclusions.",
    },
    renouvellement_tacite: {
      why: "Le contrat se renouvelle automatiquement.",
      implication: "Sans résiliation dans les délais, le contrat continue.",
      consequence: "Nouvelle période de cotisation.",
      mitigation: "Repérer la date d'échéance et le préavis de résiliation.",
    },
    delais: {
      why: "Un délai de carence, de déclaration ou de résiliation est fixé.",
      implication: "Manquer ce délai peut bloquer une garantie ou une résiliation.",
      consequence: "Refus de prise en charge ou reconduction.",
      mitigation: "Noter les délais de carence et de dénonciation.",
    },
  },
  abonnement: {
    engagement: {
      why: "Une durée d'engagement minimale est prévue.",
      implication: "Résilier avant terme peut entraîner des frais.",
      consequence: "Frais de résiliation anticipée.",
      mitigation: "Vérifier la durée restante et le coût de sortie.",
    },
    resiliation: {
      why: "Des frais ou conditions de résiliation sont prévus.",
      implication: "La résiliation peut être payante ou soumise à préavis.",
      consequence: "Surcoût ou maintien du forfait.",
      mitigation: "Envoyer la résiliation dans les formes et délais indiqués.",
    },
  },
};

/** Copy hors contexte à réécrire (huissier sur CAF, matériel sur fiscal, découvert sur prêt…). */
export function isOffContextFindingCopy(
  family: WatchDocFamily,
  text: string,
): boolean {
  const t = text.toLowerCase();
  if (family === "social") {
    return /huissier|saisie|mise\s+en\s+demeure|mat[ée]riel|r[ée]siliation\s+anticip|d[ée]couvert|commission\s+d['']intervention/.test(
      t,
    );
  }
  if (family === "pret") {
    return /d[ée]couvert|commission\s+d['']intervention|tenue\s+de\s+compte|relev[ée]\s+bancaire|frais\s+d[ée]bit[ée]s\s+sur\s+mon\s+compte/.test(
      t,
    );
  }
  if (family === "administratif") {
    return /mat[ée]riel|abonnement|r[ée]siliation\s+anticip|non[\s-]retour/.test(t);
  }
  if (family === "banque") {
    return /r[ée]siliation\s+d['']abonnement|mat[ée]riel|offre\s+de\s+pr[êe]t/.test(t);
  }
  return /mat[ée]riel|abonnement|r[ée]siliation\s+anticip/.test(t) &&
    (family === "recouvrement" || family === "facture");
}

export function resolveFindingCopy(
  criterionId: RiskCriterionId | undefined,
  family: WatchDocFamily,
): FindingCopy | null {
  if (!criterionId) return null;
  const familyHit = FAMILY_COPY[family]?.[criterionId];
  if (familyHit) return familyHit;
  return DEFAULT_COPY[criterionId] ?? null;
}

export function familyImplicationFallback(
  criterionId: string | undefined,
  family: WatchDocFamily,
  description: string,
): string {
  const id = criterionId as RiskCriterionId | undefined;
  const copy = resolveFindingCopy(id, family);
  if (copy) return copy.implication;
  if (family === "social") {
    return "Transmettre les pièces demandées pour maintenir vos droits.";
  }
  if (family === "pret") {
    return "Vérifier TAEG, mensualité et conditions avant d'accepter l'offre.";
  }
  return "Agir avant l'échéance pour limiter le risque financier.";
}
