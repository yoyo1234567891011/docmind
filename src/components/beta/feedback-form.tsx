"use client";

import { useState, type FormEvent } from "react";
import { usePathname } from "next/navigation";

import { Alert, Button } from "@/components/ui";
import { StarFilledIcon, StarIcon } from "@/components/ui/icons";
import { submitFeedback } from "@/lib/client/beta";
import {
  FEEDBACK_CATEGORIES,
  FEEDBACK_CATEGORY_LABELS,
  type FeedbackCategory,
  type FeedbackRating,
} from "@/types/beta";

const RATINGS = [1, 2, 3, 4, 5] as const;

export function FeedbackForm() {
  const pathname = usePathname();
  const [category, setCategory] = useState<FeedbackCategory>("ux");
  const [rating, setRating] = useState<FeedbackRating | "">("");
  const [hoverRating, setHoverRating] = useState<FeedbackRating | null>(null);
  const [message, setMessage] = useState("");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setError(null);
    try {
      await submitFeedback({
        category,
        rating: rating === "" ? null : rating,
        message,
        page: pathname,
      });
      setStatus("ok");
      setMessage("");
      setRating("");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Envoi impossible. Réessayez.",
      );
    }
  };

  if (status === "ok") {
    return (
      <Alert tone="success" title="Merci !">
        Votre retour a bien été enregistré. Il nous aide à améliorer la bêta.
      </Alert>
    );
  }

  const displayRating = hoverRating ?? (rating === "" ? 0 : rating);

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 text-left">
      {error ? (
        <Alert tone="error" title="Envoi échoué">
          {error}
        </Alert>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Catégorie
        </span>
        <select
          value={category}
          onChange={(e) => setCategory(e.target.value as FeedbackCategory)}
          className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        >
          {FEEDBACK_CATEGORIES.map((id) => (
            <option key={id} value={id}>
              {FEEDBACK_CATEGORY_LABELS[id]}
            </option>
          ))}
        </select>
      </label>

      <fieldset>
        <legend className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Note (optionnel)
        </legend>
        <div
          className="flex items-center gap-1"
          onMouseLeave={() => setHoverRating(null)}
        >
          {RATINGS.map((value) => {
            const filled = value <= displayRating;
            return (
              <button
                key={value}
                type="button"
                aria-label={`${value} étoile${value > 1 ? "s" : ""}`}
                aria-pressed={rating === value}
                onMouseEnter={() => setHoverRating(value)}
                onFocus={() => setHoverRating(value)}
                onBlur={() => setHoverRating(null)}
                onClick={() =>
                  setRating((current) => (current === value ? "" : value))
                }
                className={`inline-flex h-11 w-11 items-center justify-center rounded-lg transition-colors ${
                  filled
                    ? "text-[var(--warning)]"
                    : "text-[var(--muted)] hover:text-[var(--warning)]"
                }`}
              >
                {filled ? (
                  <StarFilledIcon className="h-6 w-6" />
                ) : (
                  <StarIcon className="h-6 w-6" />
                )}
              </button>
            );
          })}
        </div>
      </fieldset>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Votre message
        </span>
        <textarea
          required
          minLength={5}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Qu’avez-vous aimé ou trouvé difficile ?"
          className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <Button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Envoi…" : "Envoyer mon avis"}
      </Button>
    </form>
  );
}
