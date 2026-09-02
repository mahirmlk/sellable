import { AnimatedCounter } from "@/components/ui/animated-counter";

interface MetricCardProps {
  label: string;
  value: number;
  prefix?: string;
  suffix?: string;
  highlight?: boolean;
}

export function MetricCard({ label, value, prefix = "", suffix = "", highlight = false }: MetricCardProps) {
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
        <AnimatedCounter target={value} duration={1000} />
        {suffix}
      </div>
    </div>
  );
}
