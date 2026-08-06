import type { ExtractedDocumentText } from "@/types";

interface ExtractedTextPanelProps {
  extraction: ExtractedDocumentText;
  fileName?: string;
}

export function ExtractedTextPanel({
  extraction,
  fileName,
}: ExtractedTextPanelProps) {
  const hasText = extraction.text.length > 0;

  return (
    <section className="animate-fade-up surface-panel w-full rounded-2xl text-left">
      <div className="flex items-center justify-between gap-3 border-b border-[var(--border)] px-5 py-4">
        <div>
          <h2 className="font-display text-xl text-[var(--foreground)]">
            Texte extrait
          </h2>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {fileName ? `${fileName} · ` : ""}
            {extraction.pageCount} page{extraction.pageCount > 1 ? "s" : ""}
          </p>
        </div>
        <span className="text-xs text-[var(--muted)]">
          {hasText
            ? `${extraction.text.length.toLocaleString("fr-FR")} caractères`
            : "Aucun texte"}
        </span>
      </div>

      <div className="max-h-80 overflow-y-auto px-5 py-4">
        {hasText ? (
          <pre className="whitespace-pre-wrap font-sans text-sm leading-relaxed text-[var(--foreground)]">
            {extraction.text}
          </pre>
        ) : (
          <p className="text-sm text-[var(--muted)]">
            Aucun texte extractible n&apos;a été trouvé dans ce PDF (document
            scanné ou image seule).
          </p>
        )}
      </div>
    </section>
  );
}
