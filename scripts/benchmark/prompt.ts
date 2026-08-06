import type { ExpectedAnalysis } from "../../src/types/eval";

/** Prompt commun — force un JSON comparable au ground truth DocMind. */
export function buildBenchmarkSystemPrompt(): string {
  return [
    "Tu es un expert en analyse de documents administratifs et juridiques français.",
    "Analyse le document fourni et réponds UNIQUEMENT avec un JSON valide (pas de markdown).",
    "Schéma exact :",
    JSON.stringify(
      {
        document_type: "string",
        title: "string",
        summary: "string",
        people: ["string"],
        organizations: ["string"],
        amounts: ["string"],
        dates: ["string"],
        deadlines: ["string"],
        important_points: ["string"],
        risks: ["string"],
        actions: ["string"],
        risk_score: 0,
        citations: [{ excerpt: "extrait verbatim du document", page: 1 }],
      },
      null,
      2,
    ),
    "Règles :",
    "- Ne rien inventer : uniquement des faits présents dans le document.",
    "- citations[].excerpt doit être une citation verbatim (si possible).",
    "- risk_score : entier 0–100.",
    "- listes vides [] si aucune info.",
  ].join("\n");
}

export function buildBenchmarkUserPrompt(fileName: string): string {
  return `Analyse ce document PDF nommé « ${fileName} » et produis le JSON demandé.`;
}

export function emptyPrediction(): ExpectedAnalysis {
  return {
    document_type: "",
    title: "",
    summary: "",
    people: [],
    organizations: [],
    amounts: [],
    dates: [],
    deadlines: [],
    important_points: [],
    risks: [],
    actions: [],
    risk_score: 0,
  };
}

/** Parse JSON modèle (tolère fences markdown). */
export function parseModelJson(raw: string): {
  predicted: ExpectedAnalysis;
  citations: Array<{ excerpt: string; page?: number }>;
} {
  let text = raw.trim();
  const fence = text.match(/```(?:json)?\s*([\s\S]*?)```/i);
  if (fence) text = fence[1].trim();
  const start = text.indexOf("{");
  const end = text.lastIndexOf("}");
  if (start >= 0 && end > start) text = text.slice(start, end + 1);

  const parsed = JSON.parse(text) as Record<string, unknown>;
  const asStringArray = (v: unknown): string[] =>
    Array.isArray(v)
      ? v.map((x) => String(x)).filter((s) => s.trim().length > 0)
      : [];

  const predicted: ExpectedAnalysis = {
    document_type: String(parsed.document_type ?? ""),
    title: String(parsed.title ?? ""),
    summary: String(parsed.summary ?? ""),
    people: asStringArray(parsed.people),
    organizations: asStringArray(parsed.organizations),
    amounts: asStringArray(parsed.amounts),
    dates: asStringArray(parsed.dates),
    deadlines: asStringArray(parsed.deadlines),
    important_points: asStringArray(parsed.important_points),
    risks: asStringArray(parsed.risks),
    actions: asStringArray(parsed.actions),
    risk_score: Number(parsed.risk_score) || 0,
  };

  const citationsRaw = Array.isArray(parsed.citations) ? parsed.citations : [];
  const citations: Array<{ excerpt: string; page?: number }> = [];
  for (const c of citationsRaw) {
    if (!c || typeof c !== "object") continue;
    const o = c as { excerpt?: unknown; page?: unknown };
    const excerpt = typeof o.excerpt === "string" ? o.excerpt.trim() : "";
    if (excerpt.length < 8) continue;
    citations.push({
      excerpt,
      ...(typeof o.page === "number" ? { page: o.page } : {}),
    });
  }

  return { predicted, citations };
}
