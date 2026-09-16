"use client";

import { useCallback, useEffect, useMemo, useState } from "react";

/**
 * Sélection multi-docs (ids history visibles uniquement).
 * Esc / clearSelection vide la sélection.
 */
export function useHistoryBulkSelection(visibleIds: string[]) {
  const [selectedIds, setSelectedIds] = useState<Set<string>>(() => new Set());

  const visibleSet = useMemo(() => new Set(visibleIds), [visibleIds]);

  // Retirer les ids qui ne sont plus visibles (filtre / delete / pagination).
  useEffect(() => {
    setSelectedIds((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const id of prev) {
        if (visibleSet.has(id)) next.add(id);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [visibleSet]);

  const clearSelection = useCallback(() => {
    setSelectedIds(new Set());
  }, []);

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape") return;
      if (selectedIds.size === 0) return;
      event.preventDefault();
      clearSelection();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [selectedIds.size, clearSelection]);

  const toggle = useCallback((id: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }, []);

  const isSelected = useCallback(
    (id: string) => selectedIds.has(id),
    [selectedIds],
  );

  const allVisibleSelected =
    visibleIds.length > 0 && visibleIds.every((id) => selectedIds.has(id));

  const toggleSelectAllVisible = useCallback(() => {
    setSelectedIds((prev) => {
      const allSelected =
        visibleIds.length > 0 && visibleIds.every((id) => prev.has(id));
      if (allSelected) {
        const next = new Set(prev);
        for (const id of visibleIds) next.delete(id);
        return next;
      }
      const next = new Set(prev);
      for (const id of visibleIds) next.add(id);
      return next;
    });
  }, [visibleIds]);

  const setMany = useCallback((ids: string[], selected: boolean) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      for (const id of ids) {
        if (selected) next.add(id);
        else next.delete(id);
      }
      return next;
    });
  }, []);

  const selectedList = useMemo(() => [...selectedIds], [selectedIds]);

  return {
    selectedIds,
    selectedList,
    selectedCount: selectedIds.size,
    isSelected,
    toggle,
    toggleSelectAllVisible,
    allVisibleSelected,
    clearSelection,
    setMany,
  };
}
