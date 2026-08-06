import { buildAlertId } from "@/services/alerts/state";

import {

  extractDateCandidates,

  extractEuroAmounts,

  normalizeText,

} from "@/services/search/parse-values";

import { ensureDocumentSheet } from "@/services/sheets";

import {

  ALERT_DEFAULTS,

  type AlertKind,

  type AlertPriority,

  type AlertSeverity,

  type DocumentAlert,

  type HistoryRecord,

} from "@/types";



function daysUntil(date: Date, now: Date): number {

  const ms = date.getTime() - now.getTime();

  return Math.ceil(ms / (24 * 60 * 60 * 1000));

}



function toIsoDate(date: Date): string {

  return date.toISOString().slice(0, 10);

}



function todayIso(now: Date): string {

  return toIsoDate(now);

}



function priorityFromSeverity(severity: AlertSeverity): AlertPriority {

  switch (severity) {

    case "critical":

      return "critique";

    case "warning":

      return "haute";

    default:

      return "moyenne";

  }

}



function hasCriterion(

  record: HistoryRecord,

  id: string,

): { detected: boolean; reason?: string } {

  const criterion = record.analysis.risk_criteria?.find(

    (item) => item.id === id,

  );

  if (!criterion?.detected) return { detected: false };

  return {

    detected: true,

    reason: criterion.reasons?.[0] || criterion.label,

  };

}



function documentLabel(record: HistoryRecord): string {

  const sheet = ensureDocumentSheet(record);

  return sheet.name || record.analysis.title || record.fileName;

}



function sheetAndAnalysisText(record: HistoryRecord): string {

  const sheet = ensureDocumentSheet(record);

  return [

    sheet.name,

    sheet.type,

    sheet.summary,

    ...sheet.deadlines,

    ...sheet.dates,

    ...sheet.risks,

    ...sheet.actions,

    ...(sheet.keywords ?? []),

    record.analysis.title,

    record.analysis.summary,

    ...record.analysis.important_points,

    ...record.analysis.risks,

    ...record.analysis.deadlines,

    ...record.analysis.actions,

  ].join(" \n ");

}



function severityForDeadline(days: number): AlertSeverity {

  if (days <= ALERT_DEFAULTS.criticalDeadlineDays) return "critical";

  if (days <= ALERT_DEFAULTS.warningDeadlineDays) return "warning";

  return "info";

}



function severityForAmount(amount: number): AlertSeverity {

  if (amount >= ALERT_DEFAULTS.criticalPaymentThreshold) return "critical";

  if (amount >= ALERT_DEFAULTS.importantPaymentThreshold) return "warning";

  return "info";

}



function makeAlert(

  input: Omit<DocumentAlert, "read" | "dismissed" | "priority"> & {

    priority?: AlertPriority;

  },

): DocumentAlert {

  return {

    ...input,

    priority: input.priority ?? priorityFromSeverity(input.severity),

    read: false,

    dismissed: false,

  };

}



function collectDeadlineRaw(record: HistoryRecord): string[] {

  const sheet = ensureDocumentSheet(record);

  return [

    ...sheet.deadlines,

    ...record.analysis.deadlines,

    ...sheet.dates,

    ...record.analysis.dates,

  ];

}



function isPaymentRelated(text: string): boolean {

  return /paiement|payer|à\s+payer|a\s+payer|règlement|reglement|facture|relance|impay|prélèvement|prelevement|échéance\s+de\s+paiement|echeance\s+de\s+paiement/i.test(

    text,

  );

}



function detectDeadlines(

  record: HistoryRecord,

  now: Date,

): DocumentAlert[] {

  const alerts: DocumentAlert[] = [];

  const pairs: Array<{ raw: string; date: Date }> = [];



  for (const raw of collectDeadlineRaw(record)) {

    for (const date of extractDateCandidates([raw])) {

      pairs.push({ raw, date });

    }

  }



  const seen = new Set<string>();

  for (const { raw, date } of pairs) {

    // Les échéances de paiement ont leur propre détecteur

    if (isPaymentRelated(raw)) continue;



    const days = daysUntil(date, now);

    if (days < 0 || days > ALERT_DEFAULTS.deadlineHorizonDays) continue;

    const key = toIsoDate(date);

    if (seen.has(key)) continue;

    seen.add(key);



    const severity = severityForDeadline(days);

    const title = documentLabel(record);

    alerts.push(

      makeAlert({

        id: buildAlertId(record.id, "deadline_soon", key),

        kind: "deadline_soon",

        severity,

        title: "Échéance à surveiller",

        message:

          days === 0

            ? `Échéance aujourd’hui pour « ${title} ».`

            : `Échéance dans ${days} jour${days > 1 ? "s" : ""} (${key}) — ${raw}`,

        historyId: record.id,

        documentTitle: title,

        fileName: record.fileName,

        evidence: [raw],

        date: key,

        dueDate: key,

        recommendedAction:

          days <= ALERT_DEFAULTS.criticalDeadlineDays

            ? "Traiter cette échéance immédiatement (vérifier le document et les actions listées)."

            : "Planifier le traitement de cette échéance avant la date indiquée.",

        createdAt: now.toISOString(),

      }),

    );

  }



  return alerts;

}



