import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/supabase/middleware";

// Ends both session kinds: Supabase merchant session (when configured)
// and the Demo Mode routing cookie. Always lands on the marketing site.
export async function GET(request: Request) {
  const url = new URL(request.url);
  const siteUrl =
    process.env.NEXT_PUBLIC_SITE_URL || `${url.protocol}//${url.host}`;

  if (process.env.NEXT_PUBLIC_SUPABASE_URL && process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY) {
    const cookieStore = await cookies();
    const supabase = createServerClient(
      process.env.NEXT_PUBLIC_SUPABASE_URL,
      process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY,
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
              // Headers already sent — sign-out still clears below.
            }
          },
        },
      }
    );
    await supabase.auth.signOut();
  }

  const response = NextResponse.redirect(`${siteUrl}/`);
  response.cookies.set(DEMO_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
