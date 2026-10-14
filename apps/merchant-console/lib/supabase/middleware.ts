import { createServerClient } from "@supabase/ssr";
import { NextResponse, type NextRequest } from "next/server";

/**
 * Refreshes the Supabase session and routes by session state
 * (UPDATE.md Milestone A — Open Console never bypasses auth).
 *
 * Supabase configured: /dashboard requires a user, auth pages redirect
 * away when already signed in.
 *
 * Supabase NOT configured (demo mode): /dashboard requires the demo
 * session cookie set only by visiting /demo. Direct navigation to
 * /dashboard without it redirects to /sign-in, where Demo Mode is offered.
 */
export const DEMO_COOKIE = "sellable_demo_auth";

const SIGN_IN = "/sign-in";
const SIGN_UP = "/sign-up";
const AUTH_PAGES = new Set([SIGN_IN, SIGN_UP]);

export async function updateSession(request: NextRequest) {
  let supabaseResponse = NextResponse.next({ request });

  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  const anonKey = process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
  const { pathname } = request.nextUrl;

  if (!url || !anonKey) {
    const hasDemoSession = request.cookies.get(DEMO_COOKIE)?.value === "1";

    if (pathname.startsWith("/dashboard") && !hasDemoSession) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = SIGN_IN;
      redirectUrl.searchParams.set("next", pathname);
      return NextResponse.redirect(redirectUrl);
    }

    if (hasDemoSession && AUTH_PAGES.has(pathname)) {
      const redirectUrl = request.nextUrl.clone();
      redirectUrl.pathname = "/dashboard";
      return NextResponse.redirect(redirectUrl);
    }

    return supabaseResponse;
  }

  const supabase = createServerClient(url, anonKey, {
    cookies: {
      getAll() {
        return request.cookies.getAll();
      },
      setAll(cookiesToSet) {
        cookiesToSet.forEach(({ name, value }) => request.cookies.set(name, value));
        supabaseResponse = NextResponse.next({ request });
        cookiesToSet.forEach(({ name, value, options }) =>
          supabaseResponse.cookies.set(name, value, options)
        );
      },
    },
  });

  // IMPORTANT: do not run code between createServerClient and auth.getUser()
  const {
    data: { user },
  } = await supabase.auth.getUser();

  if (pathname.startsWith("/dashboard") && !user) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = SIGN_IN;
    redirectUrl.searchParams.set("next", pathname);
    return NextResponse.redirect(redirectUrl);
  }

  if (user && AUTH_PAGES.has(pathname)) {
    const redirectUrl = request.nextUrl.clone();
    redirectUrl.pathname = "/dashboard";
    return NextResponse.redirect(redirectUrl);
  }

  return supabaseResponse;
}
