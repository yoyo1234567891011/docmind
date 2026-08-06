"use client";

import Link from "next/link";
import { memo, useEffect, useState } from "react";

import { FileIcon, StarFilledIcon, StarIcon, TrashIcon } from "@/components/ui/icons";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import {
  UNFILED_FOLDER_ID,
  type DocumentTag,
  type FolderWithCount,
  type HistoryListItem,
} from "@/types";

interface DocumentRowProps {
  item: HistoryListItem;
  active: boolean;
  busy: boolean;
  tags: DocumentTag[];
  folders: FolderWithCount[];
  tagMap: Map<string, DocumentTag>;
  onSelect: () => void;
  onToggleFavorite: () => void;
  onRename: (name: string) => void;
  onMove: (folderId: string) => void;
  onToggleTag: (tagId: string) => void;
  onDelete: () => void;
}

function DocumentRowInner({
  item,
  active,
  busy,
  tags,
  folders,
  tagMap,
  onSelect,
  onToggleFavorite,
  onRename,
  onMove,
  onToggleTag,
  onDelete,
}: DocumentRowProps) {
  const [editing, setEditing] = useState(false);
  const [draft, setDraft] = useState(item.title);

  useEffect(() => {
    if (!editing) setDraft(item.title);
  }, [item.title, editing]);

  const commitRename = () => {
    setEditing(false);
    if (draft.trim() && draft.trim() !== item.title) {
      onRename(draft.trim());
    }
  };

  return (
    <div
      className={cn(
        "group grid grid-cols-1 gap-2 border-b border-[var(--border)] px-3 py-2.5 transition-colors md:grid-cols-[minmax(0,1.6fr)_110px_100px_140px_auto] md:items-center",
        active
          ? "bg-[color-mix(in_oklab,var(--accent)_10%,transparent)]"
          : "hover:bg-[var(--surface-elevated)]",
      )}
    >
      <button
        type="button"
        onClick={onSelect}
        className="flex min-w-0 items-start gap-2.5 text-left"
      >
        <span className="mt-0.5 flex h-8 w-8 shrink-0 items-center justify-center rounded-md bg-[var(--background)] text-[var(--accent)]">
          <FileIcon className="h-4 w-4" />
        </span>
        <span className="min-w-0">
          {editing ? (
            <input
              value={draft}
              autoFocus
              onClick={(event) => event.stopPropagation()}
              onChange={(event) => setDraft(event.target.value)}
              onBlur={commitRename}
              onKeyDown={(event) => {
                if (event.key === "Enter") commitRename();
                if (event.key === "Escape") {
                  setDraft(item.title);
                  setEditing(false);
                }
              }}
              className="h-7 w-full rounded border border-[var(--accent)] bg-[var(--background)] px-2 text-sm outline-none"
            />
          ) : (
            <span className="flex items-center gap-1.5">
              {item.favorite ? (
                <StarFilledIcon className="h-3.5 w-3.5 shrink-0 text-[var(--warning)]" />
              ) : null}
              <span className="truncate text-sm font-medium text-[var(--foreground)]">
                {item.title}
              </span>
            </span>
          )}
          <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
            {item.fileName}
          </span>
          {item.tagIds.length > 0 ? (
            <span className="mt-1 flex flex-wrap gap-1">
              {item.tagIds.map((tagId) => {
                const tag = tagMap.get(tagId);
                if (!tag) return null;
                return (
                  <span
                    key={tagId}
                    className="rounded px-1.5 py-0.5 text-[10px] font-medium"
                    style={{
                      background: `${tag.color}22`,
                      color: tag.color,
                    }}
                  >
                    {tag.name}
                  </span>
                );
              })}
            </span>
          ) : null}
        </span>
      </button>

      <p className="truncate text-xs text-[var(--muted)] md:px-1">
        {item.categoryLabel}
      </p>
      <p className="truncate text-xs text-[var(--muted)] md:px-1">
        {getRiskLevelLabel(item.riskLevel)}
      </p>
      <p className="truncate text-xs text-[var(--muted)] md:px-1">
        {formatDateTime(item.analyzedAt)}
      </p>

      <div className="flex flex-wrap items-center gap-1 md:justify-end md:opacity-70 md:group-hover:opacity-100">
        <button
          type="button"
          disabled={busy}
          onClick={onToggleFavorite}
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--warning)]"
          title="Favori"
        >
          {item.favorite ? (
            <StarFilledIcon className="h-3.5 w-3.5 text-[var(--warning)]" />
          ) : (
            <StarIcon className="h-3.5 w-3.5" />
          )}
        </button>
        <button
          type="button"
          disabled={busy}
          onClick={() => setEditing(true)}
          className="rounded-md px-2 py-1 text-[11px] text-[var(--muted)] hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
        >
          Renommer
        </button>
        <select
          disabled={busy}
          value={item.folderId ?? UNFILED_FOLDER_ID}
          onChange={(event) => onMove(event.target.value)}
          className="h-7 max-w-[120px] rounded-md border border-[var(--border)] bg-[var(--background)] px-1 text-[11px]"
          title="Déplacer"
        >
          <option value={UNFILED_FOLDER_ID}>Non classés</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
            </option>
          ))}
        </select>
        {tags.length > 0 ? (
          <select
            disabled={busy}
            defaultValue=""
            onChange={(event) => {
              const tagId = event.target.value;
              event.target.value = "";
              if (tagId) onToggleTag(tagId);
            }}
            className="h-7 max-w-[100px] rounded-md border border-[var(--border)] bg-[var(--background)] px-1 text-[11px]"
            title="Tags"
          >
            <option value="" disabled>
              Tag
            </option>
            {tags.map((tag) => (
              <option key={tag.id} value={tag.id}>
                {item.tagIds.includes(tag.id) ? "✓ " : ""}
                {tag.name}
              </option>
            ))}
          </select>
        ) : null}
        <Link
          href={`/historique/${item.id}`}
          className="rounded-md px-2 py-1 text-[11px] text-[var(--accent)] hover:underline"
        >
          Ouvrir
        </Link>
        <button
          type="button"
          disabled={busy}
          onClick={() => {
            if (
              window.confirm(
                `Supprimer « ${item.title} » ? Cette action est définitive.`,
              )
            ) {
              onDelete();
            }
          }}
          className="rounded-md p-1.5 text-[var(--muted)] hover:bg-[var(--danger-soft)] hover:text-[var(--danger)]"
          title="Supprimer"
        >
          <TrashIcon className="h-3.5 w-3.5" />
        </button>
      </div>
    </div>
  );
}

/** Export public — memo pour éviter les rerenders liste inutiles. */
export const DocumentRow = memo(DocumentRowInner);
DocumentRow.displayName = "DocumentRow";
