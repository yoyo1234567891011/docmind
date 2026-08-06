import { randomUUID } from "crypto";
import { access, readFile, readdir } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

import type {
  DocumentEvalResult,
  EvalField,
  ExpectedAnalysis,
} from "../src/types/eval";
import { AGENT_EVAL_STEPS, EVAL_FIELDS } from "../src/types/eval";
import type { AnalyzeDocumentResult } from "../src/types/analysis";
import type { UploadPdfResult } from "../src/types";
import {
  averageAgentScore,
  averageAgentScoresById,
  averageScore,
  compareAnalysis,
  ensureEmbeddingModel,
  scoreAgents,
  toPredictedShape,
  writeAgentHtmlReport,
  writeHtmlReport,
} from "../src/ai/evaluator";

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, "test-documents");
const REPORT_DIR = path.join(ROOT, "reports");

interface CliOptions {
  limit?: number;
  category?: string;
  /** real | synthetic | all */
  corpus?: "real" | "synthetic" | "all";
  only?: string;
  withReply: boolean;
  baseUrl: string;
}

interface ApiEnvelope<T> {
  success: boolean;
  data?: T;
  error?: { code?: string; message?: string };
}

function loadEnvFile(content: string) {
  for (const line of content.split(/\r?\n/)) {
    const trimmed = line.trim();
    if (!trimmed || trimmed.startsWith("#")) continue;
    const index = trimmed.indexOf("=");
    if (index === -1) continue;
    const key = trimmed.slice(0, index).trim();
    const value = trimmed.slice(index + 1).trim();
    if (!process.env[key]) {
      process.env[key] = value;
    }
  }
}

async function loadEnv() {
  for (const fileName of [".env.local", ".env"]) {
    try {
      const content = await readFile(path.join(ROOT, fileName), "utf8");
      loadEnvFile(content);
    } catch {
      // optional
    }
  }
}

function parseArgs(argv: string[]): CliOptions {
  const options: CliOptions = {
    withReply: false,
    // Prefer 127.0.0.1 on Windows — `localhost` can resolve to ::1 and fail.
    baseUrl:
      process.env.EVAL_BASE_URL?.replace(/\/$/, "") || "http://127.0.0.1:3000",
  };

  for (let i = 0; i < argv.length; i += 1) {
    const arg = argv[i];
    if (arg === "--limit") {
      options.limit = Number(argv[i + 1]);
      i += 1;
    } else if (arg === "--category") {
      options.category = argv[i + 1];
      i += 1;
    } else if (arg === "--corpus") {
      const value = (argv[i + 1] || "all").toLowerCase();
      if (value !== "real" && value !== "synthetic" && value !== "all") {
        throw new Error("--corpus attendu: real | synthetic | all");
      }
      options.corpus = value;
      i += 1;
    } else if (arg === "--only") {
      options.only = argv[i + 1];
      i += 1;
    } else if (arg === "--base-url") {
      options.baseUrl = (argv[i + 1] || options.baseUrl).replace(/\/$/, "");
      i += 1;
    } else if (arg === "--with-reply") {
      options.withReply = true;
    }
  }

  return options;
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

async function walkPdfs(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkPdfs(fullPath)));
      continue;
    }
    if (entry.name.toLowerCase().endsWith(".pdf")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b, "fr"));
}

function expectedPathFor(documentPath: string): string {
  const parsed = path.parse(documentPath);
  return path.join(parsed.dir, `${parsed.name}_expected.json`);
}

async function ensureServer(baseUrl: string): Promise<void> {
  try {
    // Any HTTP response means the process is up (page errors are OK).
    await fetch(baseUrl, { method: "GET" });
  } catch (error) {
    const detail = error instanceof Error ? error.message : "erreur réseau";
    throw new Error(
      `Serveur DocMind inaccessible sur ${baseUrl} (${detail}).\n` +
        `Lancez d'abord: npm run dev\n` +
        `Ou définissez EVAL_BASE_URL / --base-url`,
    );
  }
}

async function parseApiJson<T>(response: Response): Promise<T> {
  const raw = await response.text();
  let payload: ApiEnvelope<T>;

  try {
    payload = JSON.parse(raw) as ApiEnvelope<T>;
  } catch {
    throw new Error(
      `Réponse non-JSON (HTTP ${response.status}): ${raw.slice(0, 200)}`,
    );
  }

  if (!response.ok || !payload.success || payload.data === undefined) {
    const message =
      payload.error?.message ||
      `Requête API échouée (HTTP ${response.status})`;
    throw new Error(message);
  }
  return payload.data;
}

function evalHeaders(extra?: HeadersInit): HeadersInit {
  const headers = new Headers(extra);
  const key = process.env.EVAL_API_KEY?.trim();
  if (key) {
    headers.set("x-eval-api-key", key);
  }
  return headers;
}

