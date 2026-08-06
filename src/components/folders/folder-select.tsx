"use client";

import { useEffect, useState } from "react";

import { SpinnerIcon } from "@/components/ui/icons";
import { fetchFolders, moveHistoryToFolder } from "@/lib/client";
import { cn } from "@/lib/utils";
import { UNFILED_FOLDER_ID, type DocumentFolder } from "@/types";

interface FolderSelectProps {
  historyId: string;
  value: string | null;
  onMoved?: (folderId: string | null) => void;
  className?: string;
  size?: "sm" | "md";
}

export function FolderSelect({
  historyId,
  value,
  onMoved,
  className,
  size = "md",
}: FolderSelectProps) {
  const [folders, setFolders] = useState<DocumentFolder[]>([]);
  const [current, setCurrent] = useState<string>(value ?? UNFILED_FOLDER_ID);
  const [isLoading, setIsLoading] = useState(true);
  const [isSaving, setIsSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    setCurrent(value ?? UNFILED_FOLDER_ID);
  }, [value]);

  useEffect(() => {
    let cancelled = false;

    const load = async () => {
      setIsLoading(true);
      try {
        const data = await fetchFolders();
        if (!cancelled) {
          setFolders(data.folders);
        }
      } catch (loadError) {
        if (!cancelled) {
          setError(
            loadError instanceof Error
              ? loadError.message
              : "Impossible de charger les dossiers.",
          );
        }
      } finally {
        if (!cancelled) setIsLoading(false);
      }
    };

    void load();
    return () => {
      cancelled = true;
    };
  }, []);

  const handleChange = async (nextValue: string) => {
    const nextFolderId =
      nextValue === UNFILED_FOLDER_ID ? null : nextValue;
    setCurrent(nextValue);
    setIsSaving(true);
    setError(null);

    try {
      await moveHistoryToFolder(historyId, nextFolderId);
      onMoved?.(nextFolderId);
    } catch (moveError) {
      setCurrent(value ?? UNFILED_FOLDER_ID);
      setError(
        moveError instanceof Error
          ? moveError.message
          : "Déplacement impossible.",
      );
    } finally {
      setIsSaving(false);
    }
  };

  return (
    <div className={cn("text-left", className)}>
      <label className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
        Dossier
      </label>
      <div className="relative">
        <select
          value={current}
          disabled={isLoading || isSaving}
          onChange={(event) => {
            void handleChange(event.target.value);
          }}
          className={cn(
            "w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] text-[var(--foreground)] outline-none transition-colors focus:border-[var(--accent)] disabled:opacity-60",
            size === "sm" ? "h-8 px-2 text-xs" : "h-9 px-3 text-sm",
          )}
        >
          <option value={UNFILED_FOLDER_ID}>Non classés</option>
          {folders.map((folder) => (
            <option key={folder.id} value={folder.id}>
              {folder.name}
              {folder.system ? "" : " (perso)"}
            </option>
          ))}
        </select>
        {isSaving ? (
          <SpinnerIcon className="pointer-events-none absolute right-8 top-1/2 h-3.5 w-3.5 -translate-y-1/2 text-[var(--muted)]" />
        ) : null}
      </div>
      {error ? (
        <p className="mt-1 text-xs text-[var(--danger)]">{error}</p>
      ) : null}
    </div>
  );
}
