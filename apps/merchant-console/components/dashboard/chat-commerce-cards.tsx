"use client";

import Link from "next/link";
import { CheckCircle2, ExternalLink, RotateCcw } from "lucide-react";
import { Card, CardContent, CardDescription, CardHeader, CardTitle } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import { formatDateTime, formatPaise } from "@/lib/formatters";
import type {
  CartPayload,
  ConsentInfo,
  OrderCreateResult,
  PaymentAttemptPayload,
  PolicyDecisionPayload,
} from "@/lib/api";

/* Responsive data cards for the AI Sales checkout panel. shadcn Card + Badge
   composition, theme tokens only, tabular numerals for money. Each card takes
   the full panel width and stacks cleanly on small screens. */

export function FieldRow({ label, children }: { label: string; children: React.ReactNode }) {
  return (
    <div className="flex items-center justify-between gap-3 py-1">
      <span className="text-[12px] text-muted shrink-0">{label}</span>
      <span className="min-w-0 text-right text-[13px] font-medium tabular-nums text-ink">
        {children}
      </span>
    </div>
  );
}

export function CartCard({ cart, productTitle }: { cart: CartPayload; productTitle?: string | null }) {
  return (
    <Card size="sm" className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-[13px]">Cart</CardTitle>
        <Badge variant="secondary" className="tabular-nums">
          Round {cart.negotiation_round}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-3">
        {productTitle && (
          <div className="truncate text-[14px] font-medium text-ink" title={productTitle}>
            {productTitle}
          </div>
        )}
        <div className="space-y-2">
          {cart.items.map((item) => (
            <div key={item.sku} className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="truncate text-[13px] font-medium text-ink">{item.sku}</div>
                <div className="text-[12px] tabular-nums text-muted">
                  {item.quantity} × {formatPaise(item.offered_price_paise)}
                </div>
              </div>
              <div className="shrink-0 text-[13px] font-semibold tabular-nums text-ink">
                {formatPaise(item.line_total_paise ?? item.quantity * item.offered_price_paise)}
              </div>
            </div>
          ))}
        </div>
        {cart.upsell_offered && (
          <div className="rounded-xl border-l-2 border-accent bg-accent-soft/40 px-3 py-2">
            <div className="text-[11px] font-semibold tracking-[0.08em] uppercase text-accent-strong">
              Upsell
            </div>
            {cart.upsell_rationale && (
              <div className="mt-0.5 text-[13px] leading-relaxed text-ink-2">{cart.upsell_rationale}</div>
            )}
          </div>
        )}
        {cart.discount_paise > 0 && (
          <div className="flex items-center justify-between border-t border-hairline pt-2">
            <span className="text-[12px] text-muted">Discount</span>
            <span className="text-[13px] font-medium tabular-nums text-green-700">
              −{formatPaise(cart.discount_paise)}
            </span>
          </div>
        )}
        <div className="flex items-center justify-between border-t border-hairline pt-2.5">
          <span className="text-[12px] font-medium text-muted">Total</span>
          <span className="text-[18px] font-semibold tabular-nums text-ink">
            {formatPaise(cart.total_paise)}
          </span>
        </div>
      </CardContent>
    </Card>
  );
}

export function PolicyCard({ decision }: { decision: PolicyDecisionPayload }) {
  const allowed = decision.verdict === "ALLOW";
  const hitl = decision.verdict === "NEEDS_HUMAN_APPROVAL";
  return (
    <Card size="sm" className="shadow-card">
      <CardHeader className="flex flex-row items-center justify-between gap-2">
        <CardTitle className="text-[13px]">Policy decision</CardTitle>
        <Badge
          variant="secondary"
          className={
            allowed
              ? "bg-green-50 text-green-700"
              : hitl
                ? "bg-amber-50 text-amber-800"
                : "bg-red-50 text-red-700"
          }
        >
          {allowed ? "Allow" : hitl ? "Needs approval" : "Denied"}
        </Badge>
      </CardHeader>
      <CardContent className="space-y-2">
        {decision.reason_code && (
          <div className="text-[12px] font-medium tabular-nums text-ink">{decision.reason_code}</div>
        )}
        <p className="text-[13px] leading-relaxed text-muted">{decision.reasoning_summary}</p>
        {decision.policy_refs.length > 0 && (
          <div className="flex flex-wrap gap-1.5 pt-1">
            {decision.policy_refs.map((ref) => (
              <Badge key={ref} variant="outline" className="font-mono text-[11px] font-normal">
                {ref}
              </Badge>
            ))}
          </div>
        )}
      </CardContent>
    </Card>
  );
}

export function ConsentCard({ consent }: { consent: ConsentInfo }) {
  return (
    <Card size="sm" className="shadow-card">
      <CardHeader>
        <CardTitle className="text-[13px]">Consent</CardTitle>
        <CardDescription className="text-[12px]">
          Single-use and bound to this order only.
        </CardDescription>
      </CardHeader>
      <CardContent>
        <FieldRow label="Status">
          <span className="inline-flex items-center gap-1.5 text-green-700">
            <span className="size-1.5 rounded-full bg-green-600" />
            {consent.status}
          </span>
        </FieldRow>
        <FieldRow label="Amount">{formatPaise(consent.amount_paise)}</FieldRow>
        <FieldRow label="Payee">
          <span className="block truncate text-[12px]" title={consent.payee_id}>
            {consent.payee_id}
          </span>
        </FieldRow>
        <FieldRow label="Purpose">
          <span className="text-[12px]">{consent.purpose}</span>
        </FieldRow>
        <FieldRow label="Single use">{consent.single_use ? "Yes" : "No"}</FieldRow>
        <FieldRow label="Expires">
          <span className="text-[12px]">{formatDateTime(consent.expires_at)}</span>
        </FieldRow>
      </CardContent>
    </Card>
  );
}

export function ReceiptCard({
  order,
  payment,
}: {
  order: OrderCreateResult;
  payment?: PaymentAttemptPayload | null;
}) {
  return (
    <Card size="sm" className="border-green-600/25 bg-green-50 shadow-card dark:bg-green-950/20">
      <CardHeader className="flex flex-row items-center gap-2.5">
        <CheckCircle2 size={20} className="shrink-0 text-green-600" />
        <div>
          <CardTitle className="text-[14px]">Payment captured</CardTitle>
          <CardDescription className="text-[12px]">
            Verified through the signed provider webhook.
          </CardDescription>
        </div>
      </CardHeader>
      <CardContent>
        <FieldRow label="Order">
          <Link
            href={`/dashboard/transactions/${order.order_id}`}
            className="inline-flex items-center gap-1 text-accent-strong hover:underline"
          >
            {order.order_id} <ExternalLink size={10} />
          </Link>
        </FieldRow>
        <FieldRow label="Amount">{formatPaise(order.amount_paise)}</FieldRow>
        {payment?.provider_payment_id && (
          <FieldRow label="Payment ID">
            <span className="block truncate text-[12px]" title={payment.provider_payment_id}>
              {payment.provider_payment_id}
            </span>
          </FieldRow>
        )}
        <Link
          href={`/dashboard/transactions/${order.order_id}/replay`}
          className="mt-3 inline-flex h-9 w-full items-center justify-center gap-2 rounded-full border border-green-600/25 bg-panel text-[13px] font-medium text-green-700 transition-colors hover:bg-green-100"
        >
          <RotateCcw size={12} /> View replay
        </Link>
      </CardContent>
    </Card>
  );
}
