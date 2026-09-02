import {
  ANALYSIS_PIPELINE_VERSION,
  buildCacheFingerprint,
  getCachedAnalysis,
  setCachedAnalysis,
} from "@/ai/optimizations";
import { runMultiAgentAnalysis } from "@/ai/agents";
import { assertPublishableLlmAnalysis } from "@/ai/agents/core-bundle-outcome";
import {
  documentAnalysisLockKey,
  getDocumentAnalysisInFlight,
  withDocumentAnalysisSingleFlight,
} from "@/ai/pipelines/document-analysis-lock";
import { generateReadyReplyWithMeta } from "@/ai/pipelines/reply";
import { prepareDocumentTextForLlm } from "@/ai/utils/prepare-document-text";
import { docmindConfig } from "@/config/docmind";
import { AppError } from "@/lib/errors";
import { sanitizeAnalysisFailureMessage } from "@/lib/sanitize";
import { resolveTaskConfig } from "@/services/admin/config-store";
import {
  ensureAdminRuntimeLoaded,
  getPromptUsageSnapshot,
} from "@/services/admin/runtime";
import { appendAnalysisLog } from "@/services/logs";
import { hasEntitlement } from "@/services/billing/entitlements";
import { buildDocumentSheetFromAnalysis } from "@/services/sheets";
import type { AnalysisLogStep } from "@/types/analysis-log";
import {
  EMPTY_READY_REPLY,
  type AnalyzeDocumentRequest,
  type AnalyzeDocumentResult,
  type ReadyReply,
} from "@/types";
import type { OllamaGenerateResult } from "@/ai/models/types";

function emptyTokens() {
  return { prompt: 0, completion: 0, total: 0 };
}

function addTokens(
  a: { prompt: number; completion: number; total: number },
  generation: {
    promptTokens: number;
    completionTokens: number;
    totalTokens: number;
  },
) {
  return {
    prompt: a.prompt + generation.promptTokens,
    completion: a.completion + generation.completionTokens,
    total: a.total + generation.totalTokens,
  };
}

/**
 * Pipeline multi-agents :
 * classify → facts → legal → risks → score → actions → verify
 * Puis optionnellement courrier prêt.
 *
 * Single-flight par document : un 2ᵉ appel concurrent attend la 1ʳᵉ
 * analyse (ou renvoie ANALYSIS_IN_PROGRESS si `onInFlight: "status"`).
 */
export async function analyzeDocumentText(
  request: AnalyzeDocumentRequest,
): Promise<AnalyzeDocumentResult> {
  const key = documentAnalysisLockKey(request.userId, request.documentId);
  const inFlight = await getDocumentAnalysisInFlight(key);

  if (inFlight && request.onInFlight === "status") {
    console.info(
      `[analyze] in-flight status key=${key} elapsedMs=${inFlight.elapsedMs} waiters=${inFlight.waiters}`,
    );
    throw new AppError(
      "ANALYSIS_IN_PROGRESS",
      `Analyse déjà en cours pour ce document (${Math.round(inFlight.elapsedMs / 1000)}s écoulées).`,
      409,
    );
  }

  const { result, coalesced } = await withDocumentAnalysisSingleFlight(
    key,
    async () => {
      if (request.beforeLeaderRun) {
        await request.beforeLeaderRun();
      }
      return analyzeDocumentTextUnlocked(request);
    },
  );

  if (!coalesced) return result;

  return {
    ...result,
    documentId: request.documentId,
    coalescedFromInFlight: true,
  };
}

