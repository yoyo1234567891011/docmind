import type { DocumentAnalysis, DocumentClassification } from "@/types";

const STOPWORDS = new Set(
  [
    "le",
    "la",
    "les",
    "un",
    "une",
    "des",
    "de",
    "du",
    "au",
    "aux",
    "et",
    "ou",
    "en",
    "dans",
    "sur",
    "pour",
    "par",
    "avec",
    "sans",
    "ce",
    "cet",
    "cette",
    "ces",
    "son",
    "sa",
    "ses",
    "leur",
    "leurs",
    "nous",
    "vous",
    "ils",
    "elles",
    "est",
    "sont",
    "été",
    "etre",
    "être",
    "a",
    "à",
    "ai",
    "as",
    "avons",
    "avez",
    "ont",
    "qui",
    "que",
    "quoi",
    "dont",
    "où",
    "ou",
    "ne",
    "pas",
    "plus",
    "moins",
    "tres",
    "très",
    "aussi",
    "comme",
    "entre",
    "chez",
    "vers",
    "sous",
    "sur",
    "il",
    "elle",
    "on",
    "se",
    "si",
    "mais",
    "donc",
    "car",
    "ni",
    "the",
    "and",
    "of",
    "to",
    "in",
    "for",
    "document",
    "analyse",
  ].map((w) => w.normalize("NFD").replace(/\p{M}/gu, "")),
);

function normalizeToken(raw: string): string {
  return raw
    .toLowerCase()
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[^a-z0-9€%/.-]/gi, "")
    .trim();
}

function tokenize(text: string): string[] {
  return text
    .split(/[\s,;:!?()[\]{}"«»/\\|+]+/g)
    .map(normalizeToken)
    .filter((t) => t.length >= 3 && !STOPWORDS.has(t) && !/^\d+$/.test(t));
}

/**
 * Extrait des mots-clés déterministes pour l’index mémoire.
 */
export function extractSheetKeywords(
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
): string[] {
  const bag: string[] = [];

  const push = (value?: string) => {
    if (!value?.trim()) return;
    bag.push(...tokenize(value));
    // Garder aussi les libellés courts intacts (noms propres, orgs)
    const trimmed = value.trim();
    if (trimmed.length >= 3 && trimmed.length <= 48 && !trimmed.includes("\n")) {
      bag.push(trimmed);
    }
  };

  push(classification.label);
  push(classification.category.replace(/-/g, " "));
  push(analysis.document_type);
  push(analysis.title);

  for (const p of analysis.people ?? []) push(p);
  for (const o of analysis.organizations ?? []) push(o);
  for (const r of analysis.risks ?? []) push(r);
  for (const a of analysis.actions ?? []) {
    // Actions : seulement tokens significatifs
    bag.push(...tokenize(a).slice(0, 4));
  }
  for (const d of analysis.deadlines ?? []) bag.push(...tokenize(d));
  for (const f of analysis.risk_findings ?? []) {
    push(f.description);
    if (f.criterion_id) bag.push(f.criterion_id.replace(/_/g, " "));
  }

  bag.push(...tokenize(analysis.summary ?? "").slice(0, 24));

  const seen = new Set<string>();
  const out: string[] = [];
  for (const item of bag) {
    const key = item.toLowerCase();
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
    if (out.length >= 40) break;
  }
  return out;
}

/**
 * Confiance globale de la fiche (0..1) :
 * classification + exhaustivité des champs + confiance des findings.
 */
export function computeSheetConfidence(
  analysis: DocumentAnalysis,
  classification: DocumentClassification,
): number {
  const classConf = Math.min(
    1,
    Math.max(0, classification.confidence ?? 0.5),
  );

  const findings = analysis.risk_findings ?? [];
  const findingConf =
    findings.length > 0
      ? findings.reduce((s, f) => s + (f.confidence || 0), 0) / findings.length
      : analysis.risks.length > 0
        ? 0.55
        : 0.65;

  let completeness = 0;
  const checks = [
    Boolean(analysis.summary?.trim()),
    Boolean(analysis.title?.trim()),
    (analysis.amounts?.length ?? 0) > 0,
    (analysis.dates?.length ?? 0) > 0 || Boolean(analysis.date?.trim()),
    (analysis.deadlines?.length ?? 0) > 0,
    (analysis.people?.length ?? 0) > 0 ||
      (analysis.organizations?.length ?? 0) > 0,
    (analysis.risks?.length ?? 0) > 0 || findings.length > 0,
    (analysis.actions?.length ?? 0) > 0,
  ];
  completeness = checks.filter(Boolean).length / checks.length;

  const citedRatio =
    findings.length === 0
      ? 0.7
      : findings.filter((f) => f.citation?.excerpt).length / findings.length;

  const score =
    classConf * 0.35 + findingConf * 0.25 + completeness * 0.25 + citedRatio * 0.15;

  return Math.round(Math.min(1, Math.max(0, score)) * 100) / 100;
}
