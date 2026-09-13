/**
 * Helpers d’affichage bibliothèque Documents — UI only, pas de merge storage.
 */

/** Titre et fileName quasi identiques (ignore .pdf / accents / ponctuation). */
export function isRedundantDocumentFileName(
  title: string,
  fileName: string,
): boolean {
  const norm = (raw: string) =>
    raw
      .normalize("NFD")
      .replace(/\p{M}/gu, "")
      .toLowerCase()
      .replace(/\.pdf$/i, "")
      .replace(/[^a-z0-9]+/g, " ")
      .trim();
  const a = norm(title);
  const b = norm(fileName);
  return Boolean(a) && a === b;
}
