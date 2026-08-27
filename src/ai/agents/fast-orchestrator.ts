import { formatPagesForLlm } from "@/ai/reasoning/citations";
import { classifyDocumentHeuristic } from "@/ai/classification/heuristic";
import { prepareDocumentTextForLlm } from "@/ai/utils/prepare-document-text";
import { asStringArray } from "@/ai/validation/json";
import { resolveTaskConfig } from "@/services/admin/config-store";
import type { DocumentAnalysis, DocumentClassification } from "@/types";
import { classifyAgent } from "./classify-agent";
import { attachKnowledgeToState } from "./load-knowledge";
import {
  enrichThinCoreBundle,
  evaluateCoreBundleGeneration,
  isCoreBundleSchemaValid,
  throwOnFailedCoreBundle,
  type CoreBundleOutcome,
  type CoreBundleParsed,
} from "./core-bundle-outcome";
import { generateAgentJson } from "./llm";
import { tryParseJsonObject } from "@/ai/validation/json";
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
import {
  latencyMeta,
  latencySpan,
  measureLatencySpanAsync,
} from "@/services/analysis-jobs/latency-diag";

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

const CORE_BUNDLE_ATTEMPTS = 2;

type SalvageCtx = {
  categoryLabel: string;
  fileName?: string;
  amounts?: string[];
  deadlines?: string[];
};

async function generateCoreBundleOutcome(
  prompt: string,
  salvageCtx: SalvageCtx,
): Promise<{
  parsed: CoreBundleParsed;
  generation: Awaited<ReturnType<typeof generateAgentJson>>["generation"];
}> {
  let lastOutcome: CoreBundleOutcome | null = null;

  for (let attempt = 0; attempt < CORE_BUNDLE_ATTEMPTS; attempt += 1) {
    const { generation, error } = await generateAgentJson(prompt);
    const outcome = evaluateCoreBundleGeneration({ generation, error });
    if (outcome.ok) {
      return { parsed: outcome.parsed, generation };
    }
    lastOutcome = outcome;

    if (
      generation?.text &&
      (outcome.code === "INVALID_JSON" || outcome.code === "INVALID_SCHEMA")
    ) {
      const salvageStarted = Date.now();
      const loose = tryParseJsonObject<CoreBundleParsed>(generation.text);
      if (loose) {
        const enriched = enrichThinCoreBundle(loose, salvageCtx);
        if (isCoreBundleSchemaValid(enriched)) {
          latencySpan("salvageMs", Date.now() - salvageStarted);
          latencyMeta({ salvaged: true });
          console.warn(
            `[analyze] core bundle salvaged locally code=${outcome.code}`,
          );
          return { parsed: enriched, generation };
        }
      }
      latencySpan("salvageMs", Date.now() - salvageStarted);
    }

    if (outcome.code === "INVALID_JSON" && attempt < CORE_BUNDLE_ATTEMPTS - 1) {
      console.warn(
        `[analyze] core bundle retry JSON attempt=${attempt + 1}/${CORE_BUNDLE_ATTEMPTS}`,
      );
      continue;
    }
    break;
  }

  throwOnFailedCoreBundle(lastOutcome!);
  throw new Error("unreachable");
}

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
  const prepStarted = Date.now();
  const model = (await resolveTaskConfig("analyze")).model;
  const pages = input.pages?.filter((p) => p.trim()) ?? [];
  const documentText =
    pages.length > 0 ? pages.join("\n\n") : input.documentText;
  const llmSource =
    pages.length > 0 ? formatPagesForLlm(pages) : input.documentText;

  const baselineFacts = localFacts(input.documentText);
  const heuristicClass = classifyDocumentHeuristic(documentText);

  let state: AgentPipelineState = {
    documentText,
    llmText: prepareDocumentTextForLlm(llmSource),
    pages: pages.length > 0 ? pages : undefined,
    fileName: input.fileName,
    model,
    tokens: emptyTokens(),
    steps: [],
    classification: heuristicClass,
    facts: baselineFacts,
  };

  const [classified, withKnowledge] = await Promise.all([
    classifyAgent.run(state),
    attachKnowledgeToState(state),
  ]);

  state = {
    ...classified.state,
    knowledge: withKnowledge.knowledge,
    steps: [
      ...classified.state.steps,
      ...withKnowledge.steps.filter((s) => s.task === "agent:knowledge"),
    ],
  };

  const categoryLabel = state.classification?.label || "Document";
  const prompt = buildCoreBundlePrompt({
    categoryLabel,
    documentText: state.llmText,
    knowledgeBlock: state.knowledge?.promptBlock,
    localFacts: baselineFacts,
  });
  latencySpan("preparationMs", Date.now() - prepStarted);
  latencyMeta({ documentLabel: input.fileName || categoryLabel });

  const { parsed: rawParsed, generation } = await generateCoreBundleOutcome(
    prompt,
    {
      categoryLabel,
      fileName: input.fileName,
      amounts: baselineFacts.amounts,
      deadlines: baselineFacts.deadlines,
    },
  );

  const parseStarted = Date.now();
  const parsed = enrichThinCoreBundle(rawParsed, {
    categoryLabel,
    fileName: input.fileName,
    amounts: baselineFacts.amounts,
    deadlines: baselineFacts.deadlines,
  }) as CoreBundle;
  const facts = mergeFactsLocalFirst(parsed, baselineFacts);
  const legal: LegalAnalysis = parseLegalFromParsed(parsed, {
    document_type: categoryLabel,
    title: input.fileName?.replace(/\.pdf$/i, "") || categoryLabel,
    summary: "",
    important_points: [],
  });
  const risk_findings = parseRiskFindings(parsed.risk_findings);
  let risks = sliceList(asStringArray(parsed.risks), 8);
  if (risks.length === 0) {
    risks = risk_findings.map((f) => f.description).slice(0, 8);
  }
  let actions = sliceList(asStringArray(parsed.actions), 6);
  let note = "Bundle LLM OK (Local First).";
  if (actions.length === 0) {
    actions = buildDeterministicActions({
      risks,
      findings: risk_findings,
      deadlines: facts.deadlines,
    });
    note = "Bundle OK — actions déterministes (LLM vides).";
  }
  latencySpan("parsingMs", Date.now() - parseStarted);

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
    generation: generation ?? undefined,
    ok: true,
    note,
  });

  state = { ...state, actions };
  state = pushAgentStep(state, "actions", {
    durationMs: 0,
    ok: true,
    note: "Actions via bundle rapide ou déterministes.",
  });

  state = await measureLatencySpanAsync("scoreMs", async () =>
    (await scoreAgent.run(state)).state,
  );
  state = await measureLatencySpanAsync("verifyMs", async () =>
    (await verifyAgent.run(state)).state,
  );

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
