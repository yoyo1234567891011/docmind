import type { Metadata } from "next";

import { CounterpartyTimelineView } from "@/components/insights/counterparty-timeline-view";

export const metadata: Metadata = {
  title: "Timeline contrepartie",
};

export default async function ContrepartieDetailPage({
  params,
}: {
  params: Promise<{ entityId: string }>;
}) {
  const { entityId } = await params;
  return (
    <section className="relative isolate overflow-hidden">
      <div
        aria-hidden
        className="pointer-events-none absolute inset-0 -z-10 page-atmosphere"
      />
      <div className="mx-auto max-w-6xl px-5 py-12 sm:px-6">
        <CounterpartyTimelineView entityId={entityId} />
      </div>
    </section>
  );
}
