"use client";

import type { ButtonHTMLAttributes, ReactNode } from "react";

import { scrollToLandingSection } from "@/components/landing/scroll-to-section";
import { cn } from "@/lib/utils";

type LandingSectionLinkProps = {
  sectionId: string;
  children: ReactNode;
  className?: string;
  onNavigate?: () => void;
} & Omit<ButtonHTMLAttributes<HTMLButtonElement>, "type" | "onClick">;

/**
 * Lien interne landing : scroll vers une section, URL reste le pathname (pas de #).
 */
export function LandingSectionLink({
  sectionId,
  children,
  className,
  onNavigate,
  ...props
}: LandingSectionLinkProps) {
  return (
    <button
      type="button"
      className={cn(className)}
      onClick={() => {
        scrollToLandingSection(sectionId);
        onNavigate?.();
      }}
      {...props}
    >
      {children}
    </button>
  );
}
