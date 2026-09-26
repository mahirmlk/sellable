"use client";

import type { ReactNode } from "react";

/* Aurora Glass primitives: canonical theme-aware wrappers for dashboard
   pages — panels, pill buttons, rounded inputs, field rows and chips.
   Colors come only from the semantic tokens (bg-canvas / bg-panel / text-ink
   / border-hairline / text-accent-strong …) so everything flips with
   [data-theme] light+dark. Use these for all new dashboard UI; migrate
   legacy pages to them incrementally. All styles assume the .dashboard-app
   scope. */

const CARD =
  "rounded-[18px] bg-panel border border-hairline shadow-card";

export function WarmPage({ children }: { children: ReactNode }) {
  return <div className="px-6 lg:px-8 py-7 space-y-8 max-w-[1200px]">{children}</div>;
}

export function WarmCard({ children, className = "" }: { children: ReactNode; className?: string }) {
  return <div className={`${CARD} overflow-hidden ${className}`}>{children}</div>;
}

export function WarmCardHeader({
  title,
  hint,
  action,
}: {
  title: string;
  hint?: string;
  action?: ReactNode;
}) {
  return (
    <div className="px-6 py-4 border-b border-hairline bg-panel-2 flex items-center justify-between gap-3">
      <div className="font-display text-[21px] leading-none tracking-[-0.005em] text-ink">
        {title}
      </div>
      {hint ? <div className="text-[13px] text-muted">{hint}</div> : null}
      {action ? <div className="flex items-center gap-2">{action}</div> : null}
    </div>
  );
}

type ButtonTone = "primary" | "secondary" | "danger" | "success" | "ghost";

const toneClasses: Record<ButtonTone, string> = {
  primary:
    "bg-ink text-panel hover:bg-ink-2 shadow-lift",
  secondary:
    "bg-panel text-ink-2 border border-hairline shadow-sm hover:bg-panel-2 hover:text-ink",
  danger: "bg-red-50 text-red-700 border border-red-500/25 hover:bg-red-100",
  success: "bg-green-50 text-green-700 border border-green-500/25 hover:bg-green-100",
  ghost: "bg-ink/[0.05] text-ink-2 hover:bg-ink/10 hover:text-ink",
};

export function WarmButton({
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
      className={`inline-flex items-center justify-center gap-2 h-9 px-4 rounded-full text-[13px] font-medium transition-all cursor-pointer disabled:opacity-50 disabled:cursor-not-allowed focus-visible:outline-2 focus-visible:outline-accent active:scale-[0.98] ${toneClasses[tone]}`}
    >
      {children}
    </button>
  );
}

export function WarmInput(props: React.InputHTMLAttributes<HTMLInputElement>) {
  return (
    <input
      {...props}
      className={`h-9 rounded-[12px] bg-panel border border-hairline text-[14px] text-ink px-3 placeholder:text-faint focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/25 transition-shadow ${props.className || ""}`}
    />
  );
}

export function WarmSelect(props: React.SelectHTMLAttributes<HTMLSelectElement>) {
  return (
    <select
      {...props}
      className={`h-9 rounded-[12px] bg-panel border border-hairline text-[14px] text-ink px-2.5 focus:outline-none focus:border-accent focus:ring-[3px] focus:ring-accent/25 transition-shadow cursor-pointer ${props.className || ""}`}
    />
  );
}

export function WarmField({
  label,
  children,
  hint,
}: {
  label: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="flex items-center justify-between gap-4 py-3 border-b border-hairline last:border-b-0">
      <div className="min-w-0">
        <div className="text-[13px] text-muted">{label}</div>
        {hint ? <div className="text-[12px] text-faint mt-0.5">{hint}</div> : null}
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
  orange: "bg-amber-100 text-accent-strong",
  neutral: "bg-panel-2 text-ink-2",
  purple: "bg-purple-50 text-purple-700",
};

export function WarmBadge({
  children,
  tone = "neutral",
}: {
  children: ReactNode;
  tone?: keyof typeof badgeTones;
}) {
  return (
    <span
      className={`inline-flex items-center rounded-full px-2.5 py-1 text-[12px] font-medium leading-none ${badgeTones[tone]}`}
    >
      {children}
    </span>
  );
}

export function WarmListRow({ children, className = "" }: { children: ReactNode; className?: string }) {
  return (
    <div
      className={`px-6 py-4 border-b border-hairline last:border-b-0 hover:bg-ink/[0.02] transition-colors ${className}`}
    >
      {children}
    </div>
  );
}