function detectRenewals(record: HistoryRecord, now: Date): DocumentAlert[] {

  const criterion = hasCriterion(record, "renouvellement_tacite");

  const blob = normalizeText(sheetAndAnalysisText(record));

  const textHit =

    /renouvellement\s+(tacite|automatique)|reconduction\s+(tacite|automatique)|reconduit\s+automatiquement|tacite\s+reconduction|renouvellement\s+auto/.test(

      blob,

    );



  if (!criterion.detected && !textHit) return [];



  const sheet = ensureDocumentSheet(record);

  const evidence = [

    criterion.reason,

    ...sheet.risks.filter((risk) =>

      /renouvel|reconduction|tacite|automatique/i.test(risk),

    ),

    ...record.analysis.risks.filter((risk) =>

      /renouvel|reconduction|tacite|automatique/i.test(risk),

    ),

  ].filter(Boolean) as string[];



  // Date : prochaine échéance de la fiche si disponible

  const deadlineDates = extractDateCandidates([

    ...sheet.deadlines,

    ...record.analysis.deadlines,

  ]).filter((date) => daysUntil(date, now) >= 0);

  deadlineDates.sort((a, b) => a.getTime() - b.getTime());

  const alertDate = deadlineDates[0]

    ? toIsoDate(deadlineDates[0])

    : todayIso(now);



  const title = documentLabel(record);

  return [

    makeAlert({

      id: buildAlertId(record.id, "renewal", "tacite"),

      kind: "renewal",

      severity: "warning",

      priority: "haute",

      title: "Renouvellement détecté",

      message: `Renouvellement / reconduction automatique possible sur « ${title} ».`,

      historyId: record.id,

      documentTitle: title,

      fileName: record.fileName,

      evidence: evidence.slice(0, 3),

      date: alertDate,

      dueDate: deadlineDates[0] ? alertDate : undefined,

      recommendedAction:

        "Vérifier la date limite de résiliation et décider de renouveler ou de dénoncer le contrat.",

      createdAt: now.toISOString(),

    }),

  ];

}



function detectTerminations(

  record: HistoryRecord,

  now: Date,

): DocumentAlert[] {

  const criterion = hasCriterion(record, "resiliation");

  const blob = normalizeText(sheetAndAnalysisText(record));

  const textHit =

    /resiliation|résiliation|denonciation|dénonciation|preavis\s+de\s+resiliation|cong[eé]\s+du\s+bail/.test(

      blob,

    );



  if (!criterion.detected && !textHit) return [];



  const sheet = ensureDocumentSheet(record);

  const evidence = [

    criterion.reason,

    ...sheet.risks.filter((risk) =>

      /résili|resili|dénonci|denonci|préavis|preavis/i.test(risk),

    ),

    ...record.analysis.risks.filter((risk) =>

      /résili|resili|dénonci|denonci|préavis|preavis/i.test(risk),

    ),

    ...sheet.deadlines.filter((item) =>

      /résili|resili|dénonci|denonci|préavis|preavis/i.test(item),

    ),

  ].filter(Boolean) as string[];



  const title = documentLabel(record);

  return [

    makeAlert({

      id: buildAlertId(record.id, "termination", "clause"),

      kind: "termination",

      severity: criterion.detected ? "warning" : "info",

      title: "Résiliation à surveiller",

      message: `Clauses ou délais de résiliation identifiés sur « ${title} ».`,

      historyId: record.id,

      documentTitle: title,

      fileName: record.fileName,

      evidence: evidence.slice(0, 3),

      date: todayIso(now),

      recommendedAction:

        "Contrôler le préavis et les formalités de résiliation avant toute démarche.",

      createdAt: now.toISOString(),

    }),

  ];

}



