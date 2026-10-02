"use client";

import { useEffect, useRef, useState } from "react";
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
  const rootRef = useRef<HTMLDivElement>(null);
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

  useEffect(() => {
    if (!open) return;
    const onPointer = (event: PointerEvent) => {
      if (!rootRef.current?.contains(event.target as Node)) setOpen(false);
    };
    const onKey = (event: KeyboardEvent) => {
      if (event.key === "Escape") setOpen(false);
    };
    document.addEventListener("pointerdown", onPointer);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("pointerdown", onPointer);
      document.removeEventListener("keydown", onKey);
    };
  }, [open]);

  if (!ready) {
    return (
      <div className="hidden h-9 w-9 animate-shimmer rounded-[var(--radius-md)] bg-[color-mix(in_oklab,var(--muted)_12%,transparent)] xl:block xl:w-20" />
    );
  }

  if (!configured) {
    return null;
  }

  if (!email) {
    return (
      <div className="hidden items-center gap-1.5 xl:flex">
        <Link
          href="/auth/login"
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] px-3 text-sm text-[var(--muted)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)] hover:text-[var(--foreground)]"
        >
          Connexion
        </Link>
        <Link
          href="/auth/signup"
          className="inline-flex h-9 items-center rounded-[var(--radius-md)] bg-[var(--accent)] px-3.5 text-sm font-medium text-[var(--accent-foreground)] shadow-[inset_0_1px_0_color-mix(in_oklab,white_18%,transparent),var(--shadow-accent)] transition-[background-color,transform] duration-150 hover:bg-[var(--accent-hover)] active:scale-[0.98]"
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
    <div ref={rootRef} className="relative">
      <button
        type="button"
        onClick={() => setOpen((v) => !v)}
        className={cn(
          "flex h-9 w-9 items-center justify-center rounded-full border border-[var(--hairline)] bg-[linear-gradient(160deg,var(--accent-soft),var(--surface))] text-sm font-semibold text-[var(--accent)] shadow-[var(--highlight),var(--shadow-xs)] transition-[box-shadow,transform] duration-150 hover:shadow-[var(--highlight),var(--shadow-sm)] active:scale-95",
          open && "ring-2 ring-[var(--ring)] ring-offset-2 ring-offset-[var(--background)]",
        )}
        aria-label="Menu compte"
        aria-expanded={open}
        aria-haspopup="menu"
      >
        {initial}
      </button>

      {open ? (
        <div
          role="menu"
          className="animate-fade-in absolute right-0 z-40 mt-2 w-60 origin-top-right rounded-[var(--radius-lg)] border border-[var(--hairline)] bg-[var(--surface)] p-1.5 shadow-[var(--highlight),var(--shadow-lg)]"
        >
          <p className="mb-1 truncate border-b border-[var(--hairline)] px-2.5 pb-2.5 pt-1.5 text-xs text-[var(--muted)]">
            {email}
          </p>
          <Link
            href="/profil"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-[var(--radius-md)] px-2.5 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]"
          >
            Profil
          </Link>
          <Link
            href="/facturation"
            role="menuitem"
            onClick={() => setOpen(false)}
            className="block rounded-[var(--radius-md)] px-2.5 py-2 text-sm text-[var(--foreground)] transition-colors hover:bg-[color-mix(in_oklab,var(--foreground)_5%,transparent)]"
          >
            Facturation
          </Link>
          <Button
            type="button"
            variant="ghost"
            size="sm"
            className="mt-1 w-full justify-start px-2.5 text-sm"
            onClick={() => void signOut()}
          >
            Se déconnecter
          </Button>
        </div>
      ) : null}
    </div>
  );
}
