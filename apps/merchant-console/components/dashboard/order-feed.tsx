const orders = [
  {
    id: "ord_a1b2c3",
    buyer: "agent_buyer_01",
    amount: "₹2,499",
    status: "PAID",
    time: "2 min ago",
  },
  {
    id: "ord_d4e5f6",
    buyer: "agent_buyer_02",
    amount: "₹849",
    status: "AWAITING_CONSENT",
    time: "5 min ago",
  },
  {
    id: "ord_g7h8i9",
    buyer: "agent_buyer_03",
    amount: "₹4,999",
    status: "CONSENTED",
    time: "8 min ago",
  },
  {
    id: "ord_j0k1l2",
    buyer: "agent_buyer_01",
    amount: "₹3,599",
    status: "PAYMENT_PENDING",
    time: "12 min ago",
  },
  {
    id: "ord_m3n4o5",
    buyer: "agent_buyer_04",
    amount: "₹649",
    status: "FULFILLED",
    time: "18 min ago",
  },
];

const statusPills: Record<string, string> = {
  PAID: "bg-green-50 text-green-700",
  AWAITING_CONSENT: "bg-[#fff4e5] text-[#b25e00]",
  CONSENTED: "bg-blue-50 text-blue-700",
  PAYMENT_PENDING: "bg-amber-50 text-amber-800",
  FULFILLED: "bg-green-50 text-green-700",
  PAYMENT_FAILED: "bg-red-50 text-red-700",
  ABORTED: "bg-neutral-100 text-neutral-600",
};

function formatStatus(s: string) {
  return s.toLowerCase().replace(/_/g, " ").replace(/\b\w/g, (c) => c.toUpperCase());
}

export function OrderFeed() {
  return (
    <div className="rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden">
      {/* Header */}
      <div className="px-6 py-4 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl flex items-center justify-between">
        <div className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">
          Live orders
        </div>
        <div className="flex items-center gap-2 rounded-full bg-green-50 px-2.5 py-1">
          <span className="size-1.5 rounded-full bg-green-600 animate-pulse" />
          <span className="text-[12px] font-medium text-green-700">
            Live
          </span>
        </div>
      </div>

      {/* Rows */}
      {orders.map((order, i) => (
        <div
          key={order.id}
          className={`px-6 py-4 ${
            i < orders.length - 1 ? "border-b border-black/[0.05]" : ""
          } hover:bg-black/[0.02] transition-colors`}
        >
          {/* Desktop */}
          <div className="hidden sm:flex items-center justify-between gap-4">
            <div className="flex items-center gap-3 min-w-0">
              <span className="text-[13px] text-neutral-500 tabular-nums truncate">
                {order.id}
              </span>
              <span className="text-[13px] text-neutral-400 truncate">
                {order.buyer}
              </span>
            </div>
            <div className="flex items-center gap-3 shrink-0">
              <span className="text-[15px] font-semibold text-neutral-900 tabular-nums">
                {order.amount}
              </span>
              <span
                className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${statusPills[order.status] || "bg-neutral-100 text-neutral-600"}`}
              >
                {formatStatus(order.status)}
              </span>
              <span className="text-[12px] text-neutral-400 w-[72px] text-right tabular-nums">
                {order.time}
              </span>
            </div>
          </div>

          {/* Mobile */}
          <div className="sm:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="text-[14px] font-medium text-neutral-900 truncate">
                  {order.id}
                </div>
                <div className="text-[12px] text-neutral-500 mt-0.5">
                  {order.buyer}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="text-[15px] font-semibold text-neutral-900 tabular-nums">
                  {order.amount}
                </div>
                <div className="flex items-center gap-2 justify-end mt-1">
                  <span
                    className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium ${statusPills[order.status] || "bg-neutral-100 text-neutral-600"}`}
                  >
                    {formatStatus(order.status)}
                  </span>
                  <span className="text-[12px] text-neutral-400">
                    {order.time}
                  </span>
                </div>
              </div>
            </div>
          </div>
        </div>
      ))}
    </div>
  );
}
