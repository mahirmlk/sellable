"use client";

// Shared hook for loading /agents/status with explicit failure classification.
// Every failure is surfaced as its real cause (auth, wrong endpoint, backend
// error, network, malformed contract) instead of collapsing into "Offline".

import { useCallback, useEffect, useState } from "react";
import { ApiError, getAgentsStatus, type AgentsStatusResponse } from "@/lib/api";

export type StatusError =
  | { kind: "auth"; message: string }
  | { kind: "endpoint"; message: string }
  | { kind: "backend"; message: string }
  | { kind: "network"; message: string }
  | { kind: "contract"; message: string };

export interface SystemStatusState {
  data: AgentsStatusResponse | null;
  loading: boolean;
  error: StatusError | null;
  lastUpdated: number | null;
  reload: () => void;
}

export function classifyError(error: unknown): StatusError {
  if (error instanceof ApiError) {
    if (error.isAuthFailure) {
      return {
        kind: "auth",
        message: `Authentication/authorization problem (${error.status}). ${error.detail}`,
      };
    }
    if (error.isNotFound) {
      return { kind: "endpoint", message: `Wrong endpoint (404): ${error.detail}` };
    }
    if (error.isServerError) {
      return { kind: "backend", message: `Backend error (${error.status}). ${error.detail}` };
    }
    return { kind: "backend", message: `Request failed (${error.status}). ${error.detail}` };
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

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const result = await getAgentsStatus();
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
    const t = window.setTimeout(() => void load(), 0);
    return () => window.clearTimeout(t);
  }, [initialLoad, load, tick]);

  const reload = useCallback(() => setTick((t) => t + 1), []);

  return { data, loading, error, lastUpdated, reload };
}