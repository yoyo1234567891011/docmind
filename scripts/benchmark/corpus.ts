import { access, readFile, readdir } from "fs/promises";
import path from "path";

import type { ExpectedAnalysis } from "../../src/types/eval";

import type { BenchmarkDoc, BenchmarkSuiteId } from "./types";

const ROOT = process.cwd();
const TEST_DIR = path.join(ROOT, "test-documents");

const SUITE_CATEGORIES: Record<BenchmarkSuiteId, string[]> = {
  contrat: [
    "assurances",
    "baux-de-location",
    "conditions-generales-de-vente",
    "contrats-de-pret",
    "contrats-de-travail",
    "contrats-internet",
    "contrats-telephoniques",
    "mutuelles",
  ],
  facture: [
    "factures-edf",
    "factures-free",
    "factures-orange",
    "factures-sfr",
    "devis",
  ],
  courrier: [
    "courriers-administratifs",
    "relances-de-paiement",
    "caf",
    "impots",
  ],
  /** Docs riches en montants/dates pour stress extraction / OCR. */
  ocr: [
    "factures-edf",
    "factures-sfr",
    "banques",
    "impots",
    "devis",
  ],
};

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
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) {
      if (entry.name === "real-anonymized") continue;
      files.push(...(await walkPdfs(full)));
      continue;
    }
    if (entry.name.toLowerCase().endsWith(".pdf")) files.push(full);
  }
  return files.sort((a, b) => a.localeCompare(b, "fr"));
}

function suitesForCategory(category: string): BenchmarkSuiteId[] {
  const suites: BenchmarkSuiteId[] = [];
  for (const [suite, cats] of Object.entries(SUITE_CATEGORIES) as Array<
    [BenchmarkSuiteId, string[]]
  >) {
    if (cats.includes(category)) suites.push(suite);
  }
  return suites;
}

export async function loadBenchmarkCorpus(options?: {
  limitPerSuite?: number;
  suites?: BenchmarkSuiteId[];
}): Promise<BenchmarkDoc[]> {
  const want = new Set<BenchmarkSuiteId>(
    options?.suites ?? ["contrat", "facture", "courrier", "ocr"],
  );
  const limit = options?.limitPerSuite ?? 2;
  const pdfs = await walkPdfs(TEST_DIR);
  const bySuite = new Map<BenchmarkSuiteId, number>();
  const docs: BenchmarkDoc[] = [];

  for (const pdfPath of pdfs) {
    const relativePath = path
      .relative(TEST_DIR, pdfPath)
      .replace(/\\/g, "/");
    const category = relativePath.split("/")[0] ?? "unknown";
    const suites = suitesForCategory(category).filter((s) => want.has(s));
    if (suites.length === 0) continue;

    // Respect limit for the primary suite of the doc
    const primary = suites[0];
    const count = bySuite.get(primary) ?? 0;
    if (count >= limit) continue;

    const parsed = path.parse(pdfPath);
    const expectedPath = path.join(parsed.dir, `${parsed.name}_expected.json`);
    if (!(await exists(expectedPath))) continue;

    const expected = JSON.parse(
      await readFile(expectedPath, "utf8"),
    ) as ExpectedAnalysis;

    const mdPath = path.join(parsed.dir, `${parsed.name}.md`);
    docs.push({
      pdfPath,
      relativePath,
      category,
      fileName: path.basename(pdfPath),
      expectedPath,
      expected,
      suites,
      markdownPath: (await exists(mdPath)) ? mdPath : undefined,
    });
    bySuite.set(primary, count + 1);
  }

  return docs;
}

export function suiteLabel(suite: BenchmarkSuiteId): string {
  switch (suite) {
    case "contrat":
      return "Analyse contrat";
    case "facture":
      return "Analyse facture";
    case "courrier":
      return "Analyse courrier";
    case "ocr":
      return "OCR / extraction";
    default:
      return suite;
  }
}
