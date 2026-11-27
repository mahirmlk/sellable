/**
 * Restrictive policy for merchant dashboard HTML. Proxy generates a fresh
 * cryptographic nonce for every request and passes this policy to Next.js
 * before rendering so framework-generated scripts receive the same nonce.
 */
export function createDashboardCsp(
  nonce: string,
  isDevelopment = false
): string {
  if (!/^[A-Za-z0-9+/]+={0,2}$/.test(nonce)) {
    throw new Error("CSP nonce must be base64 encoded");
  }

  const scriptSources = [
    "'self'",
    `'nonce-${nonce}'`,
    ...(isDevelopment ? ["'unsafe-eval'"] : []),
    "https://*.razorpay.com",
    "https://*.rzp.io",
  ];

  return [
    "default-src 'self'",
    "base-uri 'self'",
    "object-src 'none'",
    "form-action 'self'",
    `script-src ${scriptSources.join(" ")}`,
    // Existing UI components use style attributes; scripts are nonce-only.
    "style-src 'self' 'unsafe-inline'",
    "img-src 'self' data: blob:",
    "font-src 'self' data:",
    `connect-src 'self' https://api.sellable.shop https://*.supabase.co https://*.razorpay.com https://*.rzp.io${isDevelopment ? " http://localhost:8000 http://127.0.0.1:8000" : ""}`,
    "frame-src 'self' https://*.razorpay.com https://*.rzp.io",
    "frame-ancestors 'none'",
  ].join("; ");
}
