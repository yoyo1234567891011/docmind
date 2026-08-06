import { buildLegalAgentPrompt } from "./prompts/legal";
import { generateAgentJson, parseAgentJson } from "./llm";
import { parseLegalFromParsed } from "./parse-specialists";
import type { AnalysisAgent, AgentResult, LegalAnalysis } from "./types";
import { pushAgentStep } from "./utils";

function fallbackLegal(state: {
  classification?: { label: string };
  fileName?: string;
  documentText: string;
}): LegalAnalysis {
  const preview = state.documentText.replace(/\s+/g, " ").trim().slice(0, 280);
  return {
    document_type: state.classification?.label || "Document",
    title:
      state.fileName?.replace(/\.pdf$/i, "") ||
      state.classification?.label ||
      "Document",
    summary: preview
      ? `Analyse juridique partielle. Extrait : ${preview}${preview.length >= 280 ? "…" : ""}`
      : "Analyse juridique partielle.",
    // Pas de conclusions sans preuve
    important_points: [],
    important_point_drafts: [],
  };
}

/** Agent 3 — Analyse juridique. */
export const legalAgent: AnalysisAgent = {
  id: "legal",
  label: "Analyse juridique",
  kind: "llm",

  async run(state): Promise<AgentResult> {
    const started = Date.now();
    const classification = state.classification ?? {
      category: "autre" as const,
      label: "Autre",
      confidence: 0,
    };
    const facts = state.facts ?? {
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      clauses: [],
    };

    const prompt = buildLegalAgentPrompt({
      classification,
      facts,
      documentText: state.llmText,
      knowledgeBlock: state.knowledge?.promptBlock,
    });
    const { generation, error } = await generateAgentJson(prompt);

    let legal = fallbackLegal(state);
    let note: string | undefined;
    let ok = true;

    if (generation) {
      const parsed = parseAgentJson<Record<string, unknown>>(generation.text);
      if (parsed && (parsed.title || parsed.summary || parsed.document_type)) {
        legal = parseLegalFromParsed(parsed as Partial<LegalAnalysis>, legal);
      } else {
        note = "JSON juridique invalide — repli local.";
      }
    } else {
      ok = false;
      note = error || "Échec agent juridique — repli local.";
    }

    const next = pushAgentStep(
      { ...state, legal },
      "legal",
      {
        durationMs: generation?.durationMs ?? Date.now() - started,
        generation,
        ok,
        note,
        error: ok ? undefined : note,
      },
    );

    return {
      state: next,
      meta: { durationMs: Date.now() - started, generation, ok: true, note },
    };
  },
};
