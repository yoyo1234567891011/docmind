import { uniqueStrings } from "@/lib/array";

const MONTHS =
  "janvier|février|fevrier|mars|avril|mai|juin|juillet|août|aout|septembre|octobre|novembre|décembre|decembre";

const DATE_PATTERNS = [
  /\b\d{1,2}[/-]\d{1,2}[/-]\d{2,4}\b/g,
  /\b\d{4}-\d{2}-\d{2}\b/g,
  new RegExp(
    `\\b\\d{1,2}\\s+(?:er\\s+)?(?:${MONTHS})\\s+\\d{4}\\b`,
    "gi",
  ),
];

export function extractDates(text: string): string[] {
  const matches: string[] = [];

  for (const pattern of DATE_PATTERNS) {
    const found = text.match(pattern);
    if (found) {
      matches.push(...found.map((item) => item.trim()));
    }
  }

  return uniqueStrings(matches);
}

export function pickPrimaryDate(dates: string[]): string {
  return dates[0] ?? "";
}
