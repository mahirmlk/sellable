import { NextResponse } from "next/server";
import { DEMO_COOKIE } from "@/lib/supabase/middleware";

// Demo Mode entry (UPDATE.md §4/§6): no account required. Sets the
// demo-routing cookie, then lands on the dashboard. The redirect stays
// relative so the cookie and the landing share one host (an absolute
// redirect across 127.0.0.1/localhost aliases drops the cookie).
// Phase 3's isolated demo adapter serves all dashboard data, so this works
// with or without Supabase configured. A signed-in merchant keeps their
// real session and never receives the demo cookie.
export async function GET(request: Request) {
  const hasSupabaseSession = request.headers
    .get("cookie")
    ?.split(";")
    .some((part) => part.trim().startsWith("sb-"));

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
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
