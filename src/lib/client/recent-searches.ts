const STORAGE_PREFIX = "docmind-recent-searches";
const MAX_ITEMS = 8;

export interface RecentSearch {
  query: string;
  at: string;
  hitCount?: number;
}

function storageKey(userId?: string | null): string {
  const scope = userId?.trim() || "anonymous";
  return `${STORAGE_PREFIX}:${scope}`;
}

export function readRecentSearches(userId?: string | null): RecentSearch[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = window.localStorage.getItem(storageKey(userId));
    if (!raw) return [];
    const parsed = JSON.parse(raw) as RecentSearch[];
    if (!Array.isArray(parsed)) return [];
    return parsed
      .filter(
        (item) =>
          item &&
          typeof item.query === "string" &&
          item.query.trim() &&
          typeof item.at === "string",
      )
      .slice(0, MAX_ITEMS);
  } catch {
    return [];
  }
}

export function recordRecentSearch(
  query: string,
  hitCount?: number,
  userId?: string | null,
): RecentSearch[] {
  const trimmed = query.trim();
  if (!trimmed || typeof window === "undefined") {
    return readRecentSearches(userId);
  }

  const next: RecentSearch = {
    query: trimmed,
    at: new Date().toISOString(),
    hitCount,
  };

  const previous = readRecentSearches(userId).filter(
    (item) => item.query.toLowerCase() !== trimmed.toLowerCase(),
  );
  const merged = [next, ...previous].slice(0, MAX_ITEMS);

  try {
    window.localStorage.setItem(storageKey(userId), JSON.stringify(merged));
  } catch {
    // ignore quota / private mode
  }

  return merged;
}
