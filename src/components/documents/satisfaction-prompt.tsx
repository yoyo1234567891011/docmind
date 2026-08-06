"use client";

import { useState } from "react";

import { trackClientAnalytics } from "@/lib/client/analytics";
import { cn } from "@/lib/utils";

interface SatisfactionPromptProps {
  historyId?: string;
  documentId?: string;
  documentType?: string;
  className?: string;
}

export function SatisfactionPrompt({
  historyId,
  documentId,
  documentType,
  className,
}: SatisfactionPromptProps) {
  const [rating, setRating] = useState<number | null>(null);
  const [sending, setSending] = useState(false);
  const [done, setDone] = useState(false);

  const submit = async (value: number) => {
    if (sending || done) return;
    setSending(true);
    setRating(value);
    await trackClientAnalytics("satisfaction.rated", {
      rating: value,
      historyId: historyId ?? null,
      documentId: documentId ?? null,
      documentType: documentType ?? null,
    });
    setSending(false);
    setDone(true);
  };

  if (done) {
    return (
      <p className={cn("text-sm text-[var(--muted)]", className)}>
        Merci pour votre retour ({rating}/5).
      </p>
    );
  }

  return (
    <div
      className={cn(
        "flex flex-wrap items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3",
        className,
      )}
    >
      <p className="text-sm text-[var(--foreground)]">
        Cette analyse vous a-t-elle été utile ?
      </p>
      <div className="flex gap-1" role="group" aria-label="Note de satisfaction">
        {[1, 2, 3, 4, 5].map((value) => (
          <button
            key={value}
            type="button"
            disabled={sending}
            onClick={() => void submit(value)}
            className="h-9 w-9 rounded-lg border border-[var(--border)] text-sm font-medium text-[var(--foreground)] transition hover:border-[var(--accent)] hover:text-[var(--accent)] disabled:opacity-50"
            aria-label={`${value} sur 5`}
          >
            {value}
          </button>
        ))}
      </div>
    </div>
  );
}
