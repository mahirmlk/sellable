import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/demo/cookie";
import { safeNext } from "@/lib/safe-next";

// Supabase email-link landing: verification, recovery, and invites all
// redirect here. Exchanges the code for a session, then follows `next`.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const next = safeNext(url.searchParams.get("next") ?? "/dashboard");

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;

  if (!code) {
    return NextResponse.redirect(`${siteUrl}/sign-in?error=callback`);
  }

  // Demo-only deployment: no Supabase to exchange against. Bounce instead
  // of throwing inside createServerClient (500).
  if (
    !process.env.NEXT_PUBLIC_SUPABASE_URL ||
    !process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY
  ) {
    return NextResponse.redirect(`${siteUrl}/sign-in?error=callback`);
  }

  const cookieStore = await cookies();
  const supabase = createServerClient(
    process.env.NEXT_PUBLIC_SUPABASE_URL as string,
    process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY as string,
    {
      cookies: {
        getAll() {
          return cookieStore.getAll();
        },
        setAll(cookiesToSet) {
          try {
            cookiesToSet.forEach(({ name, value, options }) =>
              cookieStore.set(name, value, options)
            );
          } catch {
            // Set from a Route Handler that already sent headers — ignore.
          }
        },
      },
    }
  );

  const { error } = await supabase.auth.exchangeCodeForSession(code);
  if (error) {
    return NextResponse.redirect(`${siteUrl}/sign-in?error=callback`);
  }

  // A real session always wins over demo state: drop the demo routing flag
  // here (middleware also deletes it) so a verified merchant can never see
  // fixture data shadowed over their production tenant. Mirror the set
  // attributes (SameSite/Secure) so the clear isn't treated as a different
  // cookie on HTTPS.
  const success = NextResponse.redirect(`${siteUrl}${next}`);
  success.cookies.set(DEMO_COOKIE, "", {
    path: "/",
    maxAge: 0,
    sameSite: "lax",
    secure: url.protocol === "https:",
    httpOnly: false,
  });
  return success;
}
