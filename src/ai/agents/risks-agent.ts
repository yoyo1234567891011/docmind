import type { RiskFinding } from "@/types";
import { asStringArray } from "@/ai/validation/json";
import { buildRisksAgentPrompt } from "./prompts/risks";
import { generateAgentJson, parseAgentJson } from "./llm";
import { parseRiskFindings } from "./parse-specialists";
import type { AnalysisAgent, AgentResult } from "./types";
import { pushAgentStep, sliceList } from "./utils";

/** Agent 4 — Évaluation des risques. */
export const risksAgent: AnalysisAgent = {
  id: "risks",
  label: "Évaluation des risques",
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
    const legal = state.legal ?? {
      document_type: classification.label,
      title: "",
      summary: "",
      important_points: [],
    };

    const prompt = buildRisksAgentPrompt({
      classification,
      facts,
      legal,
      documentText: state.llmText,
      knowledgeBlock: state.knowledge?.promptBlock,
    });
    const { generation, error } = await generateAgentJson(prompt);

    let risk_findings: RiskFinding[] = [];
    let risks: string[] = [];
    let note: string | undefined;
    let ok = true;

    if (generation) {
      const parsed = parseAgentJson<{
        risk_findings?: unknown;
        risks?: unknown;
      }>(generation.text);
      if (parsed) {
        risk_findings = parseRiskFindings(parsed.risk_findings);
        risks = sliceList(asStringArray(parsed.risks), 8);
        if (risks.length === 0) {
          risks = risk_findings.map((f) => f.description).slice(0, 8);
        }
      } else {
        note = "JSON risques invalide — aucun finding.";
      }
    } else {
      ok = false;
      note = error || "Échec agent risques.";
    }

    const next = pushAgentStep(
      { ...state, risk_findings, risks },
      "risks",
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
