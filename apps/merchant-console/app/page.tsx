"use client";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/hero";
import { StatStrip } from "@/components/stat-strip";
import { HowItWorks } from "@/components/how-it-works";
import { TraceReplay } from "@/components/trace-replay";
import { Discovery } from "@/components/discovery";
import { Features } from "@/components/features";
import { PolicyRules } from "@/components/policy-rules";
import { ConsolePreview } from "@/components/console-preview";
import { Security } from "@/components/security";
import { CodeSection } from "@/components/code-window";
import { OrangeCTA } from "@/components/orange-cta";
import { ScrollReveal } from "@/components/ui/scroll-reveal";
import { AmbientVideoBg } from "@/components/ui/ambient-video-bg";

export default function HomePage() {
  return (
    <>
      <AmbientVideoBg />
      <SiteHeader />
      <main className="flex-1 relative">
        <Hero />
        <StatStrip />
        <HowItWorks />
        <TraceReplay />
        <Discovery />
        <ScrollReveal>
          <Features />
        </ScrollReveal>
        <PolicyRules />
        <ConsolePreview />
        <Security />
        <CodeSection />
        <OrangeCTA />
      </main>
      <SiteFooter />
    </>
  );
}
