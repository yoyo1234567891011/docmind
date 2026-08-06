export function formatDateTime(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
    timeStyle: "short",
  }).format(date);
}

export function formatDate(value: string): string {
  const date = new Date(value);

  if (Number.isNaN(date.getTime())) {
    return value;
  }

  return new Intl.DateTimeFormat("fr-FR", {
    dateStyle: "medium",
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
