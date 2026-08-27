import type {
  ApiResponse,
  CreateFolderInput,
  CreateTagInput,
  DocumentFolder,
  DocumentTag,
  FoldersListResult,
  HistoryListItem,
  HistoryQuery,
  HistoryRecord,
  PatchHistoryInput,
} from "@/types";

import { csrfHeaders } from "@/lib/client/csrf";
import { markDashboardStale } from "@/lib/client/dashboard-sync";

function toQueryString(query: HistoryQuery): string {
  const params = new URLSearchParams();

  if (query.search?.trim()) {
    params.set("search", query.search.trim());
  }
  if (query.category && query.category !== "all") {
    params.set("category", query.category);
  }
  if (query.riskLevel && query.riskLevel !== "all") {
    params.set("riskLevel", query.riskLevel);
  }
  if (query.folderId && query.folderId !== "all") {
    params.set("folderId", query.folderId);
  }
  if (query.tagId && query.tagId !== "all") {
    params.set("tagId", query.tagId);
  }
  if (query.favoritesOnly) {
    params.set("favorites", "1");
  }
  if (query.sortBy) {
    params.set("sortBy", query.sortBy);
  }
  if (query.sortDir) {
    params.set("sortDir", query.sortDir);
  }

  const value = params.toString();
  return value ? `?${value}` : "";
}

export async function fetchHistory(
  query: HistoryQuery = {},
): Promise<HistoryListItem[]> {
  const response = await fetch(`/api/history${toQueryString(query)}`, {
    cache: "no-store",
  });

  const payload = (await response.json()) as ApiResponse<{
    items: HistoryListItem[];
    total: number;
  }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data.items;
}

export async function fetchHistoryRecord(id: string): Promise<HistoryRecord> {
  const response = await fetch(`/api/history/${id}`, {
    cache: "no-store",
  });

  const payload = (await response.json()) as ApiResponse<HistoryRecord>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function deleteHistoryItem(id: string): Promise<void> {
  const response = await fetch(`/api/history/${id}`, {
    method: "DELETE",
    headers: await csrfHeaders(),
    credentials: "same-origin",
  });

  const payload = (await response.json()) as ApiResponse<{ deleted: boolean }>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  markDashboardStale("delete");
}

export async function patchHistoryItem(
  id: string,
  patch: PatchHistoryInput,
): Promise<HistoryRecord> {
  const response = await fetch(`/api/history/${id}`, {
    method: "PATCH",
    headers: await csrfHeaders({ "Content-Type": "application/json" }),
    body: JSON.stringify(patch),
    credentials: "same-origin",
  });

  const payload = (await response.json()) as ApiResponse<HistoryRecord>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  markDashboardStale("patch");
  return payload.data;
}

export async function moveHistoryToFolder(
  id: string,
  folderId: string | null,
): Promise<HistoryRecord> {
  return patchHistoryItem(id, { folderId });
}

export async function fetchFolders(): Promise<FoldersListResult> {
  const response = await fetch("/api/folders", { cache: "no-store" });
  const payload = (await response.json()) as ApiResponse<FoldersListResult>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function createFolder(
  input: CreateFolderInput,
): Promise<DocumentFolder> {
  const response = await fetch("/api/folders", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });

  const payload = (await response.json()) as ApiResponse<DocumentFolder>;

  if (!payload.success) {
    throw new Error(payload.error.message);
  }

  return payload.data;
}

export async function fetchTags(): Promise<DocumentTag[]> {
  const response = await fetch("/api/tags", { cache: "no-store" });
  const payload = (await response.json()) as ApiResponse<{ tags: DocumentTag[] }>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data.tags;
}

export async function createTag(input: CreateTagInput): Promise<DocumentTag> {
  const response = await fetch("/api/tags", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(input),
  });
  const payload = (await response.json()) as ApiResponse<DocumentTag>;
  if (!payload.success) throw new Error(payload.error.message);
  return payload.data;
}

export async function deleteTag(id: string): Promise<void> {
  const response = await fetch(`/api/tags?id=${encodeURIComponent(id)}`, {
    method: "DELETE",
  });
  const payload = (await response.json()) as ApiResponse<{ deleted: boolean }>;
  if (!payload.success) throw new Error(payload.error.message);
}

export function documentPdfUrl(documentId: string): string {
  return `/api/documents/${encodeURIComponent(documentId)}/file`;
}
