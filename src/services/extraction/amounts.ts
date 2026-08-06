import { uniqueStrings } from "@/lib/array";

const AMOUNT_PATTERN =
  /(?:€|EUR|euros?)\s*[+-]?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?|(?:€|EUR|euros?)\s*[+-]?\d+(?:[.,]\d{1,2})?|[+-]?\d{1,3}(?:[ \u00a0]\d{3})+(?:[.,]\d{1,2})?\s*(?:€|EUR|euros?)|[+-]?\d+(?:[.,]\d{1,2})?\s*(?:€|EUR|euros?)/gi;

function normalizeAmount(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function removeSubAmountDuplicates(amounts: string[]): string[] {
  const sorted = [...amounts].sort((a, b) => b.length - a.length);
  const kept: string[] = [];

  for (const amount of sorted) {
    const compact = amount.replace(/\s/g, "").toLowerCase();
    const isSubMatch = kept.some((existing) =>
      existing.replace(/\s/g, "").toLowerCase().includes(compact),
    );

    if (!isSubMatch) {
      kept.push(amount);
    }
  }

  return kept;
}

export function extractAmounts(text: string): string[] {
  const matches = text.match(AMOUNT_PATTERN) ?? [];
  return removeSubAmountDuplicates(
    uniqueStrings(matches.map(normalizeAmount)),
  );
}
