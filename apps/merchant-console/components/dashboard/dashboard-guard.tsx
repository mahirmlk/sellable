"use client";

import { useEffect } from "react";
import { useRouter } from "next/navigation";
import { isSupabaseConfigured, createClient } from "@/lib/supabase/client";

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
      if (!isSupabaseConfigured()) {
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
        }
      } catch {
        if (!cancelled && !hasDemoCookie()) {
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
