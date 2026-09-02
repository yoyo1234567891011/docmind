/**
 * Contrat beta analyse LLM — timeout / abort / JSON / schéma / salvage.
 * Aucun appel Ollama réel.
 */
import assert from "node:assert/strict";

import {
  assertPublishableLlmAnalysis,
  evaluateCoreBundleGeneration,
  isLlmAnalysisSuccess,
  isSalvageAnalysisSummary,
  throwOnFailedCoreBundle,
} from "../src/ai/agents/core-bundle-outcome";
import { AppError } from "../src/lib/errors";
import type { OllamaGenerateResult } from "../src/ai/models/types";
import { EMPTY_READY_REPLY } from "../src/types";

function fakeGeneration(text: string): OllamaGenerateResult {
  return {
    text,
    model: "mistral",
    promptTokens: 10,
    completionTokens: 20,
    totalTokens: 30,
    durationMs: 100,
  };
}

async function main() {
  {
    const o = evaluateCoreBundleGeneration({
      generation: null,
      error: "Ollama n'a pas répondu sous 270s (requête annulée).",
    });
    assert.equal(o.ok, false);
    if (!o.ok) {
      assert.equal(o.code, "GENERATE_FAILED");
      assert.equal(o.appCode, "OLLAMA_UNAVAILABLE");
      assert.equal(o.httpStatus, 504);
    }
    assert.throws(
      () => throwOnFailedCoreBundle(o),
      (e: unknown) =>
        e instanceof AppError &&
        e.code === "OLLAMA_UNAVAILABLE" &&
        e.status === 504,
    );
    console.log("OK 1) timeout / abort → OLLAMA_UNAVAILABLE 504");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: null,
      error: "Ollama a renvoyé une erreur (500).",
    });
    assert.equal(o.ok, false);
    if (!o.ok) {
      assert.equal(o.code, "GENERATE_FAILED");
      assert.equal(o.httpStatus, 502);
    }
    console.log("OK 2) HTTP / generate error → GENERATE_FAILED 502");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: null,
      error: "AbortError: The operation was aborted",
    });
    assert.equal(o.ok, false);
    if (!o.ok) {
      assert.equal(o.code, "GENERATE_FAILED");
      assert.equal(o.appCode, "OLLAMA_UNAVAILABLE");
      assert.equal(o.httpStatus, 504);
    }
    console.log("OK 2b) AbortError → OLLAMA_UNAVAILABLE 504");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: fakeGeneration("   "),
    });
    assert.equal(o.ok, false);
    if (!o.ok) {
      assert.equal(o.code, "GENERATE_FAILED");
      assert.equal(o.appCode, "OLLAMA_UNAVAILABLE");
    }
    console.log("OK 2c) réponse vide → GENERATE_FAILED");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: {
        ...fakeGeneration("{not-json"),
        finishReason: "length",
      },
    });
    assert.equal(o.ok, false);
    if (!o.ok) {
      assert.equal(o.code, "INVALID_JSON");
      assert.match(o.message, /tronqué/i);
    }
    console.log("OK 3b) JSON tronqué (length) → INVALID_JSON retryable");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: fakeGeneration("{not-json"),
    });
    assert.equal(o.ok, false);
    if (!o.ok) {
      assert.equal(o.code, "INVALID_JSON");
      assert.equal(o.appCode, "ANALYSIS_FAILED");
    }
    assert.throws(
      () => throwOnFailedCoreBundle(o),
      (e: unknown) =>
        e instanceof AppError && e.code === "ANALYSIS_FAILED",
    );
    console.log("OK 3) JSON invalide → ANALYSIS_FAILED");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: fakeGeneration(
        JSON.stringify({ document_type: "", title: "", summary: "" }),
      ),
    });
    assert.equal(o.ok, false);
    if (!o.ok) assert.equal(o.code, "INVALID_SCHEMA");
    console.log("OK 4) schéma vide → INVALID_SCHEMA");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: fakeGeneration(
        JSON.stringify({
          risks: ["Frais de résiliation élevés sans préavis"],
        }),
      ),
    });
    assert.equal(o.ok, true);
    console.log("OK 4b) risks seuls → schéma valide");
  }

  {
    const o = evaluateCoreBundleGeneration({
      generation: fakeGeneration(
        JSON.stringify({
          document_type: "Assurance",
          title: "Police",
          summary:
            "Garantie habitation avec franchise et cotisation mensuelle.",
          important_points: [
            { statement: "Tacite reconduction", excerpt: "renouvellement automatique" },
          ],
          risk_findings: [],
          risks: [],
          actions: [],
        }),
      ),
    });
    assert.equal(o.ok, true);
    throwOnFailedCoreBundle(o);
    console.log("OK 5) bundle valide → ok");
  }

  {
    assert.equal(isLlmAnalysisSuccess("agents"), true);
    assert.equal(isLlmAnalysisSuccess("cache"), true);
    assert.equal(isLlmAnalysisSuccess("salvage"), false);
    assert.equal(isLlmAnalysisSuccess(undefined), false);
    console.log("OK 6) salvage ≠ succès LLM");
  }

  {
    assert.equal(
      isSalvageAnalysisSummary(
        "Analyse de secours (extraction locale). Relancer si besoin.",
      ),
      true,
    );
    assert.throws(
      () =>
        assertPublishableLlmAnalysis({
          resultSource: "agents",
          totalTokens: 0,
          summary: "Analyse de secours (extraction locale). Relancer si besoin.",
        }),
      (e: unknown) => e instanceof AppError && e.code === "ANALYSIS_FAILED",
    );
    assert.throws(
      () =>
        assertPublishableLlmAnalysis({
          resultSource: "agents",
          totalTokens: 0,
          generateMs: 0,
          summary: "Résumé riche sans LLM",
        }),
      (e: unknown) => e instanceof AppError && e.code === "ANALYSIS_FAILED",
    );
    assert.throws(
      () =>
        assertPublishableLlmAnalysis({
          resultSource: "agents",
          totalTokens: 0,
          generateMs: 0,
          summary: "Analyse multi-agents incomplète — champs partiels conservés.",
        }),
      (e: unknown) => e instanceof AppError && e.code === "ANALYSIS_FAILED",
    );
    assert.doesNotThrow(() =>
      assertPublishableLlmAnalysis({
        resultSource: "agents",
        totalTokens: 120,
        summary:
          "Analyse multi-agents incomplète — champs partiels conservés.",
      }),
    );
    assert.throws(
      () =>
        assertPublishableLlmAnalysis({
          resultSource: "agents",
          totalTokens: 120,
          summary: "Analyse de secours (fallback local).",
        }),
      (e: unknown) => e instanceof AppError && e.code === "ANALYSIS_FAILED",
    );
    assert.doesNotThrow(() =>
      assertPublishableLlmAnalysis({
        resultSource: "agents",
        totalTokens: 120,
        summary: "Le bail prévoit un loyer de 1 050 €.",
      }),
    );
    console.log("OK 6b) assertPublishableLlmAnalysis bloque faux succès");
  }

  // Worker : salvage / throw → job failed, pas completed
  process.env.DOCMIND_STORAGE = "fs";
  process.env.DOCMIND_FS_FALLBACK = "0";

  const {
    __resetAnalysisJobsFsForTests,
    enqueueAnalysisJob,
    getAnalysisJob,
    processOneAnalysisJob,
  } = await import("../src/services/analysis-jobs");
  const { saveHistoryRecord } = await import("../src/services/history/store");
  const { getHistoryRecord } = await import("../src/services/history/store");

  await __resetAnalysisJobsFsForTests();

  {
    const history = await saveHistoryRecord("u-contract", {
      result: {
        documentId: "doc-salvage",
        classification: {
          category: "assurance",
          label: "Assurance",
          confidence: 0.9,
        },
        analysis: {
          document_type: "Assurance",
          title: "preview",
          summary: "preview",
          date: "",
          dates: [],
          people: [],
          organizations: [],
          amounts: [],
          deadlines: [],
          important_points: [],
          risks: [],
          actions: [],
          risk_score: 0,
          risk_level: "faible",
          risk_explanation: "",
          risk_criteria: [],
        },
        readyReply: { ...EMPTY_READY_REPLY },
        model: "mistral",
        analyzedAt: new Date().toISOString(),
        promptsUsed: [],
        phase: "preview",
      },
      fileName: "a.pdf",
      extractedText: "Contrat assurance 100 euros échéance 01/01/2027",
    });

    const job = await enqueueAnalysisJob({
      userId: "u-contract",
      documentId: "doc-salvage",
      historyId: history.id,
      fileName: "a.pdf",
    });

    await processOneAnalysisJob({
      runP2: async () => {
        // Simule un analyzeDocumentText qui aurait encore renvoyé salvage
        const { isLlmAnalysisSuccess } = await import(
          "../src/ai/agents/core-bundle-outcome"
        );
        const full = {
          resultSource: "salvage" as const,
          analysis: {
            document_type: "Assurance",
            title: "x",
            summary: "Analyse de secours (extraction locale).",
            date: "",
            dates: [],
            people: [],
            organizations: [],
            amounts: ["100 euros"],
            deadlines: [],
            important_points: [],
            risks: [],
            actions: [],
            risk_score: 0,
            risk_level: "faible" as const,
            risk_explanation: "",
            risk_criteria: [],
          },
          classification: {
            category: "assurance" as const,
            label: "Assurance",
            confidence: 0.9,
          },
          readyReply: { ...EMPTY_READY_REPLY },
          model: "mistral",
          analyzedAt: new Date().toISOString(),
          promptsUsed: [],
          documentId: "doc-salvage",
        };
        assert.equal(isLlmAnalysisSuccess(full.resultSource), false);
        // Rejoue la garde worker (même logique que defaultRunP2)
        const { updateHistoryRecord } = await import(
          "../src/services/history/store"
        );
        const { AppError: AE } = await import("../src/lib/errors");
        await updateHistoryRecord("u-contract", history.id, {
          analysis: full.analysis,
          classification: full.classification,
          analysisPhase: "failed",
        });
        throw new AE(
          "ANALYSIS_FAILED",
          "Analyse LLM indisponible — fallback local explicite (non publié comme succès).",
          502,
        );
      },
    });

    const done = await getAnalysisJob(job.id);
    assert.equal(done!.status, "failed");
    const rec = await getHistoryRecord("u-contract", history.id);
    assert.equal(rec.analysisPhase, "failed");
    assert.match(rec.analysis?.summary ?? "", /secours|fallback|local/i);
    assert.equal(rec.memorySyncedAt == null || rec.relationsPhase !== "ready", true);
    console.log("OK 7) salvage → job failed + history failed (pas succès LLM)");
  }

  await __resetAnalysisJobsFsForTests();
  {
    const history = await saveHistoryRecord("u-contract2", {
      result: {
        documentId: "doc-timeout",
        classification: {
          category: "autre",
          label: "Autre",
          confidence: 0,
        },
        analysis: {
          document_type: "Document",
          title: "preview",
          summary: "preview",
          date: "",
          dates: [],
          people: [],
          organizations: [],
          amounts: [],
          deadlines: [],
          important_points: [],
          risks: [],
          actions: [],
          risk_score: 0,
          risk_level: "faible",
          risk_explanation: "",
          risk_criteria: [],
        },
        readyReply: { ...EMPTY_READY_REPLY },
        model: "mistral",
        analyzedAt: new Date().toISOString(),
        promptsUsed: [],
        phase: "preview",
      },
      fileName: "b.pdf",
      extractedText: "texte",
    });
    const job = await enqueueAnalysisJob({
      userId: "u-contract2",
      documentId: "doc-timeout",
      historyId: history.id,
      fileName: "b.pdf",
    });
    await processOneAnalysisJob({
      runP2: async () => {
        throw new AppError(
          "OLLAMA_UNAVAILABLE",
          "Ollama n'a pas répondu sous 270s (requête annulée).",
          504,
        );
      },
    });
    const done = await getAnalysisJob(job.id);
    assert.equal(done!.status, "failed");
    const rec = await getHistoryRecord("u-contract2", history.id);
    assert.equal(rec.analysisPhase, "failed");
    console.log("OK 8) exception Ollama timeout → job+history failed");
  }

  console.log("\nALL analysis LLM contract tests passed.");
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
