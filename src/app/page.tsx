import type { Metadata } from "next";
import Link from "next/link";

import { LandingPage } from "@/components/landing";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: `${siteConfig.name} — analyse documentaire privée (pas ChatGPT)`,
  description:
    "Analysez contrats et factures : risques, échéances, alertes et courriers. PDF texte uniquement. Extraction sur nos serveurs ; analyse IA via Groq. Gratuit sans carte — pas de collage dans ChatGPT.",
};

export default function HomePage() {
  return <LandingPage />;
}
