import { randomUUID } from "crypto";

import { RISK_CRITERIA } from "../src/services/risk/criteria";
import { EMPTY_READY_REPLY, type AnalyzeDocumentResult } from "../src/types";

export function buildChaosAnalysisResult(
  documentId: string,
  phase: "preview" | "complete" = "preview",
): AnalyzeDocumentResult {
  return {
    documentId,
    classification: {
      category: "autre",
      label: "Autre",
      confidence: 0.7,
    },
    analysis: {
      document_type: "Document chaos",
      title: "Chaos fixture",
      summary: "Analyse preview durable — ne doit jamais disparaître.",
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      important_points: ["Point conservé sous chaos"],
      risks: [],
      actions: [],
      risk_score: 5,
      risk_level: "faible",
      risk_explanation: "",
      risk_criteria: RISK_CRITERIA.map((c) => ({
        id: c.id,
        label: c.label,
        detected: false,
        score: 0,
        max_score: c.maxScore,
        reasons: [],
      })),
      risk_findings: [],
    },
    readyReply: EMPTY_READY_REPLY,
    model: "chaos-fixture",
    analyzedAt: new Date().toISOString(),
    promptsUsed: [],
    phase,
  };
}

export function chaosUserId(label: string): string {
  return `chaos-${label}-${randomUUID().slice(0, 8)}`;
}

export function chaosDocumentId(): string {
  return randomUUID();
}
