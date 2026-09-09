"use client";

import { useState } from "react";
import Link from "next/link";
import { useSearchParams } from "next/navigation";

import { AuthField } from "@/components/auth/auth-field";
import { AuthShell } from "@/components/auth/auth-shell";
import { Button } from "@/components/ui/button";
import { docmindConfig } from "@/config/docmind";
import { trackClientAnalytics } from "@/lib/client/analytics";
import { safeNextPath } from "@/lib/safe-redirect";
import { createClient } from "@/lib/supabase/client";

export function LoginForm() {
  const searchParams = useSearchParams();
  const next = safeNextPath(
    searchParams.get("next"),
    docmindConfig.auth.afterLoginPath,
  );
  const configError = searchParams.get("error") === "supabase_config";

  const [email, setEmail] = useState("");
  const [password, setPassword] = useState("");
  const authUnavailable = searchParams.get("error") === "auth_unavailable";
  const [error, setError] = useState<string | null>(
    configError
      ? "Supabase non configur?. Ajoutez NEXT_PUBLIC_SUPABASE_URL et NEXT_PUBLIC_SUPABASE_ANON_KEY dans .env.local."
      : authUnavailable
        ? "Authentification temporairement indisponible. Ce n?est pas un probl?me de mot de passe ? r?essayez dans quelques minutes."
        : null,
  );
  const [loading, setLoading] = useState(false);

  async function onSubmit(event: React.FormEvent) {
    event.preventDefault();
    setLoading(true);
    setError(null);

    try {
      const supabase = createClient();
      const { error: signInError } = await supabase.auth.signInWithPassword({
        email: email.trim(),
        password,
      });

      if (signInError) {
        setError(
          signInError.message.includes("Email not confirmed")
            ? "Confirmez votre email avant de vous connecter."
            : "Email ou mot de passe incorrect.",
        );
        return;
      }

      void trackClientAnalytics("auth.login", {
        provider: "password",
        source: "login_form",
      });

      const continueUrl = `/auth/continue?next=${encodeURIComponent(next)}`;
      // Full page load so session cookies are sent to /auth/continue.
      window.location.assign(continueUrl);
    } catch {
      setError("Impossible de se connecter. V?rifiez la configuration Supabase.");
    } finally {
      setLoading(false);
    }
  }

  return (
    <AuthShell
      title="Connexion"
      subtitle="Acc?dez ? vos analyses PDF."
      footer={
        <>
          Pas encore de compte ?{" "}
          <Link
            href="/auth/signup"
            className="text-[var(--accent)] hover:underline"
          >
            S&apos;inscrire
          </Link>
        </>
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
        <AuthField
          label="Mot de passe"
          type="password"
          autoComplete="current-password"
          required
          value={password}
          onChange={(e) => setPassword(e.target.value)}
        />

        <div className="flex justify-end">
          <Link
            href="/auth/forgot-password"
            className="text-xs text-[var(--accent)] hover:underline"
          >
            Mot de passe oubli? ?
          </Link>
        </div>

        {error ? (
          <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
            {error}
          </p>
        ) : null}

        <Button type="submit" className="w-full" disabled={loading}>
          {loading ? "Connexion?" : "Se connecter"}
        </Button>
      </form>
    </AuthShell>
  );
}
