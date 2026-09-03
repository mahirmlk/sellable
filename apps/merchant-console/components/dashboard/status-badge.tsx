import { type TransactionStatus } from "@/lib/types/domain";

const statusConfig: Record<TransactionStatus, { label: string; color: string; bg: string }> = {
  AWAITING_CONSENT: { label: "AWAITING CONSENT", color: "text-[var(--bb-orange)]", bg: "bg-[var(--bb-orange-wash-2)]" },
  CONSENTED: { label: "CONSENTED", color: "text-blue-400", bg: "bg-blue-400/10" },
  PAYMENT_PENDING: { label: "PAYMENT PENDING", color: "text-yellow-400", bg: "bg-yellow-400/10" },
  PAID: { label: "PAID", color: "text-green-400", bg: "bg-green-400/10" },
  FULFILLED: { label: "FULFILLED", color: "text-emerald-300", bg: "bg-emerald-300/10" },
  PAYMENT_FAILED: { label: "PAYMENT FAILED", color: "text-red-400", bg: "bg-red-400/10" },
  ABORTED: { label: "ABORTED", color: "text-[var(--bb-grey-3)]", bg: "bg-[var(--bb-panel-2)]" },
  REFUNDED: { label: "REFUNDED", color: "text-purple-400", bg: "bg-purple-400/10" },
};

export function StatusBadge({ status }: { status: TransactionStatus }) {
  const cfg = statusConfig[status] || statusConfig.AWAITING_CONSENT;
  return (
    <span
      className={`inline-flex items-center gap-1.5 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2 py-0.5 ${cfg.color} ${cfg.bg} rounded-sm`}
    >
      {(status === "PAID" || status === "FULFILLED" || status === "CONSENTED") && (
        <span className="w-1.5 h-1.5 rounded-full bg-current" />
      )}
      {cfg.label}
    </span>
  );
}

export function PolicyBadge({ verdict }: { verdict: "ALLOW" | "DENY" | "NEEDS_HUMAN_APPROVAL" }) {
  const cfg =
    verdict === "ALLOW"
      ? { label: "ALLOW", color: "text-green-400", icon: "✓" }
      : verdict === "DENY"
        ? { label: "DENIED", color: "text-red-400", icon: "✕" }
        : { label: "NEEDS APPROVAL", color: "text-amber-400", icon: "!" };
  return (
    <span className={`inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${cfg.color}`}>
      <span>{cfg.icon}</span>
      {cfg.label}
    </span>
  );
}

export function ConsentBadge({ status }: { status: string }) {
  const isApproved = status === "APPROVED" || status === "CONSENTED";
  return (
    <span
      className={`inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${
        isApproved ? "text-green-400" : "text-[var(--bb-grey-3)]"
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {status}
    </span>
  );
}

export function PaymentBadge({ status }: { status: string }) {
  const isCaptured = status === "CAPTURED" || status === "verified_webhook";
  return (
    <span
      className={`inline-flex items-center gap-1 font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${
        isCaptured ? "text-green-400" : status === "FAILED" ? "text-red-400" : "text-[var(--bb-grey-3)]"
      }`}
    >
      <span className="w-1.5 h-1.5 rounded-full bg-current" />
      {isCaptured ? "CAPTURED" : status === "FAILED" ? "FAILED" : status}
    </span>
  );
}
