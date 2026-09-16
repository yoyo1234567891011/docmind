"use client";

import { HistoryListSkeleton } from "@/components/ui";
import type { HistoryDisplayItem } from "@/lib/dashboard-display";
import type {
  DocumentTag,
  FolderWithCount,
  HistoryListItem,
} from "@/types";

import { DocumentBoardCard } from "./document-board-card";
import { DocumentRow } from "./document-row";
import type { ManagerViewMode } from "./types";

interface DocumentListProps {
  items: HistoryDisplayItem[];
  isLoading: boolean;
  viewMode: ManagerViewMode;
  selectedId: string | null;
  busyId: string | null;
  bulkBusy: boolean;
  checkedIds: Set<string>;
  allVisibleSelected: boolean;
  tags: DocumentTag[];
  folders: FolderWithCount[];
  tagMap: Map<string, DocumentTag>;
  onSelect: (id: string) => void;
  onToggleCheck: (id: string) => void;
  onToggleSelectAll: () => void;
  onToggleFavorite: (item: HistoryListItem) => void;
  onRename: (item: HistoryListItem, name: string) => void;
  onMove: (item: HistoryListItem, folderId: string) => void;
  onToggleTag: (item: HistoryListItem, tagId: string) => void;
  onDelete: (item: HistoryListItem) => void;
}

export function DocumentList({
  items,
  isLoading,
  viewMode,
  selectedId,
  busyId,
  bulkBusy,
  checkedIds,
  allVisibleSelected,
  tags,
  folders,
  tagMap,
  onSelect,
  onToggleCheck,
  onToggleSelectAll,
  onToggleFavorite,
  onRename,
  onMove,
  onToggleTag,
  onDelete,
}: DocumentListProps) {
  if (isLoading) {
    return (
      <div className="p-4">
        <HistoryListSkeleton />
      </div>
    );
  }

  if (items.length === 0) {
    return (
      <div className="flex min-h-[280px] flex-col items-center justify-center px-6 py-16 text-center">
        <p className="font-display text-2xl text-[var(--foreground)]">
          Aucun document
        </p>
        <p className="mt-2 max-w-sm text-sm text-[var(--muted)]">
          Analysez un PDF, changez de dossier, ou assouplissez les filtres.
        </p>
      </div>
    );
  }

  if (viewMode === "board") {
    return (
      <div className="space-y-3 p-4">
        <label className="inline-flex items-center gap-2 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            disabled={bulkBusy}
            onChange={onToggleSelectAll}
            className="h-5 w-5 cursor-pointer rounded accent-[var(--accent)]"
          />
          Tout sélectionner (page visible)
        </label>
        <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
          {items.map((item) => (
            <DocumentBoardCard
              key={item.id}
              item={item}
              active={item.id === selectedId}
              checked={checkedIds.has(item.id)}
              busy={busyId === item.id || bulkBusy}
              tagMap={tagMap}
              onSelect={() => onSelect(item.id)}
              onToggleCheck={() => onToggleCheck(item.id)}
              onToggleFavorite={() => void onToggleFavorite(item)}
            />
          ))}
        </div>
      </div>
    );
  }

  return (
    <div>
      <div className="hidden border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:grid md:grid-cols-[40px_minmax(0,1.6fr)_110px_100px_140px_auto] md:items-center">
        <span className="flex justify-center">
          <input
            type="checkbox"
            checked={allVisibleSelected}
            disabled={bulkBusy}
            onChange={onToggleSelectAll}
            className="h-4 w-4 cursor-pointer rounded accent-[var(--accent)]"
            aria-label="Tout sélectionner (page visible)"
            title="Tout sélectionner (page visible)"
          />
        </span>
        <span>Nom</span>
        <span>Catégorie</span>
        <span>Risque</span>
        <span>Date</span>
        <span className="text-right">Actions</span>
      </div>
      <div className="flex items-center gap-2 border-b border-[var(--border)] px-3 py-2 md:hidden">
        <input
          type="checkbox"
          checked={allVisibleSelected}
          disabled={bulkBusy}
          onChange={onToggleSelectAll}
          className="h-5 w-5 cursor-pointer rounded accent-[var(--accent)]"
          aria-label="Tout sélectionner (page visible)"
        />
        <span className="text-xs text-[var(--muted)]">
          Tout sélectionner (visible)
        </span>
      </div>
      {items.map((item) => (
        <DocumentRow
          key={item.id}
          item={item}
          active={item.id === selectedId}
          busy={busyId === item.id || bulkBusy}
          checked={checkedIds.has(item.id)}
          tags={tags}
          folders={folders}
          tagMap={tagMap}
          onSelect={() => onSelect(item.id)}
          onToggleCheck={() => onToggleCheck(item.id)}
          onToggleFavorite={() => void onToggleFavorite(item)}
          onRename={(name) => void onRename(item, name)}
          onMove={(folderId) => void onMove(item, folderId)}
          onToggleTag={(tagId) => void onToggleTag(item, tagId)}
          onDelete={() => void onDelete(item)}
        />
      ))}
    </div>
  );
}
