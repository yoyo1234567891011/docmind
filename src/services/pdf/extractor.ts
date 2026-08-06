import { extractText } from "unpdf";

import { AppError } from "@/lib/errors";
import { mergePagesToText } from "@/ai/reasoning/citations";
import { computeTextFingerprints } from "@/services/memory/fingerprints";
import type { ExtractedDocumentText } from "@/types";

/** Défense DoS : PDF compressé → explosion pages/texte (bombe PDF). */
const MAX_PDF_PAGES = 200;
const MAX_EXTRACTED_TEXT_CHARS = 1_500_000;
const MAX_PAGE_CHARS = 50_000;

function toUint8Array(source: Buffer | Uint8Array): Uint8Array {
  return source instanceof Buffer ? new Uint8Array(source) : source;
}

/**
 * Extracts plain text from a PDF binary payload (page-aware).
 */
export async function extractTextFromPdf(
  documentId: string,
  source: Buffer | Uint8Array,
): Promise<ExtractedDocumentText> {
  try {
    const data = toUint8Array(source);
    const result = await extractText(data, { mergePages: false });
    const totalPages = result.totalPages || 0;
    if (totalPages > MAX_PDF_PAGES) {
      throw new AppError(
        "UNSUPPORTED_FILE",
        `PDF trop volumineux (${totalPages} pages, max ${MAX_PDF_PAGES}).`,
        413,
      );
    }

    const rawPages = Array.isArray(result.text) ? result.text : [result.text];
    if (rawPages.length > MAX_PDF_PAGES) {
      throw new AppError(
        "UNSUPPORTED_FILE",
        `PDF trop volumineux (max ${MAX_PDF_PAGES} pages).`,
        413,
      );
    }

    const pages = rawPages
      .map((page) => {
        if (typeof page !== "string") return "";
        const trimmed = page.trim();
        return trimmed.length > MAX_PAGE_CHARS
          ? trimmed.slice(0, MAX_PAGE_CHARS)
          : trimmed;
      })
      .filter((page) => page.length > 0);

    let text =
      pages.length > 0
        ? mergePagesToText(pages)
        : "";
    if (text.length > MAX_EXTRACTED_TEXT_CHARS) {
      text = text.slice(0, MAX_EXTRACTED_TEXT_CHARS);
    }

    const fingerprints = computeTextFingerprints(text);

    return {
      documentId,
      text,
      pageCount: totalPages || pages.length,
      pages,
      contentHash: fingerprints.contentHash,
      simhash: fingerprints.simhash,
    };
  } catch (error) {
    if (error instanceof AppError) {
      throw error;
    }

    throw new AppError(
      "EXTRACTION_FAILED",
      "Impossible d'extraire le texte du PDF.",
      422,
    );
  }
}
