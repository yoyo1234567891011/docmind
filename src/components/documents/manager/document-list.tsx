"use client";

import { HistoryListSkeleton } from "@/components/ui";
import type {
  DocumentTag,
  FolderWithCount,
  HistoryListItem,
} from "@/types";

import { DocumentBoardCard } from "./document-board-card";
import { DocumentRow } from "./document-row";
import type { ManagerViewMode } from "./types";

interface DocumentListProps {
  items: HistoryListItem[];
  isLoading: boolean;
  viewMode: ManagerViewMode;
  selectedId: string | null;
  busyId: string | null;
  tags: DocumentTag[];
  folders: FolderWithCount[];
  tagMap: Map<string, DocumentTag>;
  onSelect: (id: string) => void;
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
  tags,
  folders,
  tagMap,
  onSelect,
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
      <div className="grid gap-3 p-4 sm:grid-cols-2 xl:grid-cols-3">
        {items.map((item) => (
          <DocumentBoardCard
            key={item.id}
            item={item}
            active={item.id === selectedId}
            tagMap={tagMap}
            onSelect={() => onSelect(item.id)}
            onToggleFavorite={() => void onToggleFavorite(item)}
          />
        ))}
      </div>
    );
  }

  return (
    <div>
      <div className="hidden border-b border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_70%,transparent)] px-3 py-2 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)] md:grid md:grid-cols-[minmax(0,1.6fr)_110px_100px_140px_auto]">
        <span>Nom</span>
        <span>Catégorie</span>
        <span>Risque</span>
        <span>Date</span>
        <span className="text-right">Actions</span>
      </div>
      {items.map((item) => (
        <DocumentRow
          key={item.id}
          item={item}
          active={item.id === selectedId}
          busy={busyId === item.id}
          tags={tags}
          folders={folders}
          tagMap={tagMap}
          onSelect={() => onSelect(item.id)}
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
