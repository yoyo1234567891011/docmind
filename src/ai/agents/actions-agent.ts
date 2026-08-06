import { asStringArray } from "@/ai/validation/json";
import { buildActionsAgentPrompt } from "./prompts/actions";
import { generateAgentJson, parseAgentJson } from "./llm";
import type { AnalysisAgent, AgentResult } from "./types";
import { pushAgentStep, sliceList } from "./utils";

function actionsFromDeadlines(deadlines: string[]): string[] {
  return deadlines.slice(0, 4).map((deadline) => {
    const clean = deadline.trim();
    if (
      /^v[ée]rifier|^anticiper|^adresser|^contester|^n[ée]gocier|^demander/i.test(
        clean,
      )
    ) {
      return clean;
    }
    return `Anticiper l'échéance : ${clean}`;
  });
}

/** Agent 6 — Génération des actions recommandées. */
export const actionsAgent: AnalysisAgent = {
  id: "actions",
  label: "Actions recommandées",
  kind: "llm",

  async run(state): Promise<AgentResult> {
    const started = Date.now();
    const facts = state.facts ?? {
      date: "",
      dates: [],
      people: [],
      organizations: [],
      amounts: [],
      deadlines: [],
      clauses: [],
    };
    const risks = state.risks ?? [];
    const findings = state.risk_findings ?? [];

    let actions: string[] = [];
    let note: string | undefined;
    let generation = null as Awaited<
      ReturnType<typeof generateAgentJson>
    >["generation"];

    if (risks.length > 0 || findings.length > 0 || facts.deadlines.length > 0) {
      const prompt = buildActionsAgentPrompt({
        facts,
        risks,
        findings,
        documentText: state.llmText,
      });
      const result = await generateAgentJson(prompt);
      generation = result.generation;

      if (generation) {
        const parsed = parseAgentJson<{ actions?: unknown }>(generation.text);
        actions = sliceList(asStringArray(parsed?.actions), 6);
        if (actions.length === 0) {
          actions = actionsFromDeadlines(facts.deadlines);
          note = "Actions LLM vides — repli échéances.";
        }
      } else {
        actions = actionsFromDeadlines(facts.deadlines);
        note = result.error || "Échec agent actions — repli échéances.";
      }
    } else {
      note = "Aucun risque/échéance — pas d'action générée.";
    }

    const next = pushAgentStep(
      { ...state, actions },
      "actions",
      {
        durationMs: generation?.durationMs ?? Date.now() - started,
        generation,
        ok: true,
        note,
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
