"use client";

import { Button } from "@/components/ui";
import { TrashIcon } from "@/components/ui/icons";
import { cn } from "@/lib/utils";

interface HistoryBulkActionBarProps {
  selectedCount: number;
  busy: boolean;
  onDelete: () => void;
  onCancel: () => void;
  className?: string;
}

/**
 * Barre d’actions sticky (mobile bas) dès qu’≥1 sélection.
 */
export function HistoryBulkActionBar({
  selectedCount,
  busy,
  onDelete,
  onCancel,
  className,
}: HistoryBulkActionBarProps) {
  if (selectedCount < 1) return null;

  return (
    <div
      className={cn(
        "fixed inset-x-0 bottom-0 z-40 border-t border-[var(--border)] bg-[var(--surface)] px-4 py-3 shadow-[0_-8px_24px_rgba(0,0,0,0.06)] md:sticky md:bottom-auto md:top-0 md:z-10 md:rounded-xl md:border md:shadow-none",
        className,
      )}
      role="region"
      aria-label="Actions de sélection"
    >
      <div className="mx-auto flex max-w-5xl flex-wrap items-center justify-between gap-3">
        <p className="text-sm font-medium text-[var(--foreground)]">
          {selectedCount} sélectionné{selectedCount > 1 ? "s" : ""}
        </p>
        <div className="flex items-center gap-2">
          <Button
            type="button"
            variant="secondary"
            size="sm"
            disabled={busy}
            onClick={onCancel}
          >
            Annuler
          </Button>
          <Button
            type="button"
            variant="danger"
            size="sm"
            disabled={busy}
            onClick={onDelete}
          >
            <TrashIcon className="mr-1.5 h-3.5 w-3.5" />
            {busy ? "Suppression…" : "Supprimer"}
          </Button>
        </div>
      </div>
    </div>
  );
}
