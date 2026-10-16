import type { NextConfig } from "next";

const nextConfig: NextConfig = {
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
              // Razorpay origins pre-authorized in script-src: checkout
              // currently uses hosted Payment Links (window.open), but an
              // embedded checkout.js must not be CSP-blocked later.
              "script-src 'self' 'unsafe-inline' 'unsafe-eval' https://*.razorpay.com https://*.rzp.io",
              "style-src 'self' 'unsafe-inline'",
              "img-src 'self' data: blob:",
              "font-src 'self' data:",
              // Backend + Supabase + Razorpay checkout only. Localhost
              // entries are dev-only: production never calls them.
              "connect-src 'self' https://api.sellable.shop http://localhost:8000 http://127.0.0.1:8000 https://*.supabase.co https://*.razorpay.com https://*.rzp.io",
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
