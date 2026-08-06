import type { ExpectedAnalysis, FieldComparison } from "../../src/types/eval";

export type BenchmarkProviderId =
  | "docmind"
  | "chatgpt"
  | "claude"
  | "gemini"
  | "mistral";

export type BenchmarkSuiteId = "contrat" | "facture" | "courrier" | "ocr";

export interface BenchmarkDoc {
  pdfPath: string;
  relativePath: string;
  category: string;
  fileName: string;
  expectedPath: string;
  expected: ExpectedAnalysis;
  suites: BenchmarkSuiteId[];
  /** Texte source MD si présent (aide OCR / fallback). */
  markdownPath?: string;
}

export interface ProviderPrediction {
  provider: BenchmarkProviderId;
  predicted: ExpectedAnalysis;
  /** Extraits cités optionnels (page/§/excerpt). */
  citations?: Array<{ excerpt: string; page?: number }>;
  durationMs: number;
  model: string;
  inputMode: "pdf" | "text";
  rawPath?: string;
  error?: string;
}

export interface DocProviderScore {
  provider: BenchmarkProviderId;
  relativePath: string;
  suites: BenchmarkSuiteId[];
  quality: number;
  hallucinationRate: number;
  citationRate: number;
  ocrRecall: number;
  durationMs: number;
  model: string;
  inputMode: "pdf" | "text";
  fields: FieldComparison[];
  error?: string;
}

export interface ProviderAggregate {
  provider: BenchmarkProviderId;
  label: string;
  enabled: boolean;
  skipReason?: string;
  model: string;
  docs: number;
  quality: number;
  hallucinationRate: number;
  citationRate: number;
  ocrRecall: number;
  avgDurationMs: number;
  bySuite: Record<
    BenchmarkSuiteId,
    { quality: number; docs: number }
  >;
}

export interface BenchmarkRunResult {
  at: string;
  runId: string;
  docs: BenchmarkDoc[];
  scores: DocProviderScore[];
  aggregates: ProviderAggregate[];
  differencesSummary: string[];
}
