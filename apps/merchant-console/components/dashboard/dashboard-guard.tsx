"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { ApiError, getStore } from "@/lib/api";

// No login wall: the dashboard opens directly. This guard only handles the
// backend-driven onboarding redirect — a merchant without a store goes to
// onboarding instead of seeing an empty dashboard.
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
        if (!cancelled && err instanceof ApiError && err.isOnboardingRequired) {
          router.replace("/dashboard/onboarding");
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
