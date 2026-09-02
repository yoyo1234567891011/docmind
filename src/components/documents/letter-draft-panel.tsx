"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { ReadyReplyCard } from "@/components/documents/ready-reply-card";
import { Alert, Button } from "@/components/ui";
import { SpinnerIcon } from "@/components/ui/icons";
import { draftLetter, fetchLetterSuggestion } from "@/lib/client";
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
  const [alternativeSuggestions, setAlternativeSuggestions] = useState<
    Array<{ letterType: LetterType; reason: string }>
  >([]);
  const [letter, setLetter] = useState<ReadyReply | null>(
    initialReply?.required ? initialReply : null,
  );
  const [isLoading, setIsLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [planBlocked, setPlanBlocked] = useState(false);
  const [quotaBlocked, setQuotaBlocked] = useState(false);
  const [analyzeRemaining, setAnalyzeRemaining] = useState<number | null>(null);
  const [billingChecked, setBillingChecked] = useState(false);

  useEffect(() => {
    let cancelled = false;
    void fetchLetterSuggestion(historyId)
      .then((data) => {
        if (cancelled) return;
        setSuggestedType(data.suggestion.letterType);
        setSuggestionReason(data.suggestion.reason);
        setAlternativeSuggestions(data.suggestion.alternatives ?? []);

        const remaining = data.analyzeQuota?.remaining ?? null;

        if (data.premiumRequired === true) {
          setPlanBlocked(true);
          setQuotaBlocked(false);
          setLetter(null);
        } else {
          setPlanBlocked(false);
          setAnalyzeRemaining(remaining);
          const canGenerate = data.canGenerate ?? (remaining == null || remaining > 0);
          setQuotaBlocked(!canGenerate);
          if (canGenerate && data.currentLetter?.required) {
            setLetter(data.currentLetter);
          } else if (!canGenerate) {
            setLetter(null);
          }
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
    if (planBlocked || quotaBlocked) return;
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
      if (analyzeRemaining != null && analyzeRemaining > 0) {
        setAnalyzeRemaining(analyzeRemaining - 1);
      }
    } catch (draftError) {
      const message =
        draftError instanceof Error
          ? draftError.message
          : "Impossible de rédiger le courrier.";
      setError(message);
      if (/plan payant|offre Pro|Facturation/i.test(message)) {
        setPlanBlocked(true);
      }
      if (/quota|analyses du mois/i.test(message)) {
        setQuotaBlocked(true);
        setAnalyzeRemaining(0);
      }
    } finally {
      setIsLoading(false);
    }
  };

  const remainingLabel =
    analyzeRemaining == null
      ? null
      : analyzeRemaining === 1
        ? "1 courrier restant ce mois"
        : `${analyzeRemaining} courriers restants ce mois`;

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
          {!planBlocked && remainingLabel && !quotaBlocked ? (
            <p className="mt-2 text-xs text-[var(--muted)]">{remainingLabel}</p>
          ) : null}
          {suggestionReason ? (
            <p className="mt-2 text-xs text-[var(--muted)]">
              Suggestion :{" "}
              {suggestedType
                ? LETTER_TYPE_LABELS[suggestedType]
                : "à préciser"}{" "}
              — {suggestionReason}
            </p>
          ) : null}
          {alternativeSuggestions.length > 0 ? (
            <ul className="mt-1 list-inside list-disc text-xs text-[var(--muted)]">
              {alternativeSuggestions.map((alt) => (
                <li key={alt.letterType}>
                  {LETTER_TYPE_LABELS[alt.letterType]} — {alt.reason}
                </li>
              ))}
            </ul>
          ) : null}
        </header>

        <div className="space-y-4 px-5 py-4">
          {billingChecked && planBlocked ? (
            <Alert tone="info" title="Plan payant requis">
              L’agent courrier est inclus à partir d’un plan payant (Basique,
              Pro, Premium ou Extra).{" "}
              <Link
                href="/facturation"
                className="font-medium text-[var(--accent)] hover:underline"
              >
                Voir les plans
              </Link>
            </Alert>
          ) : billingChecked && quotaBlocked ? (
            <Alert tone="info" title="Quota analyses atteint">
              Vous avez utilisé toutes vos analyses ce mois — les courriers
              partagent ce quota.{" "}
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

      {letter && !planBlocked && !quotaBlocked ? (
        <ReadyReplyCard reply={letter} />
      ) : null}
    </div>
  );
}
