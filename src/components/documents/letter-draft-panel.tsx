"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ReadyReplyCard } from "@/components/documents/ready-reply-card";
import { Alert, Button } from "@/components/ui";
import { SpinnerIcon } from "@/components/ui/icons";
import { draftLetter, fetchBilling, fetchLetterSuggestion } from "@/lib/client";
import { cn } from "@/lib/utils";
import {
  LETTER_TYPE_LABELS,
  type LetterType,
  type ReadyReply,
} from "@/types";

const SELECTABLE_TYPES: LetterType[] = [
  "resiliation",
  "remboursement",
  "contestation",
  "reponse_administrative",
];

interface LetterDraftPanelProps {
  historyId: string;
  initialReply?: ReadyReply | null;
  onDrafted?: (letter: ReadyReply) => void;
}

export function LetterDraftPanel({
  historyId,
  initialReply,
  onDrafted,
}: LetterDraftPanelProps) {
  const [letterType, setLetterType] = useState<LetterType | "auto">("auto");
  const [suggestedType, setSuggestedType] = useState<LetterType | null>(null);
  const [suggestionReason, setSuggestionReason] = useState<string | null>(null);
  const [letter, setLetter] = useState<ReadyReply | null>(
    initialReply?.required ? initialReply : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [premiumRequired, setPremiumRequired] = useState(false);
  const [billingChecked, setBillingChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void Promise.all([
      fetchLetterSuggestion(historyId),
      fetchBilling().catch(() => null),
    ])
      .then(([data, billing]) => {
        if (cancelled) return;
        setSuggestedType(data.suggestion.letterType);
        setSuggestionReason(data.suggestion.reason);
        const hasLetter =
          billing?.entitlementsDevBypass === true ||
          billing?.entitlements?.includes("letter_agent") === true;
        const needsPremium =
          data.premiumRequired === true ||
          (billing != null && !hasLetter);
        setPremiumRequired(needsPremium);
        if (!needsPremium && data.currentLetter?.required) {
          setLetter(data.currentLetter);
        } else if (needsPremium) {
          setLetter(null);
        }
        setBillingChecked(true);
      })
      .catch(() => {
        if (!cancelled) setBillingChecked(true);
      });
    return () => {
      cancelled = true;
    };
  }, [historyId]);

  const handleGenerate = async () => {
    if (premiumRequired) return;
    setIsLoading(true);
    setError(null);
    try {
      const result = await draftLetter({
        historyId,
        letterType,
        persist: true,
      });
      setLetter(result.letter);
      onDrafted?.(result.letter);
    } catch (draftError) {
      const message =
        draftError instanceof Error
          ? draftError.message
          : "Impossible de rédiger le courrier.";
      setError(message);
      if (/Premium/i.test(message)) setPremiumRequired(true);
    } finally {
      setIsLoading(false);
    }
  };

  return (
    <div className="space-y-4">
      <section className="animate-fade-up surface-panel rounded-2xl text-left">
        <header className="border-b border-[var(--border)] px-5 py-4">
          <h3 className="font-display text-xl text-[var(--foreground)]">
            Agent courrier
          </h3>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Rédige automatiquement un courrier à partir des informations
            extraites du document.
          </p>
          {suggestionReason ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Suggestion :{" "}
              {suggestedType
                ? LETTER_TYPE_LABELS[suggestedType]
                : "à préciser"}{" "}
              — {suggestionReason}
            </p>
          ) : null}
        </header>

        <div className="space-y-4 px-5 py-4">
          {billingChecked && premiumRequired ? (
            <Alert tone="info" title="Offre Pro">
              L’agent courrier est inclus à partir de l’offre Pro.{" "}
              <Link
                href="/facturation"
                className="font-medium text-[var(--accent)] hover:underline"
              >
                Voir les plans
              </Link>
            </Alert>
          ) : (
            <>
              <div className="flex flex-wrap gap-2">
                <button
                  type="button"
                  onClick={() => setLetterType("auto")}
                  className={cn(
                    "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                    letterType === "auto"
                      ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                      : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)]",
                  )}
                >
                  Auto
                </button>
                {SELECTABLE_TYPES.map((type) => (
                  <button
                    key={type}
                    type="button"
                    onClick={() => setLetterType(type)}
                    className={cn(
                      "rounded-lg border px-3 py-1.5 text-xs transition-colors",
                      letterType === type
                        ? "border-[var(--accent)] bg-[var(--accent-soft)] text-[var(--accent)]"
                        : "border-[var(--border)] text-[var(--muted)] hover:border-[var(--border-strong)]",
                    )}
                  >
                    {LETTER_TYPE_LABELS[type]}
                  </button>
                ))}
              </div>

              <Button disabled={isLoading} onClick={() => void handleGenerate()}>
                {isLoading ? (
                  <>
                    <SpinnerIcon className="h-4 w-4" />
                    Rédaction…
                  </>
                ) : (
                  "Rédiger le courrier"
                )}
              </Button>
            </>
          )}

          {error ? (
            <Alert tone="error" title="Rédaction impossible">
              {error}
            </Alert>
          ) : null}
        </div>
      </section>

      {letter && !premiumRequired ? <ReadyReplyCard reply={letter} /> : null}
    </div>
  );
}
