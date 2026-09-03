import { AnimatedCounter } from "@/components/ui/animated-counter";

interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  highlight?: boolean;
  // Decimal places for money cards — paise-exact instead of whole rupees.
  decimals?: number;
}

export function MetricCard({ label, value, prefix = "", suffix = "", highlight = false, decimals = 0 }: MetricCardProps) {
  return (
    <div className="border border-[var(--bb-line)] p-4 bg-[var(--bb-panel)]">
      <div className="font-[var(--font-mono)] text-[0.5rem] tracking-[0.16em] uppercase text-[var(--bb-grey-4)] mb-3">
        {label}
      </div>
      <div
        className={`font-[var(--font-mono)] text-[1.35rem] leading-none tabular-nums tracking-tight ${
          highlight ? "text-[var(--bb-orange)]" : "text-[var(--bb-white)]"
        }`}
      >
        {prefix}
        <AnimatedCounter target={value} duration={1000} decimals={decimals} />
        {suffix}
      </div>
    </div>
  );
}
