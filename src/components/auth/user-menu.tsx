"use client";

import { useEffect, useState } from "react";
import Link from "next/link";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";
import { isSupabaseConfigured } from "@/lib/supabase/env";
import { createClient } from "@/lib/supabase/client";
import { cn } from "@/lib/utils";

export function UserMenu() {
  const router = useRouter();
  const [email, setEmail] = useState<string | null>(null);
  const [ready, setReady] = useState(false);
  const [open, setOpen] = useState(false);
  const configured =
    typeof window !== "undefined"
      ? Boolean(
          process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() &&
            process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim(),
        )
      : isSupabaseConfigured();

  useEffect(() => {
    if (
      !process.env.NEXT_PUBLIC_SUPABASE_URL?.trim() ||
      !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY?.trim()
    ) {
      setEmail(null);
      setReady(true);
      return undefined;
    }

    try {
      const supabase = createClient();
      void supabase.auth.getUser().then(({ data }) => {
        setEmail(data.user?.email ?? null);
        setReady(true);
      });

      const {
        data: { subscription },
      } = supabase.auth.onAuthStateChange((_event, session) => {
        setEmail(session?.user?.email ?? null);
        setReady(true);
      });

      return () => subscription.unsubscribe();
    } catch {
      setEmail(null);
      setReady(true);
      return undefined;
    }
  }, []);

  if (!ready) {
    return (
      <div className="h-9 w-20 animate-pulse rounded-lg bg-[var(--surface)]" />
    );
  }

  if (!configured) {
    return null;
  }

  if (!email) {
    return (
      <div className="flex items-center gap-1.5">
        <Link
          href="/auth/login"
          className="inline-flex h-9 items-center rounded-lg px-3 text-sm text-[var(--muted)] transition-colors hover:bg-[var(--surface)] hover:text-[var(--foreground)]"
        >
          Connexion
        </Link>
        <Link
          href="/auth/signup"
          className="inline-flex h-9 items-center rounded-lg bg-[var(--accent)] px-3 text-sm font-medium text-[var(--accent-foreground)] transition-colors hover:bg-[var(--accent-hover)]"
        >
          S&apos;inscrire
        </Link>
      </div>
    );
  }

  const initial = email.slice(0, 1).toUpperCase();

  async function signOut() {
    const supabase = createClient();
    await supabase.auth.signOut();
    router.replace("/auth/login");
    router.refresh();
  }

  return (
    <div className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border border-[var(--border)] bg-[var(--surface)] text-sm font-medium text-[var(--accent)]",
          open && "ring-2 ring-[var(--ring)]",
        )}
        aria-label="Menu compte"
      >
        {initial}
      </button>

      {open ? (
        <div className="absolute right-0 z-40 mt-2 w-56 rounded-xl border border-[var(--border)] bg-[var(--surface)] p-2 shadow-lg">
          <p className="truncate px-2 py-1.5 text-xs text-[var(--muted)]">
            {email}
          </p>
          <Link
            href="/profil"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2 py-2 text-sm hover:bg-[var(--accent-soft)]"
          >
            Profil
          </Link>
          <Link
            href="/facturation"
            onClick={() => setOpen(false)}
            className="block rounded-lg px-2 py-2 text-sm hover:bg-[var(--accent-soft)]"
          >
            Facturation
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="w-full justify-start"
            onClick={() => void signOut()}
          >
            Se déconnecter
          </Button>
        </div>
      ) : null}
    </div>
  );
}
