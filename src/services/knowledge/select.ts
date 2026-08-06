import { loadKnowledgeCatalog } from "@/services/knowledge/load";
import type {
  KnowledgeDocument,
  KnowledgeSelection,
} from "@/services/knowledge/types";

function normalize(text: string): string {
  return text
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "");
}

/** Match mot-entier (évite « garantie » dans « dépôt de garantie » pour l’assurance). */
function containsKeyword(haystackNorm: string, keyword: string): boolean {
  const k = normalize(keyword).trim();
  if (k.length < 3) return false;
  if (k.includes(" ")) return haystackNorm.includes(k);
  const re = new RegExp(
    `(?:^|[^a-z0-9])${k.replace(/[.*+?^${}()|[\]\\]/g, "\\$&")}(?:[^a-z0-9]|$)`,
    "i",
  );
  return re.test(haystackNorm);
}

function scoreDocument(
  doc: KnowledgeDocument,
  category: string,
  categoryLabel: string,
  docNorm: string,
): number {
  let score = 0;
  const cat = category.toLowerCase();
  const labelNorm = normalize(categoryLabel);

  if (doc.categories.some((c) => c.toLowerCase() === cat)) {
    score += 50;
  }

  for (const alias of doc.aliases) {
    const a = normalize(alias);
    if (a && (labelNorm.includes(a) || docNorm.includes(a))) score += 12;
  }

  for (const kw of doc.keywords) {
    if (containsKeyword(docNorm, kw)) score += 6;
  }

  // Bonus sections dont le titre matche le texte
  for (const section of doc.sections) {
    const title = normalize(section.title);
    if (title.length >= 5 && docNorm.includes(title)) score += 2;
  }

  return score;
}

function pickRelevantExcerpt(
  doc: KnowledgeDocument,
  docNorm: string,
  budget: number,
): string {
  if (doc.body.length <= budget) {
    return doc.body.trim();
  }

  const ranked = [...doc.sections].map((section) => {
    let s = 1;
    const title = normalize(section.title);
    if (title && docNorm.includes(title)) s += 5;
    for (const kw of doc.keywords) {
      if (containsKeyword(normalize(section.content), kw)) s += 2;
    }
    // Priorité pédagogique pour l'agent juridique
    if (/risque|pi[eè]ge|v[ée]rifier|p[ée]nalit|d[ée]lai|crit[eè]re/i.test(section.title)) {
      s += 3;
    }
    return { section, s };
  });

  ranked.sort((a, b) => b.s - a.s);

  const parts: string[] = [`# ${doc.label} (${doc.id})`];
  let used = parts[0]!.length;

  for (const { section } of ranked) {
    const chunk = `\n## ${section.title}\n${section.content.trim()}`;
    if (used + chunk.length > budget) {
      const remaining = budget - used - 20;
      if (remaining > 80) {
        parts.push(chunk.slice(0, remaining) + "\n…");
      }
      break;
    }
    parts.push(chunk);
    used += chunk.length;
  }

  return parts.join("\n").trim();
}

/**
 * Sélectionne les fiches pertinentes pour une analyse.
 * `alwaysInclude` (ex. general) est omis si au moins une fiche spécialisée matche
 * (réduit le prompt sans perdre le domaine pertinent).
 */
export async function selectKnowledgeForDocument(input: {
  category: string;
  categoryLabel: string;
  documentText: string;
}): Promise<KnowledgeSelection> {
  const { manifest, documents } = await loadKnowledgeCatalog();
  const docNorm = normalize(input.documentText.slice(0, 12_000));
  const scores: Record<string, number> = {};

  for (const doc of documents) {
    scores[doc.id] = scoreDocument(
      doc,
      input.category,
      input.categoryLabel,
      docNorm,
    );
  }

  const always = new Set(manifest.alwaysInclude.map((id) => id.toLowerCase()));

  // Seuil : éviter les faux positifs (ex. mot trop générique)
  const MIN_SPECIALIZED_SCORE = 10;

  const rankedSpecialized = documents
    .filter((d) => !always.has(d.id.toLowerCase()))
    .sort((a, b) => (scores[b.id] ?? 0) - (scores[a.id] ?? 0));

  const specialized: KnowledgeDocument[] = [];
  for (const doc of rankedSpecialized) {
    if (specialized.length >= manifest.maxFiles) break;
    if ((scores[doc.id] ?? 0) < MIN_SPECIALIZED_SCORE) continue;
    specialized.push(doc);
  }

  const selected: KnowledgeDocument[] = [];

  // Fallback only: inject alwaysInclude when no specialized domain matched.
  if (specialized.length === 0) {
    for (const doc of documents) {
      if (always.has(doc.id.toLowerCase())) selected.push(doc);
    }
  } else {
    selected.push(...specialized);
  }

  // Si rien du tout, garder au moins la première fiche du catalogue
  if (selected.length === 0 && documents[0]) {
    selected.push(documents[0]);
  }

  const perFileBudget = Math.max(
    600,
    Math.floor(manifest.maxInjectChars / Math.max(1, selected.length)),
  );

  const blocks = selected.map((doc) =>
    pickRelevantExcerpt(doc, docNorm, perFileBudget),
  );

  let promptBlock = [
    "<<<CONNAISSANCES_JURIDIQUES>>>",
    "Règles spécialisées à consulter AVANT d'analyser. Ne pas inventer hors document ; utiliser ces règles pour qualifier risques et points de contrôle.",
    ...blocks,
    "<<<FIN_CONNAISSANCES>>>",
  ].join("\n\n");

  if (promptBlock.length > manifest.maxInjectChars + 400) {
    promptBlock = promptBlock.slice(0, manifest.maxInjectChars + 400) + "\n…";
  }

  return {
    documents: selected,
    promptBlock,
    selectedIds: selected.map((d) => d.id),
    scores,
  };
}
