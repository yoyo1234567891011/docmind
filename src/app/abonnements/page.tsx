import type { Metadata } from "next";

import { SubscriptionsView } from "@/components/insights/subscriptions-view";

export const metadata: Metadata = {
  title: "Mes abonnements",
};

export default function AbonnementsPage() {
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <SubscriptionsView />
      </div>
    </section>
  );
}
