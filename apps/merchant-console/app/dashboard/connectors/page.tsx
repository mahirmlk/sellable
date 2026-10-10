"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import { formatTimestamp } from "@/lib/formatters";
import {
  listConnectors,
  registerConnector,
  deleteConnector,
  connectorHealth,
  syncConnector,
  type ConnectorView,
} from "@/lib/api";

export default function ConnectorsPage() {
  const [connectors, setConnectors] = useState<ConnectorView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [connectorId, setConnectorId] = useState("");
  const [baseUrl, setBaseUrl] = useState("");
  const [productsPath, setProductsPath] = useState("/products");
  const [lastSync, setLastSync] = useState<Record<string, unknown> | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setConnectors(await listConnectors());
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load connectors");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onRegister = async () => {
    if (!connectorId.trim()) return;
    setBusy("register");
    try {
      await registerConnector({
        connector_id: connectorId.trim(),
        provider: "custom_rest",
        kind: "commerce",
        base_url: baseUrl.trim(),
        products_path: productsPath.trim() || "/products",
      });
      setConnectorId("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Register failed");
    } finally {
      setBusy(null);
    }
  };

  const onHealth = async (id: string) => {
    setBusy(id);
    try {
      const result = await connectorHealth(id);
      setLastSync({ health: result });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Health check failed");
    } finally {
      setBusy(null);
    }
  };

  const onSync = async (id: string) => {
    setBusy(id);
    try {
      const result = await syncConnector(id);
      setLastSync({ sync: result });
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Sync failed");
    } finally {
      setBusy(null);
    }
  };

  const onDelete = async (id: string) => {
    setBusy(id);
    try {
      await deleteConnector(id);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Delete failed");
    } finally {
      setBusy(null);
    }
  };

  if (loading && !connectors) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
        <div>
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            Connectors
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Connectors
          </h1>
        </div>
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
      <div className="min-w-0">
        <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
          Connectors
        </div>
        <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
          Connectors
        </h1>
        <p className="mt-1 max-w-[46rem] text-[13px] leading-relaxed text-muted">
          Source systems sync into the canonical catalog. Syncs are atomic:
          failures leave the catalog untouched.
        </p>
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Registered sources</h2>
        {!connectors || connectors.length === 0 ? (
          <EmptyState
            title="No connectors"
            message="Register a custom REST source below to start syncing products."
          />
        ) : (
          <div className="space-y-2">
            {connectors.map((connector) => (
              <div
                key={connector.connector_id}
                className="flex flex-wrap items-center justify-between gap-3 rounded-xl border border-hairline bg-panel-2 px-4 py-3"
              >
                <div>
                  <div className="font-mono text-sm">{connector.connector_id}</div>
                  <div className="text-xs text-muted">
                    {connector.provider} · {connector.kind} · {connector.status}
                    {connector.last_sync_at
                      ? ` · synced ${formatTimestamp(connector.last_sync_at)}`
                      : " · never synced"}
                  </div>
                </div>
                <div className="flex gap-2">
                  <button
                    onClick={() => void onHealth(connector.connector_id)}
                    disabled={busy !== null}
                    className="rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Health
                  </button>
                  <button
                    onClick={() => void onSync(connector.connector_id)}
                    disabled={busy !== null}
                    className="rounded-full bg-neutral-900 px-3 py-1.5 text-xs text-white disabled:opacity-50"
                  >
                    {busy === connector.connector_id ? "…" : "Sync"}
                  </button>
                  <button
                    onClick={() => void onDelete(connector.connector_id)}
                    disabled={busy !== null}
                    className="rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs disabled:opacity-50"
                  >
                    Delete
                  </button>
                </div>
              </div>
            ))}
          </div>
        )}
        {lastSync && (
          <div className="mt-3 rounded-xl border border-hairline bg-panel px-4 py-3 text-sm">
            {"sync" in lastSync && typeof lastSync.sync === "object" && lastSync.sync !== null ? (
              <span>
                Sync complete —{" "}
                {(lastSync.sync as { inserted?: number }).inserted ?? 0} inserted,{" "}
                {(lastSync.sync as { updated?: number }).updated ?? 0} updated
              </span>
            ) : "health" in lastSync &&
              typeof lastSync.health === "object" &&
              lastSync.health !== null ? (
              <span>
                Source {(lastSync.health as { ok?: boolean }).ok ? "reachable" : "unreachable"}
                {(lastSync.health as { detail?: string }).detail
                  ? ` — ${(lastSync.health as { detail?: string }).detail}`
                  : ""}
              </span>
            ) : (
              <span className="font-mono text-xs">
                {JSON.stringify(lastSync)}
              </span>
            )}
          </div>
        )}
      </section>

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">Register a custom REST source</h2>
        <div className="grid grid-cols-1 gap-3 rounded-xl border border-hairline bg-panel-2 p-4 md:grid-cols-3">
          <label className="text-sm">
            <span className="text-xs text-muted">Connector ID</span>
            <input
              value={connectorId}
              onChange={(e) => setConnectorId(e.target.value)}
              placeholder="con_erp_01"
              className="mt-1 w-full rounded-lg border border-hairline bg-panel px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Base URL</span>
            <input
              value={baseUrl}
              onChange={(e) => setBaseUrl(e.target.value)}
              placeholder="https://erp.example.com/api"
              className="mt-1 w-full rounded-lg border border-hairline bg-panel px-3 py-2 font-mono text-sm"
            />
          </label>
          <label className="text-sm">
            <span className="text-xs text-muted">Products path</span>
            <input
              value={productsPath}
              onChange={(e) => setProductsPath(e.target.value)}
              placeholder="/products"
              className="mt-1 w-full rounded-lg border border-hairline bg-panel px-3 py-2 font-mono text-sm"
            />
          </label>
        </div>
        <button
          onClick={() => void onRegister()}
          disabled={busy !== null || !connectorId.trim()}
          className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-full bg-neutral-900 text-sm text-white disabled:opacity-50"
        >
          <RefreshCw size={12} /> Register
        </button>
      </section>
    </div>
  );
}
