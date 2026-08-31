"use client";

import { Activity, Wifi, CreditCard } from "lucide-react";

export function DashboardTopBar() {
  return (
    <header className="h-[52px] sticky top-0 z-40 bg-[rgba(8,8,8,0.96)] border-b border-[var(--bb-line)] backdrop-blur-[12px] flex items-center justify-between px-6">
      {/* Left: Merchant name */}
      <div className="flex items-center gap-4">
        <span className="font-[var(--font-sans)] text-[0.85rem] text-[var(--bb-white)]">
          SELLABLE Demo Store
        </span>
        <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.12em] uppercase px-2 py-0.5 border border-yellow-400/30 text-yellow-400 bg-yellow-400/5 rounded-sm">
          TEST
        </span>
      </div>

      {/* Right: Status indicators */}
      <div className="hidden sm:flex items-center gap-5">
        <div className="flex items-center gap-1.5">
          <Activity size={12} className="text-green-400" />
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
            Agent
          </span>
          <span className="font-[var(--font-mono)] text-[0.55rem] text-green-400">Online</span>
        </div>
        <div className="w-px h-3 bg-[var(--bb-line)]" />
        <div className="flex items-center gap-1.5">
          <Wifi size={12} className="text-green-400" />
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
            Gateway
          </span>
          <span className="font-[var(--font-mono)] text-[0.55rem] text-green-400">Healthy</span>
        </div>
        <div className="w-px h-3 bg-[var(--bb-line)]" />
        <div className="flex items-center gap-1.5">
          <CreditCard size={12} className="text-green-400" />
          <span className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
            Razorpay
          </span>
          <span className="font-[var(--font-mono)] text-[0.55rem] text-green-400">Connected</span>
        </div>
      </div>
    </header>
  );
}
