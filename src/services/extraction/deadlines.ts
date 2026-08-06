import { uniqueStrings } from "@/lib/array";
import { extractDates } from "@/services/extraction/dates";

const DEADLINE_KEYWORDS =
  /(?:échéance|echeance|délai|delai|avant\s+le|au\s+plus\s+tard|date\s+limite|à\s+régler\s+avant|payable\s+avant|expire(?:r)?\s+le|valable\s+jusqu(?:'|’)au|pr[ée]avis|d[ée]nonciation|r[ée]siliation|au\s+moins\s+\d+\s+jours?|sous\s+\d+\s+jours?|dans\s+(?:un\s+d[ée]lai\s+de\s+)?\d+\s+jours?)/i;

const RELATIVE_DEADLINE =
  /(?:d[ée]nonciation|r[ée]siliation|pr[ée]avis|demande|modification|r[ée]ponse|paiement|contestation)[^.!?\n]{0,80}?(?:\d+\s+jours?|au\s+moins\s+\d+|sous\s+\d+|avant\s+l[''][ée]ch[ée]ance|avant\s+le\s+\d{1,2}[\/.-]\d{1,2}[\/.-]\d{2,4})/gi;

/** Items that belong to risks/actions, never to deadlines. */
const FORBIDDEN_DEADLINE_CONTENT =
  /p[ée]nalit|sanction|amende|astreinte|nullit[ée]|d[ée]ch[ée]ance|suspension|poursuite|mise\s+en\s+demeure|obligation|tenu\s+de|doit\s+imp[ée]rativement|cons[ée]quence|faute\s+de\s+quoi|sous\s+peine|franchise|frais\s+de\s+dossier|frais\s+cach|cotisation|majoration\s+automatique/i;

const HAS_DATE = /\b\d{1,2}[\/.\-]\d{1,2}[\/.\-]\d{2,4}\b|\b\d{4}-\d{2}-\d{2}\b/;
const HAS_DURATION =
  /\b\d+\s*(?:jours?|j|mois|semaines?|heures?|h|ans?)\b|\b(?:quinze|huit|trente|soixante)\s+jours?\b|\bpr[ée]avis\b|\bd[ée]lai\b|\b[ée]ch[ée]ance\b|\bdate\s+limite\b|\bd[ée]nonciation\b/i;

function normalizeSnippet(value: string): string {
  return value.replace(/\s+/g, " ").trim();
}

function isUsefulDeadlineSnippet(line: string): boolean {
  if (line.length < 8 || line.length > 160) return false;
  if ((line.match(/•/g) ?? []).length >= 2) return false;
  if (
    /Assureur fictif|Adresse du risque|Cotisation mensuelle/i.test(line) &&
    !DEADLINE_KEYWORDS.test(line)
  ) {
    return false;
  }
  return DEADLINE_KEYWORDS.test(line);
}

/**
 * Keeps only pure deadline entries: dates, durations, due dates, delays.
 * Drops penalties, sanctions, obligations and consequences.
 */
export function sanitizeDeadlines(values: string[]): string[] {
  return uniqueStrings(
    values
      .map((value) => normalizeSnippet(value))
      .filter(Boolean)
      .filter((value) => value.length <= 160)
      .filter((value) => !FORBIDDEN_DEADLINE_CONTENT.test(value))
      .filter((value) => HAS_DATE.test(value) || HAS_DURATION.test(value)),
  );
}

/**
 * Extracts deadline-related snippets, including dates and relative delays.
 */
export function extractDeadlines(text: string): string[] {
  const lines = text
    .split(/\r?\n|(?<=[.!?])\s+/)
    .map((line) => normalizeSnippet(line))
    .filter(Boolean);

  const deadlineLines = lines
    .filter(isUsefulDeadlineSnippet)
    .map((line) => line.slice(0, 160));

  const relativeMatches = [...text.matchAll(RELATIVE_DEADLINE)].map((match) =>
    normalizeSnippet(match[0]).slice(0, 160),
  );

  const datesInDeadlineLines = [...deadlineLines, ...relativeMatches].flatMap(
    (line) => extractDates(line),
  );

  return sanitizeDeadlines([
    ...deadlineLines,
    ...relativeMatches,
    ...datesInDeadlineLines,
  ]);
}
