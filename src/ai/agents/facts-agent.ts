import { buildFactsAgentPrompt } from "./prompts/facts";
import { generateAgentJson, parseAgentJson } from "./llm";
import {
  localFacts,
  mergeFactsFromParsed,
} from "./parse-specialists";
import type { AnalysisAgent, AgentResult, ExtractedFacts } from "./types";
import { pushAgentStep } from "./utils";

/** Agent 2 — Extraction des faits (mode full). */
export const factsAgent: AnalysisAgent = {
  id: "facts",
  label: "Extraction des faits",
  kind: "llm",

  async run(state): Promise<AgentResult> {
    const started = Date.now();
    const baseline = localFacts(state.documentText);
    const prompt = buildFactsAgentPrompt(state.llmText);
    const { generation, error } = await generateAgentJson(prompt);

    let facts = baseline;
    let note: string | undefined;
    let ok = true;

    if (generation) {
      const parsed = parseAgentJson<Partial<ExtractedFacts>>(generation.text);
      if (parsed) {
        facts = mergeFactsFromParsed(parsed, baseline);
      } else {
        note = "JSON faits invalide — extraction locale conservée.";
      }
    } else {
      ok = false;
      note = error || "Échec agent faits — extraction locale.";
    }

    const next = pushAgentStep(
      { ...state, facts },
      "facts",
      {
        durationMs: generation?.durationMs ?? Date.now() - started,
        generation,
        ok: ok || Boolean(facts.amounts.length || facts.dates.length),
        note,
        error: ok ? undefined : note,
      },
    );

    return {
      state: next,
      meta: {
        durationMs: Date.now() - started,
        generation,
        ok: true,
        note,
      },
    };
  },
};
