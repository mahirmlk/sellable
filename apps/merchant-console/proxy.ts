import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";
import { createDashboardCsp } from "@/lib/security/dashboard-csp";

// Session gate for the merchant console. Public marketing pages remain on
// their existing static CSP; dashboard HTML gets a fresh script nonce.
export async function proxy(request: NextRequest) {
  if (!request.nextUrl.pathname.startsWith("/dashboard")) {
    return await updateSession(request);
  }

  const nonce = btoa(crypto.randomUUID());
  const csp = createDashboardCsp(nonce, process.env.NODE_ENV === "development");
  const forwardedHeaders = new Headers(request.headers);

  // Next.js reads the request CSP nonce while rendering and attaches it to
  // its framework scripts. Return the same policy so browsers enforce it.
  forwardedHeaders.set("x-nonce", nonce);
  forwardedHeaders.set("Content-Security-Policy", csp);

  const response = await updateSession(request, forwardedHeaders);
  response.headers.set("Content-Security-Policy", csp);
  return response;
}

export const config = {
  matcher: [
    "/dashboard/:path*",
    "/sign-in",
    "/sign-up",
    "/forgot-password",
    "/reset-password",
    "/demo",
    "/login",
    "/signup",
  ],
};
