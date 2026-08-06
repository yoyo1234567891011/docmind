export interface ExpectedAnalysis {
  document_type: string;
  title: string;
  summary: string;
  people: string[];
  organizations: string[];
  amounts: string[];
  dates: string[];
  deadlines: string[];
  important_points: string[];
  risks: string[];
  actions: string[];
  risk_score: number;
}

export const EVAL_FIELDS = [
  "document_type",
  "title",
  "summary",
  "people",
  "organizations",
  "amounts",
  "dates",
  "deadlines",
  "important_points",
  "risks",
  "actions",
  "risk_score",
] as const;

export type EvalField = (typeof EVAL_FIELDS)[number];

/** Fields compared by semantic meaning (embeddings), not exact text. */
export const SEMANTIC_FIELDS = [
  "summary",
  "important_points",
  "risks",
  "actions",
] as const;

export type SemanticEvalField = (typeof SEMANTIC_FIELDS)[number];

export type FieldStatus = "correct" | "partial" | "error" | "omission";

export type ComparisonMode = "lexical" | "semantic" | "numeric";

export type SemanticDiffKind =
  | "equivalent"
  | "partial"
  | "missing"
  | "extra"
  | "divergent";

export interface SemanticDiff {
  kind: SemanticDiffKind;
  expected?: string;
  predicted?: string;
  similarity: number;
  note: string;
}

export interface FieldComparison {
  field: EvalField;
  status: FieldStatus;
  score: number;
  expected: unknown;
  predicted: unknown;
  correctItems: string[];
  errors: string[];
  omissions: string[];
  detail: string;
  mode?: ComparisonMode;
  diffs?: SemanticDiff[];
}

/** Étapes multi-agents évaluées séparément. */
export const AGENT_EVAL_STEPS = [
  {
    id: "classify",
    label: "Classification",
    fields: ["document_type"] as const,
  },
  {
    id: "facts",
    label: "Extraction",
    fields: [
      "people",
      "organizations",
      "amounts",
      "dates",
      "deadlines",
    ] as const,
  },
  {
    id: "legal",
    label: "Analyse juridique",
    fields: ["title", "summary", "important_points"] as const,
  },
  {
    id: "risks",
    label: "Détection des risques",
    fields: ["risks"] as const,
  },
  {
    id: "score",
    label: "Score de risque",
    fields: ["risk_score"] as const,
  },
  {
    id: "actions",
    label: "Actions",
    fields: ["actions"] as const,
  },
  {
    id: "verify",
    label: "Vérification finale",
    fields: [] as const,
  },
] as const;

export type AgentEvalId = (typeof AGENT_EVAL_STEPS)[number]["id"];

export interface AgentFieldScore {
  field: string;
  score: number;
  status: FieldStatus;
  detail: string;
}

export interface AgentStepEval {
  id: AgentEvalId;
  label: string;
  score: number;
  status: FieldStatus;
  detail: string;
  fieldScores: AgentFieldScore[];
  notes: string[];
}

export interface DocumentEvalResult {
  id: string;
  relativePath: string;
  category: string;
  fileName: string;
  expectedPath: string;
  success: boolean;
  error?: string;
  score: number;
  fields: FieldComparison[];
  /** Scores par agent (spécialité) */
  agents?: AgentStepEval[];
  /** Moyenne des scores agents (0..1) */
  agentScore?: number;
  durationMs: number;
  /** Prompt revisions used for this evaluation run */
  promptsUsed?: import("@/types/admin").PromptUsageSnapshot;
}