async function analyzeDocumentTextUnlocked(
  request: AnalyzeDocumentRequest,
): Promise<AnalyzeDocumentResult> {
  await ensureAdminRuntimeLoaded();
  const text = request.text.trim();
  const started = Date.now();
  let steps: AnalysisLogStep[] = [];
  let tokens = emptyTokens();
  const promptsUsed = await getPromptUsageSnapshot();
  let model = (await resolveTaskConfig("analyze")).model;
  let category: string = "autre";
  let categoryLabel = "Autre";

  if (!text) {
    const error = new AppError(
      "BAD_REQUEST",
      "Aucun texte à analyser. Le PDF semble vide ou non extractible.",
    );
  await appendAnalysisLog(request.userId, {
      documentId: request.documentId,
      fileName: request.fileName,
      category: "autre",
      categoryLabel: "Autre",
      model,
      promptsUsed,
      durationMs: Date.now() - started,
      tokens,
      steps,
      result: null,
      ok: false,
      errorCode: error.code,
      errorMessage: error.message,
    }).catch(() => undefined);
    throw error;
  }

  try {
    const cacheFingerprint = buildCacheFingerprint({
      model,
      promptsUsed,
      pipelineVersion: ANALYSIS_PIPELINE_VERSION,
    });
    const cached = await getCachedAnalysis(
      request.userId,
      text,
      cacheFingerprint,
    );
    if (cached) {
      const analyzedAt = new Date().toISOString();
      const canLetter = await hasEntitlement(request.userId, "letter_agent", {
        reconcile: false,
      });
      const readyReply =
        canLetter && cached.readyReply && !request.skipReadyReply
          ? cached.readyReply
          : EMPTY_READY_REPLY;
      const summary =
        typeof cached.analysis?.summary === "string"
          ? cached.analysis.summary
          : "";
      const result: AnalyzeDocumentResult = {
        documentId: request.documentId,
        classification: cached.classification,
        analysis: cached.analysis,
        readyReply,
        model: cached.model || model,
        analyzedAt,
        promptsUsed,
        resultSource: "cache",
        durationMs: Date.now() - started,
        sheet: buildDocumentSheetFromAnalysis({
          documentId: request.documentId,
          fileName: request.fileName || "document.pdf",
          classification: cached.classification,
          analysis: cached.analysis,
          analyzedAt,
        }),
      };
      steps.push({
        task: "analyze",
        model: result.model,
        durationMs: Date.now() - started,
        tokens: emptyTokens(),
        ok: true,
        error: "Cache d'analyse (hash texte).",
      });
      await appendAnalysisLog(request.userId, {
        documentId: request.documentId,
        fileName: request.fileName,
        category: cached.classification.category,
        categoryLabel: cached.classification.label,
        model: result.model,
        promptsUsed,
        durationMs: Date.now() - started,
        tokens,
        steps,
        result: {
          title: cached.analysis.title,
          documentType: cached.analysis.document_type,
          riskScore: cached.analysis.risk_score,
          riskLevel: cached.analysis.risk_level,
          summary: summary.slice(0, 500),
          replyRequired: result.readyReply.required,
          actionCount: cached.analysis.actions?.length ?? 0,
          deadlineCount: cached.analysis.deadlines?.length ?? 0,
        },
        ok: true,
      }).catch(() => undefined);
      return result;
    }

    const llmText = prepareDocumentTextForLlm(text);

    const multi = await runMultiAgentAnalysis({
      documentText: text,
      pages: request.pages,
      fileName: request.fileName,
    });

    const classification = multi.classification;
    const analysis = multi.analysis;
    category = classification.category;
    categoryLabel = classification.label;
    model = multi.state.model || model;
    tokens = multi.state.tokens;
    steps = [...multi.state.steps];

    const skipReply =
      request.skipReadyReply === true ||
      (request.skipReadyReply !== false &&
        docmindConfig.ollama.skipReadyReplyByDefault);

    const analyzedAt = new Date().toISOString();
    const sheet = buildDocumentSheetFromAnalysis({
      documentId: request.documentId,
      fileName: request.fileName || "document.pdf",
      classification,
      analysis,
      analyzedAt,
    });

    let readyReply: ReadyReply = EMPTY_READY_REPLY;
    let replyGeneration: OllamaGenerateResult | null = null;

    if (!skipReply) {
      const canLetter = await hasEntitlement(request.userId, "letter_agent", {
        reconcile: true,
      });
      if (!canLetter) {
        steps.push({
          task: "reply",
          model,
          durationMs: 0,
          tokens: emptyTokens(),
          ok: true,
          error: "Courrier ignoré — plan payant requis.",
        });
      } else {
        try {
          const replyBundle = await generateReadyReplyWithMeta({
            documentText: llmText,
            analysis,
            classification,
            sheet,
            letterType: "auto",
          });
          readyReply = replyBundle.readyReply;
          replyGeneration = replyBundle.generation;
        } catch (replyError) {
          steps.push({
            task: "reply",
            model,
            durationMs: 0,
            tokens: emptyTokens(),
            ok: false,
            error: `${
              replyError instanceof Error
                ? replyError.message
                : "Échec courrier"
            } — analyse conservée.`,
          });
        }
      }
    }

    if (replyGeneration) {
      tokens = addTokens(tokens, replyGeneration);
      steps.push({
        task: "reply",
        model: replyGeneration.model,
        durationMs: replyGeneration.durationMs,
        tokens: {
          prompt: replyGeneration.promptTokens,
          completion: replyGeneration.completionTokens,
          total: replyGeneration.totalTokens,
        },
        ok: true,
      });
    }

    const durationMs = Date.now() - started;
    assertPublishableLlmAnalysis({
      resultSource: "agents",
      totalTokens: tokens.total,
      summary: analysis.summary,
    });

    const result: AnalyzeDocumentResult = {
      documentId: request.documentId,
      classification,
      analysis,
      readyReply,
      model,
      analyzedAt,
      promptsUsed,
      sheet,
      resultSource: "agents",
      durationMs,
      totalTokens: tokens.total,
    };

    await setCachedAnalysis({
      userId: request.userId,
      text,
      fingerprint: buildCacheFingerprint({
        model,
        promptsUsed,
        pipelineVersion: ANALYSIS_PIPELINE_VERSION,
      }),
      model,
      classification,
      analysis,
      readyReply,
    });

    await appendAnalysisLog(request.userId, {
      documentId: request.documentId,
      fileName: request.fileName,
      category: classification.category,
      categoryLabel: classification.label,
      model,
      promptsUsed,
      durationMs,
      tokens,
      steps,
      result: {
        title: analysis.title,
        documentType: analysis.document_type,
        riskScore: analysis.risk_score,
        riskLevel: analysis.risk_level,
        summary: analysis.summary.slice(0, 500),
        replyRequired: readyReply.required,
        actionCount: analysis.actions.length,
        deadlineCount: analysis.deadlines.length,
      },
      ok: true,
    }).catch(() => undefined);

    return result;
  } catch (error) {
    if (error instanceof AppError && error.code === "BAD_REQUEST") {
      throw error;
    }
    if (error instanceof AppError && error.code === "ANALYSIS_IN_PROGRESS") {
      throw error;
    }

    const message = sanitizeAnalysisFailureMessage(
      error instanceof Error ? error.message : "Erreur d'analyse inconnue",
    );
    const errorCode =
      error instanceof AppError ? error.code : "ANALYSIS_FAILED";

    steps.push({
      task: "analyze",
      model,
      durationMs: Date.now() - started,
      tokens: emptyTokens(),
      ok: false,
      error: message,
    });

    await appendAnalysisLog(request.userId, {
      documentId: request.documentId,
      fileName: request.fileName,
      category,
      categoryLabel,
      model,
      promptsUsed,
      durationMs: Date.now() - started,
      tokens,
      steps,
      result: null,
      ok: false,
      errorCode,
      errorMessage: message,
    }).catch(() => undefined);

    // Beta contract: never return a silent local salvage as a successful LLM analysis.
    if (error instanceof AppError) {
      throw new AppError(error.code, message, error.status);
    }
    throw new AppError(
      "ANALYSIS_FAILED",
      message,
      502,
    );
  }
}