function formatFetchError(error: unknown, url: string): Error {
  const err = error instanceof Error ? error : new Error(String(error));
  const cause =
    err.cause instanceof Error
      ? err.cause.message
      : typeof err.cause === "string"
        ? err.cause
        : "";
  return new Error(
    `fetch failed (${url})${cause ? `: ${cause}` : `: ${err.message}`}`,
  );
}

async function fetchWithRetry(
  url: string,
  init: RequestInit,
  retries = 2,
): Promise<Response> {
  let lastError: unknown;
  for (let attempt = 0; attempt <= retries; attempt += 1) {
    try {
      return await fetch(url, init);
    } catch (error) {
      lastError = error;
      if (attempt < retries) {
        await new Promise((resolve) => setTimeout(resolve, 500 * (attempt + 1)));
      }
    }
  }
  throw formatFetchError(lastError, url);
}

async function uploadPdf(
  baseUrl: string,
  pdfPath: string,
  fileName: string,
): Promise<UploadPdfResult> {
  const bytes = await readFile(pdfPath);
  const form = new FormData();
  // Blob + filename is more reliable than File() with Node undici on Windows.
  form.append(
    "file",
    new Blob([bytes], { type: "application/pdf" }),
    fileName,
  );

  const response = await fetchWithRetry(`${baseUrl}/api/upload`, {
    method: "POST",
    headers: evalHeaders(),
    body: form,
  });

  return parseApiJson<UploadPdfResult>(response);
}

async function analyzeViaApi(
  baseUrl: string,
  input: {
    documentId: string;
    text: string;
    pages?: string[];
    fileName: string;
    withReply: boolean;
  },
): Promise<AnalyzeDocumentResult> {
  const response = await fetchWithRetry(`${baseUrl}/api/analyze`, {
    method: "POST",
    headers: evalHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify({
      documentId: input.documentId,
      text: input.text,
      pages: input.pages,
      fileName: input.fileName,
      skipReadyReply: !input.withReply,
      skipHistory: true,
      mode: "full",
    }),
  });

  return parseApiJson<AnalyzeDocumentResult>(response);
}

function fieldAverages(results: DocumentEvalResult[]): Record<EvalField, number> {
  const averages = {} as Record<EvalField, number>;

  for (const field of EVAL_FIELDS) {
    const scores = results
      .filter((result) => result.success)
      .map((result) => result.fields.find((item) => item.field === field)?.score)
      .filter((score): score is number => typeof score === "number");

    averages[field] =
      scores.length === 0
        ? 0
        : scores.reduce((sum, score) => sum + score, 0) / scores.length;
  }

  return averages;
}

async function evaluateDocument(
  documentPath: string,
  options: CliOptions,
): Promise<DocumentEvalResult> {
  const relativePath = path.relative(TEST_DIR, documentPath).replace(/\\/g, "/");
  const category = relativePath.split("/")[0] ?? "unknown";
  const fileName = path.basename(documentPath);
  const expectedPath = expectedPathFor(documentPath);
  const started = Date.now();

  const base: Omit<
    DocumentEvalResult,
    "success" | "score" | "fields" | "durationMs"
  > = {
    id: randomUUID(),
    relativePath,
    category,
    fileName,
    expectedPath: path.relative(ROOT, expectedPath).replace(/\\/g, "/"),
  };

  try {
    if (!(await exists(expectedPath))) {
      throw new Error(`Fichier ground truth introuvable: ${expectedPath}`);
    }

    const expected = JSON.parse(
      await readFile(expectedPath, "utf8"),
    ) as ExpectedAnalysis;

    process.stdout.write("upload… ");
    const upload = await uploadPdf(options.baseUrl, documentPath, fileName);
    const text = upload.extraction.text?.trim() ?? "";
    if (!text) {
      throw new Error("Texte vide après /api/upload (extraction PDF)");
    }

    process.stdout.write("analyse Ollama (peut prendre plusieurs minutes)… ");
    const result = await analyzeViaApi(options.baseUrl, {
      documentId: upload.document.id,
      text,
      pages: upload.extraction.pages,
      fileName,
      withReply: options.withReply,
    });

    process.stdout.write("comparaison… ");
    const predicted = toPredictedShape(result.analysis);
    const fields = await compareAnalysis(expected, predicted);
    const score = averageScore(fields);
    const agents = scoreAgents({
      fields,
      analysis: result.analysis,
      classification: result.classification,
    });
    const agentScore = averageAgentScore(agents);

    return {
      ...base,
      success: true,
      score,
      fields,
      agents,
      agentScore,
      durationMs: Date.now() - started,
      promptsUsed: result.promptsUsed,
    };
  } catch (error) {
    return {
      ...base,
      success: false,
      score: 0,
      fields: [],
      durationMs: Date.now() - started,
      error: error instanceof Error ? error.message : "Erreur inconnue",
    };
  }
}

