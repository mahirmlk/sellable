import { formatPaise } from "@/lib/formatters";

export function MoneyValue({ paise, size = "md", tone = "default", className = "" }: { paise: number; size?: "sm" | "md" | "lg"; tone?: "default" | "muted" | "brand"; className?: string }) {
  const sizeClasses = {
    sm: "text-[13px]",
    md: "text-[15px]",
    lg: "text-[22px]",
  };
  const toneClasses = {
    default: "text-neutral-900",
    muted: "text-neutral-500",
    brand: "text-accent-strong",
  };
  return (
    <span className={`font-semibold tracking-tight tabular-nums ${sizeClasses[size]} ${toneClasses[tone]} ${className}`}>
      {formatPaise(paise)}
    </span>
  );
}
