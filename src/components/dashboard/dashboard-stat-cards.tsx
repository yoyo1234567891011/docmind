import type { DashboardStatCard } from "@/lib/dashboard-stats";
import { cn } from "@/lib/utils";

interface DashboardStatCardsProps {
  cards: DashboardStatCard[];
}

export function DashboardStatCards({ cards }: DashboardStatCardsProps) {
  return (
    <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-3">
      {cards.map((card, index) => (
        <article
          key={card.id}
          className={cn(
            "ui-card ui-card-interactive group relative overflow-hidden px-5 py-5 text-left sm:px-6",
            index === 0 && "animate-fade-up",
            index === 1 && "animate-fade-up-delay-1",
            index === 2 && "animate-fade-up-delay-2",
            index >= 3 && "animate-fade-up-delay-3",
          )}
        >
          <span
            aria-hidden
            className="pointer-events-none absolute inset-x-0 top-0 h-px bg-[linear-gradient(90deg,transparent,color-mix(in_oklab,var(--accent)_55%,transparent),transparent)] opacity-0 transition-opacity duration-300 group-hover:opacity-100"
          />
          <p className="text-[11px] font-medium uppercase tracking-[0.14em] text-[var(--muted)]">
            {card.label}
          </p>
          <p className="mt-4 font-display text-[2.75rem] leading-none tracking-tight tabular-nums text-[var(--foreground)]">
            {card.value}
          </p>
          <p className="mt-3 text-sm leading-relaxed text-[var(--muted)]">
            {card.hint}
          </p>
        </article>
      ))}
    </div>
  );
}
