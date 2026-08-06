import { readFile } from "fs/promises";
import path from "path";

import type { AnalyzeDocumentResult } from "../../../src/types/analysis";
import type { UploadPdfResult } from "../../../src/types";
import { toPredictedShape } from "../../../src/ai/evaluator";

import { emptyPrediction } from "../prompt";
import type { BenchmarkDoc, ProviderPrediction } from "../types";

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { message?: string };
}

function evalHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra);
  const key = process.env.EVAL_API_KEY?.trim();
  if (key) headers.set("x-eval-api-key", key);
  return headers;
}

async function parseApiJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: ApiEnvelope<T>;
  try {
    payload = JSON.parse(raw) as ApiEnvelope<T>;
  } catch {
    throw new Error(`Réponse non-JSON (${response.status}): ${raw.slice(0, 180)}`);
  }
  if (!response.ok || !payload.success || payload.data === undefined) {
    throw new Error(payload.error?.message || `HTTP ${response.status}`);
  }
  return payload.data;
}

export async function runDocmind(
  doc: BenchmarkDoc,
  baseUrl: string,
): Promise<{
  prediction: ProviderPrediction;
  sourceText: string;
  pages?: string[];
}> {
  const started = Date.now();
  let sourceText = "";
  let pages: string[] | undefined;
  try {
    const bytes = await readFile(doc.pdfPath);
    const form = new FormData();
    form.append(
      "file",
      new Blob([bytes], { type: "application/pdf" }),
      doc.fileName,
    );
    const uploadRes = await fetch(`${baseUrl}/api/upload`, {
      method: "POST",
      headers: evalHeaders(),
      body: form,
    });
    const upload = await parseApiJson<UploadPdfResult>(uploadRes);
    sourceText = upload.extraction.text?.trim() ?? "";
    pages = upload.extraction.pages;
    if (!sourceText) throw new Error("Texte vide après extraction DocMind");

    const analyzeRes = await fetch(`${baseUrl}/api/analyze`, {
      method: "POST",
      headers: evalHeaders({ "Content-Type": "application/json" }),
      body: JSON.stringify({
        documentId: upload.document.id,
        text: sourceText,
        pages,
        fileName: doc.fileName,
        skipReadyReply: true,
        skipHistory: true,
        mode: "full",
      }),
    });
    const result = await parseApiJson<AnalyzeDocumentResult>(analyzeRes);
    const predicted = toPredictedShape(result.analysis);
    const citations = (result.analysis.risk_findings ?? [])
      .map((f) => f.citation?.excerpt)
      .filter((e): e is string => typeof e === "string" && e.length >= 8)
      .slice(0, 20)
      .map((excerpt) => ({ excerpt }));

    const important = (result.analysis.important_point_findings ?? [])
      .map((f) => f.citation.excerpt)
      .filter((e) => typeof e === "string" && e.length >= 8)
      .map((excerpt) => ({ excerpt }));

    return {
      sourceText,
      pages,
      prediction: {
        provider: "docmind",
        predicted,
        citations: [...citations, ...important],
        durationMs: Date.now() - started,
        model: result.model || "docmind-local",
        inputMode: "pdf",
      },
    };
  } catch (error) {
    return {
      sourceText,
      pages,
      prediction: {
        provider: "docmind",
        predicted: emptyPrediction(),
        durationMs: Date.now() - started,
        model: "docmind-local",
        inputMode: "pdf",
        error: error instanceof Error ? error.message : String(error),
      },
    };
  }
}

export function docmindLabel(): string {
  return "DocMind (Ollama local)";
}

export function resolveDocmindBaseUrl(): string {
  return (
    process.env.EVAL_BASE_URL?.replace(/\/$/, "") ||
    process.env.BENCHMARK_BASE_URL?.replace(/\/$/, "") ||
    "http://127.0.0.1:3000"
  );
}

export async function ensureDocmindUp(baseUrl: string): Promise<void> {
  try {
    await fetch(baseUrl, { method: "GET" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "réseau";
    throw new Error(
      `DocMind inaccessible sur ${baseUrl} (${detail}). Lancez npm run dev`,
    );
  }
}

export function cacheKey(doc: BenchmarkDoc): string {
  return doc.relativePath.replace(/[\\/]/g, "__");
}

export function providerCachePath(
  runDir: string,
  provider: string,
  doc: BenchmarkDoc,
): string {
  return path.join(runDir, "raw", provider, `${cacheKey(doc)}.json`);
}
