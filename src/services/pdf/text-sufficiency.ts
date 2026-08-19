/**
 * Seuil « quasi vide » après extraction PDF (scans / images sans OCR).
 * Compte les caractères hors espaces et marqueurs de page.
 */
export const MIN_EXTRACTABLE_TEXT_CHARS = 40;

export const NO_EXTRACTABLE_TEXT_MESSAGE =
  "Ce document semble être une image scannée ou ne contient pas de texte extractible. Pour l’instant, seuls les PDF avec du texte sélectionnable sont supportés. Essayez un PDF natif (non scanné) ou une version texte.";

/** Longueur utile du texte extrait (ignore espaces et marqueurs <<<PAGE n>>>). */
export function countExtractableChars(text: string): number {
  return text
    .replace(/<<<\s*PAGE\s+\d+\s*>>>/gi, "")
    .replace(/\s+/g, "")
    .length;
}

export function hasSufficientExtractableText(text: string): boolean {
  return countExtractableChars(text) >= MIN_EXTRACTABLE_TEXT_CHARS;
}
