"use client";

import Link from "next/link";

import { PdfPreview } from "@/components/documents/pdf-preview";
import { TagIcon } from "@/components/ui/icons";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentTag, HistoryListItem } from "@/types";

interface DocumentPreviewPaneProps {
  selected: HistoryListItem | null;
  tags: DocumentTag[];
  onToggleTag: (item: HistoryListItem, tagId: string) => void;
}

export function DocumentPreviewPane({
  selected,
  tags,
  onToggleTag,
}: DocumentPreviewPaneProps) {
  return (
    <aside className="flex h-full min-h-[420px] flex-col border-l border-[var(--border)] bg-[color-mix(in_oklab,var(--surface)_90%,transparent)]">
      <div className="border-b border-[var(--border)] px-4 py-3">
        <p className="text-[10px] font-semibold uppercase tracking-[0.14em] text-[var(--muted)]">
          Aperçu
        </p>
        {selected ? (
          <div className="mt-1">
            <p className="truncate text-sm font-medium text-[var(--foreground)]">
              {selected.title}
            </p>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              {selected.categoryLabel} · {getRiskLevelLabel(selected.riskLevel)}{" "}
              · {formatDateTime(selected.analyzedAt)}
            </p>
          </div>
        ) : (
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sélectionnez un document
          </p>
        )}
      </div>

      <div className="min-h-0 flex-1 p-3">
        <PdfPreview
          documentId={selected?.documentId ?? null}
          title={selected?.title}
        />
      </div>

      {selected ? (
        <div className="space-y-3 border-t border-[var(--border)] px-4 py-3">
          <div className="flex items-center justify-between gap-2">
            <p className="inline-flex items-center gap-1.5 text-[10px] font-semibold uppercase tracking-[0.12em] text-[var(--muted)]">
              <TagIcon className="h-3 w-3" />
              Tags
            </p>
            <Link
              href={`/historique/${selected.id}`}
              className="text-xs font-medium text-[var(--accent)] hover:underline"
            >
              Voir l’analyse
            </Link>
          </div>
          {tags.length === 0 ? (
            <p className="text-xs text-[var(--muted)]">
              Créez un tag dans la barre latérale.
            </p>
          ) : (
            <div className="flex flex-wrap gap-1.5">
              {tags.map((tag) => {
                const active = selected.tagIds.includes(tag.id);
                return (
                  <button
                    key={tag.id}
                    type="button"
                    onClick={() => onToggleTag(selected, tag.id)}
                    className={cn(
                      "rounded-md px-2.5 py-1 text-xs transition-colors",
                      active
                        ? "text-white"
                        : "border border-[var(--border)] text-[var(--muted)] hover:text-[var(--foreground)]",
                    )}
                    style={active ? { background: tag.color } : undefined}
                  >
                    {tag.name}
                  </button>
                );
              })}
            </div>
          )}
        </div>
      ) : null}
    </aside>
  );
}
