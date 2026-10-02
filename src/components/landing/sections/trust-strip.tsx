import { CheckIcon } from "@/components/ui/icons";

const TRUST_ITEMS = [
  "Gratuit pour démarrer",
  "Sans carte bancaire",
  "PDF texte uniquement",
  "Compte privé isolé",
] as const;

export function LandingTrustStrip() {
  return (
    <div
      className="border-y border-[var(--hairline)] bg-[color-mix(in_oklab,var(--surface)_60%,var(--background))]"
      aria-label="Engagements Échélia"
    >
      <ul className="mx-auto grid max-w-6xl grid-cols-2 gap-px bg-[var(--hairline)] md:grid-cols-4">
        {TRUST_ITEMS.map((item) => (
          <li
            key={item}
            className="flex items-center justify-center gap-2.5 bg-[color-mix(in_oklab,var(--surface)_60%,var(--background))] px-4 py-4 text-[13px] tracking-[-0.01em] text-[var(--foreground)] sm:text-sm md:py-5"
          >
            <span
              aria-hidden
              className="flex h-5 w-5 shrink-0 items-center justify-center rounded-full bg-[var(--accent-soft)] text-[var(--accent)]"
            >
              <CheckIcon className="h-3 w-3" />
            </span>
            {item}
          </li>
        ))}
      </ul>
    </div>
  );
}
