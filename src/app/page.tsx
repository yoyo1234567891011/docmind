import type { Metadata } from "next";

import { LandingPage } from "@/components/landing";
import { siteConfig } from "@/config/site";

export const metadata: Metadata = {
  title: `${siteConfig.name} — PDF admin lus en local, pas via ChatGPT`,
  description:
    "Analysez contrats et factures en local : risques, échéances, alertes et courriers. Gratuit sans carte — sans coller vos PDF dans ChatGPT.",
};

export default function HomePage() {
  return <LandingPage />;
}
