import type { Metadata } from "next";
import CaseStudyClient from "./client";

export const metadata: Metadata = {
  title: "Case Study — The Held Fact | SELLABLE",
  description:
    "The full SELLABLE build story in the white editorial language of the 'held fact' — discovery, bounded negotiation, deterministic policy, consent, Razorpay rails, and a ledger that explains every rupee. Agentic commerce infrastructure.",
  keywords: [
    "sellable",
    "agentic commerce",
    "case study",
    "held fact",
    "AI buyers",
    "Razorpay",
    "policy engine",
    "XAI ledger",
    "agent-to-agent",
    "commerce architecture",
  ],
  openGraph: {
    title: "Case Study — The Held Fact | SELLABLE",
    description:
      "How we made a merchant sellable to AI buyers — context, workflow, tech stack, and architecture as a white editorial story with live animations.",
    type: "article",
  },
};

export default function CaseStudyPage() {
  return <CaseStudyClient />;
}
