"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthField } from "@/components/auth/auth-field";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { docmindConfig } from "@/config/docmind";
import { createClient } from "@/lib/supabase/client";

export function ForgotPasswordForm() {
  const [email, setEmail] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const origin = window.location.origin;
      const { error: resetError } = await supabase.auth.resetPasswordForEmail(
        email.trim(),
        {
          redirectTo: `${origin}${docmindConfig.auth.callbackPath}?next=/auth/reset-password`,
        },
      );

      if (resetError) {
        setError(resetError.message);
        return;
      }

      setDone(true);
    } catch {
      setError("Envoi impossible. Vérifiez la configuration Supabase.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell
        title="Email envoyé"
        subtitle="Suivez le lien pour choisir un nouveau mot de passe."
        footer={
          <Link
            href="/auth/login"
            className="text-[var(--accent)] hover:underline"
          >
            Retour à la connexion
          </Link>
        }
      >
        <p className="text-sm text-[var(--muted)]">
          Si un compte existe pour <strong>{email}</strong>, vous recevrez un
          email sous peu.
        </p>
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Mot de passe oublié"
      subtitle="Nous vous enverrons un lien de réinitialisation."
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
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />

        {error ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Envoi…" : "Envoyer le lien"}
        </Button>
      </form>
    </AuthShell>
  );
}
