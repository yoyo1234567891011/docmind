"use client";

import { useState } from "react";
import Link from "next/link";

import { Alert, Button } from "@/components/ui";
import { createManualAlert } from "@/lib/client";
import type { AlertKind } from "@/types";

type ManualKind = Extract<
  AlertKind,
  "deadline_soon" | "renewal" | "important_payment" | "termination"
>;

const KIND_OPTIONS: Array<{ id: ManualKind; label: string }> = [
  { id: "termination", label: "Préavis / résiliation" },
  { id: "renewal", label: "Renouvellement" },
  { id: "important_payment", label: "Paiement" },
  { id: "deadline_soon", label: "Autre échéance" },
];

export function CreateReminderAlert({
  historyId,
  defaultDueDate,
}: {
  historyId: string;
  /** Date ISO ou YYYY-MM-DD déjà extraite, optionnelle. */
  defaultDueDate?: string | null;
}) {
  const [open, setOpen] = useState(false);
  const [kind, setKind] = useState<ManualKind>("termination");
  const [dueDate, setDueDate] = useState(() => {
    const raw = defaultDueDate?.trim() ?? "";
    if (/^\d{4}-\d{2}-\d{2}/.test(raw)) return raw.slice(0, 10);
    return "";
  });
  const [note, setNote] = useState("");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);

  if (!open) {
    return (
      <Button
        type="button"
        variant="secondary"
        size="sm"
        onClick={() => {
          setOpen(true);
          setDone(false);
          setError(null);
        }}
      >
        Créer une alerte
      </Button>
    );
  }

  return (
    <div className="w-full max-w-md space-y-3 rounded-[var(--radius-lg)] border border-[color-mix(in_oklab,var(--border)_88%,transparent)] bg-[var(--surface-elevated)] p-4 text-left shadow-[var(--shadow-sm)]">
      <p className="text-sm font-medium text-[var(--foreground)]">
        Créer une alerte
      </p>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Rappel in-app uniquement. Les e-mails de rappel restent préparés dans
        les préférences — aucun envoi automatique pour l’instant.
      </p>

      <label className="block space-y-1 text-sm">
        <span className="text-[var(--muted)]">Type</span>
        <select
          className="ui-input"
          value={kind}
          disabled={busy}
          onChange={(e) => setKind(e.target.value as ManualKind)}
        >
          {KIND_OPTIONS.map((opt) => (
            <option key={opt.id} value={opt.id}>
              {opt.label}
            </option>
          ))}
        </select>
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-[var(--muted)]">Date</span>
        <input
          type="date"
          className="ui-input"
          value={dueDate}
          disabled={busy}
          onChange={(e) => setDueDate(e.target.value)}
          required
        />
      </label>

      <label className="block space-y-1 text-sm">
        <span className="text-[var(--muted)]">Note (optionnel)</span>
        <input
          type="text"
          className="ui-input"
          value={note}
          disabled={busy}
          maxLength={280}
          placeholder="Ex. préavis 3 mois avant reconduction"
          onChange={(e) => setNote(e.target.value)}
        />
      </label>

      {error ? (
        <Alert tone="error" title="Impossible">
          {error}
        </Alert>
      ) : null}
      {done ? (
        <Alert tone="success" title="Alerte créée">
          Visible dans{" "}
          <Link href="/alertes?focus=echeances" className="underline">
            Mes échéances
          </Link>
          .
        </Alert>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <Button
          type="button"
          size="sm"
          disabled={busy || !dueDate}
          onClick={() => {
            setBusy(true);
            setError(null);
            void createManualAlert({
              historyId,
              kind,
              dueDate,
              note: note.trim() || undefined,
            })
              .then(() => {
                setDone(true);
              })
              .catch((err) => {
                setError(
                  err instanceof Error
                    ? err.message
                    : "Création de l’alerte impossible.",
                );
              })
              .finally(() => setBusy(false));
          }}
        >
          Enregistrer
        </Button>
        <Button
          type="button"
          variant="ghost"
          size="sm"
          disabled={busy}
          onClick={() => setOpen(false)}
        >
          Fermer
        </Button>
      </div>
    </div>
  );
}
