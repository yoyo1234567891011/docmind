import { getOptimizationConfig } from "@/config/optimizations";
import { formatPagesForLlm } from "@/ai/reasoning/citations";
import { prepareDocumentTextForLlm } from "@/ai/utils/prepare-document-text";
import { resolveTaskConfig } from "@/services/admin/config-store";
import type { DocumentAnalysis, DocumentClassification } from "@/types";
import { actionsAgent } from "./actions-agent";
import { classifyAgent } from "./classify-agent";
import { factsAgent } from "./facts-agent";
import { runFastMultiAgentAnalysis } from "./fast-orchestrator";
import { attachKnowledgeToState } from "./load-knowledge";
import { legalAgent } from "./legal-agent";
import { risksAgent } from "./risks-agent";
import { scoreAgent } from "./score-agent";
import { verifyAgent } from "./verify-agent";
import type { AnalysisAgent, AgentPipelineState } from "./types";
import { emptyTokens } from "./utils";

function buildInitialState(input: {
  documentText: string;
  pages?: string[];
  fileName?: string;
  model: string;
}): AgentPipelineState {
  const pages = input.pages?.filter((p) => p.trim()) ?? [];
  const documentText =
    pages.length > 0 ? pages.join("\n\n") : input.documentText;
  const llmSource =
    pages.length > 0 ? formatPagesForLlm(pages) : input.documentText;

  return {
    documentText,
    llmText: prepareDocumentTextForLlm(llmSource),
    pages: pages.length > 0 ? pages : undefined,
    fileName: input.fileName,
    model: input.model,
    tokens: emptyTokens(),
    steps: [],
  };
}

/**
 * Chaîne d'agents complète (1 LLM / agent LLM) — mode `full`.
 */
export const DEFAULT_ANALYSIS_AGENTS: AnalysisAgent[] = [
  classifyAgent,
  factsAgent,
  legalAgent,
  risksAgent,
  scoreAgent,
  actionsAgent,
  verifyAgent,
];

export type MultiAgentRunResult = {
  classification: DocumentClassification;
  analysis: DocumentAnalysis;
  state: AgentPipelineState;
};

function salvageAnalysis(state: AgentPipelineState): DocumentAnalysis {
  const facts = state.facts;
  const legal = state.legal;
  const assessment = state.assessment ?? {
    risk_score: 0,
    risk_level: "faible" as const,
    risk_explanation: "Score indisponible.",
    risk_criteria: [],
  };

  return {
    document_type:
      legal?.document_type || state.classification?.label || "Document",
    title:
      legal?.title ||
      state.fileName?.replace(/\.pdf$/i, "") ||
      "Document",
    summary:
      legal?.summary ||
      "Analyse multi-agents incomplète — champs partiels conservés.",
    date: facts?.date || "",
    dates: facts?.dates || [],
    people: facts?.people || [],
    organizations: facts?.organizations || [],
    amounts: facts?.amounts || [],
    deadlines: facts?.deadlines || [],
    important_points: legal?.important_points || [],
    risks: state.risks || [],
    actions: state.actions || [],
    risk_findings: state.risk_findings,
    ...assessment,
  };
}

async function runSequentialAgents(input: {
  documentText: string;
  pages?: string[];
  fileName?: string;
  agents: AnalysisAgent[];
}): Promise<MultiAgentRunResult> {
  const model = (await resolveTaskConfig("analyze")).model;

  let state = buildInitialState({
    documentText: input.documentText,
    pages: input.pages,
    fileName: input.fileName,
    model,
  });

  for (const agent of input.agents) {
    const result = await agent.run(state);
    state = result.state;
    // Après classification : charger /knowledge pour les agents suivants
    if (agent.id === "classify") {
      state = await attachKnowledgeToState(state);
    }
  }

  const classification: DocumentClassification = state.classification ?? {
    category: "autre",
    label: "Autre",
    confidence: 0,
  };

  return {
    classification,
    analysis: state.analysis ?? salvageAnalysis(state),
    state,
  };
}

/**
 * Orchestrateur multi-agents.
 * - défaut (`fast`) : 1 appel LLM bundle + score/verify (latence ≈ ancienne analyse)
 * - `full` : un appel LLM par agent (OPT_AGENT_FAST=0)
 * - `agents` custom : toujours séquentiel (tests / overrides)
 */
export async function runMultiAgentAnalysis(input: {
  documentText: string;
  pages?: string[];
  fileName?: string;
  agents?: AnalysisAgent[];
}): Promise<MultiAgentRunResult> {
  if (input.agents) {
    return runSequentialAgents({
      documentText: input.documentText,
      pages: input.pages,
      fileName: input.fileName,
      agents: input.agents,
    });
  }

  const fast = getOptimizationConfig().agentFastMode.enabled;
  if (fast) {
    return runFastMultiAgentAnalysis({
      documentText: input.documentText,
      pages: input.pages,
      fileName: input.fileName,
    });
  }

  return runSequentialAgents({
    documentText: input.documentText,
    pages: input.pages,
    fileName: input.fileName,
    agents: DEFAULT_ANALYSIS_AGENTS,
  });
}

/** Permet de remplacer un agent par id (tests / personnalisation). */
export function withAgentOverride(
  agent: AnalysisAgent,
  chain: AnalysisAgent[] = DEFAULT_ANALYSIS_AGENTS,
): AnalysisAgent[] {
  return chain.map((a) => (a.id === agent.id ? agent : a));
}
