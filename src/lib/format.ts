const DISPLAY_TIME_ZONE = "Europe/Paris";

export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

/**
 * Affiche une date calendaire ou un instant.
 * Pour `YYYY-MM-DD` (sans heure), on formate en calendaire Europe/Paris
 * pour éviter le décalage UTC midnight → veille à Paris.
 */
export function formatDate(value: string): string {
  const trimmed = value.trim();
  if (/^\d{4}-\d{2}-\d{2}$/.test(trimmed)) {
    const [y, m, d] = trimmed.split("-").map(Number);
    const date = new Date(Date.UTC(y!, m! - 1, d!, 12, 0, 0));
    if (Number.isNaN(date.getTime())) return value;
    return new Intl.DateTimeFormat("fr-FR", {
      dateStyle: "medium",
      timeZone: DISPLAY_TIME_ZONE,
    }).format(date);
  }

  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeZone: DISPLAY_TIME_ZONE,
  }).format(date);
}

export function getRiskLevelLabel(
  level: "faible" | "modere" | "eleve" | "critique",
): string {
  switch (level) {
    case "critique":
      return "Critique";
    case "eleve":
      return "Élevé";
    case "modere":
      return "Modéré";
    default:
      return "Faible";
  }
}
