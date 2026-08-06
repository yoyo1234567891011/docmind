"use client";

import { cn } from "@/lib/utils";

interface PdfPreviewProps {
  documentId: string | null;
  title?: string;
  className?: string;
}

export function PdfPreview({ documentId, title, className }: PdfPreviewProps) {
  if (!documentId) {
    return (
      <div
        className={cn(
          "flex h-full min-h-[280px] items-center justify-center rounded-lg border border-dashed border-[var(--border-strong)] bg-[var(--background)] px-6 text-center",
          className,
        )}
      >
        <div>
          <p className="font-display text-lg text-[var(--foreground)]">
            Aperçu PDF
          </p>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Sélectionnez un document pour l’afficher ici.
          </p>
        </div>
      </div>
    );
  }

  return (
    <div
      className={cn(
        "flex h-full min-h-[360px] flex-col overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--background)]",
        className,
      )}
    >
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-3 py-2">
        <p className="truncate text-xs font-medium text-[var(--foreground)]">
          {title || "Aperçu"}
        </p>
        <a
          href={`/api/documents/${encodeURIComponent(documentId)}/file`}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11px] text-[var(--accent)] hover:underline"
        >
          Nouvel onglet
        </a>
      </div>
      <iframe
        title={title || "Aperçu PDF"}
        src={`/api/documents/${encodeURIComponent(documentId)}/file`}
        className="min-h-[360px] w-full flex-1 bg-[var(--background-deep)]"
      />
    </div>
  );
}
