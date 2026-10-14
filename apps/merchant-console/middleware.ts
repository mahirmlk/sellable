import { type NextRequest } from "next/server";
import { updateSession } from "@/lib/supabase/middleware";

// Session gate for the merchant console (UPDATE.md Milestone A).
// Public marketing pages are untouched; only auth + dashboard routes run
// through Supabase session refresh / demo-cookie routing.
export async function middleware(request: NextRequest) {
  return await updateSession(request);
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
