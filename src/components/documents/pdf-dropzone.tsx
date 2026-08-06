"use client";

import {
  useCallback,
  useId,
  useRef,
  useState,
  type ChangeEvent,
  type DragEvent,
} from "react";

import { Alert, Button, ProgressBar } from "@/components/ui";
import { FileIcon, SpinnerIcon, UploadIcon } from "@/components/ui/icons";
import { MAX_UPLOAD_SIZE_BYTES } from "@/config/constants";
import { uploadPdf } from "@/lib/client";
import { validatePdfFile } from "@/lib/document-validation";
import { cn, formatBytes } from "@/lib/utils";
import type { UploadPdfResult } from "@/types";

type UploadStatus = "idle" | "uploading" | "success" | "error";

interface PdfDropzoneProps {
  onUploaded?: (result: UploadPdfResult) => void;
  onCleared?: () => void;
  onStatusChange?: (status: UploadStatus) => void;
  className?: string;
}

export function PdfDropzone({
  onUploaded,
  onCleared,
  onStatusChange,
  className,
}: PdfDropzoneProps) {
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const abortRef = useRef<AbortController | null>(null);
  const [isDragging, setIsDragging] = useState(false);
  const [selectedFile, setSelectedFile] = useState<File | null>(null);
  const [uploadResult, setUploadResult] = useState<UploadPdfResult | null>(
    null,
  );
  const [status, setStatus] = useState<UploadStatus>("idle");
  const [error, setError] = useState<string | null>(null);

  const updateStatus = useCallback(
    (next: UploadStatus) => {
      setStatus(next);
      onStatusChange?.(next);
    },
    [onStatusChange],
  );

  const uploadFile = useCallback(
    async (file: File) => {
      abortRef.current?.abort();
      const controller = new AbortController();
      abortRef.current = controller;

      setSelectedFile(file);
      setUploadResult(null);
      updateStatus("uploading");
      setError(null);

      try {
        const result = await uploadPdf(file, { signal: controller.signal });
        if (controller.signal.aborted) return;
        setUploadResult(result);
        updateStatus("success");
        onUploaded?.(result);
      } catch (uploadError) {
        if (controller.signal.aborted) {
          updateStatus("idle");
          setError(null);
          return;
        }
        updateStatus("error");
        setUploadResult(null);
        setError(
          uploadError instanceof Error
            ? uploadError.message
            : "Échec de l'envoi du fichier.",
        );
      } finally {
        if (abortRef.current === controller) abortRef.current = null;
      }
    },
    [onUploaded, updateStatus],
  );

  const applyFile = useCallback(
    (file: File | undefined) => {
      const result = validatePdfFile(file);

      if (!result.ok) {
        setSelectedFile(null);
        setUploadResult(null);
        updateStatus("error");
        setError(result.message);
        return;
      }

      void uploadFile(result.file);
    },
    [uploadFile, updateStatus],
  );

  const handleDragOver = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    if (status === "uploading") return;
    setIsDragging(true);
  };

  const handleDragLeave = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
  };

  const handleDrop = (event: DragEvent<HTMLDivElement>) => {
    event.preventDefault();
    event.stopPropagation();
    setIsDragging(false);
    if (status === "uploading") return;
    applyFile(event.dataTransfer.files?.[0]);
  };

  const handleInputChange = (event: ChangeEvent<HTMLInputElement>) => {
    if (status === "uploading") return;
    applyFile(event.target.files?.[0]);
    event.target.value = "";
  };

  const clearSelection = () => {
    abortRef.current?.abort();
    abortRef.current = null;
    setSelectedFile(null);
    setUploadResult(null);
    updateStatus("idle");
    setError(null);
    onCleared?.();
  };

  const isUploading = status === "uploading";

  return (
    <div className={cn("w-full", className)}>
      <div
        role="button"
        tabIndex={isUploading ? -1 : 0}
        aria-controls={inputId}
        aria-disabled={isUploading}
        onClick={() => {
          if (!isUploading) inputRef.current?.click();
        }}
        onKeyDown={(event) => {
          if (isUploading) return;
          if (event.key === "Enter" || event.key === " ") {
            event.preventDefault();
            inputRef.current?.click();
          }
        }}
        onDragOver={handleDragOver}
        onDragLeave={handleDragLeave}
        onDrop={handleDrop}
        className={cn(
          "group relative overflow-hidden rounded-2xl border border-dashed px-6 py-12 text-center transition-all duration-300 ease-out",
          "bg-[color-mix(in_oklab,var(--surface)_92%,transparent)] backdrop-blur-sm",
          isUploading ? "cursor-wait" : "cursor-pointer",
          isDragging
            ? "scale-[1.01] border-[var(--accent)] bg-[var(--accent-soft)]"
            : "border-[var(--border-strong)] hover:border-[var(--accent)] hover:bg-[var(--accent-soft)]",
        )}
      >
        <div
          aria-hidden
          className={cn(
            "pointer-events-none absolute inset-0 opacity-0 transition-opacity duration-300",
            "bg-[radial-gradient(circle_at_center,var(--accent-soft),transparent_70%)]",
            isDragging && "opacity-100",
          )}
        />

        <input
          ref={inputRef}
          id={inputId}
          type="file"
          accept="application/pdf,.pdf"
          className="sr-only"
          disabled={isUploading}
          onChange={handleInputChange}
        />

        <div className="relative z-10 flex flex-col items-center gap-4">
          <div
            className={cn(
              "flex h-14 w-14 items-center justify-center rounded-xl border transition-transform duration-300",
              "border-[var(--border)] bg-[var(--surface)] text-[var(--accent)]",
              isDragging && "scale-110",
            )}
          >
            {isUploading ? (
              <SpinnerIcon className="h-6 w-6" />
            ) : (
              <UploadIcon className="h-6 w-6" />
            )}
          </div>

          <div className="space-y-1.5">
            <p className="font-display text-2xl text-[var(--foreground)]">
              {isUploading ? "Extraction du texte…" : "Déposez votre PDF ici"}
            </p>
            <p className="text-sm text-[var(--muted)]">
              {isUploading
                ? "Envoi et extraction en cours"
                : `ou cliquez pour parcourir — max ${formatBytes(MAX_UPLOAD_SIZE_BYTES)}`}
            </p>
          </div>

          {isUploading ? (
            <div className="w-full max-w-xs pt-1">
              <ProgressBar indeterminate label="Envoi et extraction" />
            </div>
          ) : (
            <span className="inline-flex items-center justify-center rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-4 py-2 text-sm font-medium text-[var(--foreground)] transition-colors group-hover:border-[var(--accent)] group-hover:text-[var(--accent)]">
              Choisir un fichier
            </span>
          )}
        </div>
      </div>

      {error ? (
        <Alert tone="error" title="Import impossible" className="mt-3">
          {error}
        </Alert>
      ) : null}

      {selectedFile ? (
        <div className="animate-fade-up surface-panel mt-4 flex items-center justify-between gap-4 rounded-xl px-4 py-3">
          <div className="flex min-w-0 items-center gap-3 text-left">
            <span className="flex h-10 w-10 items-center justify-center rounded-lg bg-[var(--accent-soft)] text-[var(--accent)]">
              <FileIcon className="h-5 w-5" />
            </span>
            <div className="min-w-0">
              <p className="truncate text-sm font-medium text-[var(--foreground)]">
                {selectedFile.name}
              </p>
              <p className="text-xs text-[var(--muted)]">
                {formatBytes(selectedFile.size)}
                {status === "uploading" && " · Extraction…"}
                {status === "success" &&
                  uploadResult &&
                  ` · ${uploadResult.extraction.pageCount} page${uploadResult.extraction.pageCount > 1 ? "s" : ""} · texte prêt`}
                {status === "error" && " · Échec du traitement"}
              </p>
            </div>
          </div>
          <Button
            type="button"
            variant="ghost"
            onClick={(event) => {
              event.stopPropagation();
              clearSelection();
            }}
          >
            {isUploading ? "Annuler" : "Retirer"}
          </Button>
        </div>
      ) : null}
    </div>
  );
}
