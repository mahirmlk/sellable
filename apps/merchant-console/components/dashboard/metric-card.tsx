import { AnimatedCounter } from "@/components/ui/animated-counter";

interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  highlight?: boolean;
  // Decimal places for money cards — paise-exact instead of whole rupees.
  decimals?: number;
  sub?: string;
}

export function MetricCard({ label, value, prefix = "", suffix = "", highlight = false, decimals = 0, sub }: MetricCardProps) {
  return (
    <div className="group rounded-2xl bg-white border border-black/[0.06] shadow-[0_1px_2px_rgba(0,0,0,0.04),0_8px_24px_-12px_rgba(0,0,0,0.12)] p-5 transition-all duration-200 hover:-translate-y-px hover:shadow-[0_12px_40px_-12px_rgba(0,0,0,0.18)] focus-within:outline-2 focus-within:outline-[#0071e3]">
      <div className="text-[13px] font-medium text-neutral-500 mb-2 truncate">
        {label}
      </div>
      <div
        aria-live="polite"
        className={`font-semibold text-[28px] leading-none tracking-tight tabular-nums ${
          highlight ? "text-[#0071e3]" : "text-neutral-900"
        }`}
      >
        {prefix}
        <AnimatedCounter target={value} duration={600} decimals={decimals} />
        {suffix}
      </div>
      {sub ? (
        <div className="mt-1.5 text-[13px] text-neutral-400 truncate">{sub}</div>
      ) : null}
    </div>
  );
}
