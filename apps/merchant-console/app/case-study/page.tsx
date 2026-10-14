import type { Metadata } from "next";
import CaseStudyClient from "./client";

export const metadata: Metadata = {
  title: "Case Study — The Held Fact | SELLABLE",
  description:
    "How Sellable was built: a Seller Agent and a Service Agent for the merchant, a gateway for outside shopping agents, and a policy engine plus ledger that explain each payment.",
  keywords: [
    "sellable",
    "agentic commerce",
    "case study",
    "held fact",
    "seller agent",
    "customer service agent",
    "policy engine",
    "consent",
    "audit ledger",
    "Razorpay",
    "agent gateway",
  ],
  openGraph: {
    title: "Case Study — The Held Fact | SELLABLE",
    description:
      "A Seller Agent quotes, a Service Agent supports, and the gateway, policy engine, and ledger keep each payment inside the rules.",
    type: "article",
  },
};

export default function CaseStudyPage() {
  return <CaseStudyClient />;
}
