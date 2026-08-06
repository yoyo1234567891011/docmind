/**
 * Vérification LLM optionnelle pour relations ambiguës (score 0,70–0,84).
 * Jamais sur le chemin critique : fire-and-forget, gated par env, M ≤ 3.
 */
import { generateWithOllama } from "@/ai/models/client";
import { getDefaultChatModel } from "@/ai/models/config";
import { upsertRelation } from "@/services/memory/relation-store";
import type { MemoryRelation } from "@/types/memory";

export const AMBIGUOUS_SCORE_MIN = 0.7;
export const AMBIGUOUS_SCORE_MAX = 0.85;
export const MAX_LLM_VERIFY_PER_DOC = 3;

function isAmbiguous(rel: MemoryRelation): boolean {
  return (
    rel.method === "rules" &&
    rel.score >= AMBIGUOUS_SCORE_MIN &&
    rel.score < AMBIGUOUS_SCORE_MAX &&
    rel.status === "proposed"
  );
}

function isLlmVerifyEnabled(): boolean {
  return process.env.MEMORY_RELATION_LLM_VERIFY === "1";
}

function buildPrompt(rel: MemoryRelation): string {
  const evidence = rel.evidence
    .map(
      (e) =>
        `- ${e.field}: ${e.left}${e.right ? ` → ${e.right}` : ""}${e.note ? ` (${e.note})` : ""}`,
    )
    .join("\n");
  return `Tu es un assistant juridique documentaire. Vérifie si la relation proposée est plausible.
Type: ${rel.type}
Score actuel: ${rel.score}
Preuves:
${evidence}

Réponds UNIQUEMENT en JSON: {"confirm":true|false,"score":0.0-1.0,"reason":"court"}.
Si les preuves sont insuffisantes, confirm=false et score<=0.55.`;
}

async function verifyOne(
  userId: string,
  documentId: string,
  rel: MemoryRelation,
): Promise<void> {
  try {
    const result = await generateWithOllama({
      prompt: buildPrompt(rel),
      model: getDefaultChatModel(),
      temperature: 0,
      maxTokens: 120,
      formatJson: true,
      timeoutMs: 8_000,
    });
    const parsed = JSON.parse(result.text) as {
      confirm?: boolean;
      score?: number;
      reason?: string;
    };
    const confirm = parsed.confirm === true;
    const nextScore =
      typeof parsed.score === "number" && Number.isFinite(parsed.score)
        ? Math.min(0.99, Math.max(0.4, parsed.score))
        : confirm
          ? Math.min(0.92, rel.score + 0.08)
          : Math.max(0.45, rel.score - 0.15);

    const updated: MemoryRelation = {
      ...rel,
      score: nextScore,
      method: "llm",
      evidence: [
        ...rel.evidence,
        {
          field: "llm_verify",
          left: confirm ? "confirm" : "reject",
          right: String(nextScore),
          note: (parsed.reason || "").slice(0, 200) || "Vérification LLM ambiguë",
        },
      ],
      status: confirm ? "proposed" : "user_dismissed",
      updatedAt: new Date().toISOString(),
    };
    await upsertRelation(userId, documentId, updated);
  } catch {
    // Non bloquant — laisser le score rules tel quel
  }
}

/**
 * Planifie la vérif LLM hors chemin critique. No-op si env désactivée.
 */
export function scheduleAmbiguousRelationVerify(input: {
  userId: string;
  documentId: string;
  relations: MemoryRelation[];
}): void {
  if (!isLlmVerifyEnabled()) return;
  const batch = input.relations
    .filter(isAmbiguous)
    .slice(0, MAX_LLM_VERIFY_PER_DOC);
  if (batch.length === 0) return;

  void (async () => {
    for (const rel of batch) {
      await verifyOne(input.userId, input.documentId, rel);
    }
  })().catch(() => undefined);
}

/** Exposé pour tests unitaires (sans I/O réseau). */
export function selectAmbiguousRelations(
  relations: MemoryRelation[],
): MemoryRelation[] {
  return relations.filter(isAmbiguous).slice(0, MAX_LLM_VERIFY_PER_DOC);
}
