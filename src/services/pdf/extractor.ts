import { extractText } from "unpdf";

import { AppError, isAppError } from "@/lib/errors";
import { mergePagesToText } from "@/ai/reasoning/citations";
import { computeTextFingerprints } from "@/services/memory/fingerprints";
import {
  classifyExtractedTextQuality,
} from "@/services/pdf/text-sufficiency";
import type { ExtractedDocumentText } from "@/types";

/** Défense DoS : PDF compressé → explosion pages/texte (bombe PDF). */
export const MAX_PDF_PAGES = 30;
const MAX_EXTRACTED_TEXT_CHARS = 1_500_000;
const MAX_PAGE_CHARS = 50_000;

function toUint8Array(source: Buffer | Uint8Array): Uint8Array {
  return source instanceof Buffer ? new Uint8Array(source) : source;
}

export function pdfPageLimitMessage(pageCount: number): string {
  return `Ce PDF dépasse la limite de ${MAX_PDF_PAGES} pages (${pageCount} pages). Réduisez le document ou scindez-le.`;
}

function assertWithinPageLimit(pageCount: number): void {
  if (pageCount > MAX_PDF_PAGES) {
    throw new AppError(
      "UNSUPPORTED_FILE",
      pdfPageLimitMessage(pageCount),
      413,
    );
  }
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
    const rawPages = Array.isArray(result.text) ? result.text : [result.text];
    const totalPages = result.totalPages || rawPages.length || 0;
    assertWithinPageLimit(totalPages);
    if (rawPages.length > MAX_PDF_PAGES) {
      assertWithinPageLimit(rawPages.length);
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
    const pageCount = totalPages || pages.length;

    return {
      documentId,
      text,
      pageCount,
      pages,
      textQuality: classifyExtractedTextQuality(text, pageCount),
      contentHash: fingerprints.contentHash,
      simhash: fingerprints.simhash,
    };
  } catch (error) {
    if (isAppError(error)) {
      throw error;
    }

    throw new AppError(
      "EXTRACTION_FAILED",
      "Impossible d'extraire le texte du PDF.",
      422,
    );
  }
}
