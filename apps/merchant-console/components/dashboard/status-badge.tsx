import { type TransactionStatus } from "@/lib/types/domain";

const statusConfig: Record<TransactionStatus, { label: string; classes: string; dot?: boolean }> = {
  AWAITING_CONSENT: { label: "Awaiting consent", classes: "bg-[#fff4e5] text-[#b25e00]", dot: true },
  CONSENTED: { label: "Consented", classes: "bg-blue-50 text-blue-700", dot: true },
  PAYMENT_PENDING: { label: "Payment pending", classes: "bg-amber-50 text-amber-800", dot: true },
  PAID: { label: "Paid", classes: "bg-green-50 text-green-700", dot: true },
  FULFILLED: { label: "Fulfilled", classes: "bg-green-50 text-green-700", dot: true },
  PAYMENT_FAILED: { label: "Payment failed", classes: "bg-red-50 text-red-700", dot: true },
  ABORTED: { label: "Aborted", classes: "bg-neutral-100 text-neutral-600" },
  REFUNDED: { label: "Refunded", classes: "bg-purple-50 text-purple-700" },
};

function formatStatus(s: string) {
  return s
    .toLowerCase()
    .replace(/_/g, " ")
    .replace(/\b\w/g, (c) => c.toUpperCase());
}

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const cfg = statusConfig[status] || {
    label: formatStatus(String(status)),
    classes: "bg-neutral-100 text-neutral-600",
  };
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${cfg.classes}`}
    >
      {cfg.dot ? <span className="size-1.5 rounded-full bg-current" /> : null}
      {cfg.label}
    </span>
  );
}

export function PolicyBadge({ verdict }: { verdict: "ALLOW" | "DENY" | "NEEDS_HUMAN_APPROVAL" }) {
  const cfg =
    verdict === "ALLOW"
      ? { label: "Allow", classes: "bg-green-50 text-green-700" }
      : verdict === "DENY"
        ? { label: "Denied", classes: "bg-red-50 text-red-700" }
        : { label: "Needs approval", classes: "bg-amber-50 text-amber-800" };
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${cfg.classes}`}>
      <span className="size-1.5 rounded-full bg-current" />
      {cfg.label}
    </span>
  );
}

export function ConsentBadge({ status }: { status: string }) {
  const isApproved = status === "CONSENTED" || status === "CONSUMED";
  const isIssued = status === "ISSUED";
  const isExpired = status === "EXPIRED";
  const classes = isApproved
    ? "bg-green-50 text-green-700"
    : isIssued
      ? "bg-blue-50 text-blue-700"
      : isExpired
        ? "bg-amber-50 text-amber-800"
        : "bg-neutral-100 text-neutral-600";
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${classes}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {formatStatus(status)}
    </span>
  );
}

export function PaymentBadge({ status }: { status: string }) {
  const isCaptured = status === "CAPTURED" || status === "verified_webhook";
  const classes = isCaptured
    ? "bg-green-50 text-green-700"
    : status === "FAILED"
      ? "bg-red-50 text-red-700"
      : "bg-neutral-100 text-neutral-600";
  const label = isCaptured ? "Captured" : status === "FAILED" ? "Failed" : formatStatus(status);
  return (
    <span
      className={`inline-flex items-center gap-1.5 rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${classes}`}
    >
      <span className="size-1.5 rounded-full bg-current" />
      {label}
    </span>
  );
}
