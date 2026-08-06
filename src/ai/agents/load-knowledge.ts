import { isKnowledgeBaseEnabled } from "@/config/optimizations";
import { selectKnowledgeForDocument } from "@/services/knowledge";
import type { AgentPipelineState } from "./types";

/**
 * Après classification : charge les fiches /knowledge pertinentes.
 */
export async function attachKnowledgeToState(
  state: AgentPipelineState,
): Promise<AgentPipelineState> {
  const started = Date.now();

  if (!isKnowledgeBaseEnabled()) {
    return {
      ...state,
      steps: [
        ...state.steps,
        {
          task: "agent:knowledge",
          model: "knowledge-base",
          durationMs: 0,
          tokens: { prompt: 0, completion: 0, total: 0 },
          ok: true,
          error: "Base de connaissances désactivée (OPT_KNOWLEDGE=0).",
        },
      ],
    };
  }

  try {
    const knowledge = await selectKnowledgeForDocument({
      category: state.classification?.category || "autre",
      categoryLabel: state.classification?.label || "Document",
      documentText: state.documentText,
    });

    return {
      ...state,
      knowledge,
      steps: [
        ...state.steps,
        {
          task: "agent:knowledge",
          model: "knowledge-base",
          durationMs: Date.now() - started,
          tokens: { prompt: 0, completion: 0, total: 0 },
          ok: true,
          error: `Fiches: ${knowledge.selectedIds.join(", ") || "aucune"}`,
        },
      ],
    };
  } catch (error) {
    return {
      ...state,
      steps: [
        ...state.steps,
        {
          task: "agent:knowledge",
          model: "knowledge-base",
          durationMs: Date.now() - started,
          tokens: { prompt: 0, completion: 0, total: 0 },
          ok: false,
          error:
            error instanceof Error
              ? error.message
              : "Échec chargement connaissances",
        },
      ],
    };
  }
}