function detectImportantPayments(

  record: HistoryRecord,

  now: Date,

): DocumentAlert[] {

  const sheet = ensureDocumentSheet(record);

  const amountStrings =

    sheet.amounts.length > 0 ? sheet.amounts : record.analysis.amounts;

  const amounts =

    sheet.amountValues?.length > 0

      ? sheet.amountValues

      : extractEuroAmounts(amountStrings);

  const maxAmount = amounts.length ? Math.max(...amounts) : 0;



  const alerts: DocumentAlert[] = [];

  const title = documentLabel(record);



  // Paiements à échéance proche (même sous le seuil monétaire)

  const paymentDeadlinePairs: Array<{ raw: string; date: Date }> = [];

  for (const raw of collectDeadlineRaw(record)) {

    if (!isPaymentRelated(raw)) continue;

    for (const date of extractDateCandidates([raw])) {

      paymentDeadlinePairs.push({ raw, date });

    }

  }



  const seenPayDates = new Set<string>();

  for (const { raw, date } of paymentDeadlinePairs) {

    const days = daysUntil(date, now);

    if (days < 0 || days > ALERT_DEFAULTS.deadlineHorizonDays) continue;

    const key = toIsoDate(date);

    if (seenPayDates.has(key)) continue;

    seenPayDates.add(key);



    const severity = severityForDeadline(days);

    alerts.push(

      makeAlert({

        id: buildAlertId(record.id, "important_payment", `due-${key}`),

        kind: "important_payment",

        severity,

        title: "Paiement à échéance",

        message:

          days === 0

            ? `Paiement attendu aujourd’hui pour « ${title} ».`

            : `Paiement à régler sous ${days} jour${days > 1 ? "s" : ""} (${key}) — ${raw}`,

        historyId: record.id,

        documentTitle: title,

        fileName: record.fileName,

        evidence: [raw, ...amountStrings.slice(0, 2)],

        date: key,

        dueDate: key,

        amount: maxAmount > 0 ? maxAmount : undefined,

        recommendedAction:

          days <= ALERT_DEFAULTS.criticalDeadlineDays

            ? "Effectuer ou vérifier le paiement immédiatement et conserver la preuve."

            : "Planifier le paiement avant la date d’échéance et vérifier le montant.",

        createdAt: now.toISOString(),

      }),

    );

  }



  // Montant élevé (hors échéance de paiement déjà signalée)

  if (maxAmount >= ALERT_DEFAULTS.importantPaymentThreshold) {

    const matching = amountStrings.filter((value) => {

      const parsed = extractEuroAmounts([value])[0];

      return (

        parsed != null && parsed >= ALERT_DEFAULTS.importantPaymentThreshold

      );

    });



    alerts.push(

      makeAlert({

        id: buildAlertId(

          record.id,

          "important_payment",

          `amt-${Math.round(maxAmount)}`,

        ),

        kind: "important_payment",

        severity: severityForAmount(maxAmount),

        title: "Paiement important",

        message: `Montant élevé détecté (${maxAmount.toLocaleString("fr-FR", {

          minimumFractionDigits: 0,

          maximumFractionDigits: 2,

        })} €) dans « ${title} ».`,

        historyId: record.id,

        documentTitle: title,

        fileName: record.fileName,

        evidence: matching.slice(0, 3),

        date: todayIso(now),

        amount: maxAmount,

        recommendedAction:

          "Vérifier le montant, le destinataire et la date de règlement avant tout paiement.",

        createdAt: now.toISOString(),

      }),

    );

  }



  return alerts;

}



