import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SELLABLE — Agentic Commerce Infrastructure",
    short_name: "SELLABLE",
    description:
      "Infrastructure for agentic commerce. AI buyers discover, negotiate, and pay — every money action is bounded by deterministic policy and audit-logged.",
    start_url: "/",
    display: "standalone",
    background_color: "#080808",
    theme_color: "#080808",
    icons: [
      {
        src: "/favicon.png",
        sizes: "512x512",
        type: "image/png",
      },
      {
        src: "/sellable-logo.png",
        sizes: "512x512",
        type: "image/png",
        purpose: "any",
      },
    ],
  };
}
