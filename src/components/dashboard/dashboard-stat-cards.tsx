import type { DashboardStatCard } from "@/lib/dashboard-stats";
import { cn } from "@/lib/utils";

interface DashboardStatCardsProps {
  cards: DashboardStatCard[];
}

export function DashboardStatCards({ cards }: DashboardStatCardsProps) {
  return (
    <div className="grid gap-px overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--border)] sm:grid-cols-2 xl:grid-cols-3">
      {cards.map((card, index) => (
        <article
          key={card.id}
          className={cn(
            "bg-[var(--surface)] px-5 py-5 text-left transition-colors duration-300 hover:bg-[var(--surface-elevated)]",
            index === 0 && "animate-fade-up",
            index === 1 && "animate-fade-up-delay-1",
            index === 2 && "animate-fade-up-delay-2",
            index >= 3 && "animate-fade-up-delay-3",
          )}
        >
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {card.label}
          </p>
          <p className="mt-3 font-display text-4xl tracking-tight text-[var(--foreground)]">
            {card.value}
          </p>
          <p className="mt-2 text-sm text-[var(--muted)]">{card.hint}</p>
        </article>
      ))}
    </div>
  );
}
