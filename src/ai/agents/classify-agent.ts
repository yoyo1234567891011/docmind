import { classifyDocumentTextWithMeta } from "@/ai/pipelines/classify";
import type { AnalysisAgent, AgentResult } from "./types";
import { pushAgentStep } from "./utils";

/** Agent 1 — Classification du document. */
export const classifyAgent: AnalysisAgent = {
  id: "classify",
  label: "Classification du document",
  kind: "llm",

  async run(state): Promise<AgentResult> {
    const started = Date.now();
    const classified = await classifyDocumentTextWithMeta(state.documentText);

    let next: typeof state = {
      ...state,
      classification: classified.classification,
    };

    const isLocal =
      classified.source === "heuristic" || classified.source === "fallback";

    next = pushAgentStep(next, "classify", {
      durationMs: classified.generation.durationMs || Date.now() - started,
      generation: isLocal ? null : classified.generation,
      ok: true,
      note:
        classified.source === "heuristic"
          ? "Classification locale (sans LLM)."
          : classified.source === "fallback"
            ? "Classification de repli (autre)."
            : undefined,
    });

    // Heuristic/fallback : enregistrer quand même la durée modèle factice
    if (isLocal && next.steps[next.steps.length - 1]) {
      // tokens already empty; ensure model label appears in step
      const last = next.steps[next.steps.length - 1]!;
      last.model = classified.generation.model;
      last.durationMs = classified.generation.durationMs;
    }

    return {
      state: next,
      meta: {
        durationMs: Date.now() - started,
        ok: true,
        generation: isLocal ? null : classified.generation,
      },
    };
  },
};
