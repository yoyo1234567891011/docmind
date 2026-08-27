import type { DocumentCitation } from "@/types/citation";
import {
  cleanExcerptForDisplay,
  truncateAtTextBoundary,
} from "@/ai/post-processing/display-cleanup";
import { normalizeForMatch } from "@/ai/reasoning/normalize-text";

export type DocumentLocus = {
  page: number;
  paragraph: number;
  text: string;
  normalized: string;
};

/** Découpe une page en paragraphes (blocs non vides). */
export function splitParagraphs(pageText: string): string[] {
  return pageText
    .split(/\n\s*\n+/g)
    .map((p) => p.replace(/\s+/g, " ").trim())
    .filter((p) => p.length >= 8);
}

/**
 * Index page/paragraphe pour localiser un extrait.
 * Si `pages` est vide, traite tout le document comme page 1.
 */
export function buildDocumentLocusIndex(
  pages: string[] | undefined,
  fallbackText: string,
): DocumentLocus[] {
  const sourcePages =
    pages && pages.length > 0
      ? pages.map((p) => p.trim()).filter(Boolean)
      : [fallbackText.trim()].filter(Boolean);

  const loci: DocumentLocus[] = [];
  sourcePages.forEach((pageText, pageIndex) => {
    const paragraphs = splitParagraphs(pageText);
    const usable =
      paragraphs.length > 0
        ? paragraphs
        : pageText.replace(/\s+/g, " ").trim()
          ? [pageText.replace(/\s+/g, " ").trim()]
          : [];

    usable.forEach((text, paraIndex) => {
      loci.push({
        page: pageIndex + 1,
        paragraph: paraIndex + 1,
        text,
        normalized: normalizeForMatch(text),
      });
    });
  });

  return loci;
}

function tokenOverlapRatio(a: string, b: string): number {
  const ta = a.split(" ").filter((t) => t.length >= 4);
  if (ta.length === 0) return 0;
  const hits = ta.filter((t) => b.includes(t)).length;
  return hits / ta.length;
}

function isHeaderOnlyLocus(locus: DocumentLocus): boolean {
  const t = locus.text.trim();
  if (t.length > 120) return false;
  if (/\d[\d\s.,]*\s*€|€\s*\d|\d+\s*%/.test(t)) return false;
  if (/sous\s+\d+\s*jours?|pr[ée]avis|[ée]ch[ée]ance|montant|total|loyer|p[ée]nalit/i.test(t)) {
    return false;
  }
  const letters = t.replace(/[^A-Za-zÀ-ÿ]/g, "");
  if (letters.length >= 8 && letters === letters.toUpperCase()) return true;
  return /^(?:soci[ée]t[ée]|direction|service|d[ée]partement|facture|relev[ée]|contrat|bail)\b/i.test(
    t,
  );
}

/**
 * Localise un extrait dans le document → citation exacte.
 * Retourne null si aucune preuve exploitable (conclusion interdite).
 */
export function locateExcerptCitation(
  excerpt: string,
  loci: DocumentLocus[],
): DocumentCitation | null {
  const ex = normalizeForMatch(excerpt);
  if (!ex || ex.length < 8 || loci.length === 0) return null;

  let best: { locus: DocumentLocus; score: number } | null = null;

  for (const locus of loci) {
    if (isHeaderOnlyLocus(locus)) continue;

    if (locus.normalized.includes(ex) || ex.includes(locus.normalized)) {
      const score = Math.min(ex.length, locus.normalized.length) /
        Math.max(ex.length, locus.normalized.length);
      if (!best || score > best.score) {
        best = { locus, score: Math.max(score, 0.99) };
      }
      continue;
    }

    const overlap = tokenOverlapRatio(ex, locus.normalized);
    if (overlap >= 0.6) {
      if (!best || overlap > best.score) {
        best = { locus, score: overlap };
      }
    }
  }

  if (!best || best.score < 0.6) return null;

  // Extraire la portion la plus proche de l'excerpt dans le paragraphe
  const raw = best.locus.text;
  const rawNorm = best.locus.normalized;
  let canonical = raw;
  const idx = rawNorm.indexOf(ex);
  if (idx >= 0) {
    // approximation: prendre une fenêtre du paragraphe original
    const ratio = raw.length / Math.max(1, rawNorm.length);
    const start = Math.max(0, Math.floor(idx * ratio) - 20);
    const end = Math.min(raw.length, Math.ceil((idx + ex.length) * ratio) + 20);
    canonical = raw.slice(start, end).trim() || raw;
  }

  let cleaned = canonical.trim();
  // Éviter un début au milieu d’un mot (fenêtre ±20)
  if (
    cleaned.length > 0 &&
    /^[a-zàâäéèêëïîôùûüç]{1,10}\s/i.test(cleaned) &&
    cleaned[0] === cleaned[0]!.toLowerCase()
  ) {
    const sp = cleaned.indexOf(" ");
    if (sp > 0 && sp <= 10) cleaned = cleaned.slice(sp + 1).trim();
  }
  if (cleaned.length > 400) {
    cleaned = truncateAtTextBoundary(cleaned, 400);
  }

  cleaned = cleanExcerptForDisplay(cleaned) ?? cleaned;

  return {
    page: best.locus.page,
    paragraph: best.locus.paragraph,
    excerpt: cleaned,
  };
}

/** Texte LLM avec marqueurs de page pour aider le modèle. */
export function formatPagesForLlm(pages: string[]): string {
  if (pages.length === 0) return "";
  return pages
    .map((page, i) => `<<<PAGE ${i + 1}>>>\n${page.trim()}`)
    .join("\n\n");
}

export function mergePagesToText(pages: string[]): string {
  return formatPagesForLlm(pages);
}