function detectHighRisk(

  record: HistoryRecord,

  now: Date,

): DocumentAlert[] {

  const level = record.analysis.risk_level;

  const score = record.analysis.risk_score ?? 0;

  const confirmedFindings = (record.analysis.risk_findings ?? []).filter(

    (finding) =>

      finding.status === "confirmed" &&

      (finding.severity === "eleve" || finding.severity === "critique"),

  );



  const isHigh =

    level === "eleve" ||

    level === "critique" ||

    score >= ALERT_DEFAULTS.highRiskScoreThreshold ||

    confirmedFindings.length > 0;



  if (!isHigh) return [];



  const sheet = ensureDocumentSheet(record);

  const evidence = [

    ...confirmedFindings.map((f) => f.description).slice(0, 2),

    ...sheet.risks.slice(0, 2),

    ...record.analysis.risks.slice(0, 2),

    record.analysis.risk_explanation,

  ].filter(Boolean) as string[];



  const title = documentLabel(record);

  const actionFromFinding = confirmedFindings[0]?.mitigation;

  const actionFromAnalysis = record.analysis.actions?.[0];



  return [

    makeAlert({

      id: buildAlertId(record.id, "high_risk", `${level}-${score}`),

      kind: "high_risk",

      severity: level === "critique" || score >= 80 ? "critical" : "warning",

      title: "Risque important",

      message: `Risque ${level} (score ${score}/100) détecté sur « ${title} ».`,

      historyId: record.id,

      documentTitle: title,

      fileName: record.fileName,

      evidence: [...new Set(evidence)].slice(0, 3),

      date: todayIso(now),

      recommendedAction:

        actionFromFinding ||

        actionFromAnalysis ||

        "Ouvrir le document, relire les risques confirmés et appliquer les mesures de mitigation.",

      createdAt: now.toISOString(),

    }),

  ];

}



function detectActionRequired(

  record: HistoryRecord,

  now: Date,

): DocumentAlert[] {

  const sheet = ensureDocumentSheet(record);

  const actions =

    sheet.actions.length > 0 ? sheet.actions : (record.analysis.actions ?? []);

  const replyRequired = Boolean(record.readyReply?.required);



  if (actions.length === 0 && !replyRequired) return [];



  const evidence = [

    ...actions.slice(0, 3),

    replyRequired ? "Réponse / courrier suggéré disponible" : null,

  ].filter(Boolean) as string[];



  const title = documentLabel(record);

  return [

    makeAlert({

      id: buildAlertId(

        record.id,

        "action_required",

        `${actions.length}-${replyRequired ? "reply" : "none"}`,

      ),

      kind: "action_required",

      severity: actions.length >= 3 || replyRequired ? "warning" : "info",

      title: "Action à effectuer",

      message: replyRequired

        ? `Réponse à préparer et ${actions.length} action${actions.length > 1 ? "s" : ""} sur « ${title} ».`

        : `${actions.length} action${actions.length > 1 ? "s" : ""} à traiter sur « ${title} ».`,

      historyId: record.id,

      documentTitle: title,

      fileName: record.fileName,

      evidence,

      date: todayIso(now),

      recommendedAction:

        actions[0] ||

        (replyRequired

          ? "Rédiger et envoyer la réponse proposée."

          : "Traiter les actions listées sur la fiche du document."),

      createdAt: now.toISOString(),

    }),

  ];

}



const DETECTORS: Array<

  (record: HistoryRecord, now: Date) => DocumentAlert[]

> = [

  detectDeadlines,

  detectRenewals,

  detectImportantPayments,

  detectHighRisk,

  detectActionRequired,

  detectTerminations,

];



/**

 * Détecte automatiquement les alertes d’un document analysé :

 * échéances, renouvellements, paiements, risques importants.

 */

export function detectAlertsForRecord(

  record: HistoryRecord,

  now = new Date(),

): DocumentAlert[] {

  return DETECTORS.flatMap((detect) => detect(record, now));

}



export function severityRank(severity: AlertSeverity): number {

  switch (severity) {

    case "critical":

      return 3;

    case "warning":

      return 2;

    default:

      return 1;

  }

}



export function priorityRank(priority: AlertPriority): number {

  switch (priority) {

    case "critique":

      return 4;

    case "haute":

      return 3;

    case "moyenne":

      return 2;

    default:

      return 1;

  }

}



export function kindPriority(kind: AlertKind): number {
  switch (kind) {
    case "analysis_ready":
      return 12;
    case "deadline_soon":
      return 11;
    case "relation_deadline_conflict":
      return 10;
    case "important_payment":
      return 9;
    case "relation_redundant_payment":
      return 8;
    case "high_risk":
      return 7;
    case "relation_overlap_risk":
      return 6;
    case "relation_duplicate":
      return 5;
    case "relation_supersede":
      return 4;
    case "renewal":
      return 3;
    case "action_required":
      return 2;
    case "termination":
      return 1;
    case "relation_contradiction":
      return 8;
    default:
      return 0;
  }
}

