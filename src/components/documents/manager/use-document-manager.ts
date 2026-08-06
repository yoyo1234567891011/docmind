"use client";

import { useSearchParams } from "next/navigation";
import { useCallback, useEffect, useMemo, useState } from "react";

import {
  createFolder,
  createTag,
  deleteHistoryItem,
  fetchFolders,
  fetchHistory,
  fetchTags,
  patchHistoryItem,
} from "@/lib/client";
import { UNFILED_FOLDER_ID, type HistoryListItem } from "@/types";

import { buildManagerQuery } from "./build-query";
import { mapRecordToListItem } from "./map-record";
import type {
  ManagerFilters,
  ManagerMeta,
  ManagerSidebarFilter,
  ManagerViewMode,
} from "./types";

const DEFAULT_FILTERS: ManagerFilters = {
  search: "",
  category: "all",
  riskLevel: "all",
  sortBy: "analyzedAt",
  sortDir: "desc",
};

export function useDocumentManager() {
  const searchParams = useSearchParams();
  const initialFolder = searchParams.get("folder");
  const initialFavorites = searchParams.get("favorites") === "1";

  const [sidebar, setSidebar] = useState<ManagerSidebarFilter>(() => {
    if (initialFavorites) return { type: "favorites" };
    if (initialFolder) return { type: "folder", id: initialFolder };
    return { type: "all" };
  });
  const [filters, setFilters] = useState<ManagerFilters>(DEFAULT_FILTERS);
  const [viewMode, setViewMode] = useState<ManagerViewMode>("list");
  const [items, setItems] = useState<HistoryListItem[]>([]);
  const [meta, setMeta] = useState<ManagerMeta>({
    folders: [],
    unfiledCount: 0,
    tags: [],
  });
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [isLoading, setIsLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const selected = useMemo(
    () => items.find((item) => item.id === selectedId) ?? null,
    [items, selectedId],
  );

  const tagMap = useMemo(() => {
    const map = new Map(meta.tags.map((tag) => [tag.id, tag]));
    return map;
  }, [meta.tags]);

  const loadMeta = useCallback(async () => {
    const [folderData, tagData] = await Promise.all([
      fetchFolders(),
      fetchTags(),
    ]);
    setMeta({
      folders: folderData.folders,
      unfiledCount: folderData.unfiledCount,
      tags: tagData,
    });
  }, []);

  const loadDocuments = useCallback(async () => {
    setIsLoading(true);
    setError(null);
    try {
      const query = buildManagerQuery(sidebar, filters);
      const data = await fetchHistory(query);
      setItems(data);
      setSelectedId((current) => {
        if (current && data.some((item) => item.id === current)) return current;
        return data[0]?.id ?? null;
      });
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les documents.",
      );
    } finally {
      setIsLoading(false);
    }
  }, [sidebar, filters]);

  useEffect(() => {
    void loadMeta();
  }, [loadMeta]);

  useEffect(() => {
    const timeout = window.setTimeout(() => {
      void loadDocuments();
    }, 180);
    return () => window.clearTimeout(timeout);
  }, [loadDocuments]);

  const refreshItem = (record: Awaited<ReturnType<typeof patchHistoryItem>>) => {
    setItems((prev) =>
      prev.map((item) =>
        item.id === record.id
          ? mapRecordToListItem(record, item)
          : item,
      ),
    );
  };

  const withBusy = async (
    id: string,
    action: () => Promise<void>,
    fallbackMessage: string,
  ) => {
    setBusyId(id);
    setError(null);
    try {
      await action();
    } catch (actionError) {
      setError(
        actionError instanceof Error ? actionError.message : fallbackMessage,
      );
    } finally {
      setBusyId(null);
    }
  };

  const toggleFavorite = (item: HistoryListItem) =>
    withBusy(
      item.id,
      async () => {
        const record = await patchHistoryItem(item.id, {
          favorite: !item.favorite,
        });
        refreshItem(record);
        await loadMeta();
      },
      "Impossible de mettre à jour le favori.",
    );

  const rename = (item: HistoryListItem, nextName: string) =>
    withBusy(
      item.id,
      async () => {
        const record = await patchHistoryItem(item.id, {
          displayName: nextName.trim() || null,
        });
        refreshItem(record);
      },
      "Renommage impossible.",
    );

  const remove = (item: HistoryListItem) =>
    withBusy(
      item.id,
      async () => {
        await deleteHistoryItem(item.id);
        setItems((prev) => prev.filter((row) => row.id !== item.id));
        if (selectedId === item.id) setSelectedId(null);
        await loadMeta();
      },
      "Suppression impossible.",
    );

  const moveToFolder = (item: HistoryListItem, folderId: string) =>
    withBusy(
      item.id,
      async () => {
        const value = folderId === UNFILED_FOLDER_ID ? null : folderId || null;
        const record = await patchHistoryItem(item.id, { folderId: value });
        refreshItem(record);
        await loadMeta();
        if (sidebar.type === "folder") await loadDocuments();
      },
      "Déplacement impossible.",
    );

  const toggleTag = (item: HistoryListItem, tagId: string) =>
    withBusy(
      item.id,
      async () => {
        const has = item.tagIds.includes(tagId);
        const tagIds = has
          ? item.tagIds.filter((id) => id !== tagId)
          : [...item.tagIds, tagId];
        const record = await patchHistoryItem(item.id, { tagIds });
        refreshItem(record);
        if (sidebar.type === "tag") await loadDocuments();
      },
      "Mise à jour des tags impossible.",
    );

  const createNewFolder = async (name: string) => {
    await createFolder({ name: name.trim() });
    await loadMeta();
  };

  const createNewTag = async (name: string) => {
    await createTag({ name: name.trim() });
    await loadMeta();
  };

  return {
    sidebar,
    setSidebar,
    filters,
    setFilters,
    viewMode,
    setViewMode,
    items,
    meta,
    selected,
    selectedId,
    setSelectedId,
    isLoading,
    error,
    setError,
    busyId,
    tagMap,
    toggleFavorite,
    rename,
    remove,
    moveToFolder,
    toggleTag,
    createNewFolder,
    createNewTag,
    reload: loadDocuments,
  };
}
