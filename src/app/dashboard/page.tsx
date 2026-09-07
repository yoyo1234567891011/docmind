import type { Metadata } from "next";
import { redirect } from "next/navigation";

import { DashboardView } from "@/components/dashboard";
import { getOptionalUser } from "@/lib/auth";
import { hasSeenGuide, GUIDE_PATH } from "@/services/onboarding/guide";

export const metadata: Metadata = {
  title: "Tableau de bord",
};

export default async function DashboardPage() {
  const user = await getOptionalUser();
  // E2E / chaos : ne pas bloquer sur le guide (parcours Dashboard isolé).
  const skipGuideGate = process.env.DOCMIND_E2E === "1";
  if (user && !skipGuideGate) {
    const seen = await hasSeenGuide(user.id).catch(() => false);
    if (!seen) {
      redirect(GUIDE_PATH);
    }
  }

  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div
        aria-hidden
        className="page-grid pointer-events-none absolute inset-0 -z-10 opacity-30"
      />

      <div className="mx-auto max-w-6xl px-5 py-10 sm:px-6 sm:py-12">
        <DashboardView />
      </div>
    </section>
  );
}
