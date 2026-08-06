/**
 * Tests moteur d'alertes (sans LLM / sans FS utilisateur).
 */
import assert from "assert";

import { detectAlertsForRecord } from "../src/services/alerts/detect";
import { buildDocumentSheetFromAnalysis } from "../src/services/sheets";
import { RISK_CRITERIA } from "../src/services/risk/criteria";
import type {
  DocumentAnalysis,
  DocumentClassification,
  HistoryRecord,
} from "../src/types";

function baseAnalysis(
  overrides: Partial<DocumentAnalysis> = {},
): DocumentAnalysis {
  return {
    document_type: "Document",
    title: "Doc",
    summary: "Résumé",
    date: "01/01/2026",
    dates: [],
    people: [],
    organizations: [],
    amounts: [],
    deadlines: [],
    important_points: [],
    risks: [],
    actions: [],
    risk_score: 10,
    risk_level: "faible",
    risk_explanation: "test",
    risk_criteria: RISK_CRITERIA.map((c) => ({
      id: c.id,
      label: c.label,
      detected: false,
      score: 0,
      max_score: c.maxScore,
      reasons: [],
    })),
    risk_findings: [],
    ...overrides,
  };
}

function makeRecord(
  id: string,
  analysis: DocumentAnalysis,
  classification: DocumentClassification = {
    category: "contrat",
    label: "Contrat",
    confidence: 0.9,
  },
): HistoryRecord {
  const analyzedAt = "2026-03-01T10:00:00.000Z";
  const sheet = buildDocumentSheetFromAnalysis({
    historyId: id,
    documentId: `doc-${id}`,
    fileName: `${id}.pdf`,
    classification,
    analysis,
    analyzedAt,
  });

  return {
    id,
    userId: "u1",
    documentId: `doc-${id}`,
    fileName: `${id}.pdf`,
    createdAt: analyzedAt,
    classification,
    analysis,
    readyReply: {
      required: false,
      reason: "Aucune réponse nécessaire.",
      subject: "",
      body: "",
    },
    model: "test",
    analyzedAt,
    extractedText: "",
    folderId: null,
    sheet,
  };
}

function assertAlertShape(alert: ReturnType<typeof detectAlertsForRecord>[number]) {
  assert.ok(alert.priority, "priority requise");
  assert.ok(alert.date, "date requise");
  assert.ok(alert.historyId, "document concerné requis");
  assert.ok(alert.documentTitle, "titre document requis");
  assert.ok(alert.recommendedAction, "action recommandée requise");
}

function main() {
  const now = new Date("2026-07-01T12:00:00.000Z");

  // 1) Échéance
  const deadlineRecord = makeRecord(
    "deadline",
    baseAnalysis({
      title: "Bail Dupont",
      deadlines: ["Fin du bail le 15/07/2026"],
    }),
  );
  const deadlineAlerts = detectAlertsForRecord(deadlineRecord, now).filter(
    (a) => a.kind === "deadline_soon",
  );
  assert.ok(deadlineAlerts.length >= 1, "échéance détectée");
  assertAlertShape(deadlineAlerts[0]);
  assert.equal(deadlineAlerts[0].date, "2026-07-15");
  assert.ok(deadlineAlerts[0].priority === "critique" || deadlineAlerts[0].priority === "haute");

  // 2) Renouvellement
  const renewalRecord = makeRecord(
    "renewal",
    baseAnalysis({
      title: "Contrat fibre",
      risks: ["Clause de renouvellement automatique"],
      important_points: ["Reconduction tacite annuelle"],
      deadlines: ["Résilier avant le 01/09/2026"],
    }),
  );
  const renewalAlerts = detectAlertsForRecord(renewalRecord, now).filter(
    (a) => a.kind === "renewal",
  );
  assert.equal(renewalAlerts.length, 1);
  assertAlertShape(renewalAlerts[0]);
  assert.equal(renewalAlerts[0].priority, "haute");

  // 3) Paiement (échéance + montant)
  const paymentRecord = makeRecord(
    "payment",
    baseAnalysis({
      title: "Facture EDF",
      document_type: "Facture",
      amounts: ["850 €"],
      deadlines: ["Paiement à effectuer avant le 10/07/2026"],
    }),
    { category: "facture", label: "Facture", confidence: 0.9 },
  );
  const paymentAlerts = detectAlertsForRecord(paymentRecord, now).filter(
    (a) => a.kind === "important_payment",
  );
  assert.ok(paymentAlerts.length >= 1, "paiement détecté");
  assertAlertShape(paymentAlerts[0]);
  assert.ok(paymentAlerts.some((a) => a.date === "2026-07-10"));

  // 4) Risque important
  const riskRecord = makeRecord(
    "risk",
    baseAnalysis({
      title: "Mise en demeure",
      risk_level: "eleve",
      risk_score: 72,
      risks: ["Pénalités de retard"],
      actions: ["Contacter l'émetteur sous 8 jours"],
      risk_findings: [
        {
          description: "Pénalités de retard",
          why: "Mentions de pénalités.",
          implication: "Coût supplémentaire.",
          consequence: "Majoration de la dette.",
          mitigation: "Négocier un échéancier rapidement.",
          justification: "Mentions de pénalités.",
          impact: "Coût supplémentaire.",
          excerpt: "pénalités de retard",
          citation: {
            page: 1,
            paragraph: 1,
            excerpt: "pénalités de retard",
          },
          confidence: 0.85,
          severity: "eleve",
          status: "confirmed",
        },
      ],
    }),
    {
      category: "courrier-administratif",
      label: "Courrier",
      confidence: 0.8,
    },
  );
  const riskAlerts = detectAlertsForRecord(riskRecord, now).filter(
    (a) => a.kind === "high_risk",
  );
  assert.equal(riskAlerts.length, 1);
  assertAlertShape(riskAlerts[0]);
  assert.ok(
    /échéancier|document|risque/i.test(riskAlerts[0].recommendedAction),
  );

  console.log("OK test-alerts-engine", {
    deadline: deadlineAlerts[0].priority,
    renewal: renewalAlerts[0].recommendedAction.slice(0, 40),
    payments: paymentAlerts.map((a) => a.title),
    riskAction: riskAlerts[0].recommendedAction.slice(0, 50),
  });
}

main();
