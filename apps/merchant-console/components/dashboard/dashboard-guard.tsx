"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getStore } from "@/lib/api";

// Dashboard entry guard: the middleware owns the login wall (it redirects
// anon visitors without a demo flag to /sign-in). This guard only handles
// the backend-driven onboarding redirect plus expired/revoked sessions —
// a merchant without a store goes to onboarding, a 401 goes to sign-in.
export function DashboardGuard() {
  const router = useRouter();

  useEffect(() => {
    let cancelled = false;

    async function check() {
      // Never guard the onboarding route itself (it runs inside this layout).
      if (typeof window !== "undefined" && window.location.pathname.startsWith("/dashboard/onboarding")) {
        return;
      }
      // Verified user: check real merchant authorization. A user without a
      // store goes to onboarding instead of seeing any demo data.
      try {
        await getStore();
      } catch (err) {
        if (cancelled) return;
        if (err instanceof ApiError && err.isOnboardingRequired) {
          router.replace("/dashboard/onboarding");
        } else if (err instanceof ApiError && err.isAuthFailure) {
          // Expired/revoked token: central redirect instead of leaving
          // each page to surface its own banner.
          const next = window.location.pathname;
          router.replace(`/sign-in?next=${encodeURIComponent(next)}`);
        }
        // Other errors (network/5xx) are surfaced by the pages themselves.
      }
    }

    check();
    return () => {
      cancelled = true;
    };
  }, [router]);

  return null;
}
