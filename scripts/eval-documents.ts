import { randomUUID } from "crypto";
import { readFile, readdir, access } from "fs/promises";
import path from "path";
import { pathToFileURL } from "url";

import { extractText } from "unpdf";

import { analyzeDocumentText } from "../src/ai/pipelines";
import type { DocumentEvalResult, ExpectedAnalysis } from "../src/types/eval";
import {
  averageScore,
  compareAnalysis,
  ensureEmbeddingModel,
  toPredictedShape,
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
  skipReply: boolean;
  only?: string;
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
  const options: CliOptions = { skipReply: true };

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
    } else if (arg === "--with-reply") {
      options.skipReply = false;
    }
  }

  return options;
}

async function walkDocuments(dir: string): Promise<string[]> {
  const entries = await readdir(dir, { withFileTypes: true });
  const files: string[] = [];

  for (const entry of entries) {
    const fullPath = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      files.push(...(await walkDocuments(fullPath)));
      continue;
    }

    const lower = entry.name.toLowerCase();
    if (lower === "readme.md") continue;
    if (lower.endsWith("_expected.json")) continue;
    if (lower.endsWith(".replacements.json")) continue;
    if (lower.endsWith(".pdf") || lower.endsWith(".md")) {
      files.push(fullPath);
    }
  }

  return files.sort((a, b) => a.localeCompare(b, "fr"));
}

async function exists(filePath: string): Promise<boolean> {
  try {
    await access(filePath);
    return true;
  } catch {
    return false;
  }
}

function expectedPathFor(documentPath: string): string {
  const parsed = path.parse(documentPath);
  return path.join(parsed.dir, `${parsed.name}_expected.json`);
}

async function readDocumentText(documentPath: string): Promise<string> {
  if (documentPath.toLowerCase().endsWith(".pdf")) {
    const bytes = new Uint8Array(await readFile(documentPath));
    const result = await extractText(bytes, { mergePages: true });
    return result.text.trim();
  }

  const markdown = await readFile(documentPath, "utf8");
  return markdown
    .replace(/^---[\s\S]*?---\s*$/gm, "")
    .replace(/^\*.*Document fictif.*\*$/gim, "")
    .trim();
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

  const base: Omit<DocumentEvalResult, "success" | "score" | "fields" | "durationMs"> = {
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

    const text = await readDocumentText(documentPath);
    if (!text) {
      throw new Error("Document vide ou texte non extractible");
    }

    const expected = JSON.parse(
      await readFile(expectedPath, "utf8"),
    ) as ExpectedAnalysis;

    const result = await analyzeDocumentText({
      userId: "eval-runner",
      documentId: randomUUID(),
      text,
      fileName,
      skipReadyReply: options.skipReply,
    });

    const predicted = toPredictedShape(result.analysis);
    const fields = await compareAnalysis(expected, predicted);
    const score = averageScore(fields);

    return {
      ...base,
      success: true,
      score,
      fields,
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

  let documents = await walkDocuments(TEST_DIR);

  if (options.category) {
    documents = documents.filter((filePath) =>
      path.relative(TEST_DIR, filePath).replace(/\\/g, "/").startsWith(
        `${options.category}/`,
      ),
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
    documents = documents.filter((filePath) =>
      filePath.toLowerCase().includes(options.only!.toLowerCase()),
    );
  }

  // Prefer PDF when both PDF and MD exist for same stem.
  const byStem = new Map<string, string>();
  for (const filePath of documents) {
    const parsed = path.parse(filePath);
    const key = path.join(parsed.dir, parsed.name);
    const existing = byStem.get(key);
    if (!existing) {
      byStem.set(key, filePath);
      continue;
    }
    if (filePath.toLowerCase().endsWith(".pdf")) {
      byStem.set(key, filePath);
    }
  }
  documents = [...byStem.values()].sort((a, b) => a.localeCompare(b, "fr"));

  if (options.limit && options.limit > 0) {
    documents = documents.slice(0, options.limit);
  }

  if (documents.length === 0) {
    console.error("Aucun document de test trouvé dans /test-documents");
    process.exit(1);
  }

  console.log(`Évaluation de ${documents.length} document(s)...`);
  console.log(
    `Ollama: ${process.env.OLLAMA_BASE_URL ?? "http://127.0.0.1:11434"} · modèle: ${process.env.OLLAMA_MODEL ?? "qwen3"}`,
  );
  console.log(
    `Similarité sémantique: ${process.env.OLLAMA_EMBED_MODEL ?? "nomic-embed-text"} (summary, important_points, risks, actions)`,
  );
  console.log(
    options.skipReply
      ? "Mode rapide: génération de réponse désactivée (--with-reply pour l'activer)"
      : "Mode complet: réponse prête à envoyer incluse",
  );

  await ensureEmbeddingModel();

  const results: DocumentEvalResult[] = [];

  for (let index = 0; index < documents.length; index += 1) {
    const documentPath = documents[index];
    const label = path.relative(TEST_DIR, documentPath).replace(/\\/g, "/");
    process.stdout.write(`[${index + 1}/${documents.length}] ${label} ... `);

    const result = await evaluateDocument(documentPath, options);
    results.push(result);

    if (result.success) {
      console.log(`${(result.score * 100).toFixed(1)}% (${(result.durationMs / 1000).toFixed(1)}s)`);
    } else {
      console.log(`ÉCHEC — ${result.error}`);
    }
  }

  const stamp = new Date().toISOString().replace(/[:.]/g, "-");
  const reportPath = path.join(REPORT_DIR, `eval-report-${stamp}.html`);
  const latestPath = path.join(REPORT_DIR, "eval-report-latest.html");

  await writeHtmlReport(results, reportPath);
  await writeHtmlReport(results, latestPath);

  const successful = results.filter((result) => result.success);
  const globalScore =
    successful.length === 0
      ? 0
      : successful.reduce((sum, result) => sum + result.score, 0) /
        successful.length;

  console.log("\n=== Résumé ===");
  console.log(`Documents évalués : ${results.length}`);
  console.log(`Analyses réussies : ${successful.length}`);
  console.log(`Score global      : ${(globalScore * 100).toFixed(1)}%`);
  console.log(`Rapport HTML      : ${reportPath}`);
  console.log(`Raccourci         : ${latestPath}`);
  console.log(`Ouvrir            : ${pathToFileURL(latestPath).href}`);
}

main().catch((error) => {
  console.error(error);
  process.exit(1);
});
