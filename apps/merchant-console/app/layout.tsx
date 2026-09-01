import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sellable.shop";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "SELLABLE — Agentic Commerce Infrastructure",
    template: "%s | SELLABLE",
  },
  description:
    "Infrastructure for agentic commerce. AI buyers discover, negotiate, and pay via Razorpay Test Mode — every money action is bounded by deterministic policy and audit-logged.",
  applicationName: "SELLABLE",
  keywords: [
    "agentic commerce",
    "AI commerce",
    "agent-to-agent",
    "A2A",
    "Razorpay",
    "UPI",
    "NPCI",
    "deterministic policy",
    "audit ledger",
    "merchant infrastructure",
    "AI buyers",
    "autonomous commerce",
  ],
  authors: [{ name: "SELLABLE", url: siteUrl }],
  creator: "SELLABLE",
  publisher: "SELLABLE",
  category: "ecommerce",
  alternates: {
    canonical: "/",
  },
  icons: {
    icon: "/favicon.png",
    apple: "/favicon.png",
  },
  openGraph: {
    type: "website",
    locale: "en_IN",
    url: siteUrl,
    siteName: "SELLABLE",
    title: "SELLABLE — Agentic Commerce Infrastructure",
    description:
      "Agent proposes, policy disposes. AI buyers discover, negotiate, and pay — every money action is explainable, bounded, gated, and auditable.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "SELLABLE — Agentic Commerce Infrastructure",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "SELLABLE — Agentic Commerce Infrastructure",
    description:
      "Agent proposes, policy disposes. Every money action is explainable, bounded, gated, and auditable — on real Razorpay Test Mode.",
    images: ["/og-image.png"],
    creator: "@sellable_dev",
  },
  robots: {
    index: true,
    follow: true,
    googleBot: {
      index: true,
      follow: true,
      "max-video-preview": -1,
      "max-image-preview": "large",
      "max-snippet": -1,
    },
  },
};

export const viewport: Viewport = {
  width: "device-width",
  initialScale: 1,
  themeColor: "#080808",
  colorScheme: "dark",
};

import { SmoothScroll } from "@/components/ui/smooth-scroll";

export default function RootLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const jsonLd = {
    "@context": "https://schema.org",
    "@graph": [
      {
        "@type": "Organization",
        name: "SELLABLE",
        url: siteUrl,
        logo: `${siteUrl}/sellable-logo.png`,
        description:
          "Agentic commerce infrastructure — agent proposes, policy disposes. Every money action is audit-logged.",
        sameAs: ["https://github.com/mahirmlk/sellable"],
      },
      {
        "@type": "WebSite",
        name: "SELLABLE",
        url: siteUrl,
        description:
          "Infrastructure for agentic commerce. AI buyers discover, negotiate, and pay — bounded by deterministic policy.",
        publisher: { "@type": "Organization", name: "SELLABLE" },
        potentialAction: {
          "@type": "SearchAction",
          target: `${siteUrl}/dashboard/catalog?q={search_term_string}`,
          "query-input": "required name=search_term_string",
        },
      },
      {
        "@type": "SoftwareApplication",
        name: "SELLABLE",
        applicationCategory: "BusinessApplication",
        operatingSystem: "Web",
        url: siteUrl,
        offers: { "@type": "Offer", price: "0", priceCurrency: "INR" },
        featureList: [
          "Explainable transactions",
          "Bounded negotiation",
          "Gated HITL approvals",
          "Auditable ledger",
          "Razorpay Test Mode",
          "Agent-to-agent commerce",
          "Human conversational checkout",
        ],
      },
    ],
  };

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col">
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
