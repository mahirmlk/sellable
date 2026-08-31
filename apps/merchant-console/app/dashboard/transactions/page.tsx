"use client";

import Link from "next/link";
import { useEffect, useState, useCallback } from "react";
import { RefreshCw } from "lucide-react";
import { StatusBadge, PolicyBadge, ConsentBadge, PaymentBadge } from "@/components/dashboard/status-badge";
import { MoneyValue } from "@/components/dashboard/money-value";
import { formatTimeAgo } from "@/lib/formatters";
import { getConsoleTransactions, type ConsoleTransaction } from "@/lib/api";
import { type Transaction, type TransactionStatus } from "@/lib/types/domain";

function mapTx(tx: ConsoleTransaction): Transaction {
  const statusMap: Record<string, TransactionStatus> = {
    AWAITING_CONSENT: "NEEDS_HUMAN_APPROVAL",
    CONSENTED: "AWAITING_CONSENT",
    PAYMENT_PENDING: "PAYMENT_PENDING",
    PAID: "PAID",
    PAYMENT_FAILED: "PAYMENT_FAILED",
    ABORTED: "DENIED",
    REFUNDED: "REFUNDED",
    QUOTED: "QUOTED",
    FULFILLED: "PAID",
  };
  return {
    id: tx.order_id,
    traceId: tx.trace_id,
    status: statusMap[tx.status] || tx.status as TransactionStatus,
    amountPaise: tx.amount_paise,
    buyer: { id: tx.buyer_agent_id, type: "agent" },
    channel: "agent_to_agent",
    policy: { verdict: "ALLOW", policyRefs: [] },
    updatedAt: tx.created_at,
  };
}

export default function TransactionsPage() {
  const [transactions, setTransactions] = useState<Transaction[]>([]);
  const [loading, setLoading] = useState(true);
  const [statusFilter, setStatusFilter] = useState<string>("all");

  const fetchData = useCallback(async () => {
    setLoading(true);
    try {
      const data = await getConsoleTransactions();
      setTransactions(data.map(mapTx));
    } catch {} finally { setLoading(false); }
  }, []);

  useEffect(() => { fetchData(); }, [fetchData]);

  const filtered = statusFilter === "all" ? transactions : transactions.filter((tx) => tx.status === statusFilter);
  const statuses = ["all", "PAID", "AWAITING_CONSENT", "NEEDS_HUMAN_APPROVAL", "PAYMENT_PENDING", "PAYMENT_FAILED", "DENIED", "REFUNDED"];

  return (
    <div className="p-6 space-y-6">
      <div className="flex items-center justify-between">
        <div>
          <h1 className="font-[var(--font-sans)] text-[1.5rem] tracking-[-0.04em] text-[var(--bb-white)]">Transactions</h1>
          <p className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)] mt-1">FINANCIAL OPERATIONS VIEW</p>
        </div>
        <button onClick={fetchData} disabled={loading} className="inline-flex items-center gap-2 h-[32px] px-3 border border-[var(--bb-line)] bg-[var(--bb-panel)] font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)] transition-all cursor-pointer disabled:opacity-50">
          <RefreshCw size={12} className={loading ? "animate-spin" : ""} /> REFRESH
        </button>
      </div>

      <div className="flex flex-wrap gap-2 stagger-child">
        {statuses.map((s) => (
          <button key={s} onClick={() => setStatusFilter(s)} className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase px-3 py-1.5 border transition-all cursor-pointer ${statusFilter === s ? "border-[var(--bb-orange)] bg-[var(--bb-orange)]/10 text-[var(--bb-orange)]" : "border-[var(--bb-line)] bg-transparent text-[var(--bb-grey-3)] hover:text-[var(--bb-white)] hover:border-[var(--bb-grey-4)]"}`}>
            {s === "all" ? "ALL" : s.replace(/_/g, " ")}
          </button>
        ))}
      </div>

      <div className="border border-[var(--bb-line)] overflow-hidden">
        <div className="hidden lg:grid grid-cols-[140px_100px_100px_100px_100px_100px_100px_120px_80px] gap-3 px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)]">
          {["ORDER", "BUYER", "CHANNEL", "AMOUNT", "POLICY", "CONSENT", "PAYMENT", "STATUS", "UPDATED"].map((h) => (
            <div key={h} className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">{h}</div>
          ))}
        </div>

        {filtered.length === 0 ? (
          <div className="px-5 py-12 text-center">
            <div className="font-[var(--font-mono)] text-[0.65rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
              {loading ? "Loading transactions..." : "No transactions found."}
            </div>
          </div>
        ) : filtered.map((tx, i) => (
          <Link key={tx.id} href={`/dashboard/transactions/${tx.id}`} className={`block hover:bg-[var(--bb-panel)] transition-colors ${i < filtered.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""}`}>
            <div className="hidden lg:grid grid-cols-[140px_100px_100px_100px_100px_100px_100px_120px_80px] gap-3 px-5 py-4 items-center">
              <div className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">{tx.id}</div>
              <div className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-2)]">{tx.buyer.id}</div>
              <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.08em] uppercase text-[var(--bb-grey-3)]">{tx.channel === "agent_to_agent" ? "A2A" : "CHAT"}</div>
              <MoneyValue paise={tx.amountPaise} />
              <PolicyBadge verdict={tx.policy.verdict} />
              <ConsentBadge status={tx.consent?.status || "NONE"} />
              <PaymentBadge status={tx.payment?.status || "NONE"} />
              <StatusBadge status={tx.status} />
              <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">{formatTimeAgo(tx.updatedAt)}</div>
            </div>
            <div className="lg:hidden px-5 py-4">
              <div className="flex items-start justify-between gap-3 mb-2">
                <div>
                  <div className="font-[var(--font-mono)] text-[0.8rem] text-[var(--bb-white)]">{tx.id}</div>
                  <div className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-3)] mt-0.5">{tx.buyer.id} · {tx.channel === "agent_to_agent" ? "A2A" : "CHAT"}</div>
                </div>
                <div className="text-right">
                  <MoneyValue paise={tx.amountPaise} />
                  <div className="mt-1"><StatusBadge status={tx.status} /></div>
                </div>
              </div>
              <div className="flex items-center gap-4 text-[0.55rem]">
                <PolicyBadge verdict={tx.policy.verdict} />
                <ConsentBadge status={tx.consent?.status || "NONE"} />
                <PaymentBadge status={tx.payment?.status || "NONE"} />
              </div>
            </div>
          </Link>
        ))}
      </div>
    </div>
  );
}
