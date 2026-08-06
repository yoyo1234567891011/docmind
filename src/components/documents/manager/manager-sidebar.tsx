"use client";

import { useState, type FormEvent } from "react";

import { Button } from "@/components/ui";
import { FolderIcon, PlusIcon, StarFilledIcon, TagIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";
import { UNFILED_FOLDER_ID, type DocumentTag, type FolderWithCount } from "@/types";

import type { ManagerSidebarFilter } from "./types";

interface ManagerSidebarProps {
  filter: ManagerSidebarFilter;
  folders: FolderWithCount[];
  unfiledCount: number;
  tags: DocumentTag[];
  onFilterChange: (filter: ManagerSidebarFilter) => void;
  onCreateFolder: (name: string) => Promise<void>;
  onCreateTag: (name: string) => Promise<void>;
  onError: (message: string) => void;
}

function navClass(active: boolean) {
  return cn(
    "flex w-full items-center justify-between gap-2 rounded-md px-2.5 py-1.5 text-left text-[13px] transition-colors",
    active
      ? "bg-[color-mix(in_oklab,var(--accent)_14%,transparent)] font-medium text-[var(--accent)]"
      : "text-[var(--muted)] hover:bg-[var(--surface-elevated)] hover:text-[var(--foreground)]",
  );
}

export function ManagerSidebar({
  filter,
  folders,
  unfiledCount,
  tags,
  onFilterChange,
  onCreateFolder,
  onCreateTag,
  onError,
}: ManagerSidebarProps) {
  const [folderName, setFolderName] = useState("");
  const [tagName, setTagName] = useState("");
  const [showNewFolder, setShowNewFolder] = useState(false);
  const [showNewTag, setShowNewTag] = useState(false);

  const submitFolder = async (event: FormEvent) => {
    event.preventDefault();
    if (!folderName.trim()) return;
    try {
      await onCreateFolder(folderName.trim());
      setFolderName("");
      setShowNewFolder(false);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Création du dossier impossible.",
      );
    }
  };

  const submitTag = async (event: FormEvent) => {
    event.preventDefault();
    if (!tagName.trim()) return;
    try {
      await onCreateTag(tagName.trim());
      setTagName("");
      setShowNewTag(false);
    } catch (error) {
      onError(
        error instanceof Error ? error.message : "Création du tag impossible.",
      );
    }
  };

  return (
    <aside className="flex h-full flex-col gap-5 border-r border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_88%,transparent)] px-3 py-4">
      <div className="space-y-0.5">
        <p className="mb-2 px-2.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Bibliothèque
        </p>
        <button
          type="button"
          className={navClass(filter.type === "all")}
          onClick={() => onFilterChange({ type: "all" })}
        >
          <span>Tous</span>
        </button>
        <button
          type="button"
          className={navClass(filter.type === "favorites")}
          onClick={() => onFilterChange({ type: "favorites" })}
        >
          <span className="inline-flex items-center gap-2">
            <StarFilledIcon className="h-3.5 w-3.5" />
            Favoris
          </span>
        </button>
        <button
          type="button"
          className={navClass(
            filter.type === "folder" && filter.id === UNFILED_FOLDER_ID,
          )}
          onClick={() =>
            onFilterChange({ type: "folder", id: UNFILED_FOLDER_ID })
          }
        >
          <span>Non classés</span>
          <span className="tabular-nums text-[11px] opacity-70">
            {unfiledCount}
          </span>
        </button>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <FolderIcon className="h-3 w-3" />
            Dossiers
          </p>
          <button
            type="button"
            onClick={() => setShowNewFolder((value) => !value)}
            className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--accent)]"
            aria-label="Nouveau dossier"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {showNewFolder ? (
          <form
            onSubmit={(event) => void submitFolder(event)}
            className="mb-2 space-y-1.5 px-1"
          >
            <input
              value={folderName}
              onChange={(event) => setFolderName(event.target.value)}
              placeholder="Nouveau dossier"
              className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--accent)]"
              autoFocus
            />
            <Button type="submit" size="sm" className="w-full">
              Créer
            </Button>
          </form>
        ) : null}
        <div className="space-y-0.5">
          {folders.map((folder) => (
            <button
              key={folder.id}
              type="button"
              className={navClass(
                filter.type === "folder" && filter.id === folder.id,
              )}
              onClick={() =>
                onFilterChange({ type: "folder", id: folder.id })
              }
            >
              <span className="truncate">{folder.name}</span>
              <span className="tabular-nums text-[11px] opacity-70">
                {folder.documentCount}
              </span>
            </button>
          ))}
        </div>
      </div>

      <div>
        <div className="mb-1.5 flex items-center justify-between px-2.5">
          <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
            <TagIcon className="h-3 w-3" />
            Tags
          </p>
          <button
            type="button"
            onClick={() => setShowNewTag((value) => !value)}
            className="rounded p-0.5 text-[var(--muted)] hover:text-[var(--accent)]"
            aria-label="Nouveau tag"
          >
            <PlusIcon className="h-3.5 w-3.5" />
          </button>
        </div>
        {showNewTag ? (
          <form
            onSubmit={(event) => void submitTag(event)}
            className="mb-2 space-y-1.5 px-1"
          >
            <input
              value={tagName}
              onChange={(event) => setTagName(event.target.value)}
              placeholder="Nouveau tag"
              className="h-8 w-full rounded-md border border-[var(--border)] bg-[var(--background)] px-2 text-xs outline-none focus:border-[var(--accent)]"
              autoFocus
            />
            <Button type="submit" size="sm" className="w-full">
              Créer
            </Button>
          </form>
        ) : null}
        <div className="space-y-0.5">
          {tags.length === 0 ? (
            <p className="px-2.5 text-xs text-[var(--muted)]">Aucun tag</p>
          ) : (
            tags.map((tag) => (
              <button
                key={tag.id}
                type="button"
                className={navClass(
                  filter.type === "tag" && filter.id === tag.id,
                )}
                onClick={() => onFilterChange({ type: "tag", id: tag.id })}
              >
                <span className="inline-flex min-w-0 items-center gap-2">
                  <span
                    className="h-2 w-2 shrink-0 rounded-full"
                    style={{ background: tag.color }}
                  />
                  <span className="truncate">{tag.name}</span>
                </span>
              </button>
            ))
          )}
        </div>
      </div>
    </aside>
  );
}