async function main() {
  await loadEnv();
  const options = parseArgs(process.argv.slice(2));

  let documents = await walkPdfs(TEST_DIR);

  if (options.category) {
    documents = documents.filter((filePath) =>
      path
        .relative(TEST_DIR, filePath)
        .replace(/\\/g, "/")
        .startsWith(`${options.category}/`),
    );
  }

  if (options.corpus === "real") {
    documents = documents.filter((filePath) =>
      path
        .relative(TEST_DIR, filePath)
        .replace(/\\/g, "/")
        .startsWith("real-anonymized/"),
    );
  } else if (options.corpus === "synthetic") {
    documents = documents.filter(
      (filePath) =>
        !path
          .relative(TEST_DIR, filePath)
          .replace(/\\/g, "/")
          .startsWith("real-anonymized/"),
    );
  }

  if (options.only) {
    const needles = options.only
      .split(",")
      .map((part) => part.trim().toLowerCase().replace(/\\/g, "/"))
      .filter(Boolean);
    documents = documents.filter((filePath) => {
      const lower = filePath.toLowerCase().replace(/\\/g, "/");
      return needles.some((needle) => lower.includes(needle));
    });
  }

  if (options.limit && options.limit > 0) {
    documents = documents.slice(0, options.limit);
  }

  if (documents.length === 0) {
    console.error(
      "Aucun PDF trouvé dans /test-documents.\n" +
        "Générez-les avec: npm run generate:pdfs\n" +
        "Convention: document.pdf + document_expected.json",
    );
    process.exit(1);
  }

  console.log(`Évaluation HTTP de ${documents.length} PDF(s)...`);
  console.log(`API: ${options.baseUrl}`);
  console.log(
    `Similarité sémantique: ${process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text"} (summary, important_points, risks, actions)`,
  );
  console.log(
    options.withReply
      ? "Mode complet: réponse prête à envoyer incluse"
      : "Mode rapide: skipReadyReply + skipHistory",
  );

  await ensureServer(options.baseUrl);
  await ensureEmbeddingModel();

  const results: DocumentEvalResult[] = [];

  for (let index = 0; index < documents.length; index += 1) {
    const documentPath = documents[index];
    const label = path.relative(TEST_DIR, documentPath).replace(/\\/g, "/");
    process.stdout.write(`[${index + 1}/${documents.length}] ${label} ... `);

    const result = await evaluateDocument(documentPath, options);
    results.push(result);

    if (result.success) {
      const agentsBrief = (result.agents ?? [])
        .map((a) => `${a.id[0]}${Math.round(a.score * 100)}`)
        .join(" ");
      console.log(
        `${(result.score * 100).toFixed(1)}% · agents ${(
          (result.agentScore ?? 0) * 100
        ).toFixed(0)}% [${agentsBrief}] (${(result.durationMs / 1000).toFixed(1)}s)`,
      );
    } else {
      console.log(`ÉCHEC — ${result.error}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORT_DIR, `eval-report-${stamp}.html`);
  const latestPath = path.join(REPORT_DIR, "eval-report-latest.html");
  const agentReportPath = path.join(
    REPORT_DIR,
    `eval-agents-report-${stamp}.html`,
  );
  const agentLatestPath = path.join(
    REPORT_DIR,
    "eval-agents-report-latest.html",
  );
  const fieldScores = fieldAverages(results);
  const agentScores = averageAgentScoresById(results);

  await writeHtmlReport(results, reportPath, { fieldScores });
  await writeHtmlReport(results, latestPath, { fieldScores });
  await writeAgentHtmlReport(results, agentReportPath);
  await writeAgentHtmlReport(results, agentLatestPath);

  const successful = results.filter((result) => result.success);
  const globalScore =
    successful.length === 0
      ? 0
      : successful.reduce((sum, result) => sum + result.score, 0) /
        successful.length;
  const globalAgentScore =
    successful.length === 0
      ? 0
      : successful.reduce((sum, result) => sum + (result.agentScore ?? 0), 0) /
        successful.length;

  console.log("\n=== Résumé ===");
  console.log(`Documents évalués : ${results.length}`);
  console.log(`Analyses réussies : ${successful.length}`);
  console.log(`Score global      : ${(globalScore * 100).toFixed(1)}%`);
  console.log(`Score agents      : ${(globalAgentScore * 100).toFixed(1)}%`);
  console.log("\nScores par agent :");
  for (const step of AGENT_EVAL_STEPS) {
    console.log(
      `  ${step.label.padEnd(22)} ${(agentScores[step.id] * 100).toFixed(1)}%`,
    );
  }
  console.log("\nScores par champ :");
  for (const field of EVAL_FIELDS) {
    console.log(`  ${field.padEnd(18)} ${(fieldScores[field] * 100).toFixed(1)}%`);
  }
  console.log(`\nRapport champs    : ${reportPath}`);
  console.log(`Rapport agents    : ${agentReportPath}`);
  console.log(`Raccourci agents  : ${agentLatestPath}`);
  console.log(`Ouvrir            : ${pathToFileURL(agentLatestPath).href}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
