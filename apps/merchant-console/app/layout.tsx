import type { Metadata, Viewport } from "next";
import { Geist, Geist_Mono, Inter, JetBrains_Mono } from "next/font/google";
import "./globals.css";

const geistSans = Geist({
  variable: "--font-geist-sans",
  subsets: ["latin"],
});

const geistMono = Geist_Mono({
  variable: "--font-geist-mono",
  subsets: ["latin"],
});

const inter = Inter({
  variable: "--font-inter",
  subsets: ["latin"],
  display: "swap",
});

/* JetBrains Mono is a fallback for devices without SF Mono. The dashboard
   mono stack leads with ui-monospace / SF Mono (see globals.css). */
const jetbrainsMono = JetBrains_Mono({
  variable: "--font-jetbrains",
  subsets: ["latin"],
  display: "swap",
});

const siteUrl = process.env.NEXT_PUBLIC_SITE_URL || "https://sellable.shop";

export const metadata: Metadata = {
  metadataBase: new URL(siteUrl),
  title: {
    default: "Sellable — Agentic Commerce Platform",
    template: "%s | SELLABLE",
  },
  description:
    "Two agents for your shop: one sells from your catalog, one looks after orders. Policy checks each cart, consent locks each payment, and the ledger records each step.",
  applicationName: "SELLABLE",
  keywords: [
    "agentic commerce",
    "AI commerce",
    "seller agent",
    "customer service agent",
    "shopping agents",
    "deterministic policy",
    "consent-gated payments",
    "audit ledger",
    "transaction replay",
    "human-in-the-loop",
    "Razorpay",
    "merchant infrastructure",
    "UCP",
    "MCP",
    "A2A",
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
    title: "Sellable — Agentic Commerce Platform",
    description:
      "Your shop gets a Seller Agent and a Service Agent. Outside shopping agents connect as guests. Policy checks each cart, consent locks each payment, and the ledger records each step.",
    images: [
      {
        url: "/og-image.png",
        width: 1200,
        height: 630,
        alt: "Sellable — Agentic Commerce Platform",
      },
    ],
  },
  twitter: {
    card: "summary_large_image",
    title: "Sellable — Agentic Commerce Platform",
    description:
      "A Seller Agent quotes from your catalog and a Service Agent looks after orders. Policy checks, consent locks, and the ledger explains.",
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
  themeColor: [
    { media: "(prefers-color-scheme: light)", color: "#f2f3f7" },
    { media: "(prefers-color-scheme: dark)", color: "#0b0c10" },
  ],
  colorScheme: "light dark",
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
          "Agentic commerce infrastructure for merchants: a Seller Agent that quotes from your catalog, a Service Agent that looks after orders, and guardrails that keep each payment inside your rules.",
        sameAs: ["https://github.com/mahirmlk/sellable"],
      },
      {
        "@type": "WebSite",
        name: "SELLABLE",
        url: siteUrl,
        description:
          "Two agents for your shop: one sells from your catalog, one looks after orders. Policy checks each cart, consent locks each payment, and the ledger records each step.",
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
          "Seller Agent",
          "Customer Service Agent",
          "Bounded negotiation",
          "Consent-gated payments",
          "Human approvals",
          "Replayable ledger",
          "Razorpay test rails",
        ],
      },
    ],
  };

  return (
    <html
      lang="en"
      className={`${geistSans.variable} ${geistMono.variable} ${inter.variable} ${jetbrainsMono.variable} h-full antialiased`}
    >
      <head>
        <script
          type="application/ld+json"
          dangerouslySetInnerHTML={{ __html: JSON.stringify(jsonLd) }}
        />
      </head>
      <body className="min-h-full flex flex-col" suppressHydrationWarning>
        <SmoothScroll>{children}</SmoothScroll>
      </body>
    </html>
  );
}
