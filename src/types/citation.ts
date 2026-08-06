/**
 * Preuve textuelle obligatoire pour toute conclusion.
 * page / paragraphe sont 1-based.
 */
export interface DocumentCitation {
  page: number;
  paragraph: number;
  excerpt: string;
}

/** Conclusion accompagnée d'une citation exacte du document. */
export interface CitedConclusion {
  statement: string;
  citation: DocumentCitation;
}

export function isDocumentCitation(value: unknown): value is DocumentCitation {
  if (!value || typeof value !== "object") return false;
  const o = value as Record<string, unknown>;
  return (
    typeof o.page === "number" &&
    o.page >= 1 &&
    typeof o.paragraph === "number" &&
    o.paragraph >= 1 &&
    typeof o.excerpt === "string" &&
    o.excerpt.trim().length >= 8
  );
}
