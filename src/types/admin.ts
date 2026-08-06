import type { AiTask } from "@/ai/models/config";

export type AdminPromptKey =
  | "classification"
  | "analysis"
  | "reply"
  | "searchIntent";

export interface AdminTaskModelConfig {
  model: string;
  temperature: number;
  maxTokens?: number;
}

export interface AdminRuntimeConfig {
  ollamaBaseUrl: string;
  tasks: Record<Exclude<AiTask, "embed">, AdminTaskModelConfig>;
  embedModel: string;
  activePrompts: Record<AdminPromptKey, string | null>;
  /** Tracks `activeProfile` from src/config/docmind.ts */
  profileId?: string;
  updatedAt: string;
}

/** Immutable prompt revision — edits always create a new version. */
export interface AdminPromptVersion {
  id: string;
  key: AdminPromptKey;
  /** Monotonic version number per key (v1, v2, …) */
  version: number;
  label: string;
  content: string;
  createdAt: string;
  /** Parent version id when this revision was created from an edit/rollback fork */
  parentId?: string | null;
  note?: string;
}

export interface AdminPromptsFile {
  versions: AdminPromptVersion[];
}

/** Snapshot of which prompt revision powered a run (eval / analyse). */
export interface PromptUsageEntry {
  key: AdminPromptKey;
  source: "admin" | "code";
  versionId: string | null;
  version: number | null;
  label: string;
}

export type PromptUsageSnapshot = PromptUsageEntry[];

export interface AdminMetricEvent {
  id: string;
  at: string;
  task: string;
  model: string;
  durationMs: number;
  ok: boolean;
  errorCode?: string;
  errorMessage?: string;
  promptChars?: number;
  responseChars?: number;
  historyId?: string;
  promptVersionId?: string | null;
  promptVersion?: number | null;
}

export interface AdminMetricsFile {
  events: AdminMetricEvent[];
}

export interface AdminPerformanceSummary {
  totalCalls: number;
  successRate: number;
  avgDurationMs: number;
  p95DurationMs: number;
  byTask: Array<{
    task: string;
    count: number;
    avgDurationMs: number;
    successRate: number;
  }>;
}

export interface AdminFrequentError {
  key: string;
  count: number;
  lastAt: string;
  sampleMessage: string;
  task?: string;
}
