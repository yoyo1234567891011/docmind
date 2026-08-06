"use client";

import Link from "next/link";

import { FileIcon, StarFilledIcon, StarIcon } from "@/components/ui/icons";
import { formatDateTime, getRiskLevelLabel } from "@/lib/format";
import { cn } from "@/lib/utils";
import type { DocumentTag, HistoryListItem } from "@/types";

interface DocumentBoardCardProps {
  item: HistoryListItem;
  active: boolean;
  tagMap: Map<string, DocumentTag>;
  onSelect: () => void;
  onToggleFavorite: () => void;
}

export function DocumentBoardCard({
  item,
  active,
  tagMap,
  onSelect,
  onToggleFavorite,
}: DocumentBoardCardProps) {
  return (
    <article
      className={cn(
        "rounded-xl border bg-[var(--surface)] p-3 transition-colors",
        active
          ? "border-[var(--accent)] shadow-[0_0_0_1px_var(--accent)]"
          : "border-[var(--border)] hover:border-[var(--border-strong)]",
      )}
    >
      <button type="button" onClick={onSelect} className="w-full text-left">
        <div className="mb-3 flex h-24 items-center justify-center rounded-lg bg-[var(--background)] text-[var(--accent)]">
          <FileIcon className="h-8 w-8 opacity-80" />
        </div>
        <p className="truncate text-sm font-medium text-[var(--foreground)]">
          {item.title}
        </p>
        <p className="mt-1 truncate text-[11px] text-[var(--muted)]">
          {item.categoryLabel} · {getRiskLevelLabel(item.riskLevel)}
        </p>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          {formatDateTime(item.analyzedAt)}
        </p>
        {item.tagIds.length > 0 ? (
          <div className="mt-2 flex flex-wrap gap-1">
            {item.tagIds.slice(0, 3).map((tagId) => {
              const tag = tagMap.get(tagId);
              if (!tag) return null;
              return (
                <span
                  key={tagId}
                  className="rounded px-1.5 py-0.5 text-[10px]"
                  style={{ background: `${tag.color}22`, color: tag.color }}
                >
                  {tag.name}
                </span>
              );
            })}
          </div>
        ) : null}
      </button>
      <div className="mt-3 flex items-center justify-between">
        <button
          type="button"
          onClick={onToggleFavorite}
          className="rounded p-1 text-[var(--muted)] hover:text-[var(--warning)]"
        >
          {item.favorite ? (
            <StarFilledIcon className="h-4 w-4 text-[var(--warning)]" />
          ) : (
            <StarIcon className="h-4 w-4" />
          )}
        </button>
        <Link
          href={`/historique/${item.id}`}
          className="text-[11px] text-[var(--accent)] hover:underline"
        >
          Analyse
        </Link>
      </div>
    </article>
  );
}
