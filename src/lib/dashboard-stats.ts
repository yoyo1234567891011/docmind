import { getRiskLevelLabel } from "@/lib/format";
import type { DocumentAlert, HistoryListItem } from "@/types";

export interface DashboardStatCard {
  id: string;
  label: string;
  value: string;
  hint: string;
}

export interface NamedCount {
  id: string;
  label: string;
  count: number;
  percent: number;
}

export interface DashboardStats {
  totalDocuments: number;
  totalAnalyses: number;
  averageRiskScore: number;
  needsActionCount: number;
  atRiskCount: number;
  analysesLast7Days: number;
  upcomingDeadlinesCount: number;
  riskDistribution: NamedCount[];
  categoryDistribution: NamedCount[];
  recentDocuments: HistoryListItem[];
  latestAnalyses: HistoryListItem[];
  actionRequired: HistoryListItem[];
  atRiskDocuments: HistoryListItem[];
  cards: DashboardStatCard[];
}

function sortByAnalyzedAtDesc(items: HistoryListItem[]) {
  return [...items].sort(
    (a, b) =>
      new Date(b.analyzedAt).getTime() - new Date(a.analyzedAt).getTime(),
  );
}

function toNamedCounts(
  entries: Array<[string, { label: string; count: number }]>,
  total: number,
): NamedCount[] {
  return entries
    .map(([id, value]) => ({
      id,
      label: value.label,
      count: value.count,
      percent: total > 0 ? Math.round((value.count / total) * 100) : 0,
    }))
    .sort((a, b) => b.count - a.count);
}

function isAtRisk(item: HistoryListItem): boolean {
  return item.riskLevel === "eleve" || item.riskLevel === "critique";
}

export function filterUpcomingDeadlineAlerts(
  alerts: DocumentAlert[],
): DocumentAlert[] {
  return alerts
    .filter(
      (alert) =>
        !alert.dismissed &&
        (alert.kind === "deadline_soon" ||
          alert.kind === "renewal" ||
          alert.kind === "relation_deadline_conflict" ||
          Boolean(alert.dueDate)),
    )
    .sort((a, b) => {
      const aDate = a.dueDate || "9999";
      const bDate = b.dueDate || "9999";
      return aDate.localeCompare(bDate);
    })
    .slice(0, 6);
}

const RELATION_ALERT_KINDS = new Set([
  "relation_duplicate",
  "relation_supersede",
  "relation_overlap_risk",
  "relation_redundant_payment",
  "relation_deadline_conflict",
  "relation_contradiction",
]);

/** Alertes relationnelles P3 pour le tableau de bord. */
export function filterRelationAlerts(alerts: DocumentAlert[]): DocumentAlert[] {
  return alerts
    .filter(
      (alert) => !alert.dismissed && RELATION_ALERT_KINDS.has(alert.kind),
    )
    .slice(0, 6);
}

export function computeDashboardStats(
  items: HistoryListItem[],
  options?: { upcomingDeadlinesCount?: number },
): DashboardStats {
  const sorted = sortByAnalyzedAtDesc(items);
  const totalDocuments = items.length;
  const averageRiskScore =
    totalDocuments === 0
      ? 0
      : Math.round(
          items.reduce((sum, item) => sum + item.riskScore, 0) / totalDocuments,
        );

  const needsActionCount = items.filter((item) => item.needsAction).length;
  const atRiskDocuments = sorted.filter(isAtRisk);
  const atRiskCount = atRiskDocuments.length;

  const weekAgo = Date.now() - 7 * 24 * 60 * 60 * 1000;
  const analysesLast7Days = items.filter(
    (item) => new Date(item.analyzedAt).getTime() >= weekAgo,
  ).length;

  const upcomingDeadlinesCount = options?.upcomingDeadlinesCount ?? 0;

  const riskMap = new Map<string, { label: string; count: number }>();
  for (const level of ["faible", "modere", "eleve", "critique"] as const) {
    riskMap.set(level, { label: getRiskLevelLabel(level), count: 0 });
  }
  for (const item of items) {
    const current = riskMap.get(item.riskLevel);
    if (current) current.count += 1;
  }

  const categoryMap = new Map<string, { label: string; count: number }>();
  for (const item of items) {
    const current = categoryMap.get(item.category) ?? {
      label: item.categoryLabel,
      count: 0,
    };
    current.count += 1;
    categoryMap.set(item.category, current);
  }

  return {
    totalDocuments,
    totalAnalyses: totalDocuments,
    averageRiskScore,
    needsActionCount,
    atRiskCount,
    analysesLast7Days,
    upcomingDeadlinesCount,
    riskDistribution: toNamedCounts([...riskMap.entries()], totalDocuments),
    categoryDistribution: toNamedCounts(
      [...categoryMap.entries()],
      totalDocuments,
    ).slice(0, 6),
    recentDocuments: sorted.slice(0, 6),
    latestAnalyses: sorted.slice(0, 8),
    actionRequired: sorted.filter((item) => item.needsAction).slice(0, 6),
    atRiskDocuments: atRiskDocuments.slice(0, 6),
    cards: [
      {
        id: "analyses",
        label: "Analyses",
        value: String(totalDocuments),
        hint: "Documents traités",
      },
      {
        id: "week",
        label: "Cette semaine",
        value: String(analysesLast7Days),
        hint: "7 derniers jours",
      },
      {
        id: "risk",
        label: "À risque",
        value: String(atRiskCount),
        hint: "Niveau élevé ou critique",
      },
      {
        id: "deadlines",
        label: "Échéances",
        value: String(upcomingDeadlinesCount),
        hint: "Proches ou à surveiller",
      },
      {
        id: "score",
        label: "Risque moyen",
        value: totalDocuments === 0 ? "—" : `${averageRiskScore}`,
        hint: "Score sur 100",
      },
      {
        id: "actions",
        label: "À traiter",
        value: String(needsActionCount),
        hint: "Actions ou réponse requise",
      },
    ],
  };
}
