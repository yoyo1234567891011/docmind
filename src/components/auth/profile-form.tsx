"use client";

import { useEffect, useRef, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthField } from "@/components/auth/auth-field";
import { SubscriptionCard } from "@/components/dashboard/subscription-card";
import { Button } from "@/components/ui/button";
import {
  deleteAccount,
  downloadAccountExport,
  fetchMe,
  fetchQuotas,
  type MeResponse,
  type QuotaStatus,
} from "@/lib/client";
import { createClient } from "@/lib/supabase/client";
import { QUOTA_METRIC_LABELS } from "@/config/quotas";
import { BILLING_PLANS } from "@/config/billing";
import { formatAnalyzeQuotaRemaining } from "@/lib/quotas/display";
import type { BillingPlanId } from "@/types/billing";

interface ProfileFormProps {
  email: string;
  fullName: string;
}

export function ProfileForm({ email, fullName: initialName }: ProfileFormProps) {
  const router = useRouter();
  const [fullName, setFullName] = useState(initialName);
  const [password, setPassword] = useState("");
  const [message, setMessage] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);
  const [signingOut, setSigningOut] = useState(false);
  const [deleting, setDeleting] = useState(false);
  const [exporting, setExporting] = useState(false);
  const [me, setMe] = useState<MeResponse | null>(null);
  const [quotas, setQuotas] = useState<QuotaStatus | null>(null);
  const nameRef = useRef(initialName);

  useEffect(() => {
    nameRef.current = initialName;
    setFullName(initialName);
  }, [initialName]);

  useEffect(() => {
    void fetchMe()
      .then(setMe)
      .catch(() => setMe(null));
    void fetchQuotas()
      .then(setQuotas)
      .catch(() => setQuotas(null));
  }, []);

  async function handleExport() {
    setExporting(true);
    setError(null);
    setMessage(null);
    try {
      await downloadAccountExport();
      setMessage("Export ZIP téléchargé (RGPD Art. 20).");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Export impossible.");
    } finally {
      setExporting(false);
    }
  }

  async function saveProfile(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);
    setMessage(null);

    try {
      const supabase = createClient();
      const patch: {
        data?: { full_name: string };
        password?: string;
      } = {};

      if (fullName.trim() !== nameRef.current.trim()) {
        patch.data = { full_name: fullName.trim() };
      }
      if (password) {
        if (password.length < 8) {
          setError("Le mot de passe doit contenir au moins 8 caractères.");
          setLoading(false);
          return;
        }
        patch.password = password;
      }

      if (!patch.data && !patch.password) {
        setMessage("Aucune modification.");
        setLoading(false);
        return;
      }

      const { error: updateError } = await supabase.auth.updateUser(patch);
      if (updateError) {
        setError(updateError.message);
        return;
      }

      setPassword("");
      setMessage("Profil mis à jour.");
      router.refresh();
    } catch {
      setError("Mise à jour impossible.");
    } finally {
      setLoading(false);
    }
  }

  async function signOut() {
    setSigningOut(true);
    try {
      const supabase = createClient();
      await supabase.auth.signOut();
      router.replace("/auth/login");
      router.refresh();
    } finally {
      setSigningOut(false);
    }
  }

  async function handleDeleteAccount() {
    const ok = window.confirm(
      "Supprimer définitivement votre compte, documents, analyses et abonnement ? Cette action est irréversible.",
    );
    if (!ok) return;
    const typed = window.prompt('Tapez DELETE pour confirmer :');
    if (typed !== "DELETE") {
      setError("Suppression annulée.");
      return;
    }
    setDeleting(true);
    setError(null);
    try {
      await deleteAccount();
      router.replace("/auth/login?deleted=1");
      router.refresh();
    } catch (e) {
      setError(
        e instanceof Error ? e.message : "Suppression impossible.",
      );
    } finally {
      setDeleting(false);
    }
  }

  const stats = me?.stats;

  return (
    <div className="mx-auto max-w-lg space-y-6 px-5 py-10 sm:px-6">
      <div>
        <p className="text-sm text-[var(--muted)]">
          <Link href="/dashboard" className="hover:text-[var(--accent)]">
            ← Dashboard
          </Link>
        </p>
        <h1 className="mt-2 font-display text-3xl tracking-tight">Profil</h1>
        <p className="mt-1 text-sm text-[var(--muted)]">
          Compte isolé — vos documents, analyses et alertes ne sont visibles que
          par vous.
        </p>
      </div>

      <SubscriptionCard />

      {quotas ? (
        <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
          <h2 className="font-display text-xl">Quotas du mois</h2>
          <p className="mt-1 text-sm text-[var(--muted)]">
            Plan{" "}
            {BILLING_PLANS[quotas.plan as BillingPlanId]?.name ?? quotas.plan} ·{" "}
            {quotas.month}
          </p>
          <ul className="mt-4 space-y-2">
            {[...quotas.items]
              .sort((a, b) =>
                a.metric === "analyze" ? -1 : b.metric === "analyze" ? 1 : 0,
              )
              .map((item) => (
              <li
                key={item.metric}
                className="flex items-center justify-between gap-4 text-sm"
              >
                <span>
                  {QUOTA_METRIC_LABELS[item.metric]}
                  {item.metric === "analyze" && !item.unlimited ? (
                    <span className="mt-0.5 block text-xs text-[var(--muted)]">
                      {formatAnalyzeQuotaRemaining(item)}
                    </span>
                  ) : null}
                </span>
                <span className="tabular-nums text-[var(--muted)]">
                  {item.unlimited
                    ? `${item.used} / ∞`
                    : `${item.used} / ${item.limit}`}
                </span>
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      <section className="rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6">
        <h2 className="font-display text-xl">Exporter mes données</h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Archive ZIP (PDF, analyses, alertes, historique, paramètres) — droit
          à la portabilité RGPD Art. 20.
        </p>
        <Button
          type="button"
          className="mt-4"
          disabled={exporting || deleting}
          onClick={() => void handleExport()}
        >
          {exporting ? "Préparation…" : "Télécharger l’export ZIP"}
        </Button>
      </section>

      {stats ? (
        <div className="grid grid-cols-1 gap-3 md:grid-cols-3">
          {[
            ["Documents", stats.documents],
            ["Analyses", stats.analyses],
            ["Alertes", stats.alerts],
            ["Dossiers", stats.folders],
            ["Tags", stats.tags],
            ["Favoris", stats.favorites],
          ].map(([label, value]) => (
            <article
              key={String(label)}
              className="rounded-xl border border-[var(--border)] bg-[var(--surface)] px-4 py-3"
            >
              <p className="text-[10px] uppercase tracking-[0.12em] text-[var(--muted)]">
                {label}
              </p>
              <p className="mt-1 font-display text-2xl">{value}</p>
            </article>
          ))}
        </div>
      ) : null}

      <form
        className="space-y-4 rounded-2xl border border-[var(--border)] bg-[var(--surface)] p-6"
        onSubmit={(e) => void saveProfile(e)}
      >
        <AuthField label="Email" type="email" value={email} disabled readOnly />
        <AuthField
          label="Nom affiché"
          type="text"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <AuthField
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          placeholder="Laisser vide pour ne pas changer"
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        {error ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}
        {message ? (
          <p className="rounded-lg bg-[var(--success-soft)] px-3 py-2 text-sm text-[var(--success)]">
            {message}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-3">
          <Button type="submit" disabled={loading || deleting}>
            {loading ? "Enregistrement…" : "Enregistrer"}
          </Button>
          <Button
            type="button"
            variant="danger"
            disabled={signingOut || deleting}
            onClick={() => void signOut()}
          >
            {signingOut ? "Déconnexion…" : "Se déconnecter"}
          </Button>
        </div>
      </form>

      <section className="rounded-2xl border border-[var(--danger)]/40 bg-[var(--surface)] p-6 text-left">
        <h2 className="font-display text-xl text-[var(--danger)]">
          Zone dangereuse
        </h2>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Supprime vos PDF, analyses, alertes, préférences et résilie
          l’abonnement Stripe. Voir aussi{" "}
          <Link
            href="/confidentialite"
            className="text-[var(--accent)] hover:underline"
          >
            Confidentialité
          </Link>
          .
        </p>
        <Button
          type="button"
          variant="danger"
          className="mt-4"
          disabled={deleting || signingOut}
          onClick={() => void handleDeleteAccount()}
        >
          {deleting ? "Suppression…" : "Supprimer mon compte"}
        </Button>
      </section>
    </div>
  );
}
