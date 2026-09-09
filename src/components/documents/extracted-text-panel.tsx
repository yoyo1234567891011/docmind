import {
  LIKELY_SCANNED_PDF_MESSAGE,
  NO_EXTRACTABLE_TEXT_MESSAGE,
} from "@/services/pdf/text-sufficiency";
import type { ExtractedDocumentText } from "@/types";

interface ExtractedTextPanelProps {
  extraction: ExtractedDocumentText;
  fileName?: string;
}

export function ExtractedTextPanel({
  extraction,
  fileName,
}: ExtractedTextPanelProps) {
  const hasText = extraction.text.replace(/\s+/g, "").length > 0;
  const isLikelyScan =
    extraction.textQuality === "likely_scan" ||
    (extraction.pageCount >= 2 &&
      hasText &&
      extraction.text.replace(/\s+/g, "").length / extraction.pageCount < 25);

  return (
    <section className="animate-fade-up surface-panel w-full rounded-2xl text-left">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="font-display text-xl text-[var(--foreground)]">
            Texte extrait
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {fileName ? `${fileName} · ` : ""}
            {extraction.pageCount} page{extraction.pageCount > 1 ? "s" : ""}
            {isLikelyScan ? " · scan probable" : ""}
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">
          {hasText
            ? `${extraction.text.length.toLocaleString("fr-FR")} caractères`
            : "Aucun texte"}
        </span>
      </div>

      <div className="max-h-80 overflow-y-auto px-5 py-4">
        {isLikelyScan ? (
          <div className="space-y-3 rounded-xl border border-[color-mix(in_oklab,var(--warning)_35%,var(--border))] bg-[color-mix(in_oklab,var(--warning-soft)_45%,var(--surface))] p-4 text-sm leading-relaxed">
            <p className="font-medium text-[var(--foreground)]">
              PDF scanné détecté
            </p>
            <p className="text-[var(--muted)]">{LIKELY_SCANNED_PDF_MESSAGE}</p>
          </div>
        ) : null}

        {hasText ? (
          <pre
            className={`whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--foreground)] ${
              isLikelyScan ? "mt-4 opacity-80" : ""
            }`}
          >
            {extraction.text}
          </pre>
        ) : (
          <div className="space-y-2 text-sm leading-relaxed text-[var(--muted)]">
            <p className="font-medium text-[var(--foreground)]">
              Aucun texte extractible dans ce PDF
            </p>
            <p>{NO_EXTRACTABLE_TEXT_MESSAGE}</p>
          </div>
        )}
      </div>
    </section>
  );
}
