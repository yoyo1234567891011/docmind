/**
 * Seuil « quasi vide » après extraction PDF (scans / images sans OCR).
 * Compte les caractères hors espaces et marqueurs de page.
 */
export const MIN_EXTRACTABLE_TEXT_CHARS = 40;

export type PdfTextQuality = "ok" | "likely_scan" | "empty";

export const NO_EXTRACTABLE_TEXT_MESSAGE =
  "Ce document semble être une image scannée ou ne contient pas de texte extractible. Pour l’instant, seuls les PDF avec du texte sélectionnable sont supportés. Essayez un PDF natif (non scanné) ou une version texte.";

export const LIKELY_SCANNED_PDF_MESSAGE =
  "Ce PDF ressemble à un scan (images de pages) : très peu de texte sélectionnable. DocMind ne lit pas encore les scans automatiquement. Solutions : ré-exporter le PDF avec OCR (Adobe Acrobat, Google Drive « Ouvrir avec Google Docs », ou l’app de votre scanner), ou utiliser un PDF généré depuis Word/LibreOffice.";

/** Longueur utile du texte extrait (ignore espaces et marqueurs <<<PAGE n>>>). */
export function countExtractableChars(text: string): number {
  return text
    .replace(/<<<\s*PAGE\s+\d+\s*>>>/gi, "")
    .replace(/\s+/g, "")
    .length;
}

export function classifyExtractedTextQuality(
  text: string,
  pageCount: number,
): PdfTextQuality {
  const chars = countExtractableChars(text);
  if (chars === 0) return "empty";
  if (chars < MIN_EXTRACTABLE_TEXT_CHARS) {
    return pageCount >= 1 ? "likely_scan" : "empty";
  }
  const pages = Math.max(1, pageCount);
  if (pages >= 2 && chars / pages < 25) return "likely_scan";
  if (pages >= 3 && chars < 120) return "likely_scan";
  return "ok";
}

export function isLikelyScannedPdf(text: string, pageCount: number): boolean {
  return classifyExtractedTextQuality(text, pageCount) === "likely_scan";
}

export function hasSufficientExtractableText(text: string): boolean {
  return countExtractableChars(text) >= MIN_EXTRACTABLE_TEXT_CHARS;
}

/** Message utilisateur selon la qualité d’extraction. */
export function extractionQualityMessage(quality: PdfTextQuality): string {
  if (quality === "likely_scan") return LIKELY_SCANNED_PDF_MESSAGE;
  return NO_EXTRACTABLE_TEXT_MESSAGE;
}
