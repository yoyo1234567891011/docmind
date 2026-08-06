import type { Metadata } from "next";

import { FeedbackForm } from "@/components/beta/feedback-form";

export const metadata: Metadata = {
  title: "Feedback",
};

export default function FeedbackPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 page-atmosphere" />
      <div className="mx-auto max-w-xl px-5 py-12 sm:px-6 sm:py-16">
        <div className="mb-8 text-left">
          <p className="text-[11px] font-medium uppercase tracking-[0.18em] text-[var(--accent)]">
            Bêta
          </p>
          <h1 className="mt-2 font-display text-4xl tracking-tight text-[var(--foreground)]">
            Votre avis
          </h1>
          <p className="mt-2 text-sm leading-relaxed text-[var(--muted)]">
            Dites-nous ce qui fonctionne, ce qui bloque, ou ce qu’il faudrait
            ajouter. Les retours sont lus par l’équipe produit.
          </p>
        </div>
        <div className="surface-panel rounded-2xl p-5 sm:p-6">
          <FeedbackForm />
        </div>
      </div>
    </section>
  );
}
