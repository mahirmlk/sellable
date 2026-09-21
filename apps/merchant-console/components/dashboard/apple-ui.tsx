"use client";

import type { ReactNode } from "react";

/* Canonical Apple premium wrappers for dashboard pages.
   Use these for all new dashboard UI; migrate legacy pages to them
   incrementally. All styles assume the .dashboard-apple scope. */

export function ApplePage({ children }: { children: ReactNode }) {
  return <div className="px-6 lg:px-8 py-6 space-y-8 max-w-[1200px]">{children}</div>;
}

export function AppleCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] overflow-hidden ${className}`}
    >
      {children}
    </div>
  );
}

export function AppleCardHeader({ title, hint, action }: { title: string; hint?: string; action?: ReactNode }) {
  return (
    <div className="px-6 py-4 border-b border-black/[0.06] bg-white/80 backdrop-blur-xl flex items-center justify-between gap-3">
      <div className="text-[15px] font-semibold tracking-[-0.01em] text-neutral-900">{title}</div>
      {hint ? <div className="text-[13px] text-neutral-500">{hint}</div> : null}
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

type ButtonTone = "primary" | "secondary" | "danger" | "success" | "ghost";

const toneClasses: Record<ButtonTone, string> = {
  primary: "bg-[#0071e3] text-white hover:bg-[#0077ed] shadow-sm",
  secondary: "bg-white text-neutral-700 border border-black/10 shadow-sm hover:bg-neutral-50 hover:text-neutral-900",
  danger: "bg-red-50 text-red-700 border border-red-200/60 hover:bg-red-100",
  success: "bg-green-50 text-green-700 border border-green-200/60 hover:bg-green-100",
  ghost: "bg-black/[0.05] text-neutral-700 hover:bg-black/10 hover:text-neutral-900",
};

export function AppleButton({
  children,
  onClick,
  disabled,
  tone = "secondary",
  type = "button",
  ariaLabel,
}: {
  children: ReactNode;
  onClick?: () => void;
  disabled?: boolean;
  tone?: ButtonTone;
  type?: "button" | "submit";
  ariaLabel?: string;
}) {
  return (
    <button
      type={type}
      onClick={onClick}
      disabled={disabled}
      aria-label={ariaLabel}
      className={`inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-[#0071e3] active:scale-[0.98] ${toneClasses[tone]}`}
    >
      {children}
    </button>
  );
}

export function AppleInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-3 placeholder:text-neutral-400 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow ${props.className || ""}`}
    />
  );
}

export function AppleSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 rounded-[10px] bg-white border border-black/[0.12] text-[14px] text-neutral-900 px-2.5 focus:outline-none focus:border-[#0071e3] focus:ring-[3px] focus:ring-[#0071e3]/20 transition-shadow cursor-pointer ${props.className || ""}`}
    />
  );
}

export function AppleField({ label, children, hint }: { label: string; children: ReactNode; hint?: string }) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-black/[0.05] last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] text-neutral-500">{label}</div>
        {hint ? <div className="text-[12px] text-neutral-400 mt-0.5">{hint}</div> : null}
      </div>
      <div className="flex items-center gap-2 shrink-0">{children}</div>
    </div>
  );
}

const badgeTones: Record<string, string> = {
  green: "bg-green-50 text-green-700",
  amber: "bg-amber-50 text-amber-800",
  red: "bg-red-50 text-red-700",
  blue: "bg-blue-50 text-blue-700",
  orange: "bg-[#fff4e5] text-[#b25e00]",
  neutral: "bg-neutral-100 text-neutral-600",
  purple: "bg-purple-50 text-purple-700",
};

export function AppleBadge({ children, tone = "neutral" }: { children: ReactNode; tone?: keyof typeof badgeTones }) {
  return (
    <span className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${badgeTones[tone]}`}>
      {children}
    </span>
  );
}

export function AppleListRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div className={`px-6 py-4 border-b border-black/[0.05] last:border-b-0 hover:bg-black/[0.02] transition-colors ${className}`}>
      {children}
    </div>
  );
}
