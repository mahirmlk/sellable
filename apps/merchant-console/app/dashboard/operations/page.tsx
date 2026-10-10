"use client";

import { useState, useEffect, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { formatPaise, formatTimestamp } from "@/lib/formatters";
import { EmptyState } from "@/components/dashboard/empty-state";
import { TableSkeleton } from "@/components/dashboard/loading-skeleton";
import { ErrorBanner } from "@/components/dashboard/error-banner";
import {
  getOpsOverview,
  drainEventBus,
  listDeadLetters,
  retryDeadLetter,
  listNotifications,
  markNotificationRead,
  getAnalyticsOverview,
  listWebhookSubscriptions,
  createWebhookSubscription,
  deleteWebhookSubscription,
  listWebhookDispatches,
  getBilling,
  getOnboardingReadiness,
  type OpsOverview,
  type MerchantNotification,
  type AnalyticsOverview,
  type WebhookSubscriptionView,
  type WebhookDispatchView,
  type BillingView,
  type ReadinessView,
} from "@/lib/api";

const SUBSCRIBABLE = [
  "order.created",
  "order.paid",
  "order.shipped",
  "order.delivered",
  "checkout.completed",
  "refund.completed",
  "return.created",
  "support.case.updated",
  "risk.action_taken",
];

function StatCard({
  label,
  value,
  tone,
}: {
  label: string;
  value: string | number;
  tone?: "red" | "amber" | "neutral";
}) {
  const toneClass =
    tone === "red"
      ? "border-red-600/20 bg-red-50 text-red-700"
      : tone === "amber"
        ? "border-amber-600/20 bg-amber-50 text-amber-800"
        : "border-hairline bg-card text-ink";
  return (
    <div className={`rounded-[18px] border shadow-card p-5 ${toneClass}`}>
      <div className="text-[13px] font-medium text-muted mb-2 truncate">
        {label}
      </div>
      <div className="font-semibold text-[28px] leading-none tracking-tight tabular-nums">
        {value}
      </div>
    </div>
  );
}

interface DeadLetter {
  event_id: string;
  event_type: string;
  aggregate_id: string;
  trace_id: string;
  attempts: number;
  last_error: string | null;
  occurred_at: string;
}

export default function OperationsPage() {
  const [ops, setOps] = useState<OpsOverview | null>(null);
  const [analytics, setAnalytics] = useState<AnalyticsOverview | null>(null);
  const [deadLetters, setDeadLetters] = useState<DeadLetter[] | null>(null);
  const [notifications, setNotifications] = useState<MerchantNotification[] | null>(null);
  const [subscriptions, setSubscriptions] = useState<WebhookSubscriptionView[] | null>(null);
  const [dispatches, setDispatches] = useState<WebhookDispatchView[] | null>(null);
  const [billing, setBilling] = useState<BillingView | null>(null);
  const [readiness, setReadiness] = useState<ReadinessView | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [draining, setDraining] = useState(false);
  const [newUrl, setNewUrl] = useState("");
  const [newEvents, setNewEvents] = useState<string[]>(["order.paid"]);
  const [newSecret, setNewSecret] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const [opsData, analyticsData, deadData, notifData, subsData, dispData, billingData, readinessData] =
        await Promise.all([
          getOpsOverview(),
          getAnalyticsOverview(30),
          listDeadLetters(),
          listNotifications(),
          listWebhookSubscriptions(),
          listWebhookDispatches(50),
          getBilling(30),
          getOnboardingReadiness(),
        ]);
      setOps(opsData);
      setAnalytics(analyticsData);
      setDeadLetters(deadData);
      setNotifications(notifData);
      setSubscriptions(subsData);
      setDispatches(dispData);
      setBilling(billingData);
      setReadiness(readinessData);
    } catch (err) {
      setError(err instanceof Error ? err.message : "Failed to load operations");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    refresh();
  }, [refresh]);

  const onDrain = async () => {
    setDraining(true);
    try {
      await drainEventBus();
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Drain failed");
    } finally {
      setDraining(false);
    }
  };

  const onRetry = async (eventId: string) => {
    try {
      await retryDeadLetter(eventId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Retry failed");
    }
  };

  const onMarkRead = async (notificationId: string) => {
    try {
      await markNotificationRead(notificationId);
      setNotifications((prev) =>
        prev ? prev.filter((n) => n.notification_id !== notificationId) : prev
      );
    } catch (err) {
      setError(err instanceof Error ? err.message : "Mark-read failed");
    }
  };

  const onSubscribe = async () => {
    if (!newUrl) return;
    try {
      const created = await createWebhookSubscription(newUrl, newEvents);
      setNewSecret(created.secret);
      setNewUrl("");
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Subscribe failed");
    }
  };

  const onUnsubscribe = async (subscriptionId: string) => {
    try {
      await deleteWebhookSubscription(subscriptionId);
      await refresh();
    } catch (err) {
      setError(err instanceof Error ? err.message : "Unsubscribe failed");
    }
  };

  const toggleEvent = (event: string) => {
    setNewEvents((prev) =>
      prev.includes(event) ? prev.filter((e) => e !== event) : [...prev, event]
    );
  };

  if (loading && !ops) {
    return (
      <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
        <div>
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            Operations
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Operations
          </h1>
        </div>
        <TableSkeleton />
      </div>
    );
  }

  return (
    <div className="px-6 lg:px-8 py-6 space-y-6 max-w-[1200px]">
      <div className="flex flex-wrap items-start justify-between gap-4">
        <div className="min-w-0">
          <div className="font-[var(--font-mono)] text-[11px] tracking-[0.12em] uppercase text-faint">
            Operations
          </div>
          <h1 className="mt-1.5 text-[24px] font-semibold tracking-[-0.01em] text-ink">
            Operations
          </h1>
          <p className="mt-1 max-w-[46rem] text-[13px] leading-relaxed text-muted">
            Event bus health, notifications, analytics, and webhook subscriptions.
          </p>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <button
            onClick={refresh}
            className="inline-flex items-center gap-2 h-9 px-4 border border-hairline bg-panel text-[13px] text-ink hover:bg-panel-2 transition-all cursor-pointer font-medium rounded-full"
          >
            <RefreshCw size={12} /> Refresh
          </button>
        </div>
      </div>

      {error && <ErrorBanner message={error} onRetry={refresh} />}

      <section>
        <h2 className="mb-3 text-sm font-semibold">Event bus</h2>
        {ops ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="Pending events" value={ops.outbox.pending} />
            <StatCard
              label="Dead-lettered"
              value={ops.outbox.dead_lettered}
              tone={ops.outbox.dead_lettered > 0 ? "red" : "neutral"}
            />
            <StatCard
              label="Risk blocks"
              value={ops.risk.recent_blocks}
              tone={ops.risk.recent_blocks > 0 ? "amber" : "neutral"}
            />
            <StatCard
              label="Agent run failures"
              value={ops.agent_runs.failures}
              tone={ops.agent_runs.failures > 0 ? "amber" : "neutral"}
            />
          </div>
        ) : (
          <EmptyState
            title="No operations data yet"
            message="Complete a transaction to populate this view."
          />
        )}
        <button
          onClick={onDrain}
          disabled={draining}
          className="mt-3 inline-flex items-center gap-2 h-9 px-4 rounded-full border border-hairline bg-panel text-[13px] font-medium text-ink hover:bg-panel-2 transition-all cursor-pointer disabled:opacity-50"
        >
          <RefreshCw size={12} /> {draining ? "Draining…" : "Drain event bus"}
        </button>
      </section>

      {deadLetters && deadLetters.length > 0 && (
        <section className="border-t border-hairline pt-6">
          <h2 className="mb-3 text-sm font-semibold">
            Dead letters ({deadLetters.length})
          </h2>
          <div className="space-y-2">
            {deadLetters.map((d) => (
              <div
                key={d.event_id}
                className="flex items-center justify-between rounded-xl border border-red-600/20 bg-red-50 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {d.event_type} · {d.aggregate_id}
                  </div>
                  <div className="text-xs text-muted">
                    {d.attempts} attempts · {d.last_error} · {formatTimestamp(d.occurred_at)}
                  </div>
                </div>
                <button
                  onClick={() => onRetry(d.event_id)}
                  className="rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs"
                >
                  Retry
                </button>
              </div>
            ))}
          </div>
        </section>
      )}

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">Notifications</h2>
        {!notifications || notifications.length === 0 ? (
          <EmptyState
            title="No notifications"
            message="Merchant alerts for payments, refunds, escalations, and risk blocks land here."
          />
        ) : (
          <div className="space-y-2">
            {notifications.map((n) => (
              <div
                key={n.notification_id}
                className="flex items-center justify-between rounded-xl border border-hairline bg-panel-2 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">
                    {n.urgency === "URGENT" ? "Urgent · " : ""}
                    {n.title}
                  </div>
                  <div className="text-xs text-muted">
                    {n.body} · {formatTimestamp(n.created_at)}
                  </div>
                </div>
                <button
                  onClick={() => onMarkRead(n.notification_id)}
                  className="rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs"
                >
                  Mark read
                </button>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">Analytics (30 days)</h2>
        {analytics ? (
          <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
            <StatCard label="GMV" value={formatPaise(analytics.gmv_paise)} />
            <StatCard label="Paid orders" value={analytics.orders_paid} />
            <StatCard
              label="Conversion"
              value={`${(analytics.conversion_rate_bps / 100).toFixed(1)}%`}
            />
            <StatCard label="AOV" value={formatPaise(analytics.aov_paise)} />
            <StatCard
              label="Agent-assisted checkouts"
              value={analytics.agent_assisted_checkouts}
            />
            <StatCard
              label="Promotion redemptions"
              value={analytics.promotion_redemptions}
            />
            <StatCard
              label="Promotion discounts"
              value={formatPaise(analytics.promotion_discount_paise)}
            />
            <StatCard label="Refunds" value={analytics.refunds_completed} />
          </div>
        ) : (
          <EmptyState
            title="No analytics yet"
            message="Settled payments populate GMV, conversion, and order metrics."
          />
        )}
      </section>

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">Webhook subscriptions</h2>
        {!subscriptions || subscriptions.length === 0 ? (
          <EmptyState
            title="No webhook subscriptions"
            message="Deliveries only flow when at least one subscription exists."
          />
        ) : (
          <div className="space-y-2">
            {subscriptions.map((s) => (
              <div
                key={s.subscription_id}
                className="flex items-center justify-between rounded-xl border border-hairline bg-panel-2 px-4 py-3 text-sm"
              >
                <div>
                  <div className="font-medium">{s.url}</div>
                  <div className="text-xs text-muted">{s.events.join(", ")}</div>
                </div>
                <button
                  onClick={() => onUnsubscribe(s.subscription_id)}
                  className="rounded-full border border-hairline bg-panel px-3 py-1.5 text-xs"
                >
                  Delete
                </button>
              </div>
            ))}
          </div>
        )}
        {newSecret && (
          <div className="mt-3 rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm">
            Signing secret (shown once; persist it now):{" "}
            <code className="font-mono">{newSecret}</code>
          </div>
        )}
        <div className="mt-3 space-y-2 rounded-xl border border-hairline bg-panel-2 p-4">
          <input
            value={newUrl}
            onChange={(e) => setNewUrl(e.target.value)}
            placeholder="https://agents.example.com/hook"
            className="w-full rounded-lg border border-hairline bg-panel px-3 py-2 text-sm"
          />
          <div className="flex flex-wrap gap-2">
            {SUBSCRIBABLE.map((event) => (
              <label key={event} className="flex items-center gap-1 text-xs">
                <input
                  type="checkbox"
                  checked={newEvents.includes(event)}
                  onChange={() => toggleEvent(event)}
                />
                {event}
              </label>
            ))}
          </div>
          <button
            onClick={onSubscribe}
            disabled={!newUrl || newEvents.length === 0}
            className="rounded-full bg-neutral-900 px-4 py-2 text-sm text-white disabled:opacity-50"
          >
            Subscribe
          </button>
        </div>
      </section>

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">Recent deliveries</h2>
        {!dispatches || dispatches.length === 0 ? (
          <EmptyState
            title="No deliveries yet"
            message="Signed webhook attempts land here with status and attempt counts."
          />
        ) : (
          <div className="space-y-1.5">
            {dispatches.slice(0, 20).map((d) => (
              <div
                key={d.dispatch_id}
                className={`flex items-center justify-between rounded-lg border px-3 py-2 text-xs ${
                  d.status === "SENT"
                    ? "border-hairline bg-panel-2"
                    : "border-red-600/20 bg-red-50"
                }`}
              >
                <span className="font-mono">
                  {d.event_type} to {d.subscription_id.slice(0, 12)}…
                </span>
                <span className="text-muted">
                  {d.status} · {d.attempts} attempt(s)
                  {d.last_error ? ` · ${d.last_error}` : ""}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">Billing (30 days)</h2>        {!billing ? (
          <EmptyState
            title="No billing data"
            message="Usage against plan quotas for the last 30 days."
          />
        ) : (
          <div>
            <div className="grid grid-cols-2 gap-3 md:grid-cols-4">
              <StatCard label="Plan" value={billing.plan} />
              <StatCard
                label="Orders"
                value={`${billing.usage.orders} / ${billing.quotas.orders_per_month}`}
                tone={billing.over_quota ? "amber" : "neutral"}
              />
              <StatCard
                label="Agent runs"
                value={`${billing.usage.agent_runs} / ${billing.quotas.agent_runs_per_month}`}
                tone={billing.over_quota ? "amber" : "neutral"}
              />
              <StatCard
                label="Ledger events"
                value={`${billing.usage.ledger_events} / ${billing.quotas.events_per_month}`}
                tone={billing.over_quota ? "amber" : "neutral"}
              />
            </div>
            {billing.over_quota && (
              <div className="mt-3 rounded-xl border border-amber-600/20 bg-amber-50 px-4 py-3 text-sm text-amber-800">
                Usage is over quota. Upgrade the plan to keep headroom.
              </div>
            )}
          </div>
        )}
      </section>

      <section className="border-t border-hairline pt-6">
        <h2 className="mb-3 text-sm font-semibold">
          Merchant readiness{" "}
          {readiness && (
            <span
              className={`ml-1 rounded-full border px-2 py-0.5 text-xs font-medium ${
                readiness.activation_ready
                  ? "border-green-600/20 bg-green-50 text-green-700"
                  : "border-amber-600/20 bg-amber-50 text-amber-800"
              }`}
            >
              {readiness.activation_ready ? "READY" : `STAGE ${readiness.stage}`}
            </span>
          )}
        </h2>
        {!readiness ? (
          <EmptyState
            title="No readiness data"
            message="Pre-activation checks, computed from live platform state."
          />
        ) : (
          <div className="grid grid-cols-1 gap-1.5 md:grid-cols-2">
            {Object.entries(readiness.checks).map(([check, passed]) => (
              <div
                key={check}
                className="flex items-center justify-between rounded-lg border border-hairline bg-panel-2 px-3 py-2 text-xs"
              >
                <span className="font-mono">{check}</span>
                <span className={passed ? "text-green-700" : "text-amber-700"}>
                  {passed ? "PASS" : "OPEN"}
                </span>
              </div>
            ))}
          </div>
        )}
      </section>
    </div>
  );
}
