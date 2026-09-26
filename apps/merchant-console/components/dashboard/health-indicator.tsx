interface HealthIndicatorProps {
  label: string;
  status: "healthy" | "degraded" | "offline";
  detail?: string;
}

const statusStyles = {
  healthy: "bg-green-600",
  degraded: "bg-amber-600",
  offline: "bg-red-600",
};

const statusPills = {
  healthy: "bg-green-50 text-green-700",
  degraded: "bg-amber-50 text-amber-800",
  offline: "bg-red-50 text-red-700",
};

const statusLabels = {
  healthy: "Healthy",
  degraded: "Degraded",
  offline: "Offline",
};

export function HealthIndicator({ label, status, detail }: HealthIndicatorProps) {
  return (
    <div className="flex items-center gap-2" role="status">
      <span className={`size-2 rounded-full shrink-0 ${statusStyles[status]}`} />
      <span className="text-[13px] text-neutral-700">
        {label}
      </span>
      <span className={`inline-flex items-center rounded-full px-2 py-0.5 text-[12px] font-medium leading-none ${statusPills[status]}`}>
        {detail || statusLabels[status]}
      </span>
    </div>
  );
}
