import { randomUUID } from "crypto";

import { assertValidPdfUpload } from "@/lib/document-validation";
import { trackAnalyticsEvent } from "@/services/analytics";
import { extractTextFromPdf } from "@/services/pdf";
import { savePdfToUploads } from "@/services/storage";
import type { UploadPdfResult } from "@/types";

export async function uploadPdfDocument(
  userId: string,
  file: File,
): Promise<UploadPdfResult> {
  const validFile = await assertValidPdfUpload(file);
  const id = randomUUID();
  const bytes = Buffer.from(await validFile.arrayBuffer());

  // Extraction + limite pages AVANT tout écriture storage (S3/FS).
  const extractStarted = Date.now();
  const extraction = await extractTextFromPdf(id, bytes);
  const durationMs = Date.now() - extractStarted;
  const ocrDurationMs = 0;

  await savePdfToUploads(userId, id, bytes);

  await trackAnalyticsEvent({
    name: "extraction.completed",
    userId,
    meta: {
      documentId: id,
      fileName: validFile.name,
      durationMs,
      ocrDurationMs,
      method: "unpdf",
      pageCount: extraction.pageCount,
      textChars: extraction.text.length,
      empty: extraction.text.trim().length === 0,
    },
  });

  return {
    document: {
      id,
      fileName: validFile.name,
      mimeType: "application/pdf",
      sizeInBytes: validFile.size,
      uploadedAt: new Date().toISOString(),
    },
    extraction,
  };
}
