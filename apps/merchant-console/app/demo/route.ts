import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/supabase/middleware";

// Demo Mode entry (UPDATE.md §4/§6): no account required. Sets the
// demo-routing cookie, then lands on the dashboard. Phase 3 replaces the
// shared-backend demo session with an isolated demo adapter + fixtures;
// until then the backend demo key only works against development backends.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;

  // Demo Mode needs no Supabase account, but it must never masquerade as a
  // production session: a signed-in merchant keeps their real session and
  // never receives the demo cookie.
  const hasSupabaseSession = request.headers
    .get("cookie")
    ?.split(";")
    .some((part) => part.trim().startsWith("sb-"));

  const response = NextResponse.redirect(`${siteUrl}/dashboard`);
  if (!hasSupabaseSession) {
    response.cookies.set(DEMO_COOKIE, "1", {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
      maxAge: 60 * 60 * 24 * 7,
    });
  }
  return response;
}
