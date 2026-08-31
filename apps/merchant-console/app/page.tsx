"use client";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/hero";
import { StatStrip } from "@/components/stat-strip";
import { HowItWorks } from "@/components/how-it-works";
import { Features } from "@/components/features";
import { CodeSection } from "@/components/code-window";
import { OrangeCTA } from "@/components/orange-cta";
import { ScrollReveal } from "@/components/ui/scroll-reveal";

export default function HomePage() {
  return (
    <>
      <SiteHeader />
      <main className="flex-1">
        <Hero />
        <StatStrip />
        <HowItWorks />
        <ScrollReveal>
          <Features />
        </ScrollReveal>
        <ScrollReveal>
          <CodeSection />
        </ScrollReveal>
        <OrangeCTA />
      </main>
      <SiteFooter />
    </>
  );
}
