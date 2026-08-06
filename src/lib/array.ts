export function uniqueStrings(values: string[]): string[] {
  const seen = new Set<string>();
  const result: string[] = [];

  for (const value of values) {
    const normalized = value.trim();
    if (!normalized) continue;

    const key = normalized.toLowerCase();
    if (seen.has(key)) continue;

    seen.add(key);
    result.push(normalized);
  }

  return result;
}

export function mergeUniqueStrings(
  ...groups: Array<string[] | undefined>
): string[] {
  return uniqueStrings(groups.flatMap((group) => group ?? []));
}
