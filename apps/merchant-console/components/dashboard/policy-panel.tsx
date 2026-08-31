"use client";

import { useState } from "react";
import { Shield, AlertTriangle, CheckCircle, TrendingUp, ShoppingBag, Users } from "lucide-react";

const policy = {
  merchant_id: "mrc_demo_store",
  currency: "INR",
  max_order_value_paise: 500000,
  max_single_item_value_paise: 300000,
  max_discount_percent: 10,
  allowed_categories: ["accessories", "gifting", "snacks"],
  max_negotiation_rounds: 5,
  max_upsells_per_session: 1,
  human_approval_threshold_paise: 200000,
};

function formatPaise(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN")}`;
}

const policyRows = [
  { label: "MAX ORDER VALUE", value: formatPaise(policy.max_order_value_paise), highlight: false, icon: <TrendingUp size={14} /> },
  { label: "MAX ITEM VALUE", value: formatPaise(policy.max_single_item_value_paise), highlight: false, icon: <ShoppingBag size={14} /> },
  { label: "MAX DISCOUNT", value: `${policy.max_discount_percent}%`, highlight: false, icon: <CheckCircle size={14} /> },
  { label: "NEGOTIATION ROUNDS", value: String(policy.max_negotiation_rounds), highlight: false, icon: <Users size={14} /> },
  { label: "MAX UPSELLS / SESSION", value: String(policy.max_upsells_per_session), highlight: false, icon: <ShoppingBag size={14} /> },
  { label: "HITL THRESHOLD", value: formatPaise(policy.human_approval_threshold_paise), highlight: true, icon: <AlertTriangle size={14} /> },
];

export function PolicyPanel() {
  const [hoveredRow, setHoveredRow] = useState<number | null>(null);

  return (
    <div className="border border-[var(--bb-line)] overflow-hidden">
      {/* Header */}
      <div className="px-5 py-3 border-b border-[var(--bb-line)] bg-[var(--bb-panel)] flex items-center gap-2">
        <Shield size={14} className="text-[var(--bb-orange)]" />
        <div className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)]">
          MERCHANT POLICY
        </div>
      </div>

      {/* Merchant ID */}
      <div className="px-5 py-4 border-b border-[var(--bb-line-soft)]">
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-1">
          MERCHANT
        </div>
        <div className="font-[var(--font-mono)] text-[0.85rem] text-[var(--bb-white)]">
          {policy.merchant_id}
        </div>
      </div>

      {/* Policy rows */}
      {policyRows.map((row, i) => (
        <div
          key={row.label}
          className={`px-5 py-3.5 flex items-center justify-between transition-all duration-200 cursor-default ${
            i < policyRows.length - 1 ? "border-b border-[var(--bb-line-soft)]" : ""
          } ${
            hoveredRow === i ? "bg-[var(--bb-panel)] pl-7" : ""
          }`}
          onMouseEnter={() => setHoveredRow(i)}
          onMouseLeave={() => setHoveredRow(null)}
        >
          <div className="flex items-center gap-2.5">
            <span className={`transition-colors duration-200 ${hoveredRow === i ? "text-[var(--bb-orange)]" : "text-[var(--bb-grey-4)]"}`}>
              {row.icon}
            </span>
            <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.12em] uppercase text-[var(--bb-grey-3)]">
              {row.label}
            </span>
          </div>
          <span
            className={`font-[var(--font-mono)] text-[0.85rem] transition-all duration-200 ${
              row.highlight ? "text-[var(--bb-orange)]" : hoveredRow === i ? "text-[var(--bb-white)]" : "text-[var(--bb-white)]"
            }`}
          >
            {row.value}
          </span>
        </div>
      ))}

      {/* Allowed categories */}
      <div className="px-5 py-4 border-t border-[var(--bb-line)]">
        <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-4)] mb-3">
          ALLOWED CATEGORIES
        </div>
        <div className="flex flex-wrap gap-2">
          {policy.allowed_categories.map((cat) => (
            <span
              key={cat}
              className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase px-2.5 py-1 border border-[var(--bb-grey-4)] text-[var(--bb-grey-2)] hover:border-[var(--bb-orange)] hover:text-[var(--bb-orange)] hover:bg-[var(--bb-orange-wash-2)] transition-all duration-200 cursor-default"
            >
              {cat}
            </span>
          ))}
        </div>
      </div>
    </div>
  );
}
