import { type HistoryQuery } from "@/types";

import type { ManagerFilters, ManagerSidebarFilter } from "./types";

/** Construit la query API à partir du filtre sidebar + barre d’outils. */
export function buildManagerQuery(
  sidebar: ManagerSidebarFilter,
  filters: ManagerFilters,
): HistoryQuery {
  const query: HistoryQuery = {
    search: filters.search,
    sortBy: filters.sortBy,
    sortDir: filters.sortDir,
    category: filters.category,
    riskLevel: filters.riskLevel,
    folderId: "all",
    tagId: "all",
    favoritesOnly: false,
  };

  if (sidebar.type === "favorites") {
    query.favoritesOnly = true;
  } else if (sidebar.type === "folder") {
    query.folderId = sidebar.id;
  } else if (sidebar.type === "tag") {
    query.tagId = sidebar.id;
  }

  return query;
}

export function managerBreadcrumbLabel(
  sidebar: ManagerSidebarFilter,
  folders: Array<{ id: string; name: string }>,
  tags: Array<{ id: string; name: string }>,
): string {
  if (sidebar.type === "favorites") return "Favoris";
  if (sidebar.type === "folder") {
    const folder = folders.find((item) => item.id === sidebar.id);
    return folder?.name ?? "Dossier";
  }
  if (sidebar.type === "tag") {
    const tag = tags.find((item) => item.id === sidebar.id);
    return tag ? `#${tag.name}` : "Tag";
  }
  return "Tous les documents";
}
