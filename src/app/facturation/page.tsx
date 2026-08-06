import type { Metadata } from "next";
import dynamic from "next/dynamic";
import { Suspense } from "react";

const BillingView = dynamic(
  () =>
    import("@/components/billing/billing-view").then((m) => ({
      default: m.BillingView,
    })),
  {
    loading: () => (
      <div className="px-5 py-10 text-sm text-[var(--muted)]">
        Chargement de la facturation…
      </div>
    ),
  },
);

export const metadata: Metadata = {
  title: "Facturation",
  description: "Abonnement DocMind Gratuit / Premium, annulation et factures.",
};

export default function FacturationPage() {
  return (
    <Suspense
      fallback={
        <div className="px-5 py-10 text-sm text-[var(--muted)]">
          Chargement de la facturation…
        </div>
      }
    >
      <BillingView />
    </Suspense>
  );
}
