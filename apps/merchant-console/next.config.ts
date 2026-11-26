import type { NextConfig } from "next";

const isDevelopment = process.env.NODE_ENV === "development";

if (process.env.NODE_ENV === "production" && process.env.NEXT_PUBLIC_AGENT_KEY?.trim()) {
  throw new Error(
    "NEXT_PUBLIC_AGENT_KEY is browser-exposed and must be unset in production builds."
  );
}

const nextConfig: NextConfig = {
  // Pin the monorepo app root so an unrelated lockfile in the parent user
  // directory cannot change Turbopack's workspace or output-tracing roots.
  turbopack: {
    root: process.cwd(),
  },
  async headers() {
    return [
      {
        source: "/:path*",
        headers: [
          { key: "X-Frame-Options", value: "DENY" },
          { key: "X-Content-Type-Options", value: "nosniff" },
          { key: "Referrer-Policy", value: "strict-origin-when-cross-origin" },
          {
            key: "Permissions-Policy",
            value: "camera=(), microphone=(), geolocation=()",
          },
          {
            key: "Content-Security-Policy",
            value: [
              "default-src 'self'",
              "base-uri 'self'",
              "object-src 'none'",
              "form-action 'self'",
              // Razorpay origins pre-authorized in script-src: checkout
              // currently uses hosted Payment Links (window.open), but an
              // embedded checkout.js must not be CSP-blocked later.
              `script-src 'self' 'unsafe-inline'${isDevelopment ? " 'unsafe-eval'" : ""} https://*.razorpay.com https://*.rzp.io`,
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              `connect-src 'self' https://api.sellable.shop https://*.supabase.co https://*.razorpay.com https://*.rzp.io${isDevelopment ? " http://localhost:8000 http://127.0.0.1:8000" : ""}`,
              "frame-src 'self' https://*.razorpay.com https://*.rzp.io",
              "frame-ancestors 'none'",
            ].join("; "),
          },
          {
            key: "Strict-Transport-Security",
            value: "max-age=63072000; includeSubDomains; preload",
          },
        ],
      },
    ];
  },
};

export default nextConfig;
