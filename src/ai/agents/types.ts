import type { OllamaGenerateResult } from "@/ai/models/types";
import type { AnalysisLogStep } from "@/types/analysis-log";
import type { CitedConclusion } from "@/types/citation";
import type {
  DocumentAnalysis,
  DocumentClassification,
  RiskAssessment,
  RiskFinding,
} from "@/types";
import type { ImportantPointDraft } from "@/ai/reasoning/verify-analysis";
import type { KnowledgeSelection } from "@/services/knowledge";

export const AGENT_IDS = [
  "classify",
  "facts",
  "legal",
  "risks",
  "score",
  "actions",
  "verify",
] as const;

export type AgentId = (typeof AGENT_IDS)[number];

export type AgentKind = "llm" | "deterministic";

/** Faits extraits (Agent 2). */
export type ExtractedFacts = {
  date: string;
  dates: string[];
  people: string[];
  organizations: string[];
  amounts: string[];
  deadlines: string[];
  /** Clauses / dispositions factuelles citées */
  clauses: string[];
};

/** Analyse juridique narrative (Agent 3). */
export type LegalAnalysis = {
  document_type: string;
  title: string;
  summary: string;
  important_points: string[];
  important_point_drafts?: ImportantPointDraft[];
};

/**
 * État mutable partagé entre agents.
 * Chaque agent lit ce dont il a besoin et n'écrit que sa spécialité.
 */
export type AgentPipelineState = {
  documentText: string;
  llmText: string;
  /** Texte par page pour citations */
  pages?: string[];
  fileName?: string;
  important_point_findings?: CitedConclusion[];
  /** Fiches /knowledge sélectionnées pour ce document */
  knowledge?: KnowledgeSelection;
  classification?: DocumentClassification;
  facts?: ExtractedFacts;
  legal?: LegalAnalysis;
  risk_findings?: RiskFinding[];
  risks?: string[];
  assessment?: RiskAssessment;
  actions?: string[];
  /** JSON final assemblé (Agent 7) */
  analysis?: DocumentAnalysis;
  model: string;
  tokens: { prompt: number; completion: number; total: number };
  steps: AnalysisLogStep[];
};

export type AgentRunMeta = {
  durationMs: number;
  generation?: OllamaGenerateResult | null;
  note?: string;
  ok: boolean;
  error?: string;
};

export type AgentResult = {
  state: AgentPipelineState;
  meta: AgentRunMeta;
};

export interface AnalysisAgent {
  readonly id: AgentId;
  readonly label: string;
  readonly kind: AgentKind;
  run(state: AgentPipelineState): Promise<AgentResult>;
}
