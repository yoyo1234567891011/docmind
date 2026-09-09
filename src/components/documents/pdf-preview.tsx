"use client";

import { useEffect, useState } from "react";

import { cn } from "@/lib/utils";

interface PdfPreviewProps {
  documentId: string | null;
  title?: string;
  className?: string;
}

/**
 * Aperçu PDF via blob URL (évite le blocage Chrome quand l’API
 * a X-Frame-Options: DENY / frame-ancestors 'none' sur la réponse).
 */
export function PdfPreview({ documentId, title, className }: PdfPreviewProps) {
  const [blobUrl, setBlobUrl] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    if (!documentId) {
      setBlobUrl(null);
      setError(null);
      setLoading(false);
      return;
    }

    let cancelled = false;
    let objectUrl: string | null = null;
    setLoading(true);
    setError(null);
    setBlobUrl(null);

    void (async () => {
      try {
        const res = await fetch(
          `/api/documents/${encodeURIComponent(documentId)}/file`,
          { credentials: "same-origin", cache: "no-store" },
        );
        if (!res.ok) {
          throw new Error(
            res.status === 401 || res.status === 403
              ? "Accès au fichier refusé."
              : res.status === 404
                ? "Fichier PDF introuvable."
                : `Impossible de charger l’aperçu (${res.status}).`,
          );
        }
        const blob = await res.blob();
        if (cancelled) return;
        // Force type PDF pour le viewer navigateur
        const pdfBlob =
          blob.type === "application/pdf"
            ? blob
            : new Blob([blob], { type: "application/pdf" });
        objectUrl = URL.createObjectURL(pdfBlob);
        if (cancelled) {
          URL.revokeObjectURL(objectUrl);
          objectUrl = null;
          return;
        }
        setBlobUrl(objectUrl);
      } catch (e) {
        if (!cancelled) {
          setError(
            e instanceof Error ? e.message : "Aperçu PDF indisponible.",
          );
        }
      } finally {
        if (!cancelled) setLoading(false);
      }
    })();

    return () => {
      cancelled = true;
      if (objectUrl) URL.revokeObjectURL(objectUrl);
    };
  }, [documentId]);

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

  const fileHref = `/api/documents/${encodeURIComponent(documentId)}/file`;

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
          href={fileHref}
          target="_blank"
          rel="noreferrer"
          className="shrink-0 text-[11px] text-[var(--accent)] hover:underline"
        >
          Nouvel onglet
        </a>
      </div>

      {loading ? (
        <div className="flex min-h-[360px] flex-1 items-center justify-center text-sm text-[var(--muted)]">
          Chargement de l’aperçu…
        </div>
      ) : error ? (
        <div className="flex min-h-[360px] flex-1 flex-col items-center justify-center gap-2 px-4 text-center">
          <p className="text-sm text-[var(--danger)]">{error}</p>
          <a
            href={fileHref}
            target="_blank"
            rel="noreferrer"
            className="text-sm text-[var(--accent)] hover:underline"
          >
            Ouvrir le PDF dans un nouvel onglet
          </a>
        </div>
      ) : blobUrl ? (
        <iframe
          title={title || "Aperçu PDF"}
          src={blobUrl}
          className="min-h-[360px] w-full flex-1 bg-[var(--background-deep)]"
        />
      ) : null}
    </div>
  );
}
