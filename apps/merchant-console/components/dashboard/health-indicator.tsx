interface HealthIndicatorProps {
  label: string;
  status: "healthy" | "degraded" | "offline";
  detail?: string;
}

const statusStyles = {
  healthy: "bg-green-500",
  degraded: "bg-yellow-400",
  offline: "bg-red-400",
};

const statusLabels = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
};

export function HealthIndicator({ label, status, detail }: HealthIndicatorProps) {
  return (
    <div className="flex items-center gap-2">
      <span className={`w-1.5 h-1.5 rounded-full ${statusStyles[status]} ${status === "healthy" ? "animate-[blink_3s_ease-in-out_infinite]" : ""}`} />
      <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-2)]">
        {label}
      </span>
      <span className="font-[var(--font-mono)] text-[0.6rem] tracking-[0.1em] uppercase text-[var(--bb-grey-3)]">
        {detail || statusLabels[status]}
      </span>
    </div>
  );
}
