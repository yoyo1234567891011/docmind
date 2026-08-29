/**
 * Helpers for parsing amounts and French dates in smart search.
 */

export function parseEuroAmount(value: string): number | null {
  const normalized = value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .replace(/\u00a0/g, " ")
    .trim();

  const match = normalized.match(
    /([+-]?\d{1,3}(?:[ ]\d{3})+(?:[.,]\d{1,2})?|[+-]?\d+(?:[.,]\d{1,2})?)/,
  );
  if (!match) return null;

  const raw = match[1].replace(/\s/g, "").replace(",", ".");
  const amount = Number(raw);
  return Number.isFinite(amount) ? amount : null;
}

export function extractEuroAmounts(values: string[]): number[] {
  const amounts: number[] = [];
  for (const value of values) {
    const parsed = parseEuroAmount(value);
    if (parsed !== null) amounts.push(parsed);
  }
  return amounts;
}

/** Parse JJ/MM/AAAA or ISO-like dates from free text */
export function extractDateCandidates(values: string[]): Date[] {
  const dates: Date[] = [];

  for (const value of values) {
    const frMatches = value.matchAll(
      /\b(\d{1,2})\/(\d{1,2})\/(\d{4})\b/g,
    );
    for (const match of frMatches) {
      const day = Number(match[1]);
      const month = Number(match[2]);
      const year = Number(match[3]);
      const date = new Date(Date.UTC(year, month - 1, day));
      if (!Number.isNaN(date.getTime())) dates.push(date);
    }

    const isoMatches = value.matchAll(/\b(\d{4})-(\d{2})-(\d{2})\b/g);
    for (const match of isoMatches) {
      const date = new Date(`${match[1]}-${match[2]}-${match[3]}T00:00:00Z`);
      if (!Number.isNaN(date.getTime())) dates.push(date);
    }
  }

  return dates;
}

export function dateInYear(date: Date, year: number): boolean {
  return date.getUTCFullYear() === year;
}

export function dateInRange(
  date: Date,
  from?: string,
  to?: string,
): boolean {
  const time = date.getTime();
  if (from) {
    const start = new Date(`${from}T00:00:00Z`).getTime();
    if (time < start) return false;
  }
  if (to) {
    const end = new Date(`${to}T23:59:59Z`).getTime();
    if (time > end) return false;
  }
  return true;
}

export function normalizeText(value: string): string {
  return value
    .normalize("NFD")
    .replace(/[\u0300-\u036f]/g, "")
    .toLowerCase();
}

function escapeRegExp(value: string): string {
  return value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");
}

/** Match insensible aux accents, avec frontières de mot (évite « élevé » dans « relevé »). */
export function includesNormalized(haystack: string, needle: string): boolean {
  const trimmed = needle.trim();
  if (!trimmed) return false;

  const normalizedHaystack = normalizeText(haystack);
  const normalizedNeedle = normalizeText(trimmed);
  const escaped = escapeRegExp(normalizedNeedle);
  const pattern = new RegExp(
    `(?:^|[^a-z0-9])${escaped}(?:[^a-z0-9]|$)`,
  );
  return pattern.test(normalizedHaystack);
}
