/**
 * Extrait les passages pertinents pour le LLM (montants, dates, clauses, parties).
 * Budget réduit vs envoi brut — conserve le contexte autour des passages chauds.
 */
import { truncateAtTextBoundary } from "@/ai/post-processing/display-cleanup";

/**
 * Budget caractères document dans le prompt LLM.
 * ~3800 car + consignes (~1800) + knowledge (~1600) ≈ 7200 car ≈ 2000 tokens prompt.
 */
export const LLM_DOCUMENT_CHAR_BUDGET = 3_800;
/** Sous cooldown TPM Groq : prompt plus léger (clauses frais/délais priorisées). */
export const LLM_DOCUMENT_CHAR_BUDGET_LIGHT = 2_400;

const HOT_LINE =
  /(?:€|eur(?:os?)?|\bttc\b|\bht\b|\btva\b|\béchéance|\becheance|\bdélai|\bdelai|\bpréavis|\bpreavis|\brésil|\bresil|\bpénal|\bpenal|\bloyer|\bcharges\b|\bd[ée]p[ôo]t|\bgarantie|\bhonoraires?|\bclause\s+r[ée]solutoire|\birl\b|\btaeg\b|\bmensualit|\bsalaire|\bprime|\bfranchise|\biban|\bfacture|\bbail|\bcontrat|\bavis\s+d|article\s+\d|obligation|interdit|doit\s+|sous\s+\d+\s+j)/i;

const DATE_HINT = /\b\d{1,2}[\/\-.]\d{1,2}[\/\-.]\d{2,4}\b|\b\d{1,2}\s+(?:janv|févr|fevr|mars|avr|mai|juin|juil|août|aout|sept|oct|nov|déc|dec)/i;

function scoreBlock(block: string): number {
  const t = block.trim();
  if (t.length < 12) return 0;
  let s = 0;
  if (HOT_LINE.test(t)) s += 4;
  if (DATE_HINT.test(t)) s += 2;
  if (/(?:M\.|Mme|Monsieur|Madame|SAS|SARL|SA\b|EURL)/i.test(t)) s += 1;
  if (t.length >= 40 && t.length <= 420) s += 1;
  if (/^#{1,3}\s/.test(t)) s += 2;
  return s;
}

function splitBlocks(text: string): string[] {
  return text
    .split(/\n\s*\n/)
    .map((b) => b.trim())
    .filter((b) => b.length >= 12);
}

function collectHotLines(text: string, maxChars: number): string {
  const lines = text.split(/\r?\n/);
  const picked: string[] = [];
  let used = 0;

  for (const line of lines) {
    const trimmed = line.trim();
    if (trimmed.length < 8 || trimmed.length > 220) continue;
    if (!HOT_LINE.test(trimmed)) continue;
    const safe =
      trimmed.length > 200
        ? truncateAtTextBoundary(trimmed, 200)
        : trimmed;
    if (used + safe.length + 1 > maxChars) break;
    picked.push(safe);
    used += safe.length + 1;
  }

  return picked.join("\n");
}

function extractScoredPassages(text: string, budget: number): string {
  const blocks = splitBlocks(text);
  if (blocks.length === 0) return truncateAtTextBoundary(text, budget);

  const scored = blocks
    .map((block, index) => ({ block, index, score: scoreBlock(block) }))
    .filter((x) => x.score > 0)
    .sort((a, b) => b.score - a.score);

  const pickedIndices = new Set<number>();
  let used = 0;

  const tryAdd = (idx: number): void => {
    if (idx < 0 || idx >= blocks.length || pickedIndices.has(idx)) return;
    const block = blocks[idx]!;
    const chunk =
      block.length > 520 ? truncateAtTextBoundary(block, 520) : block;
    if (used + chunk.length + 2 > budget) return;
    pickedIndices.add(idx);
    used += chunk.length + 2;
  };

  // Début + fin (contexte global)
  tryAdd(0);
  if (blocks.length > 1) tryAdd(blocks.length - 1);

  for (const { index, score } of scored) {
    if (score < 2) continue;
    tryAdd(index);
    tryAdd(index - 1);
    tryAdd(index + 1);
    if (used >= budget * 0.92) break;
  }

  if (pickedIndices.size === 0) {
    return truncateAtTextBoundary(text, budget);
  }

  const ordered = [...pickedIndices].sort((a, b) => a - b);
  const parts: string[] = [];
  let prev = -2;

  for (const idx of ordered) {
    if (idx > prev + 1 && parts.length > 0) {
      parts.push("[…]");
    }
    parts.push(blocks[idx]!);
    prev = idx;
  }

  const joined = parts.join("\n\n");
  return joined.length <= budget
    ? joined
    : truncateAtTextBoundary(joined, budget);
}

export function prepareDocumentTextForLlm(
  text: string,
  budget = LLM_DOCUMENT_CHAR_BUDGET,
): string {
  const trimmed = text.trim();
  if (trimmed.length <= budget) return trimmed;

  const hotBudget = Math.min(900, Math.floor(budget * 0.2));
  const hot = collectHotLines(trimmed, hotBudget);
  const passageBudget = budget - (hot ? hot.length + 48 : 0);

  const passages = extractScoredPassages(trimmed, passageBudget);

  if (!hot) return passages;

  return [
    passages,
    "",
    "[Extraits ciblés]",
    hot,
  ].join("\n");
}

/** Texte court pour classification LLM (si l’heuristique échoue). */
export function prepareDocumentTextForClassify(text: string): string {
  return prepareDocumentTextForLlm(text, 2_000);
}
