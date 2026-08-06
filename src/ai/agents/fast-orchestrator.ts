import { formatPagesForLlm } from "@/ai/reasoning/citations";
import { prepareDocumentTextForLlm } from "@/ai/utils/prepare-document-text";
import { asStringArray } from "@/ai/validation/json";
import { resolveTaskConfig } from "@/services/admin/config-store";
import type { DocumentAnalysis, DocumentClassification } from "@/types";
import { classifyAgent } from "./classify-agent";
import { attachKnowledgeToState } from "./load-knowledge";
import { generateAgentJson, parseAgentJson } from "./llm";
import {
  buildDeterministicActions,
  localFacts,
  mergeFactsLocalFirst,
  parseLegalFromParsed,
  parseRiskFindings,
} from "./parse-specialists";
import { buildCoreBundlePrompt } from "./prompts/core-bundle";
import { scoreAgent } from "./score-agent";
import type {
  AgentPipelineState,
  ExtractedFacts,
  LegalAnalysis,
} from "./types";
import { pushAgentStep, sliceList, emptyTokens } from "./utils";
import { verifyAgent } from "./verify-agent";

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

type CoreBundle = Partial<ExtractedFacts> &
  Partial<LegalAnalysis> & {
    risk_findings?: unknown;
    risks?: unknown;
    actions?: unknown;
  };

/**
 * Mode rapide (défaut) :
 * - classify (souvent heuristique, sans LLM)
 * - 1 seul appel LLM (faits + juridique + risques + actions)
 * - score + verify déterministes
 *
 * Les modules agents restent indépendants ; ce runner batche les LLM.
 */
export async function runFastMultiAgentAnalysis(input: {
  documentText: string;
  pages?: string[];
  fileName?: string;
}): Promise<MultiAgentRunResult> {
  const model = (await resolveTaskConfig("analyze")).model;
  const pages = input.pages?.filter((p) => p.trim()) ?? [];
  const documentText =
    pages.length > 0 ? pages.join("\n\n") : input.documentText;
  const llmSource =
    pages.length > 0 ? formatPagesForLlm(pages) : input.documentText;

  let state: AgentPipelineState = {
    documentText,
    llmText: prepareDocumentTextForLlm(llmSource),
    pages: pages.length > 0 ? pages : undefined,
    fileName: input.fileName,
    model,
    tokens: emptyTokens(),
    steps: [],
  };

  const baselineFacts = localFacts(input.documentText);
  state = (await classifyAgent.run(state)).state;
  state = { ...state, facts: baselineFacts };
  state = await attachKnowledgeToState(state);

  const categoryLabel = state.classification?.label || "Document";
  const prompt = buildCoreBundlePrompt({
    categoryLabel,
    documentText: state.llmText,
    knowledgeBlock: state.knowledge?.promptBlock,
    localFacts: baselineFacts,
  });
  const { generation, error } = await generateAgentJson(prompt);

  let facts = baselineFacts;
  let legal: LegalAnalysis = {
    document_type: categoryLabel,
    title: input.fileName?.replace(/\.pdf$/i, "") || categoryLabel,
    summary: "",
    important_points: [],
  };
  let risk_findings = parseRiskFindings(undefined);
  let risks: string[] = [];
  let actions: string[] = [];
  let note = "Bundle LLM OK (Local First).";

  if (generation) {
    const parsed = parseAgentJson<CoreBundle>(generation.text);
    if (parsed) {
      facts = mergeFactsLocalFirst(parsed, baselineFacts);
      legal = parseLegalFromParsed(parsed, legal);
      risk_findings = parseRiskFindings(parsed.risk_findings);
      risks = sliceList(asStringArray(parsed.risks), 8);
      if (risks.length === 0) {
        risks = risk_findings.map((f) => f.description).slice(0, 8);
      }
      actions = sliceList(asStringArray(parsed.actions), 6);
      if (actions.length === 0) {
        actions = buildDeterministicActions({
          risks,
          findings: risk_findings,
          deadlines: facts.deadlines,
        });
        note = "Bundle OK — actions déterministes (LLM vides).";
      }
    } else {
      note = "Bundle JSON invalide — faits locaux + actions déterministes.";
      actions = buildDeterministicActions({
        risks: [],
        findings: [],
        deadlines: facts.deadlines,
      });
      legal = {
        ...legal,
        summary:
          "Analyse partielle : le modèle n'a pas renvoyé un JSON exploitable.",
      };
    }
  } else {
    note = error || "Échec bundle LLM — repli local.";
    actions = buildDeterministicActions({
      risks: [],
      findings: [],
      deadlines: facts.deadlines,
    });
    legal = {
      ...legal,
      summary: "Analyse de secours (extraction locale). Relancer si besoin.",
      important_points: [
        ...(facts.amounts[0] ? [`Montant : ${facts.amounts[0]}`] : []),
        ...(facts.deadlines[0] ? [`Échéance : ${facts.deadlines[0]}`] : []),
      ],
    };
  }

  const llmDuration = generation?.durationMs ?? 0;

  state = { ...state, facts };
  state = pushAgentStep(state, "facts", {
    durationMs: 0,
    ok: true,
    note: "Faits 100% locaux (Local First).",
  });

  state = { ...state, legal };
  state = pushAgentStep(state, "legal", {
    durationMs: 0,
    ok: true,
    note: "Juridique via bundle rapide.",
  });

  state = { ...state, risk_findings, risks };
  state = pushAgentStep(state, "risks", {
    durationMs: llmDuration,
    generation,
    ok: Boolean(generation),
    note,
    error: generation ? undefined : note,
  });

  state = { ...state, actions };
  state = pushAgentStep(state, "actions", {
    durationMs: 0,
    ok: true,
    note: "Actions via bundle rapide ou déterministes.",
  });

  state = (await scoreAgent.run(state)).state;
  state = (await verifyAgent.run(state)).state;

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
