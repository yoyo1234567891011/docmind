import { cn } from "@/lib/utils";

interface SkeletonProps {
  className?: string;
}

export function Skeleton({ className }: SkeletonProps) {
  return (
    <div
      aria-hidden
      className={cn(
        "animate-shimmer rounded-lg bg-[color-mix(in_oklab,var(--muted)_16%,transparent)]",
        className,
      )}
    />
  );
}

export function AnalysisSkeleton() {
  return (
    <div
      className="animate-fade-in space-y-4"
      role="status"
      aria-label="Analyse en cours"
    >
      <div className="surface-panel rounded-2xl p-5">
        <div className="flex items-start justify-between gap-4">
          <div className="space-y-2">
            <Skeleton className="h-5 w-40" />
            <Skeleton className="h-3 w-56" />
          </div>
          <Skeleton className="h-12 w-20" />
        </div>
        <Skeleton className="mt-5 h-2 w-full rounded" />
        <div className="mt-5 grid gap-3 sm:grid-cols-2">
          {Array.from({ length: 4 }).map((_, index) => (
            <Skeleton key={index} className="h-20 w-full rounded-xl" />
          ))}
        </div>
      </div>

      <div className="grid gap-4 md:grid-cols-2">
        {Array.from({ length: 4 }).map((_, index) => (
          <div key={index} className="surface-panel rounded-2xl p-5">
            <Skeleton className="h-4 w-28" />
            <div className="mt-4 space-y-2">
              <Skeleton className="h-3 w-full" />
              <Skeleton className="h-3 w-5/6" />
              <Skeleton className="h-3 w-2/3" />
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}

export function HistoryListSkeleton() {
  return (
    <div
      className="animate-fade-in space-y-3"
      role="status"
      aria-label="Chargement de l'historique"
    >
      {Array.from({ length: 4 }).map((_, index) => (
        <div key={index} className="surface-panel rounded-2xl px-5 py-4">
          <div className="flex flex-col gap-4 md:flex-row md:items-center md:justify-between">
            <div className="min-w-0 flex-1 space-y-2">
              <Skeleton className="h-4 w-2/3 max-w-sm" />
              <Skeleton className="h-3 w-1/2 max-w-xs" />
              <Skeleton className="h-3 w-40" />
            </div>
            <div className="flex gap-2">
              <Skeleton className="h-9 w-24" />
              <Skeleton className="h-9 w-24" />
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
