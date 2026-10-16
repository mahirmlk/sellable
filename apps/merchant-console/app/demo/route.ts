import { NextResponse } from "next/server";
import { DEMO_COOKIE, DEMO_COOKIE_MAX_AGE } from "@/lib/demo/cookie";

// Demo Mode entry: no account required. Sets the demo-routing cookie,
// then lands on the dashboard. The redirect stays relative so the cookie
// and the landing share one host (an absolute redirect across
// 127.0.0.1/localhost aliases drops the cookie).
// The isolated demo adapter serves all dashboard data, so this works with
// or without Supabase configured. A signed-in merchant keeps their real
// session and never receives the demo cookie.
//
// The cookie is deliberately READABLE (not httpOnly): lib/api.ts reads it
// via document.cookie to select the demo adapter. It is a routing hint,
// never an auth credential. Short-lived (24h), Secure in production.
export async function GET(request: Request) {
  const hasSupabaseSession = request.headers
    .get("cookie")
    ?.split(";")
    .some((part) => part.trim().startsWith("sb-"));

  const response = NextResponse.redirect(new URL("/dashboard", request.url));
  if (!hasSupabaseSession) {
    const isHttps = new URL(request.url).protocol === "https:";
    response.cookies.set(DEMO_COOKIE, "1", {
      httpOnly: false,
      sameSite: "lax",
      secure: isHttps,
      path: "/",
      maxAge: DEMO_COOKIE_MAX_AGE,
    });
  }
  return response;
}
