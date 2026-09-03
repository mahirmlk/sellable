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
  MerchantValue,
  RealExample,
} from "@/components/home-narrative";
import { HowItWorks } from "@/components/how-it-works";
import { TraceReplay } from "@/components/trace-replay";
import { Discovery } from "@/components/discovery";
import { Features } from "@/components/features";
import { PolicyRules } from "@/components/policy-rules";
import { ConsolePreview } from "@/components/console-preview";
import { Security } from "@/components/security";
import { CodeSection } from "@/components/code-window";
import { OrangeCTA } from "@/components/orange-cta";
import { Reveal } from "@/components/ui/reveal";
import { AmbientVideoBg } from "@/components/ui/ambient-video-bg";

// Landing page order follows the homepage spec:
// hero → problem → agents → flow → value → safety → AI-native store →
// explainability → example → technical depth → final CTA.
//
// Motion is deliberately simple: one-shot scroll reveals (opacity +
// translate only) plus small ambient loops (marquee, float, drift, status
// dots) and viewport-gated content timers. No scroll-linked JS, no blur /
// blend / gradient animation — nothing that can glitch the page.
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
        <Reveal><MerchantValue /></Reveal>
        <Reveal><Features /></Reveal>
        <Reveal><Discovery /></Reveal>
        <Reveal><TraceReplay /></Reveal>
        <Reveal><RealExample /></Reveal>
        <Reveal><PolicyRules /></Reveal>
        <Reveal><ConsolePreview /></Reveal>
        <Reveal><Security /></Reveal>
        <Reveal><CodeSection /></Reveal>
        <OrangeCTA />
      </main>
      <SiteFooter />
    </>
  );
}
