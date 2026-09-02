"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/client";
import { ApiError, getStore } from "@/lib/api";

const DEMO_COOKIE = "sellable_demo_auth";

function hasDemoCookie(): boolean {
  if (typeof document === "undefined") return false;
  return document.cookie.split("; ").some((c) => c === `${DEMO_COOKIE}=1` || c.startsWith(`${DEMO_COOKIE}=1`));
}

export function DashboardGuard() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Never guard the onboarding route itself (it runs inside this layout).
      if (typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard/onboarding")) {
        return;
      }
      if (!isSupabaseConfigured()) {
        // Demo mode only: when Supabase is not configured the demo cookie
        // (set after /login) grants dashboard access.
        if (!hasDemoCookie()) {
          router.replace("/login?next=/dashboard");
        }
        return;
      }
      try {
        const supabase = createClient();
        const {
          data: { user },
        } = await supabase.auth.getUser();
        if (!cancelled && !user) {
          router.replace("/login?next=/dashboard");
          return;
        }
        // Verified user: check real merchant authorization. A user without a
        // store goes to onboarding instead of seeing any demo data.
        try {
          await getStore();
        } catch (err) {
          if (!cancelled && err instanceof ApiError && err.isOnboardingRequired) {
            router.replace("/dashboard/onboarding");
          }
          // Other errors (network/5xx) are surfaced by the pages themselves.
        }
      } catch {
        // With Supabase configured there is no demo fallback in production.
        if (!cancelled) {
          router.replace("/login?next=/dashboard");
        }
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
