"use client";

import { useCallback, useEffect, useState } from "react";

import { Alert, Button } from "@/components/ui";
import {
  fetchNotificationPreferences,
  patchNotificationPreferences,
} from "@/lib/client";
import {
  NOTIFICATION_KIND_LABELS,
  type NotificationKind,
  type NotificationPreferences,
} from "@/types";

const KIND_ORDER: NotificationKind[] = [
  "deadline_soon",
  "high_risk",
  "action_required",
  "renewal",
  "termination",
  "important_payment",
  "analysis_ready",
  "relation_duplicate",
  "relation_supersede",
  "relation_overlap_risk",
  "relation_redundant_payment",
  "relation_deadline_conflict",
  "relation_contradiction",
];

export function NotificationPreferencesPanel() {
  const [prefs, setPrefs] = useState<NotificationPreferences | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [message, setMessage] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);

  const load = useCallback(async () => {
    try {
      setPrefs(await fetchNotificationPreferences());
    } catch (loadError) {
      setError(
        loadError instanceof Error
          ? loadError.message
          : "Impossible de charger les préférences.",
      );
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  if (!prefs) {
    return (
      <p className="text-sm text-[var(--muted)]">
        Chargement des préférences…
      </p>
    );
  }

  const save = async (next: Partial<NotificationPreferences>) => {
    setSaving(true);
    setError(null);
    setMessage(null);
    try {
      const updated = await patchNotificationPreferences(next);
      setPrefs(updated);
      setMessage("Préférences enregistrées.");
    } catch (saveError) {
      setError(
        saveError instanceof Error
          ? saveError.message
          : "Enregistrement impossible.",
      );
    } finally {
      setSaving(false);
    }
  };

  return (
    <section className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-5">
      <div>
        <h2 className="font-display text-xl tracking-tight">
          Préférences de notification
        </h2>
        <p className="mt-1 text-sm text-[var(--muted)]">
          In-app actif dès maintenant. Email préparé (file d’attente) — branchez
          un fournisseur plus tard (Resend / SMTP).
        </p>
      </div>

      <div className="flex flex-wrap gap-4">
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs.inAppEnabled}
            disabled={saving}
            onChange={(e) => void save({ inAppEnabled: e.target.checked })}
          />
          Notifications dans l’app
        </label>
        <label className="inline-flex items-center gap-2 text-sm">
          <input
            type="checkbox"
            checked={prefs.emailEnabled}
            disabled={saving}
            onChange={(e) => void save({ emailEnabled: e.target.checked })}
          />
          Email (préparé, pas encore envoyé)
        </label>
      </div>

      <label className="block space-y-1.5 text-sm">
        <span className="text-[var(--muted)]">Adresse email</span>
        <input
          type="email"
          className="w-full max-w-md rounded-lg border border-[var(--border)] bg-[var(--background)] px-3 py-2"
          value={prefs.emailAddress ?? ""}
          disabled={saving}
          onChange={(e) =>
            setPrefs({ ...prefs, emailAddress: e.target.value || null })
          }
          onBlur={() =>
            void save({ emailAddress: prefs.emailAddress })
          }
          placeholder="vous@exemple.com"
        />
      </label>

      <div className="space-y-2">
        <p className="text-xs font-medium uppercase tracking-[0.1em] text-[var(--muted)]">
          Types d’alertes
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          {KIND_ORDER.map((kind) => (
            <label
              key={kind}
              className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm"
            >
              <input
                type="checkbox"
                checked={prefs.kinds[kind] !== false}
                disabled={saving}
                onChange={(e) =>
                  void save({
                    kinds: { ...prefs.kinds, [kind]: e.target.checked },
                  })
                }
              />
              {NOTIFICATION_KIND_LABELS[kind]}
            </label>
          ))}
        </div>
      </div>

      {error ? (
        <Alert tone="error" title="Erreur">
          {error}
        </Alert>
      ) : null}
      {message ? (
        <p className="text-sm text-[var(--success)]">{message}</p>
      ) : null}

      <Button
        type="button"
        variant="secondary"
        size="sm"
        disabled={saving}
        onClick={() => void save(prefs)}
      >
        Enregistrer
      </Button>
    </section>
  );
}
