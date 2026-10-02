import { cn } from "@/lib/utils";

type LandingSectionHeaderProps = {
  eyebrow?: string;
  title: string;
  description?: string;
  className?: string;
  titleClassName?: string;
};

export function LandingSectionHeader({
  eyebrow,
  title,
  description,
  className,
  titleClassName,
}: LandingSectionHeaderProps) {
  return (
    <header className={cn("max-w-2xl", className)}>
      {eyebrow ? (
        <p className="landing-eyebrow text-[var(--accent)]">{eyebrow}</p>
      ) : null}
      <h2
        className={cn(
          "font-display text-[2.125rem] leading-[1.08] tracking-[-0.025em] text-[var(--foreground)] sm:text-[2.75rem] lg:text-[3.25rem]",
          eyebrow ? "mt-4" : undefined,
          titleClassName,
        )}
      >
        {title}
      </h2>
      {description ? (
        <p className="mt-4 max-w-xl text-base leading-relaxed text-[var(--muted)] sm:text-[1.0625rem]">
          {description}
        </p>
      ) : null}
    </header>
  );
}
