import Image from "next/image";

import { siteConfig } from "@/config/site";
import { cn } from "@/lib/utils";

type BrandLockupProps = {
  className?: string;
  nameClassName?: string;
  /** Priorité LCP pour le header sticky. */
  priority?: boolean;
};

/**
 * Header : marque (~32px) + nom « Échélia ».
 * Utilise icon.png (symbole E) — logo.png est un lockup marketing
 * (texte + tagline) trop large / redondant à côté du nom HTML.
 */
export function BrandLockup({
  className,
  nameClassName,
  priority = false,
}: BrandLockupProps) {
  return (
    <span className={cn("inline-flex items-center gap-2.5", className)}>
      <Image
        src="/brand/icon.png"
        alt=""
        width={32}
        height={32}
        className="h-8 w-8 shrink-0 rounded-[0.45rem] object-cover"
        priority={priority}
      />
      <span
        className={cn(
          "font-display text-[1.375rem] leading-none tracking-tight text-[var(--foreground)]",
          nameClassName,
        )}
      >
        {siteConfig.name}
      </span>
    </span>
  );
}
