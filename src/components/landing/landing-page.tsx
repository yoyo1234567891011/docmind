import { LandingNav } from "@/components/landing/landing-nav";
import { LandingDemo } from "@/components/landing/sections/demo";
import { LandingFaq } from "@/components/landing/sections/faq";
import { LandingFeatures } from "@/components/landing/sections/features";
import { LandingFinalCta } from "@/components/landing/sections/final-cta";
import { LandingFooter } from "@/components/landing/sections/footer";
import { LandingHero } from "@/components/landing/sections/hero";
import { LandingHowItWorks } from "@/components/landing/sections/how-it-works";
import { LandingPricing } from "@/components/landing/sections/pricing";
import { LandingTestimonials } from "@/components/landing/sections/testimonials";
import { LandingWhyUs } from "@/components/landing/sections/why-us";

/**
 * Ordre conversion (SaaS IA) :
 * Hero → preuve visuelle → différenciation → comment → features →
 * preuves → prix → objections FAQ → CTA final.
 */
export function LandingPage() {
  return (
    <div className="landing-root bg-[var(--background)] text-[var(--foreground)]">
      <LandingNav />
      <LandingHero />
      <LandingDemo />
      <LandingWhyUs />
      <LandingHowItWorks />
      <LandingFeatures />
      <LandingTestimonials />
      <LandingPricing />
      <LandingFaq />
      <LandingFinalCta />
      <LandingFooter />
    </div>
  );
}
