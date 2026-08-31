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
    <div className="border border-[var(--bb-line)] p-5 bg-[var(--bb-panel)]">
      <div className="font-[var(--font-mono)] text-[0.55rem] tracking-[0.14em] uppercase text-[var(--bb-grey-3)] mb-2">
        {label}
      </div>
      <div className={`font-[var(--font-sans)] text-[1.6rem] tracking-[-0.04em] ${highlight ? "text-[var(--bb-orange)]" : "text-[var(--bb-white)]"}`}>
        {prefix}
        <AnimatedCounter target={value} duration={1000} />
        {suffix}
      </div>
    </div>
  );
}
