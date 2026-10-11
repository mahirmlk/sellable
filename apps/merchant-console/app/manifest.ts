import type { MetadataRoute } from "next";

export default function manifest(): MetadataRoute.Manifest {
  return {
    name: "SELLABLE — Agentic Commerce for Merchants",
    short_name: "SELLABLE",
    description:
      "Two agents for your shop: one sells from your catalog, one looks after orders. Policy checked, consent locked, ledger recorded.",
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
