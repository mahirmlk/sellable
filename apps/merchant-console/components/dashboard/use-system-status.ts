"use client";

// Shared hook for loading /agents/status with explicit failure classification.
// Every failure is surfaced as its real cause (auth, wrong endpoint, backend
// error, network, malformed contract) instead of collapsing into "Offline".

import { useCallback, useEffect, useRef, useState } from "react";
import { ApiError, getAgentsStatus, type AgentsStatusResponse } from "@/lib/api";

export type StatusError =
  | { kind: "auth"; message: string; traceId?: string | null; code?: string | null }
  | { kind: "endpoint"; message: string; traceId?: string | null; code?: string | null }
  | { kind: "backend"; message: string; traceId?: string | null; code?: string | null }
  | { kind: "network"; message: string; traceId?: string | null; code?: string | null }
  | { kind: "contract"; message: string; traceId?: string | null; code?: string | null };

export interface SystemStatusState {
  data: AgentsStatusResponse | null;
  loading: boolean;
  error: StatusError | null;
  lastUpdated: number | null;
  reload: () => void;
}

export function classifyError(error: unknown): StatusError {
  if (error instanceof ApiError) {
    const traceId = error.traceId;
    const code = error.errorCode;
    if (error.isAuthFailure) {
      return {
        kind: "auth",
        message: `Authentication/authorization problem (${error.status}). ${error.detail}`,
        traceId,
        code,
      };
    }
    if (error.isNotFound) {
      return { kind: "endpoint", message: `Wrong endpoint (404): ${error.detail}`, traceId, code };
    }
    if (error.isServerError) {
      return { kind: "backend", message: `Backend error (${error.status}). ${error.detail}`, traceId, code };
    }
    return { kind: "backend", message: `Request failed (${error.status}). ${error.detail}`, traceId, code };
  }
  if (error instanceof TypeError) {
    return { kind: "network", message: "Backend unreachable. Check your network or api.sellable.shop." };
  }
  return { kind: "contract", message: "Unexpected response from the backend." };
}

export function useSystemStatus(initialLoad = true): SystemStatusState {
  const [data, setData] = useState<AgentsStatusResponse | null>(null);
  const [loading, setLoading] = useState(initialLoad);
  const [error, setError] = useState<StatusError | null>(null);
  const [lastUpdated, setLastUpdated] = useState<number | null>(null);
  const [tick, setTick] = useState(0);
  // Set by reload() so the effect below performs the ONE forced load.
  // (Calling load() directly AND bumping a tick used to fire two loads —
  // the direct forced one plus an effect re-run.)
  const forceNextRef = useRef(false);

  const load = useCallback(async (force = false) => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAgentsStatus(force);
      setData(result);
      setLastUpdated(Date.now());
    } catch (err) {
      setError(classifyError(err));
      setData(null);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    if (!initialLoad) return;
    const t = window.setTimeout(() => {
      const force = forceNextRef.current;
      forceNextRef.current = false;
      void load(force);
    }, 0);
    return () => window.clearTimeout(t);
  }, [initialLoad, load, tick]);

  // Manual refresh = exactly one forced request via the effect above.
  const reload = useCallback(() => {
    forceNextRef.current = true;
    setTick((t) => t + 1);
  }, []);

  return { data, loading, error, lastUpdated, reload };
}