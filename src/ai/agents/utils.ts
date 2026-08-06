import type { OllamaGenerateResult } from "@/ai/models/types";
import type { AnalysisLogStep } from "@/types/analysis-log";
import type { AgentId, AgentPipelineState, AgentRunMeta } from "./types";

export function emptyTokens() {
  return { prompt: 0, completion: 0, total: 0 };
}

export function addTokens(
  a: AgentPipelineState["tokens"],
  generation: Pick<
    OllamaGenerateResult,
    "promptTokens" | "completionTokens" | "totalTokens"
  >,
): AgentPipelineState["tokens"] {
  return {
    prompt: a.prompt + generation.promptTokens,
    completion: a.completion + generation.completionTokens,
    total: a.total + generation.totalTokens,
  };
}

export function pushAgentStep(
  state: AgentPipelineState,
  agentId: AgentId,
  meta: AgentRunMeta,
): AgentPipelineState {
  const step: AnalysisLogStep = {
    task: `agent:${agentId}`,
    model: meta.generation?.model || state.model,
    durationMs: meta.durationMs,
    tokens: meta.generation
      ? {
          prompt: meta.generation.promptTokens,
          completion: meta.generation.completionTokens,
          total: meta.generation.totalTokens,
        }
      : emptyTokens(),
    ok: meta.ok,
    error: meta.error || meta.note,
  };

  let next: AgentPipelineState = {
    ...state,
    steps: [...state.steps, step],
  };

  if (meta.generation) {
    next = {
      ...next,
      model: meta.generation.model || next.model,
      tokens: addTokens(next.tokens, meta.generation),
    };
  }

  return next;
}

export function sliceList(items: string[], max: number): string[] {
  return items
    .map((s) => s.trim())
    .filter(Boolean)
    .slice(0, max);
}
