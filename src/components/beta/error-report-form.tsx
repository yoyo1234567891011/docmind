"use client";

import { useState, type FormEvent } from "react";
import { usePathname, useSearchParams } from "next/navigation";

import { Alert, Button } from "@/components/ui";
import { submitErrorReport } from "@/lib/client/beta";
import {
  ERROR_REPORT_KIND_LABELS,
  ERROR_REPORT_KINDS,
  type ErrorReportKind,
  type ErrorReportSeverity,
} from "@/types/beta";

export function ErrorReportForm() {
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const [kind, setKind] = useState<ErrorReportKind>(
    (searchParams.get("kind") as ErrorReportKind) || "bug",
  );
  const [severity, setSeverity] = useState<ErrorReportSeverity>("medium");
  const [message, setMessage] = useState(searchParams.get("message") || "");
  const [errorDetail] = useState(searchParams.get("detail") || "");
  const [errorCode] = useState(searchParams.get("code") || "");
  const [status, setStatus] = useState<"idle" | "loading" | "ok" | "error">(
    "idle",
  );
  const [error, setError] = useState<string | null>(null);

  const onSubmit = async (event: FormEvent) => {
    event.preventDefault();
    setStatus("loading");
    setError(null);
    try {
      await submitErrorReport({
        kind,
        severity,
        message,
        page: pathname,
        errorCode: errorCode || null,
        errorDetail: errorDetail || null,
      });
      setStatus("ok");
      setMessage("");
    } catch (err) {
      setStatus("error");
      setError(
        err instanceof Error ? err.message : "Envoi impossible. Réessayez.",
      );
    }
  };

  if (status === "ok") {
    return (
      <Alert tone="success" title="Signalement enregistré">
        Merci. Nous examinerons ce problème pour la prochaine itération bêta.
      </Alert>
    );
  }

  return (
    <form onSubmit={(e) => void onSubmit(e)} className="space-y-4 text-left">
      {error ? (
        <Alert tone="error" title="Envoi échoué">
          {error}
        </Alert>
      ) : null}

      {errorDetail ? (
        <Alert tone="info" title="Contexte capturé">
          <span className="break-words text-sm">{errorDetail}</span>
        </Alert>
      ) : null}

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Type
        </span>
        <select
          value={kind}
          onChange={(e) => setKind(e.target.value as ErrorReportKind)}
          className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        >
          {ERROR_REPORT_KINDS.map((id) => (
            <option key={id} value={id}>
              {ERROR_REPORT_KIND_LABELS[id]}
            </option>
          ))}
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Gravité
        </span>
        <select
          value={severity}
          onChange={(e) => setSeverity(e.target.value as ErrorReportSeverity)}
          className="h-11 w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 text-sm outline-none focus:border-[var(--accent)]"
        >
          <option value="low">Gênant</option>
          <option value="medium">Bloquant partiel</option>
          <option value="high">Bloquant total</option>
        </select>
      </label>

      <label className="block">
        <span className="mb-1.5 block text-xs font-medium uppercase tracking-[0.08em] text-[var(--muted)]">
          Description
        </span>
        <textarea
          required
          minLength={5}
          rows={5}
          value={message}
          onChange={(e) => setMessage(e.target.value)}
          placeholder="Que s’est-il passé ? Qu’attendiez-vous ?"
          className="w-full rounded-lg border border-[var(--border-strong)] bg-[var(--surface)] px-3 py-2 text-sm outline-none focus:border-[var(--accent)]"
        />
      </label>

      <Button type="submit" disabled={status === "loading"}>
        {status === "loading" ? "Envoi…" : "Envoyer le signalement"}
      </Button>
    </form>
  );
}
