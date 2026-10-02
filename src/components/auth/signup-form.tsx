"use client";

import { useState } from "react";
import Link from "next/link";

import { AuthField } from "@/components/auth/auth-field";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { docmindConfig } from "@/config/docmind";
import { trackClientAnalytics } from "@/lib/client/analytics";
import {
  getAuthEmailRedirectTo,
  isLocalAuthOrigin,
  getAuthEmailRedirectOrigin,
} from "@/lib/auth/email-redirect";
import { createClient } from "@/lib/supabase/client";

export function SignupForm() {
  const [fullName, setFullName] = useState("");
  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const [acceptedTerms, setAcceptedTerms] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState(false);
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    if (!acceptedTerms) {
      setError("Acceptez les CGU et la politique de confidentialité pour continuer.");
      setLoading(false);
      return;
    }

    if (password.length < 8) {
      setError("Le mot de passe doit contenir au moins 8 caractères.");
      setLoading(false);
      return;
    }

    try {
      const supabase = createClient();
      // Absolu → /auth/callback (jamais relatif / localhost / Vercel en dur)
      const emailRedirectTo = getAuthEmailRedirectTo(
        docmindConfig.auth.callbackPath,
      );
      const { error: signUpError } = await supabase.auth.signUp({
        email: email.trim(),
        password,
        options: {
          data: { full_name: fullName.trim() },
          emailRedirectTo,
        },
      });

      if (signUpError) {
        setError(signUpError.message);
        return;
      }

      void trackClientAnalytics("auth.signup", {
        provider: "password",
        source: "signup_form",
      });

      setDone(true);
    } catch {
      setError("Inscription impossible. Vérifiez la configuration Supabase.");
    } finally {
      setLoading(false);
    }
  }

  if (done) {
    return (
      <AuthShell
        title="Vérifiez votre email"
        subtitle="Un e-mail de confirmation vous a été envoyé."
        footer={
          <Link
            href="/auth/login"
            className="text-[var(--accent)] hover:underline"
          >
            Retour à la connexion
          </Link>
        }
      >
        <div
          role="status"
          className="rounded-xl border border-[color-mix(in_oklab,var(--warning)_45%,var(--border))] bg-[var(--warning-soft)] px-4 py-3 text-left text-sm leading-relaxed text-[var(--foreground)]"
        >
          <p>
            Un e-mail de confirmation a été envoyé à{" "}
            <strong className="break-all">{email.trim()}</strong>.
          </p>
          <p className="mt-2">Ouvrez-le pour activer votre compte.</p>
          <p className="mt-2 font-medium">
            S’il n’arrive pas en 1–2 minutes, regardez vos spams / courrier
            indésirable (expéditeur : Échélia).
          </p>
        </div>
        {isLocalAuthOrigin(getAuthEmailRedirectOrigin()) ? (
          <p className="mt-3 rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-sm text-[var(--warning)]">
            En local, le lien pointe vers <strong>127.0.0.1</strong>. Ouvrez-le
            sur <strong>cet ordinateur</strong> (pas le téléphone), avec DocMind
            démarré (<code className="text-xs">npm run dev</code>).
          </p>
        ) : null}
      </AuthShell>
    );
  }

  return (
    <AuthShell
      title="Créer un compte"
      subtitle="Vos documents restent isolés à votre compte."
      footer={
        <>
          Déjà inscrit ?{" "}
          <Link
            href="/auth/login"
            className="text-[var(--accent)] hover:underline"
          >
            Se connecter
          </Link>
        </>
      }
    >
      <form className="space-y-4" onSubmit={(e) => void onSubmit(e)}>
        <AuthField
          label="Nom"
          type="text"
          autoComplete="name"
          value={fullName}
          onChange={(e) => setFullName(e.target.value)}
        />
        <AuthField
          label="Email"
          type="email"
          autoComplete="email"
          required
          value={email}
          onChange={(e) => setEmail(e.target.value)}
        />
        <AuthField
          label="Mot de passe"
          type="password"
          autoComplete="new-password"
          required
          minLength={8}
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <label className="flex items-start gap-2 text-left text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            className="mt-0.5"
            checked={acceptedTerms}
            onChange={(e) => setAcceptedTerms(e.target.checked)}
            required
          />
          <span>
            J’accepte les{" "}
            <Link href="/cgu" className="text-[var(--accent)] hover:underline">
              CGU
            </Link>{" "}
            et la{" "}
            <Link
              href="/confidentialite"
              className="text-[var(--accent)] hover:underline"
            >
              politique de confidentialité
            </Link>
            .
          </span>
        </label>

        {error ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Création…" : "S'inscrire"}
        </Button>
      </form>
    </AuthShell>
  );
}
