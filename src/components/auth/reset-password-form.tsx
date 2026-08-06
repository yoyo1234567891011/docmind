"use client";

import { useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { AuthField } from "@/components/auth/auth-field";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { createClient } from "@/lib/supabase/client";

export function ResetPasswordForm() {
  const router = useRouter();
  const [password, setPassword] = useState("");
  const [confirm, setConfirm] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setError(null);

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      return;
    }
    if (password !== confirm) {
      setError("Les mots de passe ne correspondent pas.");
      return;
    }

    setLoading(true);
    try {
      const supabase = createClient();
      const { error: updateError } = await supabase.auth.updateUser({
        password,
      });

      if (updateError) {
        setError(
          updateError.message.includes("session")
            ? "Lien expiré ou invalide. Demandez un nouveau reset."
            : updateError.message,
        );
        return;
      }

      router.replace("/auth/login?reset=1");
      router.refresh();
    } catch {
      setError("Mise à jour impossible.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Nouveau mot de passe"
      subtitle="Choisissez un mot de passe sécurisé."
      footer={
        <Link
          href="/auth/login"
          className="text-[var(--accent)] hover:underline"
        >
          Retour à la connexion
        </Link>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <AuthField
          label="Nouveau mot de passe"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />
        <AuthField
          label="Confirmer"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={confirm}
          onChange={(e) => setConfirm(e.target.value)}
        />

        {error ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Enregistrement…" : "Mettre à jour"}
        </Button>
      </form>
    </AuthShell>
  );
}
