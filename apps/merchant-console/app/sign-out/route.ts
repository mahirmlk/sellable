import { NextResponse } from "next/server";
import { createServerClient } from "@supabase/ssr";
import { cookies } from "next/headers";
import { DEMO_COOKIE } from "@/lib/demo/cookie";

// Ends both session kinds: Supabase merchant session (when configured)
// and the Demo Mode routing cookie. Always lands on the marketing site
// (relative redirect keeps one host).
export async function GET(request: Request) {
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

  const response = NextResponse.redirect(new URL("/", request.url));
  response.cookies.set(DEMO_COOKIE, "", { path: "/", maxAge: 0 });
  return response;
}
