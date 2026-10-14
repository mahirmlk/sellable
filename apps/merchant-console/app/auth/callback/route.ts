import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";

// Supabase email-link landing: verification, recovery, and invites all
// redirect here. Exchanges the code for a session, then follows `next`.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const code = url.searchParams.get("code");
  const rawNext = url.searchParams.get("next") ?? "/dashboard";
  const next = rawNext.startsWith("/") && !rawNext.startsWith("//") ? rawNext : "/dashboard";

  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;

  if (!code) {
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

  return NextResponse.redirect(`${siteUrl}${next}`);
}
