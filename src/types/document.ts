export type DocumentMimeType = "application/pdf";

export interface UploadedDocument {
  id: string;
  fileName: string;
  mimeType: DocumentMimeType;
  sizeInBytes: number;
  uploadedAt: string;
}

export interface ExtractedDocumentText {
  documentId: string;
  /** Texte fusionné (avec marqueurs de page si disponible) */
  text: string;
  pageCount: number;
  /** Texte brut par page (index 0 = page 1) */
  pages: string[];
  /** ok = texte natif ; likely_scan = images / OCR absent ; empty = rien */
  textQuality?: "ok" | "likely_scan" | "empty";
  /** SHA-256 du texte (doublons exacts) — calculé à l’extraction. */
  contentHash?: string;
  /** SimHash 64-bit hex (near-duplicates) — calculé à l’extraction. */
  simhash?: string;
}

export interface UploadPdfResult {
  document: UploadedDocument;
  extraction: ExtractedDocumentText;
}
