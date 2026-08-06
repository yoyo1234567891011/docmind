import type { Metadata } from "next";

import { HistoryDetail } from "@/components/history";

interface HistoryDetailPageProps {
  params: Promise<{ id: string }>;
}

export const metadata: Metadata = {
  title: "Analyse enregistrée",
};

export default async function HistoryDetailPage({
  params,
}: HistoryDetailPageProps) {
  const { id } = await params;

  return (
    <section className="relative isolate overflow-hidden">
      <div aria-hidden className="pointer-events-none absolute inset-0 -z-10 page-atmosphere" />

      <div className="mx-auto max-w-5xl px-5 py-12 sm:px-6">
        <HistoryDetail id={id} />
      </div>
    </section>
  );
}
