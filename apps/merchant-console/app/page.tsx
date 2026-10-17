"use client";

import { SiteHeader } from "@/components/site-header";
import { SiteFooter } from "@/components/site-footer";
import { Hero } from "@/components/hero";
import { EventTicker } from "@/components/event-ticker";
import { StatStrip } from "@/components/stat-strip";
import {
  Problem,
  TwoAgents,
  MerchantControl,
} from "@/components/home-narrative";
import { HowItWorks } from "@/components/how-it-works";
import { Features } from "@/components/features";
import { ConsolePreview } from "@/components/console-preview";
import { PolicySecurity } from "@/components/policy-security";
import { Discovery } from "@/components/discovery";
import { CodeSection } from "@/components/code-window";
import { OrangeCTA } from "@/components/orange-cta";
import { Reveal } from "@/components/ui/reveal";
import { AmbientVideoBg } from "@/components/ui/ambient-video-bg";

// Landing order: hero → ledger path → guarantees → problem → agents →
// control → flow → platform → console → policy + security → discovery →
// developers → final CTA.
//
// Copy is human-written, architecture-accurate (Seller + Service agents;
// outside agents stay guests), and free of sample orders or amounts.
export default function HomePage() {
  return (
    <>
      <AmbientVideoBg />
      <SiteHeader />
      <main className="flex-1 relative">
        <Hero />
        <EventTicker />
        <Reveal><StatStrip /></Reveal>
        <Reveal><Problem /></Reveal>
        <Reveal><TwoAgents /></Reveal>
        <Reveal><MerchantControl /></Reveal>
        <Reveal><HowItWorks /></Reveal>
        <Reveal><Features /></Reveal>
        <Reveal><ConsolePreview /></Reveal>
        <Reveal><PolicySecurity /></Reveal>
        <Reveal><Discovery /></Reveal>
        <Reveal><CodeSection /></Reveal>
        <OrangeCTA />
      </main>
      <SiteFooter />
    </>
  );
}
