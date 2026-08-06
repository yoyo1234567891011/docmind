"use client";

import Link from "next/link";
import { useEffect, useState } from "react";

import { fetchMe } from "@/lib/client";

export function BetaBanner() {
  const [show, setShow] = useState(false);
  const [version, setVersion] = useState<string | null>(null);

  useEffect(() => {
    const env = process.env.NEXT_PUBLIC_APP_ENV?.trim().toLowerCase();
    if (env === "beta") {
      setShow(true);
      setVersion(process.env.NEXT_PUBLIC_APP_VERSION?.trim() || null);
      return;
    }

    void fetchMe()
      .then((data) => {
        if (data.runtime.env === "beta") {
          setShow(true);
          setVersion(data.runtime.version || null);
        }
      })
      .catch(() => undefined);
  }, []);

  if (!show) return null;

  return (
    <div className="border-b border-[var(--border)] bg-[var(--accent-soft)]">
      <div className="mx-auto flex max-w-6xl flex-wrap items-center justify-between gap-2 px-5 py-2 text-xs text-[var(--foreground)] sm:px-6 sm:text-sm">
        <p>
          <span className="font-medium text-[var(--accent)]">Bêta</span>
          {version ? ` · v${version}` : null}
          {" — "}
          Merci de tester DocMind. Vos retours comptent.
        </p>
        <div className="flex gap-3">
          <Link href="/feedback" className="text-[var(--accent)] hover:underline">
            Feedback
          </Link>
          <Link
            href="/signalement"
            className="text-[var(--accent)] hover:underline"
          >
            Signaler un problème
          </Link>
        </div>
      </div>
    </div>
  );
}
