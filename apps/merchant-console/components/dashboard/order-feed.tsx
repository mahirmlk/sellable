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

const statusColors: Record<string, string> = {
  PAID: "text-green-400",
  AWAITING_CONSENT: "text-[var(--bb-orange)]",
  CONSENTED: "text-blue-400",
  PAYMENT_PENDING: "text-yellow-400",
  FULFILLED: "text-green-400",
  PAYMENT_FAILED: "text-red-400",
  ABORTED: "text-[var(--bb-grey-3)]",
};

export function OrderFeed() {
  return (
    <div className="border border-[var(--bb-line)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center justify-between">
        <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          LIVE ORDER FEED
        </div>
        <div className="flex items-center gap-2">
          <span className="w-1.5 h-1.5 rounded-full bg-green-500 animate-[blink_2s_ease-in-out_infinite]" />
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
            STREAMING
          </span>
        </div>
      </div>

      {/* Rows */}
      {orders.map((order, i) => (
        <div
          key={order.id}
          className={`px-5 py-3.5 ${
            i < orders.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
          } hover:bg-[var(--bb-panel)] transition-colors`}
        >
          {/* Desktop */}
          <div className="hidden sm:flex items-center justify-between">
            <div className="flex items-center gap-4">
              <span className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-grey-2)]">
                {order.id}
              </span>
              <span className="font-[var(--font-mono)] text-[0.65rem] text-[var(--bb-grey-3)]">
                {order.buyer}
              </span>
            </div>
            <div className="flex items-center gap-5">
              <span className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">
                {order.amount}
              </span>
              <span
                className={`font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase ${statusColors[order.status] || "text-[var(--bb-grey-2)]"}`}
              >
                {order.status}
              </span>
              <span className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-4)] w-[60px] text-right">
                {order.time}
              </span>
            </div>
          </div>

          {/* Mobile */}
          <div className="sm:hidden">
            <div className="flex items-center justify-between gap-3">
              <div className="min-w-0">
                <div className="font-[var(--font-mono)] text-[0.75rem] text-[var(--bb-white)]">
                  {order.id}
                </div>
                <div className="font-[var(--font-mono)] text-[0.6rem] text-[var(--bb-grey-3)] mt-0.5">
                  {order.buyer}
                </div>
              </div>
              <div className="text-right flex-shrink-0">
                <div className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">
                  {order.amount}
                </div>
                <div className="flex items-center gap-2 justify-end mt-0.5">
                  <span
                    className={`font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase ${statusColors[order.status] || "text-[var(--bb-grey-2)]"}`}
                  >
                    {order.status}
                  </span>
                  <span className="font-[var(--font-mono)] text-[0.55rem] text-[var(--bb-grey-4)]">
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
