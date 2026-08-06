/** Normalisation légère pour matcher un extrait dans le document. */
export function normalizeForMatch(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/['’]/g, "'")
    .replace(/[^\p{L}\p{N}\s.,;:%€$/-]/gu, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/**
 * Vérifie qu'un extrait apparaît réellement dans le document
 * (inclusion exacte normalisée, ou ≥ 60 % des tokens significatifs).
 */
export function excerptExistsInDocument(
  excerpt: string,
  documentText: string,
): boolean {
  const ex = normalizeForMatch(excerpt);
  const doc = normalizeForMatch(documentText);
  if (!ex || ex.length < 8) return false;
  if (doc.includes(ex)) return true;

  // Fenêtre courte : tenter sans ponctuation
  const exCompact = ex.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
  const docCompact = doc.replace(/[.,;:]/g, " ").replace(/\s+/g, " ").trim();
  if (exCompact.length >= 12 && docCompact.includes(exCompact)) return true;

  const tokens = exCompact.split(" ").filter((t) => t.length >= 4);
  if (tokens.length < 3) return false;
  const hits = tokens.filter((t) => docCompact.includes(t)).length;
  return hits / tokens.length >= 0.6;
}
