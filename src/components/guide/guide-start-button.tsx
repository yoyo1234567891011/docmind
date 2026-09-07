"use client";

import { useState } from "react";
import { useRouter } from "next/navigation";

import { Button } from "@/components/ui/button";

const LOCAL_FALLBACK_KEY = "docmind.guideSeen";
const AFTER_GUIDE_PATH = "/analyser";

export function GuideStartButton() {
  const router = useRouter();
  const [loading, setLoading] = useState(false);

  async function onStart() {
    setLoading(true);
    try {
      const response = await fetch("/api/me/guide", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        credentials: "same-origin",
      });
      if (response.ok) {
        try {
          localStorage.setItem(LOCAL_FALLBACK_KEY, "1");
        } catch {
          // ignore
        }
        router.replace(AFTER_GUIDE_PATH);
        router.refresh();
        return;
      }
      if (response.status === 401) {
        router.replace(
          `/auth/login?next=${encodeURIComponent("/auth/continue")}`,
        );
        return;
      }
    } catch {
      // Réseau KO : on avance quand même pour ne pas bloquer.
    }
    router.replace(AFTER_GUIDE_PATH);
    router.refresh();
  }

  return (
    <div className="mt-8 space-y-3">
      <Button
        type="button"
        className="min-w-[10rem] w-full sm:w-auto"
        disabled={loading}
        onClick={() => void onStart()}
      >
        {loading ? "Un instant…" : "Commencer"}
      </Button>
      <p className="text-xs leading-relaxed text-[var(--muted)]">
        Rien de bloquant — vous pourrez rouvrir ce guide quand vous voulez via
        le menu.
      </p>
    </div>
  );
}
